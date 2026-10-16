const CACHE_NAME = 'nms-atlas-app-v2';
const IMAGE_CACHE = 'nms-atlas-steam-icons-v1';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![CACHE_NAME, IMAGE_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (url.origin === 'https://images.steamusercontent.com' && req.destination === 'image') {
      event.respondWith(caches.open(IMAGE_CACHE).then(async cache => {
        const cached = await cache.match(req);
        const refresh = fetch(req).then(response => { if (response && (response.ok || response.type === 'opaque')) cache.put(req, response.clone()).catch(() => {}); return response; }).catch(() => cached);
        return cached || refresh;
      }));
    }
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone())).catch(() => {});
      return response;
    }).catch(async () => (await caches.match(req)) || (await caches.match('./index.html')) || Response.error()));
    return;
  }
  event.respondWith(caches.match(req).then(cached => {
    const fresh = fetch(req).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone())).catch(() => {});
      return response;
    });
    return cached || fresh;
  }));
});
