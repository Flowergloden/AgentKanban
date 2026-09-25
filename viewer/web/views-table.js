import { html } from './vendor/preact-standalone.module.js';

function formatTime(mtimeMs) {
  if (!mtimeMs) return '—';
  const d = new Date(mtimeMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ActiveBadge() {
  return html`<span class="badge-active">活跃</span>`;
}

export function ThreadTable({ threads, onOpen }) {
  if (threads.length === 0) {
    return html`<div class="empty">没有符合条件的线程</div>`;
  }
  return html`
    <table>
      <thead>
        <tr><th>标识</th><th>标题</th><th>status</th><th>最近更新</th><th>目标摘要</th></tr>
      </thead>
      <tbody>
        ${threads.map((t) => html`
          <tr key=${t.id} onClick=${() => !t.error && onOpen(t.id)}>
            <td>${t.id} ${t.active && html`<${ActiveBadge} />`}</td>
            <td>${t.title}</td>
            <td>${t.status || '—'}</td>
            <td>${formatTime(t.mtimeMs)}</td>
            <td>
              ${t.error ? html`<span class="badge-error">${t.error}</span>` : t.goalExcerpt}
            </td>
          </tr>
        `)}
      </tbody>
    </table>
  `;
}

export function UnfinishedView({ threads, onOpen }) {
  const filtered = threads.filter((t) => t.status !== '完成');
  return html`<${ThreadTable} threads=${filtered} onOpen=${onOpen} />`;
}
