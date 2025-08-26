/* Improved service worker for Sudoku PWA
   - network-first for navigation requests (HTML)
   - cache-first for other assets
   - only cache successful same-origin responses
   - update CACHE_VERSION when changing assets
*/

const CACHE_VERSION = 'v1';
const CACHE_NAME = `sudoku-cache-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  '/',                 // ensure server serves index.html for '/'
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',     // optional but recommended for PWA
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // use Request(cache: 'reload') to bypass HTTP cache on first install
    const requests = ASSETS_TO_CACHE.map(u => new Request(u, { cache: 'reload' }));
    await cache.addAll(requests);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    );
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') {
    return;
  }

  // Detect navigation requests (page loads)
  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));

  if (isNavigation) {
    // Network-first for navigation so user gets freshest HTML, fallback to cached index.html
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(req);
        // Cache a copy only if response is OK and same-origin (type === 'basic')
        if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
          const copy = networkResponse.clone();
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, copy).catch(() => { /* ignore cache put errors */ });
        }
        return networkResponse;
      } catch (err) {
        const cacheResp = await caches.match('/index.html');
        return cacheResp || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // For other requests (assets) -> cache-first, then network and cache if appropriate
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const networkResponse = await fetch(req);
      // Only cache successful same-origin (basic) responses
      if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
        const copy = networkResponse.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, copy).catch(() => { /* ignore cache put errors */ });
      }
      return networkResponse;
    } catch (err) {
      // final fallback: try index.html for navigation-like cases or return a simple 503
      const fallback = await caches.match('/index.html');
      return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
