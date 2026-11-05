// Phase 10 UI — "לאן כדאי לי ללכת לקניות?" Official price-transparency data via the price service.
// Every list line is matched AUTOMATICALLY by name to a real product in each branch (server /api/match); the user may
// pin an exact product (barcode) but never has to. Two views: overall (whole basket per branch) and per item.
// Nothing is invented: a line with no fitting product in a branch is shown as missing there.
import { h, toast, openSheet, closeSheet } from './dom.js';
import * as P from '../data/prices.js';
import { compareAuto } from '../core/automatch.js';
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
  const st = { result: null, busy: false, msg: '', tab: 'all', showPins: false };

  function paint() {
    const p = prefs();
    const items = ctx.items().filter((i) => !i.done);
    const pm = prodMap();
    const pinned = (i) => i.barcode || pm[norm(i.name)]?.code || null;
    const nodes = [];

    nodes.push(h('div', { class: 'card glass' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, 'הסניפים להשוואה'), h('button', { class: 'btn sm', onclick: () => chooseBranches(() => { st.result = null; paint(); }) }, p.branches.length ? 'שינוי' : 'בחירת סניפים')),
      p.branches.length
        ? h('div', { class: 'chips', style: 'flex-wrap:wrap;margin-top:8px' }, p.branches.map((b, i) => h('span', { class: 'chip' + (i === 0 ? ' on' : '') }, (i === 0 ? '⭐ ' : '') + bname(b) + ' · ' + (b.city || ''))))
        : h('p', { class: 'hint' }, 'בחרו עד 6 סניפים באזור שלכם. הסניף הראשון נחשב "הסניף הרגיל שלי".'),
      [...new Map(p.branches.map((b) => [chainOf(b), b.chainName || chainOf(b)])).entries()].map(([cid, cname]) =>
        h('label', { class: 'row', style: 'margin-top:8px;gap:8px;align-items:center' },
          h('input', { type: 'checkbox', checked: p.clubs.includes(cid), onchange: (e) => {
            const cur = prefs(); setPrefs({ ...cur, clubs: e.target.checked ? [...new Set([...cur.clubs, cid])] : cur.clubs.filter((x) => x !== cid) }); st.result = null; paint(); } }),
          h('span', { class: 'hint' }, `יש לי מועדון / כרטיס של ${cname} (כולל מבצעי מועדון בחישוב)`)))));

    nodes.push(h('button', { class: 'btn block', disabled: st.busy || !p.branches.length || !items.length, onclick: () => compare(items) },
      st.busy ? 'מחשב…' : `🔎 השוואת מחירים לכל הרשימה (${items.length} מוצרים)`));
    if (!items.length) nodes.push(h('p', { class: 'hint', style: 'text-align:center' }, 'אין פריטים פתוחים ברשימה.'));
    if (st.msg) nodes.push(h('p', { class: 'hint', role: 'status', style: 'text-align:center' }, st.msg));
    if (st.result) nodes.push(...renderResult(st.result));

    // optional: pin an exact product for a line (not needed for the comparison)
    const pins = items.filter(pinned).length;
    nodes.push(h('div', { class: 'card glass' },
      h('button', { class: 'btn sm ghost', 'aria-expanded': String(st.showPins), onclick: () => { st.showPins = !st.showPins; paint(); } },
        (st.showPins ? '▾ ' : '▸ ') + `קיבוע מוצר מדויק (לא חובה${pins ? ` · ${pins} קבועים` : ''})`),
      st.showPins ? [h('p', { class: 'hint' }, 'ההשוואה מתאימה מוצר לכל שורה לפי השם. אם חשוב לכם מותג או גודל מסוים, קבעו אותו כאן והוא ישמש בכל הסניפים.'),
        items.map((i) => h('div', { class: 'row', style: 'justify-content:space-between;padding:6px 0;border-top:1px solid var(--brd)' },
          h('div', null, h('div', null, i.name), h('div', { class: 'hint' }, pinned(i) ? `✓ ${pm[norm(i.name)]?.name || 'ברקוד ' + pinned(i)}` : 'אוטומטי לפי השם')),
          h('button', { class: 'btn sm ghost', disabled: !p.branches.length, onclick: () => pickProduct(i, () => { st.result = null; paint(); }) }, pinned(i) ? 'החלפה' : 'קיבוע')))] : null));
    root.replaceChildren(...nodes);
  }

  async function compare(items) {
    const p = prefs();
    const pm = prodMap();
    st.busy = true; st.msg = 'מתאים מוצרים ומביא מחירים עדכניים…'; st.result = null; paint();
    try {
      const req = items.map((i) => ({ id: i.id, name: i.name, unit: i.unit || 'unit', code: i.barcode || pm[norm(i.name)]?.code || undefined }));
      const r = await P.match(p.branches.map((b) => b.id), req, {
        onWait: (x) => { st.msg = 'טוען קבצי מחירים מהרשת (בפעם הראשונה לסניף זה לוקח עד 2 דקות)…' + ` ${x.branches.filter((b) => b.ok).length}/${x.branches.length} מוכנים`; paint(); } });
      const branches = p.branches.map((b) => { const s = r.branches.find((x) => x.id === b.id); return { ...b, ...(s || {}), ok: !!s?.ok }; });
      const okB = branches.filter((b) => b.ok);
      const cmp = compareAuto(items, okB, r.items, { now: new Date(), userClubs: p.clubs.map((c) => c + '-club'), preferredBranchId: p.branches[0]?.id });
      st.result = { cmp, branches, okB };
      st.msg = '';
    } catch (e) {
      st.msg = e.message || 'שגיאה';
    } finally { st.busy = false; paint(); }
  }

  function renderResult({ cmp, branches, okB }) {
    const out = [];
    const failed = branches.filter((b) => !b.ok);
    if (failed.length) out.push(h('p', { class: 'hint' }, '⚠️ לא התקבלו מחירים מ: ' + failed.map((b) => bname(b) + (b.error ? ` (${b.error})` : '')).join(', ')));
    if (!cmp.best) { out.push(h('div', { class: 'card glass' }, h('b', null, 'לא נמצאו מוצרים מתאימים'), h('p', { class: 'hint' }, 'נסו שמות מוצרים פשוטים יותר (למשל "חלב 3%", "עגבניות").'))); return out; }
    out.push(h('div', { class: 'seg', role: 'tablist', style: 'display:flex;gap:6px;margin:4px 0' },
      [['all', 'השוואה כללית'], ['item', 'השוואה פרטנית']].map(([k, t]) => h('button', { class: 'btn sm ' + (st.tab === k ? '' : 'ghost'), role: 'tab', 'aria-selected': String(st.tab === k), style: 'flex:1', onclick: () => { st.tab = k; paint(); } }, t))));
    out.push(...(st.tab === 'all' ? overall(cmp) : perItem(cmp, okB)));
    out.push(h('p', { class: 'hint', style: 'margin-top:10px' }, 'איך זה עובד: לכל שורה ברשימה נבחר אוטומטית המוצר המתאים ביותר לשם. בכל סניף נבדק קודם אותו מוצר בדיוק (אותו ברקוד); אם הוא לא נמכר שם, נלקח המוצר הדומה ביותר באותו גודל, ומסומן ≈. הדירוג מחושב רק על מוצרים שנמצאו בכל הסניפים. מקור: קבצי המחירים הרשמיים לפי חוק שקיפות מחירים. מבצעים בתנאי קנייה מינימלית או בקופון לא מחושבים. המחיר בקופה עשוי להשתנות.'));
    return out;
  }

  function overall(c) {
    const out = [];
    const best = c.best;
    out.push(h('div', { class: 'card glass', style: 'border:2px solid var(--accent)' },
      h('div', { class: 'hint' }, '🏆 הכי משתלם לרשימה שלך'),
      h('div', { class: 'total' }, bname(best.branch)),
      h('div', null, `${format(best.commonTotal)} על ${c.commonCount} מוצרים שנמצאו בכל הסניפים`),
      c.vsPreferred && c.vsPreferred.saving > 0 ? h('div', { class: 'badge', style: 'margin-top:6px' }, `חוסך ${format(c.vsPreferred.saving)} לעומת ${bname(c.vsPreferred.preferred)}`) : null,
      c.vsWorst && c.vsWorst.saving > 0 && c.vsWorst.branch.id !== c.vsPreferred?.preferred?.id ? h('div', { class: 'hint', style: 'margin-top:4px' }, `ו-${format(c.vsWorst.saving)} לעומת היקר ביותר (${bname(c.vsWorst.branch)})`) : null,
      best.missing.length ? h('div', { class: 'hint', style: 'margin-top:4px' }, 'לא נמצאו שם: ' + best.missing.map((i) => i.name).join(', ')) : null));
    if (c.mix && c.mix.saving > 0 && c.mix.stores.length > 1) {
      out.push(h('div', { class: 'card glass' }, h('b', null, '✂️ לקנות כל מוצר איפה שהכי זול'),
        h('p', { class: 'hint' }, `${format(c.mix.total)}: עוד ${format(c.mix.saving)} חיסכון, אבל צריך ללכת ל-${c.mix.stores.length} סניפים.`),
        c.mix.stores.map((id) => { const r = c.perBranch.find((x) => x.branch.id === id); return h('div', { class: 'hint' }, `${bname(r.branch)}: ${c.mix.assignment.filter((a) => a.branchId === id).map((a) => a.item.name).join(', ')}`); })));
    }
    for (const r of c.ranking) out.push(branchCard(r, c));
    return out;
  }

  function branchCard(r, c) {
    const b = r.branch; const nav = navUrl(b);
    const det = h('div', { style: 'display:none;margin-top:8px' },
      r.lines.map((l) => h('div', { class: 'row', style: 'justify-content:space-between;font-size:13px;padding:3px 0;gap:8px' },
        h('span', null, h('b', null, l.item.name), ' ', h('span', { class: 'hint' }, (l.similar ? '≈ ' : '') + l.row.name + (l.qty !== 1 ? ` ×${formatQty(l.qty, 'unit') || l.qty}${l.row.priceUnit === 'kg' ? ' ק"ג' : ''}` : '') + (l.approx ? ' (כמות משוערת)' : '') + (l.promo ? ' · 🏷️ ' + (l.promo.eligible === false ? '(מועדון) ' : '') + promoText(l.promo) : ''))),
        h('span', { style: 'white-space:nowrap' }, l.promoApplied ? h('s', { class: 'hint' }, format(l.regular)) : null, ' ', format(l.effective)))),
      r.missing.length ? h('p', { class: 'hint' }, 'לא נמצאו בסניף: ' + r.missing.map((m) => m.name).join(', ')) : null,
      h('p', { class: 'hint' }, `מחירים נכונים ל-${when(b.pricesPublishedAt)} · ${b.source || ''}`));
    return h('div', { class: 'card glass' + (r.coverage >= 0.6 ? '' : ' muted') },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', null, h('b', null, bname(b)), h('div', { class: 'hint' }, [b.address, b.city].filter(Boolean).join(', '))),
        h('div', { style: 'text-align:left' }, h('b', null, format(r.commonTotal)), h('div', { class: 'hint' }, `נמצאו ${r.lines.length}/${c.itemCount} · כולם: ${format(r.total)}`))),
      r.similar ? h('span', { class: 'badge' }, `≈ ${r.similar} מוצרים דומים (לא זהים)`) : null,
      r.promoSavings > 0 ? h('span', { class: 'badge' }, `מבצעים: −${format(r.promoSavings)}`) : null,
      r.coverage < 0.6 ? h('span', { class: 'badge warn' }, 'חסרים מוצרים רבים') : null,
      h('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
        h('button', { class: 'btn sm ghost', onclick: (e) => { const open = det.style.display === 'none'; det.style.display = open ? '' : 'none'; e.target.textContent = open ? 'הסתרה' : 'פירוט'; } }, 'פירוט'),
        h('a', { class: 'btn sm ghost', href: nav.waze, target: '_blank', rel: 'noopener' }, 'Waze'),
        h('a', { class: 'btn sm ghost', href: nav.google, target: '_blank', rel: 'noopener' }, 'מפות')),
      det);
  }

  function perItem(c, okB) {
    const th = (t, extra = '') => h('th', { style: 'padding:6px;text-align:right;font-size:12px;vertical-align:bottom;' + extra }, t);
    const rows = c.perItem.map((p) => h('tr', { style: 'border-top:1px solid var(--brd)' },
      h('td', { style: 'padding:6px;font-weight:600;position:sticky;right:0;background:var(--card2,var(--card));min-width:90px' }, p.item.name,
        p.item.qty && p.item.qty !== 1 ? h('div', { class: 'hint' }, formatQty(p.item.qty, p.item.unit)) : null),
      okB.map((b) => {
        const x = p.cells[b.id];
        if (!x) return h('td', { class: 'hint', style: 'padding:6px;text-align:center' }, '—');
        const win = p.cheapest === b.id && p.foundIn > 1;
        return h('td', { style: 'padding:6px;vertical-align:top;min-width:96px' + (win ? ';background:rgba(34,197,94,.14);border-radius:8px' : '') },
          h('div', { style: 'white-space:nowrap' + (win ? ';font-weight:800' : '') }, (x.similar ? '≈ ' : '') + format(x.effective), x.promoApplied ? ' 🏷️' : ''),
          h('div', { class: 'hint', style: 'font-size:11px;line-height:1.25' }, x.row.name + (x.approx ? ' · כמות משוערת' : '')));
      })));
    const foot = h('tr', { style: 'border-top:2px solid var(--brd)' }, h('td', { style: 'padding:6px;font-weight:700;position:sticky;right:0;background:var(--card2,var(--card))' }, `סה״כ (${c.commonCount} משותפים)`),
      okB.map((b) => { const r = c.perBranch.find((x) => x.branch.id === b.id); return h('td', { style: 'padding:6px;font-weight:700' + (c.best.branch.id === b.id ? ';color:var(--accent)' : '') }, format(r.commonTotal)); }));
    return [h('div', { class: 'card glass', style: 'padding:6px' },
      h('p', { class: 'hint', style: 'margin:4px 6px' }, 'ירוק = הכי זול לאותו מוצר · ≈ = מוצר דומה, לא זהה · 🏷️ = כולל מבצע · — = לא נמצא בסניף'),
      h('div', { style: 'overflow-x:auto;-webkit-overflow-scrolling:touch' },
        h('table', { style: 'border-collapse:collapse;width:100%;font-size:13px' },
          h('thead', null, h('tr', null, th('מוצר', 'position:sticky;right:0;background:var(--card2,var(--card))'), okB.map((b) => th(bname(b))))),
          h('tbody', null, rows, foot))))];
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
