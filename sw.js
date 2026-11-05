// סל — offline service worker
const CACHE = 'sal-v6';
const ASSETS = ['./', './index.html', './manifest.json', './icon.png'];
// versioned third-party libraries (Firebase, SheetJS, QR) — safe to serve from cache, lets the app open offline
const LIB = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|cdn\.jsdelivr\.net\/npm\/xlsx@|cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs\/)/;
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
const put = (req, res) => { if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)).catch(() => {}); } return res; };
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (LIB.test(e.request.url)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res && (res.ok || res.type === 'opaque')) { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); } return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  const isDoc = e.request.mode === 'navigate' || e.request.destination === 'document' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isDoc) {
    // network-first (updates show at once), but don't hang on a weak signal: after 4s use the saved copy
    const net = fetch(e.request).then(res => put(e.request, res));
    const fallback = () => caches.match(e.request).then(r => r || caches.match('./index.html'));
    e.respondWith(new Promise(resolve => {
      let done = false;
      const t = setTimeout(() => fallback().then(r => { if (!done && r) { done = true; resolve(r); } }), 4000);
      net.then(res => { if (!done) { done = true; clearTimeout(t); resolve(res.ok ? res : fallback().then(r => r || res)); } })
         .catch(() => fallback().then(r => { if (!done) { done = true; clearTimeout(t); resolve(r || Response.error()); } }));
    }));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => put(e.request, res))));
  }
});
