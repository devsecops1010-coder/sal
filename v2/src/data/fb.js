// Firebase bootstrap (modular SDK, native ES modules from gstatic — no build step).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signOut,
  setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
auth.languageCode = 'he';

// Offline-first: Firestore keeps a local copy (IndexedDB) and syncs writes when back online.
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(app, { localCache: memoryLocalCache() });   // private mode / no IndexedDB
}
export { db };

// Local E2E tests only: http://127.0.0.1:…/?emu=1 talks to the Firebase emulators, never to production.
if (['127.0.0.1', 'localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('emu')) {
  const { connectAuthEmulator } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const { connectFirestoreEmulator } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  window.__SC_EMULATOR__ = true;
}
setPersistence(auth, browserLocalPersistence).catch(() => {});
getRedirectResult(auth).catch(() => {});

export const onUser = (cb) => onAuthStateChanged(auth, cb);

export async function loginGoogle() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try { return await signInWithPopup(auth, p); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return signInWithRedirect(auth, p);
    throw e;
  }
}
export const nameHint = { v: null };   // display name typed at sign-up, before updateProfile lands
export async function signUpEmail(name, email, pass) {
  nameHint.v = name || null;
  const c = await createUserWithEmailAndPassword(auth, email, pass);
  if (name) await updateProfile(c.user, { displayName: name });
  return c;
}
export const loginEmail = (email, pass) => signInWithEmailAndPassword(auth, email, pass);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);
export const logout = () => signOut(auth);

const AUTH_ERRORS = {
  'auth/invalid-credential': 'מייל או סיסמה שגויים', 'auth/wrong-password': 'סיסמה שגויה', 'auth/user-not-found': 'אין משתמש עם המייל הזה',
  'auth/email-already-in-use': 'המייל כבר רשום. אפשר להתחבר', 'auth/weak-password': 'סיסמה של 6 תווים לפחות', 'auth/invalid-email': 'כתובת מייל לא תקינה',
  'auth/missing-password': 'צריך סיסמה', 'auth/popup-closed-by-user': 'החלון נסגר לפני שהכניסה הסתיימה', 'auth/network-request-failed': 'אין חיבור לאינטרנט',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות', 'auth/unauthorized-domain': 'הכתובת לא מאושרת לכניסה',
};
export const authError = (e) => AUTH_ERRORS[e?.code] || 'שגיאה: ' + (e?.code || e?.message || '');
