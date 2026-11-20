import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, findCycles, posKey } from '../web/dep-graph.js';

const threads = [
  { id: '0001-a', title: 'A', status: '实现', fields: { dependencies: ['0002'], related: ['0003', '0003', '9999', '0001'] } },
  { id: '0002-b', title: 'B', status: '规划', fields: { dependencies: [], related: ['0001'] } },
  { id: '0003-c', title: 'C', status: '完成', fields: { dependencies: [], related: [] } },
];

test('引用图只消费所选字段并保留悬空节点、忽略自引用', () => {
  const dependencies = buildModel(threads, 'dependencies');
  assert.deepEqual(dependencies.edges.map((edge) => [edge.from, edge.toNum]), [['0001-a', '0002']]);
  const related = buildModel(threads, 'related');
  assert.deepEqual(related.edges.map((edge) => [edge.from, edge.toNum]), [['0001-a', '0003'], ['0002-b', '0001'], ['0001-a', '9999']]);
  assert.ok(related.nodes.some((node) => node.ghost && node.num === '9999'));
  assert.ok(!related.edges.some((edge) => edge.from === edge.to));
});

test('引用成环时标记环节点和回边，不影响图模型读取', () => {
  const cyclic = [
    { id: '0001-a', title: 'A', fields: { related: ['0002'] } },
    { id: '0002-b', title: 'B', fields: { related: ['0001'] } },
  ];
  const model = buildModel(cyclic, 'related');
  const cycles = findCycles(model.nodes, model.edges);
  assert.deepEqual([...cycles.cycleNodes].sort(), ['0001-a', '0002-b']);
  assert.ok(cycles.cycleEdges.size > 0);
});

test('图节点位置键按项目根、字段 key 和线程隔离', () => {
  assert.notEqual(posKey('C:\\p', 'dependencies', '0001-a'), posKey('C:\\p', 'related', '0001-a'));
  assert.notEqual(posKey('C:/p', 'related', '0001-a'), posKey('C:/q', 'related', '0001-a'));
  assert.match(posKey('C:\\p', 'related', '0001-a'), /^kanban-ref-graph:C:\/p:related:0001-a$/);
});
