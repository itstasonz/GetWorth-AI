// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — B7 · GETWORTH VALIDATION
//
// §1 in one line: AI PROVIDES EVIDENCE. GETWORTH GRANTS AUTHORITY.
//
// Everything upstream of this file is a CLAIM made by a model. This is where a
// claim is checked against GetWorth's own rules, and where the distinction §11
// demands — model confidence vs GetWorth corroboration vs GetWorth authority —
// becomes three separate fields rather than one number with three meanings.
//
// ── THE SUBJECT/REFERENCE CHECK IS THE ONE THAT MATTERS ────────────────────
//
// §9 says OpenAI "may provide additional evidence. It does not bypass that
// boundary." The boundary is REC7-C1, implemented in api/_lib/pricing-authority.js
// and mutation-covered on the Phase-A side. So the OCR block is classified with
// the SAME `classifyOcrBlock`, and if that block is reference-bearing then a
// Phase-B subject that merely echoes a name from it is NOT corroborated by text.
//
// The model's own `references` array is used too, but only to REFUTE, never to
// corroborate — it is model output, and a model that has confused an accessory
// for its host will confidently say the host is the subject. A claim cannot
// corroborate itself; that is the SCAN-022 lesson this repository has recorded
// twice, most recently as H-5 (`raw_texts` corroborating the same model's own
// brand candidate).
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
//
// It does not grant ANCHOR, does not select an envelope from Phase-B evidence,
// does not write anything, and does not promote. §23 requires a read-only
// candidate; the guard is applied to BOUND the candidate, not to bless it.
// ══════════════════════════════════════════════════════════════════════════════
import {
  classifyOcrBlock, RELATION, confidence as parseConfidence,
} from '../pricing-authority.js';
import { validateQuote, resolveEnvelope, IDENTITY_TIER } from '../valuation-guard.js';
import { VALUATION_STATUS } from './valuation.js';

export const CORROBORATION = Object.freeze({
  READ_OFF_ITEM: 'read_off_item',        // the name occurs in independently-read text
  CATALOG: 'catalog',                    // a GetWorth row agrees
  MODEL_CLAIM_ONLY: 'model_claim_only',  // OpenAI said so and nothing else did
  CONTRADICTED: 'contradicted',          // the block says this is a reference
});

/** Lower-cased alphanumeric words, matching the Phase-A tokenisation closely enough to compare names. */
function words(text) {
  return String(text ?? '')
    .normalize('NFKC').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function phrasePresent(needle, haystack) {
  const n = words(needle);
  if (!n.length) return false;
  for (let i = 0; i + n.length <= haystack.length; i++) {
    let ok = true;
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/**
 * Was the Phase-B subject genuinely read off the item, or merely asserted?
 *
 * The OCR block is classified by the SAME rule the Phase-A evidence path uses.
 * A reference-bearing block cannot corroborate a subject name — which is
 * exactly the accessory case: a strap's packaging names ROLEX SUBMARINER, and
 * that text is evidence of a RELATIONSHIP, not of the subject's identity.
 */
export function corroborateSubject({ identity, ocrText = null, catalogCandidates = [] } = {}) {
  const subject = identity?.subject || {};
  const brand = subject.brand;
  const model = subject.model;

  const blockText = Array.isArray(ocrText) ? ocrText.join('\n') : String(ocrText ?? '');
  const provenance = classifyOcrBlock(blockText);
  const textUsable = !!(provenance && provenance.subject_text_permitted);
  const subjectWords = textUsable
    ? provenance.lines.filter((l) => l.relation === RELATION.SUBJECT).flatMap((l) => l.words)
    : [];

  // REFUTATION. If the block is reference-bearing AND the claimed subject name
  // appears in it, the model has very likely promoted a referenced product.
  const allWords = provenance ? provenance.lines.flatMap((l) => l.words) : [];
  const nameInBlock = (v) => !!v && phrasePresent(v, allWords);
  const contradicted = !!provenance
    && provenance.block_relation === RELATION.REFERENCE
    && (nameInBlock(brand) || nameInBlock(model));

  // The model's OWN references array, used only to refute.
  const claimedAsReference = (Array.isArray(identity?.references) ? identity.references : [])
    .some((r) => (brand && String(r?.brand ?? '').toLowerCase() === String(brand).toLowerCase())
              && (!model || String(r?.model ?? '').toLowerCase() === String(model).toLowerCase()));

  const brandRead = textUsable && !!brand && phrasePresent(brand, subjectWords);
  const modelRead = textUsable && !!model && phrasePresent(model, subjectWords);

  const catalogAgrees = (Array.isArray(catalogCandidates) ? catalogCandidates : []).some((row) => {
    const rb = String(row?.brand ?? '').toLowerCase();
    const rm = String(row?.model ?? '').toLowerCase();
    return brand && rb === String(brand).toLowerCase() && (!model || rm === String(model).toLowerCase());
  });

  let level = CORROBORATION.MODEL_CLAIM_ONLY;
  if (contradicted || claimedAsReference) level = CORROBORATION.CONTRADICTED;
  else if (brandRead || modelRead) level = CORROBORATION.READ_OFF_ITEM;
  else if (catalogAgrees) level = CORROBORATION.CATALOG;

  return {
    level,
    brand_read_off_item: brandRead,
    model_read_off_item: modelRead,
    catalog_agrees: catalogAgrees,
    block_relation: provenance ? provenance.block_relation : RELATION.UNKNOWN,
    subject_text_permitted: textUsable,
    contradicted_by_block: contradicted,
    contradicted_by_model_references: claimedAsReference,
  };
}

/**
 * Apply GetWorth's own valuation guard to the Phase-B candidate.
 *
 * §13 of the development order: the guard is INTEGRATED, not reimplemented. The
 * candidate is offered to `validateQuote` exactly as a Phase-A quote would be,
 * with an evidence set that reflects what Phase B actually established.
 *
 * EVIDENCE IS DELIBERATELY CONSERVATIVE. Phase B contributes DERIVED plus, at
 * most, the text classes its corroboration genuinely earned. It never
 * contributes ANCHOR: §1 forbids OpenAI output becoming a trusted catalog
 * anchor, and ANCHOR satisfies every bucket requirement in the guard.
 */
export function applyGuard({
  valuationCandidate, identity, corroboration, recognition = null, marketEvidence = null,
} = {}) {
  if (!valuationCandidate || valuationCandidate.status !== VALUATION_STATUS.PRICED) {
    return {
      applied: false,
      reason: 'no priced candidate to validate',
      action: null,
      prices: { low: 0, mid: 0, high: 0 },
      violations: [],
      market_evidence: null,
    };
  }

  // The report was produced upstream, by qualifyMarketEvidence, from the RAW
  // observations — see the pipeline. Its `token` is the only thing that grants,
  // and it is null unless the whole set qualified.
  const market = marketEvidence ?? { token: null, qualified: false, counts: { admitted: 0, considered: 0 }, distinct_sources: 0, set_failures: [], disqualified: [] };

  const evidence = new Set(['DERIVED']);
  if (corroboration?.brand_read_off_item) evidence.add('BRAND_TEXT');
  if (corroboration?.model_read_off_item) evidence.add('PRODUCT_TEXT');
  if (corroboration?.catalog_agrees) evidence.add('CATALOG_IDENTITY');

  const subject = identity?.subject || {};
  const conf = parseConfidence(identity?.confidence?.overall);
  const identified = corroboration?.level === CORROBORATION.READ_OFF_ITEM
    || corroboration?.level === CORROBORATION.CATALOG;

  const ctx = {
    stage: 'stage2',
    // A Phase-B identity is never `identityHigh`: that tier unlocks the
    // narrowest spread bands, and it is not something a model claim may buy.
    identity: {
      brand: subject.brand ?? null,
      model: subject.model ?? null,
      brandOk: identified && !!subject.brand,
      modelOk: identified && !!subject.model,
      brandC: Number.isNaN(conf) ? 0 : conf,
      modelC: Number.isNaN(conf) ? 0 : conf,
      brandConfLabel: identified ? 'confirmed_by_text' : 'inferred_from_visuals',
    },
    recognition: recognition || {
      category: subject.category_candidate ?? null,
      subcategory: subject.object_class ?? null,
      product_type: subject.object_class ?? null,
      category_confidence: Number.isNaN(conf) ? 0 : conf,
      ocr_text: { raw_texts: [] },
    },
    evidence,
    anchor: null,              // §1: never a trusted catalog anchor
    anchorModelEvidence: false,
    comps: [],
    // Null unless qualification minted one. §3: OpenAI cannot put a value here
    // that means anything — the guard reads through the mint, not the field.
    market_evidence: market.token,
    // The class-level token travels in its OWN field, read by its own
    // predicate. A generic object's comparable set never arrives where
    // product-level evidence is expected.
    comparable_evidence: market.comparable_token ?? null,
  };

  let envelope = null;
  try { envelope = resolveEnvelope(ctx); } catch { envelope = null; }

  let verdict = null;
  let error = null;
  try {
    verdict = validateQuote({
      low: valuationCandidate.low,
      mid: valuationCandidate.mid,
      high: valuationCandidate.high,
      currency: valuationCandidate.currency,
      price_method: 'comp_based',
    }, ctx);
  } catch (err) {
    // FAIL CLOSED, exactly as the Phase-A composition point does: a guard
    // exception is treated as a rejection, never as a pass.
    error = err?.message || String(err);
  }

  return {
    applied: true,
    envelope_key: envelope?.key ?? null,
    envelope_hard_max: envelope?.hard_max ?? null,
    identity_tier: verdict?.metadata?.identity_tier ?? IDENTITY_TIER.CATEGORY_ONLY,
    action: verdict?.action ?? 'degrade',
    prices: verdict?.prices ?? { low: 0, mid: 0, high: 0 },
    pricing_grade: verdict?.metadata?.pricing_grade ?? null,
    needs_review: verdict?.metadata?.needs_review ?? true,
    violations: verdict?.violations ?? [],
    degraded_reason: verdict?.metadata?.degraded_reason ?? null,
    guard_error: error,
    evidence: [...evidence],
    market_evidence: {
      qualified: market.qualified,
      comparable_qualified: market.comparable_qualified === true,
      evidence_class: market.evidence_class ?? null,
      admitted: market.counts.admitted,
      considered: market.counts.considered,
      distinct_sources: market.distinct_sources,
      set_failures: market.set_failures,
      disqualified: market.disqualified.map((d) => ({
        title: d.observation?.title ?? null,
        source_domain: d.observation?.source_domain ?? null,
        reason: d.reason,
      })),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// THE IDENTITY CONTRACT  ·  what Phase B is allowed to do to Phase A's answer
//
// THE SECOND PRODUCTION WITNESS. Phase A looked at a Logitech mouse and
// narrowed it to two products — G Pro X Superlight (45%) and G Pro Wireless
// (40%) — then declined to choose. Phase B looked at the same photograph,
// proposed G703 / G403, and searched the market for those. One picture, two
// stages, two disjoint product families, and the second one silently won.
//
// Part of that was a plumbing bug: the shortlist never reached Phase B at all.
// But fixing the plumbing does not settle the question, because Phase B is
// SUPPOSED to be able to disagree — it is the open-world stage, and a stage
// that can only ratify the catalog is not an open-world stage.
//
// So the contract is about what a disagreement MEANS, not about preventing one:
//
//   CONFIRM   Phase B named something Phase A also named.
//   REFINE    Phase B named a narrower form of something Phase A named
//             (a variant inside a proposed family).
//   EXTEND    Phase A proposed nothing; Phase B is the only opinion there is.
//   CONFLICT  Both named models, and they share nothing.
//   UNKNOWN   Phase B named no model.
//
// WHAT A CONFLICT COSTS. Not the identity — Phase B keeps its answer, and a
// reader sees both. What it costs is SEARCH SPECIFICITY. Searching an exact
// model that two independent readings of the same photograph disagree about
// produces comparables for a product we have no reason to believe is the one in
// frame, and those comparables then look exactly like evidence. The honest
// search is the level the two readings still agree on — the brand and the kind
// of object — which is wider, correctly less precise, and actually about this
// photograph.
//
// This is the same doctrine as everywhere else in this module: uncertainty may
// only ever cost authority. A conflict is uncertainty that happens to be
// legible, and legible uncertainty must not be worth more than the quiet kind.
// ══════════════════════════════════════════════════════════════════════════════

export const IDENTITY_AGREEMENT = Object.freeze({
  CONFIRM: 'confirm',
  REFINE: 'refine',
  EXTEND: 'extend',
  CONFLICT: 'conflict',
  UNKNOWN: 'unknown',
});

/** Comparable tokens of a model string: lower-cased, alphanumeric, deduped. */
function modelTokens(value) {
  return new Set(words(value).filter((w) => w.length > 1 || /\d/.test(w)));
}

/**
 * Does `a` contain everything `b` names? Used for REFINE, where the narrower
 * answer must still carry the broader one's distinguishing words.
 */
function containsAll(a, b) {
  if (b.size === 0) return false;
  for (const t of b) if (!a.has(t)) return false;
  return true;
}

/**
 * Compare Phase B's proposed model against Phase A's ranked candidates.
 *
 * `phaseACandidates` is the shortlist the client forwards as
 * `existing_recognition.model_candidates`. It is UNTRUSTED input — a caller
 * could send anything — which is exactly why a match only ever WIDENS what is
 * permitted here and never narrows it: the worst a forged shortlist can do is
 * make a conflict look like agreement, and agreement grants nothing that
 * corroboration has not already granted separately.
 *
 * Total: any shape of input yields a verdict and never throws.
 */
export function reconcileIdentity(input) {
  // NOT a destructuring default. `reconcileIdentity(null)` throws against
  // `= {}`, because a default parameter only fires for `undefined` — the same
  // gap `qualifyMarketEvidence` records for `subject: null`. Totality is a
  // property this function claims, so it is established rather than assumed.
  const { identity, existingRecognition } = (input && typeof input === 'object') ? input : {};
  const proposed = typeof identity?.subject?.model === 'string' ? identity.subject.model : null;
  const brand = identity?.subject?.brand ?? null;
  const raw = Array.isArray(existingRecognition?.model_candidates)
    ? existingRecognition.model_candidates : [];
  const candidates = raw
    .map((c) => (typeof c === 'string' ? c : c?.model))
    .filter((m) => typeof m === 'string' && m.trim() && m.trim().toLowerCase() !== 'unidentified');

  const base = {
    phase_a_candidates: candidates.slice(0, 6),
    phase_b_model: proposed,
    // The level a market search may use. Only a CONFLICT lowers it.
    search_specificity_cap: null,
  };

  if (!proposed) {
    return { ...base, agreement: IDENTITY_AGREEMENT.UNKNOWN, conflict: false };
  }
  if (candidates.length === 0) {
    return { ...base, agreement: IDENTITY_AGREEMENT.EXTEND, conflict: false };
  }

  // BRAND-PREFIX TOLERANT. Phase A's shortlist carries display names that may
  // repeat the brand ("Logitech G Pro X Superlight") while Phase B returns the
  // model alone ("G Pro X Superlight"). Comparing those raw would report a
  // conflict between two spellings of one answer, which is the exact class of
  // bug this repository has recorded under "two implementations of one
  // predicate" — so the brand is removed from both sides before comparing.
  const brandToks = modelTokens(brand);
  // Built by FILTERING rather than by removing entries from a Set. PB-9a greps
  // this module's whole import closure for Supabase mutation verbs as a
  // read-only tripwire, and a Set removal is spelled the same way. The removal
  // is harmless and the tripwire cannot tell — but a security test taught to
  // ignore one spelling is a test that will ignore the next one, so the
  // collision is avoided here rather than excused there. (This comment is
  // worded around the literal for the same reason.)
  const strip = (value) => new Set([...modelTokens(value)].filter((t) => !brandToks.has(t)));
  const pb = strip(proposed);
  if (pb.size === 0) {
    // Phase B's "model" was only the brand again. Nothing to reconcile.
    return { ...base, agreement: IDENTITY_AGREEMENT.UNKNOWN, conflict: false };
  }

  let best = IDENTITY_AGREEMENT.CONFLICT;
  let matched = null;
  for (const cand of candidates) {
    const pa = strip(cand);
    if (pa.size === 0) continue;
    if (containsAll(pb, pa) && containsAll(pa, pb)) { best = IDENTITY_AGREEMENT.CONFIRM; matched = cand; break; }
    // Phase B named everything Phase A did, plus more: a narrower answer.
    if (containsAll(pb, pa)) { best = IDENTITY_AGREEMENT.REFINE; matched = cand; }
    // Phase A was narrower and Phase B named its family: still agreement about
    // WHICH product line, so it is not a conflict.
    else if (best === IDENTITY_AGREEMENT.CONFLICT && containsAll(pa, pb)) {
      best = IDENTITY_AGREEMENT.REFINE; matched = cand;
    }
  }

  const conflict = best === IDENTITY_AGREEMENT.CONFLICT;
  return {
    ...base,
    agreement: best,
    matched_candidate: matched,
    conflict,
    // THE ONLY CONSEQUENCE. Phase B keeps its identity; the SEARCH drops to the
    // level both readings still support.
    search_specificity_cap: conflict ? 'brand_category' : null,
  };
}
