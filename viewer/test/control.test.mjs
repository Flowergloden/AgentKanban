import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, withServer } from './fixture.mjs';

const exec = promisify(execFile);
const controlFile = fileURLToPath(new URL('../server/control.mjs', import.meta.url));

async function run(env, ...args) {
  const result = await exec(process.execPath, [controlFile, ...args], { env, timeout: 12_000 });
  return JSON.parse(result.stdout);
}

test('status/auto/stop without service do not launch or create project files', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-control-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old') };
  for (const operation of ['status', 'auto', 'stop', 'stop'])
    assert.deepEqual(await run(env, operation), { running: false });
  assert.deepEqual(await readdir(dir), []);
});

test('control switches mode in place, is idempotent, and stop retains registry', async (t) => {
  await withServer(t, async ({ url, dir, childEnv, child }) => {
    const root = path.join(dir, '未创建 项目');
    assert.equal((await run(childEnv, 'start', '--persistent', '--root', root)).mode, 'persistent');
    assert.equal((await run(childEnv, 'start', '--persistent')).mode, 'persistent');
    assert.equal((await run(childEnv, 'start')).mode, 'persistent');
    assert.equal((await run(childEnv, 'auto')).mode, 'auto');
    assert.equal((await run(childEnv, 'auto')).mode, 'auto');
    const projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.length, 1);
    assert.equal(await readdir(dir).then((items) => items.includes('未创建 项目')), false);
    assert.deepEqual(await run(childEnv, 'stop'), { running: false });
    assert.equal(child.exitCode !== null || child.signalCode !== null, true);
    assert.deepEqual(await run(childEnv, 'stop'), { running: false });
  });
});

test('cold persistent start has no browser/project side effect; ordinary restart is auto', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-cold-test-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old') };
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* already stopped */ }
    await rm(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, 'absent project');
  const first = await run(env, 'start', '--persistent', '--root', root);
  assert.equal(first.mode, 'persistent');
  assert.equal((await run(env, 'status')).mode, 'persistent');
  assert.equal((await readdir(dir)).includes('absent project'), false);
  assert.deepEqual(await run(env, 'stop'), { running: false });
  const second = await run(env, 'start');
  assert.equal(second.mode, 'auto');
  assert.deepEqual((await (await fetch(base + '/api/projects')).json()).map(({ root }) => root), [root.replace(/\\/g, '/')]);
  assert.deepEqual(await run(env, 'stop'), { running: false });
});

test('failed legacy migration surfaces startup diagnostic without damaging source', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-corrupt-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const port = await freePort();
  const oldHome = path.join(dir, 'old');
  const oldFile = path.join(oldHome, 'kanban-viewer', 'registry.json');
  await mkdir(path.dirname(oldFile), { recursive: true });
  await writeFile(oldFile, '{damaged');
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'new'), KIMI_CODE_HOME: oldHome };
  await assert.rejects(exec(process.execPath, [controlFile, 'start'], { env, timeout: 9000 }), /注册表损坏/);
  assert.equal(await readFile(oldFile, 'utf8'), '{damaged');
});
