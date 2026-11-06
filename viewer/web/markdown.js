import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });

// 仅允许 HTML profile，禁止样式标签与样式属性，脚本/事件属性/危险 URL 由 DOMPurify 默认配置移除
const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style'],
  FORBID_ATTR: ['style'],
};

// 仅供测试与诊断使用：输出未清理的 marked HTML，禁止直接插入 DOM。
export function parseMarkdown(source) {
  return marked.parse(String(source ?? ''));
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
export function renderMarkdown(source) {
  let text = '';
  try {
    text = String(source ?? '');
    if (!sanitizerAvailable()) {
      return { ok: false, mode: 'escaped', error: '清理组件不可用', text };
    }
    return { ok: true, mode: 'html', html: sanitizeHtml(marked.parse(text)) };
  } catch (error) {
    return { ok: false, mode: 'escaped', error: error?.message ?? String(error), text };
  }
}
