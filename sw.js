/* simple service worker for offline caching of the Sudoku app
   - caches basic assets on install
   - serves cached assets on fetch, tries network first for navigation
   NOTE: update CACHE_VERSION when changing assets.
*/

const CACHE_VERSION = 'sudoku-v1';
const CACHE_NAME = `sudoku-cache-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  '/',                 // index.html (ensure your server serves index.html for '/')
  '/index.html',
  '/style.css',
  '/script.js',
  '/favicon.ico'
  // add other static assets if you have (images, icons) e.g. '/assets/logo.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE.map(u => new Request(u, {cache: 'reload'}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  // For navigation requests (HTML), try network first, fallback to cache
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'))) {
    ev.respondWith(
      fetch(req).then(resp => {
        // optionally update cache with latest HTML
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return resp;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For other requests, respond from cache first, then network and cache response
  ev.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(resp => {
      // cache fetched response (only GET)
      if (req.method === 'GET') {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
      }
      return resp;
    }).catch(() => {
      // fallback: try root
      return caches.match('/index.html');
    }))
  );
});
