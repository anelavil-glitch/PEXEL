const CACHE = 'pl-manager-v4';
const ASSETS = ['/', '/static/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for static
  if (e.request.url.includes('/parse') || e.request.url.includes('/export')) return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
