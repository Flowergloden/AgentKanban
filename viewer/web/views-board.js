import { html, useState } from './vendor/preact-standalone.module.js';
import { api } from './api.js';

const COLUMNS = ['立项', '规划', '实现', '完成'];

export function BoardView({ root, threads, onOpen, onChanged, onError }) {
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const onDrop = async (status, e) => {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    if (!id) return;
    const thread = threads.find((t) => t.id === id);
    if (!thread || thread.status === status) return;
    try {
      await api.setStatus(root, id, status);
      await onChanged();
    } catch (err) {
      // 失败回滚：重新拉取列表恢复显示
      await onChanged();
      onError(`状态流转失败：${err.message}`);
    }
  };

  return html`
    <div class="board">
      ${COLUMNS.map((col) => {
        const cards = threads.filter((t) => t.status === col);
        return html`
          <div
            key=${col}
            class=${'board-col' + (dragOverCol === col ? ' drag-over' : '')}
            onDragOver=${(e) => { e.preventDefault(); setDragOverCol(col); }}
            onDragLeave=${() => setDragOverCol((c) => (c === col ? null : c))}
            onDrop=${(e) => onDrop(col, e)}
          >
            <h3>${col}（${cards.length}）</h3>
            ${cards.map((t) => html`
              <div
                key=${t.id}
                class="card"
                draggable="true"
                style=${draggingId === t.id ? 'opacity:.5' : ''}
                onDragStart=${(e) => { e.dataTransfer.setData('text/plain', t.id); setDraggingId(t.id); }}
                onDragEnd=${() => { setDraggingId(null); setDragOverCol(null); }}
                onClick=${() => onOpen(t.id)}
              >
                <div class="card-id">${t.id} ${t.active && html`<span class="badge-active">活跃</span>`}</div>
                <div>${t.title}</div>
                ${t.goalExcerpt && html`<div class="card-goal">${t.goalExcerpt}</div>`}
              </div>
            `)}
          </div>
        `;
      })}
    </div>
  `;
}
