// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — EVIDENCE: FROM SEARCH RESULTS TO WHAT MAY PRICE AN ITEM
//
//   search results
//     -> market identity      what the product is sold as, checked against the
//                             results themselves (market-identity.js)
//     -> extraction           every priced number, with a role and a binding
//     -> the EXISTING gates   bindObservations + qualifyMarketEvidence, unmodified
//     -> accounting           every result in exactly one bucket, every
//                             observation with a class and a relation
//
// Nothing about admitting a SECOND-HAND listing is decided here. It is decided
// where it always was, by the gate that mints the token. What this file adds is
// which NAME the gate is asked about — the one read off the item, and any name
// the results corroborated as the same product — and the retail anchor.
//
// ── RETAIL IS NOT A USED PRICE ──────────────────────────────────────────────
//
// A shop's price for the exact product, read off that product's own page, is
// a REPLACEMENT PRICE ANCHOR: what it costs to buy one new. It never enters
// qualification, mints nothing, and is never converted into a second-hand
// value here. It is reported beside the used-market result, as what it is.
// ══════════════════════════════════════════════════════════════════════════════
import { bindObservations } from '../phaseb/search-provenance.js';
import { providerTextOf } from '../phaseb/market-report.js';
import { qualifyMarketEvidence, canonicalCurrency, DISQUALIFIER, MARKET_CURRENCY } from '../market-evidence.js';
import { sourceSite } from '../source-site.js';
import { extractListings, PAGE, BINDING, REFUSED } from './listing-extraction.js';
import { assessMarketIdentity, RELATION } from './market-identity.js';
import { IDENTITY_LEVEL } from './sufficiency.js';

export const BUCKET = Object.freeze({
  DUPLICATE: 'DUPLICATE',
  NO_PRICE_DATA: 'NO_PRICE_DATA',
  REFUSED_AT_EXTRACTION: 'REFUSED_AT_EXTRACTION',
  QUALIFIER_REJECTED: 'QUALIFIER_REJECTED',
  ADMITTED: 'ADMITTED',
});
export const EVIDENCE_CLASS = Object.freeze({
  LOCAL_USED: 'LOCAL_USED',
  LOCAL_RETAIL: 'LOCAL_RETAIL',
  FOREIGN_USED: 'FOREIGN_USED',
  FOREIGN_RETAIL: 'FOREIGN_RETAIL',
  OTHER: 'OTHER',
});
export const ANCHOR_STRENGTH = Object.freeze({ NONE: 'NONE', SINGLE_SOURCE: 'SINGLE_SOURCE', STRONG: 'STRONG' });
// Independent shops needed before a retail anchor is called strong.
export const MIN_ANCHOR_SHOPS = 2;

const IDENTITY_REASONS = new Set([
  DISQUALIFIER.BRAND_ABSENT, DISQUALIFIER.MODEL_ABSENT, DISQUALIFIER.IDENTITY_TOO_WEAK, DISQUALIFIER.VARIANT_MISMATCH,
  DISQUALIFIER.QUALIFIER_MISMATCH, DISQUALIFIER.IDENTIFIER_MISMATCH, DISQUALIFIER.NUMBER_MISMATCH,
]);

const median = (sorted) => (sorted.length % 2
  ? sorted[(sorted.length - 1) / 2]
  : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

function classOf(entry) {
  const local = canonicalCurrency(entry.observation.currency) === MARKET_CURRENCY;
  if (entry.kind === 'used_listing') return local ? EVIDENCE_CLASS.LOCAL_USED : EVIDENCE_CLASS.FOREIGN_USED;
  if (entry.kind === 'new_retail') return local ? EVIDENCE_CLASS.LOCAL_RETAIL : EVIDENCE_CLASS.FOREIGN_RETAIL;
  return EVIDENCE_CLASS.OTHER;
}

/**
 * The names the evidence gate may be asked about.
 *
 * The first is always the identity read off the item. Each further one is an
 * alias the RESULTS corroborated as the same product: an exact model number, or
 * an exact name. A sibling, a family name or an unverified guess is never here.
 */
function subjectForms(subject, market, level) {
  const forms = [{ form: 'read_off_item', subject }];
  if (level !== IDENTITY_LEVEL.PRODUCT || !market) return forms;
  for (const root of market.exact_roots) {
    if (String(subject.model ?? '').toUpperCase().includes(root)) continue;
    forms.push({ form: `alias:${root}`, subject: { ...subject, model: root, product_name: `${subject.brand} ${root}`, variant: null } });
  }
  for (const phrase of market.exact_phrases) {
    const name = phrase.join(' ');
    forms.push({ form: `alias:${name}`, subject: { ...subject, model: name, product_name: `${subject.brand} ${name}`, variant: null } });
  }
  return forms;
}

/**
 * Extract, bind, qualify, anchor and account.
 *
 * `subject` is the identity the gate is asked about (search-plan.js:
 * subjectOf). Returns a report in every case; `qualification.token` is non-null
 * only when one form's whole set earned VERIFIED_MARKET.
 */
export function assessV2Evidence({ provenance, subject, level, identity = null } = {}) {
  const t0 = performance.now();
  const results = Array.isArray(provenance?.results) ? provenance.results : [];
  const market = assessMarketIdentity({ identity, results });
  const { pages, entries, refused } = extractListings(results, { market });
  const extractionMs = performance.now() - t0;
  const providerText = providerTextOf({ provenance });

  // ── SECOND-HAND: THE EXISTING GATE, ASKED ABOUT EACH CORROBORATED NAME ────
  const candidates = entries.filter((e) => e.admissible);
  const { bound, unbound } = bindObservations(candidates.map((e) => e.observation), provenance);
  // A SIBLING'S LISTING IS NEVER HANDED TO THE GATE. A listing that names
  // another model of the line can carry every word of this product's name, and
  // the gate reads words. And a name the results corroborated is asked about
  // only over listings that are, by their own text, EXACTLY this product.
  const entryOf = new Map(candidates.map((e) => [e.observation, e]));
  const notSibling = bound.filter((o) => entryOf.get(o)?.relation !== RELATION.SIBLING);
  const exactOnly = notSibling.filter((o) => entryOf.get(o)?.relation === RELATION.EXACT);
  const runs = subjectForms(subject ?? {}, market, level).map(({ form, subject: s }) => ({
    form, report: qualifyMarketEvidence({ observations: form === 'read_off_item' ? notSibling : exactOnly, subject: s, providerText }),
  }));
  // The run that admitted the most is the one that speaks: its token is the
  // only token, so VERIFIED is never assembled from two half-sets.
  const granting = runs.reduce((best, r) => (r.report.counts.admitted > best.report.counts.admitted ? r : best), runs[0]);
  const qualification = granting.report;
  const qualificationMs = performance.now() - t0 - extractionMs;

  const keyOf = (o) => `${o.source}|${o.observed_price}`;
  const admittedKey = (a) => `${a.listing_id_or_reference}|${a.original_price}`;
  const admittedBy = new Map();     // observation key -> the form that admitted it
  for (const r of runs) for (const a of r.report.admitted) if (!admittedBy.has(admittedKey(a))) admittedBy.set(admittedKey(a), r.form);
  const grantingKeys = new Set(qualification.admitted.map(admittedKey));
  const disqualifiedBy = new Map(qualification.disqualified.map((d) => [d.observation, d.reason]));
  const unboundBy = new Map(unbound.map((u) => [u.observation, u.reason]));

  // ── RETAIL: ONE PRODUCT'S PAGE, THIS PRODUCT, A NEW PRICE, IN THIS MARKET ─
  const isAnchor = (e) => level === IDENTITY_LEVEL.PRODUCT
    && e.kind === 'new_retail' && e.binding === BINDING.RESULT_TITLE && e.page_type === PAGE.SINGLE_PRODUCT
    && e.relation === RELATION.EXACT && !e.refurbished
    && canonicalCurrency(e.observation.currency) === MARKET_CURRENCY;

  const labelled = entries.map((e) => {
    const o = e.observation;
    const usedAdmitted = e.admissible && admittedBy.has(keyOf(o));
    const anchor = isAnchor(e);
    const reason = usedAdmitted || anchor ? null
      : ((e.admissible && e.relation === RELATION.SIBLING ? 'listing_names_a_sibling_model' : null)
        ?? disqualifiedBy.get(o) ?? unboundBy.get(o) ?? e.note
        ?? (e.kind === 'new_retail'
          ? (canonicalCurrency(o.currency) !== MARKET_CURRENCY ? 'foreign_currency_is_not_converted'
            : (e.refurbished ? 'refurbished_is_not_a_new_price' : `retail_price_for_${String(e.relation).toLowerCase()}_identity`))
          // The gate refused the whole set before it read a listing.
          : (e.admissible && qualification.set_failures?.length ? `set_refused: ${qualification.set_failures[0]}` : 'not_a_listing')));
    return {
      ...e,
      evidence_class: classOf(e),
      // A listing the gate admitted under a corroborated name IS this product.
      relation: usedAdmitted ? RELATION.EXACT : e.relation,
      admitted: usedAdmitted,
      admitted_as: usedAdmitted ? admittedBy.get(keyOf(o)) : null,
      in_granting_set: usedAdmitted && grantingKeys.has(keyOf(o)),
      retail_anchor: anchor,
      reason,
    };
  });

  // One price per shop: two pages of one shop are one source.
  const bySite = new Map();
  for (const e of labelled.filter((x) => x.retail_anchor)) {
    const site = sourceSite(e.observation.source_domain);
    if (site && !bySite.has(site)) bySite.set(site, e);
  }
  const anchorPrices = [...bySite.values()].map((e) => e.observation.observed_price).sort((a, b) => a - b);
  const retailAnchor = {
    kind: 'RETAIL_REPLACEMENT_ANCHOR',
    strength: bySite.size === 0 ? ANCHOR_STRENGTH.NONE
      : (bySite.size >= MIN_ANCHOR_SHOPS ? ANCHOR_STRENGTH.STRONG : ANCHOR_STRENGTH.SINGLE_SOURCE),
    currency: MARKET_CURRENCY,
    low: anchorPrices[0] ?? null,
    median: anchorPrices.length ? Math.round(median(anchorPrices)) : null,
    high: anchorPrices[anchorPrices.length - 1] ?? null,
    shops: bySite.size,
    prices: [...bySite].map(([site, e]) => ({
      site, price: e.observation.observed_price, stated_price: e.stated_price,
      includes_delivery: e.includes_delivery, delivery_fee: e.delivery_fee, url: e.observation.source,
    })),
  };

  // ── EVERY RESULT, EXACTLY ONE BUCKET ─────────────────────────────────────
  const byPage = new Map();
  for (const e of labelled) { if (!byPage.has(e.page_index)) byPage.set(e.page_index, []); byPage.get(e.page_index).push(e); }
  const accounted = pages.map((p) => {
    const mine = byPage.get(p.index) ?? [];
    let bucket;
    if (p.duplicate) bucket = BUCKET.DUPLICATE;
    else if (mine.some((e) => e.admitted || e.retail_anchor)) bucket = BUCKET.ADMITTED;
    else if (mine.length > 0) bucket = BUCKET.QUALIFIER_REJECTED;
    else if (p.refusals > 0) bucket = BUCKET.REFUSED_AT_EXTRACTION;
    else bucket = BUCKET.NO_PRICE_DATA;
    return { ...p, bucket };
  });
  const tally = (list, key, values) => Object.fromEntries(values.map((v) => [v, list.filter((x) => x[key] === v).length]));
  const buckets = tally(accounted, 'bucket', Object.values(BUCKET));
  const priceCandidates = buckets.REFUSED_AT_EXTRACTION + buckets.QUALIFIER_REJECTED + buckets.ADMITTED;

  const admitted = labelled.filter((e) => e.admitted);
  const usedSites = new Set(admitted.map((e) => sourceSite(e.observation.source_domain)).filter(Boolean));

  return {
    market,
    qualification,
    qualification_runs: runs.map((r) => ({
      form: r.form, admitted: r.report.counts.admitted, qualified: r.report.qualified === true,
      set_failures: r.report.set_failures ?? [], granting: r === granting,
    })),
    entries: labelled,
    refused,
    pages: accounted,
    retail_anchor: retailAnchor,
    // Exact second-hand listings across every corroborated name, counted once.
    used_admitted: { listings: admitted.length, sources: usedSites.size, in_granting_set: admitted.filter((e) => e.in_granting_set).length },
    accounting: {
      total: accounted.length,
      buckets,
      price_candidates: priceCandidates,
      reconciles: accounted.length === buckets.DUPLICATE + buckets.NO_PRICE_DATA + priceCandidates,
    },
    counts: {
      results: accounted.length,
      extracted: entries.length,
      refused_at_extraction: refused.length,
      considered: notSibling.length,
      admitted: admitted.length,
      rejected: entries.length - admitted.length,
      used_listings: admitted.length,
      retail_listings: labelled.filter((e) => e.kind === 'new_retail').length,
      retail_anchor_prices: bySite.size,
      currency_failures: labelled.filter((e) => canonicalCurrency(e.observation.currency) !== MARKET_CURRENCY).length,
      identity_failures: labelled.filter((e) => !e.admitted && IDENTITY_REASONS.has(e.reason)).length,
      unmarked_prices: refused.filter((r) => r.reason === REFUSED.NO_CURRENCY).length,
      duplicates_removed: buckets.DUPLICATE,
      unbound: unbound.length,
      by_class: tally(labelled, 'evidence_class', Object.values(EVIDENCE_CLASS)),
      by_relation: tally(labelled, 'relation', [...Object.values(RELATION), 'UNKNOWN']),
    },
    distinct_sources: qualification.distinct_sources,
    timings: { extraction_ms: Number(extractionMs.toFixed(2)), qualification_ms: Number(qualificationMs.toFixed(2)) },
  };
}
