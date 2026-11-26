// Bump VERSION whenever files under static/ change, since those are served
// without content hashes and would otherwise stay stale in client caches.
const VERSION = "v3";
const PAGE_CACHE = `pages-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const OFFLINE_FALLBACK = "/";
const ASSET_EXT =
  /\.(?:css|js|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|webmanifest)$/;
// Same-origin 200 responses are the only ones that carry a complete asset
// body; never persist 204/206/3xx, error responses, or opaque cross-origin
// responses as if they were the real file.
const isCacheable = (response) =>
  response.status === 200 && response.type === "basic";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Drop caches from older VERSIONs, but only the ones this worker
            // owns (pages-*/assets-*), never unrelated caches on the origin.
            .filter(
              (key) =>
                (key.startsWith("pages-") || key.startsWith("assets-")) &&
                ![PAGE_CACHE, ASSET_CACHE].includes(key)
            )
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
          if (isCacheable(response)) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(PAGE_CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {})
            );
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
          if (isCacheable(response)) {
            event.waitUntil(
              cache.put(request, response.clone()).catch(() => {})
            );
          }
          return response;
        });
        if (cached) {
          event.waitUntil(network.catch(() => {}));
          return cached;
        }
        return network;
      })
    );
  }
});
