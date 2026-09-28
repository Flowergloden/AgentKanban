import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './fixture.mjs';

const exec = promisify(execFile);
const viewer = fileURLToPath(new URL('..', import.meta.url));

test('both skill-relative script paths exist and ordinary opening preserves persistent mode', async (t) => {
  for (const skill of ['kanban-open', 'kanban-service']) {
    const script = path.resolve(viewer, 'skills', skill, '../../server', skill === 'kanban-open' ? 'open.mjs' : 'control.mjs');
    assert.equal((await stat(script)).isFile(), true);
  }
  assert.equal((await stat(path.resolve(viewer, 'commands', '../server/open.mjs'))).isFile(), true);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-open-test-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old'), AGENT_KANBAN_OPEN_DRY_RUN: '1' };
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* absent */ } await rm(dir, { recursive: true, force: true }); });
  await exec(process.execPath, [path.join(viewer, 'server', 'control.mjs'), 'start', '--persistent'], { env });
  const root = path.join(dir, '中文 项目');
  const result = await exec(process.execPath, [path.join(viewer, 'server', 'open.mjs'), root], { env });
  assert.equal(new URL(result.stdout.trim()).searchParams.get('root'), root);
  assert.equal((await (await fetch(base + '/api/health')).json()).mode, 'persistent');
  await assert.rejects(readFile(path.join(root, 'kanban', 'note.md')));
  await exec(process.execPath, [path.join(viewer, 'server', 'control.mjs'), 'stop'], { env });
});

test('failed service readiness does not report an opened URL', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-open-fail-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), AGENT_KANBAN_OPEN_DRY_RUN: '1' };
  const foreign = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"name":"other","ok":true}'); });
  await new Promise((resolve) => foreign.listen(port, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => foreign.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  await assert.rejects(exec(process.execPath, [path.join(viewer, 'server', 'open.mjs'), path.join(dir, 'project')], { env }), (error) => {
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /其他程序占用/);
    return true;
  });
});

test('PowerShell environment transport preserves percent-encoded Windows URL', async () => {
  const url = new URL('http://127.0.0.1:4731/');
  url.searchParams.set('root', 'C:\\中文 目录\\project');
  const original = url.toString();
  const result = await exec('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', '[Console]::Out.Write($env:AGENT_KANBAN_OPEN_URL)',
  ], { env: { ...process.env, AGENT_KANBAN_OPEN_URL: original } });
  assert.equal(result.stdout, original);
  assert.match(original, /%3A|%5C/);
});
