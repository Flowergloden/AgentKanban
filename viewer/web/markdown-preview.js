import { html } from './vendor/preact-standalone.module.js';
import { renderMarkdown, toggleMarkdownTask } from './markdown.js';

// 共享 Markdown 预览组件：阅读模式与编辑预览共用同一安全渲染入口。
// ok=false 时仅渲染转义原文与错误提示，绝不插入未清理 HTML。
export function MarkdownPreview({ source, className = '', onSourceChange }) {
  const text = String(source ?? '');
  const interactiveTasks = typeof onSourceChange === 'function';
  if (!text.trim()) return html`<div class=${'md-preview md-preview--empty ' + className}>（空）</div>`;
  const result = renderMarkdown(text, { interactiveTasks });
  if (!result.ok) {
    return html`
      <div class=${'md-preview md-preview--error ' + className}>
        <div class="md-preview-error">Markdown 渲染失败，已按原文显示：${result.error}</div>
        <pre class="md-preview-source">${result.text}</pre>
      </div>
    `;
  }
  const onClick = (event) => {
    const input = event.target.closest?.('input[type="checkbox"][data-task-index]');
    if (!input || !event.currentTarget.contains(input)) return;
    const next = toggleMarkdownTask(text, Number(input.dataset.taskIndex));
    if (next !== text) onSourceChange(next);
  };
  return html`<div
    class=${'md-preview ' + className}
    onClick=${interactiveTasks ? onClick : undefined}
    dangerouslySetInnerHTML=${{ __html: result.html }}
  />`;
}
