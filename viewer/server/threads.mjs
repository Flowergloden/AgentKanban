import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as vcs from './vcs.mjs';
import { CORE_FIELDS, STATUS_OPTIONS, defaultSchema, loadSchema, schemaFingerprint } from './schema.mjs';
import { parseField, summarizeField } from './field-types.mjs';
import { DocumentError, generateThread, parseDocument, updateDocument } from './thread-document.mjs';

const VALID_STATUSES = STATUS_OPTIONS;

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

// 项目是否已具备 kanban/ 结构（页面据此区分"未初始化"与"已初始化但无线程"）
export async function hasLayout(root) {
  return pathExists(kanbanDir(root));
}

// 幂等补齐 kanban 最小结构，返回 { created }（本次新建的路径列表，相对 root 的 "/" 形式）
export async function ensureLayout(root) {
  const created = [];
  const dirs = [kanbanDir(root), threadsDir(root)];
  for (const dir of dirs) {
    if (!(await pathExists(dir))) {
      await fs.mkdir(dir, { recursive: true });
      created.push(path.relative(root, dir).replace(/\\/g, '/'));
    }
  }
  const schemaFile = path.join(kanbanDir(root), 'thread.schema.json');
  if (!(await pathExists(schemaFile))) {
    await fs.writeFile(schemaFile, JSON.stringify(defaultSchema(), null, 2) + '\n', 'utf8');
    created.push(path.relative(root, schemaFile).replace(/\\/g, '/'));
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

export function parseThread(text, schema = defaultSchema()) {
  const parsed = parseDocument(text, schema);
  return {
    ...parsed,
    sections: parsed.sections.map((section) => ({ name: section.name, body: section.body })),
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

export function parseDeps(body) {
  return parseField(body, { key: 'dependencies', type: 'reference', required: false });
}

export async function parseList(root) {
  const schema = await loadSchema(root);
  const activeId = await readActiveId(root);
  let entries = [];
  try {
    entries = await fs.readdir(threadsDir(root), { withFileTypes: true });
  } catch {
    return { schema, schemaFingerprint: schemaFingerprint(schema), threads: [] };
  }
  const list = [];
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
      list.push({
        id, title: id, status: '', mtimeMs: 0, active: id === activeId,
        goalExcerpt: '', deps: [], fields: {}, fingerprint: '', error: '卷宗缺失',
      });
      continue;
    }
    const parsed = parseDocument(text, schema);
    const fields = Object.fromEntries(schema.fields.map((field) => [field.key, parsed.fields[field.key].value]));
    list.push({
      id,
      title: parsed.title || id,
      status: parsed.status,
      mtimeMs: Math.round(stat.mtimeMs),
      active: id === activeId,
      fingerprint: fingerprint(text),
      fields,
      goalExcerpt: summarizeField(fields.goal, schema.fields.find((field) => field.key === 'goal')),
      deps: fields.dependencies,
      ...(parsed.errors.length > 0 ? { error: '卷宗异常：' + parsed.errors.join('；') } : {}),
    });
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  return { schema, schemaFingerprint: schemaFingerprint(schema), threads: list };
}

export async function getThread(root, id) {
  const schema = await loadSchema(root);
  const text = await readThreadFile(root, id);
  const stat = await fs.stat(path.join(threadsDir(root), id, 'thread.md'));
  const parsed = parseDocument(text, schema);
  if (!parsed.title || parsed.statusLine < 0 || !VALID_STATUSES.includes(parsed.status)) {
    throw new ThreadError('thread-invalid', '卷宗异常：' + parsed.errors.join('；'));
  }
  const sections = {};
  for (const field of schema.fields) {
    if (field.key === 'status') continue;
    const content = parsed.fields[field.key].content;
    sections[field.label] = content;
    if (CORE_FIELDS[field.key]) sections[CORE_FIELDS[field.key].label] = content;
  }
  return {
    id,
    title: parsed.title,
    status: parsed.status,
    sections,
    fields: parsed.fields,
    unmappedSections: parsed.unmappedSections,
    schema,
    schemaFingerprint: schemaFingerprint(schema),
    errors: parsed.errors,
    fingerprint: fingerprint(text),
    mtimeMs: Math.round(stat.mtimeMs),
  };
}

export async function updateField(root, id, fieldKey, value, expectedFingerprint) {
  if (typeof fieldKey !== 'string' || !fieldKey) throw new ThreadError('bad-request', 'fieldKey 是必填项');
  const schema = await loadSchema(root);
  const field = schema.fields.find((item) => item.key === fieldKey);
  if (!field) throw new ThreadError('bad-request', `当前 schema 未配置字段：${fieldKey}`);
  const file = path.join(threadsDir(root), id, 'thread.md');
  const text = await readThreadFile(root, id);
  if (fingerprint(text) !== expectedFingerprint) throw new ThreadError('conflict', '文件已被修改，指纹不匹配');
  let updated;
  try {
    updated = updateDocument(text, schema, fieldKey, value);
  } catch (error) {
    if (error instanceof DocumentError || error.code === 'bad-request') throw new ThreadError(error.code, error.message);
    throw error;
  }
  await checkedWrite(root, file, updated);
  return { fingerprint: fingerprint(updated) };
}

export async function updateFieldRequest(root, id, fieldKey, payload, expectedFingerprint) {
  const schema = await loadSchema(root);
  const field = schema.fields.find((item) => item.key === fieldKey);
  if (!field) throw new ThreadError('bad-request', `当前 schema 未配置字段：${fieldKey}`);
  const value = field.type === 'markdown' ? payload.content : payload.value;
  return updateField(root, id, fieldKey, value, expectedFingerprint);
}

function resolveSectionKey(schema, section) {
  if (typeof section !== 'string' || !section) throw new ThreadError('bad-request', 'section 是必填项');
  const current = schema.fields.filter((field) => field.key !== 'status' && field.label === section);
  if (current.length === 1) return current[0].key;
  const legacy = Object.keys(CORE_FIELDS).find((key) => key !== 'status' && CORE_FIELDS[key].label === section);
  if (legacy && schema.fields.some((field) => field.key === legacy)) return legacy;
  throw new ThreadError('section-missing', `当前 schema 未配置小节：${section}`);
}

export async function updateSection(root, id, section, content, expectedFingerprint) {
  const schema = await loadSchema(root);
  const fieldKey = resolveSectionKey(schema, section);
  const field = schema.fields.find((item) => item.key === fieldKey);
  const value = field.type === 'markdown' ? String(content ?? '') : parseField(content, field);
  return updateField(root, id, fieldKey, value, expectedFingerprint);
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

export async function setStatus(root, id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new ThreadError('bad-request', `非法 status：${status}（可选值：${VALID_STATUSES.join('、')}）`);
  }
  const text = await readThreadFile(root, id);
  return updateField(root, id, 'status', status, fingerprint(text));
}

// 保留标记值：slug 留空时统一占位，表示"待命名"；调用方显式使用会被拒绝
const RESERVED_SLUG = 'unnamed-pending';

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
    finalSlug = RESERVED_SLUG;
    exemptConflict = true;
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
  let finalText;
  try {
    const schema = await loadSchema(root);
    finalText = generateThread(title, schema, goal || '');
  } catch (error) {
    await fs.rmdir(dir);
    throw error;
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
