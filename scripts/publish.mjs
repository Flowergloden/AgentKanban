import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const versionFiles = [
  'viewer/kimi.plugin.json',
  'viewer/.codex-plugin/plugin.json',
  'viewer/.claude-plugin/plugin.json',
  'viewer/service.json',
];
const releaseMessage = (version) => `chore(kanban): 版本号更新至 ${version} 并同步测试版本样例`;

export function parseVersion(input) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(input ?? '').trim());
  if (!match) throw new Error(`无效版本号: ${input}（应为 X.Y.Z 或 vX.Y.Z）`);
  return match.slice(1).join('.');
}

export function nextPatch(version) {
  const [major, minor, patch] = parseVersion(version).split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }

async function git(repo, args) {
  const { stdout } = await exec('git', ['-C', repo, ...args]);
  return stdout.trim();
}

export async function currentVersion(repo) {
  const seen = await Promise.all(versionFiles.map(async (rel) => ({ rel, version: (await readJson(path.join(repo, rel))).version })));
  const distinct = [...new Set(seen.map((entry) => entry.version))];
  if (distinct.length !== 1)
    throw new Error(`版本清单不一致: ${seen.map((entry) => `${entry.rel}=${entry.version}`).join(', ')}`);
  return distinct[0];
}

export async function rewriteVersion(repo, from, to) {
  const targets = [...versionFiles];
  const testDir = path.join(repo, 'viewer', 'test');
  for (const name of await fs.readdir(testDir))
    if (name.endsWith('.test.mjs')) targets.push(`viewer/test/${name}`);
  const changed = [];
  for (const rel of targets) {
    const file = path.join(repo, rel);
    const before = await fs.readFile(file, 'utf8');
    if (!before.includes(from)) continue;
    await fs.writeFile(file, before.split(from).join(to));
    changed.push(rel);
  }
  return changed;
}

export async function publish({ repo, version, confirm, remote = 'origin' }) {
  await git(repo, ['rev-parse', '--is-inside-work-tree']);
  const from = await currentVersion(repo);
  const to = version ? parseVersion(version) : nextPatch(from);
  const tag = `v${to}`;
  if (to === from) throw new Error(`新版本与当前版本相同: ${to}（可传入参数指定其他版本号）`);
  if (await git(repo, ['tag', '-l', tag])) throw new Error(`tag ${tag} 已存在`);
  const branch = await git(repo, ['branch', '--show-current']);
  if (!branch) throw new Error('detached HEAD 状态，请先切换到分支再发版');
  const status = await git(repo, ['status', '--porcelain']);
  const dirty = status ? status.split('\n') : [];

  console.log(`发版计划: ${from} -> ${to} (${tag})，分支 ${branch} -> ${remote}`);
  console.log(`提交信息: ${releaseMessage(to)}`);
  if (dirty.length > 0) {
    console.log(`警告: 本地有 ${dirty.length} 处未提交的更改:`);
    for (const line of dirty) console.log(`  ${line}`);
    if (!confirm || !await confirm(`仍要继续发版 ${tag} 吗？只会提交版本相关文件，其余更改保持未提交。[y/N] `))
      throw new Error('已取消: 本地存在未提交的更改');
  }

  const changed = await rewriteVersion(repo, from, to);
  const message = releaseMessage(to);
  await git(repo, ['commit', '-m', message, '--', ...changed]);
  await git(repo, ['tag', '-a', tag, '-m', message]);
  await git(repo, ['push', remote, branch]);
  await git(repo, ['push', remote, tag]);
  console.log(`完成: ${tag} 已推送，CI 将基于该 tag 构建 Release`);
  return { from, to, tag, branch, changed, dirty: dirty.length };
}

async function confirmInteractive(question) {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()); }
  finally { rl.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const repo = fileURLToPath(new URL('..', import.meta.url));
  try {
    if (args.length > 1) throw new Error('usage: node scripts/publish.mjs [vX.Y.Z]');
    await publish({ repo, version: args[0] || undefined, confirm: confirmInteractive });
  } catch (error) {
    console.error(`发版失败: ${error.message}`);
    process.exitCode = 1;
  }
}
