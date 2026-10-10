import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './fixture.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const capture = (cmd, args, env, input) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { env, cwd: os.tmpdir(), windowsHide: true, shell: cmd !== process.execPath });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('error', reject);
  child.on('exit', (code) => resolve({ code, stdout, stderr }));
  child.stdin.end(JSON.stringify(input));
});

async function scope(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-hooks-'));
  const plugin = path.join(dir, '中文 插件', 'viewer');
  await mkdir(path.dirname(plugin), { recursive: true });
  await cp(source, plugin, { recursive: true, filter: (file) => !file.includes(`${path.sep}test${path.sep}`) && !file.endsWith(`${path.sep}test`) });
  const port = await freePort();
  const env = { ...process.env, PLUGIN_ROOT: plugin, AGENT_KANBAN_PORT: String(port), AGENT_KANBAN_HOME: path.join(dir, 'data'), KIMI_CODE_HOME: path.join(dir, 'old') };
  t.after(async () => {
    try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch { /* absent */ }
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, plugin, port, env };
}

test('Codex manifest resources resolve and Windows command works under spaced Chinese path', async (t) => {
  const { plugin, env, dir } = await scope(t);
  const manifest = JSON.parse(await readFile(path.join(plugin, '.codex-plugin', 'plugin.json'), 'utf8'));
  const hooks = JSON.parse(await readFile(path.join(plugin, 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(manifest.name, 'kanban');
  for (const relative of [manifest.skills, manifest.hooks, './SYSTEM.md', './server/codex-hook.mjs'])
    assert.ok((await stat(path.resolve(plugin, relative))).isFile() || (await stat(path.resolve(plugin, relative))).isDirectory());
  const handler = hooks.hooks.SessionStart[0].hooks[0];
  const command = handler.command.replace('${PLUGIN_ROOT}', plugin.replace(/\\/g, '/'));
  const result = await capture(command, [], env, { cwd: path.join(dir, 'unrelated'), source: 'compact' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.deepEqual(await readdir(dir).then((items) => items.filter((item) => item === 'unrelated')), []);
});

for (const sourceType of ['startup', 'resume', 'compact']) {
  test(`SessionStart ${sourceType} emits exact shared convention and does not touch note`, async (t) => {
    const { plugin, env, dir } = await scope(t);
    const project = path.join(dir, 'project');
    await mkdir(path.join(project, 'kanban'), { recursive: true });
    const note = path.join(project, 'kanban', 'note.md');
    await writeFile(note, '人类私有便签');
    const before = await readFile(note, 'utf8');
    const script = path.join(plugin, 'server', 'codex-hook.mjs');
    const result = await capture(process.execPath, [script, 'start'], env, { hook_event_name: 'SessionStart', source: sourceType, cwd: project });
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.additionalContext, await readFile(path.join(plugin, 'SYSTEM.md'), 'utf8'));
    assert.equal(await readFile(note, 'utf8'), before);
    assert.ok(!result.stdout.includes(before));
  });
}

test('port conflict still emits convention and diagnoses only on stderr', async (t) => {
  const { plugin, env, dir, port } = await scope(t);
  const foreign = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"name":"other"}'); });
  await new Promise((resolve) => foreign.listen(port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  const result = await capture(process.execPath, [path.join(plugin, 'server', 'codex-hook.mjs'), 'start'], env, { source: 'startup', cwd: path.join(dir, 'absent') });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /端口.*其他程序/);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, await readFile(path.join(plugin, 'SYSTEM.md'), 'utf8'));
  assert.deepEqual(await readdir(dir).then((items) => items.filter((item) => item === 'absent')), []);
});

test('Claude hooks config declares three events with plugin-root script references', async (t) => {
  const { plugin } = await scope(t);
  const manifest = JSON.parse(await readFile(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'));
  const config = JSON.parse(await readFile(path.join(plugin, 'hooks', 'claude-hooks.json'), 'utf8'));
  assert.equal(manifest.name, 'kanban');
  assert.equal(manifest.hooks, './hooks/claude-hooks.json');
  assert.deepEqual(Object.keys(config.hooks).sort(), ['PostToolUse', 'SessionStart', 'UserPromptSubmit']);
  const handlers = Object.values(config.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
  for (const handler of handlers) {
    assert.equal(handler.command, 'node');
    assert.ok(handler.args[0].startsWith('${CLAUDE_PLUGIN_ROOT}/'));
    assert.ok(!JSON.stringify(handler).includes('${PLUGIN_ROOT}'));
    assert.ok((await stat(path.join(plugin, handler.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', '')))).isFile());
  }
  assert.equal(config.hooks.SessionStart[0].matcher, undefined);
  assert.equal(config.hooks.UserPromptSubmit[0].hooks[0].async, true);
  assert.equal(config.hooks.PostToolUse[0].hooks[0].async, true);
});

for (const sourceType of ['clear', 'compact', 'fork']) {
  test(`Claude SessionStart ${sourceType} emits convention without ensuring the service`, async (t) => {
    const { plugin, env, dir, port } = await scope(t);
    const project = path.join(dir, 'project');
    await mkdir(project, { recursive: true });
    const script = path.join(plugin, 'server', 'codex-hook.mjs');
    const result = await capture(process.execPath, [script, 'start'], env, { hook_event_name: 'SessionStart', source: sourceType, cwd: project });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, await readFile(path.join(plugin, 'SYSTEM.md'), 'utf8'));
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }));
    assert.deepEqual(await readdir(project), []);
  });
}

test('Claude PostToolUse running control status is skipped as control activity', async (t) => {
  const { plugin, env, dir, port } = await scope(t);
  const project = path.join(dir, 'project');
  await mkdir(project, { recursive: true });
  const script = path.join(plugin, 'server', 'codex-hook.mjs');
  const control = { hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: project, tool_input: { command: `node "${path.join(plugin, 'server', 'control.mjs')}" status` } };
  const result = await capture(process.execPath, [script, 'activity'], env, control);
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }));
  assert.deepEqual(await readdir(project), []);
  const { isDiagnosticOrControl } = await import(new URL('../server/activity.mjs', import.meta.url));
  assert.equal(isDiagnosticOrControl(control), true);
  assert.equal(isDiagnosticOrControl({ hook_event_name: 'PostToolUse', tool_input: { command: 'npm test --prefix viewer' } }), false);
});
