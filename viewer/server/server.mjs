import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as threads from './threads.mjs';

const HOST = '127.0.0.1';
const PORT = 4731;
const SERVICE_NAME = 'kanban-viewer';
const MAX_BODY_BYTES = 64 * 1024;
const HEARTBEAT_TTL_MS = 180_000;
const TTL_CHECK_INTERVAL_MS = 30_000;

const kimiCodeHome = process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
const registryDir = path.join(kimiCodeHome, 'kanban-viewer');
const registryFile = path.join(registryDir, 'registry.json');
const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

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

const projects = new Map();
let lastHeartbeatAt = Date.now();

// Windows 上不同写入方会以 "\" 或 "/" 形式传同一 cwd，统一为 "/" 形式以便合并
function normalizeRoot(root) {
  return root.replace(/\\/g, '/');
}

async function loadRegistry() {
  try {
    const data = JSON.parse(await fs.readFile(registryFile, 'utf8'));
    let dirty = false;
    for (const [root, lastSeen] of Object.entries(data?.projects ?? {})) {
      if (typeof root !== 'string' || !root || !Number.isFinite(lastSeen)) continue;
      const normalized = normalizeRoot(root);
      if (normalized !== root) dirty = true;
      const existing = projects.get(normalized);
      if (existing === undefined || lastSeen > existing) {
        projects.set(normalized, lastSeen);
      }
    }
    if (dirty) await saveRegistry();
  } catch {
  }
}

async function saveRegistry() {
  await fs.mkdir(registryDir, { recursive: true });
  const tmpFile = registryFile + '.tmp';
  await fs.writeFile(tmpFile, JSON.stringify({ projects: Object.fromEntries(projects) }, null, 2));
  await fs.rename(tmpFile, registryFile);
}

function sendJson(res, status, data) {
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
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, name: SERVICE_NAME });
    }

    if (req.method === 'POST' && url.pathname === '/api/register') {
      const { root } = await readJsonBody(req);
      if (typeof root !== 'string' || !root) return sendJson(res, 400, { error: 'root is required' });
      projects.set(normalizeRoot(root), Date.now());
      await saveRegistry();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/heartbeat') {
      const { root } = await readJsonBody(req);
      lastHeartbeatAt = Date.now();
      if (typeof root === 'string' && root) {
        projects.set(normalizeRoot(root), lastHeartbeatAt);
        await saveRegistry();
      }
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

    if (req.method === 'POST' && url.pathname === '/api/threads') {
      const body = await readJsonBody(req);
      const result = await threads.create(requireRoot(body.root), body.title, body.slug);
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

server.on('error', () => process.exit(1));

setInterval(() => {
  if (Date.now() - lastHeartbeatAt > HEARTBEAT_TTL_MS) process.exit(0);
}, TTL_CHECK_INTERVAL_MS).unref();

await loadRegistry();
server.listen(PORT, HOST);
