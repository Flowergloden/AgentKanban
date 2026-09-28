import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as threads from './threads.mjs';
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
      projects.set(normalizeRoot(root), Date.now());
      await saveRegistry(registryFile, projects);
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
        projects.set(normalizeRoot(body.root), now);
        await saveRegistry(registryFile, projects);
      }
      lifecycle.activity();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const list = [...projects.entries()]
        .map(([root, lastSeen]) => ({ root, lastSeen }))
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
      return sendJson(res, 200, await threads.ensureLayout(requireRoot(body.root)));
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
