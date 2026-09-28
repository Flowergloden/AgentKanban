import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './fixture.mjs';
import { isDiagnosticOrControl } from '../server/activity.mjs';

const exec = promisify(execFile);
const server = fileURLToPath(new URL('../server/', import.meta.url));
const capture = (file, args, env, payload) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(server, file), ...args], { env, windowsHide: true });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('error', reject);
  child.on('exit', (code) => resolve({ code, stdout, stderr }));
  child.stdin.end(JSON.stringify(payload));
});

test('diagnostic/control tool completion is not an activity event', () => {
  for (const command of ['node C:/a/control.mjs stop', 'curl http://127.0.0.1:4731/api/health', 'node C:/a/control.mjs status'])
    assert.equal(isDiagnosticOrControl({ hook_event_name: 'PostToolUse', tool_input: { command } }), true);
  assert.equal(isDiagnosticOrControl({ hook_event_name: 'PostToolUse', tool_input: { command: 'npm test' } }), false);
});

test('prompt and Kimi heartbeat recover after stop; stop completion does not undo it', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-activity-test-'));
  const port = await freePort();
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old') };
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* absent */ }
    await rm(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, 'no kanban');
  const hook = (event) => capture('codex-hook.mjs', ['activity'], env, { cwd: root, ...event });
  let result = await hook({ hook_event_name: 'UserPromptSubmit', prompt: '继续工作' });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.equal((await (await fetch(base + '/api/health')).json()).mode, 'auto');
  await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const firstThrottle = await readFile(path.join(dir, 'data', 'activity-hook.json'), 'utf8');
  await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(await readFile(path.join(dir, 'data', 'activity-hook.json'), 'utf8'), firstThrottle);
  await exec(process.execPath, [path.join(server, 'control.mjs'), 'stop'], { env });
  result = await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: `node "${path.join(server, 'control.mjs')}" stop` } });
  assert.equal(result.code, 0);
  await assert.rejects(fetch(base + '/api/health'));
  result = await capture('heartbeat.mjs', [], env, { cwd: root });
  assert.equal(result.code, 0);
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
  const files = await readdir(dir);
  assert.equal(files.includes('no kanban'), false);
  await exec(process.execPath, [path.join(server, 'control.mjs'), 'stop'], { env });
  result = await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'curl http://127.0.0.1:4731/api/health' } });
  assert.equal(result.code, 0);
  await assert.rejects(fetch(base + '/api/health'));
  result = await hook({ hook_event_name: 'UserPromptSubmit', prompt: '再继续' });
  assert.equal(result.code, 0);
  assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
});
