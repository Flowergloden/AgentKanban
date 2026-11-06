import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentSync, SYNC_STATUS } from '../web/document-sync.js';

function makeTimers() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const t = ++id; timers.set(t, { fn, at: now + ms }); return t; },
    clearTimeout: (t) => { timers.delete(t); },
    tick: (ms) => {
      now += ms;
      const due = [...timers.entries()].filter(([, v]) => v.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [t, v] of due) { timers.delete(t); v.fn(); }
    },
  };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
};
const nextTick = () => new Promise((res) => setTimeout(res, 0));

test('applyRemote：本地无未保存修改时采用外部内容与指纹', () => {
  const sync = createDocumentSync({ write: async () => ({ fingerprint: 'x' }) });
  sync.start({ content: '旧', fingerprint: 'fp-0' });
  const outcome = sync.applyRemote({ content: '外部新版', fingerprint: 'fp-1' });
  assert.equal(outcome.kind, 'adopted');
  assert.equal(sync.getState().draft, '外部新版');
  assert.equal(sync.getState().baseFingerprint, 'fp-1');
  assert.equal(sync.getState().status, SYNC_STATUS.saved);
});

test('applyRemote：指纹与内容未变时不重置状态（返回 unchanged）', () => {
  const sync = createDocumentSync({ write: async () => ({ fingerprint: 'x' }) });
  sync.start({ content: '同', fingerprint: 'fp-0' });
  assert.equal(sync.applyRemote({ content: '同', fingerprint: 'fp-0' }).kind, 'unchanged');
  sync.setDraft('本地草稿');
  assert.equal(sync.applyRemote({ content: '同', fingerprint: 'fp-0' }).kind, 'unchanged');
  assert.equal(sync.getState().draft, '本地草稿', '未变化的外部快照不得重置草稿');
});

test('applyRemote：外部等于本地草稿视为收敛，采用外部指纹并标记已保存', () => {
  const sync = createDocumentSync({ write: async () => ({ fingerprint: 'x' }) });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('双方写的一样');
  const outcome = sync.applyRemote({ content: '双方写的一样', fingerprint: 'fp-9' });
  assert.equal(outcome.kind, 'converged');
  assert.equal(sync.getState().status, SYNC_STATUS.saved);
  assert.equal(sync.getState().baseFingerprint, 'fp-9');
});

test('applyRemote：外部该投影仍是基准（仅其他区域变化）时保留草稿并更新指纹', () => {
  const sync = createDocumentSync({ write: async () => ({ fingerprint: 'x' }) });
  sync.start({ content: '小节基准', fingerprint: 'fp-0' });
  sync.setDraft('小节草稿');
  const outcome = sync.applyRemote({ content: '小节基准', fingerprint: 'fp-7' });
  assert.equal(outcome.kind, 'draft-kept');
  assert.equal(sync.getState().draft, '小节草稿', '草稿保留');
  assert.equal(sync.getState().baseFingerprint, 'fp-7', '指纹推进使后续保存可继续');
});

test('applyRemote：保存中收到的外部快照先暂存，落地后按最新共同基准重新判断', async () => {
  const timers = makeTimers();
  const d1 = deferred();
  const writes = [];
  let call = 0;
  const sync = createDocumentSync({
    write: (content, fp) => {
      call += 1;
      writes.push([content, fp]);
      return call === 1 ? d1.promise : Promise.resolve({ fingerprint: 'fp-save2' });
    },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '', fingerprint: 'fp-0' });
  sync.setDraft('v1');
  timers.tick(800); // 保存挂起
  const outcome = sync.applyRemote({ content: '外部版本', fingerprint: 'fp-ext' });
  assert.equal(outcome.kind, 'deferred');
  d1.resolve({ fingerprint: 'fp-1' });
  await nextTick();
  await nextTick();
  // 落地后本地有未保存修改（v1 已存为基准，草稿=v1？不——保存成功 base=v1，draft=v1）
  // 此时重新判断外部快照：本地干净 → 采用外部
  const state = sync.getState();
  assert.equal(state.baseContent, '外部版本');
  assert.equal(state.baseFingerprint, 'fp-ext');
  assert.equal(state.draft, '外部版本');
});

test('applyRemote：双方都变且未注入 merge 时安全进入冲突，不覆盖任何一方', () => {
  const sync = createDocumentSync({ write: async () => ({ fingerprint: 'x' }) });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地修改');
  const outcome = sync.applyRemote({ content: '外部修改', fingerprint: 'fp-3' });
  assert.equal(outcome.kind, 'conflict');
  assert.equal(outcome.remote, '外部修改');
  assert.equal(sync.getState().status, SYNC_STATUS.conflict);
  assert.equal(sync.getState().draft, '本地修改', '草稿不被覆盖');
});

test('applyRemote：注入 merge 且无冲突时采用合并草稿并按外部指纹自动续写', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-saved' }; },
    merge: (base, local, remote) => ({ content: `${base}|${local}|${remote}` }),
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地');
  const outcome = sync.applyRemote({ content: '外部', fingerprint: 'fp-4' });
  assert.equal(outcome.kind, 'merged');
  assert.equal(sync.getState().draft, '基准|本地|外部');
  timers.tick(800); // 合并结果按外部指纹自动保存
  await nextTick();
  assert.deepEqual(writes, [['基准|本地|外部', 'fp-4']]);
  assert.equal(sync.getState().status, SYNC_STATUS.saved);
  assert.equal(sync.getState().baseContent, '基准|本地|外部');
});

test('applyRemote：merge 报告冲突时进入冲突态且不落盘', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'x' }; },
    merge: () => ({ conflict: true }),
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('本地');
  const outcome = sync.applyRemote({ content: '外部', fingerprint: 'fp-4' });
  assert.equal(outcome.kind, 'conflict');
  timers.tick(5000);
  await nextTick();
  assert.equal(writes.length, 0, '冲突时禁止自动写盘');
  assert.equal(sync.getState().status, SYNC_STATUS.conflict);
});

test('pause 暂停自动保存但保留草稿，resume 后可继续', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-1' }; },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '', fingerprint: 'fp-0' });
  sync.pause();
  sync.setDraft('失联期间的输入');
  timers.tick(5000);
  assert.equal(writes.length, 0, '暂停期间不自动保存');
  assert.equal(sync.getState().draft, '失联期间的输入', '草稿保留');
  await sync.flush(); // 显式提交仍允许
  assert.equal(writes.length, 1);
  sync.resume();
  sync.setDraft('恢复后再输入');
  timers.tick(800);
  await nextTick();
  assert.equal(writes.length, 2, '恢复后自动保存继续');
});
