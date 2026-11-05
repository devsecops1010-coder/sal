// SmartCart data access — the ONLY module that talks to Firestore. Mirrors firestore.rules.
import {
  doc, collection, setDoc, getDoc, getDocs, updateDoc, deleteDoc, addDoc, onSnapshot, query, orderBy, limit,
  serverTimestamp, writeBatch, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db, auth, nameHint } from './fb.js';

const me = () => auth.currentUser;
let profileName = null;
export const setMyName = (n) => { profileName = n || null; };
const myName = () => profileName || me()?.displayName || nameHint.v || me()?.email?.split('@')[0] || 'משתמש';
export const rid = (n = 20) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };

/* ---------- user profile ---------- */
export async function loadProfile() {
  const u = me(); if (!u) return null;
  const ref = doc(db, 'users', u.uid);
  const s = await getDoc(ref);
  if (s.exists()) return s.data();
  const p = { displayName: myName(), email: u.email || '', createdAt: serverTimestamp(), households: [], prefs: {} };
  await setDoc(ref, p);
  return p;
}
export const saveProfile = (patch) => { if (patch.displayName) profileName = patch.displayName; return updateDoc(doc(db, 'users', me().uid), { ...patch, updatedAt: serverTimestamp() }); };

/* ---------- households ---------- */
export async function createHousehold(name) {
  const u = me(), hid = 'h_' + rid(16);
  await setDoc(doc(db, 'households', hid), { name, createdBy: u.uid, createdAt: serverTimestamp(), currency: 'ILS', timezone: 'Asia/Jerusalem' });
  await setDoc(doc(db, 'households', hid, 'members', u.uid), { role: 'admin', displayName: myName(), joinedAt: serverTimestamp() });
  await rememberHousehold(hid, name);
  await logActivity(hid, 'household.create', { text: name });
  return hid;
}
export async function rememberHousehold(hid, name) {
  const p = (await loadProfile()) || {};
  const list = (p.households || []).filter((h) => h.id !== hid);
  list.push({ id: hid, name });
  await saveProfile({ households: list, defaultHousehold: hid });
}
export async function forgetHousehold(hid) {
  const p = (await loadProfile()) || {};
  const list = (p.households || []).filter((h) => h.id !== hid);
  await saveProfile({ households: list, defaultHousehold: list[0]?.id || null });
}
export const getHousehold = async (hid) => { const s = await getDoc(doc(db, 'households', hid)); return s.exists() ? { id: hid, ...s.data() } : null; };
export const renameHousehold = (hid, name) => updateDoc(doc(db, 'households', hid), { name, updatedAt: serverTimestamp() });
export const watchMembers = (hid, cb, err) => onSnapshot(collection(db, 'households', hid, 'members'), (qs) => cb(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), err);
export const setRole = (hid, uid, role) => updateDoc(doc(db, 'households', hid, 'members', uid), { role });
export const removeMember = (hid, uid) => deleteDoc(doc(db, 'households', hid, 'members', uid));

/* ---------- invitations (link = hid + code; valid 7 days; admin can revoke) ---------- */
export async function createInvite(hid, days = 7) {
  const code = rid(20);
  await setDoc(doc(db, 'households', hid, 'invitations', code), {
    createdBy: me().uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + days * 864e5), revoked: false, role: 'member',
  });
  return code;
}
export const revokeInvite = (hid, code) => updateDoc(doc(db, 'households', hid, 'invitations', code), { revoked: true });
export const watchInvites = (hid, cb, err) => onSnapshot(collection(db, 'households', hid, 'invitations'), (qs) => cb(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), err);
export async function joinHousehold(hid, code) {
  const u = me();
  await setDoc(doc(db, 'households', hid, 'members', u.uid), { role: 'member', displayName: myName(), invite: code, joinedAt: serverTimestamp() });
  const h = await getHousehold(hid);
  await rememberHousehold(hid, h?.name || 'משק בית');
  await logActivity(hid, 'member.join', { text: myName() });
  return h;
}

/* ---------- lists ---------- */
export const watchLists = (hid, cb, err) => onSnapshot(collection(db, 'households', hid, 'lists'), (qs) =>
  cb(qs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name, 'he'))), err);
export async function createList(hid, { name, icon = '🛒', migratedFrom } = {}) {
  const ref = doc(collection(db, 'households', hid, 'lists'));
  await setDoc(ref, { name, icon, archived: false, order: Date.now(), createdBy: me().uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(migratedFrom ? { migratedFrom } : {}) });
  logActivity(hid, 'list.create', { listId: ref.id, text: name });
  return ref.id;
}
export const updateList = (hid, lid, patch) => updateDoc(doc(db, 'households', hid, 'lists', lid), { ...patch, updatedAt: serverTimestamp() });
export async function deleteList(hid, lid, name) {
  const items = await getDocs(collection(db, 'households', hid, 'lists', lid, 'items'));
  const chunks = [];
  for (let i = 0; i < items.docs.length; i += 400) chunks.push(items.docs.slice(i, i + 400));
  for (const c of chunks) { const b = writeBatch(db); c.forEach((d) => b.delete(d.ref)); await b.commit(); }
  await deleteDoc(doc(db, 'households', hid, 'lists', lid));
  logActivity(hid, 'list.delete', { text: name });
}
export async function duplicateList(hid, lid, newName) {
  const src = await getDocs(collection(db, 'households', hid, 'lists', lid, 'items'));
  const nl = await createList(hid, { name: newName });
  const b = writeBatch(db);
  src.docs.forEach((d) => {
    const x = d.data();
    b.set(doc(collection(db, 'households', hid, 'lists', nl, 'items')), clean({
      name: x.name, qty: x.qty ?? null, unit: x.unit, note: x.note, cat: x.cat, priceEst: x.priceEst ?? null, currency: 'ILS',
      done: false, addedBy: me().uid, addedByName: myName(), order: x.order ?? Date.now(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  await b.commit();
  return nl;
}

/* ---------- items ---------- */
export const watchItems = (hid, lid, cb, err) => onSnapshot(collection(db, 'households', hid, 'lists', lid, 'items'), { includeMetadataChanges: false }, (qs) =>
  cb(qs.docs.map((d) => ({ id: d.id, ...d.data(), _pending: d.metadata.hasPendingWrites }))), err);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
export async function addItem(hid, lid, item) {
  const ref = doc(collection(db, 'households', hid, 'lists', lid, 'items'));
  // not awaited on purpose: works offline, Firestore queues it
  setDoc(ref, clean({ ...item, currency: 'ILS', done: false, addedBy: me().uid, addedByName: myName(), order: Date.now(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    .catch((e) => console.warn('addItem', e));
  logActivity(hid, 'item.add', { listId: lid, itemId: ref.id, text: item.name });
  return ref.id;
}
export const updateItem = (hid, lid, iid, patch) => updateDoc(doc(db, 'households', hid, 'lists', lid, 'items', iid), clean({ ...patch, updatedAt: serverTimestamp() }));
/** Idempotent check/uncheck: sets an explicit value (double taps can't flip it back). */
export function setDone(hid, lid, iid, done, name) {
  const patch = done ? { done: true, checkedBy: me().uid, checkedByName: myName(), checkedAt: serverTimestamp() } : { done: false, checkedBy: null, checkedByName: null, checkedAt: null };
  updateItem(hid, lid, iid, patch).catch((e) => console.warn('setDone', e));
  if (done) logActivity(hid, 'item.check', { listId: lid, itemId: iid, text: name });
}
export const deleteItem = (hid, lid, iid) => deleteDoc(doc(db, 'households', hid, 'lists', lid, 'items', iid));
export async function clearDone(hid, lid, items) {
  const b = writeBatch(db);
  items.filter((i) => i.done).forEach((i) => b.delete(doc(db, 'households', hid, 'lists', lid, 'items', i.id)));
  await b.commit();
}

/* ---------- activity (append-only) ---------- */
export function logActivity(hid, type, { listId, itemId, text } = {}) {
  return addDoc(collection(db, 'households', hid, 'activity'), clean({ by: me().uid, byName: myName(), type, listId, itemId, text: text ? String(text).slice(0, 120) : undefined, at: serverTimestamp() }))
    .catch(() => {});
}
export const watchActivity = (hid, cb, err) => onSnapshot(query(collection(db, 'households', hid, 'activity'), orderBy('at', 'desc'), limit(50)), (qs) => cb(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), err);

/* ---------- migration from v1 ("סל"): copy, never delete the source ---------- */
export async function importFromV1(hid, v1State, { migrateCategory, parseQty }) {
  const lists = (v1State?.lists || []).filter((l) => l && Array.isArray(l.items));
  let nLists = 0, nItems = 0;
  for (const l of lists) {
    const lid = await createList(hid, { name: String(l.name || 'רשימה').slice(0, 60), icon: l.icon || '🛒', migratedFrom: 'v1:' + (l.id || '') });
    nLists++;
    for (let i = 0; i < l.items.length; i += 400) {
      const b = writeBatch(db);
      for (const it of l.items.slice(i, i + 400)) {
        if (!it?.name) continue;
        const q = parseQty(it.qty || '');
        b.set(doc(collection(db, 'households', hid, 'lists', lid, 'items')), clean({
          name: String(it.name).slice(0, 120), qty: q.qty, unit: q.unit, raw: it.qty ? String(it.qty).slice(0, 60) : undefined,
          cat: migrateCategory(it.cat, it.name), currency: 'ILS', done: !!it.done, addedBy: me().uid, addedByName: myName(),
          order: it.o || Date.now(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
        nItems++;
      }
      await b.commit();
    }
  }
  logActivity(hid, 'import.v1', { text: `${nLists} רשימות, ${nItems} פריטים` });
  return { nLists, nItems };
}

/* ---------- trips (= actual expenses + shopping history), Phase 4 ---------- */
export async function addTrip(hid, t) {
  const ref = doc(collection(db, 'households', hid, 'trips'));
  await setDoc(ref, clean({
    at: t.at instanceof Date ? Timestamp.fromDate(t.at) : Timestamp.now(), listId: t.listId, listName: t.listName ? String(t.listName).slice(0, 60) : undefined,
    store: t.store ? String(t.store).slice(0, 80) : undefined, total: Number.isInteger(t.total) ? t.total : null, estTotal: Number.isInteger(t.estTotal) ? t.estTotal : null,
    currency: 'ILS', items: (t.items || []).slice(0, 300), by: me().uid, byName: myName(), note: t.note || undefined, createdAt: serverTimestamp(),
  }));
  logActivity(hid, 'trip.add', { listId: t.listId, text: (t.store ? t.store + ' · ' : '') + (Number.isInteger(t.total) ? (t.total / 100).toFixed(2) + ' ₪' : '') });
  return ref.id;
}
export const watchTrips = (hid, cb, err) => onSnapshot(query(collection(db, 'households', hid, 'trips'), orderBy('at', 'desc'), limit(300)),
  (qs) => cb(qs.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: x.at?.toDate ? x.at.toDate() : new Date() }; })), err);
export const updateTrip = (hid, tid, patch) => updateDoc(doc(db, 'households', hid, 'trips', tid), clean({ ...patch, updatedAt: serverTimestamp() }));
export const deleteTrip = (hid, tid) => deleteDoc(doc(db, 'households', hid, 'trips', tid));

/* ---------- budgets ---------- */
export const watchBudgets = (hid, cb, err) => onSnapshot(collection(db, 'households', hid, 'budgets'), (qs) => cb(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), err);
export const setBudget = (hid, id, { period, amount, cat = null }) => setDoc(doc(db, 'households', hid, 'budgets', id), { period, amount, cat, currency: 'ILS', updatedAt: serverTimestamp(), updatedBy: me().uid });
export const deleteBudget = (hid, id) => deleteDoc(doc(db, 'households', hid, 'budgets', id));

/** New list from a set of items (repeat a past basket / "regulars"). Never touches the source. */
export async function listFromItems(hid, name, items, icon = '🔁') {
  const lid = await createList(hid, { name, icon });
  const b = writeBatch(db); let o = Date.now();
  for (const it of items.slice(0, 400)) {
    b.set(doc(collection(db, 'households', hid, 'lists', lid, 'items')), clean({
      name: String(it.name).slice(0, 120), qty: typeof it.qty === 'number' ? it.qty : (it.lastQty ?? 1), unit: it.unit || it.lastUnit || 'unit', cat: it.cat || 'other',
      priceEst: Number.isInteger(it.unitPrice) ? it.unitPrice : undefined, barcode: it.barcode, currency: 'ILS', done: false,
      addedBy: me().uid, addedByName: myName(), order: o--, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  }
  await b.commit();
  return lid;
}
