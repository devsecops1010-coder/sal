// SmartCart — product search & autocomplete: Hebrew/English, partial, typo-tolerant, barcode-aware.
import { norm } from './categorize.js';
import { normalizeBarcode } from './barcode.js';

/** Optimal-string-alignment (Damerau) distance with an early-exit bound. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1), prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i; let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) { prev2[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[b.length];
}

const words = (s) => norm(s).split(/[\s,.\-/()]+/).filter(Boolean);

/**
 * Score one candidate for a query (higher is better, 0 = no match).
 * exact > prefix > word-prefix > substring > fuzzy (per word, tolerance grows with length).
 */
export function score(query, candidate) {
  const q = norm(query), c = norm(candidate);
  if (!q || !c) return 0;
  if (c === q) return 100;
  if (c.startsWith(q)) return 90 - Math.min(20, c.length - q.length);
  const cw = words(candidate), qw = words(query);
  if (cw.some((w) => w.startsWith(q))) return 75;
  if (c.includes(q)) return 60;
  // every query word must match some candidate word (prefix or within edit tolerance)
  let total = 0;
  for (const w of qw) {
    const tol = w.length <= 3 ? 0 : w.length <= 6 ? 1 : 2;
    let best = 0;
    for (const x of cw) {
      if (x.startsWith(w)) { best = Math.max(best, 50); continue; }
      const d = editDistance(w, x.slice(0, Math.max(w.length, Math.min(x.length, w.length + 1))), tol);
      const d2 = editDistance(w, x, tol);
      const dd = Math.min(d, d2);
      if (dd <= tol) best = Math.max(best, 40 - dd * 8);
    }
    if (!best) return 0;
    total += best;
  }
  return Math.round(total / qw.length);
}

/**
 * Search items [{id, name, nameEn?, brand?, barcode?, aliases?}] → best matches.
 * A query that is a valid barcode matches by barcode only.
 */
export function search(query, items, { limit = 10, minScore = 30 } = {}) {
  const bc = /^\d{8,14}$/.test(String(query).trim()) ? normalizeBarcode(query) : null;
  if (bc) return items.filter((it) => it.barcode && normalizeBarcode(it.barcode) === bc).slice(0, limit);
  const res = [];
  for (const it of items) {
    const fields = [it.name, it.nameEn, it.brand && `${it.brand} ${it.name}`, ...(it.aliases || [])].filter(Boolean);
    let s = 0;
    for (const f of fields) s = Math.max(s, score(query, f));
    if (s >= minScore) res.push([s, it]);
  }
  res.sort((a, b) => b[0] - a[0] || String(a[1].name).length - String(b[1].name).length);
  return res.slice(0, limit).map((x) => x[1]);
}

/** Likely duplicates: same normalized name, or very close names within the same brand. */
export function findDuplicates(item, items) {
  const n = norm(item.name);
  return items.filter((o) => o !== item && o.id !== item.id && (
    (item.barcode && o.barcode && normalizeBarcode(item.barcode) === normalizeBarcode(o.barcode)) ||
    norm(o.name) === n ||
    ((o.brand || '') === (item.brand || '') && editDistance(norm(o.name), n, 1) <= 1 && n.length > 4)
  ));
}

/** Debounce helper for search-as-you-type. */
export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
