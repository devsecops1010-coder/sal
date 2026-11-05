// Automatic list comparison (no manual product picking). The server matched each list line by name to a real product
// in every branch (/api/match). Here: how much of that product the line means, prices with promos, and two views:
// overall (whole basket per branch) and per item (each line across branches). Pure, no DOM.
import { effectivePrice } from './recommend.js';
import { convert, UNITS } from './units.js';
import { sum } from './money.js';

/** Quantity to buy in the row's pricing unit. approx = we had to assume (e.g. "עגבניות" without weight → 1 ק"ג). */
export function qtyFor(item, row) {
  const q = item.qty > 0 ? item.qty : 1, u = item.unit || 'unit';
  const dimOf = (x) => UNITS[x]?.dim;
  if (row.priceUnit === 'kg') {
    if (dimOf(u) === 'mass') return { qty: convert(q, u, 'kg'), approx: false };
    return { qty: 1, approx: true };                       // sold by weight, list has no weight → 1 ק"ג
  }
  if (!['mass', 'volume'].includes(dimOf(u))) return { qty: q, approx: false };   // units / packs
  if (row.size && row.sizeUnit && dimOf(row.sizeUnit) === dimOf(u)) {
    const need = convert(q, u, row.sizeUnit);
    return { qty: Math.max(1, Math.ceil(need / row.size - 1e-9)), approx: false };   // 1.5 ק"ג אורז, 1 ק"ג packs → 2
  }
  return { qty: 1, approx: true };
}

/**
 * items: open list items [{id,name,qty,unit}] · branches: ok branches [{id,...}] · matched: /api/match "items"
 * ctx: { now, userClubs, preferredBranchId }
 */
export function compareAuto(items, branches, matched, ctx = {}) {
  const byId = new Map(matched.map((m) => [m.id, m]));
  const perItem = items.map((item) => {
    const m = byId.get(item.id);
    const cells = {};
    for (const b of branches) {
      const row = m?.rows?.[b.id];
      if (!row) continue;
      const { qty, approx } = qtyFor(item, row);
      cells[b.id] = { row, qty, approx, similar: row.match === 'similar', ...effectivePrice(row, qty, ctx) };
    }
    const ids = Object.keys(cells);
    const cheapest = ids.length ? ids.reduce((a, c) => (cells[c].effective < cells[a].effective ? c : a)) : null;
    return { item, ref: m?.ref || null, cells, cheapest, foundIn: ids.length };
  });
  const common = perItem.filter((p) => p.foundIn === branches.length && branches.length > 0);
  const perBranch = branches.map((b) => {
    const lines = perItem.filter((p) => p.cells[b.id]).map((p) => ({ item: p.item, ...p.cells[b.id] }));
    const total = sum(lines.map((l) => l.effective));
    const regularTotal = sum(lines.map((l) => l.regular));
    return {
      branch: b, lines, total, regularTotal, promoSavings: regularTotal - total,
      missing: perItem.filter((p) => !p.cells[b.id]).map((p) => p.item),
      similar: lines.filter((l) => l.similar).length,
      commonTotal: sum(common.map((p) => p.cells[b.id].effective)),
      coverage: items.length ? lines.length / items.length : 0,
    };
  });
  // rank on the SAME items in every branch; a branch missing most of the list cannot win
  const ranking = [...perBranch].sort((a, b) => (b.coverage >= 0.6) - (a.coverage >= 0.6) || a.commonTotal - b.commonTotal || b.coverage - a.coverage);
  const best = ranking[0] && ranking[0].lines.length ? ranking[0] : null;
  const pref = perBranch.find((r) => r.branch.id === ctx.preferredBranchId);
  const vsPreferred = best && pref && pref !== best && common.length ? { preferred: pref.branch, saving: pref.commonTotal - best.commonTotal } : null;
  const worst = ranking.filter((r) => r.coverage >= 0.6).at(-1);
  const vsWorst = best && worst && worst !== best && common.length ? { branch: worst.branch, saving: worst.commonTotal - best.commonTotal } : null;
  // buy every item where it is cheapest (only items sold in all branches, compared with the best single branch)
  const mixTotal = sum(common.map((p) => p.cells[p.cheapest].effective));
  const mix = best && branches.length > 1 && common.length ? {
    total: mixTotal, saving: best.commonTotal - mixTotal,
    stores: [...new Set(common.map((p) => p.cheapest))],
    assignment: common.map((p) => ({ item: p.item, branchId: p.cheapest })),
  } : null;
  return { perItem, perBranch, ranking, best, vsPreferred, vsWorst, mix, commonCount: common.length, itemCount: items.length };
}
