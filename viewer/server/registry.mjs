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

// 项目条目：{ lastSeen, vcs? }；vcs = { type: 'p4' | null, checkedAt }（type 为 null 表示检测过、非 P4；缺省表示未检测）
// 兼容旧数据：值为 lastSeen 数字
function normalizeEntry(entry) {
  const raw = typeof entry === 'number' ? { lastSeen: entry } : entry;
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.lastSeen)) return null;
  const out = { lastSeen: raw.lastSeen };
  if (raw.vcs && typeof raw.vcs === 'object' &&
      (raw.vcs.type === 'p4' || raw.vcs.type === null) && Number.isFinite(raw.vcs.checkedAt)) {
    out.vcs = { type: raw.vcs.type, checkedAt: raw.vcs.checkedAt };
  }
  return out;
}

export function parseRegistry(raw, source) {
  let value;
  try { value = JSON.parse(raw); }
  catch (error) { throw new Error(`注册表损坏：${source}: ${error.message}`); }
  if (!value || typeof value.projects !== 'object' || Array.isArray(value.projects) || value.projects === null)
    throw new Error(`注册表格式错误：${source}`);
  const entries = new Map();
  for (const [root, entry] of Object.entries(value.projects)) {
    if (!root) continue;
    const next = normalizeEntry(entry);
    if (!next) continue;
    const key = normalizeRoot(root);
    const prev = entries.get(key);
    if (!prev) {
      entries.set(key, next);
      continue;
    }
    // 同项目重复条目：lastSeen 取较大者；vcs 取 checkedAt 较新者
    const winner = prev.lastSeen >= next.lastSeen ? prev : next;
    const loser = winner === prev ? next : prev;
    if (!winner.vcs && loser.vcs) winner.vcs = loser.vcs;
    entries.set(key, winner);
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
    const stored = JSON.parse(raw).projects;
    if (Object.keys(stored).length !== projects.size ||
        Object.keys(stored).some((root) => normalizeRoot(root) !== root || typeof stored[root] === 'number'))
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
