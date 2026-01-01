const CACHE = 'block-coder-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];
// cache on install
self.addEventListener('install', evt => {
  evt.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

// serve from cache, fallback to network
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cached => {
      if (cached) return cached;
      return fetch(evt.request).then(resp => {
        // optional: update cache for same-origin GET requests
        if (evt.request.method === 'GET' && evt.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE).then(c => c.put(evt.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
