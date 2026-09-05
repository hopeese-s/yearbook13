const CACHE_NAME = 'ims13-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// JS and CSS always go network-first so deployments take effect immediately.
const isAppShell = (url) =>
  url.pathname.endsWith('.js') ||
  url.pathname.endsWith('.css') ||
  url.pathname === '/' ||
  url.pathname.endsWith('.html');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch((err) => console.warn('[SW] Pre-cache failed:', err)),
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
  // Don't intercept API or auth calls
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  if (isAppShell(url)) {
    // Network-first: always try to get fresh JS/CSS/HTML from server.
    // Fall back to cache only if completely offline.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const cacheCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
  } else {
    // Cache-first for images and other static assets (fonts, icons, etc.)
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
  }
});
