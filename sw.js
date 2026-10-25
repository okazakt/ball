const CACHE = 'toukan-2.2.6+81aa9e922901';
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
  './src/wake-lock.js',
  './src/version.js',
  './src/game.js',
  './src/floor-laminate.js',
  './src/frame-plastic.js',
  './src/spatial-lighting.js',
  './src/wall-settings.js',
  './src/wall-diagnostics.js',
  './src/case-visuals.js',
  './src/stage.js',
  './src/mechanics.js',
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
      .then((clients) => {
        // Do not keep activation waiting for a navigation that itself waits
        // for this worker to finish activating.
        clients.forEach((client) => { client.navigate(client.url).catch(() => {}); });
      })
  )
);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then((cache) => cache.match(e.request)).then((hit) => hit || fetch(e.request)));
});
