import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as threads from '../server/threads.mjs';

test('BOM-prefixed template creates readable threads and retains BOM through edits', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-bom-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await threads.ensureLayout(root);
  const templateFile = path.join(root, 'kanban', 'templates', 'thread.md');
  const template = await readFile(templateFile, 'utf8');
  await writeFile(templateFile, '\uFEFF' + template.replace(/\n/g, '\r\n'), 'utf8');

  const { id } = await threads.create(root, 'BOM thread', 'bom-thread', 'A goal');
  const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
  const original = await readFile(file);
  assert.deepEqual([...original.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(original.toString('utf8').startsWith('\uFEFF# BOM thread\r\n'));
  assert.deepEqual(threads.parseThread(original.toString('utf8')).errors, []);

  const listing = await threads.parseList(root);
  assert.equal(listing.threads[0].title, 'BOM thread');
  assert.equal(listing.threads[0].error, undefined);
  const detail = await threads.getThread(root, id);
  assert.equal(detail.title, 'BOM thread');
  assert.equal(detail.sections['目标'], 'A goal');
  await threads.updateSection(root, id, '已完成的工作', 'Progress', detail.fingerprint);
  const updated = await readFile(file);
  assert.deepEqual([...updated.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.deepEqual(threads.parseThread(updated.toString('utf8')).errors, []);
});
