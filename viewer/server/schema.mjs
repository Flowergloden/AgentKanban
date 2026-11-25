import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateField } from './field-types.mjs';

export const STATUS_OPTIONS = Object.freeze(['立项', '规划', '实现', '完成']);
export const CORE_FIELDS = Object.freeze({
  status: Object.freeze({ type: 'select', label: 'status' }),
  goal: Object.freeze({ type: 'markdown', label: '目标' }),
  completed: Object.freeze({ type: 'markdown', label: '已完成的工作' }),
  decisions: Object.freeze({ type: 'markdown', label: '决策' }),
  changes: Object.freeze({ type: 'markdown', label: 'Changes' }),
  dependencies: Object.freeze({ type: 'reference', label: '依赖' }),
});

export const DEFAULT_VIEWS = Object.freeze([
  Object.freeze({ key: 'all', label: '全部字段' }),
  Object.freeze({ key: 'status-board', label: '状态看板', fieldKey: 'status' }),
  Object.freeze({ key: 'dependency-graph', label: '依赖关系', fieldKey: 'dependencies' }),
]);

export const DEFAULT_SCHEMA = Object.freeze({
  version: 1,
  fields: Object.freeze([
    Object.freeze({ key: 'status', label: 'status', type: 'select', description: '线程生命周期。', options: STATUS_OPTIONS, default: '立项', required: true }),
    Object.freeze({ key: 'goal', label: '目标', type: 'markdown', description: '创建时填写：这条线程要达成的笼统目标（如实现某模块、验证某想法）。', required: true }),
    Object.freeze({ key: 'completed', label: '已完成的工作', type: 'markdown', description: '每完成一段工作，在此追加一条记录（含日期与概要），小需求一句话即可，无需关联 change。若使用 OpenSpec：属于本线程的 change 归档后，其蒸馏总结也追加在这里。' }),
    Object.freeze({ key: 'decisions', label: '决策', type: 'markdown', description: '每条决策 MUST 同时包含“决定了什么”与“为什么”，格式：\n- **决定**：……\n  **原因**：……' }),
    Object.freeze({ key: 'changes', label: 'Changes', type: 'markdown', description: '（可选）关联的 OpenSpec change 名字列表，仅当本线程使用 OpenSpec 工作流时才登记；不使用时留空即可。一行一条（仅名字，松耦合引用），例如：\n- add-xxx' }),
    Object.freeze({ key: 'dependencies', label: '依赖', type: 'reference', description: '（可选）本线程依赖的其他线程：纯序号、一行一条，仅记录关系，不约束状态流转或完成。' }),
  ]),
  views: DEFAULT_VIEWS,
});

export class SchemaError extends Error {
  constructor(message) {
    super(`kanban/thread.schema.json：${message}`);
    this.code = 'schema-invalid';
    this.status = 400;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (location, message) => { throw new SchemaError(`${location} ${message}`); };

// 视图清单校验：恰好一个不携带 fieldKey 的 table；select 字段派生 board，reference 字段派生 graph；
// 省略 views 的既有 schema 以默认三视图走同一规范化路径，保证有效配置与显式默认完全一致。
function validateViews(input, fields) {
  const list = input.views === undefined ? DEFAULT_VIEWS : input.views;
  if (!Array.isArray(list) || list.length === 0) fail('$.views', '必须是非空数组');
  const keys = new Set();
  const fieldKeys = new Set();
  let tables = 0;
  const views = list.map((view, index) => {
    const at = `$.views[${index}]`;
    if (!isObject(view)) fail(at, '必须是对象');
    if (typeof view.key !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(view.key)) fail(`${at}.key`, '必须是小写英文 kebab-case');
    if (keys.has(view.key)) fail(`${at}.key`, `重复：${view.key}`);
    keys.add(view.key);
    if (typeof view.label !== 'string' || !view.label.trim() || /[\r\n]/.test(view.label)) fail(`${at}.label`, '必须是非空单行字符串');
    if (view.kind !== undefined) fail(`${at}.kind`, '不可独立配置，应由 fieldKey 目标字段的 type 推导');
    if (view.fieldKey === undefined) {
      tables += 1;
      return { key: view.key, label: view.label };
    }
    if (typeof view.fieldKey !== 'string' || !view.fieldKey) fail(`${at}.fieldKey`, '必须是非空字符串');
    if (fieldKeys.has(view.fieldKey)) fail(at, `非 table 视图的 fieldKey 重复：${view.fieldKey}`);
    fieldKeys.add(view.fieldKey);
    const field = fields.find((item) => item.key === view.fieldKey);
    if (!field) fail(`${at}.fieldKey`, `绑定的字段不存在：${view.fieldKey}`);
    if (!['select', 'reference'].includes(field.type)) fail(`${at}.fieldKey`, `视图必须绑定 select 或 reference 字段：${view.fieldKey}（当前 ${field.type}）`);
    return { key: view.key, label: view.label, fieldKey: view.fieldKey };
  });
  if (tables !== 1) fail('$.views', `必须恰好包含一个不携带 fieldKey 的 table 视图（当前 ${tables} 个）`);
  return views;
}

export function validateSchema(input) {
  if (!isObject(input)) fail('$', '必须是对象');
  if (input.version !== 1) fail('$.version', '必须为 1');
  if (!Array.isArray(input.fields) || input.fields.length === 0) fail('$.fields', '必须是非空数组');
  const keys = new Set();
  const labels = new Set();
  const fields = input.fields.map((field, index) => {
    const at = `$.fields[${index}]`;
    if (!isObject(field)) fail(at, '必须是对象');
    if (typeof field.key !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(field.key)) fail(`${at}.key`, '必须是小写英文 kebab-case');
    if (keys.has(field.key)) fail(`${at}.key`, `重复：${field.key}`);
    keys.add(field.key);
    if (typeof field.label !== 'string' || !field.label.trim() || /[\r\n]/.test(field.label)) fail(`${at}.label`, '必须是非空单行字符串');
    if (labels.has(field.label)) fail(`${at}.label`, `重复：${field.label}`);
    labels.add(field.label);
    if (!['markdown', 'select', 'reference', 'file'].includes(field.type)) fail(`${at}.type`, `不支持：${field.type}`);
    if (typeof field.description !== 'string') fail(`${at}.description`, '必须是字符串');
    if (field.required !== undefined && typeof field.required !== 'boolean') fail(`${at}.required`, '必须是布尔值');
    const core = CORE_FIELDS[field.key];
    if (core && field.type !== core.type) fail(`${at}.type`, `核心字段 ${field.key} 必须为 ${core.type}`);
    const normalized = { ...field, required: field.required === true };
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length === 0 || field.options.some((option) => typeof option !== 'string' || !option)) {
        fail(`${at}.options`, '必须是非空字符串数组');
      }
      if (new Set(field.options).size !== field.options.length) fail(`${at}.options`, '选项不得重复');
      normalized.options = [...field.options];
      if (normalized.default === undefined) normalized.default = normalized.required ? field.options[0] : '';
      if (typeof normalized.default !== 'string' || (normalized.default && !field.options.includes(normalized.default))) {
        fail(`${at}.default`, '必须为空或属于 options');
      }
      if (normalized.required && !normalized.default) fail(`${at}.default`, '必填 select 必须有非空默认值');
    } else if (field.options !== undefined) {
      fail(`${at}.options`, '仅 select 字段可配置');
    }
    if (field.type === 'markdown' && normalized.default !== undefined && typeof normalized.default !== 'string') fail(`${at}.default`, '必须是字符串');
    if (field.type === 'reference') {
      if (normalized.default !== undefined && (!Array.isArray(normalized.default) || normalized.default.some((value) => typeof value !== 'string' || !/^\d{4}$/.test(value)))) {
        fail(`${at}.default`, '必须是四位线程序号数组');
      }
      if (normalized.default) normalized.default = [...new Set(normalized.default)];
    }
    if (field.type === 'file') {
      if (normalized.default === undefined) normalized.default = [];
      try {
        normalized.default = validateField(normalized.default, normalized);
      } catch (error) {
        fail(`${at}.default`, error.message);
      }
    }
    return normalized;
  });
  for (const [key, core] of Object.entries(CORE_FIELDS)) {
    const field = fields.find((item) => item.key === key);
    if (!field) fail('$.fields', `缺少核心字段 ${key}（${core.type}）`);
  }
  const status = fields.find((field) => field.key === 'status');
  if (JSON.stringify(status.options) !== JSON.stringify(STATUS_OPTIONS) || status.default !== '立项' || !status.required) {
    fail('$.fields[key=status]', '必须固定为立项、规划、实现、完成，默认立项且必填');
  }
  const views = validateViews(input, fields);
  return { version: 1, fields, views };
}

export function defaultSchema() {
  return validateSchema(JSON.parse(JSON.stringify(DEFAULT_SCHEMA)));
}

export async function loadSchema(root) {
  const file = path.join(root, 'kanban', 'thread.schema.json');
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return defaultSchema();
    throw error;
  }
  let input;
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new SchemaError(`JSON 解析失败：${error.message}`);
  }
  return validateSchema(input);
}

export function schemaFingerprint(schema) {
  return crypto.createHash('sha256').update(JSON.stringify(schema), 'utf8').digest('hex');
}
