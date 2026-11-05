// Paste a whole shopping list at once (from WhatsApp, Notes, an email…) → items with quantities.
import { parseQty } from './units.js';

const MAX = 200;
const NUMISH = /\d|חצי|רבע|אחד|אחת|שני|שתי|שלוש|ארבע|חמש|שש|עשר|תריסר/;
const BULLET = /^\s*(?:[-–—•*·▪◦●○■□☐☑☒✓✔✅❌➖➕>]+|\d{1,3}[.)](?!\d)|\[[ xX✓]?\])\s*/u;
const EMOJI = /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|\p{Emoji_Modifier})+\s*/u;
const WA_PREFIX = /^\[[^\]]{4,30}\]\s*[^:]{1,40}:\s*/;            // "[5.11, 14:02] דנה: חלב"
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** A quantity text is accepted only if it parses fully (no leftover words) and contains a number. */
function asQty(s) {
  s = (s || '').trim();
  if (!s || !NUMISH.test(s) || !/^(?:[\dx×*]|חצי|רבע|שלושת|אחד|אחת|שני|שתי|שלוש|ארבע|חמש|שש|עשר|תריסר)/.test(s)) return null;   // "L 12" is not "12 liters"
  const q = parseQty(s);
  return q.qty !== null && !q.note ? q : null;
}

/** One line → { name, qty, unit } or null. */
export function parseLine(line) {
  let s = String(line ?? '').replace(BIDI, '').replace(WA_PREFIX, '').trim();
  for (let i = 0; i < 3; i++) s = s.replace(BULLET, '').replace(EMOJI, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || /[:：]$/.test(s) || !/\p{L}/u.test(s)) return null;    // headers like "רשימת קניות:"
  const out = (name, q) => { name = name.replace(/[\s\-–:,]+$/, '').replace(/^[\s\-–:,]+/, '').trim(); return name && /\p{L}/u.test(name) ? { name: name.slice(0, 120), qty: q ? q.qty : 1, unit: q ? q.unit : 'unit' } : null; };

  let m = s.match(/^(.*\S)\s*\(([^()]+)\)$/);                       // "חלב (2)"
  if (m && asQty(m[2])) return out(m[1], asQty(m[2]));
  m = s.match(/^(.+?)\s+[-–:]\s*(.+)$/) || s.match(/^(.+?)[-–:]\s+(.+)$/);  // "עגבניות - 2 ק"ג"
  if (m && asQty(m[2])) return out(m[1], asQty(m[2]));

  const t = s.split(' ');
  for (let k = Math.min(3, t.length - 1); k >= 1; k--) {            // "עגבניות 2 ק"ג", "במבה x3"
    const q = asQty(t.slice(-k).join(' '));
    if (q) return out(t.slice(0, -k).join(' '), q);
  }
  for (let k = Math.min(3, t.length - 1); k >= 1; k--) {            // "2 ק"ג עגבניות", "חצי קילו גבינה"
    const q = asQty(t.slice(0, k).join(' '));
    if (q) return out(t.slice(k).join(' '), q);
  }
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*[x×*]?\s*([\u0590-\u05FF].*)$/);   // "3חלב", "2x לחם" (not "7up")
  if (m) return out(m[2], asQty(m[1]));
  return out(s, null);
}

const key = (n) => n.replace(/[\s"'״׳-]/g, '').toLowerCase();

/** Whole pasted text → unique items (same name twice is kept once). */
export function parsePastedList(text) {
  let src = String(text ?? '').replace(/\r\n?/g, '\n');
  let lines = src.split('\n');
  if (lines.filter((l) => l.trim()).length === 1) lines = src.split(/\s*[;،]\s*|,(?!\d)\s*|\s*,\s+/);   // "חלב, לחם, ביצים" (but "1,5 ק"ג" stays)
  const seen = new Set(), items = [];
  for (const l of lines) {
    const it = parseLine(l);
    if (!it || seen.has(key(it.name))) continue;
    seen.add(key(it.name)); items.push(it);
    if (items.length >= MAX) break;
  }
  return items;
}
export const sameName = (a, b) => key(a) === key(b);
export const nameKey = key;
