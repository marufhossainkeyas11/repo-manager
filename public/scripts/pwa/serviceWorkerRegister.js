// Non-fatal if registration fails — the app still works fully online
// without the service worker, it just won't get instant shell loads or
// the install prompt in browsers that require one for installability.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
