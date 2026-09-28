import test from 'node:test';
import assert from 'node:assert/strict';
import { watchVisibleActivity } from '../web/visibility.js';

function harness() {
  const events = new Map();
  const doc = { visibilityState: 'visible', addEventListener: (k, cb) => events.set(k, cb), removeEventListener: (k) => events.delete(k) };
  const win = { addEventListener: (k, cb) => events.set(k, cb), removeEventListener: (k) => events.delete(k) };
  let callback;
  let period;
  let cleared = false;
  let count = 0;
  let lost = 0;
  let restored = 0;
  let fail = false;
  const cleanup = watchVisibleActivity({
    document: doc, window: win,
    send: async () => { count++; if (fail) throw new Error('offline'); },
    onLost: () => { lost++; }, onRestored: () => { restored++; },
    setInterval: (cb, ms) => { callback = cb; period = ms; return 17; },
    clearInterval: (id) => { assert.equal(id, 17); cleared = true; },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { doc, events, cleanup, flush, tick: () => callback(), get period() { return period; }, get count() { return count; }, get lost() { return lost; }, get restored() { return restored; }, get cleared() { return cleared; }, set fail(value) { fail = value; } };
}

test('only visible page renews approximately every 60 seconds and on visibility return', async () => {
  const h = harness();
  await h.flush();
  assert.equal(h.count, 1);
  assert.equal(h.period, 60_000);
  h.doc.visibilityState = 'hidden';
  h.tick(); h.tick();
  assert.equal(h.count, 1);
  h.doc.visibilityState = 'visible';
  h.events.get('visibilitychange')();
  await h.flush();
  assert.equal(h.count, 2);
  h.tick();
  assert.equal(h.count, 3);
  h.cleanup();
  assert.equal(h.cleared, true);
  assert.equal(h.events.size, 0);
  h.tick();
  assert.equal(h.count, 3);
});

test('offline warning is shown once and clears only on confirmed HTTP recovery', async () => {
  const h = harness();
  await h.flush();
  h.fail = true;
  h.tick(); await h.flush();
  h.tick(); await h.flush();
  assert.equal(h.lost, 1);
  h.fail = false;
  h.tick(); await h.flush();
  assert.equal(h.restored, 1);
  h.cleanup();
});
