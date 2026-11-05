// SmartCart — money in integer minor units (agorot). Never use floats for money.
// A money value is { amount: <int agorot>, currency: 'ILS' }.

export const DEFAULT_CURRENCY = 'ILS';
const SYMBOL = { ILS: '₪', USD: '$', EUR: '€' };

/** Parse "12.9", "12,90", "₪ 1,234.50", 12.9 → 1290 (agorot). Half-up rounding on the 3rd decimal, done on digits, not floats. */
export function toAgorot(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = input.toFixed(6); // exact enough for any price; avoids 1.005 float traps below
  }
  let s = String(input).trim().replace(/[₪$€\s‏‎]/g, '').replace(/ש["״]?ח/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  // "1,234.50" → thousands comma; "12,90" (single comma, ≤2 digits after) → decimal comma
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [ip, fp = ''] = s.split('.');
  const frac = (fp + '000').slice(0, 3);
  let ag = BigInt(ip) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) ag += 1n;
  const n = Number(ag);
  if (!Number.isSafeInteger(n)) return null;
  return neg ? -n : n;
}

export const money = (amount, currency = DEFAULT_CURRENCY) => {
  if (!Number.isInteger(amount)) throw new TypeError('money amount must be integer agorot');
  return { amount, currency };
};

/** Round a (possibly fractional) number of agorot to an integer, half away from zero. */
export function roundAgorot(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** price (agorot) × quantity (may be decimal, e.g. 1.25 kg). Quantity is scaled to thousandths so the math stays in integers. */
export function multiply(agorot, qty) {
  if (!Number.isInteger(agorot)) throw new TypeError('agorot must be integer');
  const q = Math.round(Number(qty) * 1000);
  if (!Number.isFinite(q)) throw new TypeError('bad quantity');
  const p = BigInt(agorot) * BigInt(q); // exact
  const abs = p < 0n ? -p : p;
  let r = abs / 1000n;
  if (abs % 1000n >= 500n) r += 1n;
  return Number(p < 0n ? -r : r);
}

export function sum(values) {
  let t = 0;
  for (const v of values) {
    const a = typeof v === 'object' && v !== null ? v.amount : v;
    if (a === null || a === undefined) continue;
    if (!Number.isInteger(a)) throw new TypeError('sum expects integer agorot');
    t += a;
  }
  return t;
}

/** Sum money objects, refusing to mix currencies. */
export function sumMoney(list, currency = DEFAULT_CURRENCY) {
  for (const m of list) if (m && m.currency && m.currency !== currency) throw new Error(`currency mismatch: ${m.currency} vs ${currency}`);
  return money(sum(list), currency);
}

/** Discount: {percent: 10} or {amount: 500} (agorot) or {fixedPrice: 990}. Never below 0. */
export function applyDiscount(agorot, d) {
  if (!d) return agorot;
  let r = agorot;
  if (d.fixedPrice !== undefined) r = Math.min(agorot, d.fixedPrice);
  else if (d.percent !== undefined) r = agorot - roundAgorot((agorot * d.percent) / 100);
  else if (d.amount !== undefined) r = agorot - d.amount;
  return Math.max(0, r);
}

/** "X for Y" deals, e.g. 3 for ₪10: total price for qty units. */
export function multiBuyTotal(unitAgorot, qty, deal) {
  if (!deal || !deal.count || deal.price === undefined) return multiply(unitAgorot, qty);
  const n = Math.floor(qty / deal.count);
  const rest = qty - n * deal.count;
  return n * deal.price + multiply(unitAgorot, rest);
}

/** Percent change between two amounts, 1 decimal (for "price went up 4.2%"). */
export function percentChange(from, to) {
  if (!from) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

export function format(agorot, currency = DEFAULT_CURRENCY, { sign = false } = {}) {
  if (agorot === null || agorot === undefined) return '—';
  const neg = agorot < 0;
  const abs = Math.abs(agorot);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  const sym = SYMBOL[currency] || currency + ' ';
  return `${neg ? '-' : sign ? '+' : ''}${sym}${whole}.${cents}`;
}
