// Receipt OCR (Phase 5): image/PDF → on-device OCR (Tesseract.js, Hebrew+English) → parser → MANDATORY confirm/edit → save.
// The image never leaves the phone and is not stored; only the confirmed data (+ OCR text for audit) is saved.
import { h, openSheet, closeSheet, toast } from './dom.js';
import { parseReceipt } from '../core/receipt.js';
import { toAgorot, format } from '../core/money.js';
import { guessCategory } from '../core/categorize.js';

const TJS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const OPTS = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  // langPath left unset on purpose: tesseract.js then loads https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int per language
};
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFW = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
export const ENGINE = 'tesseract.js 5.1.1 (heb+eng, on-device)';
const MAX_BYTES = 15 * 1024 * 1024;

/** Downscale + grayscale + contrast stretch: thermal receipts OCR much better this way. Returns a canvas. */
async function prepareImage(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = y; if (y < lo) lo = y; if (y > hi) hi = y; }
  const k = hi > lo ? 255 / (hi - lo) : 1;
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(img, 0, 0);
  return c;
}
async function pdfToCanvases(file, maxPages = 3) {
  const pdfjs = await import(PDFJS); pdfjs.GlobalWorkerOptions.workerSrc = PDFW;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; out.push(c);
  }
  return out;
}

/** Validate the file before doing anything with it (type sniffing by magic bytes, not just the extension). */
async function checkFile(file) {
  if (!file) return 'לא נבחר קובץ';
  if (file.size > MAX_BYTES) return 'הקובץ גדול מדי (עד 15MB)';
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join('');
  const isPdf = hex.startsWith('25504446'), isPng = hex.startsWith('89504e47'), isJpg = hex.startsWith('ffd8ff'),
    isWebp = hex.startsWith('52494646'), isHeic = /^000000..66747970/.test(hex);
  if (isHeic) return 'פורמט HEIC עוד לא נתמך. בהגדרות המצלמה באייפון בחר "התאמה מרבית" (JPEG), או צלם צילום מסך של הקבלה';
  if (!(isPdf || isPng || isJpg || isWebp)) return 'אפשר להעלות רק תמונה (JPG/PNG/WEBP) או PDF';
  return null;
}

/** Full flow. onSave(draft) gets the user-confirmed receipt. */
export function openReceiptScan(onSave) {
  const input = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment', class: 'sr', 'aria-label': 'בחירת קבלה' });
  const status = h('div', { class: 'hint', role: 'status', style: 'margin-top:10px' });
  const bar = h('div', { class: 'bar', style: 'margin-top:8px;display:none' }, h('i', { style: 'width:0%' }));
  openSheet('סריקת קבלה',
    h('p', { class: 'hint' }, 'צלם את הקבלה ישר ובתאורה טובה, או העלה תמונה או PDF. הזיהוי נעשה בטלפון עצמו והתמונה לא נשמרת. לפני השמירה תוכל לבדוק ולתקן כל שורה.'),
    h('button', { class: 'btn block', onclick: () => input.click() }, '📷 צילום / בחירת קבלה'), input, bar, status);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    const err = await checkFile(file); if (err) { status.textContent = err; return; }
    bar.style.display = ''; const fill = bar.firstChild;
    try {
      status.textContent = 'מכין את התמונה…';
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const canvases = isPdf ? await pdfToCanvases(file) : [await prepareImage(file)];
      status.textContent = 'טוען מנוע זיהוי (פעם ראשונה כ-4MB)…';
      const T = await import(TJS);
      const worker = await (T.createWorker || T.default.createWorker)('heb+eng', 1, { ...OPTS, logger: (m) => { if (m.status === 'recognizing text') { fill.style.width = Math.round(m.progress * 100) + '%'; status.textContent = 'מזהה טקסט… ' + Math.round(m.progress * 100) + '%'; } } });
      let text = '', conf = [];
      for (const c of canvases) { const { data } = await worker.recognize(c); text += data.text + '\n'; conf.push(data.confidence); }
      await worker.terminate();
      const ocrConf = conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null;
      const draft = parseReceipt(text, { ocrConfidence: ocrConf });
      confirmReceipt({ ...draft, rawText: text.slice(0, 10000), ocrConfidence: ocrConf, engine: ENGINE, fileType: isPdf ? 'pdf' : 'image' }, onSave);
    } catch (e) {
      console.warn(e);
      status.textContent = 'הזיהוי נכשל (' + (e?.message || e) + '). אפשר לנסות שוב או להזין את הקנייה ידנית.';
    }
  });
}

/** Mandatory review screen: every field editable; nothing is saved until "אישור ושמירה". */
export function confirmReceipt(d, onSave) {
  const rows = d.items.map((i) => ({ ...i }));
  const store = h('input', { class: 'input', value: d.store || '', placeholder: 'שם החנות', maxlength: '80' });
  const date = h('input', { class: 'input', type: 'date', value: d.date || '' });
  const total = h('input', { class: 'input', inputmode: 'decimal', value: d.total != null ? (d.total / 100).toFixed(2) : '', placeholder: 'סה״כ' });
  const list = h('div');
  const sumLine = h('div', { class: 'hint', 'aria-live': 'polite' });
  const recompute = () => {
    const s = rows.reduce((a, r) => a + (Number.isInteger(r.lineTotal) ? r.lineTotal : 0) + (r.discount || 0), 0);
    const t = toAgorot(total.value);
    sumLine.textContent = `סכום השורות: ${format(s)}` + (t !== null ? (Math.abs(t - s) <= 5 ? ' ✓ תואם לסה״כ' : ` · הפרש מהסה״כ: ${format(t - s)}`) : '');
  };
  const paint = () => {
    list.replaceChildren(...rows.map((r, idx) => {
      const nm = h('input', { class: 'input', value: r.name, maxlength: '120', 'aria-label': 'שם פריט', style: 'flex:2;padding:8px' });
      const q = h('input', { class: 'input', value: r.qty, inputmode: 'decimal', 'aria-label': 'כמות', style: 'width:64px;padding:8px' });
      const p = h('input', { class: 'input', value: Number.isInteger(r.lineTotal) ? (r.lineTotal / 100).toFixed(2) : '', inputmode: 'decimal', 'aria-label': 'מחיר שורה', style: 'width:84px;padding:8px' });
      nm.oninput = () => { r.name = nm.value; }; q.oninput = () => { r.qty = Number(q.value) || 1; };
      p.oninput = () => { r.lineTotal = toAgorot(p.value); recompute(); };
      return h('div', { style: 'margin-bottom:8px' },
        h('div', { class: 'row' }, nm, q, p, h('button', { class: 'icon-btn', 'aria-label': 'מחיקת שורה', onclick: () => { rows.splice(idx, 1); paint(); } }, '✕')),
        r.confidence < 0.7 || r.note || r.discount ? h('div', { class: 'hint', style: 'font-size:12px' }, [r.confidence < 0.7 ? '⚠️ לבדוק' : '', r.note, r.discount ? 'הנחה ' + format(r.discount) : ''].filter(Boolean).join(' · ')) : null);
    }));
    recompute();
  };
  total.oninput = recompute;
  paint();
  openSheet('בדיקת הקבלה לפני שמירה',
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px;margin-bottom:8px' },
      h('span', { class: 'badge' + (d.confidence >= 0.8 ? '' : ' warn') }, 'ביטחון זיהוי ' + Math.round(d.confidence * 100) + '%'),
      h('span', { class: 'badge warn' }, 'זוהה אוטומטית, יש לבדוק')),
    d.warnings.length ? h('div', { class: 'card glass', role: 'alert', style: 'padding:10px;border-color:var(--amber)' }, d.warnings.map((w) => h('div', { class: 'hint' }, '⚠️ ' + w))) : null,
    h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:2' }, h('label', null, 'חנות'), store), h('div', { class: 'field', style: 'flex:1' }, h('label', null, 'תאריך'), date)),
    h('div', { class: 'row hint', style: 'font-size:12px' }, h('span', { style: 'flex:2' }, 'פריט'), h('span', { style: 'width:64px' }, 'כמות'), h('span', { style: 'width:84px' }, 'סה״כ שורה'), h('span', { style: 'width:40px' })),
    list,
    h('button', { class: 'btn ghost sm', onclick: () => { rows.push({ name: '', qty: 1, unit: 'unit', lineTotal: null, discount: 0, confidence: 1 }); paint(); } }, '+ שורה'),
    h('div', { class: 'field', style: 'margin-top:10px' }, h('label', null, 'סה״כ לתשלום (₪)'), total), sumLine,
    h('p', { class: 'hint', style: 'font-size:12px' }, 'מקור: ' + d.engine + '. התמונה לא נשמרת.'),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn ghost block', onclick: closeSheet }, 'ביטול'),
      h('button', { class: 'btn block', onclick: async (e) => {
        const t = total.value.trim() ? toAgorot(total.value) : null;
        if (total.value.trim() && (t === null || t < 0)) return toast('סה״כ לא תקין');
        const items = rows.filter((r) => r.name.trim()).map((r) => ({
          name: r.name.trim().slice(0, 120), qty: r.qty || 1, unit: r.unit || 'unit', cat: r.cat || guessCategory(r.name),
          unitPrice: Number.isInteger(r.lineTotal) && r.qty ? Math.round(r.lineTotal / r.qty) : null,
          lineTotal: Number.isInteger(r.lineTotal) ? r.lineTotal + (r.discount || 0) : null,
        }));
        e.target.disabled = true;
        try { await onSave({ store: store.value.trim(), date: date.value, total: t, items, rawText: d.rawText, confidence: d.confidence, engine: d.engine, warnings: d.warnings }); closeSheet(); toast('הקבלה נשמרה ✓'); }
        catch (x) { console.warn(x); toast('השמירה נכשלה'); e.target.disabled = false; }
      } }, 'אישור ושמירה')));
}
