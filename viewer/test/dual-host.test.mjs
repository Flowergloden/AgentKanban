import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageRelease } from '../../scripts/release.mjs';
import { freePort } from './fixture.mjs';

const exec = promisify(execFile);
const viewer = fileURLToPath(new URL('..', import.meta.url));
function hook(file, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: os.tmpdir(), env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test('packaged Kimi and Codex adapters reuse one process and preserve registry on stop/restart', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-host-adapters-'));
  const stage = path.join(dir, 'stage');
  const port = await freePort();
  const oldHome = path.join(dir, 'old');
  const legacyFile = path.join(oldHome, 'kanban-viewer', 'registry.json');
  const sharedFile = path.join(dir, 'shared', 'registry.json');
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'shared'), KIMI_CODE_HOME: oldHome };
  t.after(async () => {
    try { await fetch(base + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* absent */ }
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(path.dirname(legacyFile), { recursive: true });
  const legacy = JSON.stringify({ projects: { 'C:\\legacy\\project': 123 } });
  await writeFile(legacyFile, legacy);
  await stageRelease(viewer, stage, 'v0.2.6');
  const kimi = path.join(stage, 'kimi', 'server');
  const codex = path.join(stage, 'codex', 'server');
  const rootA = path.join(dir, 'project A');
  const rootB = path.join(dir, '项目 B');
  const [a, b] = await Promise.all([
    hook(path.join(kimi, 'ensure.mjs'), [], env, { cwd: rootA }),
    hook(path.join(codex, 'codex-hook.mjs'), ['start'], env, { cwd: rootB, source: 'startup', hook_event_name: 'SessionStart' }),
  ]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(JSON.parse(b.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  const first = await (await fetch(base + '/api/health')).json();
  assert.equal(first.mode, 'auto');
  assert.equal(first.version, '0.2.6');
  const projects = await (await fetch(base + '/api/projects')).json();
  assert.equal(projects.length, 3);
  assert.equal(await readFile(legacyFile, 'utf8'), legacy);
  const persistent = JSON.parse((await exec(process.execPath, [path.join(codex, 'control.mjs'), 'start', '--persistent'], { env })).stdout);
  assert.equal(persistent.pid, first.pid);
  assert.equal(persistent.mode, 'persistent');
  const beat = await hook(path.join(kimi, 'heartbeat.mjs'), [], env, { cwd: rootA });
  assert.equal(beat.code, 0, beat.stderr);
  const activity = await hook(path.join(codex, 'codex-hook.mjs'), ['activity'], env, { cwd: rootB, hook_event_name: 'UserPromptSubmit' });
  assert.equal(activity.code, 0, activity.stderr);
  assert.equal((await (await fetch(base + '/api/health')).json()).pid, first.pid);
  // The server's cwd is outside both plugin copies, so replacing an on-disk module remains possible.
  assert.equal(path.resolve(first.cwd), path.resolve(os.tmpdir()));
  await copyFile(path.join(viewer, 'server', 'metadata.mjs'), path.join(stage, 'kimi', 'server', 'metadata.mjs'));
  await copyFile(path.join(viewer, 'server', 'metadata.mjs'), path.join(stage, 'codex', 'server', 'metadata.mjs'));
  await exec(process.execPath, [path.join(kimi, 'control.mjs'), 'stop'], { env });
  assert.equal(await readFile(legacyFile, 'utf8'), legacy);
  assert.equal(Object.keys(JSON.parse(await readFile(sharedFile, 'utf8')).projects).length, 3);
  const restarted = JSON.parse((await exec(process.execPath, [path.join(kimi, 'control.mjs'), 'start'], { env })).stdout);
  assert.equal(restarted.mode, 'auto');
  assert.notEqual(restarted.pid, first.pid);
  await exec(process.execPath, [path.join(kimi, 'control.mjs'), 'stop'], { env });
});
