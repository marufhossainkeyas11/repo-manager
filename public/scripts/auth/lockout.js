const LOCK_KEY = "rm_lock";

export function getLockState() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null") || { fails: 0, until: 0 }; }
  catch { return { fails: 0, until: 0 }; }
}
function setLockState(s) { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); }

export function registerFailedAttempt() {
  const s = getLockState();
  s.fails += 1;
  if (s.fails >= 3) {
    const delaySeconds = Math.min(30 * 2 ** (s.fails - 3), 300);
    s.until = Date.now() + delaySeconds * 1000;
  }
  setLockState(s);
  return s;
}
export function clearLockState() { setLockState({ fails: 0, until: 0 }); }
export function lockRemainingMs() { return Math.max(0, getLockState().until - Date.now()); }
