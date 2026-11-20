import { html, useEffect, useState } from './vendor/preact-standalone.module.js';
import { MarkdownFieldEditor, ReferenceFieldControl, SelectFieldControl } from './field-controls.js';

function formatTime(mtimeMs) {
  if (!mtimeMs) return '—';
  const date = new Date(mtimeMs);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ThreadTable({ root, threads, schema, onOpen, onChanged }) {
  const [expanded, setExpanded] = useState(null);
  useEffect(() => {
    if (expanded && (!threads.some((thread) => thread.id === expanded.id) || !schema.fields.some((field) => field.key === expanded.fieldKey && field.type === 'markdown'))) setExpanded(null);
  }, [threads, schema]);
  if (threads.length === 0) return html`<div class="empty">没有线程</div>`;
  const fields = schema?.fields ?? [];
  return html`<table class="thread-table">
    <thead><tr>
      <th>标识</th><th>标题</th><th>最近更新</th>
      ${fields.map((field) => html`<th key=${field.key}>${field.label}<span class="field-type"> ${field.type}</span></th>`)}
    </tr></thead>
    <tbody>
      ${threads.map((thread) => html`
        <tr key=${thread.id} onClick=${() => thread.fingerprint && onOpen(thread.id)}>
          <td>${thread.id} ${thread.active && html`<span class="badge-active">活跃</span>`}</td>
          <td>${thread.title}${thread.error && html`<div class="badge-error">${thread.error}</div>`}</td>
          <td>${formatTime(thread.mtimeMs)}</td>
          ${fields.map((field) => {
            const value = thread.fields?.[field.key];
            const missing = value === '' || (Array.isArray(value) && value.length === 0);
            return html`<td key=${field.key} class="field-cell">
              ${field.type === 'markdown' ? html`
                <button class="markdown-summary" onClick=${(event) => { event.stopPropagation(); setExpanded(expanded?.id === thread.id && expanded.fieldKey === field.key ? null : { id: thread.id, fieldKey: field.key }); }}>
                  ${value || (missing ? '（空）' : '展开')}
                </button>
              ` : field.type === 'select' ? html`
                <${SelectFieldControl} root=${root} threadId=${thread.id} field=${field} value=${value} fingerprint=${thread.fingerprint} onChanged=${onChanged} />
              ` : html`
                <${ReferenceFieldControl} root=${root} threadId=${thread.id} field=${field} value=${value} fingerprint=${thread.fingerprint} threads=${threads} onOpen=${onOpen} onChanged=${onChanged} />
              `}
            </td>`;
          })}
        </tr>
        ${expanded?.id === thread.id && html`<tr key=${`${thread.id}:editor`} class="field-editor-row"><td colSpan=${3 + fields.length}>
          <${MarkdownFieldEditor} root=${root} threadId=${thread.id} fieldKey=${expanded.fieldKey} onChanged=${onChanged} onDone=${() => setExpanded(null)} />
        </td></tr>`}
      `)}
    </tbody>
  </table>`;
}
