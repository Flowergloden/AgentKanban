import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registryPaths, loadRegistry, saveRegistry } from '../server/registry.mjs';

async function sandbox(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'kanban-registry-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = registryPaths({ KIMI_CODE_HOME: path.join(home, 'kimi'), AGENT_KANBAN_HOME: path.join(home, 'shared') }, home);
  await mkdir(path.dirname(paths.legacyFile), { recursive: true });
  return { home, paths };
}

test('data dir override and KIMI_CODE_HOME legacy import normalize/dedupe without changing source', async (t) => {
  const { home, paths } = await sandbox(t);
  assert.equal(paths.dataDir, path.join(home, 'shared'));
  const legacy = JSON.stringify({ projects: { 'C:\\中文\\folder': 3, 'C:/中文/folder': 9, 'D:\\another': 5 } });
  await writeFile(paths.legacyFile, legacy);
  const projects = await loadRegistry(paths);
  assert.deepEqual(Object.fromEntries(projects), { 'C:/中文/folder': { lastSeen: 9 }, 'D:/another': { lastSeen: 5 } });
  assert.equal(await readFile(paths.legacyFile, 'utf8'), legacy);
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), Object.fromEntries(projects));
});

test('project entry carries optional vcs field and legacy numeric values upgrade on load', async (t) => {
  const { paths } = await sandbox(t);
  await mkdir(path.dirname(paths.registryFile), { recursive: true });
  await writeFile(paths.registryFile, JSON.stringify({
    projects: {
      'C:/legacy': 7,
      'C:/p4-proj': { lastSeen: 11, vcs: { type: 'p4', checkedAt: 111 } },
      'C:/plain-proj': { lastSeen: 12, vcs: { type: null, checkedAt: 222 } },
      'C:/bad-vcs': { lastSeen: 13, vcs: { type: 'git', checkedAt: 333 } },
    },
  }));
  const projects = await loadRegistry(paths);
  assert.deepEqual(Object.fromEntries(projects), {
    'C:/legacy': { lastSeen: 7 },
    'C:/p4-proj': { lastSeen: 11, vcs: { type: 'p4', checkedAt: 111 } },
    'C:/plain-proj': { lastSeen: 12, vcs: { type: null, checkedAt: 222 } },
    'C:/bad-vcs': { lastSeen: 13 },
  });
  // 旧数字值升级为对象形状并落盘
  const stored = JSON.parse(await readFile(paths.registryFile, 'utf8')).projects;
  assert.deepEqual(stored['C:/legacy'], { lastSeen: 7 });
  assert.deepEqual(stored['C:/p4-proj'].vcs, { type: 'p4', checkedAt: 111 });
  assert.equal(stored['C:/bad-vcs'].vcs, undefined);
});

test('saveRegistry round-trips vcs-bearing entries', async (t) => {
  const { paths } = await sandbox(t);
  const entries = new Map([
    ['C:/proj', { lastSeen: 42, vcs: { type: 'p4', checkedAt: 99 } }],
    ['C:/other', { lastSeen: 43 }],
  ]);
  await saveRegistry(paths.registryFile, entries);
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), Object.fromEntries(entries));
});

test('existing new registry takes precedence and normalizes duplicates', async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(paths.legacyFile, JSON.stringify({ projects: { old: 10 } }));
  await saveRegistry(paths.registryFile, new Map([['new', { lastSeen: 42 }]]));
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), { new: { lastSeen: 42 } });
  await writeFile(paths.registryFile, JSON.stringify({ projects: { 'C:\\x': 1, 'C:/x': 4 } }));
  assert.deepEqual(Object.fromEntries(await loadRegistry(paths)), { 'C:/x': { lastSeen: 4 } });
  assert.deepEqual(JSON.parse(await readFile(paths.registryFile, 'utf8')).projects, { 'C:/x': { lastSeen: 4 } });
});

test('corrupt legacy data is reported and retained', async (t) => {
  const { paths } = await sandbox(t);
  await writeFile(paths.legacyFile, '{broken');
  await assert.rejects(loadRegistry(paths), /注册表损坏/);
  assert.equal(await readFile(paths.legacyFile, 'utf8'), '{broken');
});

test('atomic write failure retains existing valid registry and source', async (t) => {
  const { paths } = await sandbox(t);
  const original = new Map([['original', 123]]);
  await saveRegistry(paths.registryFile, original);
  const saved = await readFile(paths.registryFile, 'utf8');
  const io = {
    mkdir: async () => {},
    writeFile: async () => {},
    rename: async () => { throw new Error('injected rename failure'); },
    unlink: async () => {},
  };
  await assert.rejects(saveRegistry(paths.registryFile, new Map([['replacement', 456]]), io), /写入失败/);
  assert.equal(await readFile(paths.registryFile, 'utf8'), saved);
  await writeFile(paths.legacyFile, saved);
  const noNew = { ...paths, registryFile: path.join(paths.dataDir, 'missing.json') };
  await assert.rejects(loadRegistry(noNew, { ...io, readFile: async (file) => {
    if (file === noNew.registryFile) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; }
    return readFile(file, 'utf8');
  } }), /写入失败/);
  assert.equal(await readFile(paths.legacyFile, 'utf8'), saved);
});
