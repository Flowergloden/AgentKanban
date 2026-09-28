import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './fixture.mjs';
import { createLifecycle, IDLE_TIMEOUT_MS, CHECK_INTERVAL_MS } from '../server/lifecycle.mjs';

test('clock injection makes idle boundary deterministic', () => {
  let tick = 0;
  const lifecycle = createLifecycle({ now: () => tick });
  tick = IDLE_TIMEOUT_MS;
  assert.equal(lifecycle.expired(), false);
  tick++;
  assert.equal(lifecycle.expired(), true);
  assert.equal(CHECK_INTERVAL_MS, 30_000);
});

test('isolated child uses only test port and data dir and is reaped', async (t) => {
  let child;
  let testPort;
  await withServer(t, async ({ url, dir, child: process, childEnv }) => {
    child = process;
    testPort = Number(new URL(url).port);
    assert.notEqual(testPort, 4731);
    assert.ok(process.spawnargs.includes('server.mjs') || process.spawnargs.some((arg) => arg.endsWith('server.mjs')));
    assert.ok(process.spawnargs.every((arg) => !arg.includes('4731')));
    assert.equal(childEnv.AGENT_KANBAN_HOME.startsWith(dir), true);
    assert.equal(childEnv.KIMI_CODE_HOME.startsWith(dir), true);
  });
  t.after(() => assert.ok(child.exitCode !== null || child.signalCode !== null, 'owned child was reaped'));
});
