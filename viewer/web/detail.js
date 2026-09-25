import { html, useState, useEffect } from './vendor/preact-standalone.module.js';
import { api } from './api.js';

const SECTIONS = ['目标', '已完成的工作', '决策', 'Changes'];
const STATUSES = ['立项', '规划', '实现', '完成'];
// 「目标」随手可改（单击进入编辑）；其余小节默认只读，点「编辑」解锁
const FREE_EDIT = new Set(['目标']);

export function ThreadDetail({ root, threadId, isActive, onBack, onChanged, onRequestDelete }) {
  const [thread, setThread] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { section, content }
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    setConflict(false);
    setEditing(null);
    try {
      setThread(await api.getThread(root, threadId));
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [root, threadId]);

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const { fingerprint } = await api.updateSection(root, threadId, editing.section, editing.content, thread.fingerprint);
      setThread({ ...thread, fingerprint, sections: { ...thread.sections, [editing.section]: editing.content } });
      setEditing(null);
      setConflict(false);
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
    ${conflict && html`
      <div class="banner-409">
        <span>文件已被修改（可能被 Agent 更新），当前编辑未保存到磁盘。请复制好你的修改后重新加载。</span>
        <button class="primary" onClick=${load}>重新加载（丢弃本地编辑）</button>
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
            ${!free && !isEditing && html`<button onClick=${() => setEditing({ section: name, content: body })}>编辑</button>`}
            ${free && !isEditing && html`<span style="color:#57606a;font-size:12px">单击正文即可编辑</span>`}
          </div>
          ${isEditing ? html`
            <textarea
              class="section-editor"
              value=${editing.content}
              onInput=${(e) => setEditing({ ...editing, content: e.target.value })}
            />
            <button class="primary" disabled=${busy} onClick=${save}>保存</button>
            <button disabled=${busy} onClick=${() => setEditing(null)}>取消</button>
          ` : html`
            <pre
              class=${'section-body' + (free ? ' editable' : '')}
              onClick=${() => free && setEditing({ section: name, content: body })}
            >${body.trim() ? body : '（空）'}</pre>
          `}
        </div>
      `;
    })}
  `;
}
