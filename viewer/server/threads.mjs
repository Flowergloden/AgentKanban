import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as vcs from './vcs.mjs';

const VALID_STATUSES = ['立项', '规划', '实现', '完成'];
const REQUIRED_SECTIONS = ['目标', '已完成的工作', '决策', 'Changes'];

class ThreadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fingerprint(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function kanbanDir(root) {
  return path.join(root, 'kanban');
}

function threadsDir(root) {
  return path.join(kanbanDir(root), 'threads');
}

// 内置默认卷宗模板：内容与 kanban/templates/thread.md 保持一致（项目模板缺失时兜底创建）
const DEFAULT_THREAD_TEMPLATE = `# <线程标题>

status: 立项

<!-- 状态可选值：立项、规划、实现、完成。流转方式：直接修改上一行的 status 值。 -->

## 目标

<!-- 创建时填写：这条线程要达成的笼统目标（如实现某模块、验证某想法）。 -->

## 已完成的工作

<!-- 每完成一段工作，在此追加一条记录（含日期与概要），小需求一句话即可，无需关联 change。若使用 OpenSpec：属于本线程的 change 归档后，其蒸馏总结也追加在这里。 -->

## 决策

<!-- 每条决策 MUST 同时包含"决定了什么"与"为什么"，格式：
- **决定**：……
  **原因**：……
-->

## Changes

<!-- （可选）关联的 OpenSpec change 名字列表，仅当本线程使用 OpenSpec 工作流时才登记；不使用时留空即可。一行一条（仅名字，松耦合引用），例如：
- add-xxx
-->

## 依赖

<!-- （可选）本线程依赖的其他线程：纯序号、一行一条，仅记录关系，不约束状态流转或完成。 -->
`;

// 内置默认全局便签：内容与语义见 kanban/README.md（仅供人类阅读，不参与工作流）
const DEFAULT_NOTE_TEMPLATE = `<!-- 全局便签（kanban/note.md）：仅供人类随手记录，不参与任何工作流——Agent 不读取、不采用此处内容。看板页面头部「便签」按钮可读写本文件，也可用任意文本编辑器直接编辑。 -->
`;

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// 幂等补齐 kanban 最小结构，返回 { created }（本次新建的路径列表，相对 root 的 "/" 形式）
export async function ensureLayout(root) {
  const created = [];
  const dirs = [kanbanDir(root), threadsDir(root), path.join(kanbanDir(root), 'templates')];
  for (const dir of dirs) {
    if (!(await pathExists(dir))) {
      await fs.mkdir(dir, { recursive: true });
      created.push(path.relative(root, dir).replace(/\\/g, '/'));
    }
  }
  const templateFile = path.join(kanbanDir(root), 'templates', 'thread.md');
  if (!(await pathExists(templateFile))) {
    await fs.writeFile(templateFile, DEFAULT_THREAD_TEMPLATE, 'utf8');
    created.push(path.relative(root, templateFile).replace(/\\/g, '/'));
  }
  const currentFile = path.join(kanbanDir(root), 'current');
  if (!(await pathExists(currentFile))) {
    await fs.writeFile(currentFile, '', 'utf8');
    created.push(path.relative(root, currentFile).replace(/\\/g, '/'));
  }
  const noteFile = path.join(kanbanDir(root), 'note.md');
  if (!(await pathExists(noteFile))) {
    await fs.writeFile(noteFile, DEFAULT_NOTE_TEMPLATE, 'utf8');
    created.push(path.relative(root, noteFile).replace(/\\/g, '/'));
  }
  return { created };
}

async function atomicWrite(file, content) {
  const tmpFile = file + '.tmp';
  await fs.writeFile(tmpFile, content, 'utf8');
  await fs.rename(tmpFile, file);
}

function isReadonlyError(err) {
  return err && (err.code === 'EPERM' || err.code === 'EACCES');
}

// P4 项目覆写前 checkout：unmanaged 落回普通写盘；hard-fail 抛出携带原因的明确错误
async function checkoutOrThrow(root, file) {
  const r = await vcs.edit(root, file);
  if (r.state === 'hard-fail') {
    throw new ThreadError('vcs-error', `P4 checkout 失败：${r.reason}`);
  }
}

// 全部内容覆写的统一入口：kanban/current、卷宗小节、status、便签
async function checkedWrite(root, file, content) {
  if (vcs.getCached(root) === 'p4') {
    await checkoutOrThrow(root, file);
  }
  try {
    await atomicWrite(file, content);
  } catch (err) {
    if (!isReadonlyError(err)) throw err;
    // 只读兜底阶梯：重新检测一次，翻转为 P4 则按 P4 路径重试一次（覆盖检测缓存陈旧）
    if (await vcs.detect(root) === 'p4') {
      vcs.setCached(root, 'p4');
      await checkoutOrThrow(root, file);
      await atomicWrite(file, content);
      return;
    }
    throw new ThreadError('write-failed', `写盘失败（目标文件只读）：${path.basename(file)}`);
  }
}

async function readActiveId(root) {
  try {
    return (await fs.readFile(path.join(kanbanDir(root), 'current'), 'utf8')).trim();
  } catch {
    return '';
  }
}

// 解析卷宗：宽容处理缺漏，返回 { title, status, sections: [{name, body}], preamble, errors }
// 小节 body 为"净内容"：裁掉模板排版产生的内容首尾结构性空行
export function parseThread(text) {
  const errors = [];
  // Ignore the leading BOM while parsing; writes and fingerprints still use the original text.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let title = '';
  let status = '';
  const sections = [];
  const preambleLines = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { name: line.slice(3).trim(), bodyLines: [] };
      sections.push(current);
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  for (const line of preambleLines) {
    if (!title && line.startsWith('# ')) title = line.slice(2).trim();
    const m = line.match(/^status:\s*(.+?)\s*$/);
    if (m) status = m[1];
  }
  if (!title) errors.push('缺少标题行');
  if (!status) errors.push('缺少 status 行');
  if (!VALID_STATUSES.includes(status)) errors.push(`status 非法：${status || '(空)'}`);
  for (const name of REQUIRED_SECTIONS) {
    if (!sections.some((s) => s.name === name)) errors.push(`缺少小节：${name}`);
  }
  return {
    title,
    status,
    preamble: preambleLines.join('\n'),
    sections: sections.map((s) => {
      const body = s.bodyLines.slice();
      while (body.length && body[0].trim() === '') body.shift();
      while (body.length && body[body.length - 1].trim() === '') body.pop();
      return { name: s.name, body: body.join('\n') };
    }),
    errors,
  };
}

async function readThreadFile(root, id) {
  const file = path.join(threadsDir(root), id, 'thread.md');
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    throw new ThreadError('thread-missing', `线程卷宗不存在：${id}`);
  }
}

// 依赖解析：`## 依赖` 小节逐行提取首位四位序号，保持书写顺序、去重，非法行静默忽略
export function parseDeps(body) {
  const deps = [];
  for (const line of String(body ?? '').split('\n')) {
    const m = line.match(/\d{4}/);
    if (m && !deps.includes(m[0])) deps.push(m[0]);
  }
  return deps;
}

// 线程列表投影
export async function parseList(root) {
  const activeId = await readActiveId(root);
  let entries = [];
  try {
    entries = await fs.readdir(threadsDir(root), { withFileTypes: true });
  } catch {
    return { threads: [] };
  }
  const threads = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const file = path.join(threadsDir(root), id, 'thread.md');
    let text;
    let stat;
    try {
      stat = await fs.stat(file);
      text = await fs.readFile(file, 'utf8');
    } catch {
      threads.push({
        id,
        title: id,
        status: '',
        mtimeMs: 0,
        active: id === activeId,
        goalExcerpt: '',
        deps: [],
        error: '卷宗缺失',
      });
      continue;
    }
    const parsed = parseThread(text);
    const goal = parsed.sections.find((s) => s.name === '目标');
    const goalExcerpt = (goal?.body ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('<!--'))
      .join(' ')
      .slice(0, 120);
    const depsBody = parsed.sections.find((s) => s.name === '依赖')?.body ?? '';
    threads.push({
      id,
      title: parsed.title || id,
      status: parsed.status,
      mtimeMs: Math.round(stat.mtimeMs),
      active: id === activeId,
      goalExcerpt,
      deps: parseDeps(depsBody),
      ...(parsed.errors.length > 0 ? { error: '卷宗异常：' + parsed.errors.join('；') } : {}),
    });
  }
  threads.sort((a, b) => a.id.localeCompare(b.id));
  return { threads };
}

// 单条线程详情
export async function getThread(root, id) {
  const text = await readThreadFile(root, id);
  const stat = await fs.stat(path.join(threadsDir(root), id, 'thread.md'));
  const parsed = parseThread(text);
  if (parsed.errors.length > 0) {
    throw new ThreadError('thread-invalid', '卷宗异常：' + parsed.errors.join('；'));
  }
  const sections = {};
  for (const s of parsed.sections) sections[s.name] = s.body;
  return {
    id,
    title: parsed.title,
    status: parsed.status,
    sections,
    fingerprint: fingerprint(text),
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function replaceSection(text, sectionName, content) {
  const eol = detectEol(text);
  const parsed = parseThread(text);
  const target = parsed.sections.find((s) => s.name === sectionName);
  if (!target) {
    throw new ThreadError('section-missing', `卷宗缺少小节：${sectionName}`);
  }
  const lines = text.split(/\r?\n/);
  const out = [];
  let inTarget = false;
  let replaced = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const name = line.slice(3).trim();
      if (name === sectionName) {
        out.push(line);
        // 新正文：剥离首尾空行，保证恰好一个空行分隔（与原文件风格一致）
        const bodyLines = String(content).split(/\r?\n/);
        while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
        while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
        out.push('', ...bodyLines, '');
        inTarget = true;
        replaced = true;
      } else {
        inTarget = false;
        out.push(line);
      }
    } else if (!inTarget) {
      out.push(line);
    }
  }
  if (!replaced) throw new ThreadError('section-missing', `卷宗缺少小节：${sectionName}`);
  return out.join(eol);
}

// 在卷宗末尾补建小节（仅用于 `依赖` 窄口）：与既有小节保持相同空行结构，正文剥离首尾空行
function appendSection(text, sectionName, content) {
  const eol = detectEol(text);
  const bodyLines = String(content).split(/\r?\n/);
  while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();
  const prefix = text.replace(/(\r?\n)*$/, eol + eol);
  return prefix + `## ${sectionName}` + eol + eol + bodyLines.join(eol) + eol;
}

// 小节更新（乐观并发）
export async function updateSection(root, id, section, content, expectedFingerprint) {
  if (typeof section !== 'string' || !section) {
    throw new ThreadError('bad-request', 'section 是必填项');
  }
  const file = path.join(threadsDir(root), id, 'thread.md');
  const text = await readThreadFile(root, id);
  if (fingerprint(text) !== expectedFingerprint) {
    throw new ThreadError('conflict', '文件已被修改，指纹不匹配');
  }
  let updated;
  try {
    updated = replaceSection(text, section, String(content ?? ''));
  } catch (err) {
    // 窄口：仅 `依赖` 小节缺失时在卷宗末尾补建，其余小节缺失仍报错
    if (!(err instanceof ThreadError && err.code === 'section-missing' && section === '依赖')) throw err;
    updated = appendSection(text, section, String(content ?? ''));
  }
  await checkedWrite(root, file, updated);
  return { fingerprint: fingerprint(updated) };
}

// 全局便签读取：文件缺失时按空内容对待（不自动创建，保证纯读取无副作用）
export async function getNote(root) {
  const file = path.join(kanbanDir(root), 'note.md');
  try {
    const text = await fs.readFile(file, 'utf8');
    const stat = await fs.stat(file);
    return { note: text, fingerprint: fingerprint(text), mtimeMs: Math.round(stat.mtimeMs) };
  } catch (err) {
    if (err.code === 'ENOENT') return { note: '', fingerprint: fingerprint(''), mtimeMs: 0 };
    throw err;
  }
}

// 全局便签保存（乐观并发，语义同 updateSection）
export async function updateNote(root, content, expectedFingerprint) {
  if (typeof content !== 'string') {
    throw new ThreadError('bad-request', 'content 是必填项');
  }
  const file = path.join(kanbanDir(root), 'note.md');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    text = '';
  }
  if (fingerprint(text) !== expectedFingerprint) {
    throw new ThreadError('conflict', '文件已被修改，指纹不匹配');
  }
  await checkedWrite(root, file, content);
  return { fingerprint: fingerprint(content) };
}

// status 流转
export async function setStatus(root, id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new ThreadError('bad-request', `非法 status：${status}（可选值：${VALID_STATUSES.join('、')}）`);
  }
  const file = path.join(threadsDir(root), id, 'thread.md');
  const text = await readThreadFile(root, id);
  const eol = detectEol(text);
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^status:\s*.+$/.test(l));
  if (idx === -1) throw new ThreadError('thread-invalid', '卷宗缺少 status 行');
  lines[idx] = `status: ${status}`;
  const updated = lines.join(eol);
  await checkedWrite(root, file, updated);
  return { fingerprint: fingerprint(updated) };
}

// 保留标记值：slug 留空且标题经 slugify 无产出时占位，表示"待命名"；调用方显式使用会被拒绝
const RESERVED_SLUG = 'unnamed-pending';

function slugify(title) {
  return title
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

// 线程创建
export async function create(root, title, slug, goal) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new ThreadError('bad-request', '标题是必填项');
  }
  title = title.trim();
  if (goal !== undefined && goal !== null) {
    if (typeof goal !== 'string') {
      throw new ThreadError('bad-request', '目标必须是字符串');
    }
    goal = goal.trim();
    if (goal.length > 5000) {
      throw new ThreadError('bad-request', '目标过长（上限 5000 字符）');
    }
  }
  let finalSlug;
  // 标记值占位（序号前缀已保证目录唯一）时豁免 slug 冲突检查
  let exemptConflict = false;
  if (slug && String(slug).trim()) {
    finalSlug = String(slug).trim();
    if (finalSlug === RESERVED_SLUG) {
      throw new ThreadError('bad-request', `slug 为保留字，不可显式使用：${RESERVED_SLUG}`);
    }
  } else {
    finalSlug = slugify(title);
    if (!finalSlug) {
      finalSlug = RESERVED_SLUG;
      exemptConflict = true;
    }
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(finalSlug)) {
    throw new ThreadError('bad-request', `slug 必须是 kebab-case：${finalSlug}`);
  }
  const ensured = await ensureLayout(root);
  const entries = await fs.readdir(threadsDir(root), { withFileTypes: true });
  let maxNum = 0;
  for (const entry of entries) {
    const m = entry.name.match(/^(\d{4})-(.+)$/);
    if (m) {
      maxNum = Math.max(maxNum, parseInt(m[1], 10));
      if (!exemptConflict && m[2] === finalSlug) {
        throw new ThreadError('conflict', `slug 已被占用：${finalSlug}（${entry.name}）`);
      }
    }
  }
  const id = `${String(maxNum + 1).padStart(4, '0')}-${finalSlug}`;
  const dir = path.join(threadsDir(root), id);
  try {
    await fs.mkdir(dir); // 不递归：目录已存在时报错
  } catch (err) {
    if (err.code === 'EEXIST') throw new ThreadError('conflict', `线程目录已存在：${id}`);
    throw err;
  }
  let template = DEFAULT_THREAD_TEMPLATE;
  try {
    template = await fs.readFile(path.join(kanbanDir(root), 'templates', 'thread.md'), 'utf8');
  } catch {
    // 模板文件不可读（理论上 ensureLayout 已补齐）时以内置默认模板兜底
  }
  // Preserve a template's UTF-8 BOM when replacing its title.
  const text = template.replace(/^(\uFEFF?)# .*$/m, (_, bom) => `${bom}# ${title}`);
  if (text === template) {
    await fs.rmdir(dir);
    throw new ThreadError('bad-request', '卷宗模板缺少标题行');
  }
  let finalText = text;
  if (goal) {
    try {
      // 填写目标：替换模板注释，写入正式内容（replaceSection 保持小节排版）
      finalText = replaceSection(text, '目标', goal);
    } catch (err) {
      await fs.rmdir(dir);
      throw err;
    }
  }
  await fs.writeFile(path.join(dir, 'thread.md'), finalText, 'utf8');
  const created = [...ensured.created, path.relative(root, path.join(dir, 'thread.md')).replace(/\\/g, '/')];
  return { id, created };
}

// fstat 门控查询：hard-fail 抛携带原因的明确错误
async function p4FstatOrThrow(root, file) {
  const r = await vcs.fstat(root, file);
  if (r.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 状态查询失败：${r.reason}`);
  return r;
}

// 线程重命名：目录更名为 `序号-新slug`，活跃线程同步更新 kanban/current
export async function rename(root, id, newSlug) {
  newSlug = typeof newSlug === 'string' ? newSlug.trim() : '';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(newSlug)) {
    throw new ThreadError('bad-request', `slug 必须是 kebab-case：${newSlug}`);
  }
  if (newSlug === RESERVED_SLUG) {
    throw new ThreadError('bad-request', `slug 为保留字，不可使用：${RESERVED_SLUG}`);
  }
  const m = String(id).match(/^(\d{4})-(.+)$/);
  if (!m) {
    throw new ThreadError('bad-request', `非法线程标识：${id}`);
  }
  const dir = path.join(threadsDir(root), id);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new ThreadError('thread-missing', `线程不存在：${id}`);
  }
  const newId = `${m[1]}-${newSlug}`;
  if (newId === id) return { id }; // slug 未变化：幂等 no-op
  // 冲突检查排除自身目录
  const entries = await fs.readdir(threadsDir(root), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === id) continue;
    const em = entry.name.match(/^(\d{4})-(.+)$/);
    if (em && em[2] === newSlug) {
      throw new ThreadError('conflict', `slug 已被占用：${newSlug}（${entry.name}）`);
    }
  }
  // 先改目录后写 current，保证 current 不会短暂指向缺失目录
  const newDir = path.join(threadsDir(root), newId);
  const file = path.join(dir, 'thread.md');
  if (vcs.getCached(root) === 'p4') {
    // fstat 三态门控：已入 depot 用 p4 move 保持历史连续（对 open-for-edit 源亦成立，实测 1.3a）；
    // open-for-add 走 FS 改名 + revert 旧路径 + add 新路径；未托管纯 FS 改名
    const st = await p4FstatOrThrow(root, file);
    if (st.file === 'depot') {
      const mv = await vcs.move(root, file, path.join(newDir, 'thread.md'));
      if (mv.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 move 失败：${mv.reason}`);
      if (mv.state === 'unmanaged') await fs.rename(dir, newDir); // 异常分支落回普通改名
    } else if (st.file === 'add') {
      await fs.rename(dir, newDir);
      const rv = await vcs.revert(root, file);
      if (rv.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 revert 失败：${rv.reason}`);
      const ad = await vcs.add(root, [path.join(newDir, 'thread.md')]);
      if (ad.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 add 失败：${ad.reason}`);
    } else {
      await fs.rename(dir, newDir);
    }
  } else {
    await fs.rename(dir, newDir);
  }
  const activeId = await readActiveId(root);
  if (activeId === id) {
    await ensureLayout(root);
    await checkedWrite(root, path.join(kanbanDir(root), 'current'), newId);
  }
  return { id: newId };
}

// 线程删除（真删）
export async function remove(root, id) {
  const dir = path.join(threadsDir(root), id);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new ThreadError('thread-missing', `线程不存在：${id}`);
  }
  if (vcs.getCached(root) === 'p4') {
    // fstat 三态门控：已入 depot 用 p4 delete（open-for-edit 时 p4 delete 为静默 no-op，实测 1.4，故先 revert）；
    // open-for-add 先 revert 撤销 add 记录再普通删除；未托管纯文件删除
    const file = path.join(dir, 'thread.md');
    const st = await p4FstatOrThrow(root, file);
    if (st.file === 'depot') {
      if (st.open && st.open !== 'add') {
        const rv = await vcs.revert(root, file);
        if (rv.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 revert 失败：${rv.reason}`);
      }
      const dl = await vcs.del(root, file);
      if (dl.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 delete 失败：${dl.reason}`);
    } else if (st.file === 'add') {
      const rv = await vcs.revert(root, file);
      if (rv.state === 'hard-fail') throw new ThreadError('vcs-error', `P4 revert 失败：${rv.reason}`);
    }
  }
  try {
    await fs.rm(dir, { recursive: true });
  } catch (err) {
    if (err.code === 'ENOENT') throw new ThreadError('thread-missing', `线程不存在：${id}`);
    throw err;
  }
  const activeId = await readActiveId(root);
  if (activeId === id) {
    await ensureLayout(root);
    await checkedWrite(root, path.join(kanbanDir(root), 'current'), '');
  }
  return { ok: true };
}

// 设置/取消活跃线程
export async function setActive(root, id) {
  const currentFile = path.join(kanbanDir(root), 'current');
  if (id === null || id === '') {
    await ensureLayout(root);
    await checkedWrite(root, currentFile, '');
    return { ok: true };
  }
  try {
    const stat = await fs.stat(path.join(threadsDir(root), id));
    if (!stat.isDirectory()) throw new Error();
  } catch {
    throw new ThreadError('thread-missing', `线程不存在：${id}`);
  }
  await ensureLayout(root);
  await checkedWrite(root, currentFile, id);
  return { ok: true };
}

export { ThreadError, VALID_STATUSES, fingerprint };
