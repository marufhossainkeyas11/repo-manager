import { $ } from "../utils/dom.js";
import { toast } from "../utils/toast.js";

// Standard installable-web-app flow: the browser fires beforeinstallprompt
// when it decides the app qualifies (manifest + service worker present,
// HTTPS, etc). Chrome/Edge on desktop and Android support this. iOS Safari
// never fires this event — it only supports "Add to Home Screen" from the
// share sheet, so that platform gets a one-time text hint instead.
let deferredInstallPrompt = null;
let isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function setInstallButtonsVisible(visible) {
  $("installBtn").style.display = visible ? "inline-flex" : "none";
  $("loginInstallBtn").style.display = visible ? "inline-flex" : "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandalone) setInstallButtonsVisible(true);
});

async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  setInstallButtonsVisible(false);
  if (outcome === "accepted") toast("Installed — find Repo Manager on your home screen or app list.", "ok");
}
$("installBtn").addEventListener("click", triggerInstall);
$("loginInstallBtn").addEventListener("click", triggerInstall);

window.addEventListener("appinstalled", () => {
  setInstallButtonsVisible(false);
  isStandalone = true;
});

export function updateInstallSettingsRow() {
  const el = $("setInstallStatus");
  if (!el) return;
  if (isStandalone) el.textContent = "Installed — running as an app";
  else if (deferredInstallPrompt) el.textContent = "Available (see Install button above)";
  else el.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? "Share ↗ → Add to Home Screen"
    : "Not available in this browser";
}
$("settingsBtn").addEventListener("click", updateInstallSettingsRow);

// iOS Safari has no install prompt API — show a one-time dismissible hint
// instead, since "Add to Home Screen" only lives in the native share sheet.
export function maybeShowIosHint() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
  if (isIos && isSafari && !isStandalone && !localStorage.getItem("rm_ios_install_hint_seen")) {
    setTimeout(() => {
      toast('Add this to your home screen: tap <b>Share</b> ↗ then <b>"Add to Home Screen"</b>.');
      localStorage.setItem("rm_ios_install_hint_seen", "1");
    }, 1200);
  }
}
