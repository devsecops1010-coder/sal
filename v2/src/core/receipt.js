// SmartCart — parse OCR text of an Israeli supermarket receipt (Phase 5).
// Output is a DRAFT for the user to confirm/edit — never saved without confirmation. Every number is integer agorot.
import { toAgorot } from './money.js';
import { guessCategory } from './categorize.js';

export const CHAINS = [
  ['שופרסל', /שופרסל|shufersal/i], ['רמי לוי', /רמי\s*לוי|rami\s*levy/i], ['ויקטורי', /ויקטורי|victory/i], ['יוחננוף', /יוחננוף|yochananof/i],
  ['אושר עד', /אושר\s*עד|osher\s*ad/i], ['מגה', /\bמגה\b|mega/i], ['טיב טעם', /טיב\s*טעם|tiv\s*taam/i], ['חצי חינם', /חצי\s*חינם/i],
  ['יינות ביתן', /יינות\s*ביתן/i], ['קרפור', /קרפור|carrefour/i], ['AM:PM', /am\s*[:.]?\s*pm/i], ['סופר-פארם', /סופר[\s-]*פארם|super[\s-]*pharm/i],
  ['פרש מרקט', /פרש\s*מרקט|fresh\s*market/i], ['מחסני השוק', /מחסני\s*השוק/i], ['קשת טעמים', /קשת\s*טעמים/i], ['ברקת', /\bברקת\b/i],
];
const PRICE = /-?\d{1,5}[.,]\d{2}(?!\d)/g;
const SKIP = /מע["״']?מ|עודף|מזומן|אשראי|כרטיס|ויזה|visa|mastercard|ישראכרט|קופה|קופאי|ח\.?פ|עוסק|טל[':.]|טלפון|כתובת|תודה|ברקוד|מס['.]?\s*עסקה|אסמכתא|שובר|מספר\s*פריטים|סה["״']?כ\s*פריטים|חשבונית|עותק|מקור|נקודות|יתרה|החזר/i;
const TOTAL = /סה["״']?כ\s*(?:ל)?תשלום|סה["״']?כ|סך\s*הכל|לתשלום|total/i;
const DISCOUNT = /הנחה|מבצע|הטבה|קופון|discount|זיכוי/i;
const MEASURE = /(\d+(?:[.,]\d+)?)\s*(ק["״']?ג|קג|kg|גרם|ג['"]?\b)/i;

const toNum = (s) => Number(String(s).replace(',', '.'));
/** OCR often loses the decimal point ("1290" for 12.90) or confuses O/0, l/1 — normalize only obvious cases. */
export function cleanLine(line) {
  return String(line).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[|]/g, ' ').replace(/(?<=\d)[oOםס](?=\d|\s|$)/g, '0').replace(/(?<=\d)[lI](?=[\d.,])/g, '1')
    .replace(/(\d)\s*[,.]\s*(\d{2})(?!\d)/g, '$1.$2').replace(/\s{2,}/g, ' ').trim();
}

const NUM = /-?\d+(?:[.,]\d+)?/g;
const UNIT_TOK = /ק["״']?ג|\bקג\b|\bkg\b|יח['׳]?|גרם/gi;
/**
 * Solve "quantity × unit price = line total" from the numbers on a line, in ANY order (receipts print in visual RTL order,
 * so OCR may return "13.80 X 6.90 2"). Returns {qty, unitPrice, lineTotal, inferred} or null.
 */
export function solveQtyLine(line) {
  const nums = [...String(line).matchAll(NUM)].map((m) => ({ s: m[0], v: toNum(m[0]), dec2: /[.,]\d{2}$/.test(m[0]) && !/[.,]\d{3}$/.test(m[0]) }));
  const money = nums.filter((n) => n.dec2 && n.v > 0);
  for (const u of money) for (const t of money) {
    if (u === t || t.v < u.v) continue;
    for (const q of nums) {
      if (q === u || q === t || !(q.v > 0) || q.v > 999) continue;
      if (Math.abs(Math.round(toAgorot(u.s) * q.v) - toAgorot(t.s)) <= 2) return { qty: q.v, unitPrice: toAgorot(u.s), lineTotal: toAgorot(t.s), inferred: false };
    }
  }
  // quantity unreadable (OCR dropped it) but unit price and total are clear → derive qty with 3 decimals (weights), flag as inferred
  // only on weighed lines (ק"ג) — counted items are integers and would have been solved above
  if (money.length >= 2 && /ק["״']?ג|קג|kg/i.test(line)) {
    const [u, t] = [...money].sort((a, b) => a.v - b.v).slice(-2);
    const U = toAgorot(u.s), T = toAgorot(t.s), r = T / U;
    for (const dp of [0, 1, 2, 3]) {                       // prefer the "roundest" weight that reproduces the printed total
      const q = Math.round(r * 10 ** dp) / 10 ** dp;
      if (q > 0 && q < 100 && Math.abs(U * q - T) <= 0.5) return { qty: q, unitPrice: U, lineTotal: T, inferred: true };
    }
  }
  return null;
}

export function detectStore(text) {
  for (const [name, re] of CHAINS) if (re.test(text)) return name;
  return null;
}

/** dd/mm/yy, dd.mm.yyyy, dd-mm-yyyy → "YYYY-MM-DD" (Israeli day-first). Rejects impossible dates. */
export function detectDate(text) {
  const m = String(text).match(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/);
  if (!m) return null;
  let [, d, mo, y] = m.map(Number); if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse receipt text.
 * Returns { store, date, items:[{name, qty, unit, unitPrice, lineTotal, discount, cat, confidence, raw}], total, itemsSum,
 *           discounts, check:{matches, diff}, confidence (0..1), warnings[] }
 */
export function parseReceipt(text, { ocrConfidence = null } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const items = []; const warnings = []; let total = null, discounts = 0;
  let pendingQty = null;   // "2 X 6.90" on its own line applies to the next/previous item
  let pendingName = null;  // a name-only line ("עגבניות") whose weight/price come on the next line
  for (const raw of lines) {
    const prices = [...raw.matchAll(PRICE)].map((m) => toAgorot(m[0].replace(',', '.')));
    const hasOp = /\d\s*[xX×*]|[xX×*]\s*\d|(?:^|\s)[xX×*א](?:\s|$)/.test(raw);
    const solved = hasOp ? solveQtyLine(raw) : null;
    const qtyX = solved ? [null, String(solved.qty), null, (solved.unitPrice / 100).toFixed(2)] : null;   // [_, qty, _, unitPrice]
    const qtyKg = !!solved && (/ק["״']?ג|קג|kg/i.test(raw) || !Number.isInteger(solved.qty));
    const words = raw.replace(PRICE, ' ').replace(/[*xX×=₪]/g, ' ').replace(/\s+/g, ' ').trim();
    const bare = hasOp ? words.replace(UNIT_TOK, ' ').replace(/(?:^|\s)א(?=\s|$)/g, ' ').replace(/\b\d+(?:[.,]\d+)?\b/g, ' ').replace(/[-\s]+/g, ' ').trim() : null;
    if (TOTAL.test(raw) && prices.length) { const t = prices[prices.length - 1]; if (t > 0 && (total === null || t >= total)) total = t; continue; }
    if (SKIP.test(raw)) continue;
    if (DISCOUNT.test(raw) && prices.length) {
      const d = -Math.abs(prices[prices.length - 1]); discounts += d;
      if (items.length) { const last = items[items.length - 1]; last.discount = (last.discount || 0) + d; }
      continue;
    }
    if (!prices.length) {
      if (qtyX) pendingQty = { qty: toNum(qtyX[1]), unitPrice: toAgorot(qtyX[3]), kg: qtyKg };
      else if (/[א-תa-zA-Z]{2,}/.test(words)) pendingName = words.replace(/\b\d{6,14}\b/g, '').trim();
      continue;
    }
    const name = (hasOp ? bare : words).replace(/^\d{6,14}\s*/, '').replace(/\b\d{6,14}\b/g, '').replace(/^[\s\d.-]+$/, '').trim();
    if (qtyX && !/[א-תa-zA-Z]{2,}/.test(bare) && pendingName) {
      // "1.250 ק"ג X 9.90  12.38" under a name-only line → that's the item
      const nm = pendingName.slice(0, 120); pendingName = null;
      items.push({ name: nm, qty: solved.qty, unit: qtyKg ? 'kg' : 'unit', unitPrice: solved.unitPrice, lineTotal: solved.lineTotal, discount: 0, cat: guessCategory(nm), confidence: solved.inferred ? 0.6 : 0.8, raw, ...(solved.inferred ? { note: 'הכמות חושבה מהמחיר' } : {}) });
      continue;
    }
    if (qtyX && !/[א-תa-zA-Z]{2,}/.test(bare) && items.length) {
      // a "qty × price = total" line that belongs to the item above
      const last = items[items.length - 1];
      last.qty = solved.qty; last.unitPrice = solved.unitPrice; last.lineTotal = solved.lineTotal; if (qtyKg) last.unit = 'kg'; if (solved.inferred) { last.confidence = 0.6; last.note = 'הכמות חושבה מהמחיר'; }
      continue;
    }
    if (!/[א-תa-zA-Z]{2,}/.test(name)) continue;   // a number-only line we can't attribute → ignore, never invent
    pendingName = null;
    let lineTotal = prices[prices.length - 1];
    let qty = 1, unitPrice = lineTotal, unit = 'unit', conf = 0.8;
    let lt = null;
    if (solved) { qty = solved.qty; unitPrice = solved.unitPrice; lt = solved.lineTotal; if (qtyKg) unit = 'kg'; if (solved.inferred) conf = 0.6; }
    else if (pendingQty) { qty = pendingQty.qty; unitPrice = pendingQty.unitPrice; if (pendingQty.kg) unit = 'kg'; pendingQty = null; }
    const meas = name.match(MEASURE);
    if (unit === 'unit' && meas && /ק["״']?ג|קג|kg/i.test(meas[2]) && !Number.isInteger(qty)) unit = 'kg';
    if (lt !== null) lineTotal = lt;
    if (qty !== 1 && unitPrice && Math.abs(Math.round(unitPrice * qty) - lineTotal) > 2) { conf = 0.5; warnings.push(`בדוק כמות/מחיר: ${name}`); }
    if (lineTotal <= 0) continue;
    const clean = name.replace(/\s{2,}/g, ' ').slice(0, 120);
    items.push({ name: clean, qty, unit, unitPrice, lineTotal, discount: 0, cat: guessCategory(clean), confidence: conf, raw });
  }
  const itemsSum = items.reduce((a, i) => a + i.lineTotal, 0) + discounts;
  const diff = total === null ? null : total - itemsSum;
  const matches = diff !== null && Math.abs(diff) <= 5;
  if (total === null) warnings.push('לא זוהה סכום כולל');
  else if (!matches) warnings.push(`סכום הפריטים (${(itemsSum / 100).toFixed(2)}) שונה מהסה״כ (${(total / 100).toFixed(2)}) — ייתכן שחסרים או שגויים פריטים`);
  if (!items.length) warnings.push('לא זוהו פריטים');
  let confidence = items.length ? items.reduce((a, i) => a + i.confidence, 0) / items.length : 0;
  if (matches) confidence = Math.min(1, confidence + 0.15); else confidence *= 0.7;
  if (ocrConfidence !== null) confidence = (confidence + ocrConfidence / 100) / 2;
  return { store: detectStore(text), date: detectDate(text), items, total, itemsSum, discounts, check: { matches, diff }, confidence: Math.round(confidence * 100) / 100, warnings };
}
