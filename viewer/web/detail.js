import { html, useState, useEffect, useRef } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { MarkdownPreview } from './markdown-preview.js';
import { createDocumentSync, SYNC_STATUS_LABEL, mapCursor } from './document-sync.js';
import { createExternalSync } from './external-sync.js';
import { mergeDocuments } from './markdown-merge.js';

const SECTIONS = ['目标', '已完成的工作', '决策', 'Changes', '依赖'];
const STATUSES = ['立项', '规划', '实现', '完成'];
// 「目标」随手可改（单击进入编辑）；其余小节默认只读，点「编辑」解锁
const FREE_EDIT = new Set(['目标']);

// 阅读模式下渲染 `## 依赖`：序号条目链接化为被依赖线程标题（点击跳转详情），悬空序号加删除线不渲染链接
function renderDeps(body, threads, onOpen) {
  const lines = body.split('\n').filter((l) => l.trim());
  if (!lines.length) return html`<div class="section-body md-preview--empty">（空）</div>`;
  const byNum = new Map((threads ?? []).map((t) => [t.id.slice(0, 4), t]));
  return html`<div class="section-body" style="white-space:pre-wrap">${lines.map((line, i) => {
    const m = line.match(/\d{4}/);
    if (!m) return html`${line}${'\n'}`;
    const target = byNum.get(m[0]);
    if (!target) {
      return html`<span key=${i} style="text-decoration:line-through" title="悬空引用：无对应线程">${line}${'\n'}</span>`;
    }
    return html`<a key=${i} href="#" onClick=${(e) => { e.preventDefault(); onOpen(target.id); }}>${target.id} ${target.title}</a>${'\n'}`;
  })}</div>`;
}

export function ThreadDetail({ root, threadId, isActive, threads, onBack, onOpen, onChanged, onRequestDelete }) {
  const [thread, setThread] = useState(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [conflictRemote, setConflictRemote] = useState(null); // 冲突时外部该小节内容（4.3 用于对比界面）
  const [editing, setEditing] = useState(null); // { section, sync }
  const [editState, setEditState] = useState(null); // 控制器状态镜像
  const editingRef = useRef(null);
  editingRef.current = editing;
  const threadRef = useRef(null);
  threadRef.current = thread;
  const pollerRef = useRef(null);
  const taRef = useRef(null);
  const prevDraftRef = useRef(null);
  const inputAtRef = useRef(0);

  // 程序化草稿更新（自动合并/采用外部）时保留光标；用户自己的输入不干预
  useEffect(() => {
    const ta = taRef.current;
    const draft = editState?.draft;
    if (!ta) {
      prevDraftRef.current = draft ?? null;
      return;
    }
    if (Date.now() - inputAtRef.current < 150) {
      prevDraftRef.current = draft ?? null;
      return;
    }
    if (document.activeElement === ta && prevDraftRef.current != null && prevDraftRef.current !== draft) {
      const mapped = mapCursor(prevDraftRef.current, draft ?? '', ta.selectionStart ?? 0);
      prevDraftRef.current = draft ?? null;
      requestAnimationFrame(() => {
        if (document.activeElement === ta) {
          ta.selectionStart = mapped;
          ta.selectionEnd = mapped;
        }
      });
      return;
    }
    prevDraftRef.current = draft ?? null;
  }, [editState?.draft]);

  const load = async () => {
    setError('');
    try {
      const t = await api.getThread(root, threadId);
      threadRef.current = t;
      setThread(t);
      return t;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  // 外部快照协调：指纹未变不重置；干净页面采用；编辑中按控制器规则处理
  const applyExternal = (t, gen) => {
    if (gen !== pollerRef.current?.getGeneration()) return; // 代次失效，忽略旧响应
    const current = editingRef.current;
    const prev = threadRef.current;
    if (!prev || t.fingerprint === prev.fingerprint) return;
    if (!current) {
      threadRef.current = t;
      setThread(t); // 本地无未保存修改：采用外部版本
      return;
    }
    const outcome = current.sync.applyRemote({ content: t.sections[current.section] ?? '', fingerprint: t.fingerprint });
    if (outcome.kind === 'unchanged' || outcome.kind === 'deferred') return;
    const keepLocal = { ...t, sections: { ...t.sections, [current.section]: prev.sections[current.section] ?? '' } };
    if (outcome.kind === 'draft-kept') {
      threadRef.current = keepLocal;
      setThread(keepLocal); // 外部仅改其他小节：保留草稿，指纹已由控制器推进
      return;
    }
    if (outcome.kind === 'conflict') {
      threadRef.current = keepLocal;
      setThread(keepLocal);
      setConflictRemote({ content: outcome.remote, fingerprint: t.fingerprint }); // 自动保存暂停，等待人工处理（4.3）
      return;
    }
    if (outcome.kind === 'merged') {
      const merged = { ...t, sections: { ...t.sections, [current.section]: outcome.content } };
      threadRef.current = merged;
      setThread(merged);
      return;
    }
    threadRef.current = t; // adopted / converged
    setThread(t);
  };

  useEffect(() => {
    // 切换 root/线程时放弃当前编辑会话（未 flush 的草稿由调用方在卸载时兜底）
    if (editingRef.current) editingRef.current.sync.destroy();
    setEditing(null);
    setEditState(null);
    setConflictRemote(null);
    setPollError('');
    load();
  }, [root, threadId]);

  // 可见页面轮询外部变更；读取失败/线程被删时保留草稿并暂停自动保存，服务恢复后可继续
  useEffect(() => {
    const poller = createExternalSync({
      check: async (gen) => {
        try {
          const t = await api.getThread(root, threadId);
          editingRef.current?.sync.resume();
          setPollError('');
          applyExternal(t, gen);
        } catch (err) {
          editingRef.current?.sync.pause();
          setPollError(err.status === 404
            ? '线程已被删除或读取失败；自动保存已暂停，本地草稿保留，服务恢复后可重试。'
            : `读取失败（${err.message}）；自动保存已暂停，本地草稿保留。`);
        }
      },
    });
    pollerRef.current = poller;
    return () => poller.destroy();
  }, [root, threadId]);

  // 离开当前详情（卸载）前 flush：尽力提交待保存草稿，失败也保留在服务侧重试能力之外不静默丢弃
  useEffect(() => () => {
    const current = editingRef.current;
    if (current) {
      current.sync.destroy();
      void current.sync.flush();
    }
  }, []);

  // 冲突横幅的重新加载：丢弃本地编辑会话，从磁盘重载
  const reloadAll = async () => {
    if (editingRef.current) editingRef.current.sync.destroy();
    setEditing(null);
    setEditState(null);
    setConflictRemote(null);
    await load();
  };

  const startEdit = (name, body) => {
    if (!thread) return;
    setConflictRemote(null);
    const sync = createDocumentSync({
      write: (content, fingerprint) => api.updateSection(root, threadId, name, content, fingerprint),
      merge: (base, local, remote) => mergeDocuments(base, local, remote),
      onChange: setEditState,
    });
    sync.start({ content: body, fingerprint: thread.fingerprint });
    setEditState(sync.getState());
    setEditing({ section: name, sync });
  };

  // 「完成编辑」替代取消语义：flush 成功才退出编辑；失败/冲突保持编辑上下文
  const finishEdit = async () => {
    const current = editing;
    if (!current) return;
    await current.sync.flush();
    const state = current.sync.getState();
    if (state.status === 'saved' && thread) {
      setThread({
        ...thread,
        fingerprint: state.baseFingerprint,
        sections: { ...thread.sections, [current.section]: state.baseContent },
      });
      setEditing(null);
      setEditState(null);
      onChanged();
    }
  };

  // 冲突处理（4.3）：左侧草稿可编辑作为手工合并素材，右侧外部版本只读
  const resolveAndSave = async () => {
    const current = editing;
    if (!current || !conflictRemote) return;
    const ok = await current.sync.resolveConflict(editState?.draft ?? '', conflictRemote.fingerprint);
    if (ok && thread) {
      const state = current.sync.getState();
      const next = {
        ...thread,
        fingerprint: state.baseFingerprint,
        sections: { ...thread.sections, [current.section]: state.baseContent },
      };
      threadRef.current = next;
      setThread(next);
      setConflictRemote(null);
    }
  };

  const adoptExternal = () => {
    const current = editing;
    if (!current || !conflictRemote || !thread) return;
    current.sync.adoptRemote(conflictRemote.content, conflictRemote.fingerprint);
    const next = {
      ...thread,
      fingerprint: conflictRemote.fingerprint,
      sections: { ...thread.sections, [current.section]: conflictRemote.content },
    };
    threadRef.current = next;
    setThread(next);
    setConflictRemote(null);
  };

  const changeStatus = async (status) => {
    try {
      const { fingerprint } = await api.setStatus(root, threadId, status);
      setThread({ ...thread, status, fingerprint });
      onChanged();
    } catch (err) {
      setError(`状态流转失败：${err.message}`);
    }
  };

  const toggleActive = async () => {
    try {
      await api.setActive(root, isActive ? null : threadId);
      onChanged();
    } catch (err) {
      setError(`活跃切换失败：${err.message}`);
    }
  };

  if (error && !thread) {
    return html`
      <button onClick=${onBack}>← 返回列表</button>
      <div class="empty">加载失败：${error}</div>
    `;
  }
  if (!thread) return html`<div class="empty">加载中…</div>`;

  return html`
    <div class="detail-head">
      <button onClick=${onBack}>← 返回列表</button>
      <h2>${thread.title}</h2>
      <span style="color:#57606a;font-size:13px">${thread.id}</span>
      ${isActive && html`<span class="badge-active">活跃</span>`}
      <label style="font-size:13px">
        status：
        <select value=${thread.status} onChange=${(e) => changeStatus(e.target.value)}>
          ${STATUSES.map((s) => html`<option key=${s} value=${s}>${s}</option>`)}
        </select>
      </label>
      <button onClick=${toggleActive}>${isActive ? '取消活跃' : '设为活跃'}</button>
      <button class="danger" onClick=${() => onRequestDelete(threadId)}>删除线程</button>
    </div>
    ${error && html`<div class="banner-409">${error}</div>`}
    ${pollError && html`<div class="banner-409">${pollError}</div>`}
    ${editState?.status === 'conflict' && html`
      <div class="banner-409">
        <span>文件已被修改（可能被 Agent 更新），自动保存已暂停，当前编辑仍保留。请复制好你的修改后重新加载，或使用冲突处理。</span>
        <button class="primary" onClick=${reloadAll}>重新加载（丢弃本地编辑）</button>
      </div>
    `}
    ${SECTIONS.map((name) => {
      const body = thread.sections[name] ?? '';
      const isEditing = editing?.section === name;
      const free = FREE_EDIT.has(name);
      return html`
        <div key=${name}>
          <div class="section-head">
            <h3>## ${name}</h3>
            ${!free && !isEditing && html`<button onClick=${() => startEdit(name, body)}>编辑</button>`}
            ${free && !isEditing && html`<span style="color:#57606a;font-size:12px">单击正文即可编辑</span>`}
            ${isEditing && html`<span class="sync-status" data-status=${editState?.status}>${SYNC_STATUS_LABEL[editState?.status] ?? ''}</span>`}
          </div>
          ${isEditing ? html`
            <div class="section-split">
              <textarea
                ref=${taRef}
                class="section-editor"
                value=${editState?.draft ?? ''}
                onInput=${(e) => { inputAtRef.current = Date.now(); editing.sync.setDraft(e.target.value); }}
              />
              ${editState?.status === 'conflict' && conflictRemote ? html`
                <div class="conflict-remote section-preview">
                  <div class="conflict-col-title">外部版本（只读）</div>
                  <${MarkdownPreview} source=${conflictRemote.content} />
                </div>
              ` : html`
                <${MarkdownPreview}
                  className="section-preview"
                  source=${editState?.draft ?? ''}
                  onSourceChange=${(next) => { inputAtRef.current = Date.now(); editing.sync.setDraft(next); }}
                />
              `}
            </div>
            ${editState?.status === 'conflict' ? html`
              <div class="conflict-actions">
                <span class="hint" style="margin:0">本地与外部修改了同一区域：在左侧手工合并后确认保存，或明确采用外部版本；两者都会更新共同基准并恢复自动保存。</span>
                <div style="display:flex;gap:8px;margin-top:6px">
                  <button class="primary" onClick=${resolveAndSave}>已解决并保存</button>
                  <button onClick=${adoptExternal}>采用外部版本</button>
                </div>
              </div>
            ` : html`<button class="primary" onClick=${finishEdit}>完成编辑</button>`}
          ` : name === '依赖' ? renderDeps(body, threads, onOpen) : html`
            <div
              class=${'section-body' + (free ? ' editable' : '')}
              onClick=${() => free && startEdit(name, body)}
            >
              <${MarkdownPreview} source=${body} />
            </div>
          `}
        </div>
      `;
    })}
  `;
}
