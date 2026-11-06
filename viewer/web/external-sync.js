// 可见页面外部变更轮询：仅页面可见时按固定间隔检查，隐藏时暂停，
// 恢复可见或获得焦点时立即检查；每个资源由 check 内部保证单在途，
// 此处对整体检查做在途去重。root/线程/便签切换时调用 invalidate() 递增代次，
// 携带旧代次的响应由调用方比对忽略。

export function createExternalSync({
  check,
  intervalMs = 2500,
  setInterval: setTimer = setInterval,
  clearInterval: clearTimer = clearInterval,
  document: doc = document,
  window: win = window,
}) {
  if (typeof check !== 'function') throw new Error('createExternalSync: 缺少 check');

  let generation = 0;
  let inFlight = false;
  let timer = null;
  let active = true;

  const run = async () => {
    if (!active || inFlight) return; // 单在途读取
    if (doc.visibilityState !== 'visible') return; // 隐藏页面不检查
    const gen = generation;
    inFlight = true;
    try {
      await check(gen);
    } catch {
      // 读取失败由 check 内部按资源处理（保留草稿、暂停自动保存等），轮询继续
    } finally {
      inFlight = false;
    }
  };

  const startTimer = () => {
    if (!timer) timer = setTimer(() => { void run(); }, intervalMs);
  };
  const stopTimer = () => {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  };

  // 隐藏时清理计时器并暂停新请求；重新可见或获得焦点时立即检查
  const onVisibility = () => {
    if (!active) return;
    if (doc.visibilityState === 'visible') {
      startTimer();
      void run();
    } else {
      stopTimer();
    }
  };
  const onFocus = () => { void run(); };

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('focus', onFocus);
  startTimer();

  return {
    runNow: () => run(),
    // root/线程/便签切换后调用：旧响应携带的代次低于当前值，调用方 MUST 忽略
    invalidate: () => { generation += 1; },
    getGeneration: () => generation,
    destroy() {
      active = false;
      stopTimer();
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('focus', onFocus);
    },
  };
}
