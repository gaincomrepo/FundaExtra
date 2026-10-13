/* Offline-schil: app-bestanden uit cache, woningdata altijd eerst van het netwerk. */
var C = 'woningen-v1', SCHIL = ['./', 'index.html', 'engine.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(SCHIL); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== C; }).map(function (x) { return caches.delete(x); })); })); self.clients.claim(); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) { var k = r.clone(); caches.open(C).then(function (c) { c.put(e.request, k); }); return r; }).catch(function () { return caches.match(e.request); }));
});
