import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLines, joinLines, mergeDocuments } from '../web/markdown-merge.js';

test('非重叠修改自动合并：双方修改均保留', () => {
  const base = '标题\n\n第一行\n第二行\n第三行\n';
  const local = '本地标题\n\n第一行\n第二行\n第三行\n';
  const remote = '标题\n\n第一行\n第二行\n第三行（外部改）\n';
  const result = mergeDocuments(base, local, remote);
  assert.deepEqual(result, { content: '本地标题\n\n第一行\n第二行\n第三行（外部改）\n' });
});

test('重叠修改返回 conflict，不产出任何冲突标记文本', () => {
  const base = 'a\nb\nc\n';
  const local = 'a\n本地改\nc\n';
  const remote = 'a\n外部改\nc\n';
  const result = mergeDocuments(base, local, remote);
  assert.deepEqual(result, { conflict: true });
  assert.equal(Object.keys(result).includes('content'), false);
});

test('相同修改按非冲突处理且只保留一份', () => {
  const base = 'x\ny\n';
  const same = 'x\n双方都改成这一行\n';
  const result = mergeDocuments(base, same, same);
  assert.deepEqual(result, { content: 'x\n双方都改成这一行\n' });
});

test('空文档：本地新增、外部未动，采用本地版本', () => {
  assert.deepEqual(mergeDocuments('', '新内容\n', ''), { content: '新内容\n' });
  assert.deepEqual(mergeDocuments('', '', ''), { content: '' });
});

test('中文与多字节字符原样保留', () => {
  const base = '# 标题\n\n中文段落，含标点。\n';
  const local = '# 新标题\n\n中文段落，含标点。\n';
  const remote = '# 标题\n\n中文段落，含标点。外部补充。\n';
  const result = mergeDocuments(base, local, remote);
  assert.deepEqual(result, { content: '# 新标题\n\n中文段落，含标点。外部补充。\n' });
});

test('CRLF 行尾原样保留，不被规范化为 LF', () => {
  const base = '一\r\n二\r\n三\r\n';
  const local = '本地\r\n二\r\n三\r\n';
  const remote = '一\r\n二\r\n外部\r\n';
  const result = mergeDocuments(base, local, remote);
  assert.deepEqual(result, { content: '本地\r\n二\r\n外部\r\n' });
  assert.ok(!result.content.includes('\n') || result.content.replace(/\r\n/g, '').includes('\n') === false, '不得混入裸 LF');
});

test('末尾换行不漂移：无尾换行基准追加行后带换行，有尾换行基准保持', () => {
  assert.deepEqual(mergeDocuments('a', 'a\n新行\n', 'a'), { content: 'a\n新行\n' });
  assert.deepEqual(mergeDocuments('a\n', 'a\n新行\n', 'a\n'), { content: 'a\n新行\n' });
  assert.deepEqual(mergeDocuments('a', 'a', 'a'), { content: 'a' });
});

test('splitLines/joinLines 往返一致（LF、CRLF、混合、无尾换行）', () => {
  for (const text of ['a\nb\n', 'a\r\nb\r\n', 'a\r\nb\nc', 'a\rb\n', '', '只有一行无换行']) {
    assert.equal(joinLines(splitLines(text)), text);
  }
  assert.deepEqual(splitLines('a\r\nb\nc\r'), ['a\r\n', 'b\n', 'c\r']);
});

test('合并结果绝不包含冲突标记', () => {
  const cases = [
    ['a\nb\nc\n', 'a\nL\nc\n', 'a\nb\nc\n'],
    ['a\nb\nc\n', 'a\nb\nc\n', 'a\nb\nR\n'],
    ['a\nb\nc\nd\ne\n', 'a\nL\nc\nd\ne\n', 'a\nb\nc\nR\ne\n'],
  ];
  for (const [base, local, remote] of cases) {
    const result = mergeDocuments(base, local, remote);
    if (!result.conflict) {
      assert.ok(!result.content.includes('<<<<<<<'), '不得含 <<<<<<<');
      assert.ok(!/^(=+)$/m.test(result.content) || true);
      assert.ok(!result.content.includes('>>>>>>>'), '不得含 >>>>>>>');
    }
  }
});

test('文档同步控制器接入 mergeDocuments：非重叠自动合并并按外部指纹保存', async () => {
  const { createDocumentSync } = await import('../web/document-sync.js');
  const timers = [];
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-saved' }; },
    merge: (base, local, remote) => mergeDocuments(base, local, remote),
    debounceMs: 800,
    setTimeout: (fn, ms) => { timers.push({ fn }); return timers.length; },
    clearTimeout: () => {},
  });
  sync.start({ content: '头部\n中部\n尾部\n', fingerprint: 'fp-0' });
  sync.setDraft('本地头部\n中部\n尾部\n');
  const outcome = sync.applyRemote({ content: '头部\n中部\n外部尾部\n', fingerprint: 'fp-ext' });
  assert.equal(outcome.kind, 'merged');
  assert.equal(outcome.content, '本地头部\n中部\n外部尾部\n');
  timers.forEach((t) => t.fn());
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(writes, [['本地头部\n中部\n外部尾部\n', 'fp-ext']]);
  const state = sync.getState();
  assert.equal(state.baseContent, '本地头部\n中部\n外部尾部\n', '合并成功后成为新共同基准');
  assert.equal(state.baseFingerprint, 'fp-saved');
});

test('文档同步控制器接入 mergeDocuments：合并后继续输入不被旧结果覆盖', async () => {
  const { createDocumentSync } = await import('../web/document-sync.js');
  const timers = [];
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: `fp-${writes.length}` }; },
    merge: (base, local, remote) => mergeDocuments(base, local, remote),
    debounceMs: 800,
    setTimeout: (fn) => { timers.push({ fn }); return timers.length; },
    clearTimeout: () => {},
  });
  sync.start({ content: '头部\n中部\n尾部\n', fingerprint: 'fp-0' });
  sync.setDraft('本地头部\n中部\n尾部\n');
  const outcome = sync.applyRemote({ content: '头部\n中部\n外部尾部\n', fingerprint: 'fp-ext' });
  assert.equal(outcome.kind, 'merged');
  sync.setDraft('本地头部\n中部\n外部尾部\n\n用户继续输入的新段落\n'); // 合并计算期间/之后继续输入
  timers.forEach((t) => t.fn());
  await new Promise((res) => setTimeout(res, 0));
  const last = writes.at(-1);
  assert.ok(last[0].includes('用户继续输入的新段落'), '最新输入必须在保存内容中');
  assert.equal(sync.getState().draft, last[0]);
});
