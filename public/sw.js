const CACHE_NAME = 'forever-v52-local-ui';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/album.css',
  '/album.js',
  '/glass.css',
  '/debug.html',
  '/debug.css',
  '/debug.js',
  '/guide.js',
  '/guide.css',
  '/help-content.js',
  '/manifest.webmanifest',
  '/assets/forever-avatar.png',
  '/assets/forever-icon-192.png',
  '/assets/forever-icon-512.png',
  '/vendor/lucide-0.468.0.min.js',
  '/fonts/fonts.css',
  '/fonts/doto-600.ttf',
  '/fonts/doto-700.ttf',
  '/fonts/doto-800.ttf',
  '/fonts/inter-500.ttf',
  '/fonts/inter-600.ttf',
  '/fonts/inter-700.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/avatar')) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/assets/forever-avatar.png')));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
