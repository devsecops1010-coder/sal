// SmartCart — barcode validation (EAN-13, EAN-8, UPC-A). Israeli products use EAN-13 with prefix 729.

const digits = (s) => String(s ?? '').replace(/\s|-/g, '');

/** GS1 mod-10 check digit for the data part (all digits except the last). */
export function checkDigit(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data.charCodeAt(data.length - 1 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function validate(code) {
  const c = digits(code);
  if (!/^\d+$/.test(c)) return { valid: false, reason: 'not-digits' };
  const type = { 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' }[c.length];
  if (!type) return { valid: false, reason: 'length' };
  const ok = checkDigit(c.slice(0, -1)) === Number(c[c.length - 1]);
  return ok ? { valid: true, type, code: c, israeli: type === 'EAN-13' && c.startsWith('729') } : { valid: false, reason: 'checksum', type };
}

/** Canonical key for lookups: UPC-A is stored as EAN-13 with a leading 0; GTIN-14 with leading 0 → EAN-13. */
export function normalizeBarcode(code) {
  const v = validate(code);
  if (!v.valid) return null;
  if (v.type === 'UPC-A') return '0' + v.code;
  if (v.type === 'GTIN-14' && v.code.startsWith('0')) return v.code.slice(1);
  return v.code;
}
