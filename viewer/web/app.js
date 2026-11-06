import { html, render, useState, useEffect } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { watchVisibleActivity } from './visibility.js';
import { changeServiceMode, stopServiceWithConfirmation } from './service-controls.js';
import { ThreadTable, UnfinishedView } from './views-table.js';
import { BoardView } from './views-board.js';
import { DepGraphView } from './dep-graph.js';
import { ThreadDetail } from './detail.js';
import { CreateModal, DeleteModal, NoteModal, P4AddModal, ManageModal } from './modals.js';
import { createExternalSync } from './external-sync.js';
import {
  findProject,
  registeredProjects,
  pickRecentRegistered,
  nextRootAfterRemoval,
  normalizeUrlRoot,
} from './project-state.js';

const VIEWS = [
  { key: 'table', label: '全部' },
  { key: 'board', label: '看板' },
  { key: 'unfinished', label: '未完成' },
  { key: 'depgraph', label: '依赖图' },
];

// 线程列表投影：外部轮询只据此判断列表是否变化，指纹未变不重置状态
const listProjection = (list) =>
  (list ?? []).map((t) => `${t.id}${t.title}${t.status}${t.mtimeMs}${t.active ? 1 : 0}${t.error ?? ''}`).join('\n');

function App() {
  const [projects, setProjects] = useState([]); // 全量项目（含 state），服务按 lastSeen 降序返回
  const [root, setRoot] = useState('');
  const [view, setView] = useState('table');
  const [threads, setThreads] = useState(null);
  const [layout, setLayout] = useState(true); // 当前项目是否具备 kanban/ 结构
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [addRequest, setAddRequest] = useState(null); // { files: [...] }：P4 新建文件待询问 add
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState(null);
  const [serviceNotice, setServiceNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshProjects = async () => {
    const list = await api.listProjects().catch(() => null);
    if (list) setProjects(list);
    return list;
  };

  // 用 history.replaceState 清理或替换 URL 中的项目根参数，避免刷新恢复已移除上下文
  const syncUrl = (next) => {
    const url = new URL(location.href);
    if (next) url.searchParams.set('root', next);
    else url.searchParams.delete('root');
    history.replaceState(null, '', url);
  };
  const navigate = (next) => {
    setRoot(next);
    syncUrl(next);
  };

  // 初始化：?root= 仅读取一次；未指定时落到最近已注册项目；未知 URL 不注册、不初始化
  useEffect(() => {
    (async () => {
      const paramRoot = normalizeUrlRoot(new URLSearchParams(location.search).get('root'));
      const list = (await refreshProjects()) || [];
      if (paramRoot) {
        const entry = findProject(list, paramRoot);
        setRoot(entry ? entry.root : paramRoot); // 采用注册表规范根；未登记路径原样展示状态视图
      } else {
        const recent = pickRecentRegistered(list);
        setRoot(recent);
        if (!recent) setError(''); // 空状态由渲染分支给出明确提示
      }
    })();
  }, []);

  useEffect(() => {
    api.health().then((health) => setMode(health.mode)).catch(() => setServiceNotice('服务已失联；请从本地打开入口重新启动，网页无法自行拉起进程。'));
  }, []);

  // 页面活动仅在当前 root 已登记时携带 root；未知 URL 只用无 root 活动维持服务
  useEffect(() => watchVisibleActivity({
    document, window,
    send: () => api.activity(findProject(projects, root) ? root : undefined),
    onLost: () => setServiceNotice('服务已失联；请从本地打开入口重新启动，网页无法自行拉起进程。'),
    onRestored: () => { setServiceNotice(''); api.health().then((health) => setMode(health.mode)).catch(() => {}); },
    setInterval, clearInterval,
  }), [root, projects]);

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
      setLayout(data.layout !== false); // 旧服务无该字段时视为已具备结构
      setError('');
    } catch (err) {
      setThreads(null);
      setError(`加载线程列表失败：${err.message}`);
    }
  };

  const currentEntry = findProject(projects, root);
  const currentState = !root ? 'empty' : (currentEntry?.state || 'unknown');
  const canWrite = currentState === 'registered';
  const registered = registeredProjects(projects);
  const isP4 = currentEntry?.vcs?.type === 'p4';
  // P4 项目出现新建文件时询问是否 add；拒绝则关闭弹窗，不就同一批文件重复询问
  const maybeAskAdd = (created) => {
    if (isP4 && created?.length) setAddRequest({ files: created });
  };

  // 仅在已注册项目间加载线程；待确认/已忽略/未登记不自动注册、不初始化、不加载
  useEffect(() => {
    setThreads(null);
    setSelectedId(null);
    setNotice('');
    setLayout(true);
    if (!root || !canWrite) return;
    (async () => {
      await refresh(root);
      await refreshProjects(); // 服务端已刷新 P4 检测：回读项目列表更新徽标
    })();
  }, [root, currentState]);

  // 可见页面轮询线程列表外部变更（Agent/其他窗口新建、删除、改状态）；
  // 投影比对只在变化时更新列表，不重建详情编辑器；读取失败保持现状
  useEffect(() => {
    if (!root || !canWrite) return undefined;
    const poller = createExternalSync({
      check: async (gen) => {
        try {
          const data = await api.listThreads(root);
          if (gen !== poller.getGeneration()) return;
          setLayout(data.layout !== false);
          setError('');
          setThreads((prev) => (listProjection(prev) === listProjection(data.threads) ? prev : data.threads));
        } catch {
          // 列表读取失败不打扰当前视图；详情/便签的失败由各自控制器处理
        }
      },
    });
    return () => poller.destroy();
  }, [root, currentState]);

  const initProject = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.init(root);
      // init 服务端已刷新 P4 受管检测：回读项目列表更新徽标，再决定是否询问 add
      const list = await refreshProjects();
      if (r?.created?.length) {
        setNotice(`已初始化：${r.created.join('、')}`);
        const fresh = findProject(list, root);
        if (fresh?.vcs?.type === 'p4') setAddRequest({ files: r.created });
      }
      setLayout(true);
      await refresh(root);
    } catch (err) {
      setError(`初始化失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 忽略当前展示项目：持久抑制自动发现，并切换到下一最近已注册项目或空状态
  const ignoreCurrent = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.ignoreProject(root);
      const list = (await refreshProjects()) || [];
      navigate(nextRootAfterRemoval(list, root));
    } catch (err) {
      setError(`忽略失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmCurrent = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.confirmProject(root);
      await refreshProjects(); // 状态变为已注册后由 effect 加载线程/显示初始化入口
    } catch (err) {
      setError(`确认失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // 管理模态框操作后的统一回调：刷新列表；删除/忽略当前展示项目时导航到下一落点
  const onManaged = async (op, opRoot) => {
    const list = (await refreshProjects()) || [];
    const normRoot = String(root || '').toLowerCase();
    const touchedCurrent = opRoot && String(opRoot).toLowerCase() === normRoot;
    if ((op === 'delete' || op === 'ignore') && touchedCurrent) {
      navigate(nextRootAfterRemoval(list, root));
    }
  };

  const activeThread = threads?.find((t) => t.active);
  const openThread = (id) => setSelectedId(id);

  return html`
    <header>
      <span class="title">看板</span>
      <button onClick=${() => setShowManage(true)}>项目</button>
      ${registered.length > 0 && html`
        <select value=${root} onChange=${(e) => setRoot(e.target.value)}>
          ${registered.map((p) => html`<option key=${p.root} value=${p.root}>${p.root}${p.vcs?.type === 'p4' ? ' 〔P4〕' : ''}</option>`)}
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
      <button class="primary" onClick=${() => setShowCreate(true)} disabled=${!canWrite}>新建线程</button>
      <button onClick=${() => setShowNote(true)} disabled=${!canWrite}>便签</button>
      <button onClick=${() => refresh()} disabled=${!canWrite}>刷新</button>
    </header>
    <main>
      ${serviceNotice && html`<div class="banner-409">${serviceNotice}</div>`}
      ${notice && html`<div class="hint">${notice}</div>`}
      ${error && html`<div class="empty">${error}</div>`}
      ${currentState === 'empty' && html`
        <div class="empty">
          <p>没有已注册项目。</p>
          <button class="primary" onClick=${() => setShowManage(true)}>打开项目管理</button>
        </div>
      `}
      ${currentState === 'pending' && html`
        <div class="empty">
          <p>项目「${root}」待确认：不会自动注册、初始化或创建 <code>kanban/</code> 结构。</p>
          <div class="modal-actions" style="justify-content:center">
            <button class="primary" disabled=${busy} onClick=${confirmCurrent}>确认注册</button>
            <button disabled=${busy} onClick=${ignoreCurrent}>忽略</button>
            <button onClick=${() => setShowManage(true)}>打开项目管理</button>
          </div>
        </div>
      `}
      ${currentState === 'ignored' && html`
        <div class="empty">
          <p>项目「${root}」已被忽略：自动发现不会登记该项目。</p>
          <div class="modal-actions" style="justify-content:center">
            <button class="primary" disabled=${busy} onClick=${confirmCurrent}>取消忽略</button>
            <button onClick=${() => setShowManage(true)}>打开项目管理</button>
          </div>
        </div>
      `}
      ${currentState === 'unknown' && html`
        <div class="empty">
          <p>项目「${root}」尚未登记：页面不会自动注册、确认或初始化。</p>
          <div class="modal-actions" style="justify-content:center">
            <button class="primary" disabled=${busy} onClick=${confirmCurrent}>确认注册</button>
            <button onClick=${() => setShowManage(true)}>打开项目管理</button>
          </div>
        </div>
      `}
      ${currentState === 'registered' && !layout && html`
        <div class="empty">
          <p>项目「${root}」已注册，但还没有 <code>kanban/</code> 看板结构。</p>
          <div class="modal-actions" style="justify-content:center">
            <button class="primary" disabled=${busy} onClick=${initProject}>初始化</button>
            <button disabled=${busy} onClick=${ignoreCurrent}>忽略</button>
          </div>
          <div class="hint">初始化会创建最小看板结构（线程目录、模板、current 与便签）；忽略后自动发现不再登记该项目。</div>
          ${error && html`<div class="modal-error">${error}</div>`}
        </div>
      `}
      ${currentState === 'registered' && layout && html`
        ${threads === null && !error && html`<div class="empty">加载中…</div>`}
        ${threads !== null && html`
          ${!activeThread && html`<div class="hint">当前无活跃线程（kanban/current 为空）。可在详情页将某条线程设为活跃。</div>`}
          ${selectedId ? html`
            <${ThreadDetail}
              root=${root}
              threadId=${selectedId}
              isActive=${activeThread?.id === selectedId}
              threads=${threads}
              onBack=${() => { setSelectedId(null); refresh(); }}
              onOpen=${openThread}
              onChanged=${() => refresh()}
              onRequestDelete=${(id) => setDeleteTarget({ root, id, title: threads.find((t) => t.id === id)?.title ?? id, active: activeThread?.id === id })}
            />
          ` : view === 'board' ? html`
            <${BoardView} root=${root} threads=${threads} onOpen=${openThread} onChanged=${() => refresh()} onError=${setError} />
          ` : view === 'unfinished' ? html`
            <${UnfinishedView} threads=${threads} onOpen=${openThread} />
          ` : view === 'depgraph' ? html`
            <${DepGraphView} root=${root} threads=${threads} onOpen=${openThread} onChanged=${() => refresh()} />
          ` : html`
            <${ThreadTable} threads=${threads} onOpen=${openThread} />
          `}
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
    ${showManage && html`
      <${ManageModal}
        projects=${projects}
        currentRoot=${root}
        onClose=${() => setShowManage(false)}
        onManaged=${onManaged}
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
