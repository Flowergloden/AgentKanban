import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageRelease, verifyPackage } from '../../scripts/release.mjs';

const exec = promisify(execFile);
const viewer = fileURLToPath(new URL('..', import.meta.url));
// 需 zip 能力：Windows 自带 bsdtar（System32\tar.exe）支持 zip；Git Bash 的 GNU tar 不支持且会抢占 PATH
const tarBin = process.env.SYSTEMROOT ? path.join(process.env.SYSTEMROOT, 'System32', 'tar.exe') : 'tar.exe';
async function sandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-dist-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function archiveAndUnpack(stage, dir, host) {
  const zip = path.join(dir, host === 'kimi' ? 'kanban-plugin.zip' : 'kanban-codex-plugin.zip');
  // 相对归档名 + cwd：避免 GNU tar 把 "C:\..." 中的盘符冒号误判为远程主机（--force-local 不被 bsdtar 支持）
  await exec(tarBin, ['-a', '-c', '-f', path.basename(zip), '-C', path.join(stage, host), '.'], { cwd: dir });
  assert.equal((await readFile(zip)).subarray(0, 2).toString(), 'PK');
  const dest = path.join(dir, 'unpacked', host);
  await mkdir(dest, { recursive: true });
  await exec(tarBin, ['-xf', zip, '-C', dest]);
  return dest;
}

test('both release archives unpack with exact runtime resources and no development data', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.7');
  for (const host of ['kimi', 'codex']) {
    const extracted = await archiveAndUnpack(stage, dir, host);
    const result = await verifyPackage(extracted, host, 'v0.2.7');
    assert.equal(result.version, '0.2.7');
    const expected = host === 'kimi' ? 'kimi.plugin.json' : '.codex-plugin/plugin.json';
    assert.ok((await readFile(path.join(extracted, expected))).length > 0);
    for (const forbidden of ['kanban', 'openspec', '.agents', 'test'])
      await assert.rejects(readFile(path.join(extracted, forbidden, 'README.md')));
  }
});

for (const manifest of ['kimi.plugin.json', '.codex-plugin/plugin.json', 'service.json']) {
  test(`release fails before stage when ${manifest} version differs from tag`, async (t) => {
    const dir = await sandbox(t);
    const source = path.join(dir, 'viewer');
    await cp(viewer, source, { recursive: true });
    const file = path.join(source, manifest);
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.version = '9.9.9';
    await writeFile(file, JSON.stringify(data));
    const stage = path.join(dir, 'stage');
    await assert.rejects(stageRelease(source, stage, 'v0.2.7'), /version mismatch/);
    await assert.rejects(readFile(path.join(stage, 'kimi', 'service.json')));
  });
}

test('missing hooks, entry resources or hidden Codex manifest fail upload verification', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.7');
  const extracted = await archiveAndUnpack(stage, dir, 'codex');
  const manifest = path.join(extracted, '.codex-plugin', 'plugin.json');
  await unlink(manifest);
  await assert.rejects(verifyPackage(extracted, 'codex', 'v0.2.7'), /missing=.*\.codex-plugin\/plugin.json/);
  await cp(path.join(stage, 'codex', '.codex-plugin', 'plugin.json'), manifest);
  await unlink(path.join(extracted, 'server', 'codex-hook.mjs'));
  await assert.rejects(verifyPackage(extracted, 'codex', 'v0.2.7'), /missing=.*codex-hook.mjs/);
});

test('packaged plugin reference mismatch and extra development file are rejected', async (t) => {
  const dir = await sandbox(t);
  const stage = path.join(dir, 'stage');
  await stageRelease(viewer, stage, 'v0.2.7');
  const root = path.join(stage, 'codex');
  const hookFile = path.join(root, 'hooks', 'hooks.json');
  const hooks = JSON.parse(await readFile(hookFile, 'utf8'));
  hooks.hooks.SessionStart[0].hooks[0].command = 'node "${PLUGIN_ROOT}/server/missing.mjs" start';
  await writeFile(hookFile, JSON.stringify(hooks));
  await assert.rejects(verifyPackage(root, 'codex', 'v0.2.7'), /missing Codex hook script/);
  await cp(path.join(viewer, 'hooks', 'hooks.json'), hookFile);
  await writeFile(path.join(root, 'test-data.txt'), 'should not ship');
  await assert.rejects(verifyPackage(root, 'codex', 'v0.2.7'), /extra=test-data.txt/);
});
