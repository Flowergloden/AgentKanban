import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, withServer } from './fixture.mjs';

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

test('explicit open confirms project as registered; ordinary control start only discovers', async (t) => {
  await withServer(t, async ({ url, dir, childEnv }) => {
    const env = { ...childEnv, AGENT_KANBAN_OPEN_DRY_RUN: '1' };
    const open = path.join(viewer, 'server', 'open.mjs');
    const root = path.join(dir, '中文 项目');
    const opened = await exec(process.execPath, [open, root], { env });
    assert.equal(new URL(opened.stdout.trim()).searchParams.get('root'), root);
    const projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].state, 'registered');
    assert.equal(projects[0].root, root.replace(/\\/g, '/').toLowerCase());
    // 普通入口（控制启动）仍只自动发现：新路径保持待确认
    const plain = path.join(dir, 'plain project');
    await exec(process.execPath, [path.join(viewer, 'server', 'control.mjs'), 'start', '--root', plain], { env });
    const after = await (await fetch(url + '/api/projects')).json();
    assert.equal(after.length, 2);
    assert.equal(after.find((p) => p.root === plain.replace(/\\/g, '/').toLowerCase()).state, 'pending');
  });
});

test('new open entry degrades against legacy service: reuses it and registers instead of confirming', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-open-legacy-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), AGENT_KANBAN_OPEN_DRY_RUN: '1' };
  let registerRequests = 0; let confirmRequests = 0; let shutdownRequests = 0;
  const legacy = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, name: 'kanban-viewer', version: '0.2.20', mode: 'auto', pid: 4242 }));
    if (req.url === '/api/register') { registerRequests++; return res.end('{"ok":true}'); }
    if (req.url === '/api/projects/confirm') { confirmRequests++; return res.end('{"ok":true}'); }
    if (req.url === '/api/shutdown') { shutdownRequests++; return res.end('{"ok":true}'); }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => legacy.listen(port, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => legacy.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const root = path.join(dir, 'legacy proj');
  const result = await exec(process.execPath, [path.join(viewer, 'server', 'open.mjs'), root], { env });
  assert.equal(new URL(result.stdout.trim()).searchParams.get('root'), root);
  assert.equal(registerRequests, 1); // 降级为原有注册
  assert.equal(confirmRequests, 0); // 不误报确认成功
  assert.equal(shutdownRequests, 0); // 复用服务不替换，模式保留
});

test('confirm failure does not open browser or claim success', async (t) => {
  await withServer(t, async ({ dir, childEnv }) => {
    const env = { ...childEnv, AGENT_KANBAN_OPEN_DRY_RUN: '1' };
    const root = path.join(dir, 'unlucky');
    await assert.rejects(
      exec(process.execPath, [path.join(viewer, 'server', 'open.mjs'), root], { env }),
      (error) => {
        assert.equal(error.stdout, '');
        assert.match(error.stderr, /项目确认失败/);
        return true;
      },
    );
  }, { env: { AGENT_KANBAN_FAIL_REGISTRY_WRITE: '1' } });
});
