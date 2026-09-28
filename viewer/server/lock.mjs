import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { registryPaths } from './registry.mjs';

export function lockPath() { return path.join(registryPaths().dataDir, 'service.lock'); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stale(file, io) {
  let content;
  try { content = await io.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  let owner;
  try { owner = JSON.parse(content); } catch { owner = {}; }
  if (Number.isInteger(owner.pid) && owner.pid > 0) {
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if (error.code !== 'ESRCH') return false; }
  } else {
    const stat = await io.stat(file);
    if (Date.now() - stat.mtimeMs < 10_000) return false;
  }
  // Avoid deleting a lock that has changed between reads.
  if (await io.readFile(file, 'utf8') === content) await io.unlink(file);
  return true;
}

export async function acquireLock({ file = lockPath(), waitMs = 4000, io = fs } = {}) {
  await io.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const token = randomUUID();
    try {
      await io.writeFile(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
      let released = false;
      const release = async () => {
        if (released) return;
        released = true;
        try {
          const owner = JSON.parse(await io.readFile(file, 'utf8'));
          if (owner.token === token) await io.unlink(file);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      };
      release.token = token;
      return release;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    try { if (await stale(file, io)) continue; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.now() >= deadline) {
      const error = new Error('service coordination busy; retry');
      error.code = 'busy';
      throw error;
    }
    await sleep(80);
  }
}

export async function ownsLock(token, file = lockPath()) {
  if (!token) return false;
  try { return JSON.parse(await fs.readFile(file, 'utf8')).token === token; }
  catch { return false; }
}
