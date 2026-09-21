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
