import { html, render, useState, useEffect } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { ThreadTable, UnfinishedView } from './views-table.js';
import { BoardView } from './views-board.js';
import { ThreadDetail } from './detail.js';
import { CreateModal, DeleteModal } from './modals.js';

const VIEWS = [
  { key: 'table', label: '全部' },
  { key: 'board', label: '看板' },
  { key: 'unfinished', label: '未完成' },
];

function App() {
  const [projects, setProjects] = useState([]);
  const [root, setRoot] = useState('');
  const [view, setView] = useState('table');
  const [threads, setThreads] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState('');

  // 初始化：?root= 仅读取一次；无参数落到 lastSeen 最近项目（行为同现版）
  useEffect(() => {
    (async () => {
      // 历史 URL 可能带 "\" 形式的 root，归一化为 "/" 再与注册表比对，避免下拉出现重复项
      const paramRoot = (new URLSearchParams(location.search).get('root') || '').replace(/\\/g, '/');
      let list = [];
      try {
        list = await api.listProjects();
      } catch {
      }
      const roots = list.map((p) => p.root);
      if (paramRoot && !roots.includes(paramRoot)) roots.unshift(paramRoot);
      setProjects(roots);
      const current = paramRoot || roots[0] || '';
      setRoot(current);
      if (!current) {
        setError('注册表为空：尚未有项目注册，请先在某个项目中启动 kimi-code 会话。');
      }
    })();
  }, []);

  const refresh = async (r = root) => {
    if (!r) return;
    try {
      const data = await api.listThreads(r);
      setThreads(data.threads);
      setError('');
    } catch (err) {
      setThreads(null);
      setError(`加载线程列表失败：${err.message}`);
    }
  };

  useEffect(() => {
    setThreads(null);
    setSelectedId(null);
    if (root) refresh(root);
  }, [root]);

  const activeThread = threads?.find((t) => t.active);

  const openThread = (id) => setSelectedId(id);

  return html`
    <header>
      <span class="title">看板</span>
      ${projects.length > 0 && html`
        <select value=${root} onChange=${(e) => setRoot(e.target.value)}>
          ${projects.map((p) => html`<option key=${p} value=${p}>${p}</option>`)}
        </select>
      `}
      <div class="tabs">
        ${VIEWS.map((v) => html`
          <button
            key=${v.key}
            class=${view === v.key && !selectedId ? 'active' : ''}
            onClick=${() => { setView(v.key); setSelectedId(null); }}
          >${v.label}</button>
        `)}
      </div>
      <button class="primary" onClick=${() => setShowCreate(true)} disabled=${!root}>新建线程</button>
      <button onClick=${() => refresh()} disabled=${!root}>刷新</button>
    </header>
    <main>
      ${error && html`<div class="empty">${error}</div>`}
      ${!error && root && threads === null && html`<div class="empty">加载中…</div>`}
      ${!error && threads !== null && html`
        ${!activeThread && html`<div class="hint">当前无活跃线程（kanban/current 为空）。可在详情页将某条线程设为活跃。</div>`}
        ${selectedId ? html`
          <${ThreadDetail}
            root=${root}
            threadId=${selectedId}
            isActive=${activeThread?.id === selectedId}
            onBack=${() => { setSelectedId(null); refresh(); }}
            onChanged=${() => refresh()}
            onRequestDelete=${(id) => setDeleteTarget({ root, id, title: threads.find((t) => t.id === id)?.title ?? id, active: activeThread?.id === id })}
          />
        ` : view === 'board' ? html`
          <${BoardView} root=${root} threads=${threads} onOpen=${openThread} onChanged=${() => refresh()} onError=${setError} />
        ` : view === 'unfinished' ? html`
          <${UnfinishedView} threads=${threads} onOpen=${openThread} />
        ` : html`
          <${ThreadTable} threads=${threads} onOpen=${openThread} />
        `}
      `}
    </main>
    ${showCreate && html`
      <${CreateModal}
        root=${root}
        onClose=${() => setShowCreate(false)}
        onCreated=${async (id) => { setShowCreate(false); await refresh(); setSelectedId(id); }}
      />
    `}
    ${deleteTarget && html`
      <${DeleteModal}
        thread=${deleteTarget}
        onClose=${() => setDeleteTarget(null)}
        onDeleted=${async () => { setDeleteTarget(null); setSelectedId(null); await refresh(); }}
      />
    `}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
