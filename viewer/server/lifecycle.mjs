export const IDLE_TIMEOUT_MS = 180_000;
export const CHECK_INTERVAL_MS = 30_000;

export function createLifecycle({ now = Date.now, initialMode = 'auto' } = {}) {
  if (!['auto', 'persistent'].includes(initialMode)) throw new Error('invalid initial mode');
  let mode = initialMode;
  let lastActivityAt = now();
  let leases = 0;
  return {
    get mode() { return mode; },
    get lastActivityAt() { return lastActivityAt; },
    activity() { lastActivityAt = now(); },
    retain() { leases += 1; },
    release() {
      if (leases === 0) return;
      leases -= 1;
      lastActivityAt = now();
    },
    setMode(next) {
      if (!['auto', 'persistent'].includes(next)) throw new Error('invalid mode');
      if (next === 'auto' && mode !== 'auto') lastActivityAt = now();
      mode = next;
      return mode;
    },
    expired() { return mode === 'auto' && leases === 0 && now() - lastActivityAt > IDLE_TIMEOUT_MS; },
  };
}
