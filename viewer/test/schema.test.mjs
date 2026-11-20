import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CORE_FIELDS, defaultSchema, loadSchema, schemaFingerprint, validateSchema } from '../server/schema.mjs';

test('缺文件回退到包含六个核心字段的默认 schema', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-schema-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const schema = await loadSchema(root);
  assert.deepEqual(schema, defaultSchema());
  assert.deepEqual(schema.fields.map((field) => field.key), Object.keys(CORE_FIELDS));
  assert.deepEqual(schema.fields[0].options, ['立项', '规划', '实现', '完成']);
  assert.match(schemaFingerprint(schema), /^[a-f0-9]{64}$/);
});

test('合法自定义字段按顺序保留并规范化引用默认值', async () => {
  const input = defaultSchema();
  input.fields.push(
    { key: 'priority', label: '优先级', type: 'select', description: '优先级。', options: ['高', '低'], default: '低' },
    { key: 'related', label: '相关线程', type: 'reference', description: '相关线程。', default: ['0002', '0002'] },
  );
  const schema = validateSchema(input);
  assert.equal(schema.fields.at(-2).default, '低');
  assert.deepEqual(schema.fields.at(-1).default, ['0002']);
});

for (const [name, mutate, pattern] of [
  ['JSON 非法', null, /JSON 解析失败/],
  ['缺核心字段', (schema) => { schema.fields = schema.fields.filter((field) => field.key !== 'goal'); }, /缺少核心字段 goal/],
  ['核心类型非法', (schema) => { schema.fields.find((field) => field.key === 'changes').type = 'reference'; }, /核心字段 changes/],
  ['重复 key', (schema) => { schema.fields[1].key = 'status'; }, /重复：status/],
  ['重复 label', (schema) => { schema.fields[1].label = 'status'; }, /重复：status/],
  ['非法 key', (schema) => { schema.fields[1].key = 'Goal'; }, /kebab-case/],
  ['select 无选项', (schema) => { schema.fields[0].options = []; }, /非空字符串数组/],
  ['select 重复选项', (schema) => { schema.fields[0].options = ['立项', '立项', '规划', '实现', '完成']; }, /选项不得重复|固定为/],
  ['status 四态被修改', (schema) => { schema.fields[0].options = ['立项', '完成']; }, /固定为/],
]) {
  test(`非法 schema：${name}`, async (t) => {
    if (mutate) {
      const schema = defaultSchema();
      mutate(schema);
      assert.throws(() => validateSchema(schema), pattern);
      return;
    }
    const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-schema-invalid-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, 'kanban'));
    await writeFile(path.join(root, 'kanban', 'thread.schema.json'), '{');
    await assert.rejects(loadSchema(root), pattern);
  });
}
