import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// 项目注册状态：待确认 / 已注册 / 已忽略；缺失或非法状态一律兼容为已注册
export const PROJECT_STATES = ['pending', 'registered', 'ignored'];
export const DEFAULT_STATE = 'registered';

export function registryPaths(env = process.env, home = os.homedir()) {
  const dataDir = env.AGENT_KANBAN_HOME || path.join(home, '.agent-kanban');
  const oldHome = env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
  return {
    dataDir,
    registryFile: path.join(dataDir, 'registry.json'),
    legacyFile: path.join(oldHome, 'kanban-viewer', 'registry.json'),
  };
}

// 既有斜杠归一化（旧数据兼容读取的最小处理）
export function normalizeRoot(root) {
  return root.replace(/\\/g, '/');
}

// 新输入（注册与状态操作）的绝对路径规范化键：解析 . 片段与尾斜杠、统一 "/" 分隔符；
// Windows 下大小写折叠合并别名。非绝对路径返回 null，由调用方报错。
export function canonicalRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return null;
  let norm = path.normalize(root).replace(/\\/g, '/');
  norm = norm.replace(/\/+$/, '');
  if (/^[a-zA-Z]:$/.test(norm)) norm += '/'; // 盘符根保留尾部斜杠
  if (process.platform === 'win32') norm = norm.toLowerCase();
  return norm;
}

// 旧注册表键迁移：绝对路径按规范键合并别名；相对路径仅做斜杠归一化（不依赖服务 cwd 改写）
function migrateKey(root) {
  return canonicalRoot(root) ?? normalizeRoot(root);
}

// 项目条目：{ lastSeen, state, vcs? }；vcs = { type: 'p4' | null, checkedAt }（type 为 null 表示检测过、非 P4；缺省表示未检测）
// 兼容旧数据：值为 lastSeen 数字，或缺少 state 的对象条目（一律视为已注册）
function normalizeEntry(entry) {
  const raw = typeof entry === 'number' ? { lastSeen: entry } : entry;
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.lastSeen)) return null;
  const out = {
    lastSeen: raw.lastSeen,
    state: PROJECT_STATES.includes(raw.state) ? raw.state : DEFAULT_STATE,
  };
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
    const key = migrateKey(root);
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
    // 键或条目形状（缺 state、数字值、非法 vcs）经归一化后有变化时原子写回
    const stored = JSON.parse(raw).projects;
    const normalized = Object.fromEntries(projects);
    const changed = Object.keys(stored).length !== Object.keys(normalized).length ||
      Object.keys(stored).some((root) =>
        !Object.prototype.hasOwnProperty.call(normalized, root) ||
        JSON.stringify(stored[root]) !== JSON.stringify(normalized[root]));
    if (changed) await saveRegistry(paths.registryFile, projects, io);
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
