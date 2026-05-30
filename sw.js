const CACHE = 'gezonde-maaltijd-v1';
const ASSETS = [
  '/Gezondemaaltijd/',
  '/Gezondemaaltijd/index.html',
  '/Gezondemaaltijd/css/styles.css',
  '/Gezondemaaltijd/js/app.js',
  '/Gezondemaaltijd/js/analyzer.js',
  '/Gezondemaaltijd/js/ai.js',
  '/Gezondemaaltijd/js/i18n.js',
  '/Gezondemaaltijd/ingredientDatabase.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('api.anthropic.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
