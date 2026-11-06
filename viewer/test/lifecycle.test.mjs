import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLifecycle, IDLE_TIMEOUT_MS, CHECK_INTERVAL_MS } from '../server/lifecycle.mjs';
import { canonicalRoot } from '../server/registry.mjs';
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
    assert.deepEqual(projects.map(({ root }) => root), [canonicalRoot(root)]);
    assert.equal(projects[0].state, 'pending');
  });
});

test('auto-discovery never escalates; confirm/ignore transitions persist across restart', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const root = 'C:\\auto\\discovered';
    const registryFile = async (name) => JSON.parse(await readFile(path.join(dir, 'data', 'registry.json'), 'utf8')).projects[name];
    const post = (p, body) => fetch(url + p, json(body));
    const stateOf = async () => (await (await fetch(url + '/api/projects')).json())[0];

    assert.equal((await post('/api/register', { root })).status, 200);
    assert.equal((await stateOf()).state, 'pending');
    // 重复自动发现：仍只有一条 pending，lastSeen 刷新
    assert.equal((await post('/api/activity', { root })).status, 200);
    assert.equal((await post('/api/heartbeat', { root })).status, 200);
    let projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].state, 'pending');
    assert.equal(projects[0].lastSeen > 0, true);

    // 确认 -> registered，落盘保留
    assert.equal((await post('/api/projects/confirm', { root })).status, 200);
    assert.equal((await stateOf()).state, 'registered');
    assert.equal((await registryFile(canonicalRoot(root))).state, 'registered');
    // 已注册项目自动发现仅刷新 lastSeen，状态保持
    assert.equal((await post('/api/register', { root })).status, 200);
    projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].state, 'registered');

    // 忽略 -> ignored，lastSeen 不回退；自动发现不再改项目记录但仍续期服务
    const seenBefore = projects[0].lastSeen;
    assert.equal((await post('/api/projects/ignore', { root })).status, 200);
    assert.equal((await stateOf()).state, 'ignored');
    assert.equal((await registryFile(canonicalRoot(root))).state, 'ignored');
    assert.equal((await post('/api/activity', { root })).status, 200);
    assert.equal((await post('/api/register', { root })).status, 200);
    projects = await (await fetch(url + '/api/projects')).json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].state, 'ignored');
    assert.equal(projects[0].lastSeen, seenBefore);

    // 取消忽略（confirm）恢复 registered
    assert.equal((await post('/api/projects/confirm', { root })).status, 200);
    assert.equal((await stateOf()).state, 'registered');
  });
});

test('injected registry write failure leaves disk and memory untouched', async (t) => {
  await withServer(t, async ({ url, dir }) => {
    const post = (p, body) => fetch(url + p, json(body));
    const root = 'C:\\fail\\write';
    const failed = await post('/api/register', { root });
    assert.equal(failed.status, 500);
    assert.match((await failed.json()).error, /注册表写入失败/);
    // 内存未提交
    assert.deepEqual(await (await fetch(url + '/api/projects')).json(), []);
    // 磁盘未创建注册表文件
    await assert.rejects(readFile(path.join(dir, 'data', 'registry.json')), /ENOENT/);
    // 人工操作同样失败且不产生部分状态
    assert.equal((await post('/api/projects/confirm', { root })).status, 500);
    assert.deepEqual(await (await fetch(url + '/api/projects')).json(), []);
  }, { env: { AGENT_KANBAN_FAIL_REGISTRY_WRITE: '1' } });
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
