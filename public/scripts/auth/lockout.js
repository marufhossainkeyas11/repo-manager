import { $ } from "../utils/dom.js";

// This is a client-side UX speed bump only — it just disables the login
// button/input and shows a countdown so a human doesn't sit there mashing
// "Login". It does NOT stop a script from hitting /api/* directly; the
// real enforcement is server-side in src/middleware/rateLimit.js (KV-backed,
// per-IP). Kept in localStorage (not sessionStorage) so refreshing the tab
// mid-lockout doesn't reset the countdown.
const LOCK_KEY = "rm_lock";

function getLockState() {
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

let lockTimer = null;
export function updateLockoutUI() {
  const remaining = lockRemainingMs();
  const box = $("loginLockout");
  const btn = $("loginBtn");
  const input = $("pw");
  clearInterval(lockTimer);
  if (remaining <= 0) {
    box.style.display = "none";
    btn.disabled = false;
    input.disabled = false;
    return;
  }
  btn.disabled = true;
  input.disabled = true;
  box.style.display = "block";
  const tick = () => {
    const ms = lockRemainingMs();
    if (ms <= 0) { updateLockoutUI(); return; }
    box.textContent = `Too many failed attempts. Try again in ${Math.ceil(ms / 1000)}s.`;
  };
  tick();
  lockTimer = setInterval(tick, 1000);
}
