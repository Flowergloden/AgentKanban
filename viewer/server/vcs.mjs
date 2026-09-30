import { spawn } from 'node:child_process';
import path from 'node:path';

export const P4_TIMEOUT_MS = 10_000;

// p4 调用的三态分类：
// - ok        操作成功（含 p4 语义内无害的幂等 no-op，如对 open-for-add 执行 edit）
// - unmanaged p4 报告目标未纳入管理（"not on client" 类），调用方落回普通文件操作
// - hard-fail 携带 reason，调用方 MUST NOT 落回普通写盘，应把原因上报给用户
export function classifyP4Output(code, out, err) {
  const combined = `${out || ''}\n${err || ''}`;
  if (code === 0) {
    if (/not on client|no such file|not under client|not in client view|is unmapped|not mapped/i.test(combined)) {
      return { state: 'unmanaged' };
    }
    return { state: 'ok' };
  }
  return { state: 'hard-fail', reason: summarizeP4Output(err || out) || `p4 退出码 ${code}` };
}

// 压缩 p4 输出为单行原因（取前若干条非空行，去除重复行）
export function summarizeP4Output(output, maxLines = 3, maxChars = 300) {
  const seen = new Set();
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  const text = lines.slice(0, maxLines).join('；');
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}

// 解析 p4 fstat 输出：
// - unmanaged 无 depotFile 记录（未托管：输出 "no such file(s)."）
// - add       open-for-add（无 depot 版本，action 为 add）
// - depot     已入 depot（open 为 null 或 'edit' 等打开状态；rename 可直接 move，remove 需先 revert 再 delete）
export function parseFstat(output) {
  if (!/\.\.\. depotFile\s/.test(output)) return { file: 'unmanaged', open: null };
  const open = output.match(/\.\.\. action (\S+)/)?.[1] || null;
  if (open === 'add') return { file: 'add', open };
  return { file: 'depot', open };
}

// 以项目根为工作目录执行 p4；AGENT_KANBAN_P4_SHIM 为测试接缝（指向假 p4 脚本时经 node 执行）
function runP4(root, args) {
  return new Promise((resolve) => {
    const shim = process.env.AGENT_KANBAN_P4_SHIM;
    const file = shim ? process.execPath : 'p4';
    const finalArgs = shim ? [shim, ...args] : args;
    let child;
    try {
      // 显式同步 PWD：部分 p4 构建优先按 PWD 环境变量解析相对路径参数（实测会盖过 spawn 的 cwd），
      // 从 shell 继承的过期 PWD 会让 p4 where/fstat 等把相对路径解析到错误目录
      child = spawn(file, finalArgs, { cwd: root, env: { ...process.env, PWD: root }, timeout: P4_TIMEOUT_MS, windowsHide: true });
    } catch (error) {
      resolve({ code: null, out: '', err: String(error?.message || error), spawnFailed: true });
      return;
    }
    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (error) => {
      resolve({ code: null, out, err: err + String(error?.message || error), spawnFailed: true });
    });
    child.on('close', (code, signal) => {
      timedOut = code === null && signal !== null;
      resolve({
        code,
        out,
        err,
        spawnFailed: false,
        timedOut,
      });
    });
  });
}

// 相对项目根的路径（p4 命令行参数；统一 "/" 分隔符）
function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

async function runVerb(root, verbArgs) {
  const r = await runP4(root, verbArgs);
  if (r.spawnFailed && /ENOENT/i.test(r.err)) {
    // PATH 无 p4：按未纳入管理处理，调用方落回普通文件操作
    return { state: 'unmanaged' };
  }
  if (r.timedOut) {
    return { state: 'hard-fail', reason: `p4 ${verbArgs[0]} 调用超时（${P4_TIMEOUT_MS / 1000} 秒）` };
  }
  return classifyP4Output(r.code, r.out, r.err);
}

// 检测项目 kanban/ 是否受 P4 管理：'p4' | null（非受管/无 CLI）| 'unknown'（服务器不可达，保持既有缓存）
export async function detect(root) {
  const version = await runP4(root, ['-V']);
  if (version.spawnFailed) return null; // 无 p4 CLI 或不可执行：按非 P4 处理
  if (version.code !== 0) return null;
  const where = await runP4(root, ['where', 'kanban/...']);
  if (where.code === 0) {
    return where.out.trim() ? 'p4' : null; // 有映射输出=受管；空输出=视图内未映射
  }
  // p4 where 并非纯客户端计算（实测服务器不可达时 exit 1 无输出）：退回 p4 info 分类
  const info = await runP4(root, ['info']);
  if (info.code === 0) return null; // 服务器可达但 kanban/ 未映射
  return 'unknown'; // 服务器不可达/鉴权失败：不覆写既有缓存，行为按非 P4
}

export function edit(root, file) {
  return runVerb(root, ['edit', rel(root, file)]);
}

export function add(root, files) {
  return runVerb(root, ['add', ...files.map((f) => rel(root, f))]);
}

export function del(root, file) {
  return runVerb(root, ['delete', rel(root, file)]);
}

export function move(root, oldFile, newFile) {
  return runVerb(root, ['move', rel(root, oldFile), rel(root, newFile)]);
}

export function revert(root, file) {
  return runVerb(root, ['revert', rel(root, file)]);
}

// fstat 门控：成功时携带 parseFstat 结果；失败时 hard-fail
export async function fstat(root, file) {
  const r = await runP4(root, ['fstat', rel(root, file)]);
  if (r.timedOut) return { state: 'hard-fail', reason: `p4 fstat 调用超时（${P4_TIMEOUT_MS / 1000} 秒）` };
  if (r.code !== 0) {
    return { state: 'hard-fail', reason: summarizeP4Output(r.err || r.out) || `p4 退出码 ${r.code}` };
  }
  return { state: 'ok', ...parseFstat(`${r.out}\n${r.err}`) };
}

// 注册表 vcs 字段的内存镜像（key 为归一化 root；无条目=未检测，读路径按非 P4 处理）
const cache = new Map();

export function setCached(root, type) {
  if (type === 'p4' || type === null) cache.set(String(root).replace(/\\/g, '/'), type);
}

export function getCached(root) {
  return cache.get(String(root).replace(/\\/g, '/')) ?? null;
}
