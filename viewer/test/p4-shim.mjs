// 假 p4 可执行文件（测试专用）：按 P4SHIM_SPEC_FILE 指向的 JSON 规格文件脚本化响应
// （每次调用重新读文件，支持测试中途改行为），仿真真实 p4 的关键磁盘语义
// （move 改名、delete 删盘文件）；P4SHIM_LOG 记录每次调用（每行一个 JSON 数组）。
import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const [, , verb, ...rest] = process.argv;
const logFile = process.env.P4SHIM_LOG;
if (logFile) appendFileSync(logFile, JSON.stringify([verb, ...rest]) + '\n');
const spec = process.env.P4SHIM_SPEC_FILE
  ? JSON.parse(readFileSync(process.env.P4SHIM_SPEC_FILE, 'utf8') || '{}')
  : {};

function exit(code, msg) {
  if (msg) console.log(msg);
  process.exit(code);
}

// p4 -V 不联系服务器（真实 p4 离线时照常输出版本），先于 offline 判定
if (verb === '-V') exit(0, spec.version || 'Perforce - The Fast Software Configuration Management System.\nRev. P4/TEST/2026.1/123456');

if (spec.offline) exit(1, 'Perforce client error:\n\tPartner exited unexpectedly.');

if (verb === 'where') {
  if (spec.whereError) exit(1, spec.whereError);
  if (spec.mapped === false) exit(0, '');
  const cwd = process.cwd().replace(/\\/g, '/');
  exit(0, `//depot/trunk/${rest[0]} //client-shim/${rest[0]} ${cwd}/${rest[0]}`);
}

if (verb === 'info') exit(0, `User name: shim\nClient name: shim-client\nClient root: ${process.cwd()}\nServer address: shim:1666`);

if (verb === 'fstat') {
  const rel = rest[0].split(path.sep).join('/');
  const st = (spec.files || {})[rel];
  if (!st || st === 'unmanaged') exit(0, `${rel} - no such file(s).`);
  const clientFile = path.join(process.cwd(), rel);
  if (st === 'add') {
    exit(0, `... depotFile //depot/trunk/${rel}\n... clientFile ${clientFile}\n... action add\n... change default\n... workRev 1`);
  }
  const openLine = st.open ? `... action ${st.open}\n... change default\n` : '';
  exit(0, `... depotFile //depot/trunk/${rel}\n... clientFile ${clientFile}\n${openLine}... headRev 1\n... headAction add\n... haveRev 1`);
}

if (verb === 'edit') {
  const rel = rest[0].split(path.sep).join('/');
  const st = (spec.files || {})[rel];
  if (st === 'unmanaged' || !st) exit(0, `${rel} - file(s) not on client.`);
  if (spec.editFail) exit(1, spec.editFail);
  if (spec.chmodWritable) {
    try { chmodSync(rest[0], 0o666); } catch { /* 只读语义以平台为准 */ }
  }
  exit(0, `${rel}#1 - opened for edit`);
}

if (verb === 'delete') {
  if (spec.deleteFail) exit(1, spec.deleteFail);
  for (const f of rest) {
    try { unlinkSync(f); } catch { /* 真实 p4 delete 亦容忍已不在盘上的文件 */ }
  }
  exit(0, rest.map((f) => `${f}#1 - opened for delete`).join('\n'));
}

if (verb === 'move') {
  if (spec.moveFail) exit(1, spec.moveFail);
  const [oldFile, newFile] = rest;
  if (spec.moveTargetExists) exit(1, `${newFile} - can't overwrite existing file.`);
  try {
    mkdirSync(path.dirname(newFile), { recursive: true });
    renameSync(oldFile, newFile);
  } catch (error) {
    exit(1, String(error.message || error));
  }
  exit(0, `${newFile}#1 - moved from ${oldFile}`);
}

if (verb === 'revert') {
  if (spec.revertFail) exit(1, spec.revertFail);
  exit(0, rest.map((f) => `${f} - was opened, reverted`).join('\n'));
}

if (verb === 'add') {
  if (spec.addFail) exit(1, spec.addFail);
  exit(0, rest.map((f) => `${f}#1 - opened for add`).join('\n'));
}

exit(0, '');
