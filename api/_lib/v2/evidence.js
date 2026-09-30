// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — EVIDENCE: EXTRACTION INTO THE EXISTING GATES
//
// Nothing about admission is decided here. The deterministic observations go
// through the SAME two gates every Phase-B observation goes through, unmodified:
//
//   bindObservations        the source is one the search really reached
//   qualifyMarketEvidence   price, currency proof, provenance, used-not-new,
//                           identity compatibility, duplicates, quorum, source
//                           diversity — and the only place a token is minted
//
// What this file adds is the LABEL on everything that did not qualify, so a
// reader can see that a retail price, a foreign price, an accessory and an
// unrelated item were each kept apart from the listings that priced the item.
//
// ── THE TWO CONTEXT TIERS CANNOT BECOME AUTHORITY ───────────────────────────
//
// `retail_context` and `brand_class_context` are what ESTIMATED_WORTH may read
// when the market gate admitted nothing. They are built here by rules that are
// deliberately NOT the qualification rules, they mint no token, and nothing in
// them is ever passed to the guard. A number derived from them is labelled an
// estimate and says what it rests on.
// ══════════════════════════════════════════════════════════════════════════════
import { bindObservations } from '../phaseb/search-provenance.js';
import { providerTextOf } from '../phaseb/market-report.js';
import {
  qualifyMarketEvidence, subjectVocabulary, canonicalCurrency, DISQUALIFIER, MARKET_CURRENCY,
} from '../market-evidence.js';
import { sourceSite } from '../source-site.js';
import { extractListings } from './listing-extraction.js';
import { IDENTITY_LEVEL } from './sufficiency.js';

export const EVIDENCE_CLASS = Object.freeze({
  USED_LISTING: 'USED_LISTING',
  NEW_RETAIL: 'NEW_RETAIL',
  FOREIGN_CONTEXT: 'FOREIGN_CONTEXT',
  ACCESSORY_PARTS: 'ACCESSORY_PARTS',
  UNRELATED: 'UNRELATED',
});

const ACCESSORY_REASONS = new Set([
  DISQUALIFIER.ACCESSORY_LISTING, DISQUALIFIER.HOST_PRODUCT_LISTING, DISQUALIFIER.PARTS_ONLY,
]);
const IDENTITY_REASONS = new Set([
  DISQUALIFIER.BRAND_ABSENT, DISQUALIFIER.MODEL_ABSENT, DISQUALIFIER.IDENTITY_TOO_WEAK,
  DISQUALIFIER.VARIANT_MISMATCH, DISQUALIFIER.QUALIFIER_MISMATCH, DISQUALIFIER.IDENTIFIER_MISMATCH,
  DISQUALIFIER.NUMBER_MISMATCH,
]);
/** A context tier needs this many listings before a range is drawn from it. */
export const MIN_CONTEXT_LISTINGS = 3;

const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const PARTS_OR_NEW = /לחלקים|תקול|שבור|חדש באריזה|parts|broken|faulty|sealed|brand new/iu;

/**
 * Extract, bind, qualify and label.
 *
 * `subject` is the identity the gate is asked about (search-plan.js:
 * subjectOf). Returns a report in every case; `qualification.token` is
 * non-null only when the whole set earned VERIFIED_MARKET.
 */
export function assessV2Evidence({ provenance, subject, level, identity = null } = {}) {
  const t0 = performance.now();
  const { entries, refused } = extractListings(provenance?.results);
  const extractionMs = performance.now() - t0;
  const providerText = providerTextOf({ provenance });

  const candidates = entries.filter((e) => e.admissible);
  const { bound, unbound } = bindObservations(candidates.map((e) => e.observation), provenance);
  const qualification = qualifyMarketEvidence({ observations: bound, subject, providerText });
  const qualificationMs = performance.now() - t0 - extractionMs;

  // Why each candidate left the gate, keyed by the observation object itself.
  const disqualifiedBy = new Map(qualification.disqualified.map((d) => [d.observation, d.reason]));
  const unboundBy = new Map(unbound.map((u) => [u.observation, u.reason]));
  const admittedKeys = new Set(qualification.admitted
    .map((a) => `${a.listing_id_or_reference}|${a.original_price}`));

  const labelled = entries.map((e) => {
    const o = e.observation;
    const currency = canonicalCurrency(o.currency);
    const admitted = e.admissible && admittedKeys.has(`${o.source}|${o.observed_price}`);
    const reason = admitted ? null : (disqualifiedBy.get(o) ?? unboundBy.get(o) ?? e.note);
    let evidenceClass = EVIDENCE_CLASS.UNRELATED;
    if (admitted) evidenceClass = EVIDENCE_CLASS.USED_LISTING;
    else if (currency !== MARKET_CURRENCY) evidenceClass = EVIDENCE_CLASS.FOREIGN_CONTEXT;
    else if (e.kind === 'new_retail' || reason === DISQUALIFIER.NOT_USED) evidenceClass = EVIDENCE_CLASS.NEW_RETAIL;
    else if (ACCESSORY_REASONS.has(reason)) evidenceClass = EVIDENCE_CLASS.ACCESSORY_PARTS;
    return { ...e, evidence_class: evidenceClass, admitted, reason };
  });

  const vocab = subjectVocabulary(subject ?? {});
  const brandToken = tokens(subject?.brand)[0] ?? null;
  const ils = (e) => canonicalCurrency(e.observation.currency) === MARKET_CURRENCY;

  // RETAIL CONTEXT: a new-retail price on a page that names this product. The
  // page title counts, because a shop's price line rarely repeats the name.
  const retailContext = (level === IDENTITY_LEVEL.PRODUCT && brandToken && vocab.distinctive.length > 0)
    ? labelled.filter((e) => e.evidence_class === EVIDENCE_CLASS.NEW_RETAIL && ils(e)
      && e.shape === 'sentence'
      && (() => {
        const t = tokens(`${e.page_title} ${e.observation.title}`);
        return t.includes(brandToken) && vocab.distinctive.every((d) => t.includes(d));
      })())
    : [];

  // BRAND + KIND CONTEXT: second-hand listings naming the brand and the kind of
  // object, for an identity that has no model. Real listings about a wider
  // subject than the item, which is exactly how they are labelled.
  // The WHOLE name of the kind, in either language: one shared word ("gaming")
  // would let a keyboard into a mouse's context.
  const classPhrases = [tokens(identity?.object_class), tokens(identity?.local_name)].filter((p) => p.length > 0);
  const brandClassContext = ((level === IDENTITY_LEVEL.BRAND_CLASS || level === IDENTITY_LEVEL.CANDIDATES) && brandToken)
    ? labelled.filter((e) => e.admissible && ils(e) && !unboundBy.has(e.observation)
      && !PARTS_OR_NEW.test(e.observation.title)
      && (() => {
        const t = tokens(e.observation.title);
        return t.includes(brandToken) && classPhrases.some((p) => p.every((c) => t.includes(c)));
      })())
    : [];

  const reasons = labelled.filter((e) => !e.admitted).map((e) => e.reason);
  const count = (set) => reasons.filter((r) => set.has(r)).length;
  const byClass = Object.fromEntries(Object.values(EVIDENCE_CLASS)
    .map((c) => [c, labelled.filter((e) => e.evidence_class === c).length]));
  const sites = (list) => [...new Set(list.map((e) => sourceSite(e.observation.source_domain)).filter(Boolean))];

  return {
    qualification,
    entries: labelled,
    refused,
    retail_context: retailContext,
    brand_class_context: brandClassContext,
    counts: {
      results: Array.isArray(provenance?.results) ? provenance.results.length : 0,
      extracted: entries.length,
      refused_at_extraction: refused.length,
      considered: bound.length,
      admitted: qualification.counts.admitted,
      rejected: entries.length - qualification.counts.admitted,
      used_listings: byClass[EVIDENCE_CLASS.USED_LISTING],
      retail_listings: byClass[EVIDENCE_CLASS.NEW_RETAIL],
      currency_failures: byClass[EVIDENCE_CLASS.FOREIGN_CONTEXT],
      identity_failures: count(IDENTITY_REASONS),
      unbound: unbound.length,
      by_class: byClass,
    },
    distinct_sources: qualification.distinct_sources,
    timings: { extraction_ms: Number(extractionMs.toFixed(2)), qualification_ms: Number(qualificationMs.toFixed(2)) },
    context_sites: { retail: sites(retailContext), brand_class: sites(brandClassContext) },
  };
}
