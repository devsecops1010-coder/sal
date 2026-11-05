// Product lookup by barcode: 1) the household's own catalog  2) Open Food Facts (open data, no key)  3) not found.
// Results always carry their source; nothing is invented.
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db, auth } from './fb.js';
import { normalizeBarcode } from '../core/barcode.js';
import { parseSize } from '../core/units.js';
import { guessCategory } from '../core/categorize.js';

const OFF = 'https://world.openfoodfacts.org/api/v2/product/';
const cache = new Map();

export async function lookupBarcode(hid, raw, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const code = normalizeBarcode(raw);
  if (!code) return { found: false, invalid: true };
  if (cache.has(code)) return cache.get(code);
  // 1) household catalog
  try {
    const s = await getDoc(doc(db, 'households', hid, 'products', code));
    if (s.exists()) { const r = { found: true, code, ...s.data(), source: s.data().source || 'household' }; cache.set(code, r); return r; }
  } catch { /* offline → try OFF / manual */ }
  // 2) Open Food Facts
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchImpl(`${OFF}${code}.json?fields=product_name,product_name_he,brands,quantity,image_small_url`, { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) {
      const d = await res.json();
      const p = d?.status === 1 ? d.product || {} : null;
      const name = p && (p.product_name_he || p.product_name || '').trim();
      if (name) {
        const size = parseSize(p.quantity || '');
        const img = typeof p.image_small_url === 'string' && /^https:\/\/images\.openfoodfacts\.org\//.test(p.image_small_url) ? p.image_small_url : null;
        const r = { found: true, code, name: name.slice(0, 120), brand: (p.brands || '').split(',')[0].trim().slice(0, 80) || null,
          size: size?.size ?? null, sizeUnit: size?.unit ?? null, image: img, cat: guessCategory(name), source: 'openfoodfacts' };
        cache.set(code, r); return r;
      }
    }
  } catch { /* network / timeout → manual */ }
  const r = { found: false, code };
  cache.set(code, r); return r;
}

/** Remember a product in the household catalog (doc id = barcode). */
export async function saveProduct(hid, code, p) {
  const c = normalizeBarcode(code); if (!c) return;
  const data = Object.fromEntries(Object.entries({
    name: p.name, brand: p.brand || null, barcode: c, size: p.size ?? null, sizeUnit: p.sizeUnit ?? null, cat: p.cat || null,
    source: p.source || 'user', image: p.image || null, updatedAt: serverTimestamp(), createdBy: auth.currentUser.uid,
  }).filter(([, v]) => v !== undefined));
  cache.delete(c);
  await setDoc(doc(db, 'households', hid, 'products', c), data, { merge: true });
}
