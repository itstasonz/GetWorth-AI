// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — HUMAN GROUND TRUTH AND PHOTOGRAPH HEADERS
//
// The vocabulary and the rules are the capture helper's, unchanged
// (tests/scan-lab-server.test.mjs holds the two lists equal):
//
//   - null means UNKNOWN, and UNKNOWN is always an acceptable answer;
//   - a CONFIRMED value records how it was established (a provenance);
//   - nothing is inferred, defaulted or corrected on the person's behalf.
//
// What is validated here is for SCORING AFTERWARDS. Nothing in this module, and
// nothing that imports it, is reachable from a recognition or pricing path.
// ══════════════════════════════════════════════════════════════════════════════

export const PROVENANCE = Object.freeze(['PHYSICAL_LABEL', 'PACKAGING', 'OWNER_KNOWLEDGE', 'PURCHASE_RECORD', 'SERIAL_MODEL_LABEL', 'MANUFACTURER_REFERENCE', 'OTHER']);
export const CONDITIONS = Object.freeze(['New', 'Like New', 'Good', 'Fair', 'Poor', 'Parts', 'Unknown']);
export const CONFIGURATIONS = Object.freeze(['COMPLETE', 'BASE_ONLY', 'ACCESSORY_ONLY', 'BOX_ONLY', 'REPLACEMENT_PART', 'BUNDLE', 'PARTS', 'UNKNOWN']);
export const TRUTH_FIELDS = Object.freeze(['brand', 'product_family', 'exact_model', 'model_number', 'variant', 'capacity_size', 'color', 'configuration']);

const MAX_VALUE = 200;
const MAX_NOTE = 1000;

export class LabError extends Error {
  constructor(status, code, detail = null) {
    super(detail ? `${code}: ${detail}` : code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
const bad = (detail) => new LabError(400, 'bad_request', detail);

const text = (v, max, name) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw bad(`${name} must be text or null`);
  const t = v.trim();
  if (t.length > max) throw bad(`${name} is too long`);
  return t === '' ? null : t;
};

/**
 * The confirmation as it will be stored: every truth field present, null for
 * UNKNOWN, and a provenance for every field that carries a value.
 */
export function validateTruth(body) {
  const identity = {};
  const provenance = {};
  const given = body?.identity && typeof body.identity === 'object' ? body.identity : {};
  const prov = body?.provenance && typeof body.provenance === 'object' ? body.provenance : {};
  for (const f of TRUTH_FIELDS) {
    const v = text(given[f], MAX_VALUE, f);
    if (f === 'configuration' && v !== null && !CONFIGURATIONS.includes(v)) throw bad('configuration not in the list');
    const p = Array.isArray(prov[f]) ? [...new Set(prov[f].filter((x) => PROVENANCE.includes(x)))] : [];
    if (v !== null && p.length === 0) throw bad(`${f}: a confirmed value needs a provenance`);
    identity[f] = v;
    if (v !== null) provenance[f] = p;
  }
  const condition = text(body?.condition, 20, 'condition');
  if (condition === null) throw bad('condition: choose one (Unknown is a choice)');
  if (!CONDITIONS.includes(condition)) throw bad('condition not in the list');
  return {
    identity, provenance, condition,
    condition_notes: text(body?.condition_notes, MAX_NOTE, 'condition_notes'),
    notes: text(body?.notes, MAX_NOTE, 'notes'),
  };
}

// ── PHOTOGRAPH HEADERS: format and pixel size, from the bytes alone ─────────
// The platform's own Web Crypto, as the session verifier uses: no dependency is added to the server.
export const sha256Hex = async (buf) => Buffer.from(await crypto.subtle.digest('SHA-256', buf)).toString('hex');

export function imageInfo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { format: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return { format: 'jpeg', width: null, height: null };
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buf.length >= 30) return { format: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8L' && buf.length >= 25) { const b = buf.readUInt32LE(21); return { format: 'webp', width: 1 + (b & 0x3FFF), height: 1 + ((b >> 14) & 0x3FFF) }; }
    if (chunk === 'VP8 ' && buf.length >= 30) return { format: 'webp', width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
    return { format: 'webp', width: null, height: null };
  }
  return null;
}
