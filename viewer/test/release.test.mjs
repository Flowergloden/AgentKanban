import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesFor, stageRelease, verifyPackage } from '../../scripts/release.mjs';

const exec = promisify(execFile);
const viewer = fileURLToPath(new URL('..', import.meta.url));
// 需 zip 能力：Windows 自带 bsdtar（System32\tar.exe）支持 zip；Git Bash 的 GNU tar 不支持且会抢占 PATH
const tarBin = process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32', 'tar.exe') : 'tar.exe';
async function sandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-dist-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function listTree(root, prefix = '') {
  const found = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await listTree(root, relative));
    else found.push(relative);
  }
  return found.sort();
}

async function archiveAndUnpack(stage, dir, host) {
  const zip = path.join(dir, { kimi: 'kanban-plugin.zip', codex: 'kanban-codex-plugin.zip', claude: 'kanban-claude-plugin.zip' }[host]);
  // 相对归档名 + cwd：避免 GNU tar 把 "C:\..." 中的盘符冒号误判为远程主机（--force-local 不被 bsdtar 支持）
  await exec(tarBin, ['-a', '-c', '-f', path.basename(zip), '-C', path.join(stage, host), '.'], { cwd: dir });
  assert.equal((await readFile(zip)).subarray(0, 2).toString(), 'PK');
  const dest = path.join(dir, 'unpacked', host);
  await mkdir(dest, { recursive: true });
  await exec(tarBin, ['-xf', zip, '-C', dest]);
  return dest;
}

test('all three release archives unpack with exact runtime resources and no development data', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.9');
  for (const host of ['kimi', 'codex', 'claude']) {
    const extracted = await archiveAndUnpack(stage, dir, host);
    const result = await verifyPackage(extracted, host, 'v0.2.9');
    assert.equal(result.version, '0.2.9');
    assert.deepEqual(await listTree(extracted), [...filesFor(host)].sort());
    const expected = { kimi: 'kimi.plugin.json', codex: '.codex-plugin/plugin.json', claude: '.claude-plugin/plugin.json' }[host];
    assert.ok((await readFile(path.join(extracted, expected))).length > 0);
    for (const forbidden of ['kanban', 'openspec', '.agents', 'test'])
      await assert.rejects(readFile(path.join(extracted, forbidden, 'README.md')));
  }
});

for (const manifest of ['kimi.plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'service.json']) {
  test(`release fails before stage when ${manifest} version differs from tag`, async (t) => {
    const dir = await sandbox(t);
    const source = path.join(dir, 'viewer');
    await cp(viewer, source, { recursive: true });
    const file = path.join(source, manifest);
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.version = '9.9.9';
    await writeFile(file, JSON.stringify(data));
    const stage = path.join(dir, 'stage');
    await assert.rejects(stageRelease(source, stage, 'v0.2.9'), /version mismatch/);
    await assert.rejects(readFile(path.join(stage, 'kimi', 'service.json')));
  });
}

test('missing hooks, entry resources or hidden Codex manifest fail upload verification', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.9');
  const extracted = await archiveAndUnpack(stage, dir, 'codex');
  const manifest = path.join(extracted, '.codex-plugin', 'plugin.json');
  await unlink(manifest);
  await assert.rejects(verifyPackage(extracted, 'codex', 'v0.2.9'), /missing=.*\.codex-plugin\/plugin.json/);
  await cp(path.join(stage, 'codex', '.codex-plugin', 'plugin.json'), manifest);
  await unlink(path.join(extracted, 'server', 'codex-hook.mjs'));
  await assert.rejects(verifyPackage(extracted, 'codex', 'v0.2.9'), /missing=.*codex-hook.mjs/);
});

test('packaged plugin reference mismatch and extra development file are rejected', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.9');
  const root = path.join(stage, 'codex');
  const hookFile = path.join(root, 'hooks', 'hooks.json');
  const hooks = JSON.parse(await readFile(hookFile, 'utf8'));
  hooks.hooks.SessionStart[0].hooks[0].command = 'node "${PLUGIN_ROOT}/server/missing.mjs" start';
  await writeFile(hookFile, JSON.stringify(hooks));
  await assert.rejects(verifyPackage(root, 'codex', 'v0.2.9'), /missing Codex hook script/);
  await cp(path.join(viewer, 'hooks', 'hooks.json'), hookFile);
  await writeFile(path.join(root, 'test-data.txt'), 'should not ship');
  await assert.rejects(verifyPackage(root, 'codex', 'v0.2.9'), /extra=test-data.txt/);
});

test('Claude missing manifest, missing hook script or mixed Codex hooks fail verification', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.9');
  const extracted = await archiveAndUnpack(stage, dir, 'claude');
  const manifest = path.join(extracted, '.claude-plugin', 'plugin.json');
  await unlink(manifest);
  await assert.rejects(verifyPackage(extracted, 'claude', 'v0.2.9'), /missing=.*\.claude-plugin\/plugin.json/);
  await cp(path.join(stage, 'claude', '.claude-plugin', 'plugin.json'), manifest);
  await unlink(path.join(extracted, 'server', 'codex-hook.mjs'));
  await assert.rejects(verifyPackage(extracted, 'claude', 'v0.2.9'), /missing=.*codex-hook.mjs/);
  await cp(path.join(stage, 'claude', 'server', 'codex-hook.mjs'), path.join(extracted, 'server', 'codex-hook.mjs'));
  const hooksFile = path.join(extracted, 'hooks', 'claude-hooks.json');
  const hooks = JSON.parse(await readFile(hooksFile, 'utf8'));
  hooks.hooks.SessionStart[0].hooks[0].args[0] = '${CLAUDE_PLUGIN_ROOT}/server/missing.mjs';
  await writeFile(hooksFile, JSON.stringify(hooks));
  await assert.rejects(verifyPackage(extracted, 'claude', 'v0.2.9'), /missing Claude hook script/);
  await cp(path.join(viewer, 'hooks', 'claude-hooks.json'), hooksFile);
  await writeFile(path.join(extracted, 'hooks', 'hooks.json'), '{}');
  await assert.rejects(verifyPackage(extracted, 'claude', 'v0.2.9'), /extra=.*hooks\/hooks.json/);
});

test('convention longer than the Claude injection limit fails release staging', async (t) => {
  const dir = await sandbox(t);
  const source = path.join(dir, 'viewer');
  await cp(viewer, source, { recursive: true });
  await writeFile(path.join(source, 'SYSTEM.md'), 'a'.repeat(10_001));
  await assert.rejects(stageRelease(source, path.join(dir, 'stage'), 'v0.2.9'), /exceeds 10000 characters/);
});

test('root marketplace points archive source at the pipeline Claude artifact over https', async () => {
  const repoRoot = path.join(viewer, '..');
  const marketplace = JSON.parse(await readFile(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(marketplace.name, 'agent-kanban');
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'kanban');
  assert.equal(entry.source.source, 'archive');
  assert.ok(!('version' in entry));
  const url = new URL(entry.source.url);
  assert.equal(url.protocol, 'https:');
  const artifact = path.posix.basename(url.pathname);
  assert.equal(artifact, 'kanban-claude-plugin.zip');
  assert.match(await readFile(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8'), new RegExp(artifact.replace(/[.]/g, '\.')));
});
