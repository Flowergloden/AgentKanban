export async function changeServiceMode(next, { setBusy, setMode, setNotice, setModeApi }) {
  setBusy(true);
  try {
    const result = await setModeApi(next);
    setMode(result.mode);
    setNotice('');
    return true;
  } catch (error) {
    setNotice(error.status === 409 ? '服务正在升级或协调操作，请重试切换。' : `切换失败：${error.message}`);
    return false;
  } finally { setBusy(false); }
}

export async function stopServiceWithConfirmation({ confirm, stop, setBusy, setMode, setNotice }) {
  if (!confirm('停止共享看板服务将影响所有项目与会话。确定停止吗？')) return false;
  setBusy(true);
  try {
    await stop();
    setMode(null);
    setNotice('服务已停止；后续有效活动可重新启动。当前网页无法自行拉起，请使用本地打开入口。');
    return true;
  } catch (error) {
    setNotice(error.status === 409 ? '服务正在升级，请重试停止。' : `停止失败：${error.message}`);
    return false;
  } finally { setBusy(false); }
}
