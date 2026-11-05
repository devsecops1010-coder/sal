// Retired: the app moved from /sal/v2/ to /sal/ (its service worker is /sal/sw.js). Removes the old one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('smartcart-v2-')).map((k) => caches.delete(k)));
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('../').catch(() => {});
})()));
