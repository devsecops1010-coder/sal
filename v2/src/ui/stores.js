// Phase 10 UI — "לאן כדאי לי ללכת לקניות?" Uses official price-transparency data via the price service and the
// pure engine in core/recommend.js. Every price shows its source and publication time; nothing is invented:
// items the user did not link to an exact product (barcode) are listed as "not compared", never guessed.
import { h, toast, openSheet, closeSheet } from './dom.js';
import * as P from '../data/prices.js';
import { recommend, splitOptions } from '../core/recommend.js';
import { format } from '../core/money.js';
import { norm } from '../core/categorize.js';
import { formatQty } from '../core/units.js';

const MAX_BRANCHES = 6;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const prefs = () => {
  const p = { branches: [], clubs: [], minCoverage: 0.8, ...load('sc.stores', {}) };
  if (p.club === true && !p.clubs.includes('shufersal')) p.clubs = [...p.clubs, 'shufersal'];   // older setting (Shufersal only)
  delete p.club;
  return p;
};
const chainOf = (b) => String(b.id).split(':')[0];
const bname = (b) => ((b.chainName ? b.chainName + ' ' : '') + b.name).trim();
const setPrefs = (p) => save('sc.stores', p);
const prodMap = () => load('sc.prodmap', {});
const remember = (name, row) => { const m = prodMap(); m[norm(name)] = { code: row.productKey, name: row.name }; save('sc.prodmap', m); };

const when = (iso) => {
  if (!iso) return 'לא ידוע';
  const d = new Date(iso);
  return isNaN(d) ? 'לא ידוע' : d.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const navUrl = (b) => {
  const q = `${b.chainName || ''} ${b.address || ''} ${b.city || ''}`.trim();
  return { google: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q), waze: 'https://waze.com/ul?q=' + encodeURIComponent(q) + '&navigate=yes' };
};
const promoText = (pr) => !pr ? '' : pr.description || (pr.count ? `${pr.count} ב-${format(pr.total)}` : pr.price !== undefined ? `מחיר מבצע ${format(pr.price)}` : `${pr.percent}% הנחה`);

/**
 * ctx: { items:()=>[...list items], linkItem:(item, code)=>Promise, listName }
 */
export function viewWhere(ctx) {
  const root = h('div', { class: 'where' });
  const st = { result: null, busy: false, msg: '' };

  function paint() {
    const p = prefs();
    const items = ctx.items().filter((i) => !i.done);
    const pm = prodMap();
    const linked = items.map((i) => ({ item: i, code: i.barcode || pm[norm(i.name)]?.code || null, viaMemory: !i.barcode && !!pm[norm(i.name)], label: pm[norm(i.name)]?.name }));
    const nodes = [];

    nodes.push(h('div', { class: 'card glass' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, 'הסניפים להשוואה'), h('button', { class: 'btn sm', onclick: () => chooseBranches(paint) }, p.branches.length ? 'שינוי' : 'בחירת סניפים')),
      p.branches.length
        ? h('div', { class: 'chips', style: 'flex-wrap:wrap;margin-top:8px' }, p.branches.map((b, i) => h('span', { class: 'chip' + (i === 0 ? ' on' : '') }, (i === 0 ? '⭐ ' : '') + b.name + ' · ' + (b.city || ''))))
        : h('p', { class: 'hint' }, 'בחרו עד 6 סניפים באזור שלכם. הסניף הראשון נחשב "הסניף הרגיל שלי".'),
      [...new Map(p.branches.map((b) => [chainOf(b), b.chainName || chainOf(b)])).entries()].map(([cid, cname]) =>
        h('label', { class: 'row', style: 'margin-top:8px;gap:8px;align-items:center' },
          h('input', { type: 'checkbox', checked: p.clubs.includes(cid), onchange: (e) => {
            const cur = prefs(); setPrefs({ ...cur, clubs: e.target.checked ? [...new Set([...cur.clubs, cid])] : cur.clubs.filter((x) => x !== cid) }); st.result = null; paint(); } }),
          h('span', { class: 'hint' }, `יש לי מועדון / כרטיס של ${cname} (כולל מבצעי מועדון בחישוב)`)))));

    // products
    const unl = linked.filter((l) => !l.code);
    nodes.push(h('div', { class: 'card glass' },
      h('b', null, `מוצרים ברשימה (${linked.length - unl.length} מתוך ${linked.length} מקושרים למוצר מדויק)`),
      h('p', { class: 'hint' }, 'משווים רק מוצר זהה (לפי ברקוד). פריט בלי מוצר מקושר לא נכלל בהשוואה, כדי לא להשוות תפוחים לתפוזים.'),
      linked.length ? linked.map((l) => h('div', { class: 'row', style: 'justify-content:space-between;padding:6px 0;border-top:1px solid var(--brd)' },
        h('div', null, h('div', null, l.item.name, l.item.qty ? ' · ' + (formatQty(l.item.qty, l.item.unit) || '') : ''),
          h('div', { class: 'hint' }, l.code ? (l.viaMemory ? `✓ לפי בחירה קודמת: ${l.label}` : `✓ ברקוד ${l.code}`) : 'לא נבחר מוצר')),
        h('button', { class: 'btn sm ghost', disabled: !p.branches.length, onclick: () => pickProduct(l.item, paint) }, l.code ? 'החלפה' : 'בחירת מוצר')))
        : h('p', { class: 'hint' }, 'אין פריטים פתוחים ברשימה.')));

    const codes = [...new Set(linked.filter((l) => l.code).map((l) => l.code))];
    nodes.push(h('button', { class: 'btn block', disabled: st.busy || !p.branches.length || !codes.length, onclick: () => compare(linked) },
      st.busy ? 'מחשב…' : '🔎 לאן כדאי לי ללכת לקניות?'));
    if (st.msg) nodes.push(h('p', { class: 'hint', role: 'status', style: 'text-align:center' }, st.msg));
    if (st.result) nodes.push(...renderResult(st.result, linked));
    root.replaceChildren(...nodes);
  }

  async function compare(linked) {
    const p = prefs();
    const withCode = linked.filter((l) => l.code);
    st.busy = true; st.msg = 'מביא מחירים עדכניים…'; st.result = null; paint();
    try {
      const r = await P.prices(p.branches.map((b) => b.id), [...new Set(withCode.map((l) => l.code))], {
        onWait: (x) => { st.msg = 'טוען קבצי מחירים מהרשת (בפעם הראשונה לסניף זה לוקח עד 2 דקות)…' + ` ${x.branches.filter((b) => b.ok).length}/${x.branches.length} מוכנים`; paint(); } });
      const branches = p.branches.map((b) => { const s = r.branches.find((x) => x.id === b.id); return { ...b, ...(s || {}), ok: !!s?.ok }; });
      const okB = branches.filter((b) => b.ok);
      const basket = withCode.map((l) => ({ id: l.item.id, name: l.item.name, qty: l.item.qty || 1, unit: l.item.unit || 'unit', barcode: l.code, productKey: l.code }));
      const ectx = { now: new Date(), userClubs: p.clubs.map((c) => c + '-club'), weights: { price: 1 }, minCoverage: p.minCoverage, maxStaleHours: 48, preferredBranchId: p.branches[0]?.id };
      const rec = recommend(basket, okB, r.rows, ectx);
      const split = okB.length >= 2 ? splitOptions(basket, okB, r.rows, ectx).slice(0, 1) : [];
      st.result = { rec, split, branches, basket, rows: r.rows, at: new Date() };
      st.msg = '';
    } catch (e) {
      st.msg = e.message || 'שגיאה';
    } finally { st.busy = false; paint(); }
  }

  function renderResult({ rec, split, branches, basket }, linked) {
    const out = [];
    const failed = branches.filter((b) => !b.ok);
    if (failed.length) out.push(h('p', { class: 'hint' }, '⚠️ לא התקבלו מחירים מ: ' + failed.map((b) => b.name + (b.error ? ` (${b.error})` : '')).join(', ')));
    const notCompared = linked.filter((l) => !l.code);
    if (rec.insufficient) {
      out.push(h('div', { class: 'card glass' }, h('b', null, 'אין המלצה'), h('p', { class: 'hint' }, rec.reason)));
    } else {
      const best = rec.bestValue;
      out.push(h('div', { class: 'card glass', style: 'border:2px solid var(--accent)' },
        h('div', { class: 'hint' }, '🏆 הכי משתלם לסל שלך'),
        h('div', { class: 'total' }, bname(best.branch)),
        h('div', null, `${format(best.total)} · ${best.lines.length} מתוך ${basket.length} מוצרים`),
        rec.vsPreferred && rec.vsPreferred.saving > 0 ? h('div', { class: 'badge', style: 'margin-top:6px' }, `חיסכון של ${format(rec.vsPreferred.saving)} לעומת ${bname(rec.vsPreferred.preferred)} (על ${rec.vsPreferred.comparedItems} מוצרים זהים)`) : null,
        h('ul', { class: 'hint', style: 'margin:8px 0 0;padding-inline-start:18px' }, (best.explain || []).map((x) => h('li', null, x)))));
      if (split.length) {
        const s = split[0];
        out.push(h('div', { class: 'card glass' }, h('b', null, '✂️ פיצול בין שני סניפים'),
          h('p', { class: 'hint' }, `חוסך ${format(s.grossSaving)} על ${s.assignment.length} מוצרים לעומת ${s.baseline.branch.name}. ${s.costUnknown ? 'עלות הנסיעה הנוספת לא ידועה ולא הופחתה — כדאי רק אם הסניפים קרובים.' : ''}`),
          s.stores.map((id) => { const b = branches.find((x) => x.id === id); const its = s.assignment.filter((a) => a.branchId === id); return h('div', { class: 'hint' }, `${b?.name}: ${its.map((a) => a.name).join(', ')}`); })));
      }
    }
    for (const r of rec.ranking) out.push(branchCard(r));
    if (notCompared.length) out.push(h('p', { class: 'hint' }, `לא נכללו בהשוואה (לא נבחר מוצר): ${notCompared.map((l) => l.item.name).join(', ')}`));
    out.push(h('p', { class: 'hint', style: 'margin-top:10px' }, 'מקור: קבצי המחירים הרשמיים שהרשתות מפרסמות לפי חוק שקיפות מחירים. רשתות זמינות: שופרסל, רמי לוי, אושר עד, טיב טעם. מבצעים בתנאי קנייה מינימלית ("מעל 75 ש״ח") מוצגים אבל לא מחושבים. המחיר בקופה עשוי להשתנות; מבצעים בקופון לא נכללים. המרחק לסניפים לא ידוע לנו (הרשת לא מפרסמת מיקום מדויק).'));
    return out;
  }

  function branchCard(r) {
    const b = r.branch; const nav = navUrl(b);
    const det = h('div', { style: 'display:none;margin-top:8px' },
      r.lines.map((l) => h('div', { class: 'row', style: 'justify-content:space-between;font-size:13px;padding:3px 0' },
        h('span', null, l.productName, l.qty !== 1 ? ` ×${formatQty(l.qty, 'unit') || l.qty}` : ''),
        h('span', null, l.promoApplied ? h('s', { class: 'hint' }, format(l.regular)) : null, ' ', format(l.effective),
          l.promo ? h('div', { class: 'hint' }, (l.promo.eligible === false ? '(מועדון) ' : '') + promoText(l.promo)) : null))),
      r.missing.length ? h('p', { class: 'hint' }, 'חסרים בסניף: ' + r.missing.map((m) => m.name).join(', ')) : null,
      h('p', { class: 'hint' }, `מחירים נכונים ל-${when(r.oldestUpdate || b.pricesPublishedAt)} · ${b.source || ''}`));
    return h('div', { class: 'card glass' + (r.eligible ? '' : ' muted') },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', null, h('b', null, bname(b)), h('div', { class: 'hint' }, [b.address, b.city].filter(Boolean).join(', '))),
        h('div', { style: 'text-align:left' }, h('b', null, format(r.total)), h('div', { class: 'hint' }, `${r.lines.length}/${r.lines.length + r.missing.length} מוצרים`))),
      r.promoSavings > 0 ? h('span', { class: 'badge' }, `מבצעים: −${format(r.promoSavings)}`) : null,
      !r.eligible ? h('span', { class: 'badge warn' }, 'חסרים מוצרים רבים, לא מומלץ') : null,
      h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
        h('button', { class: 'btn sm ghost', onclick: (e) => { const open = det.style.display === 'none'; det.style.display = open ? '' : 'none'; e.target.textContent = open ? 'הסתרה' : 'פירוט'; } }, 'פירוט'),
        h('a', { class: 'btn sm ghost', href: nav.waze, target: '_blank', rel: 'noopener' }, 'Waze'),
        h('a', { class: 'btn sm ghost', href: nav.google, target: '_blank', rel: 'noopener' }, 'מפות')),
      det);
  }

  function pickProduct(item, done) {
    const p = prefs(); let branch = p.branches[0];
    const bsel = h('select', { class: 'input', 'aria-label': 'חיפוש בסניף', onchange: () => { branch = p.branches.find((b) => b.id === bsel.value) || branch; run(); } },
      p.branches.map((b) => h('option', { value: b.id }, (b.chainName || '') + ' ' + b.name)));
    const q = h('input', { class: 'input', value: item.name, maxlength: '60', enterkeyhint: 'search', 'aria-label': 'חיפוש מוצר' });
    const res = h('div', { 'aria-live': 'polite' });
    const run = async () => {
      const s = q.value.trim(); if (s.length < 2) return;
      res.replaceChildren(h('p', { class: 'hint' }, 'מחפש…'));
      try {
        const r = await P.search(branch.id, s, { onWait: () => res.replaceChildren(h('p', { class: 'hint' }, 'טוען את קובץ המחירים של הסניף (בפעם הראשונה עד 2 דקות)…')) });
        if (!r.results.length) return res.replaceChildren(h('p', { class: 'hint' }, `לא נמצא ב${branch.name}. נסו מילה אחרת (למשל רק "חלב 3%").`));
        res.replaceChildren(...r.results.map((x) => h('button', { class: 'item glass', style: 'width:100%;text-align:right', onclick: async () => {
          try { await ctx.linkItem(item, x.productKey); remember(item.name, x); closeSheet(); toast('המוצר קושר ✓'); done(); } catch (e) { toast('לא נשמר, נסו שוב'); }
        } },
          h('div', { class: 'nm' }, h('b', null, x.name), h('div', { class: 'meta' }, [x.brand, x.promo ? '🏷️ ' + promoText(x.promo) : null].filter(Boolean).join(' · '))),
          h('span', { class: 'px' }, format(x.price) + (x.priceUnit === 'kg' ? '/ק"ג' : '')))));
      } catch (e) { res.replaceChildren(h('p', { class: 'hint' }, e.message)); }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    openSheet('איזה מוצר בדיוק? · ' + item.name, h('div', { class: 'row' }, q, h('button', { class: 'btn', onclick: run }, 'חיפוש')),
      p.branches.length > 1 ? h('div', { class: 'field', style: 'margin-top:8px' }, bsel) : null,
      h('p', { class: 'hint' }, 'הבחירה נשמרת על הפריט ומשמשת להשוואה בכל הסניפים (לפי ברקוד, גם ברשתות אחרות).'), res);
    run();
  }

  paint();
  return root;
}

/** Branch picker: city → branches (max 6). First chosen = "my usual branch". */
export function chooseBranches(done) {
  let chosen = [...prefs().branches];
  const cityIn = h('input', { class: 'input', placeholder: 'עיר (למשל: הרצליה)', list: 'sc-cities', 'aria-label': 'עיר' });
  const dl = h('datalist', { id: 'sc-cities' });
  const list = h('div');
  const sel = h('div', { class: 'chips', style: 'flex-wrap:wrap' });
  let cities = [];
  const paintSel = () => sel.replaceChildren(...chosen.map((b, i) => h('button', { class: 'chip on', 'aria-label': 'הסרת ' + b.name, onclick: () => { chosen = chosen.filter((x) => x.id !== b.id); paintSel(); } }, (i === 0 ? '⭐ ' : '') + b.name + ' ✕')));
  const showCity = async () => {
    const c = cities.find((x) => x.name === cityIn.value.trim());
    if (!c) return;
    list.replaceChildren(h('p', { class: 'hint' }, 'טוען סניפים…'));
    try {
      const bs = await P.branchesInCity(c.code);
      list.replaceChildren(...bs.map((b) => h('label', { class: 'row', style: 'gap:8px;padding:6px 0;align-items:center' },
        h('input', { type: 'checkbox', checked: chosen.some((x) => x.id === b.id), onchange: (e) => {
          if (e.target.checked) { if (chosen.length >= MAX_BRANCHES) { e.target.checked = false; return toast(`עד ${MAX_BRANCHES} סניפים`); } chosen.push({ id: b.id, name: b.name, city: b.city, address: b.address, chainName: b.chainName }); }
          else chosen = chosen.filter((x) => x.id !== b.id);
          paintSel();
        } }),
        h('span', null, h('b', null, b.chainName + ' ' + b.name), h('div', { class: 'hint' }, b.address || '')))));
    } catch (e) { list.replaceChildren(h('p', { class: 'hint' }, e.message)); }
  };
  cityIn.addEventListener('change', showCity);
  cityIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') showCity(); });
  openSheet('בחירת סניפים', h('div', { class: 'field' }, cityIn, dl), list,
    h('div', { class: 'field', style: 'margin-top:10px' }, h('label', null, 'נבחרו (הראשון = הסניף הרגיל שלי)'), sel),
    h('button', { class: 'btn block', onclick: () => { setPrefs({ ...prefs(), branches: chosen }); closeSheet(); done?.(); } }, 'שמירה'));
  paintSel();
  P.cities().then((cs) => { cities = cs; dl.replaceChildren(...cs.map((c) => h('option', { value: c.name }))); }).catch((e) => list.replaceChildren(h('p', { class: 'hint' }, e.message)));
}
