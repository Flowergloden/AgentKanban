import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './fixture.mjs';
import { compareVersions } from '../server/manager.mjs';

const exec = promisify(execFile);
const control = fileURLToPath(new URL('../server/control.mjs', import.meta.url));

test('numeric version comparison never mistakes older client for upgrade', () => {
  assert.equal(compareVersions('0.2.4', '0.2.4'), 0);
  assert.equal(compareVersions('0.2.4', '0.2.10'), -1);
  assert.equal(compareVersions('0.3.0', '0.2.10'), 1);
  assert.throws(() => compareVersions('dev', '0.2.4'), /不可安全比较/);
});

for (const [label, health, behavior] of [
  ['same', { version: '0.2.6', protocolVersion: 1, mode: 'auto' }, 'reuse'],
  ['newer', { version: '0.2.10', protocolVersion: 1, mode: 'auto' }, 'reuse'],
  ['incompatible', { version: '0.2.6', protocolVersion: 2, mode: 'auto' }, 'reject'],
  ['legacy not older', { version: '0.2.6' }, 'reuse-legacy'],
  ['legacy older', { version: '0.1.0' }, 'upgrade'],
]) {
  test(`protocol negotiation: ${label}`, async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-protocol-test-'));
    const port = await freePort();
    const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data') };
    let shutdown = 0;
    let registered = 0;
    const fake = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, name: 'kanban-viewer', ...health }));
      if (req.url === '/api/register') { registered++; return res.end('{"ok":true}'); }
      if (req.url === '/api/shutdown') { shutdown++; return res.end('{"ok":true}'); }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise((resolve) => fake.listen(port, '127.0.0.1', resolve));
    t.after(async () => { await new Promise((resolve) => fake.close(resolve)); await rm(dir, { recursive: true, force: true }); });
    const invoke = (...args) => exec(process.execPath, [control, ...args], { env, timeout: 9000 });
    if (behavior === 'reuse' || behavior === 'reuse-legacy') {
      const result = JSON.parse((await invoke('start', '--root', path.join(dir, 'project'))).stdout);
      assert.equal(result.legacy, behavior === 'reuse-legacy');
      assert.equal(registered, 1);
      if (behavior === 'reuse-legacy') await assert.rejects(invoke('start', '--persistent'), /旧协议不支持常驻/);
      assert.equal(shutdown, 0);
    } else if (behavior === 'reject') {
      await assert.rejects(invoke('start'), /协议不兼容/);
      assert.equal(shutdown, 0);
    } else {
      await assert.rejects(invoke('start'), /旧服务未正常退出/);
      assert.equal(shutdown, 1);
    }
  });
}
