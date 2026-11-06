import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentSync, SYNC_STATUS } from '../web/document-sync.js';

function makeTimers() {
  let id = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const t = ++id; timers.set(t, fn); return t; },
    clearTimeout: (t) => { timers.delete(t); },
    fire: () => { for (const [, fn] of [...timers]) { fn(); } timers.clear(); },
  };
}
const nextTick = () => new Promise((res) => setTimeout(res, 0));

test('冲突后继续输入只作为合并素材，不恢复自动保存', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-s' }; },
    merge: () => ({ conflict: true }),
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地');
  assert.equal(sync.applyRemote({ content: '外部', fingerprint: 'fp-1' }).kind, 'conflict');
  sync.setDraft('本地手工合并中');
  timers.fire();
  await nextTick();
  assert.equal(writes.length, 0, '冲突未解决前不写盘');
  assert.equal(sync.getState().status, SYNC_STATUS.conflict);
  assert.equal(sync.getState().draft, '本地手工合并中', '合并素材保留');
});

test('resolveConflict 按外部最新指纹保存确认内容，成功后恢复自动保存', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-final' }; },
    merge: () => ({ conflict: true }),
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地');
  sync.applyRemote({ content: '外部', fingerprint: 'fp-1' });
  const ok = await sync.resolveConflict('手工合并结果', 'fp-1');
  assert.equal(ok, true);
  assert.deepEqual(writes, [['手工合并结果', 'fp-1']]);
  const state = sync.getState();
  assert.equal(state.status, SYNC_STATUS.saved);
  assert.equal(state.baseContent, '手工合并结果');
  assert.equal(state.baseFingerprint, 'fp-final');
  sync.setDraft('冲突解决后再输入');
  timers.fire();
  await nextTick();
  assert.equal(writes.length, 2, '自动保存已恢复');
});

test('resolveConflict 遇 409 返回 false 且保持冲突', async () => {
  const sync = createDocumentSync({
    write: async () => { const e = new Error('冲突'); e.status = 409; throw e; },
    merge: () => ({ conflict: true }),
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地');
  sync.applyRemote({ content: '外部', fingerprint: 'fp-1' });
  const ok = await sync.resolveConflict('手工合并', 'fp-1');
  assert.equal(ok, false);
  assert.equal(sync.getState().status, SYNC_STATUS.conflict);
});

test('adoptRemote 不执行写请求，以远程为准恢复自动保存', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-x' }; },
    merge: () => ({ conflict: true }),
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地');
  sync.applyRemote({ content: '外部', fingerprint: 'fp-1' });
  sync.adoptRemote('外部', 'fp-1');
  assert.equal(writes.length, 0, '采用外部版本不写盘');
  const state = sync.getState();
  assert.equal(state.status, SYNC_STATUS.saved);
  assert.equal(state.draft, '外部');
  assert.equal(state.baseFingerprint, 'fp-1');
  sync.setDraft('采用外部后再输入');
  timers.fire();
  await nextTick();
  assert.equal(writes.length, 1, '自动保存已恢复');
  assert.deepEqual(writes[0], ['采用外部后再输入', 'fp-1']);
});
