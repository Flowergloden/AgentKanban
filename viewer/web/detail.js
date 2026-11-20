import { html, useEffect, useRef, useState } from './vendor/preact-standalone.module.js';
import { api } from './api.js';
import { MarkdownPreview } from './markdown-preview.js';
import { createExternalSync } from './external-sync.js';
import { MarkdownFieldEditor, ReferenceFieldControl, SelectFieldControl } from './field-controls.js';

export function ThreadDetail({ root, threadId, isActive, threads, onBack, onOpen, onChanged, onRequestDelete }) {
  const [thread, setThread] = useState(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const threadRef = useRef(null);
  threadRef.current = thread;

  const load = async () => {
    try {
      const next = await api.getThread(root, threadId);
      threadRef.current = next;
      setThread(next);
      setError('');
      return next;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  useEffect(() => {
    setThread(null);
    setEditingKey(null);
    setPollError('');
    load();
  }, [root, threadId]);

  useEffect(() => {
    const poller = createExternalSync({
      check: async (generation) => {
        try {
          const next = await api.getThread(root, threadId);
          if (generation !== poller.getGeneration()) return;
          if (next.fingerprint !== threadRef.current?.fingerprint || next.schemaFingerprint !== threadRef.current?.schemaFingerprint) {
            threadRef.current = next;
            setThread(next);
          }
          setPollError('');
        } catch (err) {
          setPollError(`读取失败（${err.message}）；正在编辑的字段会保留本地草稿。`);
        }
      },
    });
    return () => poller.destroy();
  }, [root, threadId]);

  useEffect(() => {
    if (editingKey && thread && !thread.schema.fields.some((field) => field.key === editingKey && field.key !== 'status')) setEditingKey(null);
  }, [thread?.schemaFingerprint]);

  const changed = async () => {
    await load();
    await onChanged();
  };
  const changeStatus = async (value) => {
    try {
      await api.updateField(root, threadId, 'status', value, thread.fingerprint);
      await changed();
    } catch (err) {
      setError(`状态流转失败：${err.message}`);
    }
  };
  const toggleActive = async () => {
    try {
      await api.setActive(root, isActive ? null : threadId);
      await onChanged();
    } catch (err) {
      setError(`活跃切换失败：${err.message}`);
    }
  };

  if (error && !thread) return html`<button onClick=${onBack}>← 返回列表</button><div class="empty">加载失败：${error}</div>`;
  if (!thread) return html`<div class="empty">加载中…</div>`;
  const schema = thread.schema;
  const statusField = schema.fields.find((field) => field.key === 'status');
  return html`
    <div class="detail-head">
      <button onClick=${onBack}>← 返回列表</button>
      <h2>${thread.title}</h2>
      <span class="thread-id">${thread.id}</span>
      ${isActive && html`<span class="badge-active">活跃</span>`}
      <label>status：<select value=${thread.status} onChange=${(event) => changeStatus(event.target.value)}>
        ${statusField.options.map((status) => html`<option key=${status} value=${status}>${status}</option>`)}
      </select></label>
      <button onClick=${toggleActive}>${isActive ? '取消活跃' : '设为活跃'}</button>
      <button class="danger" onClick=${() => onRequestDelete(threadId)}>删除线程</button>
    </div>
    ${(error || pollError) && html`<div class="banner-409">${error || pollError}</div>`}
    ${thread.errors?.length > 0 && html`<div class="banner-409">卷宗映射异常：${thread.errors.join('；')}。请检查 key 标记或重复小节。</div>`}
    ${schema.fields.filter((field) => field.key !== 'status').map((field) => {
      const entry = thread.fields[field.key] ?? { value: field.type === 'reference' ? [] : '', content: '', missing: true };
      const editing = editingKey === field.key;
      const free = field.key === 'goal';
      return html`<section key=${field.key} class="detail-field" data-field-key=${field.key}>
        <div class="section-head">
          <h3>## ${field.label}</h3><span class="field-type">${field.type}</span>
          ${entry.missing && html`<span class="badge-error">卷宗缺失；保存时补建</span>`}
          ${!free && !editing && html`<button onClick=${() => setEditingKey(field.key)}>编辑</button>`}
          ${free && !editing && field.type === 'markdown' && html`<span class="hint">单击正文即可编辑</span>`}
          ${editing && field.type !== 'markdown' && html`<button onClick=${() => setEditingKey(null)}>完成编辑</button>`}
        </div>
        ${editing ? (
          field.type === 'markdown' ? html`<${MarkdownFieldEditor} root=${root} threadId=${threadId} fieldKey=${field.key} onChanged=${changed} onDone=${() => setEditingKey(null)} />`
            : field.type === 'select' ? html`<${SelectFieldControl} root=${root} threadId=${threadId} field=${field} value=${entry.value} fingerprint=${thread.fingerprint} onChanged=${changed} />`
              : html`<${ReferenceFieldControl} root=${root} threadId=${threadId} field=${field} value=${entry.value} fingerprint=${thread.fingerprint} threads=${threads} onOpen=${onOpen} onChanged=${changed} />`
        ) : html`<div class=${'section-body' + (free ? ' editable' : '')} onClick=${() => free && setEditingKey(field.key)}>
          ${field.type === 'markdown' ? html`<${MarkdownPreview} source=${entry.value} />`
            : field.type === 'select' ? html`${entry.value || '（空）'}`
              : entry.value.length === 0 ? html`（空）` : entry.value.map((num) => {
                const target = threads.find((item) => item.id.slice(0, 4) === num);
                return html`<div key=${num}>${target ? html`<a href="#" onClick=${(event) => { event.preventDefault(); onOpen(target.id); }}>${num} ${target.title}</a>` : html`<span class="reference-dangling">${num}（悬空）</span>`}</div>`;
              })}
        </div>`}
      </section>`;
    })}
    ${thread.unmappedSections?.length > 0 && html`<section class="unmapped-sections">
      <h3>未映射小节（只读）</h3>
      ${thread.unmappedSections.map((section) => html`<div key=${section.name} class="section-body">
        <strong>## ${section.name}</strong><div class="badge-error">${section.reason}</div>
        <pre class="md-preview-source">${section.content}</pre>
      </div>`)}
    </section>`}
  `;
}
