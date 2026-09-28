import test from 'node:test';
import assert from 'node:assert/strict';
import { changeServiceMode, stopServiceWithConfirmation } from '../web/service-controls.js';

function state() {
  const calls = { busy: [], modes: [], notices: [] };
  return { calls, setBusy: (value) => calls.busy.push(value), setMode: (value) => calls.modes.push(value), setNotice: (value) => calls.notices.push(value) };
}

test('mode success uses acknowledged state, while errors retain previous state and 409 is retryable', async () => {
  const success = state();
  assert.equal(await changeServiceMode('persistent', { ...success, setModeApi: async () => ({ mode: 'persistent' }) }), true);
  assert.deepEqual(success.calls.modes, ['persistent']);
  assert.deepEqual(success.calls.busy, [true, false]);
  const conflict = state();
  assert.equal(await changeServiceMode('auto', { ...conflict, setModeApi: async () => { throw Object.assign(new Error('busy'), { status: 409 }); } }), false);
  assert.deepEqual(conflict.calls.modes, []);
  assert.match(conflict.calls.notices[0], /请重试/);
  const failure = state();
  assert.equal(await changeServiceMode('auto', { ...failure, setModeApi: async () => { throw new Error('offline'); } }), false);
  assert.deepEqual(failure.calls.modes, []);
  assert.match(failure.calls.notices[0], /offline/);
});

test('cancelled global stop sends no request; confirmed stop updates only on success', async () => {
  let sent = 0;
  const cancelled = state();
  assert.equal(await stopServiceWithConfirmation({ ...cancelled, confirm: (message) => { assert.match(message, /所有项目/); return false; }, stop: async () => { sent++; } }), false);
  assert.equal(sent, 0);
  assert.deepEqual(cancelled.calls.busy, []);
  const failed = state();
  assert.equal(await stopServiceWithConfirmation({ ...failed, confirm: () => true, stop: async () => { sent++; throw Object.assign(new Error('busy'), { status: 409 }); } }), false);
  assert.deepEqual(failed.calls.modes, []);
  assert.match(failed.calls.notices[0], /重试/);
  const stopped = state();
  assert.equal(await stopServiceWithConfirmation({ ...stopped, confirm: () => true, stop: async () => { sent++; } }), true);
  assert.deepEqual(stopped.calls.modes, [null]);
  assert.equal(sent, 2);
});
