import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCursor } from '../web/document-sync.js';

test('mapCursor：无变化时原样返回', () => {
  assert.equal(mapCursor('abcdef', 'abcdef', 3), 3);
  assert.equal(mapCursor('', '', 0), 0);
});

test('mapCursor：纯追加时保持原位置', () => {
  // 末尾追加：光标在旧文本中间不动
  assert.equal(mapCursor('abc', 'abcdef', 2), 2);
  // 开头插入：光标内容随之后移
  assert.equal(mapCursor('bc', 'abc', 0), 0); // 光标在最前，插入后仍在最前
});

test('mapCursor：中间替换光标落在改动区内', () => {
  const mapped = mapCursor('头部\n中部\n尾部\n', '头部\n本地中部\n尾部\n', 4);
  assert.ok(mapped >= 3 && mapped <= 8, `光标应映射在改动附近，实际 ${mapped}`);
  // 公共前缀精确保持
  assert.equal(mapCursor('abcXdef', 'abcYdef', 3), 3);
});

test('mapCursor：尾部变化不影响头部光标', () => {
  assert.equal(mapCursor('第一行\n第二行\n', '第一行\n第二行改\n', 2), 2);
});

test('mapCursor：合并场景（头部本地改 + 尾部外部改）光标位于头部之后', () => {
  const oldText = '标题\n\n中间\n';
  const newText = '本地标题\n\n中间\n外部追加\n';
  const mapped = mapCursor(oldText, newText, 1);
  assert.ok(mapped <= 4, '光标在原头部区域内应保持或落在改动起点');
  assert.equal(mapCursor(oldText, newText, oldText.length), newText.length, '末尾光标跟随到末尾');
});
