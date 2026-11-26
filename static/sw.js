// Bump VERSION whenever files under static/ change, since those are served
// without content hashes and would otherwise stay stale in client caches.
const VERSION = "v3";
const PAGE_CACHE = `pages-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const OFFLINE_FALLBACK = "/";
const ASSET_EXT =
  /\.(?:css|js|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|webmanifest)$/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => ![PAGE_CACHE, ASSET_CACHE].includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin)
    return;

  // Pages: network-first, fall back to cache when offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match(OFFLINE_FALLBACK))
            .then(
              (fallback) =>
                fallback ||
                new Response("Offline", {
                  status: 503,
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                })
            )
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate so unhashed files (images, sw.js
  // payloads, search index) refresh in the background on the next visit
  // instead of being pinned forever.
  if (ASSET_EXT.test(new URL(request.url).pathname)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((response) => {
          // Only a full 200 carries a complete asset body; never persist
          // 204/206/3xx or error responses as if they were the real file.
          if (response.status === 200) cache.put(request, response.clone());
          return response;
        });
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        return network;
      })
    );
  }
});
