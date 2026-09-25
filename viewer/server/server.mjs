import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 4731;
const SERVICE_NAME = 'kanban-viewer';
const MAX_BODY_BYTES = 64 * 1024;
const HEARTBEAT_TTL_MS = 180_000;
const TTL_CHECK_INTERVAL_MS = 30_000;

const kimiCodeHome = process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
const registryDir = path.join(kimiCodeHome, 'kanban-viewer');
const registryFile = path.join(registryDir, 'registry.json');
const indexFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'index.html');

const projects = new Map();
let lastHeartbeatAt = Date.now();

async function loadRegistry() {
  try {
    const data = JSON.parse(await fs.readFile(registryFile, 'utf8'));
    for (const [root, lastSeen] of Object.entries(data?.projects ?? {})) {
      if (typeof root === 'string' && root && Number.isFinite(lastSeen)) {
        projects.set(root, lastSeen);
      }
    }
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, name: SERVICE_NAME });
    }

    if (req.method === 'POST' && url.pathname === '/api/register') {
      const { root } = await readJsonBody(req);
      if (typeof root !== 'string' || !root) return sendJson(res, 400, { error: 'root is required' });
      projects.set(root, Date.now());
      await saveRegistry();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/heartbeat') {
      const { root } = await readJsonBody(req);
      lastHeartbeatAt = Date.now();
      if (typeof root === 'string' && root) {
        projects.set(root, lastHeartbeatAt);
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

    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await fs.readFile(indexFile);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message || err) });
  }
});

server.on('error', () => process.exit(1));

setInterval(() => {
  if (Date.now() - lastHeartbeatAt > HEARTBEAT_TTL_MS) process.exit(0);
}, TTL_CHECK_INTERVAL_MS).unref();

await loadRegistry();
server.listen(PORT, HOST);
