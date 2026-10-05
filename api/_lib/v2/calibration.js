// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — CALIBRATED IDENTITY CONFIDENCE, AND WHAT THE TEXT IS
//
// ── A NUMBER THE MODEL WROTE IS NOT A PROBABILITY ───────────────────────────
//
// The vision call reports a confidence beside each field, and it reports
// 0.98 for a name it READ off a front panel and 0.98 for a silhouette it
// RECOGNISED. Those are not the same claim. The first can be checked against
// the text the model itself read (identity.js does); the second rests on how
// the item looked, which cannot be checked at all.
//
// So every field also carries a CALIBRATED confidence: the model's number,
// capped by what its evidence can support. A cap only lowers; agreement never
// raises a number past its evidence. The order is the one the product order
// gives:
//
//   read off the item (text, label)  >  packaging  >  logo  >  shape  >  nothing
//
// and a LOGO names a MAKER, so beside a model it is worth less than beside a
// brand. The sufficiency gate reads the calibrated number.
//
// ── WHAT THE VISIBLE TEXT IS ────────────────────────────────────────────────
//
// "NINJA / BLENDSENSE / POWER BLENDER DUO PRO" are not three equal strings.
// Each line is given a role, deterministically, from what the identity
// established and from its own shape: the brand, the model name, a model
// number, a capacity or dimension, a regulatory marking, or other text.
// ══════════════════════════════════════════════════════════════════════════════
import { identifiersIn } from './market-identity.js';

/** The most a field's confidence may be, by what it rests on. */
export const EVIDENCE_CAP = Object.freeze({ TEXT_READ: 1, LABEL_READ: 1, PACKAGING: 0.9, LOGO: 0.9, SHAPE: 0.8, NONE: 0 });
/** A logo names a maker; beside a model it is worth this at most. */
export const MODEL_LOGO_CAP = 0.6;

export const TEXT_ROLE = Object.freeze({
  BRAND: 'BRAND', MODEL: 'MODEL', MODEL_NUMBER: 'MODEL_NUMBER', CAPACITY: 'CAPACITY',
  REGULATORY: 'REGULATORY', OTHER: 'OTHER',
});

const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const CAPACITY = /^\d+([.,]\d+)?\s?(gb|tb|mb|ml|l|w|kw|mah|wh|mm|cm|m|in|inch|"|oz|fl\.?\s?oz|hz|v|a|lbs?|kg|g)$/i;
const REGULATORY = /\b(ce|fcc|ic|ul|rohs|weee|etl|csa|made in|input|output|v~|hz|serial|s\/n|sn)\b|[0-9]{2,3}-[0-9]{3}v/i;

/** The field with its calibrated confidence beside the model's own. */
export function calibrateField(field, role = 'other') {
  const f = field && typeof field === 'object' ? field : { value: null, confidence: 0, evidence: 'NONE' };
  const raw = typeof f.confidence === 'number' && Number.isFinite(f.confidence) ? Math.min(1, Math.max(0, f.confidence)) : 0;
  const cap = f.value === null ? 0
    : (role === 'model' && f.evidence === 'LOGO' ? MODEL_LOGO_CAP : (EVIDENCE_CAP[f.evidence] ?? 0));
  return { ...f, calibrated_confidence: Math.min(raw, cap) };
}

/** The calibrated confidence of a field, or its raw one for an uncalibrated identity. */
export const confidenceOf = (field) => (typeof field?.calibrated_confidence === 'number' ? field.calibrated_confidence : (field?.confidence ?? 0));

/** One role per line of visible text. Decides nothing; shows what was read. */
export function classifyVisibleText({ visible_text = [], brand = null, model = null, model_number = null } = {}) {
  const brandToks = new Set(tokens(brand?.value));
  const modelToks = new Set(tokens(model?.value));
  const number = String(model_number?.value ?? '').toUpperCase();
  return (Array.isArray(visible_text) ? visible_text : []).map((text) => {
    const toks = tokens(text);
    const compact = String(text ?? '').replace(/\s+/g, '');
    let role = TEXT_ROLE.OTHER;
    if (toks.length > 0 && toks.every((t) => brandToks.has(t))) role = TEXT_ROLE.BRAND;
    else if (number && identifiersIn(text).some((i) => i.id === number || i.root === number)) role = TEXT_ROLE.MODEL_NUMBER;
    else if (toks.length > 0 && toks.every((t) => modelToks.has(t))) role = TEXT_ROLE.MODEL;
    else if (CAPACITY.test(compact)) role = TEXT_ROLE.CAPACITY;
    else if (REGULATORY.test(String(text ?? ''))) role = TEXT_ROLE.REGULATORY;
    else if (identifiersIn(text).length > 0 && toks.length <= 3) role = TEXT_ROLE.MODEL_NUMBER;
    return { text, role };
  });
}
