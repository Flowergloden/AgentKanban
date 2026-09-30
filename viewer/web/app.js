import { html, render, useState, useEffect } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { watchVisibleActivity } from './visibility.js';
import { changeServiceMode, stopServiceWithConfirmation } from './service-controls.js';
import { ThreadTable, UnfinishedView } from './views-table.js';
import { BoardView } from './views-board.js';
import { ThreadDetail } from './detail.js';
import { CreateModal, DeleteModal, NoteModal, P4AddModal } from './modals.js';

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
  const [showNote, setShowNote] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [addRequest, setAddRequest] = useState(null); // { files: [...] }：P4 新建文件待询问 add
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState(null);
  const [serviceNotice, setServiceNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
      const entries = list.map((p) => ({ root: p.root, vcs: p.vcs }));
      if (paramRoot && !entries.some((p) => p.root === paramRoot)) entries.unshift({ root: paramRoot });
      setProjects(entries);
      const current = paramRoot || entries[0]?.root || '';
      setRoot(current);
      if (!current) {
        setError('注册表为空：尚未有项目注册，请通过 Kimi 或 Codex 在项目中启动看板服务。');
      }
    })();
  }, []);

  useEffect(() => {
    api.health().then((health) => setMode(health.mode)).catch(() => setServiceNotice('服务已失联；请从本地打开入口重新启动，网页无法自行拉起进程。'));
  }, []);

  useEffect(() => watchVisibleActivity({
    document, window,
    send: () => api.activity(root),
    onLost: () => setServiceNotice('服务已失联；请从本地打开入口重新启动，网页无法自行拉起进程。'),
    onRestored: () => { setServiceNotice(''); api.health().then((health) => setMode(health.mode)).catch(() => {}); },
    setInterval, clearInterval,
  }), [root]);

  const changeMode = (next) => changeServiceMode(next, {
    setBusy, setMode, setNotice: setServiceNotice, setModeApi: api.setMode,
  });

  const stopService = () => stopServiceWithConfirmation({
    confirm: (message) => window.confirm(message), stop: api.stop,
    setBusy, setMode, setNotice: setServiceNotice,
  });
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

  const isP4 = projects.find((p) => p.root === root)?.vcs?.type === 'p4';
  // P4 项目出现新建文件时询问是否 add；拒绝则关闭弹窗，不就同一批文件重复询问
  const maybeAskAdd = (created) => {
    if (isP4 && created?.length) setAddRequest({ files: created });
  };

  useEffect(() => {
    setThreads(null);
    setSelectedId(null);
    setNotice('');
    if (!root) return;
    // 先幂等初始化项目 kanban 结构（旧版服务无该接口时静默跳过），再刷新列表
    api.init(root)
      .then(async (r) => {
        // init 服务端已刷新 P4 受管检测：回读项目列表更新徽标，再决定是否询问 add
        const list = await api.listProjects().catch(() => null);
        const entries = list ? list.map((p) => ({ root: p.root, vcs: p.vcs })) : null;
        if (entries) setProjects(entries);
        if (r?.created?.length) {
          setNotice(`已自动初始化：${r.created.join('、')}`);
          const freshP4 = entries?.find((p) => p.root === root)?.vcs?.type === 'p4';
          if (freshP4) setAddRequest({ files: r.created });
        }
      })
      .catch(() => {})
      .finally(() => refresh(root));
  }, [root]);

  const activeThread = threads?.find((t) => t.active);

  const openThread = (id) => setSelectedId(id);

  return html`
    <header>
      <span class="title">看板</span>
      ${projects.length > 0 && html`
        <select value=${root} onChange=${(e) => setRoot(e.target.value)}>
          ${projects.map((p) => html`<option key=${p.root} value=${p.root}>${p.root}${p.vcs?.type === 'p4' ? ' 〔P4〕' : ''}</option>`)}
        </select>
      `}
      <span class="service-mode">共享服务：${mode === 'persistent' ? '常驻' : mode === 'auto' ? '自动' : '未连接'}（影响所有项目）</span>
      <button disabled=${busy || !mode} onClick=${() => changeMode(mode === 'persistent' ? 'auto' : 'persistent')}>${mode === 'persistent' ? '取消常驻' : '常驻'}</button>
      <button class="danger" disabled=${busy || !mode} onClick=${stopService}>停止服务</button>
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
      <button onClick=${() => setShowNote(true)} disabled=${!root}>便签</button>
      <button onClick=${() => refresh()} disabled=${!root}>刷新</button>
    </header>
    <main>
      ${serviceNotice && html`<div class="banner-409">${serviceNotice}</div>`}
      ${notice && html`<div class="hint">${notice}</div>`}
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
        onCreated=${async (id, created) => { setShowCreate(false); await refresh(); setSelectedId(id); maybeAskAdd(created); }}
      />
    `}
    ${addRequest && html`
      <${P4AddModal}
        root=${root}
        files=${addRequest.files}
        onClose=${() => setAddRequest(null)}
        onAdded=${(files) => { setAddRequest(null); setNotice(`已 p4 add：${files.join('、')}（留在默认 changelist，请自行提交）`); }}
      />
    `}
    ${showNote && html`
      <${NoteModal}
        root=${root}
        onClose=${() => setShowNote(false)}
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
