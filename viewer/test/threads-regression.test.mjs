import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as threads from '../server/threads.mjs';

test('thread document shape, unnamed-pending rename, active pointer and human note do not regress', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-threads-regression-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const layout = await threads.ensureLayout(root);
  assert.ok(layout.created.includes('kanban/current'));
  const note = path.join(root, 'kanban', 'note.md');
  await writeFile(note, '人类私有内容：不可注入');
  const created = await threads.create(root, '测试线程', undefined, '检查格式');
  assert.match(created.id, /^0001-unnamed-pending$/);
  const file = path.join(root, 'kanban', 'threads', created.id, 'thread.md');
  const before = await readFile(file, 'utf8');
  for (const heading of ['# 测试线程', 'status: 立项', '## 目标', '## 已完成的工作', '## 决策', '## Changes'])
    assert.ok(before.includes(heading), `missing ${heading}`);
  assert.ok(!before.includes('人类私有内容'));
  await threads.setActive(root, created.id);
  const renamed = await threads.rename(root, created.id, 'test-thread');
  const id = typeof renamed === 'string' ? renamed : renamed.id;
  assert.equal(id, '0001-test-thread');
  assert.equal((await readFile(path.join(root, 'kanban', 'current'), 'utf8')).trim(), id);
  const detail = await threads.getThread(root, id);
  await threads.updateSection(root, id, '已完成的工作', '- 2026-09-28 验证格式', detail.fingerprint);
  const updated = await readFile(path.join(root, 'kanban', 'threads', id, 'thread.md'), 'utf8');
  assert.equal(threads.parseThread(updated).errors.length, 0);
  assert.equal(await readFile(note, 'utf8'), '人类私有内容：不可注入');
  assert.deepEqual((await threads.parseList(root)).threads.map((entry) => entry.id), [id]);
});
