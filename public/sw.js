/*
 * MyFileKit service worker — minimal, safe, network-first.
 *
 * Strategy rationale: NETWORK-FIRST for same-origin GET requests. When online,
 * users always receive the freshly deployed build; the cache is only a fallback
 * for when the network is unavailable. This avoids the classic cache-first trap
 * where a stale service worker keeps serving an old (possibly broken) build
 * after a deploy. Bumping CACHE_VERSION invalidates every previous cache.
 */

const CACHE_VERSION = "myfilekit-v1";

// install: activate the new worker immediately.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// activate: take control of open clients and purge any old cache versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
        );
      } catch (err) {
        // Never let cleanup failures block activation.
      }
      await self.clients.claim();
    })()
  );
});

// fetch: network-first for same-origin GET navigations/assets, cache as fallback.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET; let everything else hit the network untouched.
  if (request.method !== "GET") {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return; // Malformed URL — do not interfere.
  }

  // Only handle same-origin requests. Cross-origin is never cached or touched.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Network-first: try the network, and cache successful responses.
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok && networkResponse.type === "basic") {
          try {
            const cache = await caches.open(CACHE_VERSION);
            await cache.put(request, networkResponse.clone());
          } catch (err) {
            // Caching is best-effort; ignore quota/storage errors.
          }
        }
        return networkResponse;
      } catch (err) {
        // Offline (or network failure): fall back to cache.
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        // For navigations with nothing cached, try the app shell.
        if (request.mode === "navigate") {
          const shell = await caches.match("/") || await caches.match("/index.html");
          if (shell) {
            return shell;
          }
        }
        // Nothing we can do — re-throw so the browser shows its normal error.
        throw err;
      }
    })()
  );
});
