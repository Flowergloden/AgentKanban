import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProgrammaticUpdate,
  createEditorSession,
  detectEol,
  fromEditorSource,
  liveEditorStats,
  minimalChanges,
  planBlockWidgets,
  resetLiveEditorStats,
  toEditorSource,
  toggleTaskInDoc,
  valueTransaction,
} from '../web/markdown-live-editor.js';
import { Transaction } from '../web/vendor/codemirror.bundle.mjs';
import { toggleMarkdownTask } from '../web/markdown.js';

// 注入渲染：绕过 Node 无 DOMPurify 的限制，验证区块规划逻辑本身。
// interactiveTasks 必须为 true（任务 widget 需要区块内 data-task-index）。
const fakeRender = (text, options) => {
  assert.equal(options?.interactiveTasks, true, '规划 widget 时必须请求可交互任务');
  return { ok: true, html: `<x-block>${text}</x-block>` };
};

test('minimalChanges 只保留公共前后缀之外的最小变更', () => {
  assert.equal(minimalChanges('abc', 'abc'), null);
  assert.deepEqual(minimalChanges('abc', 'abcd'), [{ from: 3, to: 3, insert: 'd' }]);
  assert.deepEqual(minimalChanges('abc', 'abx'), [{ from: 2, to: 3, insert: 'x' }]);
  assert.deepEqual(minimalChanges('hello world', 'hello brave world'), [{ from: 6, to: 6, insert: 'brave ' }]);
  assert.deepEqual(minimalChanges('abc', ''), [{ from: 0, to: 3, insert: '' }]);
  assert.deepEqual(minimalChanges('', 'xyz'), [{ from: 0, to: 0, insert: 'xyz' }]);
});

test('会话挂载保持初始原文，卸载后状态清空', () => {
  const session = createEditorSession({ value: '# 标题\n\n正文' });
  assert.equal(session.value, '# 标题\n\n正文');
  session.destroy();
  assert.equal(session.state, null);
});

test('本地输入经统一 onChange 回写，程序化更新不回写', () => {
  const calls = [];
  const session = createEditorSession({ value: 'abc', onChange: (v) => calls.push(v) });
  session.input({ from: 3, insert: 'd' });
  assert.deepEqual(calls, ['abcd']);
  const tr = session.applyValue('abxd');
  assert.ok(tr);
  assert.equal(session.value, 'abxd');
  assert.deepEqual(calls, ['abcd'], '程序化更新不得回写形成回声');
});

test('回传相同值时不产生事务（零事务）', () => {
  const session = createEditorSession({
    value: 'abc',
    onChange: () => { throw new Error('相同回传值不应触发 onChange'); },
  });
  assert.equal(session.applyValue('abc'), null);
  const empty = createEditorSession({
    value: '',
    onChange: () => { throw new Error('空值回传不应触发 onChange'); },
  });
  assert.equal(empty.applyValue(undefined), null, 'undefined 与空串等价，空文档回传零事务');
});

test('程序化更新映射选区且标记为非历史事务', () => {
  const session = createEditorSession({ value: 'hello world' });
  session.select(11); // 光标在文末
  const tr = session.applyValue('hello brave world');
  assert.ok(tr);
  assert.equal(session.value, 'hello brave world');
  assert.equal(session.state.selection.main.head, 11 + 'brave '.length, '光标应随前置插入右移');
  assert.equal(tr.annotation(ProgrammaticUpdate), true, '程序化事务带来源注解');
  assert.equal(tr.annotation(Transaction.addToHistory), false, '程序化事务不进入撤销历史');
});

test('程序化更新不进入本地撤销历史，撤销只回退用户输入', () => {
  const session = createEditorSession({ value: 'base' });
  session.input({ from: 4, insert: 'X' }); // 用户输入
  session.applyValue('baseXR');            // 程序化追加（模拟外部合并落地）
  assert.equal(session.value, 'baseXR');
  assert.equal(session.undo(), true);
  assert.equal(session.value, 'baseR', '撤销只回退用户输入，保留程序化内容');
  assert.equal(session.undo(), false, '撤销栈已耗尽');
});

test('valueTransaction 返回 null 时不应被调用方 dispatch', () => {
  const state = createEditorSession({ value: 'x' }).state;
  assert.equal(valueTransaction(state, 'x'), null);
  assert.equal(valueTransaction(state, 'y') !== null, true);
});

test('planBlockWidgets：光标所在区块保持原文，其余区块规划渲染 widget', () => {
  const doc = '# 标题\n\n第一段\n\n第二段';
  const p1 = doc.indexOf('第一段');
  const p2 = doc.indexOf('第二段');
  const session = createEditorSession({ value: doc, render: fakeRender });

  session.select(2); // 光标在标题内
  let plan = planBlockWidgets(session.state, { render: fakeRender });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.widgets.map((w) => [w.from, w.to]), [[p1, p1 + 3], [p2, p2 + 3]]);

  session.select(p1 + 1); // 光标移入第一段
  plan = planBlockWidgets(session.state, { render: fakeRender });
  assert.deepEqual(plan.widgets.map((w) => [w.from, w.to]), [[0, 4], [p2, p2 + 3]]);

  session.select(p2 + 1); // 光标移入第二段
  plan = planBlockWidgets(session.state, { render: fakeRender });
  assert.deepEqual(plan.widgets.map((w) => [w.from, w.to]), [[0, 4], [p1, p1 + 3]]);
});

test('planBlockWidgets：列表仅当前列表项保持原文，其余项按连续片段渲染', () => {
  for (const items of [['- 甲', '- 乙', '- 丙'], ['1. 甲', '2. 乙', '3. 丙']]) {
    const doc = items.join('\n');
    const ranges = items.map((text) => {
      const from = doc.indexOf(text);
      return [from, from + text.length];
    });
    const session = createEditorSession({ value: doc, render: fakeRender });
    session.select(ranges[1][0] + 1);
    const plan = planBlockWidgets(session.state, { render: fakeRender });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.widgets.map((w) => [w.from, w.to]), [ranges[0], ranges[2]]);
  }
});

test('planBlockWidgets：连续段落仅当前物理行保持原文', () => {
  const lines = ['第一行', '第二行', '第三行'];
  const doc = lines.join('\n');
  const ranges = lines.map((text) => {
    const from = doc.indexOf(text);
    return [from, from + text.length];
  });
  const session = createEditorSession({ value: doc, render: fakeRender });
  session.select(ranges[1][0] + 1);
  const plan = planBlockWidgets(session.state, { render: fakeRender });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.widgets.map((w) => [w.from, w.to]), [ranges[0], ranges[2]]);
});

test('planBlockWidgets 覆盖标题、强调、列表、引用、代码与表格区块', () => {
  const parts = [
    '| a | b |\n| - | - |\n| 1 | 2 |',
    '```js\nlet x = 1;\n```',
    '> 引用内容',
    '- [ ] 任务甲\n- [x] 任务乙',
    '**加粗** 与 *斜体*',
  ];
  const doc = parts.join('\n\n') + '\n';
  const active = 4; // 强调段为活动区块（光标在其中）
  const expected = parts.map((text, i) => {
    const from = doc.indexOf(text);
    return [from, from + text.length, i];
  }).filter(([, , i]) => i !== active).map(([from, to]) => [from, to]);
  const session = createEditorSession({ value: doc, render: fakeRender });
  session.select(doc.indexOf(parts[active]) + 1);
  const plan = planBlockWidgets(session.state, { render: fakeRender });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.widgets.map((w) => [w.from, w.to]), expected);
});

test('EOL 适配：CRLF 原文进编辑器归一、回传恢复，提交仅含实际变更', () => {
  const raw = '# 标\r\n\r\n- [ ] 甲\r\n- [x] 乙\r\n';
  assert.equal(detectEol(raw), '\r\n');
  assert.equal(detectEol('# 标\n\n任务\n'), '\n');
  const editor = toEditorSource(raw);
  assert.ok(!editor.includes('\r'), '编辑器内无回车');
  // 模拟编辑器内单字符输入（勾选第一个任务）
  const toggled = editor.replace('- [ ] 甲', '- [x] 甲');
  const out = fromEditorSource(toggled, '\r\n');
  assert.equal(out, raw.replace('- [ ] 甲', '- [x] 甲'), '除任务翻转外字节级一致');
  assert.ok(out.includes('\r\n'), 'CRLF 全部恢复');
  assert.equal(fromEditorSource('a\nb', '\n'), 'a\nb', 'LF 原文原样回传');
});

test('源码模式往返：Compartment 启停装饰层不改变原文与选区', () => {
  const session = createEditorSession({ value: '# A\n\nB', render: fakeRender });
  session.select(1);
  session.setLive(false);
  assert.equal(session.value, '# A\n\nB');
  assert.equal(session.state.selection.main.head, 1);
  session.input({ from: 1, insert: 'x' });
  session.setLive(true);
  assert.equal(session.value, '#x A\n\nB');
  assert.equal(session.state.selection.main.head, 1, '在插入点处的光标保持不动（CM 默认映射）');
});

test('渲染不可用或失败时 planBlockWidgets 返回错误，不产出 widget', () => {
  const failing = () => ({ ok: false, mode: 'escaped', error: '清理组件不可用', text: 'x' });
  const session = createEditorSession({ value: '# 标题\n\n正文', render: failing });
  const plan = planBlockWidgets(session.state, { render: failing });
  assert.deepEqual(plan, { ok: false, error: '清理组件不可用' });
});

test('toggleTaskInDoc 与全文档 toggleMarkdownTask 一致：嵌套、有序、引用、宽松列表与 CRLF', () => {
  const blocks = [
    '- [ ] 甲\n  - [x] 乙',       // 嵌套任务
    '1. [ ] 丙',                  // 有序
    '> - [ ] 丁',                 // 引用内任务
    '- [ ] 戊\n\n- [ ] 己',       // 宽松列表
    '```\n- [ ] 伪任务\n```',    // 代码块伪任务（不可点击）
    '- [ ] 庚\r\n',               // CRLF
  ];
  const doc = blocks.join('\n\n');
  const cases = [
    { block: 0, rel: 0 }, { block: 0, rel: 1 },
    { block: 1, rel: 0 },
    { block: 2, rel: 0 },
    { block: 3, rel: 0 }, { block: 3, rel: 1 },
    { block: 5, rel: 0 },
  ];
  for (const { block, rel } of cases) {
    const blockFrom = doc.indexOf(blocks[block]);
    const outcome = toggleTaskInDoc(doc, blockFrom, rel);
    assert.ok(outcome, `block=${block} rel=${rel} 应命中任务`);
    const expected = toggleMarkdownTask(doc, outcome.fullIndex);
    const actual = doc.slice(0, outcome.rawOffset) + outcome.nextChar + doc.slice(outcome.rawOffset + 1);
    assert.equal(actual, expected, `block=${block} rel=${rel} 单字符翻转应与全文档定位一致`);
    assert.equal(actual.length, doc.length, '仅一个字符变化，无格式漂移');
  }
});

test('toggleTaskInDoc 拒绝代码块伪任务与越界序号', () => {
  const doc = '```\n- [ ] 伪\n```\n\n- [ ] 真';
  const codeFrom = doc.indexOf('```');
  const realFrom = doc.indexOf('- [ ] 真');
  // 代码块自身没有可点击任务；若强行以其区块起点换算 rel=0，会命中代码块之后的第一个真实任务
  const outcome = toggleTaskInDoc(doc, codeFrom, 0);
  assert.ok(outcome);
  assert.ok(outcome.rawOffset > codeFrom + 3, '命中范围必须位于代码块之外');
  assert.equal(toggleTaskInDoc(doc, realFrom, 5), null, '越界序号返回 null');
});

test('渲染缓存命中时不重复计数（增量装饰基础）', () => {
  const doc = '# 甲\n\n# 乙\n\n# 丙';
  const session = createEditorSession({ value: doc, render: fakeRender }); // 创建时即完成首次装饰规划
  session.select(1); // 甲活动，乙丙渲染
  resetLiveEditorStats();
  planBlockWidgets(session.state, { render: fakeRender });
  assert.equal(liveEditorStats.blocksRendered, 0, '乙、丙在会话创建时已渲染并缓存，命中缓存零重复渲染');
  const plannedAfterFirst = liveEditorStats.widgetsPlanned;
  planBlockWidgets(session.state, { render: fakeRender });
  assert.equal(liveEditorStats.blocksRendered, 0, '相同区块文本重复规划时不重复渲染');
  assert.equal(liveEditorStats.widgetsPlanned, plannedAfterFirst + 2, '规划计数按次累计');
});
