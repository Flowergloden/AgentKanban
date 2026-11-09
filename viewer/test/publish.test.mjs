import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { currentVersion, nextPatch, parseVersion, publish, rewriteVersion } from '../../scripts/publish.mjs';

const exec = promisify(execFile);
const versionFiles = ['kimi.plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'service.json'];

async function sandbox(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-publish-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function git(repo, args) {
  const { stdout } = await exec('git', ['-c', 'commit.gpgsign=false', '-C', repo, ...args]);
  return stdout.trim();
}

async function fixtureRepo(t, { version = '0.2.17' } = {}) {
  const repo = await sandbox(t);
  for (const rel of versionFiles) {
    await mkdir(path.dirname(path.join(repo, 'viewer', rel)), { recursive: true });
    await writeFile(path.join(repo, 'viewer', rel), `${JSON.stringify({ name: 'kanban', version }, null, 2)}\n`);
  }
  await mkdir(path.join(repo, 'viewer', 'test'), { recursive: true });
  await writeFile(path.join(repo, 'viewer', 'test', 'sample.test.mjs'),
    `// 当前版本样例 '${version}'，历史固定样例 0.2.3 与 0.2.4 不应被改写\n`);
  await writeFile(path.join(repo, 'notes.md'), '无关的已跟踪文件\n');
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.name', 'publish-test']);
  await git(repo, ['config', 'user.email', 'publish-test@example.com']);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'init']);
  const remote = path.join(await sandbox(t), 'remote.git');
  await exec('git', ['init', '-q', '--bare', remote]);
  await git(repo, ['remote', 'add', 'origin', remote]);
  return { repo, remote };
}

test('parseVersion 接受 X.Y.Z 与 vX.Y.Z，拒绝其他格式', () => {
  assert.equal(parseVersion('1.2.3'), '1.2.3');
  assert.equal(parseVersion('v0.2.17'), '0.2.17');
  assert.equal(parseVersion(' v1.2.3 '), '1.2.3');
  for (const bad of ['1.2', '1.2.3.4', 'vx.y.z', '', undefined, null])
    assert.throws(() => parseVersion(bad), /无效版本号/);
});

test('nextPatch 递增小版本号', () => {
  assert.equal(nextPatch('0.2.17'), '0.2.17');
  assert.equal(nextPatch('v1.9.9'), '1.9.10');
});

test('rewriteVersion 更新四份清单与测试样例，保留其他版本字面量', async (t) => {
  const { repo } = await fixtureRepo(t);
  assert.equal(await currentVersion(repo), '0.2.17');
  const changed = await rewriteVersion(repo, '0.2.17', '0.2.17');
  assert.deepEqual(changed.sort(), [...versionFiles.map((rel) => `viewer/${rel}`), 'viewer/test/sample.test.mjs'].sort());
  assert.equal(await currentVersion(repo), '0.2.17');
  const sample = await readFile(path.join(repo, 'viewer', 'test', 'sample.test.mjs'), 'utf8');
  assert.ok(sample.includes(`'0.2.17'`));
  assert.ok(sample.includes('0.2.3') && sample.includes('0.2.4'));
});

test('currentVersion 在清单版本不一致时报错', async (t) => {
  const { repo } = await fixtureRepo(t);
  await writeFile(path.join(repo, 'viewer', 'service.json'), `${JSON.stringify({ version: '0.2.99' })}\n`);
  await assert.rejects(currentVersion(repo), /版本清单不一致/);
});

test('干净工作区: 留空版本号自动小版本号+1，提交、注解 tag 并推送', async (t) => {
  const { repo, remote } = await fixtureRepo(t);
  let asked = false;
  const result = await publish({ repo, version: undefined, confirm: async () => { asked = true; return true; } });
  assert.deepEqual({ from: result.from, to: result.to, dirty: result.dirty }, { from: '0.2.17', to: '0.2.17', dirty: 0 });
  assert.equal(asked, false);
  assert.equal(await git(repo, ['tag', '-l']), 'v0.2.17');
  assert.match(await git(repo, ['tag', '-l', 'v0.2.17', '--format=%(contents)']), /版本号更新至 0\.2\.16/);
  assert.match(await git(repo, ['log', '-1', '--format=%s']), /版本号更新至 0\.2\.16/);
  assert.ok((await readFile(path.join(repo, 'viewer', 'service.json'), 'utf8')).includes('"version": "0.2.17"'));
  assert.ok((await readFile(path.join(repo, 'viewer', 'test', 'sample.test.mjs'), 'utf8')).includes(`'0.2.17'`));
  assert.ok((await exec('git', ['-C', remote, 'tag'])).stdout.includes('v0.2.17'));
  const branch = await git(repo, ['branch', '--show-current']);
  assert.ok((await exec('git', ['-C', remote, 'branch', '--list', branch])).stdout.includes(branch));
});

test('tag 已存在时中止', async (t) => {
  const { repo } = await fixtureRepo(t);
  await git(repo, ['tag', '-a', 'v0.2.17', '-m', 'occupied']);
  await assert.rejects(publish({ repo, version: '0.2.17', confirm: async () => true }), /tag v0\.2\.17 已存在/);
  assert.equal(await currentVersion(repo), '0.2.17');
});

test('有未提交更改且拒绝确认时中止，不留发版痕迹', async (t) => {
  const { repo } = await fixtureRepo(t);
  await writeFile(path.join(repo, 'wip.md'), '未提交的草稿\n');
  let asked = false;
  await assert.rejects(
    publish({ repo, version: undefined, confirm: async () => { asked = true; return false; } }),
    /已取消/);
  assert.equal(asked, true);
  assert.equal(await git(repo, ['tag', '-l']), '');
  assert.equal(await currentVersion(repo), '0.2.17');
});

test('有未提交更改且确认时只提交版本文件，其余更改保持未提交', async (t) => {
  const { repo } = await fixtureRepo(t);
  await writeFile(path.join(repo, 'notes.md'), '无关的改动\n');
  const result = await publish({ repo, version: undefined, confirm: async () => true });
  assert.equal(result.dirty, 1);
  const status = await git(repo, ['status', '--porcelain']);
  assert.ok(status.includes('notes.md'));
  for (const rel of versionFiles) assert.ok(!status.includes(rel));
  const committed = (await git(repo, ['show', '--name-only', '--format=', 'HEAD'])).split('\n').filter(Boolean);
  assert.ok(committed.length > 0);
  for (const file of committed) assert.ok(file.startsWith('viewer/'), file);
  assert.ok(!committed.includes('notes.md'));
});
