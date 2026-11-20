import { html, useEffect, useRef, useState } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { MarkdownLiveEditor } from './markdown-live-editor.js';
import { MarkdownPreview } from './markdown-preview.js';
import { createDocumentSync, SYNC_STATUS_LABEL } from './document-sync.js';
import { createExternalSync } from './external-sync.js';
import { mergeDocuments } from './markdown-merge.js';

export function SelectFieldControl({ root, threadId, field, value, fingerprint, onChanged }) {
  const [draft, setDraft] = useState(value ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!dirty && !busy) setDraft(value ?? ''); }, [value, fingerprint]);

  const save = async (next) => {
    setDraft(next);
    setDirty(true);
    setBusy(true);
    setError('');
    try {
      await api.updateField(root, threadId, field.key, next, fingerprint);
      setDirty(false);
      await onChanged();
    } catch (err) {
      setError(err.status === 409 ? '文件已被修改，本次选择未保存；请刷新后重试。' : err.message);
    } finally {
      setBusy(false);
    }
  };
  return html`<span class="field-control" onClick=${(event) => event.stopPropagation()}>
    <select value=${draft} disabled=${busy} onChange=${(event) => save(event.target.value)}>
      ${!field.required && html`<option value="">（空）</option>`}
      ${field.options.map((option) => html`<option key=${option} value=${option}>${option}</option>`)}
    </select>
    ${error && html`<span class="badge-error">${error}</span>`}
  </span>`;
}

export function ReferenceFieldControl({ root, threadId, field, value, fingerprint, threads, onOpen, onChanged }) {
  const [draft, setDraft] = useState(value ?? []);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  useEffect(() => { if (!dirty && !busy) setDraft(value ?? []); }, [JSON.stringify(value), fingerprint]);
  const byNum = new Map((threads ?? []).map((thread) => [thread.id.slice(0, 4), thread]));

  const save = async (next) => {
    setDraft(next);
    setDirty(true);
    setBusy(true);
    setError('');
    try {
      await api.updateField(root, threadId, field.key, next, fingerprint);
      setDirty(false);
      await onChanged();
    } catch (err) {
      setError(err.status === 409 ? '文件已被修改，引用操作未保存；当前选择已保留。' : err.message);
    } finally {
      setBusy(false);
    }
  };
  const available = (threads ?? []).filter((thread) => thread.id !== threadId && !draft.includes(thread.id.slice(0, 4)));
  return html`<div class="field-control reference-control" onClick=${(event) => event.stopPropagation()}>
    ${draft.length === 0 && html`<span class="hint">（空）</span>`}
    ${draft.map((num) => {
      const target = byNum.get(num);
      return html`<span class="reference-tag" key=${num}>
        ${target ? html`<a href="#" onClick=${(event) => { event.preventDefault(); onOpen(target.id); }}>${num} ${target.title}</a>` : html`<span class="reference-dangling" title="悬空引用">${num}（悬空）</span>`}
        <button disabled=${busy} aria-label=${`移除 ${num}`} onClick=${() => save(draft.filter((item) => item !== num))}>×</button>
      </span>`;
    })}
    ${available.length > 0 && html`<span>
      <select value=${adding} disabled=${busy} onChange=${(event) => setAdding(event.target.value)}>
        <option value="">添加引用…</option>
        ${available.map((thread) => html`<option key=${thread.id} value=${thread.id.slice(0, 4)}>${thread.id} ${thread.title}</option>`)}
      </select>
      <button disabled=${busy || !adding} onClick=${() => { save([...draft, adding]); setAdding(''); }}>添加</button>
    </span>`}
    ${error && html`<div class="badge-error">${error}</div>`}
  </div>`;
}

export function MarkdownFieldEditor({ root, threadId, fieldKey, onChanged, onDone }) {
  const [syncState, setSyncState] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [conflictRemote, setConflictRemote] = useState(null);
  const syncRef = useRef(null);
  const pollerRef = useRef(null);

  const load = async () => {
    setError('');
    setReady(false);
    try {
      const detail = await api.getThread(root, threadId);
      const content = detail.fields[fieldKey]?.content ?? '';
      const next = createDocumentSync({
        write: async (text, fingerprint) => {
          const result = await api.updateFieldContent(root, threadId, fieldKey, text, fingerprint);
          await onChanged();
          return result;
        },
        merge: (base, local, remote) => mergeDocuments(base, local, remote),
        onChange: setSyncState,
      });
      syncRef.current?.destroy();
      next.start({ content, fingerprint: detail.fingerprint });
      syncRef.current = next;
      setSyncState(next.getState());
      setConflictRemote(null);
      setReady(true);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    return () => {
      const current = syncRef.current;
      if (current) {
        current.destroy();
        void current.flush();
      }
    };
  }, [root, threadId, fieldKey]);

  useEffect(() => {
    const poller = createExternalSync({
      check: async (generation) => {
        try {
          const detail = await api.getThread(root, threadId);
          if (generation !== poller.getGeneration()) return;
          const sync = syncRef.current;
          if (!sync) return;
          sync.resume();
          const outcome = sync.applyRemote({ content: detail.fields[fieldKey]?.content ?? '', fingerprint: detail.fingerprint });
          if (outcome.kind === 'conflict') setConflictRemote({ content: outcome.remote, fingerprint: detail.fingerprint });
          else if (outcome.kind !== 'deferred') setConflictRemote(null);
          setError('');
        } catch (err) {
          syncRef.current?.pause();
          setError(`读取失败（${err.message}）；自动保存已暂停，草稿保留。`);
        }
      },
    });
    pollerRef.current = poller;
    return () => poller.destroy();
  }, [root, threadId, fieldKey]);

  const finish = async () => {
    const sync = syncRef.current;
    if (!sync) return;
    await sync.flush();
    if (sync.getState().status === 'saved') onDone?.();
  };
  const resolve = async () => {
    const sync = syncRef.current;
    if (sync && conflictRemote && await sync.resolveConflict(syncState?.draft ?? '', conflictRemote.fingerprint)) setConflictRemote(null);
  };
  const adopt = () => {
    if (syncRef.current && conflictRemote) {
      syncRef.current.adoptRemote(conflictRemote.content, conflictRemote.fingerprint);
      setConflictRemote(null);
    }
  };

  if (!ready) return html`<div class="hint">${error || '加载字段…'} ${error && html`<button onClick=${load}>重试</button>`}</div>`;
  return html`<div class="markdown-field-editor" onClick=${(event) => event.stopPropagation()}>
    ${error && html`<div class="banner-409">${error}</div>`}
    <div class="section-split">
      <${MarkdownLiveEditor} value=${syncState?.draft ?? ''} onChange=${(next) => syncRef.current?.setDraft(next)} autoFocus />
      ${conflictRemote && html`<div class="conflict-remote section-preview">
        <div class="conflict-col-title">外部版本（只读）</div>
        <${MarkdownPreview} source=${conflictRemote.content} />
      </div>`}
    </div>
    ${syncState?.status === 'conflict' && html`<div class="banner-409">文件已被修改，自动保存已暂停，本地草稿仍保留。</div>`}
    <div class="conflict-actions">
      <span class="sync-status" data-status=${syncState?.status}>${SYNC_STATUS_LABEL[syncState?.status] ?? ''}</span>
      ${conflictRemote ? html`
        <button class="primary" onClick=${resolve}>已解决并保存</button>
        <button onClick=${adopt}>采用外部版本</button>
      ` : onDone && html`<button class="primary" onClick=${finish}>完成编辑</button>`}
    </div>
  </div>`;
}
