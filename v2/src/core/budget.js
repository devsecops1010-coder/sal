// SmartCart — budget, expenses & shopping-history analytics (Phase 4). Pure functions, integer agorot.
import { sum, percentChange, multiply } from './money.js';
import { norm } from './categorize.js';

export const TZ = 'Asia/Jerusalem';

/** Calendar parts of an instant in Israel time (correct across DST, independent of the device timezone). */
export function ilParts(date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(date)).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { y: +p.year, m: +p.month, d: +p.day, wd };
}
const pad = (n) => String(n).padStart(2, '0');

/** Period key of an instant: month "2026-11", week "2026-11-01" (the Sunday that starts the Israeli week). */
export function periodKey(date, period = 'month') {
  const { y, m, d, wd } = ilParts(date);
  if (period === 'month') return `${y}-${pad(m)}`;
  const s = new Date(Date.UTC(y, m - 1, d - wd));
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

/** Previous n period keys ending with the current one (oldest first). */
export function lastPeriods(now, n, period = 'month') {
  const out = [];
  const { y, m, d, wd } = ilParts(now);
  for (let i = n - 1; i >= 0; i--) {
    if (period === 'month') { const t = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`); }
    else { const t = new Date(Date.UTC(y, m - 1, d - wd - 7 * i)); out.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`); }
  }
  return out;
}

const tripTotal = (t) => (Number.isInteger(t.total) ? t.total : Number.isInteger(t.estTotal) ? t.estTotal : 0);

/** Spend per period key. trips: [{at: Date|ms|ISO, total?, estTotal?}] */
export function spendByPeriod(trips, period = 'month') {
  const m = new Map();
  for (const t of trips) { const k = periodKey(t.at, period); m.set(k, (m.get(k) || 0) + tripTotal(t)); }
  return m;
}

/** Spend per category in a period, from trip items with known prices; unpriced remainder goes to 'unknown'. */
export function spendByCategory(trips, key, period = 'month') {
  const out = new Map();
  for (const t of trips.filter((x) => periodKey(x.at, period) === key)) {
    let itemized = 0;
    for (const it of t.items || []) {
      if (!Number.isInteger(it.lineTotal)) continue;
      out.set(it.cat || 'other', (out.get(it.cat || 'other') || 0) + it.lineTotal); itemized += it.lineTotal;
    }
    const rest = tripTotal(t) - itemized;
    if (rest > 0) out.set('unknown', (out.get('unknown') || 0) + rest);
  }
  return out;
}

/**
 * Budget status for the current period.
 * budgets: [{period:'month'|'week', amount:int, cat:null|catId}]
 * Returns per budget: spent, left, pct, state 'ok'|'warn'(≥80%)|'over', projected (linear, months only).
 */
export function budgetStatus(budgets, trips, now = new Date()) {
  return budgets.map((b) => {
    const key = periodKey(now, b.period);
    const spent = b.cat
      ? (spendByCategory(trips, key, b.period).get(b.cat) || 0)
      : sum(trips.filter((t) => periodKey(t.at, b.period) === key).map(tripTotal));
    const pct = b.amount > 0 ? Math.round((spent / b.amount) * 100) : null;
    let projected = null;
    if (b.period === 'month') {
      const { y, m, d } = ilParts(now);
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      projected = Math.round((spent / d) * days);
    }
    return { ...b, key, spent, left: b.amount - spent, pct, projected, state: pct === null ? 'ok' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
  });
}

/** Trend for charts: [{key, total}] for the last n periods (missing periods = 0, not omitted). */
export function trend(trips, now, n = 6, period = 'month') {
  const by = spendByPeriod(trips, period);
  return lastPeriods(now, n, period).map((k) => ({ key: k, total: by.get(k) || 0 }));
}

/** Average spend per period over periods that had any spending, and per trip. */
export function averages(trips, period = 'month') {
  const by = [...spendByPeriod(trips, period).values()].filter((v) => v > 0);
  const totals = trips.map(tripTotal).filter((v) => v > 0);
  return {
    perPeriod: by.length ? Math.round(sum(by) / by.length) : null,
    perTrip: totals.length ? Math.round(sum(totals) / totals.length) : null,
    trips: totals.length,
  };
}

/** Month-over-month comparison: { a, b, diff, pct } (b = later period). */
export function comparePeriods(trips, keyA, keyB, period = 'month') {
  const by = spendByPeriod(trips, period);
  const a = by.get(keyA) || 0, b = by.get(keyB) || 0;
  return { a, b, diff: b - a, pct: percentChange(a, b) };
}

/** Compare two baskets item by item: price changes, added, removed. Matching by normalized name. */
export function compareTrips(older, newer) {
  const idx = (t) => new Map((t.items || []).map((i) => [norm(i.name), i]));
  const A = idx(older), B = idx(newer);
  const changed = [], added = [], removed = [];
  for (const [k, b] of B) {
    const a = A.get(k);
    if (!a) { added.push(b); continue; }
    if (Number.isInteger(a.unitPrice) && Number.isInteger(b.unitPrice) && a.unitPrice !== b.unitPrice) {
      changed.push({ name: b.name, from: a.unitPrice, to: b.unitPrice, diff: b.unitPrice - a.unitPrice, pct: percentChange(a.unitPrice, b.unitPrice) });
    }
  }
  for (const [k, a] of A) if (!B.has(k)) removed.push(a);
  changed.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  return { changed, added, removed, totalDiff: tripTotal(newer) - tripTotal(older) };
}

/**
 * "Regular" products: bought in at least `minShare` of the last `lookback` trips (and at least `minTimes`).
 * Returns [{name, times, share, lastQty, lastUnit, cat}], most frequent first.
 */
export function regulars(trips, { lookback = 8, minShare = 0.5, minTimes = 2 } = {}) {
  const recent = [...trips].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, lookback);
  if (!recent.length) return [];
  const m = new Map();
  for (const t of recent) {
    const seen = new Set();
    for (const i of t.items || []) {
      const k = norm(i.name); if (!k || seen.has(k)) continue; seen.add(k);
      const e = m.get(k) || { name: i.name, times: 0, lastQty: i.qty, lastUnit: i.unit, cat: i.cat };
      e.times++; m.set(k, e);
    }
  }
  return [...m.values()].map((e) => ({ ...e, share: Math.round((e.times / recent.length) * 100) / 100 }))
    .filter((e) => e.times >= minTimes && e.share >= minShare)
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, 'he'));
}

/** Build trip items from list items that were bought (checked). */
export function tripItemsFromList(items) {
  return items.filter((i) => i.done).map((i) => {
    const q = typeof i.qty === 'number' && i.qty > 0 ? i.qty : 1;
    const unitPrice = Number.isInteger(i.priceEst) ? i.priceEst : null;
    const lineTotal = unitPrice === null ? null : multiply(unitPrice, q);
    return { name: i.name, qty: q, unit: i.unit || 'unit', cat: i.cat || 'other', unitPrice, lineTotal, ...(i.barcode ? { barcode: i.barcode } : {}) };
  });
}
