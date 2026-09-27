import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEALTH_URL = 'http://127.0.0.1:4731/api/health';
const REGISTER_URL = 'http://127.0.0.1:4731/api/register';
const INIT_URL = 'http://127.0.0.1:4731/api/init';
const serverFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function isAlive() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true && data?.name === 'kanban-viewer';
  } catch {
    return false;
  }
}

let cwd = process.cwd();
try {
  const payload = JSON.parse(await readStdin());
  if (typeof payload?.cwd === 'string' && payload.cwd) cwd = payload.cwd;
} catch {
}

try {
  if (!(await isAlive())) {
    spawn(process.execPath, [serverFile], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await isAlive())) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!(await isAlive())) {
    process.stderr.write('kanban-viewer: 服务未能就绪（端口 4731 可能被其他程序占用）\n');
  } else {
    await fetch(REGISTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: cwd }),
      signal: AbortSignal.timeout(2000),
    });
    // 初始化失败不阻塞会话启动（页面加载时还会兜底触发）
    try {
      await fetch(INIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: cwd }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
    }
  }
} catch (err) {
  process.stderr.write(`kanban-viewer: ${err?.message || err}\n`);
}
