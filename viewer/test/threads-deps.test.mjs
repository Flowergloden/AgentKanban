import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as threads from '../server/threads.mjs';

async function withRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-threads-deps-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await threads.ensureLayout(root);
  return root;
}

test('parseList 投影携带 deps：正常解析、去重保序、悬空序号原样保留', async (t) => {
  const root = await withRoot(t);
  await threads.create(root, '线程一', 'one');
  const b = await threads.create(root, '线程二', 'two');
  const file = path.join(root, 'kanban', 'threads', b.id, 'thread.md');
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace(
    /(## 依赖\n\n)<!--[\s\S]*?-->/,
    '$1- 0001\n- 0009\n- 0001\n'
  ));
  const list = await threads.parseList(root);
  const proj = list.threads.find((entry) => entry.id === b.id);
  assert.deepEqual(proj.deps, ['0001', '0009']);
});

test('parseList 投影 deps：无 `## 依赖` 小节或空小节时为空列表', async (t) => {
  const root = await withRoot(t);
  const a = await threads.create(root, '线程一', 'one');
  // 空小节：模板注释不产生序号条目
  let list = await threads.parseList(root);
  assert.deepEqual(list.threads.find((entry) => entry.id === a.id).deps, []);
  // 无小节：移除整个 `## 依赖` 小节
  const file = path.join(root, 'kanban', 'threads', a.id, 'thread.md');
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace(/\n## 依赖[\s\S]*$/, ''));
  list = await threads.parseList(root);
  assert.deepEqual(list.threads.find((entry) => entry.id === a.id).deps, []);
});

test('parseList 投影 deps：非法条目静默忽略', async (t) => {
  const root = await withRoot(t);
  const a = await threads.create(root, '线程一', 'one');
  const file = path.join(root, 'kanban', 'threads', a.id, 'thread.md');
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace(
    /(## 依赖\n\n)<!--[\s\S]*?-->/,
    '$1- 0002\n- abc\n- 123（三位）\n随便一行文字\n- 0003-foo\n'
  ));
  const list = await threads.parseList(root);
  assert.deepEqual(list.threads.find((entry) => entry.id === a.id).deps, ['0002', '0003']);
});

test('updateSection 补建缺失的 `依赖` 小节：成功且其余内容一字不改', async (t) => {
  const root = await withRoot(t);
  const a = await threads.create(root, '线程一', 'one');
  const file = path.join(root, 'kanban', 'threads', a.id, 'thread.md');
  const original = await readFile(file, 'utf8');
  const withoutDeps = original.replace(/\n## 依赖[\s\S]*$/, '');
  await writeFile(file, withoutDeps);
  const detail = await threads.getThread(root, a.id);
  const { fingerprint } = await threads.updateSection(root, a.id, '依赖', '- 0001', detail.fingerprint);
  const updated = await readFile(file, 'utf8');
  assert.ok(updated.startsWith(withoutDeps.replace(/(\r?\n)*$/, '\n\n')));
  assert.match(updated, /## 依赖\n\n- 0001\n$/);
  assert.equal(fingerprint, threads.fingerprint(updated));
  // 其余部分一字不改
  assert.equal(updated.slice(0, withoutDeps.length - 1), withoutDeps.slice(0, -1));
  const list = await threads.parseList(root);
  assert.deepEqual(list.threads.find((entry) => entry.id === a.id).deps, ['0001']);
});

test('updateSection：非 `依赖` 小节缺失仍报错且不写盘', async (t) => {
  const root = await withRoot(t);
  const a = await threads.create(root, '线程一', 'one');
  const file = path.join(root, 'kanban', 'threads', a.id, 'thread.md');
  const original = await readFile(file, 'utf8');
  const detail = await threads.getThread(root, a.id);
  await assert.rejects(
    threads.updateSection(root, a.id, '不存在小节', '内容', detail.fingerprint),
    (err) => err.code === 'section-missing'
  );
  assert.equal(await readFile(file, 'utf8'), original);
});
