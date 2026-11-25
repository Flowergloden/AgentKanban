import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultSchema } from '../server/schema.mjs';
import { viewsForSchema } from '../web/view-state.js';

const source = (name) => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8');

test('表格与详情对四种字段类型显式分派，file 使用专用控件', async () => {
  for (const name of ['views-table.js', 'detail.js']) {
    const text = await source(name);
    for (const type of ['markdown', 'select', 'reference', 'file']) {
      assert.ok(text.includes(`field.type === '${type}'`), `${name} 缺少 ${type} 分派`);
    }
    assert.ok(text.includes('FileFieldControl'), `${name} 未使用 FileFieldControl`);
    assert.ok(text.includes('onPreview'), `${name} 缺少文件预览入口`);
  }
});

test('文件控件没有手输路径入口，并包含选择、移除与错误展示', async () => {
  const text = await source('field-controls.js');
  const component = text.slice(text.indexOf('export function FileFieldControl'), text.indexOf('export function MarkdownFieldEditor'));
  assert.ok(component.includes('controller.select()'));
  assert.ok(component.includes('controller.remove(filePath)'));
  assert.ok(component.includes('file-field-error'));
  assert.doesNotMatch(component, /<input|<textarea/);
});

test('file 字段不会自动派生 board 或 graph 视图', () => {
  const schema = defaultSchema();
  schema.fields.push({ key: 'artifacts', label: '项目文件', type: 'file', description: '' });
  assert.deepEqual(viewsForSchema(schema).map((view) => view.kind), ['table', 'board', 'graph']);
  assert.ok(!viewsForSchema(schema).some((view) => view.fieldKey === 'artifacts'));
});

test('文件预览按需调用 API，覆盖加载、错误、重试、Markdown 禁图和纯文本展示', async () => {
  const [preview, app] = await Promise.all([source('file-preview.js'), source('app.js')]);
  assert.ok(preview.includes('client.getFile(root, threadId, fieldKey, filePath)'));
  assert.ok(preview.includes('加载文件预览…'));
  assert.ok(preview.includes('预览失败：'));
  assert.ok(preview.includes('setAttempt(attempt + 1)'));
  assert.ok(preview.includes('disableImages'));
  assert.ok(preview.includes('<pre class="file-preview-source">${state.result.content}</pre>'));
  assert.ok(!preview.includes('onSourceChange'));
  assert.ok(app.includes('filePreview && html'));
  assert.ok(app.includes('setFilePreview(null)'));
});
