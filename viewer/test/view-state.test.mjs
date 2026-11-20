import test from 'node:test';
import assert from 'node:assert/strict';
import { isViewValid, listProjection, TABLE_VIEW, viewsForSchema } from '../web/view-state.js';
import { defaultSchema } from '../server/schema.mjs';

test('默认 schema 提供表格、status 看板、dependencies 引用图，无固定未完成筛选', () => {
  const views = viewsForSchema(defaultSchema());
  assert.deepEqual(views.map((view) => view.key), ['table', 'board:status', 'graph:dependencies']);
  assert.ok(!views.some((view) => view.kind === 'unfinished'));
  assert.equal(isViewValid(TABLE_VIEW, defaultSchema()), true);
});

test('自定义 select/reference 生成视图，失效或类型变化时回退判定失败', () => {
  const schema = defaultSchema();
  schema.fields.push(
    { key: 'priority', label: '优先级', type: 'select', description: '', options: ['高'], default: '高' },
    { key: 'related', label: '相关', type: 'reference', description: '' },
  );
  assert.deepEqual(viewsForSchema(schema).map((view) => view.key), ['table', 'board:status', 'graph:dependencies', 'board:priority', 'graph:related']);
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'priority' }, schema), true);
  assert.equal(isViewValid({ kind: 'graph', fieldKey: 'priority' }, schema), false);
  assert.equal(isViewValid({ kind: 'board', fieldKey: 'removed' }, schema), false);
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
