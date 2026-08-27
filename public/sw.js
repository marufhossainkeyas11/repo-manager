// Repo Manager service worker.
// Scope: caches the static app shell (HTML/JS/icons/manifest) only, so the
// app opens instantly from the home screen icon. Every /api/* request is
// left completely untouched — file trees, blobs, and commits must always be
// live, never served from cache.

const CACHE_NAME = "repo-manager-shell-v2";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always go to the network, always fresh.
  if (url.pathname.startsWith("/api/")) return;

  // Only handle same-origin GET requests for the shell.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      // Stale-while-revalidate: serve cached shell instantly if we have it,
      // refresh the cache in the background for next time.
      return cached || network;
    })
  );
});
