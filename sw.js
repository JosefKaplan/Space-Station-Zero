// Offline use: after one visit the app's own files are kept in this browser and used when the network does not answer.
// Network first, so a visit online always gets the newest files (no version number to remember to bump), with the kept copy
// as the fallback. Only this site's own files are touched: never the private local/ files, never another origin (the sync
// server and its sign-in are never seen by this file). Registered by js/app.js.
const CACHE_NAME = 'ssz-app-files';
const NETWORK_TIMEOUT_MS = 4000;   // a weak signal at the table must not hold the app up
// kept up front so the very first offline start works; anything else is kept the first time it is loaded
const FILES_TO_KEEP_AT_INSTALL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/apple-touch-icon.png', 'data/room-footprints.json',
  'js/app.js', 'js/cloud-sync.js', 'js/config.js', 'js/crew-rules.js', 'js/data.js', 'js/map.js', 'js/qr.js', 'js/room-layouts.js',
  'js/skirmish.js', 'js/state.js', 'js/terrain.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // one missing file must not stop the others from being kept
    await Promise.all(FILES_TO_KEEP_AT_INSTALL.map((file) => cache.add(file).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isOwnFile = url.origin === self.location.origin && !url.pathname.includes('/local/');
  if (request.method === 'GET' && isOwnFile) event.respondWith(answer(request));
});

function fetchFromNetwork(request) {
  // revalidate (cheap when nothing changed) instead of trusting the browser's own cache for minutes
  // (a page navigation keeps its own redirect handling, or the browser refuses the answer)
  const network = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: request.redirect });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS));
  return Promise.race([network, timeout]);
}

async function answer(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchFromNetwork(request);
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  } catch (error) {
    const kept = await cache.match(request.url, { ignoreSearch: true });
    if (kept) return kept;
    // opening the app by any address of this site: the kept start page
    const keptStartPage = request.mode === 'navigate' ? await cache.match('index.html') : null;
    if (keptStartPage) return keptStartPage;
    throw error;
  }
}
