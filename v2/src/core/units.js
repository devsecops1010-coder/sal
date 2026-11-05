// SmartCart — units of measure, quantity parsing and price-per-unit (Hebrew first).
import { multiply, roundAgorot } from './money.js';

// canonical units
export const UNITS = {
  unit: { he: "יח׳", dim: 'count', base: 1 },
  pack: { he: 'אריזה', dim: 'pack', base: 1 },
  g:    { he: 'גרם', dim: 'mass', base: 1 },
  kg:   { he: 'ק״ג', dim: 'mass', base: 1000 },
  ml:   { he: 'מ״ל', dim: 'volume', base: 1 },
  l:    { he: 'ליטר', dim: 'volume', base: 1000 },
};

// normalize Hebrew/English spellings: geresh/gershayim variants, quotes, final letters, case
const normTok = (s) => String(s).trim().toLowerCase()
  .replace(/[״"”“]/g, '"').replace(/[׳'’`]/g, "'")
  .replace(/\.$/, '');

const ALIASES = new Map(Object.entries({
  unit: 'unit', units: 'unit', pc: 'unit', pcs: 'unit', "יח'": 'unit', 'יח': 'unit', 'יחידה': 'unit', 'יחידות': 'unit',
  pack: 'pack', 'חבילה': 'pack', 'חבילות': 'pack', 'אריזה': 'pack', 'אריזות': 'pack', 'מארז': 'pack', 'שקית': 'pack', 'קרטון': 'pack', 'בקבוק': 'pack', 'בקבוקים': 'pack', 'פחית': 'pack', 'פחיות': 'pack',
  g: 'g', gr: 'g', gram: 'g', grams: 'g', 'גרם': 'g', "גר'": 'g', 'גר': 'g', "ג'": 'g', 'ג': 'g',
  kg: 'kg', kilo: 'kg', 'ק"ג': 'kg', 'קג': 'kg', 'קילו': 'kg', 'קילוגרם': 'kg',
  ml: 'ml', 'מ"ל': 'ml', 'מל': 'ml', 'מיליליטר': 'ml',
  l: 'l', lt: 'l', liter: 'l', litre: 'l', 'ליטר': 'l', 'ליטרים': 'l', "ל'": 'l',
}));

export function normalizeUnit(u) {
  if (!u) return null;
  return ALIASES.get(normTok(u)) || (UNITS[u] ? u : null);
}

const WORD_NUM = { 'חצי': 0.5, 'רבע': 0.25, 'שלושת רבעי': 0.75, 'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'עשר': 10, 'עשרה': 10, 'תריסר': 12 };

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Parse free-text quantity as typed in the existing app's "כמות" field.
 * "2" → {qty:2,unit:'unit'} · "1.5 ק״ג" → {1.5,'kg'} · "חצי קילו" → {0.5,'kg'} · "500 גרם" · "x3" / "3x" · "2 חבילות"
 * Returns null qty when nothing numeric is found (keeps the original text in `raw`).
 */
export function parseQty(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { qty: 1, unit: 'unit', raw };
  let s = normTok(raw).replace(/,/g, '.').replace(/\s+/g, ' ');
  // word numbers ("חצי קילו", "שני ליטר")
  for (const [w, n] of Object.entries(WORD_NUM).sort((a, b) => b[0].length - a[0].length)) {
    if (s.startsWith(w + ' ') || s === w) { s = n + s.slice(w.length); break; }
  }
  let num, rest;
  const front = s.match(/^[x×*]?\s*(\d+(?:\.\d+)?)\s*[x×*]?\s*(.*)$/);   // "2 ק"ג", "x3", "3x"
  const back = s.match(/^(.*?)\s*[x×*]?\s*(\d+(?:\.\d+)?)$/);           // "ק"ג 2", "בקבוק x2"
  if (front) { num = Number(front[1]); rest = front[2].trim(); }
  else if (back) { num = Number(back[2]); rest = back[1].trim(); }
  else {
    const u = normalizeUnit(s);
    return u ? { qty: 1, unit: u, raw } : { qty: null, unit: 'unit', raw };
  }
  if (!Number.isFinite(num) || num <= 0) return { qty: null, unit: 'unit', raw };
  const unit = rest ? normalizeUnit(rest) : 'unit';
  return { qty: round3(num), unit: unit || 'unit', raw, ...(rest && !unit ? { note: rest } : {}) };
}

export function convert(value, from, to) {
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b) throw new Error(`unknown unit ${from}/${to}`);
  if (a.dim !== b.dim) throw new Error(`cannot convert ${a.dim} to ${b.dim}`);
  return round3((value * a.base) / b.base);
}

/** Human label: {qty:1.5, unit:'kg'} → "1.5 ק״ג"; 1 unit → "1". */
export function formatQty(qty, unit = 'unit') {
  if (qty === null || qty === undefined) return '';
  const n = Number.isInteger(qty) ? String(qty) : String(round3(qty));
  if (unit === 'unit') return n;
  return `${n} ${UNITS[unit]?.he || unit}`;
}

/**
 * Comparable unit price. Israeli shelves show price per 100 g/ml (or per kg/liter); count items per unit.
 * price: agorot for a package of `size` `unit` (e.g. 1290 for 500 g).
 * Returns { amount (agorot, rounded), per: '100g'|'100ml'|'kg'|'l'|'unit' }.
 */
export function unitPrice(priceAgorot, size, unit, per) {
  const u = UNITS[unit];
  if (!u || !size || size <= 0) return null;
  if (u.dim === 'count' || u.dim === 'pack') return { amount: roundAgorot(priceAgorot / size), per: 'unit' };
  const baseQty = size * u.base; // grams or ml
  const target = per || (u.dim === 'mass' ? '100g' : '100ml');
  const targetBase = { '100g': 100, '100ml': 100, kg: 1000, l: 1000 }[target];
  if (!targetBase) return null;
  return { amount: roundAgorot((priceAgorot * targetBase) / baseQty), per: target };
}

/** Line total for a list item: price per selling unit × quantity (kg-priced produce, or per unit). */
export function lineTotal(priceAgorot, qty, { priceUnit = 'unit', qtyUnit = 'unit' } = {}) {
  if (priceAgorot === null || priceAgorot === undefined || qty === null || qty === undefined) return null;
  let q = qty;
  if (priceUnit !== qtyUnit) {
    try { q = convert(qty, qtyUnit, priceUnit); } catch { return null; }
  }
  return multiply(priceAgorot, q);
}

/** Package size from product data ("80 ג", "400 g e", "1.5L", "6 x 330 ml", "1 ליטר"). Returns {size, unit} or null. */
export function parseSize(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/,/g, '.');
  if (!s) return null;
  const multi = s.match(/^(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*([^\s\d]+)/);
  if (multi) { const u = normalizeUnit(multi[3]); return u && u !== 'unit' ? { size: round3(+multi[1] * +multi[2]), unit: u } : null; }
  const m = s.match(/(\d+(?:\.\d+)?)\s*([^\s\d.]+[.]?)/);
  if (!m) return null;
  let u = normalizeUnit(m[2]);
  if (!u && /^cl/.test(m[2])) return { size: round3(+m[1] * 10), unit: 'ml' };
  if (!u || u === 'unit' || u === 'pack') return null;
  return { size: round3(+m[1]), unit: u };
}
