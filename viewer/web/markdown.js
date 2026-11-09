import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });

// 仅允许 HTML profile，禁止样式标签与样式属性，脚本/事件属性/危险 URL 由 DOMPurify 默认配置移除
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style'],
  FORBID_ATTR: ['style'],
};

const TASK_PREFIX = /^(?:[*+-]|\d{1,9}[.)])[ \t]+\[[ xX]\]/;

function mapDeletedContent(content, raw) {
  const offsets = [];
  let cursor = 0;
  for (let index = 0; index < content.length; index += 1) {
    const offset = raw.indexOf(content[index], cursor);
    if (offset === -1) return null;
    offsets.push(offset);
    cursor = offset + 1;
  }
  return offsets;
}

function nestedItemTokens(item) {
  const checkbox = item.task ? item.tokens.find((token) => token.type === 'checkbox') : null;
  let adjustedCheckbox = false;
  return item.tokens.filter((token) => token.type !== 'checkbox').map((token) => {
    if (!adjustedCheckbox && checkbox && token.raw.startsWith(checkbox.raw)) {
      adjustedCheckbox = true;
      return { ...token, raw: token.raw.slice(checkbox.raw.length) };
    }
    return token;
  });
}

function collectTokenOffsets(tokens, source) {
  const offsets = [];
  let cursor = 0;
  for (const token of tokens) {
    const start = source.indexOf(token.raw, cursor);
    if (start === -1) return offsets;
    if (token.type === 'list') {
      let itemCursor = 0;
      for (const item of token.items) {
        const itemStart = token.raw.indexOf(item.raw, itemCursor);
        if (itemStart === -1) break;
        if (item.task) {
          const prefix = item.raw.match(TASK_PREFIX);
          if (prefix) offsets.push(start + itemStart + prefix[0].length - 2);
        }
        const nested = collectTokenOffsets(nestedItemTokens(item), item.text);
        const itemMap = mapDeletedContent(item.text, item.raw);
        if (itemMap) {
          for (const offset of nested) {
            if (itemMap[offset] !== undefined) offsets.push(start + itemStart + itemMap[offset]);
          }
        }
        itemCursor = itemStart + item.raw.length;
      }
    } else if (token.type === 'blockquote') {
      const nested = collectTokenOffsets(token.tokens, token.text);
      const quoteMap = mapDeletedContent(token.text, token.raw);
      if (quoteMap) {
        for (const offset of nested) {
          if (quoteMap[offset] !== undefined) offsets.push(start + quoteMap[offset]);
        }
      }
    }
    cursor = start + token.raw.length;
  }
  return offsets;
}

function normalizeSource(source) {
  let normalized = '';
  const offsets = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\r') {
      if (source[index + 1] === '\n') index += 1;
      normalized += '\n';
    } else {
      normalized += source[index];
    }
    offsets.push(index);
  }
  return { normalized, offsets };
}

export function toggleMarkdownTask(source, taskIndex) {
  const text = String(source ?? '');
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return text;
  const { normalized, offsets } = normalizeSource(text);
  const taskOffsets = collectTokenOffsets(marked.lexer(normalized), normalized);
  const sourceOffset = offsets[taskOffsets[taskIndex]];
  if (sourceOffset === undefined || !/[ xX]/.test(text[sourceOffset])) return text;
  const next = text[sourceOffset] === ' ' ? 'x' : ' ';
  return text.slice(0, sourceOffset) + next + text.slice(sourceOffset + 1);
}

// 仅供测试与诊断使用：输出未清理的 marked HTML，禁止直接插入 DOM。
export function parseMarkdown(source, { interactiveTasks = false } = {}) {
  const text = String(source ?? '');
  if (!interactiveTasks) return marked.parse(text);
  let taskIndex = 0;
  const renderer = new marked.Renderer();
  renderer.checkbox = ({ checked }) => `<input ${checked ? 'checked="" ' : ''}type="checkbox" data-task-index="${taskIndex++}"> `;
  return marked.parse(text, { renderer });
}

export function sanitizerAvailable() {
  return typeof DOMPurify?.sanitize === 'function' && DOMPurify.isSupported !== false;
}

export function sanitizeHtml(dirty) {
  if (!sanitizerAvailable()) return undefined; // 不支持时不返回伪安全结果
  return DOMPurify.sanitize(dirty, SANITIZE_CONFIG);
}

// 渲染入口：成功返回清理后的 HTML；清理组件不可用或渲染异常时回退为原文转义。
// 调用方 MUST 仅在 ok 为 true 时以 HTML 方式插入结果，ok 为 false 时仅可展示转义文本与错误。
export function renderMarkdown(source, options) {
  let text = '';
  try {
    text = String(source ?? '');
    if (!sanitizerAvailable()) {
      return { ok: false, mode: 'escaped', error: '清理组件不可用', text };
    }
    return { ok: true, mode: 'html', html: sanitizeHtml(parseMarkdown(text, options)) };
  } catch (error) {
    return { ok: false, mode: 'escaped', error: error?.message ?? String(error), text };
  }
}
