import { html, useEffect, useState } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { MarkdownPreview } from './markdown-preview.js';

export function FilePreviewModal({ root, threadId, selection, onClose, client = api }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, result: null, error: '' });
  const filePath = selection?.filePath;
  const fieldKey = selection?.field?.key;
  useEffect(() => {
    if (!filePath || !fieldKey) return;
    let active = true;
    setState({ loading: true, result: null, error: '' });
    client.getFile(root, threadId, fieldKey, filePath)
      .then((result) => { if (active) setState({ loading: false, result, error: '' }); })
      .catch((error) => { if (active) setState({ loading: false, result: null, error: error.message }); });
    return () => { active = false; };
  }, [root, threadId, fieldKey, filePath, attempt, client]);
  if (!selection) return null;
  return html`<div class="modal-mask" onClick=${(event) => event.target === event.currentTarget && onClose()}>
    <div class="modal modal--wide file-preview-modal" role="dialog" aria-modal="true" aria-label=${`预览 ${filePath}`}>
      <h3>${filePath}</h3>
      ${state.loading && html`<div class="hint">加载文件预览…</div>`}
      ${state.error && html`<div class="modal-error" role="alert">预览失败：${state.error}</div>`}
      ${state.result && html`<div class="file-preview">
        ${state.result.kind === 'markdown'
          ? html`<${MarkdownPreview} source=${state.result.content} disableImages />`
          : html`<pre class="file-preview-source">${state.result.content}</pre>`}
      </div>`}
      <div class="modal-actions">
        ${state.error && html`<button onClick=${() => setAttempt(attempt + 1)}>重试</button>`}
        <button class="primary" onClick=${onClose}>关闭</button>
      </div>
    </div>
  </div>`;
}
