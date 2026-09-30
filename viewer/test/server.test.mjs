import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './fixture.mjs';

test('health reports service metadata with no Kimi manifest present', async (t) => {
  await withServer(t, ({ healthy }) => {
    assert.equal(healthy.ok, true);
    assert.equal(healthy.name, 'kanban-viewer');
    assert.equal(healthy.version, '0.2.8');
    assert.equal(healthy.protocolVersion, 1);
  }, { isolatedCopy: true });
});
