import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentSync, SYNC_STATUS } from '../web/document-sync.js';

// 手写假定时器：同步推进，便于断言防抖边界
function makeTimers() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => {
      const t = ++id;
      timers.set(t, { fn, at: now + ms });
      return t;
    },
    clearTimeout: (t) => { timers.delete(t); },
    tick: (ms) => {
      now += ms;
      const due = [...timers.entries()].filter(([, v]) => v.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [t, v] of due) {
        timers.delete(t);
        v.fn();
      }
    },
    pending: () => timers.size,
  };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const nextTick = () => new Promise((res) => setTimeout(res, 0));

test('停止输入约 800ms 后触发保存，此前不产生写请求', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-1' }; },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('基准，加一句');
  assert.equal(writes.length, 0);
  timers.tick(500);
  assert.equal(writes.length, 0, '防抖期内不得写盘');
  timers.tick(300);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], ['基准，加一句', 'fp-0']);
  await nextTick();
  assert.equal(sync.getState().status, SYNC_STATUS.saved);
  assert.equal(sync.getState().baseFingerprint, 'fp-1');
  sync.destroy();
});

test('内容相对共同基准未变化时不产生写请求（含改回原文）', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-1' }; },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '原文', fingerprint: 'fp-0' });
  sync.setDraft('原文'); // 无变化
  await sync.flush();
  sync.setDraft('改过');
  sync.setDraft('原文'); // 改回基准
  await sync.flush();
  assert.equal(writes.length, 0);
  sync.destroy();
});

test('连续输入：旧响应不覆盖新草稿，完成后续写最新版本', async () => {
  const timers = makeTimers();
  const writes = [];
  const d1 = deferred();
  let call = 0;
  const sync = createDocumentSync({
    write: (content, fp) => {
      call += 1;
      writes.push([content, fp]);
      return call === 1 ? d1.promise : Promise.resolve({ fingerprint: 'fp-2' });
    },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '', fingerprint: 'fp-0' });
  sync.setDraft('第一版');
  timers.tick(800);
  assert.equal(writes.length, 1, '首次防抖到点后写一次');
  sync.setDraft('第一版，继续输入');
  assert.equal(sync.getState().status, SYNC_STATUS.saving, '保存期间状态保持 saving');
  d1.resolve({ fingerprint: 'fp-1' });
  await nextTick();
  assert.deepEqual(writes[1], ['第一版，继续输入', 'fp-1'], '用最新指纹续写最新草稿');
  await nextTick();
  const state = sync.getState();
  assert.equal(state.status, SYNC_STATUS.saved);
  assert.equal(state.draft, '第一版，继续输入');
  assert.equal(state.baseContent, '第一版，继续输入');
  assert.equal(state.baseFingerprint, 'fp-2');
  sync.destroy();
});

test('保存失败保留草稿与基准，flush 可重试', async () => {
  const timers = makeTimers();
  const writes = [];
  let fail = true;
  const sync = createDocumentSync({
    write: async (content, fp) => {
      writes.push([content, fp]);
      if (fail) throw new Error('网络错误');
      return { fingerprint: 'fp-ok' };
    },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '基准', fingerprint: 'fp-0' });
  sync.setDraft('基准，新内容');
  timers.tick(800);
  await nextTick();
  let state = sync.getState();
  assert.equal(state.status, SYNC_STATUS.error);
  assert.equal(state.draft, '基准，新内容', '失败保留草稿');
  assert.equal(state.baseContent, '基准', '失败不推进基准');
  assert.equal(state.baseFingerprint, 'fp-0');
  fail = false;
  await sync.flush(); // 无新输入也允许重试
  assert.equal(writes.length, 2);
  state = sync.getState();
  assert.equal(state.status, SYNC_STATUS.saved);
  assert.equal(state.baseFingerprint, 'fp-ok');
  sync.destroy();
});

test('保存遇 409 进入 conflict 状态', async () => {
  const timers = makeTimers();
  const sync = createDocumentSync({
    write: async () => { const e = new Error('冲突'); e.status = 409; throw e; },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: 'a', fingerprint: 'fp-0' });
  sync.setDraft('b');
  timers.tick(800);
  await nextTick();
  const state = sync.getState();
  assert.equal(state.status, SYNC_STATUS.conflict);
  assert.equal(state.draft, 'b');
  assert.equal(state.baseContent, 'a');
  sync.destroy();
});

test('flush 取消防抖等待并立即保存', async () => {
  const timers = makeTimers();
  const writes = [];
  const sync = createDocumentSync({
    write: async (content, fp) => { writes.push([content, fp]); return { fingerprint: 'fp-1' }; },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '', fingerprint: 'fp-0' });
  sync.setDraft('马上走');
  await sync.flush();
  assert.equal(writes.length, 1, '未到防抖时点也立即写');
  assert.equal(timers.pending(), 0, '防抖计时器被取消');
  await nextTick();
  assert.equal(sync.getState().status, SYNC_STATUS.saved);
  sync.destroy();
});

test('flush 等待在途保存落地后续写最新草稿', async () => {
  const timers = makeTimers();
  const writes = [];
  const d1 = deferred();
  let call = 0;
  const sync = createDocumentSync({
    write: (content, fp) => {
      call += 1;
      writes.push([content, fp]);
      return call === 1 ? d1.promise : Promise.resolve({ fingerprint: 'fp-2' });
    },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  sync.start({ content: '', fingerprint: 'fp-0' });
  sync.setDraft('v1');
  timers.tick(800);
  const flushing = sync.flush();
  sync.setDraft('v2');
  d1.resolve({ fingerprint: 'fp-1' });
  await flushing;
  await nextTick();
  assert.deepEqual(writes.map((w) => w[0]), ['v1', 'v2'], '在途落地后保存了最新草稿');
  assert.equal(sync.getState().status, SYNC_STATUS.saved);
  sync.destroy();
});

test('状态变化通过 onChange 上报，单在途不并行写', async () => {
  const timers = makeTimers();
  const statuses = [];
  const d1 = deferred();
  let call = 0;
  const sync = createDocumentSync({
    write: () => {
      call += 1;
      return call === 1 ? d1.promise : Promise.resolve({ fingerprint: 'fp-2' });
    },
    debounceMs: 800,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onChange: (s) => statuses.push(s.status),
  });
  sync.start({ content: '', fingerprint: 'fp-0' });
  sync.setDraft('x');
  timers.tick(800); // 第一次保存挂起
  sync.setDraft('xy');
  timers.tick(800); // 防抖到点但在途 → 串行而非并行
  assert.equal(call, 1, '任何时刻最多一个在途写');
  d1.resolve({ fingerprint: 'fp-1' });
  await nextTick();
  await nextTick();
  assert.equal(call, 2, '落地后续写');
  assert.deepEqual(statuses, ['saved', 'dirty', 'saving', 'saving', 'dirty', 'saving', 'saved']);
  sync.destroy();
});
