import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadServiceMetadata } from '../server/metadata.mjs';

test('service metadata is independent of host manifest and protocol release version', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kanban-metadata-'));
  try {
    const file = path.join(dir, 'service.json');
    await writeFile(file, JSON.stringify({ version: '7.8.9', protocolVersion: 2 }));
    assert.deepEqual(await loadServiceMetadata(pathToFileURL(file)), { version: '7.8.9', protocolVersion: 2 });
    await writeFile(file, JSON.stringify({ version: '7.8.10', protocolVersion: 2 }));
    assert.equal((await loadServiceMetadata(pathToFileURL(file))).protocolVersion, 2);
    await writeFile(file, JSON.stringify({ version: '7.8.10', protocolVersion: '7.8.10' }));
    await assert.rejects(loadServiceMetadata(pathToFileURL(file)), /protocolVersion/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
