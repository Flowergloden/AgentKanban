import { html, useState, useEffect } from './vendor/preact-standalone.module.js';
import { api } from './api.js';

export function CreateModal({ root, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setError('标题是必填项');
      return;
    }
    if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      setError('slug 必须是 kebab-case（小写字母、数字、连字符），留空则自动生成');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { id, created } = await api.createThread(root, title.trim(), slug.trim(), goal.trim());
      onCreated(id, created);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return html`
    <div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal">
        <h3>新建线程</h3>
        <label>标题（必填）</label>
        <input value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="例如：视图体系探索" autoFocus />
        <label>目标（选填）：这条线程要达成的笼统目标，写入卷宗「目标」小节</label>
        <textarea
          class="note-editor"
          style="min-height: 64px"
          value=${goal}
          onInput=${(e) => setGoal(e.target.value)}
          placeholder="例如：验证新版看板的交互细节，填补不合理或有障碍之处"
        />
        <label>slug（选填，kebab-case；留空时英文标题自动生成，非英文标题将由 Agent 在会话校准时自动命名）</label>
        <input value=${slug} onInput=${(e) => setSlug(e.target.value)} placeholder="例如：view-system" />
        ${error && html`<div class="modal-error">${error}</div>`}
        <div class="modal-actions">
          <button onClick=${onClose} disabled=${busy}>取消</button>
          <button class="primary" onClick=${submit} disabled=${busy}>创建</button>
        </div>
      </div>
    </div>
  `;
}

export function NoteModal({ root, onClose }) {
  const [content, setContent] = useState(null); // null = 加载中
  const [fingerprint, setFingerprint] = useState('');
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    setConflict(false);
    try {
      const n = await api.getNote(root);
      setContent(n.note);
      setFingerprint(n.fingerprint);
    } catch (err) {
      setError(err.message);
      setContent(null);
    }
  };

  useEffect(() => { load(); }, [root]);

  const save = async () => {
    if (content === null || busy) return;
    setBusy(true);
    setError('');
    try {
      const { fingerprint: fp } = await api.updateNote(root, content, fingerprint);
      setFingerprint(fp);
      setConflict(false);
      onClose();
    } catch (err) {
      if (err.status === 409) {
        setConflict(true);
      } else {
        setError(`保存失败：${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div class="modal modal--wide">
        <h3>全局便签</h3>
        <div class="hint" style="margin-top:0">仅供人类随手记录，不参与任何工作流（Agent 不读取、不采用此处内容）。内容保存到 <code>kanban/note.md</code>，也可用文本编辑器直接编辑。</div>
        ${conflict && html`
          <div class="banner-409">
            <span>文件已被修改，当前编辑未保存到磁盘。请复制好你的修改后重新加载。</span>
            <button class="primary" onClick=${load}>重新加载（丢弃本地编辑）</button>
          </div>
        `}
        ${content === null ? html`
          ${error ? html`
            <div class="modal-error">加载失败：${error}</div>
            <div class="modal-actions"><button onClick=${load}>重试</button></div>
          ` : html`<div class="empty">加载中…</div>`}
        ` : html`
          ${error && html`<div class="modal-error">${error}</div>`}
          <textarea
            class="note-editor"
            value=${content}
            onInput=${(e) => setContent(e.target.value)}
            autoFocus
          />
        `}
        <div class="modal-actions">
          <button onClick=${onClose} disabled=${busy}>取消</button>
          <button class="primary" onClick=${save} disabled=${busy || content === null}>保存</button>
        </div>
      </div>
    </div>
  `;
}

export function P4AddModal({ root, files, onClose, onAdded }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await api.vcsAdd(root, files);
      onAdded(files);
    } catch (err) {
      setError(`p4 add 失败：${err.message}`);
      setBusy(false);
    }
  };

  return html`
    <div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div class="modal">
        <h3>新文件纳入 P4 管理？</h3>
        <div class="hint" style="margin-top:0">该项目受 Perforce 管理，以下新建文件尚未纳入版本管理。确认后将执行 <code>p4 add</code>（留在默认 changelist，由你自行提交）。</div>
        <ul class="p4-file-list">
          ${files.map((f) => html`<li key=${f}><code>${f}</code></li>`)}
        </ul>
        ${error && html`<div class="modal-error">${error}</div>`}
        <div class="modal-actions">
          <button onClick=${onClose} disabled=${busy}>不 add</button>
          <button class="primary" onClick=${confirm} disabled=${busy}>p4 add</button>
        </div>
      </div>
    </div>
  `;
}

export function DeleteModal({ thread, onClose, onDeleted }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deleteThread(thread.root, thread.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const needSecondConfirm = thread.active && step === 1;
  return html`
    <div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal">
        <h3>删除线程</h3>
        ${needSecondConfirm ? html`
          <p>确定删除线程 <strong>${thread.title}</strong> 吗？目录 <code>${thread.id}</code> 将被整个移除，此操作不可撤销（只能靠 git 历史恢复）。</p>
          <div class="modal-actions">
            <button onClick=${onClose}>取消</button>
            <button class="danger" onClick=${() => setStep(2)}>继续</button>
          </div>
        ` : thread.active ? html`
          <p style="color:#cf222e"><strong>二次确认：</strong>该线程是当前活跃线程，删除后将同时取消活跃（清空 <code>kanban/current</code>）。确定继续吗？</p>
          ${error && html`<div class="modal-error">${error}</div>`}
          <div class="modal-actions">
            <button onClick=${onClose} disabled=${busy}>取消</button>
            <button class="danger" onClick=${doDelete} disabled=${busy}>确认删除并取消活跃</button>
          </div>
        ` : html`
          <p>确定删除线程 <strong>${thread.title}</strong> 吗？目录 <code>${thread.id}</code> 将被整个移除，此操作不可撤销（只能靠 git 历史恢复）。</p>
          ${error && html`<div class="modal-error">${error}</div>`}
          <div class="modal-actions">
            <button onClick=${onClose} disabled=${busy}>取消</button>
            <button class="danger" onClick=${doDelete} disabled=${busy}>确认删除</button>
          </div>
        `}
      </div>
    </div>
  `;
}

const PROJECT_SECTIONS = [
  { key: 'pending', title: '待确认', hint: '自动发现的新项目；确认后进入已注册列表，忽略则持久抑制自动发现' },
  { key: 'registered', title: '已注册', hint: '主项目切换列表只展示这些项目' },
  { key: 'ignored', title: '已忽略', hint: '自动发现不再登记这些项目；取消忽略可恢复为已注册' },
];

// 项目管理：按状态分区提供新增、确认、忽略、取消忽略与删除；操作失败保留真实状态并显示错误
export function ManageModal({ projects, currentRoot, onClose, onManaged }) {
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');
  const [path, setPath] = useState('');

  const run = async (key, action) => {
    if (busyKey) return;
    setBusyKey(key);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey('');
    }
  };

  const act = (key, action, op, opRoot) => () => run(key, async () => {
    await action();
    setPendingDelete('');
    await onManaged(op, opRoot);
  });

  const add = () => run('add', async () => {
    const value = path.trim();
    if (!value) {
      setError('请输入项目根绝对路径');
      return;
    }
    await api.addProject(value);
    setPath('');
    await onManaged('add');
  });

  const rowButtons = (p) => {
    const key = p.root;
    const busy = busyKey === key;
    if (pendingDelete === key) {
      return html`
        <button class="danger" disabled=${busy} onClick=${act(key, () => api.deleteProject(p.root), 'delete', p.root)}>确认删除</button>
        <button disabled=${busy} onClick=${() => setPendingDelete('')}>取消</button>
      `;
    }
    return html`
      ${p.state === 'pending' && html`<button class="primary" disabled=${busy} onClick=${act(key, () => api.confirmProject(p.root), 'confirm', p.root)}>确认</button>`}
      ${p.state === 'ignored' && html`<button class="primary" disabled=${busy} onClick=${act(key, () => api.confirmProject(p.root), 'confirm', p.root)}>取消忽略</button>`}
      ${p.state !== 'ignored' && html`<button disabled=${busy} onClick=${act(key, () => api.ignoreProject(p.root), 'ignore', p.root)}>忽略</button>`}
      <button class="danger" disabled=${busy} onClick=${() => setPendingDelete(key)}>删除</button>
    `;
  };

  const normCurrent = String(currentRoot || '').toLowerCase();
  return html`
    <div class="modal-mask" onClick=${(e) => e.target === e.currentTarget && !busyKey && onClose()}>
      <div class="modal modal--wide">
        <h3>项目管理</h3>
        <div class="hint" style="margin-top:0">
          删除仅移除注册记录，项目文件与 <code>kanban/</code> 保持原样，之后有会话活动只会重新发现为待确认；
          忽略则持久抑制自动发现。两者都不会动项目目录。
        </div>
        ${PROJECT_SECTIONS.map(({ key, title, hint }) => {
          const rows = projects.filter((p) => p.state === key);
          return html`
            <div class="proj-section" key=${key}>
              <h4>${title}（${rows.length}）</h4>
              <div class="hint" style="margin:0 0 4px">${hint}</div>
              ${rows.length === 0 ? html`<div class="hint">（无）</div>` : rows.map((p) => html`
                <div class="proj-row" key=${p.root}>
                  <span class="proj-root">
                    ${p.root}
                    ${p.root.toLowerCase() === normCurrent ? '〔当前〕' : ''}
                    ${p.vcs?.type === 'p4' ? '〔P4〕' : ''}
                  </span>
                  ${rowButtons(p)}
                </div>
              `)}
            </div>
          `;
        })}
        <div class="proj-section">
          <h4>手动新增</h4>
          <div class="hint" style="margin:0 0 4px">输入现存目录的绝对路径，新增后直接成为已注册项目；不会自动初始化看板，也不切换当前项目。</div>
          <div class="proj-row">
            <input class="proj-add-input" value=${path} onInput=${(e) => setPath(e.target.value)} placeholder="例如：D:\work\my-project" />
            <button class="primary" disabled=${busyKey === 'add'} onClick=${add}>新增为已注册</button>
          </div>
        </div>
        ${error && html`<div class="modal-error">操作失败：${error}</div>`}
        <div class="modal-actions">
          <button onClick=${onClose} disabled=${!!busyKey}>关闭</button>
        </div>
      </div>
    </div>
  `;
}
