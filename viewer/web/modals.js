import { html, useState } from './vendor/preact-standalone.module.js';
import { api } from './api.js';

export function CreateModal({ root, onClose, onCreated }) {
  const [title, setTitle] = useState('');
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
      const { id } = await api.createThread(root, title.trim(), slug.trim());
      onCreated(id);
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
        <label>slug（选填，kebab-case；留空自动从标题生成）</label>
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
