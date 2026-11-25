import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileFieldController, mergeFilePaths } from '../web/field-controls.js';

function fixture(overrides = {}) {
  const calls = [];
  const client = {
    selectFiles: async () => ({ paths: [] }),
    updateField: async (...args) => { calls.push(args); return { fingerprint: 'next' }; },
    ...overrides.client,
  };
  const controller = createFileFieldController({
    root: 'C:/project', threadId: '0001-files', field: { key: 'artifacts', type: 'file' },
    value: overrides.value ?? ['docs/a.md'], fingerprint: 'f1', client,
    onChanged: overrides.onChanged,
  });
  return { controller, client, calls };
}

test('文件路径保序合并去重，合法选择经既有字段接口保存', async () => {
  assert.deepEqual(mergeFilePaths(['a.md', 'b.md'], ['b.md', 'c.md']), ['a.md', 'b.md', 'c.md']);
  const { controller, calls } = fixture({ client: { selectFiles: async () => ({ paths: ['docs/b.md', 'docs/a.md'] }) } });
  await controller.select();
  assert.deepEqual(calls[0].slice(0, 3), ['C:/project', '0001-files', 'artifacts']);
  assert.deepEqual(calls[0][3], ['docs/a.md', 'docs/b.md']);
  assert.equal(calls[0][4], 'f1');
  assert.deepEqual(controller.getState().draft, ['docs/a.md', 'docs/b.md']);
  assert.equal(controller.getState().dirty, false);
  assert.equal(controller.getState().error, '');
});

test('取消与选择拒绝不改草稿、不调用保存，也不伪报成功', async () => {
  const cancelled = fixture();
  await cancelled.controller.select();
  assert.equal(cancelled.calls.length, 0);
  assert.deepEqual(cancelled.controller.getState().draft, ['docs/a.md']);
  assert.equal(cancelled.controller.getState().error, '');

  const rejected = fixture({
    client: {
      selectFiles: async () => {
        const error = new Error('本次未添加任何文件');
        error.data = { rejected: [{ path: 'C:/outside.txt', reason: '越界' }] };
        throw error;
      },
    },
  });
  await rejected.controller.select();
  assert.equal(rejected.calls.length, 0);
  assert.deepEqual(rejected.controller.getState().draft, ['docs/a.md']);
  assert.match(rejected.controller.getState().error, /outside\.txt.*越界/);
});

test('选择器进程失败保留草稿并显示真实错误', async () => {
  const { controller, calls } = fixture({ client: { selectFiles: async () => { throw new Error('PowerShell 异常退出'); } } });
  await controller.select();
  assert.equal(calls.length, 0);
  assert.deepEqual(controller.getState().draft, ['docs/a.md']);
  assert.equal(controller.getState().error, 'PowerShell 异常退出');
});

test('409 保留新增路径草稿，后续外部刷新不覆盖 dirty 状态', async () => {
  const { controller } = fixture({
    client: {
      selectFiles: async () => ({ paths: ['docs/b.md'] }),
      updateField: async () => { const error = new Error('冲突'); error.status = 409; throw error; },
    },
  });
  await controller.select();
  assert.deepEqual(controller.getState().draft, ['docs/a.md', 'docs/b.md']);
  assert.equal(controller.getState().dirty, true);
  assert.match(controller.getState().error, /文件已被修改/);
  controller.setExternal(['docs/external.md'], 'f2');
  assert.deepEqual(controller.getState().draft, ['docs/a.md', 'docs/b.md']);
  assert.equal(controller.getState().dirty, true);
});

test('busy 期间外部值不抢写，操作结束后干净控件采用最新外部值', async () => {
  let finish;
  const { controller } = fixture({ client: { selectFiles: () => new Promise((resolve) => { finish = resolve; }) } });
  const pending = controller.select();
  controller.setExternal(['docs/external.md'], 'f2');
  assert.deepEqual(controller.getState().draft, ['docs/a.md']);
  finish({ paths: [] });
  await pending;
  assert.deepEqual(controller.getState().draft, ['docs/external.md']);
});

test('逐项移除只删除目标路径并保留其他顺序', async () => {
  const { controller, calls } = fixture({ value: ['docs/a.md', 'docs/b.md'] });
  await controller.remove('docs/a.md');
  assert.deepEqual(calls[0][3], ['docs/b.md']);
  assert.deepEqual(controller.getState().draft, ['docs/b.md']);
});
