// ホーム画面から起動できるようにするための Service Worker
// アプリ本体はネット優先（更新をすぐ反映）、CDN のライブラリはキャッシュ優先。Supabase への通信は扱わない
const CACHE = 'facility3d-v1';
const SHELL = ['./', 'index.html', 'js/app.js', 'js/building.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res }).catch(() => caches.match(req)));
});
