// SmartCart v2 — app shell: auth, household, lists, shopping mode, family. Hebrew RTL, mobile first.
import { h, $, mount, toast, openSheet, closeSheet, confirmSheet } from './dom.js';
import { onUser, loginGoogle, signUpEmail, loginEmail, resetPassword, logout, authError, auth } from '../data/fb.js';
import * as R from '../data/repo.js';
import { CATEGORIES, guessCategory, migrateCategory, allCategories, norm } from '../core/categorize.js';
import { parseQty, formatQty, UNITS, lineTotal } from '../core/units.js';
import { toAgorot, format, sum } from '../core/money.js';
import { search } from '../core/search.js';
import * as BUD from '../core/budget.js';
import { openScanner } from './scanner.js';
import { lookupBarcode, saveProduct } from '../data/products.js';

const S = { frame: null, user: undefined, profile: null, hid: null, household: null, members: [], lists: [], items: [], trips: [], budgets: [], lid: null, catFilter: null, showArchived: false };
const subs = { members: null, lists: null, items: null, activity: null, trips: null, budgets: null };
const stop = (k) => { if (subs[k]) { subs[k](); subs[k] = null; } };
const stopAll = () => Object.keys(subs).forEach(stop);
const ICONS = ['🛒', '🧺', '🏠', '🎉', '🥗', '💊', '👶', '🐾', '🏖️', '🎁', '🧽', '🍕'];
const cat = (id) => allCategories(S.profile?.prefs?.customCats || []).find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
const meIsAdmin = () => S.members.find((m) => m.id === S.user?.uid)?.role === 'admin';
const permErr = (e) => { console.warn(e); toast(e?.code === 'permission-denied' ? 'אין הרשאה לפעולה הזו' : 'שגיאה, נסה שוב'); };

/* ---------------- theme ---------------- */
const theme = () => { try { return localStorage.getItem('sc.theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme() { document.documentElement.setAttribute('data-theme', theme() === 'auto' ? '' : theme()); }
applyTheme();

/* ---------------- routing ---------------- */
const route = () => (location.hash.replace(/^#\/?/, '') || 'lists').split('/');
window.addEventListener('hashchange', () => { closeSheet(); const [r0, r1, r2] = route(); if (r0 === 'join' && r1 && r2 && S.user) return doJoin(r1, r2); render(); });
const go = (r) => { location.hash = '#/' + r; };

/* ---------------- auth ---------------- */
onUser(async (u) => {
  S.user = u; stopAll();
  if (!u) { S.profile = null; S.hid = null; return render(); }
  try { S.profile = await R.loadProfile(); } catch (e) { S.profile = { households: [] }; }
  R.setMyName(S.profile?.displayName);
  const [r0, r1, r2] = route();
  if (r0 === 'join' && r1 && r2) return doJoin(r1, r2);
  await selectHousehold(S.profile?.defaultHousehold || S.profile?.households?.[0]?.id || null);
});

async function selectHousehold(hid) {
  stopAll(); S.hid = hid; S.household = null; S.members = []; S.lists = []; S.trips = []; S.budgets = [];
  if (hid) {
    try { S.household = await R.getHousehold(hid); } catch (e) { S.household = null; }
    if (!S.household) { await R.forgetHousehold(hid).catch(() => {}); S.hid = null; }
    else {
      subs.members = R.watchMembers(hid, (m) => { S.members = m; if (!m.some((x) => x.id === S.user.uid)) lostAccess(); else rerenderIf('family'); }, () => lostAccess());
      subs.lists = R.watchLists(hid, (l) => { S.lists = l; rerenderIf('lists'); }, permErr);
      subs.trips = R.watchTrips(hid, (t) => { S.trips = t; rerenderIf('budget', 'history', 'lists'); }, permErr);
      subs.budgets = R.watchBudgets(hid, (b) => { S.budgets = b; rerenderIf('budget', 'lists'); }, permErr);
    }
  }
  render();
}
function lostAccess() { toast('אין לך יותר גישה למשק הבית הזה'); R.forgetHousehold(S.hid).catch(() => {}); selectHousehold(null); }
const rerenderIf = (...views) => { if (views.includes(route()[0]) || (views.includes('lists') && !location.hash)) render(); };

async function doJoin(hid, code) {
  try {
    const hh = await R.joinHousehold(hid, code);
    toast('הצטרפת ל"' + (hh?.name || 'משק הבית') + '" ✓');
    S.profile = await R.loadProfile();
    history.replaceState(null, '', location.pathname + '#/lists');
    await selectHousehold(hid);
  } catch (e) {
    console.warn(e);
    toast('ההזמנה לא תקפה (פגה, בוטלה או שגויה). בקש קישור חדש');
    history.replaceState(null, '', location.pathname + '#/lists');
    await selectHousehold(S.profile?.defaultHousehold || null);
  }
}

/* ---------------- render ---------------- */
function render() {
  if (S.user === null) { S.frame = null; return mount(viewLogin()); }
  if (!S.user) return;                       // auth state not known yet → keep the loading screen
  if (!S.hid) return mount(shell('בית', viewOnboarding()));
  const [r, a] = route();
  if (r === 'list' && a) return viewList(a, false);
  if (r === 'shop' && a) return viewList(a, true);
  S.frame = null; releaseAwake();
  if (r === 'family') return mount(shell('משפחה', viewFamily()));
  if (r === 'budget') return mount(shell('תקציב', viewBudget()));
  if (r === 'history') return mount(shell('היסטוריה', viewHistory()));
  if (r === 'settings') return mount(shell('הגדרות', viewSettings()));
  return mount(shell('רשימות', viewLists()));
}

function shell(title, body, { back, sub, actions } = {}) {
  const tab = (id, e, label) => h('button', { class: 'tab' + (route()[0] === id || (id === 'lists' && ['list', 'shop'].includes(route()[0])) ? ' on' : ''), onclick: () => go(id), 'aria-label': label }, h('span', { class: 'e' }, e), label);
  return h('div', { class: 'app' },
    h('header', { class: 'top' },
      back ? h('button', { class: 'icon-btn', onclick: () => go(back), 'aria-label': 'חזרה' }, '→') : h('div', { class: 'logo', 'aria-hidden': 'true' }, 'S'),
      h('div', { class: 'ttl' }, title, h('small', null, sub || S.household?.name || 'SmartCart')),
      actions || null),
    h('main', { class: 'wrap' }, body),
    S.hid ? h('nav', { class: 'tabbar glass', 'aria-label': 'ניווט' }, tab('lists', '🛒', 'רשימות'), tab('budget', '💰', 'תקציב'), tab('history', '🧾', 'היסטוריה'), tab('family', '👨‍👩‍👧', 'משפחה'), tab('settings', '⚙️', 'הגדרות')) : null);
}

/* ---------------- login ---------------- */
function viewLogin() {
  let mode = 'in';
  const err = h('div', { class: 'err', role: 'alert' });
  const name = h('input', { class: 'input', placeholder: 'השם שלך', autocomplete: 'name' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'מייל', autocomplete: 'email', dir: 'ltr' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'סיסמה (6 תווים לפחות)', autocomplete: 'current-password', dir: 'ltr' });
  const nameField = h('div', { class: 'field', style: 'display:none' }, name);
  const submit = h('button', { class: 'btn block', onclick: async () => {
    err.textContent = ''; submit.disabled = true;
    try { mode === 'in' ? await loginEmail(email.value.trim(), pass.value) : await signUpEmail(name.value.trim(), email.value.trim(), pass.value); }
    catch (e) { err.textContent = authError(e); } finally { submit.disabled = false; }
  } }, 'כניסה');
  const toggle = h('button', { class: 'btn ghost block', style: 'margin-top:8px', onclick: () => {
    mode = mode === 'in' ? 'up' : 'in';
    nameField.style.display = mode === 'up' ? '' : 'none';
    submit.textContent = mode === 'in' ? 'כניסה' : 'הרשמה';
    toggle.textContent = mode === 'in' ? 'אין לי חשבון, להרשמה' : 'יש לי חשבון, לכניסה';
    pass.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
  } }, 'אין לי חשבון, להרשמה');
  const forgot = h('button', { class: 'btn ghost sm', style: 'margin-top:10px', onclick: async () => {
    if (!email.value.trim()) { err.textContent = 'כתוב את המייל ואז לחץ שוב'; return; }
    try { await resetPassword(email.value.trim()); toast('נשלח מייל לאיפוס סיסמה'); } catch (e) { err.textContent = authError(e); }
  } }, 'שכחתי סיסמה');
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); });
  return h('div', { class: 'auth' },
    h('div', { style: 'text-align:center;margin-bottom:18px' }, h('div', { class: 'logo', style: 'width:56px;height:56px;margin:0 auto 10px;font-size:26px;border-radius:16px' }, 'S'),
      h('h2', { style: 'margin:0' }, 'SmartCart'), h('div', { class: 'hint' }, 'רשימות קניות משפחתיות, מסונכרנות בכל המכשירים')),
    h('div', { class: 'card glass' },
      h('button', { class: 'btn ghost block', onclick: async () => { err.textContent = ''; try { await loginGoogle(); } catch (e) { err.textContent = authError(e); } } }, 'כניסה עם Google'),
      h('div', { class: 'sep' }, 'או'),
      nameField, h('div', { class: 'field' }, email), h('div', { class: 'field' }, pass), err, submit, toggle, forgot),
    route()[0] === 'join' ? h('p', { class: 'hint', style: 'text-align:center' }, 'התחבר כדי להצטרף למשק הבית שהזמין אותך') : null);
}

/* ---------------- onboarding ---------------- */
function v1State() { try { const s = JSON.parse(localStorage.getItem('shoplist.v1')); return s?.lists?.some((l) => l.items?.length) ? s : null; } catch { return null; } }
function viewOnboarding() {
  const name = h('input', { class: 'input', placeholder: 'למשל: הבית שלנו', value: 'הבית שלנו' });
  return h('div', null,
    h('h2', null, 'ברוך הבא' + (S.user.displayName ? ', ' + S.user.displayName : '')),
    h('div', { class: 'card glass' }, h('b', null, 'יצירת משק בית'), h('p', { class: 'hint' }, 'משק בית מאגד את הרשימות של כל בני המשפחה. אחר כך אפשר להזמין אותם בקישור.'),
      h('div', { class: 'field' }, name),
      h('button', { class: 'btn block', onclick: async (e) => { e.target.disabled = true; try { const hid = await R.createHousehold(name.value.trim() || 'הבית שלנו'); S.profile = await R.loadProfile(); await selectHousehold(hid); if (v1State()) offerImport(); } catch (x) { permErr(x); e.target.disabled = false; } } }, 'יצירה')),
    h('div', { class: 'card glass' }, h('b', null, 'קיבלת הזמנה?'), h('p', { class: 'hint' }, 'פתח את קישור ההזמנה ששלחו לך, ותצורף אוטומטית.')));
}
function offerImport() {
  const s = v1State(); if (!s) return;
  const n = s.lists.reduce((a, l) => a + (l.items?.length || 0), 0);
  openSheet('להעביר את הרשימות מ"סל"?', h('p', { class: 'hint' }, `נמצאו במכשיר הזה ${s.lists.length} רשימות עם ${n} פריטים מהגרסה הקודמת. הן יועתקו למשק הבית. הגרסה הקודמת לא נמחקת וממשיכה לעבוד.`),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn ghost block', onclick: closeSheet }, 'לא עכשיו'),
      h('button', { class: 'btn block', onclick: async (e) => { e.target.disabled = true; try { const r = await R.importFromV1(S.hid, s, { migrateCategory, parseQty }); closeSheet(); toast(`הועברו ${r.nLists} רשימות ו-${r.nItems} פריטים ✓`); } catch (x) { permErr(x); e.target.disabled = false; } } }, 'העברה')));
}

/* ---------------- lists ---------------- */
function viewLists() {
  const vis = S.lists.filter((l) => !!l.archived === S.showArchived);
  const alerts = BUD.budgetStatus(S.budgets, S.trips).filter((b) => b.state !== 'ok');
  const wrap = h('div', null,
    alerts.map((b) => h('div', { class: 'card glass', role: 'alert', style: 'border-color:' + (b.state === 'over' ? 'var(--red)' : 'var(--amber)'), onclick: () => go('budget') },
      h('b', null, b.state === 'over' ? '⚠️ חריגה מהתקציב' : '⚠️ קרוב לתקציב'), ' ',
      h('span', { class: 'hint' }, `${b.cat ? cat(b.cat).name + ' · ' : ''}${b.period === 'week' ? 'השבוע' : 'החודש'}: ${format(b.spent)} מתוך ${format(b.amount)} (${b.pct}%)`))),
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, S.showArchived ? 'ארכיון' : 'הרשימות שלנו'),
      h('button', { class: 'btn ghost sm', onclick: () => { S.showArchived = !S.showArchived; render(); } }, S.showArchived ? 'לרשימות הפעילות' : 'ארכיון')));
  if (!vis.length) wrap.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, S.showArchived ? '🗄️' : '📝'), S.showArchived ? 'אין רשימות בארכיון.' : 'אין עדיין רשימות. צור את הראשונה.'));
  for (const l of vis) wrap.append(h('div', { class: 'lcard glass', role: 'button', tabindex: '0', onclick: () => go('list/' + l.id), onkeydown: (e) => { if (e.key === 'Enter') go('list/' + l.id); } },
    h('div', { class: 'ic' }, l.icon || '🛒'), h('div', { class: 'info' }, h('b', null, l.name)),
    h('button', { class: 'icon-btn', 'aria-label': 'אפשרויות רשימה', onclick: (e) => { e.stopPropagation(); listMenu(l); } }, '⋯')));
  if (!S.showArchived) wrap.append(h('button', { class: 'btn block', style: 'margin-top:6px', onclick: () => editListSheet() }, '+ רשימה חדשה'));
  if (v1State() && !S.showArchived) wrap.append(h('button', { class: 'btn ghost block', style: 'margin-top:8px', onclick: offerImport }, 'העברת רשימות מ"סל" (הגרסה הקודמת)'));
  return wrap;
}
function editListSheet(l) {
  let icon = l?.icon || '🛒';
  const name = h('input', { class: 'input', value: l?.name || '', placeholder: 'סופר שבועי / פארם / מסיבה', maxlength: '60' });
  const icons = h('div', { class: 'chips', style: 'flex-wrap:wrap' }, ICONS.map((ic) => h('button', { class: 'chip' + (ic === icon ? ' on' : ''), 'aria-label': 'אייקון ' + ic, onclick: (e) => { icon = ic; icons.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget)); } }, ic)));
  openSheet(l ? 'עריכת רשימה' : 'רשימה חדשה', h('div', { class: 'field' }, h('label', null, 'שם'), name), h('div', { class: 'field' }, h('label', null, 'אייקון'), icons),
    h('button', { class: 'btn block', onclick: async () => {
      const n = name.value.trim(); if (!n) return toast('צריך שם');
      try { if (l) await R.updateList(S.hid, l.id, { name: n, icon }); else { const id = await R.createList(S.hid, { name: n, icon }); closeSheet(); return go('list/' + id); } closeSheet(); } catch (e) { permErr(e); }
    } }, 'שמירה'));
}
function listMenu(l) {
  openSheet(l.name,
    h('button', { class: 'btn ghost block', onclick: () => editListSheet(l) }, 'שינוי שם / אייקון'),
    h('button', { class: 'btn ghost block', style: 'margin-top:8px', onclick: async () => { closeSheet(); try { const id = await R.duplicateList(S.hid, l.id, l.name + ' (עותק)'); toast('הרשימה שוכפלה ✓'); go('list/' + id); } catch (e) { permErr(e); } } }, 'שכפול'),
    h('button', { class: 'btn ghost block', style: 'margin-top:8px', onclick: () => { closeSheet(); R.updateList(S.hid, l.id, { archived: !l.archived }).then(() => toast(l.archived ? 'הוחזרה מהארכיון' : 'הועברה לארכיון')).catch(permErr); } }, l.archived ? 'החזרה מהארכיון' : 'העברה לארכיון'),
    h('button', { class: 'btn danger block', style: 'margin-top:8px', onclick: () => confirmSheet('למחוק את "' + l.name + '"?', 'הרשימה וכל הפריטים בה יימחקו לכל בני המשפחה. אי אפשר לבטל.', 'מחיקה', () => R.deleteList(S.hid, l.id, l.name).then(() => toast('נמחקה')).catch(permErr)) }, 'מחיקה'));
}

/* ---------------- list + shopping mode ---------------- */
function viewList(lid, shopping) {
  if (S.lid !== lid) { stop('items'); S.lid = lid; S.items = []; S.catFilter = null; subs.items = R.watchItems(S.hid, lid, (it) => { S.items = it; if (['list', 'shop'].includes(route()[0])) paintList(); }, permErr); }
  if (!S.frame || S.frame.lid !== lid || S.frame.shopping !== shopping) {
    const body = h('div', { class: shopping ? 'shop' : '' });
    const actions = shopping ? h('button', { class: 'btn sm', onclick: () => go('list/' + lid) }, 'יציאה') : h('button', { class: 'icon-btn', 'aria-label': 'אפשרויות', onclick: () => { const l = S.lists.find((x) => x.id === lid); if (l) listMenu(l); } }, '⋯');
    const node = h('div', null, shell('', body, { back: shopping ? 'list/' + lid : 'lists', actions }), shopping ? null : addBar(lid));
    mount(node);
    S.frame = { lid, shopping, body, ttl: node.querySelector('.ttl') };
  }
  paintList();
  if (shopping) keepAwake(); else releaseAwake();
}
function paintList() {
  const [r, lid] = route(); const shopping = r === 'shop';
  if (!S.frame || S.frame.lid !== lid) return;
  const l = S.lists.find((x) => x.id === lid);
  if (!l && S.lists.length) return go('lists');
  const items = [...S.items].sort((a, b) => (a.done - b.done) || cat(a.cat).order - cat(b.cat).order || (a.order ?? 0) - (b.order ?? 0));
  const done = items.filter((i) => i.done).length, total = items.length, pct = total ? Math.round((done / total) * 100) : 0;
  const est = sum(items.map((i) => lineTotal(i.priceEst ?? null, i.qty ?? 1)).filter((x) => x !== null));
  const inCart = sum(items.filter((i) => i.done).map((i) => lineTotal(i.priceEst ?? null, i.qty ?? 1)).filter((x) => x !== null));
  const priced = items.filter((i) => i.priceEst != null).length;
  const body = document.createDocumentFragment();

  body.append(h('div', { class: 'prog glass' },
    h('div', { style: 'flex:1' },
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('b', null, `${done} מתוך ${total} · ${pct}%`), h('span', { class: 'hint' }, total - done ? `נותרו ${total - done}` : total ? 'הכל נאסף ✓' : '')),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${pct}%` })),
      priced ? h('div', { class: 'hint', style: 'margin-top:6px' }, shopping ? `בעגלה: ${format(inCart)} · משוער לכל הרשימה: ${format(est)}` : `עלות משוערת: ${format(est)}`, priced < total ? ` (מחיר ל-${priced} מתוך ${total})` : '') : null),
    shopping ? null : h('button', { class: 'btn sm', onclick: () => go('shop/' + lid) }, 'מצב קנייה')));

  if (shopping) {
    const cats = [...new Set(items.filter((i) => !i.done).map((i) => i.cat || 'other'))];
    if (cats.length > 1) body.append(h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'סינון לפי מחלקה' },
      h('button', { class: 'chip' + (!S.catFilter ? ' on' : ''), onclick: () => { S.catFilter = null; paintList(); } }, 'הכל'),
      cats.map((c) => h('button', { class: 'chip' + (S.catFilter === c ? ' on' : ''), onclick: () => { S.catFilter = c; paintList(); } }, cat(c).em + ' ' + cat(c).name))));
  }
  const shown = shopping && S.catFilter ? items.filter((i) => (i.cat || 'other') === S.catFilter || i.done) : items;
  if (!total) body.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🧺'), 'הרשימה ריקה. הוסף פריט למטה.'));
  let lastCat = null;
  for (const it of shown) {
    const c = it.done ? '__done' : (it.cat || 'other');
    if (c !== lastCat) { lastCat = c; body.append(h('div', { class: 'cat-h' }, c === '__done' ? '✓ נאספו' : `${cat(c).em} ${cat(c).name}`)); }
    const lt = lineTotal(it.priceEst ?? null, it.qty ?? 1);
    const who = it.done && it.checkedByName ? `סימן/ה: ${it.checkedByName}` : it.addedByName ? `הוסיף/ה: ${it.addedByName}` : '';
    body.append(h('div', { class: 'item glass' + (it.done ? ' done' : '') + (it._pending ? ' pending' : '') },
      h('button', { class: 'cb', 'aria-label': (it.done ? 'בטל סימון ' : 'סמן ') + it.name, 'aria-pressed': it.done ? 'true' : 'false', onclick: () => R.setDone(S.hid, lid, it.id, !it.done, it.name) }, it.done ? '✓' : ''),
      h('div', { class: 'nm', onclick: () => shopping ? R.setDone(S.hid, lid, it.id, !it.done, it.name) : editItemSheet(it) },
        h('b', null, it.name), h('div', { class: 'meta' }, [formatQty(it.qty, it.unit) || it.raw, it.note, who].filter(Boolean).join(' · '))),
      lt !== null ? h('span', { class: 'px' }, format(lt)) : null,
      shopping ? null : h('button', { class: 'icon-btn', 'aria-label': 'עריכת ' + it.name, onclick: () => editItemSheet(it) }, '✎')));
  }
  if (done && !shopping) body.append(h('button', { class: 'btn ghost block', style: 'margin-top:8px', onclick: () => confirmSheet('לנקות את מה שנאסף?', `${done} פריטים יוסרו מהרשימה.`, 'ניקוי', () => R.clearDone(S.hid, lid, S.items).catch(permErr)) }, 'ניקוי פריטים שנאספו'));
  if (shopping && done) body.append(h('button', { class: 'btn block', style: 'margin-top:12px', onclick: () => finishShopping(lid, l, items, inCart, priced) }, '✓ סיום קנייה ושמירת ההוצאה'));
  if (shopping && total && done === total) body.append(h('div', { class: 'card glass', style: 'text-align:center;margin-top:10px' }, h('div', { class: 'total' }, '🎉 סיימת!'), priced ? h('div', { class: 'hint' }, 'סה״כ משוער: ' + format(inCart)) : null));

  S.frame.body.replaceChildren(body);
  S.frame.ttl.replaceChildren((l?.icon || '🛒') + ' ' + (l?.name || 'רשימה'), h('small', null, shopping ? 'מצב קנייה · ' + pct + '%' : `${total - done} נותרו · ${total} פריטים`));
}

function addBar(lid) {
  const name = h('input', { placeholder: 'מה צריך לקנות?', autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'שם מוצר', maxlength: '120' });
  const qty = h('input', { class: 'qty', placeholder: 'כמות', 'aria-label': 'כמות', maxlength: '30' });
  const prev = h('div', { class: 'preview', 'aria-live': 'polite' });
  const sugg = h('div', { class: 'chips' });
  const history = () => { const seen = new Map(); for (const i of S.items) seen.set(i.name, { id: i.name, name: i.name }); for (const n of S.profile?.prefs?.history || []) if (!seen.has(n)) seen.set(n, { id: n, name: n }); return [...seen.values()]; };
  const upd = () => {
    const n = name.value.trim(); const q = parseQty(qty.value);
    prev.textContent = n ? `${cat(guessCategory(n, learnOpts())).em} ${cat(guessCategory(n, learnOpts())).name}${q.qty ? ' · ' + (formatQty(q.qty, q.unit) || '1') : ''}` : '';
    sugg.replaceChildren(...(n.length >= 2 ? search(n, history(), { limit: 6 }).filter((x) => x.name !== n) : []).map((x) => h('button', { class: 'chip', onclick: () => { name.value = x.name; upd(); name.focus(); } }, x.name)));
  };
  const add = () => {
    const n = name.value.trim(); if (!n) return name.focus();
    const q = parseQty(qty.value);
    R.addItem(S.hid, lid, { name: n, qty: q.qty ?? 1, unit: q.unit, raw: q.qty === null ? qty.value.trim() : undefined, cat: guessCategory(n, learnOpts()) });
    rememberName(n);
    name.value = ''; qty.value = ''; upd(); name.focus();
  };
  name.addEventListener('input', upd); qty.addEventListener('input', upd);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  const scan = h('button', { class: 'icon-btn', 'aria-label': 'סריקת ברקוד', onclick: () => openScanner((code) => addByBarcode(lid, code)) }, '📷');
  return h('div', { class: 'addbar' }, h('div', { class: 'addbox glass' }, sugg, h('div', { class: 'row' }, scan, name, qty, h('button', { class: 'go', onclick: add, 'aria-label': 'הוספה' }, '+')), prev));
}
const learnOpts = () => ({ learned: S.profile?.prefs?.learned || {}, custom: S.profile?.prefs?.customCats || [] });
let histTimer = null;
function rememberName(n) {
  const p = S.profile || (S.profile = {}); p.prefs = p.prefs || {};
  p.prefs.history = [n, ...(p.prefs.history || []).filter((x) => x !== n)].slice(0, 200);
  clearTimeout(histTimer); histTimer = setTimeout(() => R.saveProfile({ prefs: p.prefs }).catch(() => {}), 1500);
}

function editItemSheet(it) {
  const lid = S.lid;
  const name = h('input', { class: 'input', value: it.name, maxlength: '120' });
  const qty = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: it.qty ?? '' });
  const unit = h('select', { class: 'input' }, Object.entries(UNITS).map(([k, u]) => h('option', { value: k, selected: (it.unit || 'unit') === k }, u.he)));
  const price = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'למשל 12.90', value: it.priceEst != null ? (it.priceEst / 100).toFixed(2) : '' });
  const note = h('input', { class: 'input', value: it.note || '', maxlength: '300', placeholder: 'מותג, טעם, גודל…' });
  const catSel = h('select', { class: 'input' }, allCategories(S.profile?.prefs?.customCats || []).map((c) => h('option', { value: c.id, selected: (it.cat || 'other') === c.id }, c.em + ' ' + c.name)));
  openSheet('עריכת פריט',
    h('div', { class: 'field' }, h('label', null, 'שם'), name),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'כמות'), qty), h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'יחידה'), unit)),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'מחיר משוער ליחידה (₪)'), price), h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'מחלקה'), catSel)),
    h('div', { class: 'field' }, h('label', null, 'הערה'), note),
    h('p', { class: 'hint' }, 'המחיר הוא הערכה שלך. מחירי רשתות אמיתיים יגיעו בהמשך עם מקור ותאריך.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: () => { closeSheet(); R.deleteItem(S.hid, lid, it.id).catch(permErr); } }, 'מחיקה'),
      h('button', { class: 'btn block', onclick: () => {
        const n = name.value.trim(); if (!n) return toast('צריך שם');
        const p = price.value.trim() ? toAgorot(price.value) : null;
        if (price.value.trim() && p === null) return toast('מחיר לא תקין');
        const q = qty.value === '' ? null : Number(qty.value);
        if (q !== null && !(q >= 0)) return toast('כמות לא תקינה');
        if (catSel.value !== (it.cat || 'other')) { const pr = S.profile.prefs = S.profile.prefs || {}; pr.learned = { ...(pr.learned || {}), [norm(n)]: catSel.value }; R.saveProfile({ prefs: pr }).catch(() => {}); }
        R.updateItem(S.hid, lid, it.id, { name: n, qty: q, unit: unit.value, priceEst: p, note: note.value.trim() || null, cat: catSel.value }).catch(permErr);
        closeSheet();
      } }, 'שמירה')));
}

let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {} }
function releaseAwake() { if (wake) { wake.release().catch(() => {}); wake = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && route()[0] === 'shop') keepAwake(); });

/* ---------------- family ---------------- */
function viewFamily() {
  const admin = meIsAdmin();
  const box = h('div', null, h('h2', null, 'משק הבית: ' + (S.household?.name || '')));
  const mem = h('div', { class: 'card glass' }, h('b', null, `חברים (${S.members.length})`));
  for (const m of S.members) {
    const isMe = m.id === S.user.uid;
    mem.append(h('div', { class: 'row', style: 'padding:8px 0;border-bottom:1px solid var(--line)' },
      h('div', { style: 'flex:1' }, m.displayName || 'משתמש', isMe ? ' (אני)' : '', ' ', h('span', { class: 'badge' + (m.role === 'admin' ? '' : ' warn') }, m.role === 'admin' ? 'מנהל' : 'חבר')),
      admin && !isMe ? h('button', { class: 'btn ghost sm', onclick: () => R.setRole(S.hid, m.id, m.role === 'admin' ? 'member' : 'admin').catch(permErr) }, m.role === 'admin' ? 'הפוך לחבר' : 'הפוך למנהל') : null,
      admin && !isMe ? h('button', { class: 'btn ghost sm', style: 'color:var(--red)', onclick: () => confirmSheet('להסיר את ' + (m.displayName || 'המשתמש') + '?', 'הוא יאבד גישה לכל הרשימות של משק הבית.', 'הסרה', () => R.removeMember(S.hid, m.id).then(() => toast('הוסר')).catch(permErr)) }, 'הסרה') : null));
  }
  box.append(mem);
  if (admin) {
    const inv = h('div', { class: 'card glass' }, h('b', null, 'הזמנת בני משפחה'), h('p', { class: 'hint' }, 'קישור אישי שתקף ל-7 ימים. מי שפותח אותו ונכנס לחשבון מצטרף כחבר. אפשר לבטל בכל רגע.'));
    const list = h('div');
    inv.append(h('button', { class: 'btn block', onclick: async () => {
      try {
        const code = await R.createInvite(S.hid);
        const link = location.origin + location.pathname + '#/join/' + S.hid + '/' + code;
        const msg = `הוזמנת להצטרף ל"${S.household?.name}" ב-SmartCart, רשימות הקניות של המשפחה:\n${link}`;
        openSheet('קישור הזמנה', h('p', { class: 'hint' }, 'תקף ל-7 ימים. שלח רק לבני הבית.'),
          h('div', { class: 'input', dir: 'ltr', style: 'word-break:break-all;font-size:12px' }, link),
          h('div', { class: 'row', style: 'margin-top:10px' },
            h('a', { class: 'btn block', style: 'text-align:center;text-decoration:none', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(msg) }, 'וואטסאפ'),
            h('button', { class: 'btn ghost block', onclick: () => { navigator.clipboard?.writeText(link); toast('הקישור הועתק ✓'); } }, 'העתקה')));
      } catch (e) { permErr(e); }
    } }, '+ קישור הזמנה חדש'), list);
    stop('invites');
    subs.invites = R.watchInvites(S.hid, (all) => {
      const now = Date.now();
      const act = all.filter((i) => !i.revoked && i.expiresAt?.toMillis?.() > now);
      list.replaceChildren(...act.map((i) => h('div', { class: 'row', style: 'padding:6px 0' }, h('span', { class: 'hint', style: 'flex:1' }, 'הזמנה פעילה עד ' + new Date(i.expiresAt.toMillis()).toLocaleDateString('he-IL')),
        h('button', { class: 'btn ghost sm', onclick: () => R.revokeInvite(S.hid, i.id).then(() => toast('ההזמנה בוטלה')).catch(permErr) }, 'ביטול'))));
    }, () => {});
    box.append(inv);
  }
  const feed = h('div', { class: 'feed' }, h('div', { class: 'hint' }, 'טוען…'));
  stop('activity');
  subs.activity = R.watchActivity(S.hid, (ev) => {
    const T = { 'item.add': 'הוסיף/ה', 'item.check': 'סימן/ה שנקנה', 'list.create': 'יצר/ה רשימה', 'list.delete': 'מחק/ה רשימה', 'member.join': 'הצטרף/ה', 'household.create': 'יצר/ה את משק הבית', 'import.v1': 'העביר/ה מ"סל"' };
    feed.replaceChildren(...(ev.length ? ev.map((e) => h('div', null, h('b', null, e.byName || 'מישהו'), ' ', T[e.type] || e.type, e.text ? ': ' + e.text : '', h('span', { class: 'muted' }, e.at?.toDate ? ' · ' + e.at.toDate().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : ''))) : [h('div', { class: 'hint' }, 'אין עדיין פעילות.')]));
  }, () => feed.replaceChildren(h('div', { class: 'hint' }, 'לא ניתן לטעון פעילות.')));
  box.append(h('div', { class: 'card glass' }, h('b', null, 'פעילות אחרונה'), feed));
  box.append(h('button', { class: 'btn ghost block', style: 'color:var(--red)', onclick: () => confirmSheet('לעזוב את משק הבית?', admin && S.members.filter((m) => m.role === 'admin').length === 1 ? 'אתה המנהל היחיד. מנה מנהל נוסף לפני העזיבה.' : 'תאבד גישה לרשימות של משק הבית.', 'עזיבה', async () => {
    if (admin && S.members.filter((m) => m.role === 'admin').length === 1 && S.members.length > 1) return toast('מנה קודם מנהל נוסף');
    try { await R.removeMember(S.hid, S.user.uid); await R.forgetHousehold(S.hid); S.profile = await R.loadProfile(); selectHousehold(S.profile?.defaultHousehold || null); } catch (e) { permErr(e); }
  }) }, 'עזיבת משק הבית'));
  return box;
}

/* ---------------- settings ---------------- */
function viewSettings() {
  const nm = h('input', { class: 'input', value: S.profile?.displayName || S.user.displayName || '', maxlength: '80' });
  const hhs = S.profile?.households || [];
  return h('div', null, h('h2', null, 'הגדרות'),
    h('div', { class: 'card glass' }, h('b', null, 'החשבון שלי'), h('div', { class: 'hint', dir: 'ltr', style: 'text-align:right' }, S.user.email || ''),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('label', null, 'שם תצוגה'), nm),
      h('button', { class: 'btn sm', onclick: () => R.saveProfile({ displayName: nm.value.trim() || 'משתמש' }).then(() => toast('נשמר ✓')).catch(permErr) }, 'שמירה')),
    h('div', { class: 'card glass' }, h('b', null, 'משק בית פעיל'),
      h('div', { class: 'chips', style: 'flex-wrap:wrap;margin-top:8px' }, hhs.map((x) => h('button', { class: 'chip' + (x.id === S.hid ? ' on' : ''), onclick: async () => { await R.saveProfile({ defaultHousehold: x.id }).catch(() => {}); S.profile.defaultHousehold = x.id; selectHousehold(x.id); } }, x.name))),
      h('button', { class: 'btn ghost sm', onclick: () => { const n = h('input', { class: 'input', placeholder: 'שם משק הבית' }); openSheet('משק בית נוסף', h('div', { class: 'field' }, n), h('button', { class: 'btn block', onclick: async () => { const id = await R.createHousehold(n.value.trim() || 'משק בית'); S.profile = await R.loadProfile(); closeSheet(); selectHousehold(id); } }, 'יצירה')); } }, '+ משק בית נוסף')),
    h('div', { class: 'card glass' }, h('b', null, 'תצוגה'), h('div', { class: 'chips', style: 'margin-top:8px' }, [['auto', 'אוטומטי'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, n]) => h('button', { class: 'chip' + (theme() === k ? ' on' : ''), onclick: () => { try { localStorage.setItem('sc.theme', k); } catch {} applyTheme(); render(); } }, n)))),
    v1State() ? h('div', { class: 'card glass' }, h('b', null, 'העברה מ"סל"'), h('p', { class: 'hint' }, 'מעתיק את הרשימות מהגרסה הקודמת במכשיר הזה. המקור לא נמחק.'), h('button', { class: 'btn sm', onclick: offerImport }, 'העברה')) : null,
    h('div', { class: 'card glass' }, h('b', null, 'בקרוב'), h('p', { class: 'hint' }, 'תקציב, סריקת ברקוד, חשבוניות, מלאי, מתכונים, עוזר AI והשוואת מחירים נבנים בשלבים. הם יופיעו כאן כשהם יעבדו באמת, לא לפני.')),
    h('button', { class: 'btn ghost block', onclick: () => confirmSheet('להתנתק?', 'הרשימות נשמרות בחשבון.', 'התנתקות', async () => { stopAll(); await logout(); }, false) }, 'התנתקות'),
    h('p', { class: 'muted', style: 'text-align:center;font-size:12px;margin-top:14px' }, 'SmartCart v2 · ' + (navigator.onLine ? 'מחובר' : 'לא מקוון, השינויים יישמרו כשיחזור החיבור')));
}

window.addEventListener('online', () => toast('חזר החיבור, מסנכרן…'));
window.addEventListener('offline', () => toast('אין חיבור. אפשר להמשיך, הכל יישמר'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ================= Phase 4: finish shopping → expense + history ================= */
function finishShopping(lid, l, items, inCart, priced) {
  const store = h('input', { class: 'input', placeholder: 'למשל: שופרסל דיל רמת גן', maxlength: '80', value: S.profile?.prefs?.lastStore || '' });
  const total = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'הסכום מהקבלה', value: priced ? (inCart / 100).toFixed(2) : '' });
  const date = h('input', { class: 'input', type: 'date', value: new Date().toLocaleDateString('en-CA', { timeZone: BUD.TZ }) });
  const clear = h('input', { type: 'checkbox', checked: true, id: 'clr' });
  openSheet('סיום קנייה',
    h('p', { class: 'hint' }, `${items.filter((i) => i.done).length} פריטים נקנו.` + (priced ? ` לפי המחירים המשוערים: ${format(inCart)}.` : '')),
    h('div', { class: 'field' }, h('label', null, 'סכום ששולם בפועל (₪)'), total),
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2' }, h('label', null, 'איפה קנית'), store), h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'תאריך'), date)),
    h('label', { class: 'row hint', style: 'margin-bottom:12px' }, clear, 'להסיר מהרשימה את מה שנקנה'),
    h('button', { class: 'btn block', onclick: async (e) => {
      const t = total.value.trim() ? toAgorot(total.value) : null;
      if (total.value.trim() && (t === null || t < 0)) return toast('סכום לא תקין');
      e.target.disabled = true;
      try {
        const [yy, mm, dd] = date.value.split('-').map(Number);
        const at = yy ? new Date(Date.UTC(yy, mm - 1, dd, 10)) : new Date();     // midday UTC → the chosen day in Israel
        await R.addTrip(S.hid, { listId: lid, listName: l?.name, store: store.value.trim(), total: t, estTotal: priced ? inCart : null, items: BUD.tripItemsFromList(items), at });
        if (store.value.trim()) { const pr = S.profile.prefs = S.profile.prefs || {}; pr.lastStore = store.value.trim(); R.saveProfile({ prefs: pr }).catch(() => {}); }
        if (clear.checked) await R.clearDone(S.hid, lid, items);
        closeSheet(); toast('נשמר בהיסטוריה ובתקציב ✓'); go('list/' + lid);
      } catch (x) { permErr(x); e.target.disabled = false; }
    } }, 'שמירה'));
}

/* ================= Phase 5: add by barcode ================= */
async function addByBarcode(lid, code) {
  toast('מחפש מוצר…', 1200);
  const existing = S.items.find((i) => i.barcode === code && !i.done);
  if (existing) { R.updateItem(S.hid, lid, existing.id, { qty: (existing.qty || 1) + 1 }).catch(permErr); return toast(`${existing.name}: הכמות עודכנה ל-${(existing.qty || 1) + 1}`); }
  const p = await lookupBarcode(S.hid, code);
  const name = h('input', { class: 'input', value: p.found ? p.name : '', placeholder: 'שם המוצר', maxlength: '120' });
  const brand = h('input', { class: 'input', value: p.brand || '', placeholder: 'מותג (לא חובה)', maxlength: '80' });
  const qty = h('input', { class: 'input', type: 'number', min: '0', step: 'any', value: '1', inputmode: 'decimal' });
  const src = { household: 'הקטלוג של המשפחה', openfoodfacts: 'Open Food Facts (מאגר פתוח)', user: 'הוזן ידנית', scan: 'סריקה' }[p.source] || '';
  openSheet(p.found ? 'נמצא מוצר' : 'מוצר חדש',
    h('div', { class: 'row', style: 'margin-bottom:10px' },
      p.image ? h('img', { src: p.image, alt: '', width: '64', height: '64', style: 'border-radius:12px;object-fit:cover;background:#fff' }) : null,
      h('div', null, h('div', { class: 'hint', dir: 'ltr' }, code), p.found ? h('span', { class: 'badge' }, 'מקור: ' + src) : h('span', { class: 'badge warn' }, 'לא נמצא במאגרים, אפשר להוסיף'),
        p.size ? h('div', { class: 'hint' }, 'אריזה: ' + formatQty(p.size, p.sizeUnit)) : null)),
    h('div', { class: 'field' }, h('label', null, 'שם'), name), h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2' }, h('label', null, 'מותג'), brand), h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'כמות'), qty)),
    h('button', { class: 'btn block', onclick: async () => {
      const n = name.value.trim(); if (!n) return toast('צריך שם');
      const label = brand.value.trim() && !n.includes(brand.value.trim()) ? `${n} ${brand.value.trim()}` : n;
      R.addItem(S.hid, lid, { name: label, qty: Number(qty.value) || 1, unit: 'unit', cat: p.cat || guessCategory(n, learnOpts()), barcode: code });
      rememberName(label);
      saveProduct(S.hid, code, { name: n, brand: brand.value.trim() || null, size: p.size, sizeUnit: p.sizeUnit, cat: p.cat || guessCategory(n), image: p.image, source: p.found && n === p.name ? p.source : 'user' }).catch(() => {});
      closeSheet(); toast('נוסף ✓');
    } }, 'הוספה לרשימה'));
}

/* ================= Phase 4: budget screen ================= */
function svgBars(data, { height = 140 } = {}) {
  const NS = 'http://www.w3.org/2000/svg', W = 320, pad = 18, n = data.length, bw = (W - pad * 2) / n;
  const max = Math.max(1, ...data.map((d) => d.value));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${height + 34}`); svg.setAttribute('role', 'img'); svg.setAttribute('style', 'width:100%;height:auto;direction:ltr');
  svg.setAttribute('aria-label', data.map((d) => `${d.label}: ${format(d.value)}`).join(', '));
  const el = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); if (txt !== undefined) e.textContent = txt; svg.append(e); return e; };
  data.slice().reverse().forEach((d, i) => {   // RTL: newest on the left reads naturally right→left as time goes forward
    const x = pad + i * bw + bw * 0.18, w = bw * 0.64, hgt = Math.round((d.value / max) * height), y = height - hgt + 6;
    el('rect', { x, y, width: w, height: Math.max(hgt, d.value ? 2 : 0), rx: 5, fill: d.highlight ? 'var(--accent)' : 'var(--accent2)', opacity: d.highlight ? 1 : 0.55 });
    el('text', { x: x + w / 2, y: height + 22, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--txt2)' }, d.label);
    if (d.value) el('text', { x: x + w / 2, y: Math.max(y - 4, 10), 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--txt2)' }, Math.round(d.value / 100).toLocaleString('he-IL'));
  });
  return svg;
}
const HE_M = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
function viewBudget() {
  const now = new Date(), admin = meIsAdmin();
  const st = BUD.budgetStatus(S.budgets, S.trips, now);
  const box = h('div', null, h('h2', null, 'תקציב והוצאות'));
  if (!S.budgets.length) box.append(h('div', { class: 'card glass' }, h('b', null, 'עוד לא הוגדר תקציב'), h('p', { class: 'hint' }, admin ? 'הגדר תקציב חודשי או שבועי, ואפשר גם לפי מחלקה. תקבל התראה כשמתקרבים לגבול.' : 'מנהל משק הבית יכול להגדיר תקציב.')));
  for (const b of st) {
    const color = b.state === 'over' ? 'var(--red)' : b.state === 'warn' ? 'var(--amber)' : 'var(--accent)';
    box.append(h('div', { class: 'card glass' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, (b.cat ? cat(b.cat).em + ' ' + cat(b.cat).name : 'כל הקניות') + ' · ' + (b.period === 'week' ? 'השבוע' : 'החודש')),
        admin ? h('button', { class: 'btn ghost sm', onclick: () => budgetSheet(b) }, 'עריכה') : null),
      h('div', { class: 'row', style: 'justify-content:space-between;margin:6px 0' }, h('span', { class: 'total', style: 'font-size:22px;color:' + color }, format(b.spent)), h('span', { class: 'hint' }, 'מתוך ' + format(b.amount))),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, b.pct || 0)}%;background:${color}` })),
      h('div', { class: 'hint', style: 'margin-top:6px' }, b.left >= 0 ? `נשארו ${format(b.left)}` : `חריגה של ${format(-b.left)}`, b.projected !== null && b.state !== 'over' && b.projected > b.amount ? ` · בקצב הזה החודש ייסגר ב-${format(b.projected)}` : '')));
  }
  if (admin) box.append(h('button', { class: 'btn ghost block', style: 'margin-bottom:12px', onclick: () => budgetSheet() }, '+ תקציב'));
  if (!S.trips.length) { box.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '📊'), 'עוד אין הוצאות. בסוף קנייה לחץ "סיום קנייה", או הוסף הוצאה ידנית בהיסטוריה.')); return box; }
  const tr = BUD.trend(S.trips, now, 6);
  box.append(h('div', { class: 'card glass' }, h('b', null, 'הוצאות ב-6 החודשים האחרונים (₪)'),
    svgBars(tr.map((x, i) => ({ label: HE_M[+x.key.slice(5) - 1], value: x.total, highlight: i === tr.length - 1 })))));
  const keys = BUD.lastPeriods(now, 2), cmp = BUD.comparePeriods(S.trips, keys[0], keys[1]), avg = BUD.averages(S.trips);
  box.append(h('div', { class: 'card glass' }, h('b', null, 'השוואה וממוצעים'),
    h('div', { class: 'hint', style: 'margin-top:6px' }, `החודש: ${format(cmp.b)} · חודש שעבר: ${format(cmp.a)}` + (cmp.pct !== null ? ` · ${cmp.diff >= 0 ? '+' : ''}${cmp.pct}%` : '')),
    h('div', { class: 'hint' }, `ממוצע לחודש (חודשים עם הוצאות): ${format(avg.perPeriod)} · ממוצע לקנייה: ${format(avg.perTrip)} · ${avg.trips} קניות`)));
  const byCat = [...BUD.spendByCategory(S.trips, keys[1]).entries()].sort((a, b) => b[1] - a[1]);
  if (byCat.length) box.append(h('div', { class: 'card glass' }, h('b', null, 'החודש לפי מחלקה'),
    byCat.map(([c, v]) => h('div', { class: 'row', style: 'justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)' },
      h('span', null, c === 'unknown' ? '❔ לא מפורט (סכום קבלה בלי מחיר לפריט)' : cat(c).em + ' ' + cat(c).name), h('b', null, format(v))))));
  return box;
}
function budgetSheet(b) {
  const period = h('select', { class: 'input' }, h('option', { value: 'month', selected: !b || b.period === 'month' }, 'חודשי'), h('option', { value: 'week', selected: b?.period === 'week' }, 'שבועי'));
  const catSel = h('select', { class: 'input' }, h('option', { value: '' }, 'כל הקניות'), allCategories(S.profile?.prefs?.customCats || []).map((c) => h('option', { value: c.id, selected: b?.cat === c.id }, c.em + ' ' + c.name)));
  const amount = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'למשל 3000', value: b ? (b.amount / 100).toFixed(0) : '' });
  openSheet(b ? 'עריכת תקציב' : 'תקציב חדש',
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'תקופה'), period), h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'סכום (₪)'), amount)),
    h('div', { class: 'field' }, h('label', null, 'מחלקה'), catSel),
    h('div', { class: 'row' }, b ? h('button', { class: 'btn danger', onclick: () => { closeSheet(); R.deleteBudget(S.hid, b.id).catch(permErr); } }, 'מחיקה') : null,
      h('button', { class: 'btn block', onclick: () => {
        const a = toAgorot(amount.value); if (!a || a <= 0) return toast('סכום לא תקין');
        const id = b?.id || `${period.value}_${catSel.value || 'all'}`;
        R.setBudget(S.hid, id, { period: period.value, amount: a, cat: catSel.value || null }).then(() => toast('נשמר ✓')).catch(permErr); closeSheet();
      } }, 'שמירה')));
}

/* ================= Phase 4: shopping history ================= */
function viewHistory() {
  const box = h('div', null, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', null, 'היסטוריית קניות'), h('button', { class: 'btn ghost sm', onclick: manualExpense }, '+ הוצאה ידנית')));
  const reg = BUD.regulars(S.trips);
  if (reg.length) box.append(h('div', { class: 'card glass' }, h('b', null, `🔁 מוצרים קבועים (${reg.length})`),
    h('p', { class: 'hint' }, reg.slice(0, 12).map((r) => r.name).join(' · ') + (reg.length > 12 ? '…' : '')),
    h('button', { class: 'btn sm', onclick: async () => { try { const id = await R.listFromItems(S.hid, 'קבועים · ' + new Date().toLocaleDateString('he-IL'), reg); toast('נוצרה רשימה חוזרת ✓'); go('list/' + id); } catch (e) { permErr(e); } } }, 'צור רשימה מהקבועים')));
  if (!S.trips.length) box.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🧾'), 'עוד אין קניות שמורות. במצב קנייה לחץ "סיום קנייה".'));
  for (const t of S.trips) {
    const amt = Number.isInteger(t.total) ? format(t.total) : Number.isInteger(t.estTotal) ? format(t.estTotal) + ' (משוער)' : '—';
    box.append(h('div', { class: 'lcard glass', role: 'button', tabindex: '0', onclick: () => tripSheet(t), onkeydown: (e) => { if (e.key === 'Enter') tripSheet(t); } },
      h('div', { class: 'ic' }, '🧾'),
      h('div', { class: 'info' }, h('b', null, t.store || t.listName || 'קנייה'), h('span', { class: 'hint' }, t.at.toLocaleDateString('he-IL') + ` · ${(t.items || []).length} פריטים · ${t.byName || ''}`)),
      h('b', null, amt)));
  }
  return box;
}
function tripSheet(t) {
  const idx = S.trips.indexOf(t), prev = S.trips.slice(idx + 1).find((x) => (x.items || []).length);
  const items = t.items || [];
  const content = [h('div', { class: 'hint' }, `${t.at.toLocaleDateString('he-IL')} · ${t.byName || ''}${t.listName ? ' · רשימה: ' + t.listName : ''}`),
    h('div', { class: 'total', style: 'margin:6px 0' }, Number.isInteger(t.total) ? format(t.total) : 'לא הוזן סכום'),
    Number.isInteger(t.estTotal) && Number.isInteger(t.total) ? h('div', { class: 'hint' }, `משוער היה: ${format(t.estTotal)} (${t.total - t.estTotal >= 0 ? '+' : ''}${format(t.total - t.estTotal)})`) : null,
    items.length ? h('div', { class: 'feed', style: 'margin-top:8px' }, items.map((i) => h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', null, i.name + ' · ' + formatQty(i.qty, i.unit)), h('span', { class: 'hint' }, Number.isInteger(i.lineTotal) ? format(i.lineTotal) : '')))) : null];
  if (prev) {
    const c = BUD.compareTrips(prev, t);
    content.push(h('div', { class: 'card glass', style: 'margin-top:10px' }, h('b', null, 'מול הקנייה הקודמת (' + prev.at.toLocaleDateString('he-IL') + ')'),
      c.changed.length ? c.changed.slice(0, 8).map((x) => h('div', { class: 'hint' }, `${x.name}: ${format(x.from)} ← ${format(x.to)} (${x.pct > 0 ? '+' : ''}${x.pct}%)`)) : h('div', { class: 'hint' }, 'אין שינויי מחיר במוצרים שהופיעו בשתיהן.'),
      c.added.length ? h('div', { class: 'hint' }, 'חדש: ' + c.added.map((x) => x.name).join(', ')) : null,
      c.removed.length ? h('div', { class: 'hint' }, 'לא נקנה הפעם: ' + c.removed.map((x) => x.name).join(', ')) : null));
  }
  content.push(h('div', { class: 'row', style: 'margin-top:12px;flex-wrap:wrap' },
    items.length ? h('button', { class: 'btn', onclick: async () => { closeSheet(); try { const id = await R.listFromItems(S.hid, 'שוב: ' + (t.store || t.listName || 'קנייה'), items); toast('נוצרה רשימה מהסל ✓'); go('list/' + id); } catch (e) { permErr(e); } } }, 'קנה שוב את הסל') : null,
    h('button', { class: 'btn ghost', onclick: () => editTripSheet(t) }, 'עריכת סכום/חנות'),
    meIsAdmin() ? h('button', { class: 'btn ghost', style: 'color:var(--red)', onclick: () => confirmSheet('למחוק את הקנייה?', 'היא תוסר מההיסטוריה ומהתקציב.', 'מחיקה', () => R.deleteTrip(S.hid, t.id).then(() => toast('נמחקה')).catch(permErr)) }, 'מחיקה') : null));
  openSheet(t.store || t.listName || 'קנייה', ...content);
}
function editTripSheet(t) {
  const total = h('input', { class: 'input', inputmode: 'decimal', value: Number.isInteger(t.total) ? (t.total / 100).toFixed(2) : '' });
  const store = h('input', { class: 'input', value: t.store || '', maxlength: '80' });
  openSheet('עריכת קנייה', h('div', { class: 'field' }, h('label', null, 'סכום (₪)'), total), h('div', { class: 'field' }, h('label', null, 'חנות'), store),
    h('button', { class: 'btn block', onclick: () => {
      const v = total.value.trim() ? toAgorot(total.value) : null; if (total.value.trim() && (v === null || v < 0)) return toast('סכום לא תקין');
      R.updateTrip(S.hid, t.id, { total: v, store: store.value.trim() || null }).then(() => toast('עודכן ✓')).catch(permErr); closeSheet();
    } }, 'שמירה'));
}
function manualExpense() {
  const total = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'סכום (₪)' });
  const store = h('input', { class: 'input', placeholder: 'איפה', maxlength: '80' });
  const date = h('input', { class: 'input', type: 'date', value: new Date().toLocaleDateString('en-CA', { timeZone: BUD.TZ }) });
  openSheet('הוצאה ידנית', h('div', { class: 'field' }, total), h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2' }, store), h('div', { class: 'field', style: 'flex:1' }, date)),
    h('button', { class: 'btn block', onclick: async () => {
      const v = toAgorot(total.value); if (v === null || v <= 0) return toast('סכום לא תקין');
      const [yy, mm, dd] = date.value.split('-').map(Number);
      try { await R.addTrip(S.hid, { store: store.value.trim(), total: v, items: [], at: yy ? new Date(Date.UTC(yy, mm - 1, dd, 10)) : new Date() }); closeSheet(); toast('נשמר ✓'); } catch (e) { permErr(e); }
    } }, 'שמירה'));
}
