import { CORE_FIELDS } from './schema.mjs';
import { parseField, serializeField } from './field-types.mjs';

export class DocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const cleanLines = (lines) => {
  const result = [...lines];
  while (result.length && !result[0].trim()) result.shift();
  while (result.length && !result.at(-1).trim()) result.pop();
  return result;
};
const clean = (lines) => cleanLines(lines).join('\n');
const markerPattern = /<!--\s*kanban:field=([a-z0-9-]+)\s*-->/g;
const emptyValue = (field) => field.type === 'reference' ? [] : '';

function sectionContent(section) {
  if (!section) return '';
  const lines = section.body.split('\n');
  const kept = lines.filter((line) => !/^\s*<!--\s*kanban:field=[a-z0-9-]+\s*-->\s*$/.test(line));
  return clean(kept);
}

export function parseDocument(text, schema) {
  const source = String(text ?? '');
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const sections = [];
  const preambleLines = [];
  let current = null;
  lines.forEach((line, index) => {
    if (line.startsWith('## ')) {
      current = { name: line.slice(3).trim(), bodyLines: [], headingLine: index };
      sections.push(current);
    } else if (current) current.bodyLines.push(line);
    else preambleLines.push(line);
  });
  for (const section of sections) {
    section.body = clean(section.bodyLines);
    section.markers = [...section.body.matchAll(markerPattern)].map((match) => match[1]);
    section.assignedKey = null;
    section.reason = '';
  }

  let title = '';
  let status = '';
  let statusLine = -1;
  preambleLines.forEach((line, index) => {
    if (!title && line.startsWith('# ')) title = line.slice(2).trim();
    const match = line.match(/^status:\s*(.*?)\s*$/);
    if (match) {
      status = match[1];
      statusLine = index;
    }
  });

  const byKey = new Map(schema.fields.map((field) => [field.key, field]));
  const errors = [];
  const claim = (section, field, reason) => {
    if (!field || field.key === 'status') {
      section.reason = reason || `标记指向不可映射字段：${section.markers[0]}`;
      return;
    }
    const previous = sections.find((item) => item.assignedKey === field.key);
    if (previous) {
      previous.assignedKey = null;
      previous.reason = `字段 ${field.key} 的小节映射重复`;
      section.reason = previous.reason;
      errors.push(`字段 ${field.key} 的小节映射重复或歧义`);
      return;
    }
    section.assignedKey = field.key;
  };

  for (const section of sections) {
    if (!section.markers.length) continue;
    if (new Set(section.markers).size !== 1 || section.markers.length !== 1) {
      section.reason = '字段 key 标记重复或冲突';
      errors.push(`小节 ${section.name} 的字段 key 标记重复或冲突`);
      continue;
    }
    const field = byKey.get(section.markers[0]);
    claim(section, field, field ? 'status 不是 H2 字段' : `标记指向未配置字段：${section.markers[0]}`);
    if (!field) errors.push(`小节 ${section.name}：${section.reason}`);
  }

  for (const pass of ['current', 'legacy']) {
    const remaining = sections.filter((section) => !section.assignedKey && !section.reason && !section.markers.length);
    const names = new Map();
    for (const section of remaining) {
      if (!names.has(section.name)) names.set(section.name, []);
      names.get(section.name).push(section);
    }
    for (const [name, matches] of names) {
      let field;
      if (pass === 'current') field = schema.fields.find((item) => item.key !== 'status' && item.label === name);
      else {
        const coreKey = Object.keys(CORE_FIELDS).find((key) => key !== 'status' && CORE_FIELDS[key].label === name);
        field = byKey.get(coreKey);
      }
      if (!field) continue;
      if (matches.length > 1) {
        for (const section of matches) section.reason = `字段 ${field.key} 的 label 映射重复`;
        errors.push(`字段 ${field.key} 的 label 映射重复或歧义：${name}`);
      } else claim(matches[0], field);
    }
  }

  const fields = {};
  for (const field of schema.fields) {
    if (field.key === 'status') {
      fields.status = { value: status, content: status, missing: statusLine < 0 };
      continue;
    }
    const section = sections.find((item) => item.assignedKey === field.key);
    fields[field.key] = {
      value: section ? parseField(section.body, field) : emptyValue(field),
      content: sectionContent(section),
      missing: !section,
    };
  }
  const statusField = byKey.get('status');
  if (!title) errors.push('缺少标题行');
  if (statusLine < 0) errors.push('缺少 status 行');
  else if (!statusField.options.includes(status)) errors.push(`status 非法：${status || '(空)'}`);
  for (const field of schema.fields) {
    if (field.key === 'status') continue;
    const entry = fields[field.key];
    if (field.type === 'select' && entry.value && !field.options.includes(entry.value)) errors.push(`字段 ${field.key} 的值非法：${entry.value}`);
  }
  const unmappedSections = sections.filter((section) => !section.assignedKey).map((section) => ({
    name: section.name,
    content: section.body,
    reason: section.reason || '当前 schema 未配置此小节',
  }));
  return {
    title,
    status,
    statusLine,
    preamble: preambleLines.join('\n'),
    sections,
    fields,
    unmappedSections,
    errors: [...new Set(errors)],
  };
}

function fieldComment(field) {
  const lines = [`<!-- kanban:field=${field.key} -->`];
  if (field.description) lines.push(...field.description.split(/\r?\n/).map((line, index) => index === 0 ? `<!-- ${line}` : line));
  if (field.description) lines[lines.length - 1] += ' -->';
  if (field.type === 'select') lines.push(`<!-- 可选值：${field.options.join('、')}。 -->`);
  return lines;
}

export function generateThread(title, schema, goal = '') {
  const status = schema.fields.find((field) => field.key === 'status');
  const lines = [`# ${title}`, '', `status: ${status.default}`, ''];
  if (status.description) lines.push(`<!-- ${status.description} 可选值：${status.options.join('、')}。 -->`, '');
  for (const field of schema.fields) {
    if (field.key === 'status') continue;
    lines.push(`## ${field.label}`, '', ...fieldComment(field));
    const configured = field.key === 'goal' && goal ? goal : field.default;
    if (configured !== undefined && configured !== '' && !(Array.isArray(configured) && configured.length === 0)) {
      lines.push('', ...serializeField(configured, field).split('\n'));
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function updateDocument(text, schema, fieldKey, value) {
  const field = schema.fields.find((item) => item.key === fieldKey);
  if (!field) throw new DocumentError('bad-request', `当前 schema 未配置字段：${fieldKey}`);
  const content = serializeField(value, field);
  const parsed = parseDocument(text, schema);
  if (parsed.errors.some((error) => error.includes(fieldKey) && /重复|歧义|标记/.test(error))) {
    throw new DocumentError('thread-invalid', `字段 ${fieldKey} 的文档映射存在重复或歧义，拒绝写入`);
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (fieldKey === 'status') {
    if (parsed.statusLine < 0) throw new DocumentError('thread-invalid', '卷宗缺少 status 行');
    lines[parsed.statusLine] = `status: ${content}`;
    return lines.join(eol);
  }
  const section = parsed.sections.find((item) => item.assignedKey === fieldKey);
  if (!section) {
    const body = content ? [content] : [];
    const addition = [`## ${field.label}`, '', ...fieldComment(field), ...(body.length ? ['', ...body] : []), ''];
    const prefix = text.replace(/(\r?\n)*$/, eol + eol);
    return prefix + addition.join(eol);
  }
  const out = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (index === section.headingLine) {
      out.push(line, '');
      if (section.markers.length === 1) out.push(`<!-- kanban:field=${fieldKey} -->`, '');
      if (content) out.push(...content.split('\n'));
      out.push('');
      skipping = true;
    } else if (skipping) {
      if (line.startsWith('## ')) {
        skipping = false;
        out.push(line);
      }
    } else out.push(line);
  });
  return out.join(eol);
}
