import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as threads from './threads.mjs';
import * as vcs from './vcs.mjs';
import { loadServiceMetadata } from './metadata.mjs';
import { registryPaths, loadRegistry, saveRegistry, canonicalRoot } from './registry.mjs';
import { createLifecycle, CHECK_INTERVAL_MS } from './lifecycle.mjs';
import { acquireLock, ownsLock } from './lock.mjs';

const HOST = '127.0.0.1';
const PORT = process.env.AGENT_KANBAN_PORT ? Number(process.env.AGENT_KANBAN_PORT) : 4731;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('invalid AGENT_KANBAN_PORT');
const SERVICE_NAME = 'kanban-viewer';
const MAX_BODY_BYTES = 64 * 1024;
// 测试注入：置 1 时所有注册表持久化失败，用于验证写助手"落盘失败不改内存与磁盘"
const FAIL_REGISTRY_WRITE = process.env.AGENT_KANBAN_FAIL_REGISTRY_WRITE === '1';

const { registryFile } = registryPaths();
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(serverDir, '..', 'web');

const { version, protocolVersion } = await loadServiceMetadata();

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const projects = await loadRegistry();
const lifecycle = createLifecycle({ initialMode: process.env.AGENT_KANBAN_INITIAL_MODE || 'auto' });

// 装配 vcs 内存缓存（注册表持久层 ↔ 写路径读缓存）；key 统一为归一化 root
for (const [root, entry] of projects) {
  if (entry.vcs) vcs.setCached(root, entry.vcs.type);
}

// ---- 注册表写助手：串行队列 + 复制-落盘-提交（原子保存成功后才替换进程内状态）----
let registryQueue = Promise.resolve();
function enqueue(task) {
  const next = registryQueue.then(task);
  registryQueue = next.catch(() => {});
  return next;
}

async function persistRegistry(draft) {
  if (FAIL_REGISTRY_WRITE) throw new Error('注册表写入失败（测试注入）');
  await saveRegistry(registryFile, draft);
}

function commitRegistry(mutate) {
  return enqueue(async () => {
    const draft = new Map(projects);
    const result = await mutate(draft);
    await persistRegistry(draft);
    projects.clear();
    for (const [key, entry] of draft) projects.set(key, entry);
    return result;
  });
}

// 自动发现语义：不存在→建 pending；registered→仅刷新 lastSeen（保留 vcs 缓存）；ignored→不改项目记录
function discoverProject(key, now = Date.now()) {
  return commitRegistry((draft) => {
    const prev = draft.get(key);
    if (!prev) {
      draft.set(key, { lastSeen: now, state: 'pending' });
      return;
    }
    if (prev.state === 'registered') {
      draft.set(key, { lastSeen: now, state: 'registered', ...(prev.vcs ? { vcs: prev.vcs } : {}) });
    }
  });
}

// 受管检测并刷新注册表缓存字段；'unknown'（服务器不可达）保留既有缓存，检测失败按非 P4 处理且不报错
async function refreshVcs(root) {
  try {
    const type = await vcs.detect(root);
    if (type === 'unknown') return;
    await commitRegistry((draft) => {
      const prev = draft.get(root);
      if (!prev) return;
      draft.set(root, { lastSeen: prev.lastSeen, state: prev.state, vcs: { type, checkedAt: Date.now() } });
    });
    vcs.setCached(root, type);
  } catch {
    // 检测异常不向用户报错
  }
}

function sendJson(res, status, data) {
  if (status >= 200 && status < 300 && res.kanbanBusiness) lifecycle.activity();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

// 新输入统一走规范键：非绝对路径返回 400
function requireCanonicalRoot(value) {
  const key = canonicalRoot(value);
  if (!key) {
    const err = new Error('root 必须是绝对路径');
    err.status = 400;
    throw err;
  }
  return key;
}

// 已注册门控：待确认、已忽略和未登记路径不得执行任何看板写操作
function requireRegisteredRoot(value) {
  const key = requireCanonicalRoot(value);
  const entry = projects.get(key);
  if (!entry) {
    const err = new Error('项目未登记：无法执行看板写操作');
    err.status = 403;
    throw err;
  }
  if (entry.state !== 'registered') {
    const err = new Error(`项目当前为「${entry.state === 'pending' ? '待确认' : '已忽略'}」状态，无法执行看板写操作`);
    err.status = 403;
    throw err;
  }
  return key;
}

// 项目写接口的同源与 JSON 校验（与 /api/service/mode 同模式）
function guardSameOriginJson(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}`) {
    sendJson(res, 403, { error: 'cross-origin project control rejected' });
    return false;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    sendJson(res, 415, { error: 'JSON content type required' });
    return false;
  }
  return true;
}

function requireId(value) {
  if (typeof value !== 'string' || !/^[\w-]+$/.test(value)) {
    const err = new Error('合法的 id 是必填项');
    err.status = 400;
    throw err;
  }
  return value;
}

function statusOfThreadError(err) {
  switch (err.code) {
    case 'conflict': return 409;
    case 'thread-missing': return 404;
    case 'section-missing':
    case 'thread-invalid':
    case 'bad-request': return 400;
    default: return 500;
  }
}

async function queryActiveThread(root) {
  let threadId = '';
  try {
    threadId = (await fs.readFile(path.join(root, 'kanban', 'current'), 'utf8')).trim();
  } catch {
    return { status: 'no-active-thread' };
  }
  if (!threadId) return { status: 'no-active-thread' };
  try {
    const markdown = await fs.readFile(path.join(root, 'kanban', 'threads', threadId, 'thread.md'), 'utf8');
    return { status: 'ok', threadId, markdown };
  } catch {
    return { status: 'thread-missing', threadId };
  }
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(webDir, '.' + rel);
  if (file !== webDir && !file.startsWith(webDir + path.sep)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  let data;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return sendJson(res, 404, { error: 'not found' });
    data = await fs.readFile(file);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
    res.kanbanBusiness = url.pathname.startsWith('/api/') &&
      !['/api/health', '/api/service/status', '/api/service/mode', '/api/shutdown', '/api/register', '/api/heartbeat', '/api/activity'].includes(url.pathname);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, name: SERVICE_NAME, version, protocolVersion, mode: lifecycle.mode, pid: process.pid, cwd: process.cwd() });
    }

    if (req.method === 'GET' && url.pathname === '/api/service/status') {
      return sendJson(res, 200, { ok: true, mode: lifecycle.mode, version, protocolVersion });
    }

    if (req.method === 'POST' && url.pathname === '/api/service/mode') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${HOST}:${PORT}`)
        return sendJson(res, 403, { error: 'cross-origin mode control rejected' });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
        return sendJson(res, 415, { error: 'JSON content type required' });
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          !['auto', 'persistent'].includes(body.mode))
        return sendJson(res, 400, { error: 'invalid mode' });
      let release;
      try { release = await acquireLock({ waitMs: 0 }); }
      catch (error) { if (error.code === 'busy') return sendJson(res, 409, { error: '升级或控制进行中，请重试' }); throw error; }
      try { return sendJson(res, 200, { ok: true, mode: lifecycle.setMode(body.mode) }); }
      finally { await release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/shutdown') {
      let release;
      if (!await ownsLock(req.headers['x-kanban-lock'])) {
        try { release = await acquireLock({ waitMs: 0 }); }
        catch (error) { if (error.code === 'busy') return sendJson(res, 409, { error: '升级或控制进行中，请重试' }); throw error; }
      }
      sendJson(res, 200, { ok: true });
      setImmediate(async () => { if (release) await release(); process.exit(0); });
      return;
    }

    // 自动发现：新路径只建 pending，不触发 P4 检测，不推翻人工状态
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const { root } = await readJsonBody(req);
      const key = requireCanonicalRoot(root);
      await discoverProject(key);
      lifecycle.activity();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && ['/api/heartbeat', '/api/activity'].includes(url.pathname)) {
      const body = await readJsonBody(req);
      if (body === null || typeof body !== 'object' || Array.isArray(body) ||
          (body.root !== undefined && (typeof body.root !== 'string' || !body.root)))
        return sendJson(res, 400, { error: 'invalid activity' });
      const now = Date.now();
      if (body.root) {
        const key = requireCanonicalRoot(body.root);
        await discoverProject(key, now);
      }
      lifecycle.activity();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const list = [...projects.entries()]
        .map(([root, entry]) => ({ root, lastSeen: entry.lastSeen, state: entry.state, ...(entry.vcs ? { vcs: entry.vcs } : {}) }))
        .sort((a, b) => b.lastSeen - a.lastSeen);
      return sendJson(res, 200, list);
    }

    // 显式确认：新路径、待确认或已忽略项目转为已注册（OpenKanban/Web 确认/取消忽略复用）
    if (req.method === 'POST' && url.pathname === '/api/projects/confirm') {
      if (!guardSameOriginJson(req, res)) return;
      const body = await readJsonBody(req);
      const key = requireCanonicalRoot(body.root);
      await commitRegistry((draft) => {
        const prev = draft.get(key);
        draft.set(key, { lastSeen: Date.now(), state: 'registered', ...(prev?.vcs ? { vcs: prev.vcs } : {}) });
      });
      await refreshVcs(key);
      return sendJson(res, 200, { ok: true });
    }

    // 手动新增：额外验证现存目录后进入 registered（本身不创建 kanban/）
    if (req.method === 'POST' && url.pathname === '/api/projects') {
      if (!guardSameOriginJson(req, res)) return;
      const body = await readJsonBody(req);
      const key = requireCanonicalRoot(body.root);
      const stat = await fs.stat(key).catch(() => null);
      if (!stat || !stat.isDirectory()) return sendJson(res, 400, { error: `目录不存在：${key}` });
      await commitRegistry((draft) => {
        const prev = draft.get(key);
        draft.set(key, { lastSeen: Date.now(), state: 'registered', ...(prev?.vcs ? { vcs: prev.vcs } : {}) });
      });
      await refreshVcs(key);
      return sendJson(res, 200, { ok: true });
    }

    // 忽略：待确认或已注册项目转为已忽略（持久抑制自动发现）
    if (req.method === 'POST' && url.pathname === '/api/projects/ignore') {
      if (!guardSameOriginJson(req, res)) return;
      const body = await readJsonBody(req);
      const key = requireCanonicalRoot(body.root);
      await commitRegistry((draft) => {
        const prev = draft.get(key);
        if (!prev) {
          const err = new Error('项目未登记，无法忽略');
          err.status = 404;
          throw err;
        }
        draft.set(key, { lastSeen: prev.lastSeen, state: 'ignored', ...(prev.vcs ? { vcs: prev.vcs } : {}) });
      });
      return sendJson(res, 200, { ok: true });
    }

    // 删除：按 root 移除任意状态的注册记录，不触碰项目文件；再次自动发现只回到 pending
    if (req.method === 'DELETE' && url.pathname === '/api/projects') {
      if (!guardSameOriginJson(req, res)) return;
      const body = await readJsonBody(req);
      const key = requireCanonicalRoot(body.root);
      await commitRegistry((draft) => {
        if (!draft.delete(key)) {
          const err = new Error('项目未登记，无法删除');
          err.status = 404;
          throw err;
        }
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/active-thread') {
      const root = requireCanonicalRoot(url.searchParams.get('root'));
      return sendJson(res, 200, await queryActiveThread(root));
    }

    if (req.method === 'POST' && url.pathname === '/api/init') {
      const body = await readJsonBody(req);
      const root = requireRegisteredRoot(body.root);
      const result = await threads.ensureLayout(root);
      await refreshVcs(root);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/threads') {
      const root = requireCanonicalRoot(url.searchParams.get('root'));
      // 已注册项目的页面加载/切换：刷新 P4 受管检测缓存
      if (projects.get(root)?.state === 'registered') await refreshVcs(root);
      const data = await threads.parseList(root);
      // 页面据此区分"未初始化"（提供初始化/忽略入口）与"已初始化但无线程"
      data.layout = await threads.hasLayout(root);
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/api/thread') {
      const root = requireCanonicalRoot(url.searchParams.get('root'));
      const id = requireId(url.searchParams.get('id'));
      return sendJson(res, 200, await threads.getThread(root, id));
    }

    if (req.method === 'PUT' && url.pathname === '/api/thread/section') {
      const body = await readJsonBody(req);
      const result = await threads.updateSection(
        requireRegisteredRoot(body.root), requireId(body.id), body.section, body.content, body.fingerprint,
      );
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/thread/status') {
      const body = await readJsonBody(req);
      const result = await threads.setStatus(requireRegisteredRoot(body.root), requireId(body.id), body.status);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/note') {
      const root = requireCanonicalRoot(url.searchParams.get('root'));
      return sendJson(res, 200, await threads.getNote(root));
    }

    if (req.method === 'PUT' && url.pathname === '/api/note') {
      const body = await readJsonBody(req);
      const result = await threads.updateNote(requireRegisteredRoot(body.root), body.content, body.fingerprint);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/threads') {
      const body = await readJsonBody(req);
      const result = await threads.create(requireRegisteredRoot(body.root), body.title, body.slug, body.goal);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/vcs/add') {
      const body = await readJsonBody(req);
      const root = requireRegisteredRoot(body.root);
      const files = body.files;
      if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string' && f)) {
        return sendJson(res, 400, { error: 'files 是非空字符串数组' });
      }
      if (vcs.getCached(root) !== 'p4') {
        return sendJson(res, 409, { error: '项目当前非 P4 受管，无法 add' });
      }
      // 越界校验：任何一条位于 kanban/ 子树外都整体拒绝，且不执行任何 p4 操作
      const kanbanRoot = path.resolve(root, 'kanban');
      for (const f of files) {
        const abs = path.resolve(root, f);
        if (abs !== kanbanRoot && !abs.startsWith(kanbanRoot + path.sep)) {
          return sendJson(res, 400, { error: `路径越界（必须位于项目 kanban/ 子树内）：${f}` });
        }
      }
      const result = await vcs.add(root, files.map((f) => path.resolve(root, f)));
      if (result.state === 'hard-fail') {
        throw new threads.ThreadError('vcs-error', `P4 add 失败：${result.reason}`);
      }
      return sendJson(res, 200, { ok: true });
    }

    const renameMatch = url.pathname.match(/^\/api\/threads\/([\w-]+)\/rename$/);
    if (req.method === 'POST' && renameMatch) {
      const body = await readJsonBody(req);
      const result = await threads.rename(requireRegisteredRoot(body.root), renameMatch[1], body.slug);
      return sendJson(res, 200, result);
    }

    if (req.method === 'DELETE' && url.pathname === '/api/thread') {
      const body = await readJsonBody(req);
      const result = await threads.remove(requireRegisteredRoot(body.root), requireId(body.id));
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/active-thread') {
      const body = await readJsonBody(req);
      const result = await threads.setActive(requireRegisteredRoot(body.root), body.id ?? null);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return await serveStatic(req, res, url.pathname);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (err instanceof threads.ThreadError) {
      return sendJson(res, statusOfThreadError(err), { error: err.message, code: err.code });
    }
    sendJson(res, err.status || 500, { error: String(err?.message || err) });
  }
});

server.on('error', (error) => { process.stderr.write('kanban-viewer: ' + error.message + '\n'); process.exit(1); });

setInterval(() => {
  if (lifecycle.expired()) process.exit(0);
}, CHECK_INTERVAL_MS).unref();

server.listen(PORT, HOST);
