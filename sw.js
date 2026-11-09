// Mini BACI: guarda la app para que funcione sin internet.
const CACHE = 'minibaci-v13';
const ASSETS = ['./', './index.html', './baci.js', './ejemplos.js', './pcode-tablas.js', './pcode.js', './pcode-vm.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Archivos de la app: primero la red (así se ven los cambios al tiro) y, sin internet, la caché.
// Fuentes y otros sitios: primero la caché.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === self.location.origin;
  const save = res => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; };
  if (same) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(save).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(save)));
});
