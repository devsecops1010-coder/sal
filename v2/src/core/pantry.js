// SmartCart — home pantry (Phase 6). Pure logic; dates are "YYYY-MM-DD" in Israel time.
import { ilParts } from './budget.js';
import { norm } from './categorize.js';

export const ZONES = [
  { id: 'fridge', name: 'מקרר', em: '🧊' }, { id: 'freezer', name: 'מקפיא', em: '❄️' }, { id: 'pantry', name: 'מזווה', em: '🥫' },
  { id: 'cleaning', name: 'ארון ניקיון', em: '🧼' }, { id: 'baby', name: 'מוצרי תינוקות', em: '🍼' },
];
export const zoneOf = (id) => ZONES.find((z) => z.id === id) || { id, name: id, em: '📦' };   // custom zones keep their name

/** Default zone from the product category (user can change). */
export function defaultZone(cat) {
  return { dairy: 'fridge', meat: 'fridge', produce: 'fridge', frozen: 'freezer', cleaning: 'cleaning', baby: 'baby' }[cat] || 'pantry';
}

export function todayIL(now = new Date()) {
  const { y, m, d } = ilParts(now);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Whole days from today (Israel) to the expiry date; negative = expired. null if no/invalid date. */
export function daysLeft(expiry, now = new Date()) {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const [a, b] = [todayIL(now), expiry].map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return Math.round((b - a) / 864e5);
}
/** 'expired' | 'today' | 'soon' (≤ soonDays) | 'ok' | null */
export function expiryStatus(expiry, now = new Date(), soonDays = 3) {
  const d = daysLeft(expiry, now);
  if (d === null) return null;
  return d < 0 ? 'expired' : d === 0 ? 'today' : d <= soonDays ? 'soon' : 'ok';
}
export function expiryLabel(expiry, now = new Date()) {
  const d = daysLeft(expiry, now);
  if (d === null) return '';
  if (d < 0) return `פג לפני ${-d === 1 ? 'יום' : -d + ' ימים'}`;
  if (d === 0) return 'פג היום';
  if (d === 1) return 'פג מחר';
  return `עוד ${d} ימים`;
}

/** Items needing attention, most urgent first. */
export function expiring(items, now = new Date(), soonDays = 3) {
  return items.filter((i) => (i.qty ?? 1) > 0 && ['expired', 'today', 'soon'].includes(expiryStatus(i.expiresAt, now, soonDays)))
    .sort((a, b) => daysLeft(a.expiresAt, now) - daysLeft(b.expiresAt, now));
}

/** Consume explicitly (never automatic). Returns the new quantity, never below 0. */
export function consume(qty, amount = 1) {
  const q = typeof qty === 'number' ? qty : 1;
  return Math.max(0, Math.round((q - amount) * 1000) / 1000);
}

/** Missing / running low: qty 0, or below the user's minimum. Not already on the active list (by normalized name). */
export function missing(items, listItems = []) {
  const onList = new Set(listItems.filter((i) => !i.done).map((i) => norm(i.name)));
  return items.filter((i) => {
    const q = i.qty ?? 0;
    const low = q <= 0 || (typeof i.minQty === 'number' && q < i.minQty);
    return low && !onList.has(norm(i.name));
  });
}

/** Merge bought trip items into the pantry: same name+zone → add quantity; else new entry. Returns {updates, creates}. */
export function mergePurchases(pantry, bought, { zoneFor = defaultZone } = {}) {
  const updates = [], creates = [];
  for (const b of bought) {
    const zone = zoneFor(b.cat);
    const ex = pantry.find((p) => norm(p.name) === norm(b.name) && (p.zone || 'pantry') === zone);
    const add = typeof b.qty === 'number' && b.qty > 0 ? b.qty : 1;
    if (ex) updates.push({ id: ex.id, qty: Math.round(((ex.qty ?? 0) + add) * 1000) / 1000 });
    else creates.push({ name: b.name, qty: add, unit: b.unit || 'unit', cat: b.cat || 'other', zone, ...(b.barcode ? { barcode: b.barcode } : {}) });
  }
  return { updates, creates };
}

export function groupByZone(items) {
  const m = new Map();
  for (const z of ZONES) m.set(z.id, []);
  for (const i of items) { const z = i.zone || 'pantry'; if (!m.has(z)) m.set(z, []); m.get(z).push(i); }
  return [...m.entries()].filter(([, v]) => v.length);
}
