// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE IDENTITY SUFFICIENCY GATE
//
// The question is NOT "is the identity certain?". It is: "is what is still
// uncertain likely to change what this item is worth?"
//
//   A blender whose name was read off its own front panel is searchable, even
//   though nobody knows its internal SKU. The SKU would not move the price.
//
//   A mouse that could be any of four products of one brand is not, because
//   those four sell for materially different amounts and a search for "all of
//   them" prices none of them.
//
// So the gate separates IDENTITY uncertainty from VALUATION-RELEVANT identity
// uncertainty, and asks for a photograph only for the second kind.
//
// DETERMINISTIC. The model reports a reading; this file decides what the
// reading is enough for. The model's `missing_evidence` chooses WHICH label to
// ask for. It never decides WHETHER to ask.
//
// THREE ANSWERS. SEARCH_NOW and NEED_FOLLOWUP are the two a scan normally gets.
// INSUFFICIENT is the terminal one: the follow-up was already used and the
// identity still cannot carry a price, so nothing is searched and the user is
// told what is missing instead of being shown a number.
// ══════════════════════════════════════════════════════════════════════════════
import { FOLLOWUP, LABEL_FOLLOWUPS, defaultFollowupFor, followupInstruction } from './followup.js';
import { V2_MAX_FOLLOWUPS } from './config.js';

export const DECISION = Object.freeze({
  SEARCH_NOW: 'SEARCH_NOW',
  NEED_FOLLOWUP: 'NEED_FOLLOWUP',
  INSUFFICIENT: 'INSUFFICIENT',
});

/** What the search and the evidence gate will be asked about. */
export const IDENTITY_LEVEL = Object.freeze({
  PRODUCT: 'product',             // brand + model
  CANDIDATES: 'candidates',       // brand + a shortlist whose members sell alike
  BRAND_CLASS: 'brand_class',     // brand + kind of object, no model
  GENERIC: 'generic',             // kind of object, no brand
  NONE: 'none',
});

export const THRESHOLD = Object.freeze({
  BRAND: 0.6,            // below this a brand is not established
  MODEL_STRONG: 0.75,    // a model that was seen, not read, needs this
  MODEL_PLAUSIBLE: 0.5,  // enough when nothing materially different competes
  RIVAL_MARGIN: 0.25,    // how far a seen model must lead a different product
  RIVAL_FLOOR: 0.2,      // a candidate below this is not a rival
  PRICE_ALIKE_RATIO: 1.3, // candidates within this ratio are priced alike
});

// In these categories the model IS the value: two products of one brand and
// one kind differ by multiples. Elsewhere a brand and a kind of object is what
// a buyer searches for, and a label would not change the market they find.
export const MODEL_DEFINES_VALUE = Object.freeze(new Set(['Electronics', 'Watches', 'Vehicles']));

const READ = new Set(['TEXT_READ', 'LABEL_READ']);
const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const subset = (a, b) => a.length > 0 && a.every((t) => b.includes(t));

/**
 * Are two model names the SAME product line, one merely more specific?
 *
 * "PlayStation 5" and "PlayStation 5 Slim" are: every word of one is in the
 * other. "G Pro Wireless" and "G Pro X Superlight" are not, and neither are
 * "G305" and "G703". Containment, rather than overlap, because sibling products
 * of one brand share most of their words by design.
 */
export function sameProductLine(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  return subset(x, y) || subset(y, x);
}

/** Candidates that are a DIFFERENT product from `model`, and from each other. */
function materialRivals(identity) {
  const model = identity.model?.value ?? null;
  const out = [];
  for (const c of identity.ranked_candidates ?? []) {
    if (!c?.model || (c.confidence ?? 0) < THRESHOLD.RIVAL_FLOOR) continue;
    if (model && sameProductLine(c.model, model)) continue;
    if (out.some((o) => sameProductLine(o.model, c.model))) continue;
    out.push(c);
  }
  return out;
}

/**
 * Do the candidates sell for about the same amount?
 *
 * `candidatePrices` maps a candidate's model name to a known price, where a
 * caller has one. With fewer than two known prices the answer is "unknown",
 * which is never treated as "alike".
 */
export function pricedAlike(rivals, candidatePrices) {
  if (!candidatePrices || typeof candidatePrices !== 'object') return null;
  const lookup = new Map(Object.entries(candidatePrices).map(([k, v]) => [tokens(k).join(' '), v]));
  const prices = rivals.map((r) => lookup.get(tokens(r.model).join(' ')))
    .filter((p) => typeof p === 'number' && Number.isFinite(p) && p > 0);
  if (prices.length < 2 || prices.length < rivals.length) return null;
  return Math.max(...prices) / Math.min(...prices) <= THRESHOLD.PRICE_ALIKE_RATIO;
}

function followupFor(identity, language, { preferLabel = true } = {}) {
  const asked = identity.missing_evidence;
  const type = (asked && asked !== FOLLOWUP.NONE && (!preferLabel || LABEL_FOLLOWUPS.has(asked)))
    ? asked
    : defaultFollowupFor(identity);
  return { type, instruction: followupInstruction(type, language) };
}

/**
 * SEARCH_NOW, NEED_FOLLOWUP or INSUFFICIENT.
 *
 * Returns { decision, level, reasons, followup, signals }. `followup` is
 * non-null exactly when the decision is NEED_FOLLOWUP.
 */
export function decideSufficiency(identity, {
  followupsUsed = 0,
  candidatePrices = null,
  language = 'en',
} = {}) {
  const id = identity && typeof identity === 'object' ? identity : {};
  const model = id.model?.value ?? null;
  const modelConf = id.model?.confidence ?? 0;
  const modelRead = !!model && READ.has(id.model?.evidence);
  const rivals = materialRivals(id);
  const topRival = rivals.reduce((m, r) => Math.max(m, r.confidence ?? 0), 0);
  // WHY the model is established, or null. Decided FIRST and from the identity
  // alone: a category is never consulted here, so a category can never take an
  // established model away.
  const modelBasis = !model ? null
    : (modelRead ? 'model_read_off_item'
      : (rivals.length === 0 && modelConf >= THRESHOLD.MODEL_PLAUSIBLE ? 'model_recognised_without_a_competing_product'
        : (modelConf >= THRESHOLD.MODEL_STRONG && modelConf - topRival >= THRESHOLD.RIVAL_MARGIN
          ? 'model_clearly_ahead_of_competing_products' : null)));
  // A product that is established names its maker: "PlayStation 5" beside a
  // brand the model was only half sure of is still a Sony PlayStation 5.
  const brandOk = !!id.brand?.value
    && ((id.brand.confidence ?? 0) >= THRESHOLD.BRAND || READ.has(id.brand?.evidence) || modelBasis !== null);
  const mayAsk = followupsUsed < V2_MAX_FOLLOWUPS;
  const alike = pricedAlike(rivals, candidatePrices);

  const signals = {
    brand_established: brandOk,
    model_established: modelBasis !== null,
    model_read_off_item: modelRead,
    model_confidence: modelConf,
    material_rivals: rivals.map((r) => r.model),
    top_rival_confidence: topRival,
    candidates_priced_alike: alike,
    followups_used: followupsUsed,
  };
  const answer = (decision, level, reasons, followup = null) => ({ decision, level, reasons, followup, signals });
  const ask = (level, reasons, opts) => (mayAsk
    ? answer(DECISION.NEED_FOLLOWUP, level, reasons, followupFor(id, language, opts))
    : answer(DECISION.INSUFFICIENT, level, [...reasons, 'followup_already_used']));

  // ── NOTHING RECOGNISABLE ────────────────────────────────────────────────
  if (!id.object_class && !brandOk && !model) {
    const type = id.missing_evidence === FOLLOWUP.BETTER_LIGHT ? FOLLOWUP.BETTER_LIGHT : FOLLOWUP.FRONT_VIEW;
    return mayAsk
      ? answer(DECISION.NEED_FOLLOWUP, IDENTITY_LEVEL.NONE, ['nothing_recognisable'],
        { type, instruction: followupInstruction(type, language) })
      : answer(DECISION.INSUFFICIENT, IDENTITY_LEVEL.NONE, ['nothing_recognisable', 'followup_already_used']);
  }

  // ── NO BRAND: A KIND OF OBJECT ──────────────────────────────────────────
  //
  // Its market is other objects of the same kind, and for a shelf or a sofa no
  // label changes that. Two cases are worth one photograph: the frame was too
  // dark to read, or this is a category where the model is the value and the
  // model saw a label that would name it.
  if (!brandOk) {
    const dark = id.missing_evidence === FOLLOWUP.BETTER_LIGHT;
    const labelWouldNameIt = modelBasis === null
      && MODEL_DEFINES_VALUE.has(id.category) && LABEL_FOLLOWUPS.has(id.missing_evidence);
    if (mayAsk && (dark || labelWouldNameIt)) {
      return answer(DECISION.NEED_FOLLOWUP, IDENTITY_LEVEL.GENERIC,
        [dark ? 'photograph_too_dark_to_read' : 'no_brand_and_a_label_would_name_the_product'],
        followupFor(id, language, { preferLabel: false }));
    }
    return answer(DECISION.SEARCH_NOW, IDENTITY_LEVEL.GENERIC, ['no_brand_searched_as_a_kind_of_object']);
  }

  // ── BRAND AND MODEL ─────────────────────────────────────────────────────
  //
  // Whatever else is uncertain — the edition, the capacity, the SKU — an
  // established product is searched. Nothing below this line can ask about it.
  if (modelBasis !== null) return answer(DECISION.SEARCH_NOW, IDENTITY_LEVEL.PRODUCT, [modelBasis]);

  // ── BRAND, AND SEVERAL DIFFERENT PRODUCTS IT COULD BE ───────────────────
  if (rivals.length > 0) {
    if (alike === true) {
      return answer(DECISION.SEARCH_NOW, IDENTITY_LEVEL.CANDIDATES, ['competing_products_are_priced_alike']);
    }
    return ask(IDENTITY_LEVEL.BRAND_CLASS, ['competing_products_may_be_priced_differently']);
  }

  // ── BRAND, NO MODEL, NOTHING COMPETING ──────────────────────────────────
  //
  // A CATEGORY NEVER ASKS ON ITS OWN. A photograph is requested only when the
  // identity itself says one would help — the reading named a label that would
  // settle the model — AND the model is what the value turns on. "A Samsung
  // phone" with a label in reach is worth one photograph; a brand and a kind of
  // object with nothing further to read is searched as exactly that.
  if (MODEL_DEFINES_VALUE.has(id.category) && LABEL_FOLLOWUPS.has(id.missing_evidence)) {
    return ask(IDENTITY_LEVEL.BRAND_CLASS, ['no_model_and_a_label_would_name_it']);
  }
  return answer(DECISION.SEARCH_NOW, IDENTITY_LEVEL.BRAND_CLASS, ['brand_and_kind_of_object_is_what_is_searched']);
}
