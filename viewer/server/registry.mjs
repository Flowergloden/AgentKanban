import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function registryPaths(env = process.env, home = os.homedir()) {
  const dataDir = env.AGENT_KANBAN_HOME || path.join(home, '.agent-kanban');
  const oldHome = env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
  return {
    dataDir,
    registryFile: path.join(dataDir, 'registry.json'),
    legacyFile: path.join(oldHome, 'kanban-viewer', 'registry.json'),
  };
}

export function normalizeRoot(root) {
  return root.replace(/\\/g, '/');
}

export function parseRegistry(raw, source) {
  let value;
  try { value = JSON.parse(raw); }
  catch (error) { throw new Error(`注册表损坏：${source}: ${error.message}`); }
  if (!value || typeof value.projects !== 'object' || Array.isArray(value.projects) || value.projects === null)
    throw new Error(`注册表格式错误：${source}`);
  const entries = new Map();
  for (const [root, lastSeen] of Object.entries(value.projects)) {
    if (!root || !Number.isFinite(lastSeen)) continue;
    const key = normalizeRoot(root);
    entries.set(key, Math.max(lastSeen, entries.get(key) ?? -Infinity));
  }
  return entries;
}

export async function saveRegistry(file, projects, io = fs) {
  await io.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await io.writeFile(temp, JSON.stringify({ projects: Object.fromEntries(projects) }, null, 2));
    await io.rename(temp, file);
  } catch (error) {
    try { await io.unlink(temp); } catch { /* a failed cleanup must not hide the write error */ }
    throw new Error(`注册表写入失败：${file}: ${error.message}`);
  }
}

export async function loadRegistry(paths = registryPaths(), io = fs) {
  try {
    const raw = await io.readFile(paths.registryFile, 'utf8');
    const projects = parseRegistry(raw, paths.registryFile);
    if (Object.keys(JSON.parse(raw).projects).length !== projects.size ||
        Object.keys(JSON.parse(raw).projects).some((root) => normalizeRoot(root) !== root))
      await saveRegistry(paths.registryFile, projects, io);
    return projects;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let old;
  try { old = await io.readFile(paths.legacyFile, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error(`旧注册表读取失败：${paths.legacyFile}: ${error.message}`);
  }
  const projects = parseRegistry(old, paths.legacyFile);
  await saveRegistry(paths.registryFile, projects, io);
  return projects;
}
