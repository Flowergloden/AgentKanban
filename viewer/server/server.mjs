import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as threads from './threads.mjs';
import * as vcs from './vcs.mjs';
import { loadServiceMetadata } from './metadata.mjs';
import { registryPaths, loadRegistry, saveRegistry, normalizeRoot } from './registry.mjs';
import { createLifecycle, CHECK_INTERVAL_MS } from './lifecycle.mjs';
import { acquireLock, ownsLock } from './lock.mjs';

const HOST = '127.0.0.1';
const PORT = process.env.AGENT_KANBAN_PORT ? Number(process.env.AGENT_KANBAN_PORT) : 4731;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('invalid AGENT_KANBAN_PORT');
const SERVICE_NAME = 'kanban-viewer';
const MAX_BODY_BYTES = 64 * 1024;

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

// 更新项目 lastSeen，保留既有 vcs 检测缓存
function touchProject(root, now = Date.now()) {
  const key = normalizeRoot(root);
  const prev = projects.get(key);
  projects.set(key, { lastSeen: now, ...(prev?.vcs ? { vcs: prev.vcs } : {}) });
}

// 受管检测并刷新注册表缓存字段；'unknown'（服务器不可达）保留既有缓存，检测失败按非 P4 处理且不报错
async function refreshVcs(root) {
  try {
    const type = await vcs.detect(root);
    if (type === 'unknown') return;
    const key = normalizeRoot(root);
    const prev = projects.get(key);
    if (!prev) return;
    projects.set(key, { lastSeen: prev.lastSeen, vcs: { type, checkedAt: Date.now() } });
    vcs.setCached(key, type);
    await saveRegistry(registryFile, projects);
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

function requireRoot(value) {
  if (typeof value !== 'string' || !value) {
    const err = new Error('root is required');
    err.status = 400;
    throw err;
  }
  return value;
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

    if (req.method === 'POST' && url.pathname === '/api/register') {
      const { root } = await readJsonBody(req);
      if (typeof root !== 'string' || !root) return sendJson(res, 400, { error: 'root is required' });
      touchProject(root);
      await saveRegistry(registryFile, projects);
      lifecycle.activity();
      await refreshVcs(root);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && ['/api/heartbeat', '/api/activity'].includes(url.pathname)) {
      const body = await readJsonBody(req);
      if (body === null || typeof body !== 'object' || Array.isArray(body) ||
          (body.root !== undefined && (typeof body.root !== 'string' || !body.root)))
        return sendJson(res, 400, { error: 'invalid activity' });
      const now = Date.now();
      if (body.root) {
        touchProject(body.root, now);
        await saveRegistry(registryFile, projects);
      }
      lifecycle.activity();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const list = [...projects.entries()]
        .map(([root, entry]) => ({ root, lastSeen: entry.lastSeen, ...(entry.vcs ? { vcs: entry.vcs } : {}) }))
        .sort((a, b) => b.lastSeen - a.lastSeen);
      return sendJson(res, 200, list);
    }

    if (req.method === 'GET' && url.pathname === '/api/active-thread') {
      const root = url.searchParams.get('root');
      if (!root) return sendJson(res, 400, { error: 'root is required' });
      return sendJson(res, 200, await queryActiveThread(root));
    }

    if (req.method === 'POST' && url.pathname === '/api/init') {
      const body = await readJsonBody(req);
      const root = requireRoot(body.root);
      const result = await threads.ensureLayout(root);
      await refreshVcs(root);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/threads') {
      const root = requireRoot(url.searchParams.get('root'));
      return sendJson(res, 200, await threads.parseList(root));
    }

    if (req.method === 'GET' && url.pathname === '/api/thread') {
      const root = requireRoot(url.searchParams.get('root'));
      const id = requireId(url.searchParams.get('id'));
      return sendJson(res, 200, await threads.getThread(root, id));
    }

    if (req.method === 'PUT' && url.pathname === '/api/thread/section') {
      const body = await readJsonBody(req);
      const result = await threads.updateSection(
        requireRoot(body.root), requireId(body.id), body.section, body.content, body.fingerprint,
      );
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/thread/status') {
      const body = await readJsonBody(req);
      const result = await threads.setStatus(requireRoot(body.root), requireId(body.id), body.status);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/note') {
      const root = requireRoot(url.searchParams.get('root'));
      return sendJson(res, 200, await threads.getNote(root));
    }

    if (req.method === 'PUT' && url.pathname === '/api/note') {
      const body = await readJsonBody(req);
      const result = await threads.updateNote(requireRoot(body.root), body.content, body.fingerprint);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/threads') {
      const body = await readJsonBody(req);
      const result = await threads.create(requireRoot(body.root), body.title, body.slug, body.goal);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/vcs/add') {
      const body = await readJsonBody(req);
      const root = requireRoot(body.root);
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
      const result = await threads.rename(requireRoot(body.root), renameMatch[1], body.slug);
      return sendJson(res, 200, result);
    }

    if (req.method === 'DELETE' && url.pathname === '/api/thread') {
      const body = await readJsonBody(req);
      const result = await threads.remove(requireRoot(body.root), requireId(body.id));
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/active-thread') {
      const body = await readJsonBody(req);
      const result = await threads.setActive(requireRoot(body.root), body.id ?? null);
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
