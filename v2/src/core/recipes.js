// SmartCart — recipes & meal planning (Phase 7, no AI needed). Pure functions.
import { norm, guessCategory } from './categorize.js';
import { UNITS, convert, normalizeUnit } from './units.js';

export const DIFFICULTY = [{ id: 'easy', name: 'קל' }, { id: 'medium', name: 'בינוני' }, { id: 'hard', name: 'מאתגר' }];
export const RCATS = ['ארוחת בוקר', 'עיקרית', 'תוספת', 'מרק', 'סלט', 'מאפה', 'קינוח', 'חטיף', 'אחר'];
export const MEALS = [{ id: 'breakfast', name: 'בוקר' }, { id: 'lunch', name: 'צהריים' }, { id: 'dinner', name: 'ערב' }];

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Ingredients for a different number of servings. Quantities without a number ("קורט", "לפי הטעם") stay as-is. */
export function scaleIngredients(recipe, servings) {
  const base = recipe.servings > 0 ? recipe.servings : 1;
  const f = servings > 0 ? servings / base : 1;
  return (recipe.ingredients || []).map((i) => ({ ...i, qty: typeof i.qty === 'number' ? r3(i.qty * f) : i.qty }));
}

const KITCHEN = /^(כוס|כוסות|כף|כפות|כפית|כפיות|קורט|חופן|חופנים|צרור|צרורות|שן|שיני|קמצוץ|פרוסה|פרוסות|ענף|ענפים)$/;
const PACKS = /^(קופסה|קופסת|קופסאות|פחית|פחיות|חבילה|חבילת|חבילות|שקית|שקיות|בקבוק|בקבוקי|מארז)$/;
/**
 * Parse one free-text ingredient line: "500 גרם עוף" → {name:'עוף', qty:500, unit:'g'}; "2 ביצים" → {name:'ביצים', qty:2};
 * "2 כוסות קמח" → {name:'קמח', qty:2, measure:'כוסות'} (kitchen measure: amount to BUY is unknown → not guessed);
 * "קופסת שימורי עגבניות" / "1 קופסה רסק" → pack; "מלח" → {name:'מלח', qty:null}.
 */
export function parseIngredient(line) {
  const s = String(line || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const m = s.match(/^(\d+(?:[.,]\d+)?|חצי|רבע|שלושת רבעי)\s+(.+)$/);
  const qty = m ? ({ 'חצי': 0.5, 'רבע': 0.25, 'שלושת רבעי': 0.75 }[m[1]] ?? Number(m[1].replace(',', '.'))) : null;
  const rest = m ? m[2] : s;
  const [first, ...tail] = rest.split(' ');
  const name = tail.join(' ').trim();
  if (name && KITCHEN.test(first)) return { name, qty, unit: 'unit', measure: first };
  if (name && PACKS.test(first)) return { name, qty: qty ?? 1, unit: 'pack' };
  const u = normalizeUnit(first);
  if (name && u && u !== 'unit') return { name, qty: qty ?? 1, unit: u };
  return { name: rest, qty, unit: 'unit' };
}

const dimOf = (u) => UNITS[u]?.dim || 'count';
const keyOf = (name, unit) => `${norm(name)}|${dimOf(unit)}`;

/**
 * Merge ingredients from several recipes: same product (normalized name) + compatible unit → one line, summed in a base
 * unit then shown in the nicest unit (1500 g → 1.5 kg). Incompatible units stay separate lines (never guessed).
 * Each line remembers which recipes need it.
 */
export function aggregate(lines) {
  const m = new Map();
  for (const l of lines) {
    if (!l?.name) continue;
    const unit = l.unit || 'unit';
    const k = keyOf(l.name, unit);
    const e = m.get(k) || { name: l.name, unit, qty: null, base: 0, unknown: false, from: [], dim: dimOf(unit) };
    if (typeof l.qty === 'number' && !l.measure) {
      const b = e.dim === 'mass' || e.dim === 'volume' ? convert(l.qty, unit, e.dim === 'mass' ? 'g' : 'ml') : l.qty;
      e.base = r3(e.base + b);
    } else e.unknown = true;            // "מלח לפי הטעם" — needed, amount unknown
    if (l.from && !e.from.includes(l.from)) e.from.push(l.from);
    m.set(k, e);
  }
  return [...m.values()].map((e) => {
    let qty = e.base || null, unit = e.unit;
    if (e.dim === 'mass') { unit = e.base >= 1000 ? 'kg' : 'g'; qty = e.base ? (unit === 'kg' ? r3(e.base / 1000) : e.base) : null; }
    if (e.dim === 'volume') { unit = e.base >= 1000 ? 'l' : 'ml'; qty = e.base ? (unit === 'l' ? r3(e.base / 1000) : e.base) : null; }
    return { name: e.name, qty, unit, unknownAmount: e.unknown && !e.base, from: e.from, cat: guessCategory(e.name) };
  });
}

/**
 * Subtract what is already at home. Pantry items match by normalized name and compatible unit.
 * Returns { need:[...], covered:[{name, have}] } — fully covered lines are not bought.
 */
export function subtractPantry(needed, pantry) {
  const need = [], covered = [];
  for (const n of needed) {
    const p = pantry.find((x) => (x.qty ?? 0) > 0 && norm(x.name) === norm(n.name) && dimOf(x.unit || 'unit') === dimOf(n.unit));
    if (!p) { need.push(n); continue; }
    if (n.qty === null) { covered.push({ name: n.name, have: p.qty, unit: p.unit }); continue; }   // amount unknown, we have some
    const have = dimOf(n.unit) === 'count' || dimOf(n.unit) === 'pack' ? p.qty : convert(p.qty, p.unit, n.unit);
    const rest = r3(n.qty - have);
    if (rest <= 0) covered.push({ name: n.name, have: p.qty, unit: p.unit });
    else need.push({ ...n, qty: rest, partlyAtHome: true });
  }
  return { need, covered };
}

/**
 * Put the needed ingredients on a shopping list WITHOUT duplicates: an open item with the same name and a compatible
 * unit gets its quantity increased; otherwise a new item is created.
 */
export function mergeIntoList(listItems, needed) {
  const updates = [], creates = [];
  for (const n of needed) {
    const ex = listItems.find((i) => !i.done && norm(i.name) === norm(n.name) && dimOf(i.unit || 'unit') === dimOf(n.unit));
    if (ex && typeof n.qty === 'number' && typeof ex.qty === 'number') {
      const add = dimOf(n.unit) === 'count' || dimOf(n.unit) === 'pack' ? n.qty : convert(n.qty, n.unit, ex.unit || 'unit');
      updates.push({ id: ex.id, qty: r3(ex.qty + add) });
    } else if (ex) {
      // already on the list (amount unknown on one side) → don't add a duplicate line
    } else {
      creates.push({ name: n.name, qty: n.qty ?? 1, unit: n.qty === null ? 'unit' : n.unit, cat: n.cat || guessCategory(n.name), note: n.from?.length ? 'למתכון: ' + n.from.join(', ') : undefined });
    }
  }
  return { updates, creates };
}

/** All recipe ingredient lines of a week plan, scaled to the planned servings. plan.days = { d0: { lunch:[{recipeId, servings}] } } */
export function planIngredients(plan, recipes) {
  const out = [];
  for (const day of Object.values(plan?.days || {})) {
    for (const slot of Object.values(day || {})) {
      for (const e of slot || []) {
        const r = recipes.find((x) => x.id === e.recipeId); if (!r) continue;
        for (const i of scaleIngredients(r, e.servings || r.servings)) out.push({ ...i, from: r.name });
      }
    }
  }
  return out;
}

/** Friendlier unit for display: 1000 g → 1 kg, 1500 ml → 1.5 l, 0.25 kg → 250 g. */
export function niceQty(qty, unit) {
  if (typeof qty !== 'number') return { qty, unit };
  if (unit === 'g' && qty >= 1000) return { qty: r3(qty / 1000), unit: 'kg' };
  if (unit === 'ml' && qty >= 1000) return { qty: r3(qty / 1000), unit: 'l' };
  if (unit === 'kg' && qty < 1) return { qty: r3(qty * 1000), unit: 'g' };
  if (unit === 'l' && qty < 1) return { qty: r3(qty * 1000), unit: 'ml' };
  return { qty, unit };
}
