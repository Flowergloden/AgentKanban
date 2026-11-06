// 可复用的文档同步控制器：集中维护共同基准、修订号、单在途保存与真实状态。
// 读写与计时器全部可注入，线程小节与便签各自适配现有 API；新建目标不创建控制器。

export const SYNC_STATUS = Object.freeze({
  dirty: 'dirty',
  saving: 'saving',
  saved: 'saved',
  error: 'error',
  conflict: 'conflict',
});

export const SYNC_STATUS_LABEL = Object.freeze({
  dirty: '未保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  conflict: '冲突',
});

// 程序化更新草稿（自动合并/采用外部）时把原光标位置映射到新文本：
// 光标前内容未变则位置不变；光标后内容未变则相对尾距不变；
// 否则落在改动区起点，避免闪烁式跳变。
export function mapCursor(oldText, newText, cursor) {
  const oldStr = String(oldText ?? '');
  const newStr = String(newText ?? '');
  let prefix = 0;
  const prefixLimit = Math.min(oldStr.length, newStr.length);
  while (prefix < prefixLimit && oldStr[prefix] === newStr[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldStr.length - prefix
    && suffix < newStr.length - prefix
    && oldStr[oldStr.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
  ) suffix += 1;
  if (cursor <= prefix) return Math.min(cursor, newStr.length);
  if (cursor >= oldStr.length - suffix) return newStr.length - (oldStr.length - Math.min(cursor, oldStr.length));
  const newMiddle = newStr.length - prefix - suffix;
  return prefix + Math.min(cursor - prefix, newMiddle);
}

export function createDocumentSync({
  write,
  merge, // 可选 (base, local, remote) => { content } | { conflict: true }；未注入时双方均变按冲突处理
  debounceMs = 800,
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
  onChange = () => {},
}) {
  if (typeof write !== 'function') throw new Error('createDocumentSync: 缺少 write');

  let baseContent = '';
  let baseFingerprint = '';
  let draft = '';
  let revision = 0;
  let inFlight = null; // { revision, content }
  let status = SYNC_STATUS.saved;
  let timer = null;
  let chained = false; // 在途保存完成后是否需要续写最新草稿
  let currentSave = null;
  let pendingRemote = null; // 保存中收到的外部快照，落地后基于最新共同基准重新判断
  let paused = false; // 暂停自动保存（服务失联/线程被删），保留草稿，flush 仍可显式重试

  const getState = () => ({
    status,
    revision,
    draft,
    baseContent,
    baseFingerprint,
    inFlight: inFlight ? { revision: inFlight.revision } : null,
  });
  const emit = () => onChange(getState());

  const schedule = () => {
    if (paused) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void save();
    }, debounceMs);
  };

  // 单一在途写：任何时刻不并行写入同一编辑会话。
  // 保存期间的新输入只增加修订号；旧响应推进共同基准但不替换更新的草稿，完成后续写最新草稿。
  function save(force = false) {
    if (inFlight) {
      chained = true;
      return currentSave;
    }
    if (status === SYNC_STATUS.conflict && !force) return Promise.resolve(); // 冲突暂停自动保存，仅显式 flush 重试
    if (status !== SYNC_STATUS.error && draft === baseContent) return Promise.resolve(); // 无变化不写
    const content = draft;
    const fingerprint = baseFingerprint;
    const saveRevision = revision;
    inFlight = { revision: saveRevision, content };
    status = SYNC_STATUS.saving;
    emit();
    currentSave = (async () => {
      try {
        const result = await write(content, fingerprint);
        // 旧响应可推进共同基准（按本次实际保存的内容），但不替换更新的草稿
        baseContent = content;
        baseFingerprint = result?.fingerprint ?? baseFingerprint;
        inFlight = null;
        // 保存期间收到的外部快照：基于最新共同基准重新判断
        if (pendingRemote) {
          const remote = pendingRemote;
          pendingRemote = null;
          reconcile(remote.content, remote.fingerprint);
        }
        if (chained || revision !== saveRevision) {
          chained = false;
          if (draft !== baseContent) {
            status = SYNC_STATUS.dirty;
            emit();
            return save(); // 用刚拿到的最新指纹续写最新草稿
          }
        }
        status = SYNC_STATUS.saved;
        emit();
      } catch (error) {
        inFlight = null;
        chained = false;
        status = error?.status === 409 ? SYNC_STATUS.conflict : SYNC_STATUS.error;
        emit();
      }
    })();
    return currentSave;
  }

  // 外部快照协调（content 与控制器同一投影，fingerprint 为整文件最新指纹）。
  // 返回 { kind }：unchanged | deferred | adopted | converged | draft-kept | merged | conflict
  function reconcile(content, fingerprint) {
    if (fingerprint === baseFingerprint && content === baseContent) return { kind: 'unchanged' };
    if (inFlight) {
      // 保存中收到的外部快照先暂存，保存响应落地后再基于最新共同基准重新判断
      pendingRemote = { content, fingerprint };
      return { kind: 'deferred' };
    }
    if (draft === baseContent) {
      // 本地无未保存修改：采用外部内容、指纹
      baseContent = content;
      draft = content;
      baseFingerprint = fingerprint;
      status = SYNC_STATUS.saved;
      emit();
      return { kind: 'adopted' };
    }
    if (content === draft) {
      // 外部当前内容等于本地草稿：双方收敛，采用外部指纹并标记已保存
      baseContent = content;
      baseFingerprint = fingerprint;
      status = SYNC_STATUS.saved;
      emit();
      return { kind: 'converged' };
    }
    if (content === baseContent) {
      // 外部仅修改其他区域（对当前投影无变化）：保留草稿，采用最新指纹使后续保存可继续
      baseFingerprint = fingerprint;
      emit();
      return { kind: 'draft-kept' };
    }
    if (typeof merge === 'function') {
      const result = merge(baseContent, draft, content);
      if (result && result.conflict) {
        status = SYNC_STATUS.conflict;
        emit();
        return { kind: 'conflict', remote: content };
      }
      // 无冲突：采用合并草稿，按外部最新指纹安排保存；成功后成为新共同基准
      revision += 1;
      draft = result.content;
      baseFingerprint = fingerprint;
      status = SYNC_STATUS.dirty;
      emit();
      schedule();
      return { kind: 'merged', content: result.content };
    }
    status = SYNC_STATUS.conflict;
    emit();
    return { kind: 'conflict', remote: content };
  }

  return {
    getState,

    // 以读取到的整文件内容与指纹建立共同基准；草稿初始等于基准。
    start({ content = '', fingerprint = '' } = {}) {
      baseContent = content;
      baseFingerprint = fingerprint;
      draft = content;
      revision = 0;
      status = SYNC_STATUS.saved;
      emit();
    },

    // 本地输入：内容未变不增修订号；变化后进入未保存并安排防抖保存。
    // 冲突态输入只作为人工合并素材，不恢复自动保存。
    setDraft(next) {
      const content = String(next ?? '');
      if (content === draft) return;
      revision += 1;
      draft = content;
      if (!inFlight && status !== SYNC_STATUS.conflict) status = SYNC_STATUS.dirty;
      emit();
      schedule();
    },

    // 离开前提交：立即取消防抖等待并尝试保存；在途保存先等其落地再续写最新草稿；
    // 失败时保留草稿与状态，由调用方决定重试。
    async flush() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      if (inFlight) {
        chained = true;
        await currentSave;
      }
      await save(true);
    },

    // 人工解决冲突：以用户确认的内容按检测到的外部最新指纹保存；
    // 成功后更新共同基准并恢复自动保存，失败保持冲突上下文。
    async resolveConflict(content, fingerprint) {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      baseFingerprint = fingerprint;
      draft = String(content ?? '');
      revision += 1;
      status = SYNC_STATUS.dirty;
      emit();
      await save(true);
      return getState().status === SYNC_STATUS.saved;
    },

    // 明确采用外部版本：不执行写请求，双方内容以远程为准，恢复自动保存。
    adoptRemote(content, fingerprint) {
      baseContent = String(content ?? '');
      draft = baseContent;
      baseFingerprint = fingerprint;
      status = SYNC_STATUS.saved;
      emit();
    },

    // 外部快照入口：content 与当前文档同一投影，fingerprint 为整文件最新指纹。
    applyRemote({ content = '', fingerprint }) {
      return reconcile(String(content ?? ''), fingerprint);
    },

    // 暂停/恢复自动保存（服务失联、线程被外部删除等）：暂停期间保留草稿，flush 仍可显式提交。
    pause() {
      paused = true;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
    },
    resume() {
      paused = false;
    },

    destroy() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
