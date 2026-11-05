// סל (SmartCart) — offline service worker for /sal/ (app code lives in v2/)
const CACHE = 'smartcart-12';
const ASSETS = ['./', './index.html', './manifest.json', './icon.png', './v2/app.css', './v2/src/ui/app.js', './v2/src/ui/dom.js', './v2/src/data/fb.js', './v2/src/data/repo.js', './v2/src/data/firebase-config.js', './v2/src/core/money.js', './v2/src/core/units.js', './v2/src/core/categorize.js', './v2/src/core/search.js', './v2/src/core/barcode.js', './v2/src/core/budget.js', './v2/src/core/recommend.js', './v2/src/data/products.js', './v2/src/ui/scanner.js', './v2/src/ui/receipts.js', './v2/src/core/receipt.js', './v2/src/core/pantry.js', './v2/src/core/recipes.js', './v2/src/core/basic-recipes.js', './v2/src/ui/stores.js', './v2/src/data/prices.js', './v2/src/core/pastelist.js'];
// versioned third-party libraries (Firebase, SheetJS, QR) — safe to serve from cache, lets the app open offline
const LIB = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|cdn\.jsdelivr\.net\/npm\/xlsx@|cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs\/)/;
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && /^(smartcart-|sal-)/.test(k))   /* same origin as sidur/nofesh/ravakim: never touch their caches */.map(k => caches.delete(k)))));
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
