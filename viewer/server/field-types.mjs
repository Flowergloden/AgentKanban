import { normalizeFilePath } from './file-paths.mjs';

export class FieldError extends Error {
  constructor(field, message) {
    super(`字段 ${field.key}：${message}`);
    this.code = 'bad-request';
    this.fieldKey = field.key;
  }
}

export const stripComments = (value) => String(value ?? '').replace(/<!--[\s\S]*?-->/g, '');

function trimBlankLines(value) {
  const lines = String(value ?? '').split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

export function parseField(raw, field) {
  if (field.type === 'markdown') return trimBlankLines(stripComments(raw));
  if (field.type === 'select') return stripComments(raw).trim();
  if (field.type === 'reference') {
    const values = [];
    for (const line of stripComments(raw).split(/\r?\n/)) {
      const match = line.match(/^\s*-\s*(\d{4})(?:-[a-z0-9-]+)?\s*$/i);
      if (match && !values.includes(match[1])) values.push(match[1]);
    }
    return values;
  }
  if (field.type === 'file') {
    const values = [];
    for (const line of stripComments(raw).split(/\r?\n/)) {
      const match = line.match(/^\s*-\s*(.*?)\s*$/);
      if (!match) continue;
      try {
        const normalized = normalizeFilePath(match[1]);
        if (!values.includes(normalized)) values.push(normalized);
      } catch { }
    }
    return values;
  }
  throw new FieldError(field, `不支持的类型 ${field.type}`);
}

export function validateField(value, field) {
  if (field.type === 'markdown') {
    if (typeof value !== 'string') throw new FieldError(field, '内容必须是字符串');
    if (field.required && !stripComments(value).trim()) throw new FieldError(field, '不能为空');
    return value;
  }
  if (field.type === 'select') {
    if (typeof value !== 'string') throw new FieldError(field, '值必须是字符串');
    if (!value && !field.required) return '';
    if (!field.options.includes(value)) throw new FieldError(field, `非法选项 ${value || '(空)'}；可选值：${field.options.join('、')}`);
    return value;
  }
  if (field.type === 'reference') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !/^\d{4}$/.test(item))) {
      throw new FieldError(field, '值必须是四位线程序号数组');
    }
    const normalized = [...new Set(value)];
    if (field.required && normalized.length === 0) throw new FieldError(field, '不能为空');
    return normalized;
  }
  if (field.type === 'file') {
    if (!Array.isArray(value)) throw new FieldError(field, '值必须是项目相对文件路径数组');
    const normalized = [];
    for (const item of value) {
      try {
        const filePath = normalizeFilePath(item);
        if (!normalized.includes(filePath)) normalized.push(filePath);
      } catch (error) {
        throw new FieldError(field, error.message);
      }
    }
    if (field.required && normalized.length === 0) throw new FieldError(field, '不能为空');
    return normalized;
  }
  throw new FieldError(field, `不支持的类型 ${field.type}`);
}

export function serializeField(value, field) {
  const normalized = validateField(value, field);
  if (field.type === 'reference' || field.type === 'file') return normalized.map((item) => `- ${item}`).join('\n');
  return normalized;
}

export function summarizeField(value, field, limit = 120) {
  if (field.type === 'markdown') return stripComments(value).replace(/\s+/g, ' ').trim().slice(0, limit);
  return value;
}
