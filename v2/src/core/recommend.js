// SmartCart — "לאן כדאי לי ללכת לקניות?" Smart store recommendation engine (Phase 10).
// Pure, deterministic and auditable: every number in the result can be traced to an input price/branch.
// It NEVER invents prices, distances or travel times: missing data stays missing and is reported.
import { multiply, sum } from './money.js';
import { normalizeBarcode } from './barcode.js';
import { norm } from './categorize.js';
import { convert, UNITS } from './units.js';

/* ------------------------------------------------------------------ *
 * Inputs
 *  basket: [{ id, name, qty, unit?, barcode?, brand?, size?, sizeUnit?, variant?, allowSubstitute? }]
 *  branches: [{ id, chain, name, city, lat?, lon?, delivery?:{fee, minBasket, freeFrom} }]
 *  prices: [{ branchId, productKey, barcode?, name, brand?, size?, sizeUnit?, variant?, price (agorot),
 *             promo?:{ price?|percent?|count+total?, clubOnly?, club?, from, to }, source, updatedAt (ISO) }]
 *  ctx: { now (Date), userClubs:[chain/club ids], origin?:{lat,lon}, travel?: { [branchId]: {km, minutes, source} },
 *         preferredBranchId?, weights?:{price, distance, time}, maxStaleHours=48, minCoverage=0.8,
 *         costPerKm?:agorot (only if user set it), valueOfMinute?:agorot (only if user set it) }
 * ------------------------------------------------------------------ */

const KM_PER_DEG = 111.32;
/** Straight-line distance (km). Labelled as "קו אווירי" — never shown as driving distance. */
export function haversineKm(a, b) {
  if (!a || !b || [a.lat, a.lon, b.lat, b.lon].some((x) => typeof x !== 'number')) return null;
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/* ---------------- product matching ---------------- */
// match levels, best first. Only EXACT and SAME_PRODUCT are counted as "the same item".
export const MATCH = { EXACT: 'barcode', SAME: 'same-product', SIMILAR: 'similar' };

function sizeInBase(size, unit) {
  if (!size || !unit || !UNITS[unit]) return null;
  const u = UNITS[unit];
  return u.dim === 'mass' || u.dim === 'volume' ? { dim: u.dim, v: size * u.base } : { dim: u.dim, v: size };
}

/**
 * Find the price row for one basket item in one branch.
 * Barcode → exact. Otherwise same normalized name + same brand + same size (±1%) + same variant → same product.
 * Anything looser is returned only as a SIMILAR substitute, never as the item itself.
 */
export function matchItem(item, branchPrices) {
  // same product code as published by the chain (also covers internal codes that are not valid EAN barcodes)
  if (item.productKey) {
    const p = branchPrices.find((r) => r.productKey && String(r.productKey) === String(item.productKey));
    if (p) return { level: MATCH.EXACT, row: p };
  }
  const bc = item.barcode && normalizeBarcode(item.barcode);
  if (bc) {
    const p = branchPrices.find((r) => r.barcode && normalizeBarcode(r.barcode) === bc);
    if (p) return { level: MATCH.EXACT, row: p };
  }
  const n = norm(item.name), b = norm(item.brand || ''), v = norm(item.variant || '');
  const s = sizeInBase(item.size, item.sizeUnit);
  const sameSize = (r) => {
    if (!s) return !r.size;          // item has no size → only rows without size count as the same thing
    const rs = sizeInBase(r.size, r.sizeUnit);
    return rs && rs.dim === s.dim && Math.abs(rs.v - s.v) / s.v <= 0.01;
  };
  const same = branchPrices.find((r) => norm(r.name) === n && norm(r.brand || '') === b && norm(r.variant || '') === v && sameSize(r));
  if (same) return { level: MATCH.SAME, row: same };
  // similar: same name core (contains), comparable unit → offered separately as a substitute
  const similar = branchPrices.filter((r) => {
    const rn = norm(r.name);
    return rn && n && (rn.includes(n) || n.includes(rn));
  });
  if (similar.length) {
    // pick the cheapest per comparable unit when sizes exist, else the cheapest
    const scored = similar.map((r) => {
      const rs = sizeInBase(r.size, r.sizeUnit);
      return { r, per: rs && rs.v ? r.price / rs.v : null };
    });
    scored.sort((a, c) => (a.per ?? Infinity) - (c.per ?? Infinity) || a.r.price - c.r.price);
    return { level: MATCH.SIMILAR, row: scored[0].r, alternatives: scored.slice(0, 3).map((x) => x.r) };
  }
  return null;
}

/* ---------------- effective price ---------------- */
/**
 * Price to pay for qty of a row today. Promotions apply only if active (from ≤ now ≤ to) and,
 * for club deals, only if the user belongs to that club. Returns { regular, effective, promoApplied, promo }.
 */
export function effectivePrice(row, qty, { now = new Date(), userClubs = [] } = {}) {
  const q = qty && qty > 0 ? qty : 1;
  const regular = multiply(row.price, q);
  const pr = row.promo;
  const active = pr && (!pr.from || new Date(pr.from) <= now) && (!pr.to || now <= new Date(pr.to));
  const eligible = active && (!pr.clubOnly || userClubs.includes(pr.club || row.chain));
  if (!eligible) return { regular, effective: regular, promoApplied: false, promo: pr && active ? { ...pr, eligible: false } : null };
  let eff = regular;
  if (pr.price !== undefined) eff = multiply(pr.price, q);
  else if (pr.percent !== undefined) eff = regular - Math.round((regular * pr.percent) / 100);
  else if (pr.count && pr.total !== undefined) {
    const n = Math.floor(q / pr.count);
    eff = n * pr.total + multiply(row.price, q - n * pr.count);
  }
  eff = Math.max(0, Math.min(eff, regular));
  return { regular, effective: eff, promoApplied: eff < regular, promo: pr };
}

/* ---------------- basket per branch ---------------- */
export function priceBasketAt(branch, basket, prices, ctx) {
  const now = ctx.now || new Date();
  const maxStaleMs = (ctx.maxStaleHours ?? 48) * 3600e3;
  const rows = prices.filter((p) => p.branchId === branch.id);
  const lines = [], missing = [], substitutes = [], stale = [];
  let oldest = null;
  for (const item of basket) {
    const m = matchItem(item, rows);
    if (!m) { missing.push(item); continue; }
    const age = now - new Date(m.row.updatedAt);
    if (!(age >= 0) || age > maxStaleMs) { stale.push({ item, row: m.row }); missing.push(item); continue; }
    const qty = qtyInRowUnits(item, m.row);
    if (qty === null) { missing.push(item); continue; }
    const pr = effectivePrice(m.row, qty, ctx);
    const line = { itemId: item.id, name: item.name, match: m.level, qty, ...pr, source: m.row.source, updatedAt: m.row.updatedAt, productName: m.row.name };
    if (m.level === MATCH.SIMILAR) { substitutes.push({ ...line, original: item.name, alternatives: m.alternatives }); missing.push(item); continue; }
    lines.push(line);
    if (!oldest || new Date(m.row.updatedAt) < new Date(oldest)) oldest = m.row.updatedAt;
  }
  const found = lines.length;
  const total = sum(lines.map((l) => l.effective));
  const regularTotal = sum(lines.map((l) => l.regular));
  return {
    branch, lines, missing, substitutes, stale,
    coverage: basket.length ? found / basket.length : 0,
    total, regularTotal, promoSavings: regularTotal - total,
    oldestUpdate: oldest,
  };
}

/** Quantity expressed in the unit the row is priced in (kg-priced produce vs. units). null if incompatible. */
function qtyInRowUnits(item, row) {
  const q = item.qty ?? 1;
  const from = item.unit || 'unit', to = row.priceUnit || 'unit';
  if (from === to) return q;
  try { return convert(q, from, to); } catch { return null; }
}

/* ---------------- travel ---------------- */
function travelFor(branch, ctx) {
  const t = ctx.travel?.[branch.id];
  if (t && typeof t.km === 'number') return { km: t.km, minutes: t.minutes ?? null, kind: 'route', source: t.source || 'מפות' };
  const km = haversineKm(ctx.origin, branch);
  return km === null ? { km: null, minutes: null, kind: 'none' } : { km, minutes: null, kind: 'straight-line' };
}

/** Extra cost of getting there, only from values the user configured. Unknown → null (not 0). */
function travelCost(tr, ctx, legs = 2) {
  if (tr.km === null) return null;
  let c = 0, known = false;
  if (ctx.costPerKm) { c += Math.round(tr.km * legs * ctx.costPerKm); known = true; }
  if (ctx.valueOfMinute && tr.minutes !== null) { c += Math.round(tr.minutes * legs * ctx.valueOfMinute); known = true; }
  return known ? c : null;
}

/* ---------------- recommendation ---------------- */
/**
 * Rank branches for a basket.
 * Returns { ranking, cheapest, nearest, bestValue, vsPreferred, insufficient, reasons } — each with an explanation.
 * A branch is only "recommendable" if coverage ≥ minCoverage. Partial baskets are never presented as cheapest
 * without the coverage shown next to the price.
 */
export function recommend(basket, branches, prices, ctx = {}) {
  const minCov = ctx.minCoverage ?? 0.8;
  const w = normalizeWeights(ctx.weights || { price: 0.6, distance: 0.3, time: 0.1 });
  const results = branches.map((b) => {
    const r = priceBasketAt(b, basket, prices, ctx);
    const tr = travelFor(b, ctx);
    const tc = travelCost(tr, ctx);
    return { ...r, travel: tr, travelCost: tc, totalWithTravel: tc === null ? null : r.total + tc, eligible: r.coverage >= minCov && r.lines.length > 0 };
  });
  const elig = results.filter((r) => r.eligible);
  if (!elig.length) {
    return { ranking: results.sort((a, b) => b.coverage - a.coverage), insufficient: true,
      reason: results.length ? `אין סניף עם לפחות ${Math.round(minCov * 100)}% מהמוצרים ברשימה במחירים עדכניים, ולכן אין המלצה.` : 'אין נתוני סניפים.' };
  }
  // compare like with like: price comparison only over items available in ALL eligible branches
  const common = basket.filter((it) => elig.every((r) => r.lines.some((l) => l.itemId === it.id)));
  for (const r of elig) r.commonTotal = sum(r.lines.filter((l) => common.some((c) => c.id === l.itemId)).map((l) => l.effective));

  const minP = Math.min(...elig.map((r) => r.commonTotal)), maxP = Math.max(...elig.map((r) => r.commonTotal));
  const kms = elig.map((r) => r.travel.km).filter((x) => x !== null);
  const mins = elig.map((r) => r.travel.minutes).filter((x) => x !== null);
  const minK = Math.min(...kms), maxK = Math.max(...kms), minM = Math.min(...mins), maxM = Math.max(...mins);
  const scale = (v, lo, hi) => (v === null || !isFinite(lo) || hi === lo ? null : (v - lo) / (hi - lo)); // 0 best … 1 worst
  for (const r of elig) {
    const parts = [];
    const sp = scale(r.commonTotal, minP, maxP); if (sp !== null) parts.push([w.price, sp]); else parts.push([w.price, 0]);
    const sd = scale(r.travel.km, minK, maxK); if (sd !== null && w.distance) parts.push([w.distance, sd]);
    const st = scale(r.travel.minutes, minM, maxM); if (st !== null && w.time) parts.push([w.time, st]);
    const tw = parts.reduce((a, [x]) => a + x, 0) || 1;
    r.score = Math.round((1 - parts.reduce((a, [x, s]) => a + x * s, 0) / tw) * 100);
  }
  elig.sort((a, b) => b.score - a.score || a.commonTotal - b.commonTotal);

  const cheapest = [...elig].sort((a, b) => a.commonTotal - b.commonTotal)[0];
  const withKm = elig.filter((r) => r.travel.km !== null);
  const nearest = withKm.length ? [...withKm].sort((a, b) => a.travel.km - b.travel.km)[0] : null;
  const bestValue = elig[0];
  const pref = ctx.preferredBranchId && results.find((r) => r.branch.id === ctx.preferredBranchId);
  const vsPreferred = pref && pref.eligible && pref !== bestValue
    ? { preferred: pref.branch, saving: pref.commonTotal - bestValue.commonTotal, comparedItems: common.length } : null;

  for (const r of elig) r.explain = explain(r, { cheapest, nearest, bestValue, common, basket });
  return { ranking: [...elig, ...results.filter((r) => !r.eligible)], cheapest, nearest, bestValue, vsPreferred, commonItems: common.length, insufficient: false, weights: w };
}

function normalizeWeights(w) {
  const t = (w.price || 0) + (w.distance || 0) + (w.time || 0) || 1;
  return { price: (w.price || 0) / t, distance: (w.distance || 0) / t, time: (w.time || 0) / t };
}

function explain(r, { cheapest, nearest, bestValue, common, basket }) {
  const out = [];
  if (r === bestValue) out.push('הכי משתלם לפי השקלול שבחרת');
  if (r === cheapest) out.push(`הסל הזול ביותר (${common.length} מוצרים שקיימים בכל הסניפים)`);
  else out.push(`יקר ב-${((r.commonTotal - cheapest.commonTotal) / 100).toFixed(2)} ₪ מהזול ביותר על אותם ${common.length} מוצרים`);
  if (nearest && r === nearest) out.push('הסניף הקרוב ביותר');
  if (r.missing.length) out.push(`חסרים ${r.missing.length} מתוך ${basket.length} מוצרים`);
  if (r.promoSavings > 0) out.push(`כולל מבצעים בשווי ${(r.promoSavings / 100).toFixed(2)} ₪`);
  if (r.travel.kind === 'straight-line') out.push('המרחק בקו אווירי, זמן הנסיעה לא ידוע');
  return out;
}

/* ---------------- split shopping ---------------- */
/**
 * Is splitting the basket between 2 (optionally 3) branches really cheaper, net of extra costs?
 * Each item goes to the branch where it is cheapest among the chosen set. Extra stop cost uses only
 * user-configured costPerKm / valueOfMinute and known inter-branch distances; if those are unknown,
 * the split is reported with grossSaving only and flagged `costUnknown` (never assumed free).
 * Returns only splits with positive net saving vs. the best single branch (covering the same items).
 */
export function splitOptions(basket, branches, prices, ctx = {}, { maxStores = 2 } = {}) {
  const per = branches.map((b) => priceBasketAt(b, basket, prices, ctx));
  const byBranch = new Map(per.map((p) => [p.branch.id, p]));
  const single = per.filter((p) => p.coverage >= (ctx.minCoverage ?? 0.8));
  if (!single.length) return [];
  const combos = [];
  const ids = per.map((p) => p.branch.id);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    combos.push([ids[i], ids[j]]);
    if (maxStores >= 3) for (let k = j + 1; k < ids.length; k++) combos.push([ids[i], ids[j], ids[k]]);
  }
  const out = [];
  for (const set of combos) {
    const assign = []; let covered = 0;
    for (const it of basket) {
      let best = null;
      for (const id of set) {
        const l = byBranch.get(id).lines.find((x) => x.itemId === it.id);
        if (l && (!best || l.effective < best.line.effective)) best = { id, line: l };
      }
      if (best) { assign.push({ itemId: it.id, name: it.name, branchId: best.id, price: best.line.effective }); covered++; }
    }
    if (!covered) continue;
    const used = [...new Set(assign.map((a) => a.branchId))];
    if (used.length < 2) continue;                       // not actually a split
    const splitTotal = sum(assign.map((a) => a.price));
    // fair baseline: best single branch priced on exactly the items the split covers
    const coveredIds = new Set(assign.map((a) => a.itemId));
    const baselines = single.map((p) => {
      const ls = p.lines.filter((l) => coveredIds.has(l.itemId));
      return ls.length === coveredIds.size ? { branch: p.branch, total: sum(ls.map((l) => l.effective)) } : null;
    }).filter(Boolean);
    if (!baselines.length) continue;
    const base = baselines.sort((a, b) => a.total - b.total)[0];
    const gross = base.total - splitTotal;
    if (gross <= 0) continue;
    // extra stops
    const stops = used.map((id) => branches.find((b) => b.id === id));
    let extraKm = 0, kmKnown = true;
    for (let s = 1; s < stops.length; s++) {
      const k = ctx.interBranchKm?.[`${stops[s - 1].id}|${stops[s].id}`] ?? haversineKm(stops[s - 1], stops[s]);
      if (k === null) { kmKnown = false; break; } extraKm += k;
    }
    let extraCost = null;
    if (kmKnown && (ctx.costPerKm || ctx.valueOfMinute)) {
      extraCost = 0;
      if (ctx.costPerKm) extraCost += Math.round(extraKm * ctx.costPerKm);
      if (ctx.valueOfMinute && ctx.extraMinutesPerStop) extraCost += Math.round((stops.length - 1) * ctx.extraMinutesPerStop * ctx.valueOfMinute);
    }
    const net = extraCost === null ? null : gross - extraCost;
    if (net !== null && net <= 0) continue;              // only positive net savings
    out.push({
      stores: stops.map((s) => s.id), assignment: assign, splitTotal, baseline: base, grossSaving: gross,
      extraKm: kmKnown ? Math.round(extraKm * 10) / 10 : null, extraCost, netSaving: net, costUnknown: extraCost === null,
      coverage: covered / basket.length, stops: stops.length,
    });
  }
  return out.sort((a, b) => (b.netSaving ?? b.grossSaving) - (a.netSaving ?? a.grossSaving));
}

/* ---------------- delivery ---------------- */
/** Delivery total only when the branch publishes delivery terms; otherwise null. */
export function withDelivery(r) {
  const d = r.branch.delivery;
  if (!d || d.fee === undefined) return null;
  if (d.minBasket && r.total < d.minBasket) return { ok: false, reason: `מינימום הזמנה ${(d.minBasket / 100).toFixed(2)} ₪` };
  const fee = d.freeFrom && r.total >= d.freeFrom ? 0 : d.fee;
  return { ok: true, fee, total: r.total + fee };
}

/** Navigation deep links (no API key needed). */
export function navLinks(branch) {
  const q = branch.lat != null ? `${branch.lat},${branch.lon}` : `${branch.chain} ${branch.name} ${branch.city || ''}`;
  return {
    google: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q),
    waze: branch.lat != null ? `https://waze.com/ul?ll=${branch.lat},${branch.lon}&navigate=yes` : 'https://waze.com/ul?q=' + encodeURIComponent(q),
  };
}
