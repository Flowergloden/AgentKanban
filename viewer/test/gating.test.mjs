import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as threads from '../server/threads.mjs';
import { canonicalRoot } from '../server/registry.mjs';
import { withServer } from './fixture.mjs';
import { useShim, shimLog } from './shim.mjs';

const json = (method, value) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

async function tempRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-gate-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('pending/ignored/unregistered roots are rejected from kanban writes with fs untouched', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const pendingRoot = path.join(dir, 'pending proj');
    const ignoredRoot = path.join(dir, 'ignored proj');
    await mkdir(pendingRoot, { recursive: true });
    await mkdir(ignoredRoot, { recursive: true });
    const neverRoot = path.join(dir, 'never registered');
    await fetch(url + '/api/register', json('POST', { root: pendingRoot }));
    await fetch(url + '/api/register', json('POST', { root: ignoredRoot }));
    await fetch(url + '/api/projects/ignore', json('POST', { root: ignoredRoot }));

    const writeAttempts = (root) => [
      fetch(url + '/api/init', json('POST', { root })),
      fetch(url + '/api/threads', json('POST', { root, title: 'x' })),
      fetch(url + '/api/note', json('PUT', { root, content: 'x', fingerprint: threads.fingerprint('') })),
      fetch(url + '/api/active-thread', json('POST', { root, id: null })),
      fetch(url + '/api/vcs/add', json('POST', { root, files: ['kanban/x.txt'] })),
      fetch(`${url}/api/threads/0001-x/rename`, json('POST', { root, slug: 'y' })),
      fetch(url + '/api/thread', json('DELETE', { root, id: '0001-x' })),
    ];
    for (const root of [pendingRoot, ignoredRoot, neverRoot]) {
      const responses = await Promise.all(writeAttempts(root));
      for (const res of responses) {
        assert.equal(res.status, 403, `${root} -> ${res.status}`);
        assert.match((await res.json()).error, /待确认|已忽略|未登记/);
      }
      // 文件系统零变化：不得创建 kanban/ 结构
      await assert.rejects(access(path.join(root, 'kanban')), /ENOENT/);
    }
    // 注册表内容未被写接口改变
    const projects = await (await fetch(url + '/api/projects')).json();
    assert.deepEqual(projects.map((p) => [p.root, p.state]).sort(), [
      [canonicalRoot(ignoredRoot), 'ignored'],
      [canonicalRoot(pendingRoot), 'pending'],
    ]);
  });
});

test('registered root keeps idempotent init and write ops auto-ensure missing layout', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = path.join(dir, 'registered proj');
    await mkdir(root, { recursive: true });
    await fetch(url + '/api/register', json('POST', { root }));
    await fetch(url + '/api/projects/confirm', json('POST', { root }));
    const post = (p, body) => fetch(url + p, json('POST', body));

    // 首次 init 创建完整最小结构，重复 init 幂等返回空
    const first = await (await post('/api/init', { root })).json();
    for (const rel of ['kanban', 'kanban/threads', 'kanban/templates', 'kanban/templates/thread.md', 'kanban/current', 'kanban/note.md'])
      assert.ok(first.created.includes(rel), rel);
    const again = await (await post('/api/init', { root })).json();
    assert.deepEqual(again.created, []);
    // 非空 kanban/current 不被覆盖
    await writeFile(path.join(root, 'kanban', 'current'), '0001-demo');
    const third = await (await post('/api/init', { root })).json();
    assert.deepEqual(third.created, []);
    assert.equal((await readFile(path.join(root, 'kanban', 'current'), 'utf8')).trim(), '0001-demo');

    // 删除 kanban/ 后写操作自动补齐结构并完成
    await rm(path.join(root, 'kanban'), { recursive: true, force: true });
    const created = await (await post('/api/threads', { root, title: '自动补齐', slug: 'auto-ensure' })).json();
    assert.equal(created.id, '0001-auto-ensure');
    assert.ok(created.created.includes('kanban/templates/thread.md'));
    assert.equal((await post('/api/active-thread', { root, id: created.id })).status, 200);
    const note = await (await fetch(url + `/api/note?root=${encodeURIComponent(canonicalRoot(root))}`)).json();
    const saved = await fetch(url + '/api/note', json('PUT', { root, content: '便签内容', fingerprint: note.fingerprint }));
    assert.equal(saved.status, 200);
    assert.match(await readFile(path.join(root, 'kanban', 'note.md'), 'utf8'), /便签内容/);
  });
});

test('p4 detect is gated: pending/ignored zero calls; confirm detects and caches; registered load refreshes; write path edit', async (t) => {
  const root = await tempRoot(t);
  const logFile = path.join(root, 'shim.log');
  const setSpec = useShim(t, { mapped: true }, logFile);

  await withServer(t, async ({ url }) => {
    const post = (p, body) => fetch(url + p, json('POST', body));
    const normRoot = canonicalRoot(root);

    // 待确认与已忽略路径：自动发现零 p4 调用
    await post('/api/register', { root });
    assert.deepEqual(await shimLog(logFile), []);
    await post('/api/activity', { root });
    await post('/api/projects/ignore', { root });
    await post('/api/heartbeat', { root });
    assert.deepEqual(await shimLog(logFile), []);

    // 确认成功即检测并缓存
    assert.equal((await post('/api/projects/confirm', { root })).status, 200);
    assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['-V', 'where']);

    // 已注册项目加载刷新缓存：映射翻转后更新为非 P4
    setSpec({ mapped: false });
    const list = await fetch(`${url}/api/threads?root=${encodeURIComponent(normRoot)}`);
    assert.equal(list.status, 200);
    assert.deepEqual((await shimLog(logFile)).map((c) => c[0]), ['-V', 'where', '-V', 'where']);

    // 翻回受管：init 补齐结构并检测缓存
    setSpec({ mapped: true, files: { 'kanban/note.md': 'depot' } });
    assert.equal((await post('/api/init', { root })).status, 200);
    // 已注册项目加载再次刷新检测
    const load = await fetch(`${url}/api/threads?root=${encodeURIComponent(normRoot)}`);
    assert.equal(load.status, 200);
    const before = (await shimLog(logFile)).length;
    // 既有 P4 写路径不变：缓存受管时写便签先 checkout（edit）再落盘，无重复检测
    const note = await (await fetch(`${url}/api/note?root=${encodeURIComponent(normRoot)}`)).json();
    const saved = await fetch(url + '/api/note', json('PUT', { root, content: 'P4 便签', fingerprint: note.fingerprint }));
    assert.equal(saved.status, 200);
    const calls = (await shimLog(logFile)).slice(before).map((c) => c[0]);
    assert.deepEqual(calls, ['edit']);
    assert.match(await readFile(path.join(root, 'kanban', 'note.md'), 'utf8'), /P4 便签/);
  });
});
