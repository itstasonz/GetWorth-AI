// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — ONE-CALL IDENTITY
//
// ONE vision call answers what V1 asked four calls: what the item is, how sure
// that is, what else it could be, what condition it is in, and which single
// photograph would settle what is still open.
//
// It answers NOTHING about price. There is no valuation field, no search, and
// no prose: every field is a short value, an enum or a number, because a model
// that is asked to explain itself spends seconds doing so and the explanation
// is read by nobody.
//
// ── THE MODEL DOES NOT DECIDE WHAT ITS ANSWER IS WORTH ──────────────────────
//
// It reports a reading. Whether that reading is enough to search the market is
// decided in sufficiency.js, by code, from the fields below. `missing_evidence`
// is the model's view of which photograph would help, and it is an input to
// that decision, never the decision.
//
// A claim to have READ a name is checked here against the text the model says
// it read: `TEXT_READ` beside a name that does not occur in `visible_text` is
// lowered to `SHAPE`, because the difference between reading a model number and
// recognising a silhouette is the whole of the sufficiency question.
// ══════════════════════════════════════════════════════════════════════════════
import { CANONICAL_CATEGORIES } from '../category.js';
import { stripDataUriPrefix, detectImageMime, extractOpenAIJson } from '../openai-recognition.js';
import { FENCE_RULE, fence, promptSafe, promptSafeList } from '../prompt-trust.js';
import { streamResponse } from './openai-stream.js';
import { FOLLOWUP, FOLLOWUP_TYPES, followupInstruction } from './followup.js';
import { V2_IDENTIFY_TIMEOUT_MS, V2_IDENTITY_MAX_OUTPUT_TOKENS } from './config.js';
import { CONFIGURATION, CONFIGURATIONS } from './configuration.js';
import { calibrateField, classifyVisibleText } from './calibration.js';

export const FIELD_EVIDENCE = Object.freeze(['TEXT_READ', 'LABEL_READ', 'LOGO', 'PACKAGING', 'SHAPE', 'NONE']);
export const IDENTITY_EVIDENCE = Object.freeze(['MODEL_TEXT_READ', 'BRAND_TEXT_READ', 'LABEL_READ', 'LOGO', 'PACKAGING', 'SHAPE_ONLY']);
export const CONDITION_GRADES = Object.freeze(['New', 'Like New', 'Good', 'Fair', 'Poor', 'Parts', 'Unknown']);
export const CONDITION_SIGNALS = Object.freeze([
  'scratches', 'cracks', 'wear', 'dents', 'discoloration', 'screen_damage', 'missing_parts',
  'box_present', 'sealed_packaging', 'clean',
]);
export const MAX_CANDIDATES = 4;
export const MAX_HYPOTHESES = 3;
const MAX_VISIBLE_TEXT = 10;

const nullable = { type: ['string', 'null'] };
const conf = { type: 'number', minimum: 0, maximum: 1 };
const strict = (properties) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const field = () => strict({ value: nullable, confidence: conf, evidence: { type: 'string', enum: [...FIELD_EVIDENCE] } });

// KEY ORDER IS GENERATION ORDER. What was read comes before what was decided,
// so a name cannot be committed to and then "read" to match it.
export const V2_IDENTITY_SCHEMA = strict({
  category: { type: 'string', enum: [...CANONICAL_CATEGORIES] },
  object_class: nullable,
  local_name: nullable,
  visible_text: { type: 'array', maxItems: MAX_VISIBLE_TEXT, items: { type: 'string' } },
  brand: field(),
  model: field(),
  variant: field(),
  // The manufacturer's number, when it is PRINTED on the item or its label.
  // Kept only when read (normalizeIdentity): a number from memory is a
  // hypothesis and belongs below.
  model_number: field(),
  ranked_candidates: {
    type: 'array', maxItems: MAX_CANDIDATES,
    items: strict({ brand: nullable, model: nullable, variant: nullable, confidence: conf, distinguishing_evidence: nullable }),
  },
  condition: strict({
    grade: { type: 'string', enum: [...CONDITION_GRADES] },
    observations: { type: 'array', maxItems: 4, items: { type: 'string', enum: [...CONDITION_SIGNALS] } },
  }),
  identity_evidence: { type: 'array', maxItems: 4, items: { type: 'string', enum: [...IDENTITY_EVIDENCE] } },
  // What the PHOTOGRAPH shows: the whole product, or a base, a box, a part.
  // A charging case is not the earbuds, and the search must know which it has.
  configuration: { type: 'string', enum: [...CONFIGURATIONS] },
  missing_evidence: { type: 'string', enum: [...FOLLOWUP_TYPES] },
  // SEARCH HYPOTHESES, NOT IDENTITY. What is printed on an item is not always
  // what it is sold as: a panel says "POWER BLENDER DUO PRO" and the shops list
  // a model number. These come from the model's memory, so they may be wrong,
  // and they are used for exactly one thing — to phrase a search. Whether one
  // of them names this product is decided afterwards, from what the search
  // returned, in market-identity.js.
  market_hypotheses: strict({
    aliases: { type: 'array', maxItems: MAX_HYPOTHESES, items: { type: 'string' } },
    model_numbers: { type: 'array', maxItems: MAX_HYPOTHESES, items: { type: 'string' } },
  }),
});

const FIELDS = `category: the closest category.
object_class: a plain English noun for the object, e.g. "gaming mouse". null only when nothing is recognisable.
local_name: what a seller in Israel would call this kind of object in Hebrew, 1-4 words.
visible_text: exact strings printed on the item. Empty when none.
brand, model, variant: value, confidence 0-1, and what it rests on. "model" is the name a buyer would search for ("Power Blender Duo Pro", "PlayStation 5", "Air Jordan 1 Mid"); it does not have to be a manufacturer part number. value is null when the photograph does not establish it. evidence is TEXT_READ or LABEL_READ only when the value itself is printed on the item.
model_number: the manufacturer's model or part number ONLY when it is printed on the item, its label or its packaging ("TB301", "MR0089", "A2633"). value is null when none is visible; never from memory.
ranked_candidates: when the model is not established, up to ${MAX_CANDIDATES} products it could be, most likely first, each with at most six words on what would tell it apart. Empty when the model is established or nothing narrows it.
condition: visible condition only. Unknown when the photograph does not show it.
identity_evidence: what the identity rests on.
configuration: what the photograph shows. COMPLETE: the whole product. BASE_ONLY: the main unit without its jug, cups, controller or other parts. ACCESSORY_ONLY: only a case, charger, strap, cup, remote or other accessory. BOX_ONLY: packaging alone. REPLACEMENT_PART: a part. BUNDLE: several units. PARTS: visibly broken. UNKNOWN when it cannot be told.
missing_evidence: the ONE further photograph that would settle the exact model, or NONE when it is settled or no photograph could settle it.
market_hypotheses: names or model numbers this exact product is SOLD under that are NOT printed on it, from your own knowledge, most likely first. They are guesses used only to search. Empty when you know none.`;

export function buildIdentityPrompt() {
  return `Identify the item in the photograph for a second-hand marketplace.

${FIELDS}

Do not estimate a price. Do not explain.`;
}

/**
 * The follow-up prompt. The scan's existing state travels as DATA: it contains
 * text that was read off a product, which is not an instruction to anyone.
 */
export function buildFollowupPrompt({ prior, requested } = {}) {
  const p = prior || {};
  return `This photograph is a FOLLOW-UP to an earlier photograph of the same item. It was requested to show: ${promptSafe(followupInstruction(requested, 'en') ?? 'a clearer view')}

${FENCE_RULE}

WHAT THE FIRST PHOTOGRAPH ESTABLISHED (data, may be incomplete)
${fence('SCAN_STATE', [
    `category: ${promptSafe(p.category ?? '')}`,
    `object_class: ${promptSafe(p.object_class ?? '')}`,
    `brand: ${promptSafe(p.brand?.value ?? '')}`,
    `model: ${promptSafe(p.model?.value ?? '')}`,
    `candidates: ${promptSafeList((p.ranked_candidates ?? []).map((c) => [c.brand, c.model, c.variant].filter(Boolean).join(' ')), { items: MAX_CANDIDATES })}`,
    `text_already_read: ${promptSafeList(p.visible_text ?? [], { items: MAX_VISIBLE_TEXT })}`,
  ].join('\n'))}

Read THIS photograph and resolve what was left open. Report what this photograph shows; do not repeat a candidate it does not support.

${FIELDS}

Do not estimate a price. Do not explain.`;
}

// ── NORMALISATION ───────────────────────────────────────────────────────────
const UNKNOWN = /^(unidentified|unknown|none|n\/a|null|generic|unbranded|no brand)$/i;
const READ_EVIDENCE = new Set(['TEXT_READ', 'LABEL_READ']);
const text = (v, max = 80) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s && !UNKNOWN.test(s) ? s.slice(0, max) : null;
};
const clamp01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Does every word of `value` occur in the text read off the item? */
export function occursInText(value, visibleText) {
  const want = tokens(value);
  if (want.length === 0) return false;
  const have = new Set((Array.isArray(visibleText) ? visibleText : []).flatMap(tokens));
  return want.every((t) => have.has(t));
}

function normalizeField(raw, visibleText) {
  const value = text(raw?.value);
  if (!value) return { value: null, confidence: 0, evidence: 'NONE' };
  let evidence = oneOf(raw?.evidence, FIELD_EVIDENCE, 'SHAPE');
  if (evidence === 'NONE') evidence = 'SHAPE';
  // "Read" is a claim about the item, and the item's text is right here.
  if ((evidence === 'TEXT_READ' || evidence === 'LABEL_READ') && !occursInText(value, visibleText)) evidence = 'SHAPE';
  return { value, confidence: clamp01(raw?.confidence), evidence };
}

/**
 * The model's answer as the contract the rest of V2 reads.
 *
 * Total: any input yields a well-formed identity. An absent or malformed field
 * becomes "not established", never a default name.
 */
export function normalizeIdentity(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const visibleText = [...new Set((Array.isArray(r.visible_text) ? r.visible_text : [])
    .map((v) => text(v, 60)).filter(Boolean))].slice(0, MAX_VISIBLE_TEXT);
  const brand = calibrateField(normalizeField(r.brand, visibleText), 'brand');
  const model = calibrateField(normalizeField(r.model, visibleText), 'model');
  const variant = calibrateField(normalizeField(r.variant, visibleText), 'variant');
  // A model number is identity only when it was READ: normalizeField has
  // already lowered a "read" claim the text does not bear to SHAPE, and a
  // number that was not read is not kept at all.
  const numberRead = normalizeField(r.model_number, visibleText);
  const modelNumber = calibrateField(READ_EVIDENCE.has(numberRead.evidence) && /\p{N}/u.test(numberRead.value ?? '')
    ? { ...numberRead, value: numberRead.value.replace(/^(?:m\/n|model|p\/n|דגם)\s*[:.]?\s*/iu, '').trim().slice(0, 24) || null }
    : { value: null, confidence: 0, evidence: 'NONE' }, 'model');

  const seen = new Set();
  const candidates = [];
  for (const c of Array.isArray(r.ranked_candidates) ? r.ranked_candidates : []) {
    const m = text(c?.model);
    if (!m) continue;
    const key = tokens(m).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      brand: text(c?.brand) ?? brand.value,
      model: m,
      variant: text(c?.variant),
      confidence: clamp01(c?.confidence),
      distinguishing_evidence: text(c?.distinguishing_evidence, 60),
    });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    category: oneOf(r.category, CANONICAL_CATEGORIES, 'Other'),
    object_class: text(r.object_class, 60),
    local_name: text(r.local_name, 40),
    visible_text: visibleText,
    visible_text_roles: classifyVisibleText({ visible_text: visibleText, brand, model, model_number: modelNumber }),
    brand,
    model,
    variant,
    model_number: modelNumber,
    configuration: oneOf(r.configuration, CONFIGURATIONS, CONFIGURATION.UNKNOWN),
    ranked_candidates: candidates.slice(0, MAX_CANDIDATES),
    condition: {
      grade: oneOf(r.condition?.grade, CONDITION_GRADES, 'Unknown'),
      observations: [...new Set((Array.isArray(r.condition?.observations) ? r.condition.observations : [])
        .filter((s) => CONDITION_SIGNALS.includes(s)))].slice(0, 4),
    },
    identity_evidence: [...new Set((Array.isArray(r.identity_evidence) ? r.identity_evidence : [])
      .filter((s) => IDENTITY_EVIDENCE.includes(s)))].slice(0, 4),
    missing_evidence: oneOf(r.missing_evidence, FOLLOWUP_TYPES, FOLLOWUP.NONE),
    market_hypotheses: normalizeHypotheses(r.market_hypotheses, [brand.value, model.value]),
  };
}

/** Distinct, bounded, and never a restatement of what was already read. */
function normalizeHypotheses(raw, known) {
  const knownKeys = new Set(known.filter(Boolean).map((k) => tokens(k).join(' ')));
  const list = (v, max) => {
    const seen = new Set();
    const out = [];
    for (const x of Array.isArray(v) ? v : []) {
      const s = text(x, max);
      const key = tokens(s).join(' ');
      if (!s || !key || seen.has(key) || knownKeys.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_HYPOTHESES) break;
    }
    return out;
  };
  return { aliases: list(raw?.aliases, 60), model_numbers: list(raw?.model_numbers, 24) };
}

/**
 * The identity call. ONE request; no retry, no second model.
 *
 * Resolves to { identity, raw, meta } or throws. `prior` and `requested` make
 * it the follow-up call: the same single request, with the scan's state in the
 * prompt and only the NEW photograph attached.
 */
export async function identifyItem({
  image,
  prior = null,
  requested = null,
  model,
  apiKey,
  timeoutMs = V2_IDENTIFY_TIMEOUT_MS,
  safetyIdentifier = null,
  fetchImpl = fetch,
} = {}) {
  const b64 = stripDataUriPrefix(image);
  if (!b64) throw new Error('[OpenAI] no images supplied');
  const body = {
    model,
    input: [{ role: 'user', content: [
      { type: 'input_image', image_url: `data:${detectImageMime(b64)};base64,${b64}`, detail: 'high' },
      { type: 'input_text', text: prior ? buildFollowupPrompt({ prior, requested }) : buildIdentityPrompt() },
    ] }],
    // `store` defaults to TRUE; a scanned photograph must not become a copy
    // that no GetWorth deletion can reach.
    store: false,
    ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    reasoning: { effort: 'none' },
    max_output_tokens: V2_IDENTITY_MAX_OUTPUT_TOKENS,
    text: { format: { type: 'json_schema', name: 'getworth_v2_identity', schema: V2_IDENTITY_SCHEMA, strict: true } },
  };
  const res = await streamResponse({ stage: 'v2_identity', body, apiKey, timeoutMs, fetchImpl });
  const raw = extractOpenAIJson(res.final);
  return {
    identity: normalizeIdentity(raw),
    meta: { model: res.model, timings: res.timings, usage: res.usage, billed: res.billed },
  };
}
