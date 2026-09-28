import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifecycle, IDLE_TIMEOUT_MS, CHECK_INTERVAL_MS } from '../server/lifecycle.mjs';
import { withServer } from './fixture.mjs';

const json = (value) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

test('activity resets idle timer; persistent ignores idle; cancel resets timer', () => {
  let now = 0;
  const state = createLifecycle({ now: () => now });
  now = IDLE_TIMEOUT_MS;
  assert.equal(state.expired(), false);
  now += CHECK_INTERVAL_MS;
  assert.equal(state.expired(), true);
  state.activity();
  assert.equal(state.expired(), false);
  state.setMode('persistent');
  now += IDLE_TIMEOUT_MS * 2;
  assert.equal(state.expired(), false);
  state.setMode('auto');
  assert.equal(state.expired(), false);
  now += IDLE_TIMEOUT_MS + 1;
  assert.equal(state.expired(), true);
});

test('registration, activity, heartbeat and business requests work; invalid requests do not record project', async (t) => {
  await withServer(t, async ({ url }) => {
    const root = 'C:\\临时 项目\\kanban';
    assert.equal((await fetch(url + '/api/register', json({ root }))).status, 200);
    assert.equal((await fetch(url + '/api/activity', json({ root: 5 }))).status, 400);
    assert.equal((await fetch(url + '/api/heartbeat', json({ root: '' }))).status, 400);
    assert.equal((await fetch(url + '/api/activity', json({}))).status, 200);
    assert.equal((await fetch(url + '/api/heartbeat', json({}))).status, 200);
    const projects = await (await fetch(url + '/api/projects')).json();
    assert.deepEqual(projects.map(({ root }) => root), ['C:/临时 项目/kanban']);
  });
});

test('health/status are read-only; mode validation and origin guard preserve state', async (t) => {
  await withServer(t, async ({ url }) => {
    const mode = (body, extra = {}) => fetch(url + '/api/service/mode', { ...json(body), ...extra });
    assert.equal((await (await fetch(url + '/api/health')).json()).mode, 'auto');
    assert.equal((await mode({ mode: 'persistent' })).status, 200);
    assert.equal((await (await fetch(url + '/api/service/status')).json()).mode, 'persistent');
    assert.equal((await mode({ mode: 'wrong' })).status, 400);
    assert.equal((await mode({ mode: 'auto' }, { headers: { origin: 'http://evil.test', 'content-type': 'application/json' } })).status, 403);
    assert.equal((await mode({ mode: 'auto' }, { headers: { origin: url, 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await (await fetch(url + '/api/health')).json()).mode, 'persistent');
    assert.equal((await mode({ mode: 'auto' }, { headers: { origin: url, 'content-type': 'application/json' } })).status, 200);
    assert.equal((await (await fetch(url + '/api/health')).json()).mode, 'auto');
  });
});
