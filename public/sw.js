const CACHE_NAME = 'ims13-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/assets/css/tokens.css',
  '/assets/css/base.css',
  '/assets/css/glass.css',
  '/assets/css/focus.css',
  '/assets/css/components.css',
  '/assets/js/main.js',
  '/assets/js/api.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS).catch((err) => console.warn('[SW] Pre-cache failed:', err)),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Don't cache API calls or auth calls in SW
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networked = fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const cacheCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networked;
    }),
  );
});
