// Barcode scanner: native BarcodeDetector (Android/Chrome) → ZXing fallback (iOS Safari) → manual entry, always available.
import { h, openSheet, closeSheet, toast } from './dom.js';
import { validate } from '../core/barcode.js';

const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm';
let active = null;

function stopCamera() {
  if (!active) return;
  try { active.controls?.stop(); } catch {}
  try { active.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  clearInterval(active.timer); active = null;
}

/** Opens the scanner sheet; calls onCode(code) once with a VALID EAN/UPC code. */
export function openScanner(onCode, { title = 'סריקת ברקוד' } = {}) {
  stopCamera();
  let done = false;
  const finish = (code) => {
    const v = validate(code);
    if (!v.valid) { status.textContent = v.reason === 'checksum' ? 'הברקוד לא תקין (ספרת ביקורת). נסה שוב או הקלד ידנית' : 'מספר ברקוד לא תקין'; return false; }
    if (done) return true; done = true;
    if (navigator.vibrate) navigator.vibrate(60);
    stopCamera(); closeSheet(); onCode(v.code); return true;
  };
  const video = h('video', { playsinline: true, muted: true, autoplay: true, style: 'width:100%;max-height:46vh;border-radius:16px;background:#000;object-fit:cover', 'aria-label': 'תצוגת מצלמה' });
  const status = h('div', { class: 'hint', role: 'status', style: 'margin:8px 0' }, 'מפעיל מצלמה…');
  const manual = h('input', { class: 'input', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '14', placeholder: 'או הקלד את המספר שמתחת לברקוד', dir: 'ltr', 'aria-label': 'מספר ברקוד' });
  manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(manual.value.replace(/\D/g, '')); });
  const camBox = h('div', null, video);
  openSheet(title, camBox, status,
    h('div', { class: 'row' }, manual, h('button', { class: 'btn', onclick: () => finish(manual.value.replace(/\D/g, '')) }, 'אישור')),
    h('button', { class: 'btn ghost block', style: 'margin-top:8px', onclick: () => { stopCamera(); closeSheet(); } }, 'סגירה'));
  const bgObserver = new MutationObserver(() => { if (!document.body.contains(video)) { stopCamera(); bgObserver.disconnect(); } });
  bgObserver.observe(document.body, { childList: true, subtree: true });

  if (!navigator.mediaDevices?.getUserMedia) { camBox.remove(); status.textContent = 'אין גישה למצלמה בדפדפן הזה. הקלד את מספר הברקוד.'; return; }
  (async () => {
    try {
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
      const native = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.() || []).some((f) => formats.includes(f));
      if (native) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        active = { stream }; video.srcObject = stream; await video.play().catch(() => {});
        const det = new window.BarcodeDetector({ formats });
        status.textContent = 'כוון את המצלמה לברקוד';
        active.timer = setInterval(async () => {
          if (done || video.readyState < 2) return;
          try { const r = await det.detect(video); for (const c of r) if (finish(c.rawValue)) return; } catch {}
        }, 250);
      } else {
        status.textContent = 'טוען סורק…';
        const { BrowserMultiFormatReader } = await import(ZXING);
        const reader = new BrowserMultiFormatReader();
        status.textContent = 'כוון את המצלמה לברקוד';
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video, (res) => { if (res && !done) finish(res.getText()); });
        active = { controls };
      }
    } catch (e) {
      camBox.remove();
      status.textContent = e?.name === 'NotAllowedError' ? 'אין הרשאה למצלמה. אפשר לאשר בהגדרות הדפדפן, או להקליד את מספר הברקוד.' : 'לא הצלחתי להפעיל מצלמה. הקלד את מספר הברקוד.';
      manual.focus();
    }
  })();
}
export { stopCamera };
