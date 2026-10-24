const CACHE = 'toukan-1.1.3+2d188f6a4073';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './icon.svg',
  './manifest.webmanifest',
  './vendor/qrcode.min.js',
  './vendor/three.min.js',
  './vendor/rapier.es.js',
  './src/app.js',
  './src/version.js',
  './src/game.js',
  './src/case-visuals.js',
  './src/stage.js',
  './src/editor.js',
  './src/storage.js',
  './src/audio.js',
];
self.addEventListener('install', (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  )
);
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('toukan-') && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
  )
);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then((cache) => cache.match(e.request)).then((hit) => hit || fetch(e.request)));
});
