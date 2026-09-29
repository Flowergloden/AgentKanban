import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadServiceMetadata } from './metadata.mjs';
import { acquireLock } from './lock.mjs';
import { registryPaths } from './registry.mjs';

const port = process.env.AGENT_KANBAN_PORT || '4731';
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const metadata = await loadServiceMetadata();

async function request(route, options = {}) {
  const response = await fetch(base + route, { signal: AbortSignal.timeout(1500), ...options });
  return { status: response.status, data: await response.json() };
}
export async function probe() {
  try { return await request('/api/health'); }
  catch { return null; }
}
export function compareVersions(left, right) {
  const parts = (v) => /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null;
  const a = parts(left); const b = parts(right);
  if (!a || !b || a.some((v) => !Number.isSafeInteger(v)) || b.some((v) => !Number.isSafeInteger(v)))
    throw new Error('版本不可安全比较，请手动迁移');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
function checkService(result) {
  if (!result) return null;
  if (result.data?.ok !== true || result.data?.name !== 'kanban-viewer')
    throw new Error(`端口 ${port} 被其他程序占用；不会停止该程序`);
  return result.data;
}
async function waitFor(predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (predicate(result)) return result ?? true;
    await sleep(100);
  }
  return null;
}
async function launch(mode) {
  const { dataDir } = registryPaths();
  await fs.mkdir(dataDir, { recursive: true });
  const logFile = path.join(dataDir, 'service-start.log');
  const log = await fs.open(logFile, 'w');
  try {
    spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      cwd: os.tmpdir(), detached: true, windowsHide: true, stdio: ['ignore', 'ignore', log.fd],
      env: { ...process.env, AGENT_KANBAN_INITIAL_MODE: mode },
    }).unref();
  } finally { await log.close(); }
  const ready = await waitFor((result) => result?.data?.ok && result.data.name === 'kanban-viewer', 5000);
  if (!ready) {
    const diagnostic = (await fs.readFile(logFile, 'utf8')).trim().slice(0, 800);
    throw new Error(`服务未能就绪，检查端口 ${port}：${diagnostic || '启动超时或端口占用'}`);
  }
  return checkService(ready);
}

export async function ensure({ root, persistent = false } = {}) {
  const release = await acquireLock();
  let service;
  let legacy = false;
  try {
    service = checkService(await probe());
    if (!service) service = await launch(persistent ? 'persistent' : 'auto');
    else {
      if (service.protocolVersion === undefined) {
        if (compareVersions(metadata.version, service.version) <= 0) {
          legacy = true;
          if (persistent) throw new Error('旧协议不支持常驻；请先停止旧服务并升级双端');
        }
      } else if (service.protocolVersion !== metadata.protocolVersion) {
        throw new Error('服务协议不兼容；请停止旧服务并升级双端');
      }
      if (!legacy && compareVersions(metadata.version, service.version) > 0) {
        const inherited = service.mode === 'persistent' ? 'persistent' : 'auto';
        const response = await request('/api/shutdown', { method: 'POST', headers: { 'X-Kanban-Lock': release.token } });
        if (response.status !== 200 || response.data?.ok !== true ||
            !await waitFor((result) => result === null, 3000))
          throw new Error('旧服务未正常退出，升级已中止');
        service = await launch(inherited);
        if (service.version !== metadata.version || service.mode !== inherited)
          throw new Error('新版服务未确认升级或模式继承');
      }
    }
    if (root) {
      const result = await request('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }),
      });
      if (result.status !== 200 || result.data?.ok !== true) throw new Error('项目注册失败');
    }
  } finally { await release(); }
  if (persistent && service.mode !== 'persistent') {
    const result = await request('/api/service/mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'persistent' }),
    });
    if (result.status !== 200 || result.data?.mode !== 'persistent') throw new Error('常驻切换失败，请重试');
    service = { ...service, mode: 'persistent' };
  }
  return { ...service, legacy };
}

export async function control(action) {
  if (!['auto', 'status', 'stop'].includes(action)) throw new Error('invalid action');
  const service = checkService(await probe());
  if (!service) return { running: false };
  if (action === 'status') return { running: true, ...service };
  if (service.protocolVersion !== metadata.protocolVersion) throw new Error('旧协议或不兼容服务不支持此控制，请手动迁移');
  const route = action === 'stop' ? '/api/shutdown' : '/api/service/mode';
  const response = await request(route, action === 'stop' ? { method: 'POST' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'auto' }),
  });
  if (response.status !== 200 || response.data?.ok !== true) throw new Error(`控制失败 (${response.status})，请重试`);
  if (action === 'stop' && !await waitFor((result) => result === null, 3000))
    throw new Error('服务停止未确认');
  return action === 'stop' ? { running: false } : { running: true, ...service, mode: 'auto' };
}
