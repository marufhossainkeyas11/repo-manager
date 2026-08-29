// Repo Manager service worker.
// Scope: caches the static app shell (HTML/CSS/JS/icons/manifest) so the
// app opens instantly from the home screen icon. Every /api/* request is
// left completely untouched — file trees, blobs, and commits must always be
// live, never served from cache.
//
// The redesign split the old single app.js into ~35 ES modules across
// public/scripts/ and 10 CSS files — too many to name individually here
// without this list going stale every time a file is added or renamed.
// Only the entry points are precached on install; everything else (every
// /scripts/*.js and /styles/*.css the browser actually requests) is added
// to the cache the first time it's fetched, via the same
// stale-while-revalidate path used for repeat visits.
const CACHE_NAME = "repo-manager-shell-v3";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/scripts/main.js",
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

  // Only handle same-origin GET requests for the shell (scripts, styles,
  // icons, html) — cross-origin requests like the fflate CDN import are
  // left to the browser's own HTTP cache.
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
      // refresh the cache in the background for next time. This is also
      // how every non-precached module/style file joins the cache after
      // its first successful fetch.
      return cached || network;
    })
  );
});
