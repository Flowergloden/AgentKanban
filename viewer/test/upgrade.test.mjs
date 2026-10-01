import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './fixture.mjs';
import { acquireLock } from '../server/lock.mjs';

const exec = promisify(execFile);
const viewer = fileURLToPath(new URL('..', import.meta.url));
const control = path.join(viewer, 'server', 'control.mjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-upgrade-test-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'kimi') };
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* absent */ }
    await rm(dir, { recursive: true, force: true });
  });
  const run = async (...args) => JSON.parse((await exec(process.execPath, [control, ...args], { env, timeout: 12_000 })).stdout);
  return { dir, env, base, run };
}
async function oldService({ dir, env, base }) {
  const old = path.join(dir, 'old-viewer');
  await mkdir(path.join(old, 'server'), { recursive: true });
  await mkdir(path.join(old, 'web'));
  for (const file of ['server.mjs', 'metadata.mjs', 'registry.mjs', 'lock.mjs', 'lifecycle.mjs', 'threads.mjs', 'vcs.mjs'])
    await copyFile(path.join(viewer, 'server', file), path.join(old, 'server', file));
  await writeFile(path.join(old, 'service.json'), JSON.stringify({ version: '0.2.3', protocolVersion: 1 }));
  const child = spawn(process.execPath, [path.join(old, 'server', 'server.mjs')], { env: { ...env, AGENT_KANBAN_INITIAL_MODE: 'persistent' }, cwd: os.tmpdir(), stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const result = await (await fetch(base + '/api/health')).json(); if (result.version === '0.2.3') return child; }
    catch { /* wait */ }
    await sleep(50);
  }
  child.kill();
  throw new Error('old service did not start');
}

test('coordinated upgrade preserves persistent mode and registry', async (t) => {
  const scope = await setup(t);
  const old = await oldService(scope);
  t.after(() => { if (old.exitCode === null) old.kill(); });
  const root = path.join(scope.dir, 'project');
  assert.equal((await fetch(scope.base + '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) })).status, 200);
  const oldPid = (await (await fetch(scope.base + '/api/health')).json()).pid;
  const upgraded = await scope.run('start');
  assert.equal(upgraded.version, '0.2.9');
  assert.equal(upgraded.mode, 'persistent');
  assert.notEqual(upgraded.pid, oldPid);
  assert.equal((await (await fetch(scope.base + '/api/projects')).json()).length, 1);
  assert.equal(Object.keys(JSON.parse(await readFile(path.join(scope.dir, 'data', 'registry.json'), 'utf8')).projects).length, 1);
  await scope.run('stop');
});

test('legacy service without protocolVersion is upgraded instead of reused', async (t) => {
  const scope = await setup(t);
  const legacy = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, name: 'kanban-viewer', version: '0.2.4' }));
    if (req.url === '/api/shutdown') { res.end('{"ok":true}'); legacy.close(); legacy.closeAllConnections(); return; }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => legacy.listen(Number(scope.env.AGENT_KANBAN_PORT), '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => legacy.close(resolve)));
  const upgraded = await scope.run('start');
  assert.equal(upgraded.version, '0.2.9');
  assert.equal(upgraded.legacy, false);
  assert.equal(upgraded.mode, 'auto');
  await scope.run('stop');
});

test('mode change during coordination returns retryable 409, leaves confirmed state alone', async (t) => {
  const scope = await setup(t);
  await scope.run('start');
  const lock = await acquireLock({ file: path.join(scope.dir, 'data', 'service.lock') });
  try {
    const response = await fetch(scope.base + '/api/service/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'persistent' }) });
    assert.equal(response.status, 409);
    assert.equal((await (await fetch(scope.base + '/api/health')).json()).mode, 'auto');
  } finally { await lock(); }
  assert.equal((await scope.run('start', '--persistent')).mode, 'persistent');
  await scope.run('stop');
});

test('upgrade failure reports diagnostic rather than fake success', async (t) => {
  const scope = await setup(t);
  let shutdowns = 0;
  const fake = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/shutdown') shutdowns++;
    res.end(JSON.stringify(req.url === '/api/health' ? { ok: true, name: 'kanban-viewer', version: '0.2.3', protocolVersion: 1, mode: 'persistent' } : { ok: true }));
  });
  await new Promise((resolve) => fake.listen(Number(scope.env.AGENT_KANBAN_PORT), '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => fake.close(resolve)));
  await assert.rejects(exec(process.execPath, [control, 'start'], { env: scope.env, timeout: 7000 }), /旧服务未正常退出/);
  assert.equal(shutdowns, 1);
  assert.equal(fake.listening, true);
});
