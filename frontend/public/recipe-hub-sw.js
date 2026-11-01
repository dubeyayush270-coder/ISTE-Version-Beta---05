/* Same-origin offline app shell only. Do not cache API writes or personal Pantry data. */
const CACHE = 'kitchensync-shell-recipe-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const page = await fetch('/', { cache: 'reload' });
      if (page.ok) {
        await cache.put('/', page.clone());
        const html = await page.text();
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m => m[1]);
        await Promise.allSettled(assets.map(url => cache.add(url)));
      }
    } catch { /* The offline snapshot remains available on next successful visit. */ }
  })());
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('kitchensync-shell-recipe-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode !== 'navigate' && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(req);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(req.mode === 'navigate' ? '/' : req, response.clone());
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE);
      return (await cache.match(req.mode === 'navigate' ? '/' : req)) || Response.error();
    }
  })());
});
