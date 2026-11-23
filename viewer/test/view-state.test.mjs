import test from 'node:test';
import assert from 'node:assert/strict';
import { isViewValid, listProjection, TABLE_VIEW, viewsForSchema } from '../web/view-state.js';
import { defaultSchema } from '../server/schema.mjs';

test('默认 schema 提供配置的表格、status 看板、dependencies 引用图，无固定未完成筛选', () => {
  const views = viewsForSchema(defaultSchema());
  assert.deepEqual(views.map((view) => view.key), ['all', 'status-board', 'dependency-graph']);
  assert.deepEqual(views.map((view) => view.label), ['全部字段', '状态看板', '依赖关系']);
  assert.ok(!views.some((view) => view.kind === 'unfinished'));
  assert.equal(isViewValid(TABLE_VIEW, defaultSchema()), true);
});

test('自定义 select/reference 字段不自动派生视图入口', () => {
  const schema = defaultSchema();
  schema.fields.push(
    { key: 'priority', label: '优先级', type: 'select', description: '', options: ['高'], default: '高' },
    { key: 'related', label: '相关', type: 'reference', description: '' },
  );
  assert.deepEqual(viewsForSchema(schema).map((view) => view.key), ['all', 'status-board', 'dependency-graph']);
});

test('入口 label 与顺序由配置决定，kind 由目标字段类型推导', () => {
  const schema = defaultSchema();
  schema.views = [
    { key: 'status-board', label: '生命周期看板', fieldKey: 'status' },
    { key: 'all', label: '总览表' },
    { key: 'dependency-graph', label: '依赖关系', fieldKey: 'dependencies' },
  ];
  const views = viewsForSchema(schema);
  assert.deepEqual(views.map((view) => view.key), ['status-board', 'all', 'dependency-graph']);
  assert.deepEqual(views.map((view) => view.label), ['生命周期看板', '总览表', '依赖关系']);
  assert.deepEqual(views.map((view) => view.kind), ['board', 'table', 'graph']);
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'status' }, schema), true);
  assert.equal(isViewValid(TABLE_VIEW, schema), true);
});

test('当前视图被移除、改绑或绑定字段类型变化时判定失效，回退表格', () => {
  const schema = defaultSchema();
  schema.views = [{ key: 'all', label: '全部字段' }];
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'status' }, schema), false);
  assert.equal(isViewValid({ kind: 'graph', fieldKey: 'dependencies' }, schema), false);

  const rebound = defaultSchema();
  rebound.views[1].fieldKey = 'goal'; // 服务端校验会拒绝，前端防御性核对绑定类型
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'goal' }, rebound), false);
  const changed = defaultSchema();
  changed.fields.find((field) => field.key === 'status').type = 'reference';
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'status' }, changed), false);
  assert.equal(isViewValid({ kind: 'graph', fieldKey: 'status' }, changed), true);
  const removed = defaultSchema();
  removed.fields = removed.fields.filter((field) => field.key !== 'dependencies');
  assert.equal(isViewValid({ kind: 'graph', fieldKey: 'dependencies' }, removed), false);
});

test('当前视图失效时按页面规则回退到配置的表格视图', () => {
  const schema = defaultSchema();
  schema.views = [{ key: 'all', label: '全部字段' }];
  const current = { kind: 'board', fieldKey: 'status' };
  const next = isViewValid(current, schema) ? current : TABLE_VIEW;
  assert.deepEqual(next, TABLE_VIEW);
});

test('旧服务 schema 缺少 views 时兜底默认三视图', () => {
  const schema = defaultSchema();
  delete schema.views;
  assert.deepEqual(viewsForSchema(schema).map((view) => view.key), ['all', 'status-board', 'dependency-graph']);
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'status' }, schema), true);
  assert.deepEqual(viewsForSchema(null).map((view) => view.key), ['all', 'status-board', 'dependency-graph']);
});

test('列表投影无变化保持稳定，字段或 schema 指纹变化可被检测', () => {
  const data = { schemaFingerprint: 'a', threads: [{ id: '0001-a', fields: { goal: '目标' }, fingerprint: 'f' }] };
  const copy = JSON.parse(JSON.stringify(data));
  assert.equal(listProjection(data), listProjection(copy));
  copy.threads[0].fields.goal = '外部目标';
  assert.notEqual(listProjection(data), listProjection(copy));
  copy.threads[0].fields.goal = '目标';
  copy.schemaFingerprint = 'b';
  assert.notEqual(listProjection(data), listProjection(copy));
});
