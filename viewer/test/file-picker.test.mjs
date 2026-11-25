import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FilePickerError, selectFilesWithSystemPicker } from '../server/file-picker.mjs';

const root = path.resolve('C:\\项目 root');
const runnerReturning = (stdout) => async () => ({ stdout, stderr: '' });

test('系统选择器使用 STA WinForms、多选与项目根初始目录，并返回合法多选', async () => {
  let invocation;
  const selected = ['C:\\项目 root\\docs\\a.md', 'C:\\项目 root\\docs\\中文 空格.txt'];
  const paths = await selectFilesWithSystemPicker(root, {
    runner: async (options) => {
      invocation = options;
      return { stdout: JSON.stringify(selected), stderr: '' };
    },
  });
  assert.deepEqual(paths, selected);
  assert.equal(invocation.rootPath, root);
  assert.match(invocation.script, /OpenFileDialog/);
  assert.match(invocation.script, /Multiselect = \$true/);
  assert.match(invocation.script, /AGENT_KANBAN_FILE_ROOT/);
  assert.match(invocation.script, /UTF8Encoding/);
});

test('用户取消返回空列表', async () => {
  assert.deepEqual(await selectFilesWithSystemPicker(root, { runner: runnerReturning('[]') }), []);
});

test('中文路径与 UTF-8 BOM 输出可解析', async () => {
  const selected = ['C:\\项目 root\\文档\\设计 草案.md'];
  assert.deepEqual(await selectFilesWithSystemPicker(root, { runner: runnerReturning(`\uFEFF${JSON.stringify(selected)}`) }), selected);
});

test('非零退出与进程启动失败分类为可读错误', async () => {
  await assert.rejects(
    selectFilesWithSystemPicker(root, { runner: runnerReturning('') }),
    (error) => error instanceof FilePickerError && error.code === 'picker-output',
  );
  await assert.rejects(
    selectFilesWithSystemPicker(root, {
      runner: async () => { throw new FilePickerError('picker-exit', '系统文件选择器异常退出（1）：失败'); },
    }),
    { code: 'picker-exit' },
  );
  await assert.rejects(
    selectFilesWithSystemPicker(root, {
      runner: async () => { throw new Error('spawn powershell.exe ENOENT'); },
    }),
    { code: 'picker-process' },
  );
});

test('异常 JSON、非字符串数组与输出超限均被拒绝', async () => {
  for (const stdout of ['not-json', '{"path":"a"}', '[1]']) {
    await assert.rejects(selectFilesWithSystemPicker(root, { runner: runnerReturning(stdout) }), { code: 'picker-output' });
  }
  await assert.rejects(
    selectFilesWithSystemPicker(root, { runner: runnerReturning(JSON.stringify(['a.txt', 'b.txt'])), maxOutputBytes: 8 }),
    { code: 'picker-output-too-large' },
  );
});
