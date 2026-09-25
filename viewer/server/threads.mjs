import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

async function atomicWrite(file, content) {
  const tmpFile = file + '.tmp';
  await fs.writeFile(tmpFile, content, 'utf8');
  await fs.rename(tmpFile, file);
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
  const lines = text.split(/\r?\n/);
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
    threads.push({
      id,
      title: parsed.title || id,
      status: parsed.status,
      mtimeMs: Math.round(stat.mtimeMs),
      active: id === activeId,
      goalExcerpt,
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
  const updated = replaceSection(text, section, String(content ?? ''));
  await atomicWrite(file, updated);
  return { fingerprint: fingerprint(updated) };
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
  await atomicWrite(file, updated);
  return { fingerprint: fingerprint(updated) };
}

function slugify(title) {
  const ascii = title
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || 'thread';
}

// 线程创建
export async function create(root, title, slug) {
  if (typeof title !== 'string' || !title.trim()) {
    throw new ThreadError('bad-request', '标题是必填项');
  }
  title = title.trim();
  const finalSlug = slug ? String(slug).trim() : slugify(title);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(finalSlug)) {
    throw new ThreadError('bad-request', `slug 必须是 kebab-case：${finalSlug}`);
  }
  let entries = [];
  try {
    entries = await fs.readdir(threadsDir(root), { withFileTypes: true });
  } catch {
    throw new ThreadError('bad-request', `项目缺少 kanban/threads 目录：${root}`);
  }
  let maxNum = 0;
  for (const entry of entries) {
    const m = entry.name.match(/^(\d{4})-(.+)$/);
    if (m) {
      maxNum = Math.max(maxNum, parseInt(m[1], 10));
      if (m[2] === finalSlug) {
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
  let template;
  try {
    template = await fs.readFile(path.join(kanbanDir(root), 'templates', 'thread.md'), 'utf8');
  } catch {
    await fs.rmdir(dir);
    throw new ThreadError('bad-request', '缺少卷宗模板 kanban/templates/thread.md');
  }
  const text = template.replace(/^# .*$/m, `# ${title}`);
  if (text === template) {
    await fs.rmdir(dir);
    throw new ThreadError('bad-request', '卷宗模板缺少标题行');
  }
  await fs.writeFile(path.join(dir, 'thread.md'), text, 'utf8');
  return { id };
}

// 线程删除（真删）
export async function remove(root, id) {
  const dir = path.join(threadsDir(root), id);
  try {
    await fs.rm(dir, { recursive: true });
  } catch (err) {
    if (err.code === 'ENOENT') throw new ThreadError('thread-missing', `线程不存在：${id}`);
    throw err;
  }
  const activeId = await readActiveId(root);
  if (activeId === id) {
    await atomicWrite(path.join(kanbanDir(root), 'current'), '');
  }
  return { ok: true };
}

// 设置/取消活跃线程
export async function setActive(root, id) {
  const currentFile = path.join(kanbanDir(root), 'current');
  if (id === null || id === '') {
    await atomicWrite(currentFile, '');
    return { ok: true };
  }
  try {
    const stat = await fs.stat(path.join(threadsDir(root), id));
    if (!stat.isDirectory()) throw new Error();
  } catch {
    throw new ThreadError('thread-missing', `线程不存在：${id}`);
  }
  await atomicWrite(currentFile, id);
  return { ok: true };
}

export { ThreadError, VALID_STATUSES, fingerprint };
