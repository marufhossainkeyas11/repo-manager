import { $, escapeHtml } from "../utils/dom.js";
import { state, REMEMBER_KEY } from "../state.js";
import { api, setUnauthorizedHandler } from "../api.js";
import { getLockState, registerFailedAttempt, clearLockState, lockRemainingMs } from "./lockout.js";
import { toast } from "../utils/toast.js";

let onLoginSuccess = () => {};
export function setLoginSuccessHandler(fn) { onLoginSuccess = fn; }

export function showLogin() {
  $("login").style.display = "flex";
  $("app").style.display = "none";
  updateLockoutUI();
  loadLoginMeta();
  checkInsecureConnection();
}
setUnauthorizedHandler(showLogin);

// Unauthenticated — called as soon as the login screen is shown, before
// any password is entered. Populates the repo tag, or hides it entirely
// if the admin turned off "show repo on login" in Settings.
async function loadLoginMeta() {
  const tag = $("loginRepoTag");
  try {
    const res = await fetch("/api/meta");
    const meta = await res.json();
    if (meta.hidden || !meta.owner) {
      tag.style.display = "none";
      return;
    }
    tag.textContent = `${meta.owner}/${meta.repo}`;
    tag.style.display = "inline-flex";
  } catch {
    tag.style.display = "none";
  }
}

// Defense-in-depth reminder: Cloudflare Workers serve HTTPS by default, but
// flag it clearly if this is somehow being accessed over plain HTTP on a
// non-localhost host, since a password would be sent in the clear.
function checkInsecureConnection() {
  const banner = $("insecureBanner");
  if (!banner) return;
  const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const insecure = location.protocol !== "https:" && !isLocalhost;
  banner.classList.toggle("show", insecure);
}

$("loginForm").addEventListener("submit", (e) => { e.preventDefault(); doLogin(); });

// password visibility toggle
$("pwToggle").addEventListener("click", () => {
  const input = $("pw");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  $("pwToggle").title = showing ? "Show password" : "Hide password";
  $("pwToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
  $("pwToggleIcon").innerHTML = showing
    ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/>'
    : '<path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 5.1A11 11 0 0 1 12 5c7 0 11 7 11 7a13.5 13.5 0 0 1-3.15 3.9M6.5 6.5C3.7 8.3 2 12 2 12s2.5 4.5 7 6.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
});

// remember-me note only shows once the box is checked, so it doesn't
// clutter the form for people leaving it unchecked (the default)
$("rememberMe").addEventListener("change", (e) => {
  $("rememberNote").style.display = e.target.checked ? "block" : "none";
});

// Caps Lock hint — only meaningful while typing in the password field
$("pw").addEventListener("keydown", (e) => {
  if (typeof e.getModifierState === "function") {
    $("capsHint").textContent = e.getModifierState("CapsLock") ? "Caps Lock is on" : "";
  }
});
$("pw").addEventListener("keyup", (e) => {
  if (typeof e.getModifierState === "function") {
    $("capsHint").textContent = e.getModifierState("CapsLock") ? "Caps Lock is on" : "";
  }
});

let lockTimer = null;
function updateLockoutUI() {
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
    box.textContent = `Too many failed attempts — try again in ${Math.ceil(ms / 1000)}s`;
  };
  tick();
  lockTimer = setInterval(tick, 1000);
}

async function doLogin() {
  if (lockRemainingMs() > 0) return;
  const pw = $("pw").value;
  if (!pw) return;
  state.PW = pw;
  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Logging in…";
  try {
    await api("/api/tree");
    if ($("rememberMe").checked) {
      localStorage.setItem(REMEMBER_KEY, pw);
      sessionStorage.removeItem("rm_pw");
    } else {
      sessionStorage.setItem("rm_pw", pw);
      localStorage.removeItem(REMEMBER_KEY);
    }
    clearLockState();
    $("loginErr").textContent = "";
    await onLoginSuccess();
  } catch (err) {
    registerFailedAttempt();
    $("loginErr").textContent = "Wrong password, or the repo/token isn't configured.";
    updateLockoutUI();
  } finally {
    btn.textContent = "Login";
    if (lockRemainingMs() <= 0) btn.disabled = false;
  }
}

$("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("rm_pw");
  localStorage.removeItem(REMEMBER_KEY);
  state.PW = "";
  showLogin();
});

export function initLogin() {
  updateLockoutUI();
}
