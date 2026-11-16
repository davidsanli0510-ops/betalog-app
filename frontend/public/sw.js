/* Offline helper for BetaLog: the app opens without a connection (weak signal at the gym).
 * Pages: network first, the cached copy when offline, so a new version shows up as soon as it is online.
 * Built files (assets/, names change with every version) and icons: cache first. Nothing else is touched. */
const CACHE = 'betalog-v1';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

// the first visit loads the app before this helper is running, so also save the files the page uses
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    try {
      const html = await (await fetch('./', { cache: 'no-cache' })).text();
      const files = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(m => m[1]);
      await c.addAll(files);
    } catch { /* saved later as they are used */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(CACHE); await c.put('./', res.clone()); }
        return res;
      } catch {
        return (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('assets/') || SHELL.includes('./' + rel)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    })());
  }
});
