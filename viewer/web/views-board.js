import { html, useState } from './vendor/preact-standalone.module.js';
import { api } from './api.js';

export function BoardView({ root, threads, field, onOpen, onChanged, onError }) {
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  if (!field || field.type !== 'select') return html`<div class="empty">当前字段不是有效看板，请返回全部字段。</div>`;

  const onDrop = async (value, event) => {
    event.preventDefault();
    setDragOverCol(null);
    const id = event.dataTransfer.getData('text/plain');
    setDraggingId(null);
    const thread = threads.find((item) => item.id === id);
    if (!thread || thread.fields?.[field.key] === value) return;
    try {
      await api.updateField(root, id, field.key, value, thread.fingerprint);
      await onChanged();
    } catch (err) {
      await onChanged();
      onError(`${field.label} 更新失败：${err.message}`);
    }
  };

  return html`<div class="board" data-field-key=${field.key}>
    ${field.options.map((option) => {
      const cards = threads.filter((thread) => thread.fields?.[field.key] === option);
      return html`<div key=${option} class=${'board-col' + (dragOverCol === option ? ' drag-over' : '')}
        onDragOver=${(event) => { event.preventDefault(); setDragOverCol(option); }}
        onDragLeave=${() => setDragOverCol((current) => current === option ? null : current)}
        onDrop=${(event) => onDrop(option, event)}>
        <h3>${option}（${cards.length}）</h3>
        ${cards.map((thread) => html`<div key=${thread.id} class="card" draggable="true"
          style=${draggingId === thread.id ? 'opacity:.5' : ''}
          onDragStart=${(event) => { event.dataTransfer.setData('text/plain', thread.id); setDraggingId(thread.id); }}
          onDragEnd=${() => { setDraggingId(null); setDragOverCol(null); }}
          onClick=${() => onOpen(thread.id)}>
          <div class="card-id">${thread.id} ${thread.active && html`<span class="badge-active">活跃</span>`}</div>
          <div>${thread.title}</div>
          ${thread.goalExcerpt && html`<div class="card-goal">${thread.goalExcerpt}</div>`}
        </div>`)}
      </div>`;
    })}
  </div>`;
}
