// ══════════════════════════════════════════════════════════════════════════════
// VERIFIED_MARKET INSIDE THE VALUATION GUARD
//
// §11 required an AUDIT rather than a widening: every decision that currently
// asks "do we have an anchor?" had to be classified as
//
//   A. do we have CATALOG authority?          -> must keep requiring an anchor
//   B. do we have sufficient MARKET-PRICE evidence? -> may accept VERIFIED_MARKET
//
// These tests pin the audit's outcome in both directions. The A-cases matter
// more than the B-cases: a test suite that only proves the new class WORKS
// would go green for an implementation that made it equivalent to ANCHOR
// everywhere, which is the one outcome §11 explicitly forbids.
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// BOTH modules follow the harness, and they must resolve to the SAME copy the
// guard itself imports. Authority here is WeakSet membership, so two instances
// of market-evidence.js would mean two disjoint WeakSets — every token minted
// in a test would read as a forgery inside the guard, and the whole suite would
// go red for an entirely fictional reason.
const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);
const MARKET_URL = process.env.VAL001_MARKET_PATH
  ? new URL(`file://${process.env.VAL001_MARKET_PATH}`)
  : new URL('../api/_lib/market-evidence.js', import.meta.url);
const {
  validateQuote, resolveValuationVerdict, derivePricingSource, bucketEntryPermitted,
  VALUATION_VERDICT, CATEGORY_WIDENING_EVIDENCE,
} = await import(GUARD_URL);
const { qualifyMarketEvidence, VERIFIED_MARKET } = await import(MARKET_URL);

/** A qualifying token for a product-level identity. */
function tokenFor(subject, prices = [340, 380, 420], domains = ['yad2.co.il', 'facebook.com', 'ebay.co.il']) {
  const r = qualifyMarketEvidence({
    observations: prices.map((p, i) => ({
      source: `https://${domains[i % domains.length]}/i/${i}`,
      source_domain: domains[i % domains.length],
      listing_id_or_reference: `t${i}`,
      title: `${subject.brand} ${subject.model}`,
      observed_price: p,
      currency: 'ILS',
      condition: 'Good',
      observed_at: '2026-09-01',
      listing_kind: 'used_listing',
      match: { brand: subject.brand, model: subject.model, variant: null, confidence: 0.9 },
    })),
    subject,
  });
  assert.equal(r.qualified, true, `fixture token failed to qualify: ${r.set_failures.join(',')}`);
  return r.token;
}

const MOUSE = {
  brand: 'Logitech', model: 'G Pro X Superlight', object_class: 'gaming mouse',
  category_candidate: 'Electronics',
};

/** A guard context with product-level identity and NO catalog anchor. */
const ctxFor = (over = {}) => ({
  stage: 'stage2',
  identity: {
    brand: MOUSE.brand, model: MOUSE.model, brandOk: true, modelOk: true,
    brandC: 0.9, modelC: 0.9, brandConfLabel: 'confirmed_by_text',
  },
  recognition: {
    category: 'Electronics', subcategory: 'gaming mouse', product_type: 'mouse',
    category_confidence: 0.9, ocr_text: { raw_texts: ['LOGITECH', 'G PRO X SUPERLIGHT'] },
  },
  evidence: new Set(['DERIVED', 'BRAND_TEXT', 'PRODUCT_TEXT']),
  anchor: null,
  anchorModelEvidence: false,
  comps: [],
  ...over,
});

const quote = (mid) => ({ low: Math.round(mid * 0.9), mid, high: Math.round(mid * 1.15), currency: 'ILS' });

// ════════════════════════════════════════════════════════════════════════════
// MG-1 · THE BLOCKER, CLOSED (question B)
// ════════════════════════════════════════════════════════════════════════════
describe('MG-1 verified market resolves PENDING_MARKET', () => {
  test('MG-1a without it, a product-level identity with no anchor stays pending', () => {
    // THE BASELINE. If this ever stops being PENDING_MARKET, the test below
    // proves nothing, because the state it claims to resolve never existed.
    const v = validateQuote(quote(380), ctxFor());
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(v.action, 'pending');
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
    assert.ok(v.violations.some((x) => x.rule === 'V-MARKET-EVIDENCE'));
  });

  test('MG-1b with it, the same scan prices', () => {
    const v = validateQuote(quote(380), ctxFor({ market_evidence: tokenFor(MOUSE) }));
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.VERIFIED_MARKET);
    assert.equal(v.action, 'accept');
    assert.equal(v.prices.mid, 380);
    assert.ok(!v.violations.some((x) => x.rule === 'V-MARKET-EVIDENCE'));
  });

  test('MG-1c the verdict is its own word, never ANCHORED', () => {
    const v = validateQuote(quote(380), ctxFor({ market_evidence: tokenFor(MOUSE) }));
    assert.notEqual(v.metadata.valuation_verdict, VALUATION_VERDICT.ANCHORED,
      'researched comparables must not be spelled the same as a GetWorth catalog row');
    assert.equal(v.metadata.pricing_source, 'verified_market');
  });

  test('MG-1d the guard reports what the authority rested on', () => {
    const v = validateQuote(quote(380), ctxFor({ market_evidence: tokenFor(MOUSE) }));
    assert.equal(v.metadata.market_evidence.class, VERIFIED_MARKET);
    assert.equal(v.metadata.market_evidence.observation_count, 3);
    assert.ok(v.metadata.market_evidence.distinct_sources >= 2);
    assert.ok(Array.isArray(v.metadata.market_evidence.sources));
  });

  test('MG-1e a scan with neither reports no market evidence', () => {
    assert.equal(validateQuote(quote(380), ctxFor()).metadata.market_evidence, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MG-2 · FORGERY AT THE GUARD BOUNDARY (§16)
// ════════════════════════════════════════════════════════════════════════════
describe('MG-2 the guard reads through the mint, not the field', () => {
  test('MG-2a a forged token leaves the scan pending', () => {
    const forged = JSON.parse(JSON.stringify(tokenFor(MOUSE)));
    const v = validateQuote(quote(380), ctxFor({ market_evidence: forged }));
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(v.action, 'pending');
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
  });

  test('MG-2b every plausible hand-written shape is inert', () => {
    for (const forged of [
      { class: VERIFIED_MARKET },
      { class: VERIFIED_MARKET, observation_count: 99, distinct_sources: 9 },
      VERIFIED_MARKET,
      true,
      ['VERIFIED_MARKET'],
    ]) {
      const v = validateQuote(quote(380), ctxFor({ market_evidence: forged }));
      assert.equal(v.action, 'pending', `${JSON.stringify(forged)} bought a price`);
    }
  });

  test('MG-2c asserting the class in the evidence set does nothing', () => {
    // The round-3 CRITICAL restated: a caller must not be able to assert its
    // way past V-MARKET-EVIDENCE by naming the class.
    const v = validateQuote(quote(380), ctxFor({
      evidence: new Set(['DERIVED', 'BRAND_TEXT', 'PRODUCT_TEXT', VERIFIED_MARKET]),
    }));
    assert.equal(v.action, 'pending');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MG-3 · QUESTION A — THE RULES THAT WERE NOT WIDENED
// ════════════════════════════════════════════════════════════════════════════
describe('MG-3 catalog questions still require catalog authority', () => {
  test('MG-3a verified market does NOT open a gated envelope bucket', () => {
    // THE MOST IMPORTANT NEGATIVE TEST IN THIS FILE. ANCHOR short-circuits
    // every bucket entry requirement; if VERIFIED_MARKET did too, four
    // marketplace listings would open watches:luxury.
    assert.equal(bucketEntryPermitted('watches:luxury', new Set([VERIFIED_MARKET])), false);
    assert.equal(bucketEntryPermitted('watches:luxury', new Set(['ANCHOR'])), true,
      'the control: ANCHOR genuinely does open it, so the assertion above is meaningful');
  });

  test('MG-3b verified market is not category-widening evidence', () => {
    // §7: market evidence may support an identity, never manufacture one. A
    // category is a claim about what the item IS.
    assert.ok(!CATEGORY_WIDENING_EVIDENCE.includes(VERIFIED_MARKET));
    assert.deepEqual([...CATEGORY_WIDENING_EVIDENCE], ['ANCHOR', 'OBJECT_CLASS']);
  });

  test('MG-3c verified market does not earn the catalog-anchored HIGH grade', () => {
    const withMarket = derivePricingSource(ctxFor({ market_evidence: tokenFor(MOUSE) }));
    const withAnchor = derivePricingSource(ctxFor({ anchor: { retail_price_ils: 500 } }));
    assert.equal(withAnchor.grade, 'HIGH');
    assert.equal(withAnchor.source, 'stage2_comp_anchored');
    assert.equal(withMarket.grade, 'MEDIUM');
    assert.equal(withMarket.source, 'verified_market');
  });

  test('MG-3d a real anchor still outranks verified market when both are present', () => {
    const both = derivePricingSource(ctxFor({
      anchor: { retail_price_ils: 500 }, market_evidence: tokenFor(MOUSE),
    }));
    assert.equal(both.source, 'stage2_comp_anchored');
    assert.equal(
      resolveValuationVerdict(ctxFor({ anchor: { retail_price_ils: 500 }, market_evidence: tokenFor(MOUSE) })),
      VALUATION_VERDICT.ANCHORED,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MG-4 · IDENTITY IS NOT REPAIRED BY MARKET EVIDENCE (§7)
// ════════════════════════════════════════════════════════════════════════════
describe('MG-4 the guard applies its own identity test too', () => {
  test('MG-4a a category-only scan is not promoted by a token', () => {
    // The token requires a brand and a model to be minted, so this context is
    // contrived — which is the point. The guard must not depend on Phase B
    // having been careful; it re-derives the tier from ctx.identity itself.
    const ctx = ctxFor({
      market_evidence: tokenFor(MOUSE),
      identity: { brand: null, model: null, brandOk: false, modelOk: false, brandC: 0, modelC: 0 },
      recognition: {
        category: 'Electronics', subcategory: null, product_type: null,
        category_confidence: 0.9, ocr_text: { raw_texts: [] },
      },
    });
    const verdict = resolveValuationVerdict(ctx);
    assert.notEqual(verdict, VALUATION_VERDICT.VERIFIED_MARKET,
      'market evidence must never be the reason the guard believes an identity');
  });

  test('MG-4b the identity floor still refuses below-tier scans', () => {
    const v = validateQuote(quote(380), ctxFor({
      market_evidence: tokenFor(MOUSE),
      identity: { brand: null, model: null, brandOk: false, modelOk: false, brandC: 0, modelC: 0 },
      recognition: {
        category: 'Unknownium', subcategory: null, product_type: null,
        category_confidence: 0.2, ocr_text: { raw_texts: [] },
      },
    }));
    assert.notEqual(v.action, 'accept');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MG-5 · THE ENVELOPE STILL BOUNDS EVERYTHING (§18)
// ════════════════════════════════════════════════════════════════════════════
describe('MG-5 authority is not permission to leave the envelope', () => {
  test('MG-5a the hard ceiling refuses a verified distribution too', () => {
    // §18: do not widen envelope numbers. A qualified token buys the right to
    // be CONSIDERED, not the right to any number at all.
    const v = validateQuote(quote(400000), ctxFor({ market_evidence: tokenFor(MOUSE) }));
    assert.notEqual(v.action, 'accept');
    assert.ok(v.metadata.degraded);
  });

  test('MG-5b a degraded verified-market scan does not keep its verdict', () => {
    // A refusal must not sit beside a verdict claiming the number was backed.
    const v = validateQuote(quote(400000), ctxFor({ market_evidence: tokenFor(MOUSE) }));
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.MANUAL);
  });
});
