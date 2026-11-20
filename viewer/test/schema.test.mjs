import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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

test('默认 schema 显式包含默认三视图', () => {
  const schema = defaultSchema();
  assert.deepEqual(schema.views, [
    { key: 'all', label: '全部字段', kind: 'table' },
    { key: 'status-board', label: '状态看板', kind: 'board', fieldKey: 'status' },
    { key: 'dependency-graph', label: '依赖关系', kind: 'graph', fieldKey: 'dependencies' },
  ]);
});

test('既有 schema 省略 views 时补默认三视图，有效配置与显式默认一致且指纹覆盖视图', () => {
  const withoutViews = defaultSchema();
  delete withoutViews.views;
  const effective = validateSchema(withoutViews);
  assert.deepEqual(effective, defaultSchema());
  assert.equal(schemaFingerprint(effective), schemaFingerprint(defaultSchema()));

  const renamed = defaultSchema();
  renamed.views[1].label = '生命周期看板';
  assert.notEqual(schemaFingerprint(validateSchema(renamed)), schemaFingerprint(effective));
  const reordered = defaultSchema();
  reordered.views.push(reordered.views.shift());
  assert.notEqual(schemaFingerprint(validateSchema(reordered)), schemaFingerprint(effective));
  const custom = defaultSchema();
  custom.fields.push({ key: 'owner', label: '负责人', type: 'select', description: '负责人。', options: ['甲', '乙'], default: '甲' });
  custom.views.push({ key: 'owner-board', label: '负责看板', kind: 'board', fieldKey: 'owner' });
  assert.notEqual(schemaFingerprint(validateSchema(custom)), schemaFingerprint(effective));
});

test('缺 views 的项目文件读取补默认值且不回写', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kanban-schema-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'kanban'));
  const legacy = defaultSchema();
  delete legacy.views;
  const raw = JSON.stringify(legacy);
  await writeFile(path.join(root, 'kanban', 'thread.schema.json'), raw);
  const schema = await loadSchema(root);
  assert.deepEqual(schema.views, defaultSchema().views);
  assert.equal(await readFile(path.join(root, 'kanban', 'thread.schema.json'), 'utf8'), raw);
});

test('合法自定义视图按配置保留 label、顺序与字段绑定', () => {
  const schema = defaultSchema();
  schema.fields.push(
    { key: 'priority', label: '优先级', type: 'select', description: '优先级。', options: ['高', '低'], default: '低' },
    { key: 'related', label: '相关线程', type: 'reference', description: '相关线程。' },
  );
  schema.views = [
    { key: 'main', label: '总览', kind: 'table' },
    { key: 'priority-board', label: '优先级看板', kind: 'board', fieldKey: 'priority' },
    { key: 'status-board', label: '状态看板', kind: 'board', fieldKey: 'status' },
    { key: 'related-graph', label: '相关关系', kind: 'graph', fieldKey: 'related' },
    { key: 'dependency-graph', label: '依赖关系', kind: 'graph', fieldKey: 'dependencies' },
  ];
  const validated = validateSchema(schema);
  assert.deepEqual(validated.views.map((view) => view.key), ['main', 'priority-board', 'status-board', 'related-graph', 'dependency-graph']);
  assert.deepEqual(validated.views[1], { key: 'priority-board', label: '优先级看板', kind: 'board', fieldKey: 'priority' });
});

for (const [name, mutate, pattern] of [
  ['views 为空', (schema) => { schema.views = []; }, /\$\.views 必须是非空数组/],
  ['views 非数组', (schema) => { schema.views = {}; }, /\$\.views 必须是非空数组/],
  ['缺少 table', (schema) => { schema.views = schema.views.filter((view) => view.kind !== 'table'); }, /恰好包含一个.*table/],
  ['重复 table', (schema) => { schema.views.push({ key: 'extra', label: '额外', kind: 'table' }); }, /恰好包含一个.*table/],
  ['table 携带 fieldKey', (schema) => { schema.views[0].fieldKey = 'status'; }, /table 视图不得携带 fieldKey/],
  ['视图 key 重复', (schema) => { schema.views[2].key = 'all'; }, /重复：all/],
  ['视图 key 非 kebab-case', (schema) => { schema.views[1].key = 'StatusBoard'; }, /kebab-case/],
  ['视图 label 为空', (schema) => { schema.views[1].label = '  '; }, /非空单行字符串/],
  ['视图 label 多行', (schema) => { schema.views[1].label = 'a\nb'; }, /非空单行字符串/],
  ['视图 kind 非法', (schema) => { schema.views[1].kind = 'calendar'; }, /不支持：calendar/],
  ['board 缺 fieldKey', (schema) => { delete schema.views[1].fieldKey; }, /必须绑定 fieldKey/],
  ['board 绑定缺失字段', (schema) => { schema.views[1].fieldKey = 'missing'; }, /绑定的字段不存在：missing/],
  ['board 绑定 markdown 字段', (schema) => { schema.views[1].fieldKey = 'goal'; }, /看板必须绑定 select 字段：goal（当前 markdown）/],
  ['graph 绑定 select 字段', (schema) => { schema.views[2].fieldKey = 'status'; }, /引用图必须绑定 reference 字段：status（当前 select）/],
  ['非 table 组合重复', (schema) => { schema.views.push({ key: 'again', label: '再看板', kind: 'board', fieldKey: 'status' }); }, /组合重复：board\+status/],
]) {
  test(`非法 schema：${name}`, () => {
    const schema = defaultSchema();
    mutate(schema);
    assert.throws(() => validateSchema(schema), pattern);
  });
}

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
