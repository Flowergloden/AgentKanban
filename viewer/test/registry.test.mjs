import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registryPaths, loadRegistry, saveRegistry, canonicalRoot, DEFAULT_STATE } from '../server/registry.mjs';

async function sandbox(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'kanban-registry-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = registryPaths({ KIMI_CODE_HOME: path.join(home, 'kimi'), AGENT_KANBAN_HOME: path.join(home, 'shared') }, home);
  await mkdir(path.dirname(paths.legacyFile), { recursive: true });
  return { home, paths };
}

test('canonicalRoot 统一分隔符、尾斜杠、. 片段、大小写与中文空格路径，并拒绝相对路径', () => {
  const a = canonicalRoot('C:\\中文 目录\\Project');
  const b = canonicalRoot('c:/中文 目录/./Project/');
  const c = canonicalRoot('C:\\中文 目录\\sub\\..\\Project');
  assert.equal(typeof a, 'string');
  assert.equal(a, b);
  assert.equal(a, c);
  assert.match(a, /\/中文 目录\/project$/);
  assert.equal(canonicalRoot('C:\\'), canonicalRoot('c:/'));
  assert.equal(canonicalRoot('rel\\proj'), null);
  assert.equal(canonicalRoot(''), null);
  assert.equal(canonicalRoot(5), null);
});

test('legacy numeric import upgrades to registered with canonical keys; source untouched', async (t) => {
  const { home, paths } = await sandbox(t);
  assert.equal(paths.dataDir, path.join(home, 'shared'));
  const legacy = JSON.stringify({ projects: { 'C:\\中文\\folder': 3, 'C:/中文/folder': 9, 'D:\\another': 5 } });
  await writeFile(paths.legacyFile, legacy);
  const projects = await loadRegistry(paths);
  assert.deepEqual(Object.fromEntries(projects), {
    [canonicalRoot('C:/中文/folder')]: { lastSeen: 9, state: 'registered' },
    [canonicalRoot('D:/another')]: { lastSeen: 5, state: 'registered' },
  });
  assert.equal(await readFile(paths.legacyFile, 'utf8'), legacy);
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), Object.fromEntries(projects));
});

test('stateless objects, numeric entries and invalid states upgrade to registered on load', async (t) => {
  const { paths } = await sandbox(t);
  await mkdir(path.dirname(paths.registryFile), { recursive: true });
  await writeFile(paths.registryFile, JSON.stringify({
    projects: {
      'C:/legacy': 7,
      'C:/stateless': { lastSeen: 8 },
      'C:/bad-state': { lastSeen: 9, state: 'weird' },
      'C:/p4-proj': { lastSeen: 11, state: 'ignored', vcs: { type: 'p4', checkedAt: 111 } },
      'C:/plain-proj': { lastSeen: 12, state: 'pending', vcs: { type: null, checkedAt: 222 } },
      'C:/bad-vcs': { lastSeen: 13, state: 'registered', vcs: { type: 'git', checkedAt: 333 } },
    },
  }));
  const projects = await loadRegistry(paths);
  const expected = {
    [canonicalRoot('C:/legacy')]: { lastSeen: 7, state: 'registered' },
    [canonicalRoot('C:/stateless')]: { lastSeen: 8, state: 'registered' },
    [canonicalRoot('C:/bad-state')]: { lastSeen: 9, state: 'registered' },
    [canonicalRoot('C:/p4-proj')]: { lastSeen: 11, state: 'ignored', vcs: { type: 'p4', checkedAt: 111 } },
    [canonicalRoot('C:/plain-proj')]: { lastSeen: 12, state: 'pending', vcs: { type: null, checkedAt: 222 } },
    [canonicalRoot('C:/bad-vcs')]: { lastSeen: 13, state: 'registered' },
  };
  assert.deepEqual(Object.fromEntries(projects), expected);
  // 缺失状态与非法状态补齐为 registered 并原子落盘，既有合法状态原样保留
  const stored = JSON.parse(await readFile(paths.registryFile, 'utf8')).projects;
  assert.deepEqual(stored[canonicalRoot('C:/legacy')], { lastSeen: 7, state: 'registered' });
  assert.deepEqual(stored[canonicalRoot('C:/bad-state')], { lastSeen: 9, state: 'registered' });
  assert.deepEqual(stored[canonicalRoot('C:/p4-proj')].vcs, { type: 'p4', checkedAt: 111 });
  assert.equal(stored[canonicalRoot('C:/bad-vcs')].vcs, undefined);
  assert.equal(DEFAULT_STATE, 'registered');
});

test('tri-state round-trip: pending/registered/ignored survive save/load like a service restart', async (t) => {
  const { paths } = await sandbox(t);
  const entries = new Map([
    [canonicalRoot('C:/pending-proj'), { lastSeen: 42, state: 'pending' }],
    [canonicalRoot('C:/registered-proj'), { lastSeen: 43, state: 'registered', vcs: { type: 'p4', checkedAt: 99 } }],
    [canonicalRoot('C:/ignored-proj'), { lastSeen: 44, state: 'ignored' }],
  ]);
  await saveRegistry(paths.registryFile, entries);
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), Object.fromEntries(entries));
  // 再次加载（模拟重启后重复读取）状态仍完整，且不再触发写回
  const stored = await readFile(paths.registryFile, 'utf8');
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), Object.fromEntries(entries));
  assert.equal(await readFile(paths.registryFile, 'utf8'), stored);
});

test('alias duplicates merge to one canonical entry and write back without duplicates', async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(paths.legacyFile, JSON.stringify({ projects: { old: 10 } }));
  await saveRegistry(paths.registryFile, new Map([[canonicalRoot('C:/x'), { lastSeen: 42, state: 'registered' }]]));
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), { [canonicalRoot('C:/x')]: { lastSeen: 42, state: 'registered' } });
  // 大小写、尾斜杠、分隔符混合的同一目录：归一化为一条，lastSeen 取较新者
  await writeFile(paths.registryFile, JSON.stringify({ projects: { 'C:\\x': 1, 'C:/X/': 4 } }));
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), { [canonicalRoot('C:/x')]: { lastSeen: 4, state: 'registered' } });
  assert.deepEqual(JSON.parse(await readFile(paths.registryFile, 'utf8')).projects, { [canonicalRoot('C:/x')]: { lastSeen: 4, state: 'registered' } });
});

test('legacy relative paths are compat-read without absolutization', async (t) => {
  const { paths } = await sandbox(t);
  await mkdir(path.dirname(paths.registryFile), { recursive: true });
  await writeFile(paths.registryFile, JSON.stringify({ projects: { 'rel\\proj': 5, 'plain/relative': { lastSeen: 6 } } }));
  const projects = await loadRegistry(paths);
  assert.deepEqual(Object.fromEntries(projects), {
    'rel/proj': { lastSeen: 5, state: 'registered' },
    'plain/relative': { lastSeen: 6, state: 'registered' },
  });
});

test('corrupt legacy data is reported and retained', async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(paths.legacyFile, '{broken');
  await assert.rejects(loadRegistry(paths), /注册表损坏/);
  assert.equal(await readFile(paths.legacyFile, 'utf8'), '{broken');
});

test('atomic write failure retains existing valid registry and source', async (t) => {
  const { paths } = await sandbox(t);
  const original = new Map([['original', { lastSeen: 123, state: 'registered' }]]);
  await saveRegistry(paths.registryFile, original);
  const saved = await readFile(paths.registryFile, 'utf8');
  const io = {
    mkdir: async () => {},
    writeFile: async () => {},
    rename: async () => { throw new Error('injected rename failure'); },
    unlink: async () => {},
  };
  await assert.rejects(saveRegistry(paths.registryFile, new Map([['replacement', { lastSeen: 456, state: 'pending' }]]), io), /写入失败/);
  assert.equal(await readFile(paths.registryFile, 'utf8'), saved);
  await writeFile(paths.legacyFile, saved);
  const noNew = { ...paths, registryFile: path.join(paths.dataDir, 'missing.json') };
  await assert.rejects(loadRegistry(noNew, { ...io, readFile: async (file) => {
    if (file === noNew.registryFile) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
    return readFile(file, 'utf8');
  } }), /写入失败/);
  assert.equal(await readFile(paths.legacyFile, 'utf8'), saved);
});
