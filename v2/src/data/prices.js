// Client for the SmartCart price service (official price-transparency files, read-only).
// Local tests may point it elsewhere with ?prices=http://127.0.0.1:PORT (only on localhost).
const DEFAULT = 'https://smartcart.129.159.25.182.sslip.io';
const qp = new URLSearchParams(location.search).get('prices');
export const BASE = qp && ['127.0.0.1', 'localhost'].includes(location.hostname) && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(qp) ? qp : DEFAULT;

export class PriceError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function call(path, body, { timeout = 25000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal });
    const j = await res.json().catch(() => ({}));
    if (res.status === 202) return { loading: true, message: j.error };
    if (!res.ok) throw new PriceError(j.error || 'שירות המחירים לא זמין כרגע', res.status);
    return j;
  } catch (e) {
    if (e instanceof PriceError) throw e;
    throw new PriceError(navigator.onLine === false ? 'אין חיבור לאינטרנט' : 'שירות המחירים לא זמין כרגע', 0);
  } finally { clearTimeout(t); }
}

/** Repeat while the server is still downloading a branch's file (first use of a branch can take 1–2 minutes). */
async function untilLoaded(fn, { onWait, every = 6000, max = 30, isLoading = (r) => r.loading } = {}) {
  for (let i = 0; i < max; i++) {
    const r = await fn();
    if (!isLoading(r)) return r;
    onWait?.(r, i);
    await new Promise((ok) => setTimeout(ok, every));
  }
  throw new PriceError('טעינת המחירים לוקחת יותר מהרגיל. נסו שוב בעוד כמה דקות', 504);
}

export const health = () => call('/api/health');
export const chains = () => call('/api/chains');
export const cities = () => call('/api/cities').then((r) => r.cities);
export const branchesInCity = (code) => call('/api/branches?city=' + encodeURIComponent(code)).then((r) => r.branches);
export const findBranches = (q) => call('/api/branches?q=' + encodeURIComponent(q)).then((r) => r.branches);
export const search = (branchId, q, opts) => untilLoaded(() => call(`/api/search?branch=${encodeURIComponent(branchId)}&q=${encodeURIComponent(q)}`), opts);
/** Prices for product codes in branches. Waits (polling) while branches are still loading, but returns partial data
 *  as soon as no branch is loading any more. */
export const prices = (branchIds, codes, opts) => untilLoaded(() => call('/api/prices', { branches: branchIds, codes }), opts);
export const history = (branchId, code) => call(`/api/history?branch=${encodeURIComponent(branchId)}&code=${encodeURIComponent(code)}`).then((r) => r.history);
