// Tiny DOM helpers. User data is ONLY ever inserted as text (no innerHTML with data → no XSS).
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export function mount(node) { const r = $('#root'); r.replaceChildren(node); }

export function toast(msg, ms = 2400) {
  const t = h('div', { class: 'toast' }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

let sheetBg = null;
export function openSheet(title, ...content) {
  closeSheet();
  sheetBg = h('div', { class: 'sheet-bg', onclick: (e) => { if (e.target === sheetBg) closeSheet(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'grab' }), h('h3', null, title), ...content));
  document.body.append(sheetBg);
  const f = sheetBg.querySelector('input,select,textarea,button');
  if (f) setTimeout(() => f.focus(), 50);
  return sheetBg;
}
export function closeSheet() { if (sheetBg) { sheetBg.remove(); sheetBg = null; } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/** Confirm dialog for destructive actions. */
export function confirmSheet(title, text, okLabel, onOk, danger = true) {
  openSheet(title, h('p', { class: 'hint' }, text),
    h('div', { class: 'row', style: 'margin-top:14px' },
      h('button', { class: 'btn ghost block', onclick: closeSheet }, 'ביטול'),
      h('button', { class: 'btn block' + (danger ? ' danger' : ''), onclick: () => { closeSheet(); onOk(); } }, okLabel)));
}
