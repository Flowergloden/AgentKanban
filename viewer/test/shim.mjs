// 假 p4 测试接缝：与 test/p4-shim.mjs 配套。
// 在当前进程注入 AGENT_KANBAN_P4_SHIM/P4SHIM_SPEC_FILE/P4SHIM_LOG（由 vcs.mjs 惰性读取），
// 规格写入临时文件并经 P4SHIM_SPEC_FILE 传递：shim 每次调用重新读文件，
// 因此服务子进程启动后测试仍可改行为；返回 setSpec 用于中途改规格。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const shimPath = fileURLToPath(new URL('./p4-shim.mjs', import.meta.url));

export function useShim(t, spec = {}, logFile = null) {
  const prev = {
    AGENT_KANBAN_P4_SHIM: process.env.AGENT_KANBAN_P4_SHIM,
    P4SHIM_SPEC_FILE: process.env.P4SHIM_SPEC_FILE,
    P4SHIM_LOG: process.env.P4SHIM_LOG,
  };
  const specFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'kanban-p4spec-')), 'spec.json');
  writeFileSync(specFile, JSON.stringify(spec));
  process.env.AGENT_KANBAN_P4_SHIM = shimPath;
  process.env.P4SHIM_SPEC_FILE = specFile;
  if (logFile) process.env.P4SHIM_LOG = logFile;
  else delete process.env.P4SHIM_LOG;
  t.after(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return (next) => writeFileSync(specFile, JSON.stringify(next));
}

export async function shimLog(logFile) {
  try {
    const raw = await readFile(logFile, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
