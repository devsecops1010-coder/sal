// SmartCart v2 — offline service worker
const CACHE = 'smartcart-v2-7';
const ASSETS = ['./', './index.html', './app.css', './manifest.json', './src/ui/app.js', './src/ui/dom.js', './src/data/fb.js', './src/data/repo.js', './src/data/firebase-config.js', './src/core/money.js', './src/core/units.js', './src/core/categorize.js', './src/core/search.js', './src/core/barcode.js', './src/core/budget.js', './src/core/recommend.js', './src/data/products.js', './src/ui/scanner.js', './src/ui/receipts.js', './src/core/receipt.js', './src/core/pantry.js', './src/core/recipes.js', './src/core/basic-recipes.js', './src/ui/stores.js', './src/data/prices.js'];
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
  // app code too (js/css/json): modules must all come from the SAME version — a cached old module next to a new one breaks the app
  const isDoc = e.request.mode === 'navigate' || e.request.destination === 'document' || /\/$|\.(html|js|mjs|css|json)$/.test(url.pathname);
  if (isDoc) {
    // network-first (updates show at once), but don't hang on a weak signal: after 4s use the saved copy
    const net = fetch(e.request).then(res => put(e.request, res));
    const nav = e.request.mode === 'navigate';
    const fallback = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || (nav ? caches.match('./index.html') : undefined));
    e.respondWith(new Promise(resolve => {
      let done = false;
      const t = nav ? setTimeout(() => fallback().then(r => { if (!done && r) { done = true; resolve(r); } }), 4000) : null;   // code files never time out → no version mixing
      net.then(res => { if (!done) { done = true; clearTimeout(t); resolve(res.ok ? res : fallback().then(r => r || res)); } })
         .catch(() => fallback().then(r => { if (!done) { done = true; clearTimeout(t); resolve(r || Response.error()); } }));
    }));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => put(e.request, res))));
  }
});
