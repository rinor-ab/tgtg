// Service worker for PWA installability
// This is a minimal service worker that satisfies the browser's install criteria.

const CACHE_NAME = 'tgtg-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first strategy: always try network, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful GET responses for offline fallback
        if (event.request.method === 'GET' && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
