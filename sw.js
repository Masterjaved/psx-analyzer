// This service worker is intentionally disabled — it previously caused
// stale content to be served (breaking the login flow). It now does
// nothing but immediately unregister itself and clear its own caches, so
// any browser that still has an old copy of this file self-heals.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
