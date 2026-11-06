import { html } from './vendor/preact-standalone.module.js';
import { renderMarkdown } from './markdown.js';

// 共享 Markdown 预览组件：阅读模式与编辑预览共用同一安全渲染入口。
// ok=false 时仅渲染转义原文与错误提示，绝不插入未清理 HTML。
export function MarkdownPreview({ source, className = '' }) {
  const text = String(source ?? '');
  if (!text.trim()) return html`<div class=${'md-preview md-preview--empty ' + className}>（空）</div>`;
  const result = renderMarkdown(text);
  if (!result.ok) {
    return html`
      <div class=${'md-preview md-preview--error ' + className}>
        <div class="md-preview-error">Markdown 渲染失败，已按原文显示：${result.error}</div>
        <pre class="md-preview-source">${result.text}</pre>
      </div>
    `;
  }
  return html`<div class=${'md-preview ' + className} dangerouslySetInnerHTML=${{ __html: result.html }} />`;
}
