import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const viewer = fileURLToPath(new URL('..', import.meta.url));
export async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function withServer(t, body, { isolatedCopy = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-server-test-'));
  let port = await freePort();
  while (port === 4731) port = await freePort();
  const root = isolatedCopy ? path.join(dir, 'viewer') : viewer;
  if (isolatedCopy) {
    await mkdir(path.join(root, 'server'), { recursive: true });
    await mkdir(path.join(root, 'web'));
    for (const file of ['server.mjs', 'metadata.mjs', 'registry.mjs', 'lock.mjs', 'lifecycle.mjs', 'threads.mjs', 'vcs.mjs'])
      await copyFile(path.join(viewer, 'server', file), path.join(root, 'server', file));
    await copyFile(path.join(viewer, 'service.json'), path.join(root, 'service.json'));
  }
  const childEnv = { ...process.env, AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old'), AGENT_KANBAN_PORT: String(port) };
  const child = spawn(process.execPath, [path.join(root, 'server', 'server.mjs')], {
    cwd: os.tmpdir(), stdio: ['ignore', 'ignore', 'pipe'],
    env: childEnv,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  let healthy;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
    try {
      const res = await fetch(url + '/api/health');
      if (res.ok) { healthy = await res.json(); break; }
    } catch { /* not yet listening */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(healthy, `server did not start: ${stderr}`);
  return body({ url, dir, child, childEnv, healthy });
}
