import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMarkdown,
  renderMarkdown,
  sanitizerAvailable,
  sanitizeHtml,
  toggleMarkdownTask,
} from '../web/markdown.js';

const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

test('GFM 常见语法：标题、列表、表格、任务列表、代码块、引用、链接', () => {
  const html = parseMarkdown([
    '# 标题',
    '',
    '- 项目一',
    '- 项目二',
    '',
    '| 列一 | 列二 |',
    '| --- | --- |',
    '| a | b |',
    '',
    '- [x] 已完成',
    '- [ ] 待办',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '> 引用内容',
    '',
    '[链接](https://example.com)',
    '',
    '**加粗** 与 *斜体*',
    '',
    '~~删除线~~ 与 https://example.com',
  ].join('\n'));
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<ul>\s*<li>项目一<\/li>/);
  assert.match(html, /<table>[\s\S]*<th>列一<\/th>[\s\S]*<td>a<\/td>/);
  assert.match(html, /<input checked="" disabled="" type="checkbox">/);
  assert.match(html, /<input disabled="" type="checkbox">/);
  assert.match(html, /<pre><code class="language-js">const x = 1;\n?<\/code><\/pre>/);
  assert.match(html, /<blockquote>\s*<p>引用内容<\/p>\s*<\/blockquote>/);
  assert.match(html, /<a href="https:\/\/example\.com">链接<\/a>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<del>删除线<\/del>/);
  assert.match(html, /<a href="https:\/\/example\.com">https:\/\/example\.com<\/a>/);
});

test('交互任务列表带顺序标识且可点击，默认渲染保持禁用', () => {
  const source = '- [ ] 未办\n- [x] 已办';
  const html = parseMarkdown(source, { interactiveTasks: true });
  assert.match(html, /<input type="checkbox" data-task-index="0"> 未办/);
  assert.match(html, /<input checked="" type="checkbox" data-task-index="1"> 已办/);
  assert.doesNotMatch(html, /disabled/);
  assert.match(parseMarkdown(source), /disabled="" type="checkbox"/);
});

test('任务切换按渲染顺序定位嵌套和有序列表，代码块不参与序号', () => {
  const source = [
    '- [ ] 顶层',
    '  - [x] 嵌套',
    '',
    '1. [X] 有序',
    '',
    '```md',
    '- [ ] 围栏代码',
    '```',
    '',
    '    - [ ] 缩进代码',
    '',
    '`- [ ] 行内代码`',
  ].join('\n');
  assert.equal(toggleMarkdownTask(source, 0), source.replace('- [ ] 顶层', '- [x] 顶层'));
  assert.equal(toggleMarkdownTask(source, 1), source.replace('- [x] 嵌套', '- [ ] 嵌套'));
  assert.equal(toggleMarkdownTask(source, 2), source.replace('1. [X] 有序', '1. [ ] 有序'));
  for (const index of [3, 4, -1, 1.5, Number.NaN]) {
    assert.equal(toggleMarkdownTask(source, index), source);
  }
});

test('任务切换支持列表内代码、引用和宽松列表，不误改相同文本', () => {
  const source = [
    '- [ ] 父项',
    '  ```md',
    '  - [ ] 代码',
    '  ```',
    '  - [x] 子项',
    '- [ ] 兄弟项',
    '',
    '> - [ ] 引用',
    '>   - [x] 引用子项',
    '',
    '- [ ] 宽松一',
    '',
    '- [x] 宽松二',
  ].join('\n');
  const expectations = [
    ['- [ ] 父项', '- [x] 父项'],
    ['- [x] 子项', '- [ ] 子项'],
    ['- [ ] 兄弟项', '- [x] 兄弟项'],
    ['> - [ ] 引用', '> - [x] 引用'],
    ['>   - [x] 引用子项', '>   - [ ] 引用子项'],
    ['- [ ] 宽松一', '- [x] 宽松一'],
    ['- [x] 宽松二', '- [ ] 宽松二'],
  ];
  expectations.forEach(([from, to], index) => {
    assert.equal(toggleMarkdownTask(source, index), source.replace(from, to));
  });
});

test('任务切换保留 CRLF、末尾换行和其余原文', () => {
  const source = '- [ ] 第一\r\n  - [X] 第二\r\n';
  const first = toggleMarkdownTask(source, 0);
  const second = toggleMarkdownTask(source, 1);
  assert.equal(first, '- [x] 第一\r\n  - [X] 第二\r\n');
  assert.equal(second, '- [ ] 第一\r\n  - [ ] 第二\r\n');
  assert.equal(toggleMarkdownTask(source, 2), source);
});

test('空内容与纯空白渲染为空，不产生多余标签', () => {
  assert.equal(parseMarkdown(''), '');
  assert.equal(parseMarkdown(null), '');
  assert.equal(parseMarkdown(undefined), '');
  assert.equal(parseMarkdown('   \n\n  '), '');
});

test('渲染不修改传入原文（CRLF、末尾换行、中文原样保留在入参中）', () => {
  const input = '# 中文标题\r\n\r\n- 第一行\r\n- 第二行\r\n';
  const snapshot = JSON.parse(JSON.stringify(input));
  parseMarkdown(input);
  renderMarkdown(input);
  assert.equal(input, snapshot);
  const crlf = parseMarkdown(input);
  assert.match(crlf, /<h1>中文标题<\/h1>/);
  assert.match(crlf, /<li>第一行<\/li>/);
});

test('清理组件不可用时回退为转义模式并保留原文，不产出 HTML', () => {
  // Node 环境无 DOM：必须走回退路径，禁止把未清理 HTML 交给调用方
  assert.equal(sanitizerAvailable(), false);
  const result = renderMarkdown('# 标题\n\n<script>alert(1)</script>');
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'escaped');
  assert.match(result.error, /清理组件不可用/);
  assert.equal(result.text, '# 标题\n\n<script>alert(1)</script>');
  assert.equal(result.html, undefined);
});

test('renderMarkdown 异常时同样回退：错误可识别且不产出 html', () => {
  // 通过原型污染让 marked.parse 抛错不现实；改验证错误分支的形状：手工构造异常输入（循环引用对象在 String() 阶段不会抛错）
  const result = renderMarkdown({ toString() { throw new Error('boom'); } });
  assert.equal(result.ok, false);
  assert.equal(result.mode, 'escaped');
  assert.match(result.error, /boom/);
});

test('vendored 渲染库不引用 CDN，相对导入闭包自包含', async () => {
  for (const name of ['marked.esm.js', 'purify.es.mjs', 'diff3.mjs', 'preact-standalone.module.js']) {
    const content = await readFile(path.join(webDir, 'vendor', name), 'utf8');
    assert.doesNotMatch(content, /from\s+['"]https?:\/\//, `${name} 含外部 URL import`);
    assert.doesNotMatch(content, /import\s*\(\s*['"]https?:\/\//, `${name} 含外部 URL 动态导入`);
  }
  // 本次新增的三个库不得出现任何 CDN 域名（既有 preact 头部注释除外）
  for (const name of ['marked.esm.js', 'purify.es.mjs', 'diff3.mjs']) {
    const content = await readFile(path.join(webDir, 'vendor', name), 'utf8');
    for (const cdn of ['unpkg.com', 'cdnjs', 'jsdelivr', 'cdn.']) {
      assert.ok(!content.includes(cdn), `${name} 引用了 ${cdn}`);
    }
  }
  // 许可证文件随附
  for (const license of ['LICENSE.marked.txt', 'LICENSE.dompurify.txt', 'LICENSE.node-diff3.md']) {
    await readFile(path.join(webDir, 'vendor', license), 'utf8');
  }
});

test('sanitizeHtml 仅在浏览器环境可用（Node 下不支持时不假装清理）', () => {
  if (sanitizerAvailable()) {
    const clean = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script>');
    assert.match(clean, /<p>hi<\/p>/);
    assert.doesNotMatch(clean, /onclick/);
    assert.doesNotMatch(clean, /<script>/);
  } else {
    assert.equal(sanitizeHtml('<b>x</b>'), undefined); // 不支持时不返回伪安全结果
  }
});
