import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as threads from '../server/threads.mjs';
import { defaultSchema } from '../server/schema.mjs';
import { generateThread, parseDocument } from '../server/thread-document.mjs';

async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-document-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await threads.ensureLayout(root);
  return root;
}

test('初始化与新线程由 schema 生成，不创建或读取旧模板', async (t) => {
  const root = await project(t);
  const schema = defaultSchema();
  schema.fields.splice(2, 0, { key: 'priority', label: '优先级', type: 'select', description: '处理优先级。', options: ['高', '低'], default: '低', required: true });
  await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
  await writeFile(path.join(root, 'kanban', 'templates-ignored.md'), '不应读取');
  const { id } = await threads.create(root, '自定义线程', 'custom', '完成目标');
  const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
  const text = await readFile(file, 'utf8');
  assert.ok(text.indexOf('## 优先级') < text.indexOf('## 已完成的工作'));
  assert.match(text, /<!-- kanban:field=priority -->/);
  assert.match(text, /<!-- 处理优先级。 -->/);
  assert.match(text, /<!-- 可选值：高、低。 -->/);
  assert.match(text, /<!-- 可选值：高、低。 -->\n\n低/);
  assert.match(text, /<!-- kanban:field=goal -->[\s\S]*?\n\n完成目标/);
  const listing = await threads.parseList(root);
  assert.equal(listing.threads[0].fields.priority, '低');
  assert.equal(listing.threads[0].fields.goal, '完成目标');
  await assert.rejects(readFile(path.join(root, 'kanban', 'templates', 'thread.md')), /ENOENT/);
});

test('key、当前 label、核心旧默认 label 三级匹配及未映射投影', () => {
  const schema = defaultSchema();
  schema.fields.find((field) => field.key === 'goal').label = '新目标';
  const keyed = generateThread('新文档', schema, 'key 内容');
  assert.equal(parseDocument(keyed, schema).fields.goal.value, 'key 内容');
  const legacy = '# 旧文档\n\nstatus: 规划\n\n## 目标\n\n<!-- 旧说明 -->\n旧目标\n\n## 额外小节\n\n保留原文\n';
  const parsed = parseDocument(legacy, schema);
  assert.equal(parsed.fields.goal.value, '旧目标');
  assert.equal(parsed.fields.goal.content, '<!-- 旧说明 -->\n旧目标');
  assert.equal(parsed.fields.completed.missing, true);
  assert.deepEqual(parsed.unmappedSections.map((section) => section.name), ['额外小节']);
  const renamed = legacy.replace('## 目标', '## 新目标');
  assert.equal(parseDocument(renamed, schema).fields.goal.value, '旧目标');
});

test('重复或未知 key 标记只读呈现，目标字段写入被拒绝且磁盘不变', async (t) => {
  const root = await project(t);
  const { id } = await threads.create(root, '歧义文档', 'ambiguous');
  const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
  const original = await readFile(file, 'utf8');
  const duplicate = original + '\n## 重复目标\n\n<!-- kanban:field=goal -->\n另一目标\n';
  await writeFile(file, duplicate);
  const detail = await threads.getThread(root, id);
  assert.ok(detail.errors.some((error) => /重复|歧义/.test(error)));
  await assert.rejects(threads.updateField(root, id, 'goal', '不应写入', detail.fingerprint), /重复|歧义/);
  assert.equal(await readFile(file, 'utf8'), duplicate);
});

test('字段更新仅替换目标并保留未映射原文，缺失字段在末尾补建', async (t) => {
  const root = await project(t);
  const { id } = await threads.create(root, '局部更新', 'partial');
  const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
  const withExtra = (await readFile(file, 'utf8')) + '\n## Schema 外\n\n逐字保留\n';
  await writeFile(file, withExtra);
  const detail = await threads.getThread(root, id);
  await threads.updateField(root, id, 'completed', '- 新进展', detail.fingerprint);
  const updated = await readFile(file, 'utf8');
  assert.ok(updated.includes('## Schema 外\n\n逐字保留'));
  assert.ok(updated.includes('<!-- kanban:field=completed -->\n\n- 新进展'));
  assert.ok(updated.includes('## 决策\n\n<!-- kanban:field=decisions -->'));

  const withoutDeps = updated.replace(/\n## 依赖[\s\S]*?\n## Schema 外/, '\n## Schema 外');
  await writeFile(file, withoutDeps);
  const current = await threads.getThread(root, id);
  await threads.updateField(root, id, 'dependencies', ['0009', '0002', '0009'], current.fingerprint);
  const appended = await readFile(file, 'utf8');
  assert.match(appended, /## Schema 外\n\n逐字保留\n\n## 依赖\n\n<!-- kanban:field=dependencies -->[\s\S]*- 0009\n- 0002\n$/);
  await assert.rejects(threads.updateField(root, id, 'goal', '冲突', 'bad-fingerprint'), (error) => error.code === 'conflict');
  assert.equal(await readFile(file, 'utf8'), appended);
});

test('file 字段按默认数组创建，旧卷宗空值投影不改写，首次保存补建并保留 409', async (t) => {
  const root = await project(t);
  const schema = defaultSchema();
  schema.fields.push({ key: 'artifacts', label: '项目文件', type: 'file', description: '项目内文件。', default: ['docs\\默认.md', 'docs/默认.md'], required: true });
  await writeFile(path.join(root, 'kanban', 'thread.schema.json'), JSON.stringify(schema));
  const { id } = await threads.create(root, '文件字段', 'file-field');
  const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
  const created = await readFile(file, 'utf8');
  assert.match(created, /<!-- kanban:field=artifacts -->/);
  assert.match(created, /- docs\/默认.md/);
  assert.doesNotMatch(created, /- docs\/默认.md\n- docs\/默认.md/);

  const legacy = created.replace(/\n## 项目文件[\s\S]*$/, '\n');
  await writeFile(file, legacy);
  const detail = await threads.getThread(root, id);
  assert.deepEqual(detail.fields.artifacts.value, []);
  assert.equal(detail.fields.artifacts.missing, true);
  assert.equal(await readFile(file, 'utf8'), legacy);

  await threads.updateField(root, id, 'artifacts', ['docs\\新 文件.md', 'missing.txt'], detail.fingerprint);
  const updated = await readFile(file, 'utf8');
  assert.match(updated, /## 项目文件\n\n<!-- kanban:field=artifacts -->[\s\S]*- docs\/新 文件.md\n- missing.txt\n$/);
  assert.match(updated, /<!-- 项目内文件。 -->/);
  const current = await threads.getThread(root, id);
  await assert.rejects(threads.updateField(root, id, 'artifacts', ['../outside.txt'], current.fingerprint), /项目相对路径|路径段/);
  await assert.rejects(threads.updateField(root, id, 'artifacts', [], 'stale'), (error) => error.code === 'conflict');
  assert.equal(await readFile(file, 'utf8'), updated);
});

test('非法 schema 阻止创建与字段写入，不静默回退', async (t) => {
  const root = await project(t);
  const { id } = await threads.create(root, '配置错误', 'bad-schema');
  const file = path.join(root, 'kanban', 'threads', id, 'thread.md');
  const before = await readFile(file, 'utf8');
  await writeFile(path.join(root, 'kanban', 'thread.schema.json'), '{"version":1,"fields":[]}');
  await assert.rejects(threads.create(root, '不应创建', 'no-create'), /非空数组|缺少核心字段/);
  await assert.rejects(threads.updateField(root, id, 'goal', 'x', threads.fingerprint(before)), /非空数组|缺少核心字段/);
  assert.equal(await readFile(file, 'utf8'), before);
});
