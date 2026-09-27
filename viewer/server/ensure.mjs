import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEALTH_URL = 'http://127.0.0.1:4731/api/health';
const REGISTER_URL = 'http://127.0.0.1:4731/api/register';
const SHUTDOWN_URL = 'http://127.0.0.1:4731/api/shutdown';
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(serverDir, 'server.mjs');

let expectedVersion = '';
try {
  const manifest = JSON.parse(await fs.readFile(path.join(serverDir, '..', 'kimi.plugin.json'), 'utf8'));
  if (typeof manifest?.version === 'string') expectedVersion = manifest.version;
} catch {
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function health() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.ok !== true || data?.name !== 'kanban-viewer') return null;
    return data;
  } catch {
    return null;
  }
}

async function requestShutdown() {
  try {
    await fetch(SHUTDOWN_URL, { method: 'POST', signal: AbortSignal.timeout(1000) });
  } catch {
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && (await health())) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !(await health());
}

let cwd = process.cwd();
try {
  const payload = JSON.parse(await readStdin());
  if (typeof payload?.cwd === 'string' && payload.cwd) cwd = payload.cwd;
} catch {
}

async function spawnServer() {
  spawn(process.execPath, [serverFile], { cwd: os.tmpdir(), detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !(await health())) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

try {
  let current = await health();
  if (current && expectedVersion && current.version !== expectedVersion) {
    // 版本不一致：请求旧版主动退出后换代；旧版无 shutdown 能力时退化为直接复用
    if (await requestShutdown()) {
      await spawnServer();
      current = await health();
    }
  } else if (!current) {
    await spawnServer();
    current = await health();
  }
  if (!current) {
    process.stderr.write('kanban-viewer: 服务未能就绪（端口 4731 可能被其他程序占用）\n');
  } else {
    await fetch(REGISTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: cwd }),
      signal: AbortSignal.timeout(2000),
    });
  }
} catch (err) {
  process.stderr.write(`kanban-viewer: ${err?.message || err}\n`);
}
