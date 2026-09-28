export function watchVisibleActivity({ document, window, send, onLost, onRestored, setInterval, clearInterval }) {
  let active = true;
  let failed = false;
  const renew = async () => {
    if (!active || document.visibilityState !== 'visible') return;
    try {
      await send();
      if (active && failed) { failed = false; onRestored(); }
    } catch {
      if (active && !failed) { failed = true; onLost(); }
    }
  };
  const visibility = () => { if (document.visibilityState === 'visible') void renew(); };
  const cleanup = () => {
    active = false;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', cleanup);
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', cleanup);
  const timer = setInterval(() => { if (document.visibilityState === 'visible') void renew(); }, 60_000);
  void renew();
  return cleanup;
}
