import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrlRoot,
  rootKey,
  findProject,
  registeredProjects,
  pickRecentRegistered,
  nextRootAfterRemoval,
} from '../web/project-state.js';

test('normalizeUrlRoot unifies separators and trailing slashes, keeps drive root', () => {
  assert.equal(normalizeUrlRoot('C:\\中文 目录\\proj'), 'C:/中文 目录/proj');
  assert.equal(normalizeUrlRoot('c:/proj/'), 'c:/proj');
  assert.equal(normalizeUrlRoot('C:\\'), 'C:/');
  assert.equal(normalizeUrlRoot(''), '');
  assert.equal(normalizeUrlRoot(null), '');
});

test('findProject matches canonical registry keys case-insensitively', () => {
  const list = [{ root: 'c:/proj a', state: 'registered', lastSeen: 2 }];
  assert.equal(findProject(list, 'C:\\proj a').root, 'c:/proj a');
  assert.equal(findProject(list, 'C:/PROJ A/').root, 'c:/proj a');
  assert.equal(findProject(list, 'c:/other'), null);
  assert.equal(findProject(list, ''), null);
  assert.equal(findProject(null, 'c:/proj a'), null);
  assert.equal(rootKey('C:\\Foo'), 'c:/foo');
});

test('registeredProjects filters the main selector list; recent pick takes first', () => {
  const list = [
    { root: 'c:/new', state: 'pending', lastSeen: 9 },
    { root: 'c:/hot', state: 'registered', lastSeen: 8 },
    { root: 'c:/old', state: 'registered', lastSeen: 3 },
    { root: 'c:/mute', state: 'ignored', lastSeen: 7 },
  ];
  assert.deepEqual(registeredProjects(list).map((p) => p.root), ['c:/hot', 'c:/old']);
  assert.equal(pickRecentRegistered(list), 'c:/hot');
  assert.equal(pickRecentRegistered([list[0], list[3]]), ''); // 只有待确认/已忽略时没有落点
  assert.equal(pickRecentRegistered([]), '');
});

test('nextRootAfterRemoval picks the next recent registered project or empty state', () => {
  const list = [
    { root: 'c:/removed', state: 'registered', lastSeen: 9 },
    { root: 'c:/next', state: 'registered', lastSeen: 5 },
    { root: 'c:/mute', state: 'ignored', lastSeen: 8 },
  ];
  assert.equal(nextRootAfterRemoval(list, 'C:\\removed'), 'c:/next');
  // 无其他已注册项目：空状态
  assert.equal(nextRootAfterRemoval([list[0], list[2]], 'c:/removed'), '');
  // 删除/忽略的不是当前展示项目时不影响当前选择
  assert.equal(nextRootAfterRemoval(list, 'c:/mute'), 'c:/removed');
  assert.equal(nextRootAfterRemoval([], 'c:/removed'), '');
});
