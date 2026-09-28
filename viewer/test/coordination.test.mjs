import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './fixture.mjs';

const exec = promisify(execFile);
const control = fileURLToPath(new URL('../server/control.mjs', import.meta.url));
async function sandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-lock-test-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old') };
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* already gone */ }
    await rm(dir, { recursive: true, force: true });
  });
  const run = async (...args) => JSON.parse((await exec(process.execPath, [control, ...args], { env, timeout: 12_000 })).stdout);
  return { dir, env, base, run };
}

test('concurrent launches and stale owner leave exactly one listening service', async (t) => {
  const { dir, base, run } = await sandbox(t);
  await mkdir(path.join(dir, 'data'));
  await writeFile(path.join(dir, 'data', 'service.lock'), JSON.stringify({ pid: 2147483647, token: 'stale' }));
  const [a, b] = await Promise.all([run('start'), run('start')]);
  assert.equal(a.pid, b.pid);
  const healthy = await (await fetch(base + '/api/health')).json();
  assert.equal(healthy.pid, a.pid);
  assert.equal(path.resolve(healthy.cwd), path.resolve(os.tmpdir()));
  assert.deepEqual(await run('stop'), { running: false });
});

test('occupied port is not treated as Kanban and foreign server is never stopped', async (t) => {
  const { env } = await sandbox(t);
  let shutdownCalls = 0;
  const foreign = http.createServer((req, res) => {
    if (req.url === '/api/shutdown') shutdownCalls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, name: 'other-service', version: '9.9.9' }));
  });
  await new Promise((resolve) => foreign.listen(Number(env.AGENT_KANBAN_PORT), '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  await assert.rejects(exec(process.execPath, [control, 'start'], { env, timeout: 12_000 }), /端口.*其他程序占用/);
  assert.equal(shutdownCalls, 0);
  assert.equal(foreign.listening, true);
});
