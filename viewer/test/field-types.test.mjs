import test from 'node:test';
import assert from 'node:assert/strict';
import { parseField, serializeField, summarizeField, validateField } from '../server/field-types.mjs';

const markdown = { key: 'goal', type: 'markdown', required: false };
const requiredSelect = { key: 'status', type: 'select', required: true, options: ['立项', '完成'] };
const optionalSelect = { key: 'priority', type: 'select', required: false, options: ['高', '低'] };
const reference = { key: 'dependencies', type: 'reference', required: false };
const changes = { key: 'changes', type: 'markdown', required: false };

test('markdown 摘要排除注释、折叠空白并截断，解析保留自由 Markdown', () => {
  const raw = '\n<!-- 字段说明 -->\n第一行\n\n**第二行**\n';
  assert.equal(parseField(raw, markdown), '第一行\n\n**第二行**');
  assert.equal(summarizeField(parseField(raw, markdown), markdown), '第一行 **第二行**');
  assert.equal(summarizeField('a'.repeat(150), markdown), 'a'.repeat(120));
  assert.equal(serializeField('- [ ] 任务\n```js\ncode\n```', markdown), '- [ ] 任务\n```js\ncode\n```');
});

test('select 区分必填与可选并拒绝配置外值', () => {
  assert.equal(parseField('<!-- 可选值 -->\n立项\n', requiredSelect), '立项');
  assert.equal(validateField('', optionalSelect), '');
  assert.equal(serializeField('完成', requiredSelect), '完成');
  assert.throws(() => validateField('', requiredSelect), /非法选项/);
  assert.throws(() => validateField('其他', optionalSelect), /非法选项/);
});

test('reference 去重保序、保留悬空序号并忽略注释和非法行', () => {
  const raw = '<!-- - 0008 -->\n- 0002\n- 0009\n- 0002\n- abc\n随便一行\n';
  assert.deepEqual(parseField(raw, reference), ['0002', '0009']);
  assert.deepEqual(validateField(['0002', '0009', '0002'], reference), ['0002', '0009']);
  assert.equal(serializeField(['0002', '0009'], reference), '- 0002\n- 0009');
  assert.throws(() => validateField(['2'], reference), /四位线程序号数组/);
  assert.throws(() => validateField('0002', reference), /四位线程序号数组/);
});

test('Changes 始终作为 markdown，不进入引用解析', () => {
  assert.equal(parseField('- add-example\n- 0002', changes), '- add-example\n- 0002');
  assert.equal(summarizeField('- add-example', changes), '- add-example');
});
