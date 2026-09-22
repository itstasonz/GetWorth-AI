// ══════════════════════════════════════════════════════════════════════════════
// THE OPEN WORLD  ·  a generic object's market, and the limits on it
//
// B-h, closed. `qualifyMarketEvidence` refused every subject not known at
// product level, so a plain wooden desk with five genuine Israeli listings was
// declined for `subject_identity_below_product_level` — a refusal on IDENTITY
// that no amount of evidence could answer. That made the catalog a
// prerequisite for valuation, which the product vision forbids.
//
// The answer is a THIRD class, not a widened one:
//
//   VERIFIED_MARKET      this exact PRODUCT's used market
//   VERIFIED_COMPARABLE  this KIND of object's used market
//
// minted into a separate registry so nothing that reads the old class changes.
// The tests below are mostly about what the new class must NOT be able to do.
//
//   node --test tests/open-world.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  qualifyMarketEvidence, isMarketEvidence, isComparableEvidence,
  hasVerifiedMarket, hasVerifiedComparable,
  VERIFIED_COMPARABLE, COMPARABLE_QUORUM, MIN_COMPARABLE_SOURCES, SET_FAILURE,
} from '../api/_lib/market-evidence.js';
import { derivePricingSource } from '../api/_lib/valuation-guard.js';
import { runPhaseB, PHASE_B_STATUS } from '../api/_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from '../api/_lib/phaseb/market-research.js';

const obs = (d, r, p, t, cur = 'ILS') => ({
  source: `https://${d}/${r}`, source_domain: d, listing_id_or_reference: r, title: t,
  observed_price: p, currency: cur, condition: 'used', location: 'Tel Aviv',
  observed_at: null, listing_kind: 'used_listing',
  match: { brand: null, model: null, variant: null, confidence: 0.85 },
});

/** Five desks across four domains — a set that should qualify at class level. */
const DESKS = [
  obs('yad2.co.il', 'a', 180, 'solid wood desk'),
  obs('facebook.com', 'b', 220, 'wooden writing desk'),
  obs('ebay.co.il', 'c', 150, 'oak desk'),
  obs('agora.co.il', 'd', 200, 'office desk wood'),
  obs('yad2.co.il', 'e', 240, 'large wooden desk'),
];

// ════════════════════════════════════════════════════════════════════════════
// OW-1 · A GENERIC OBJECT CAN REACH A MARKET
// ════════════════════════════════════════════════════════════════════════════
describe('OW-1 a no-name object qualifies on its class', () => {
  test('OW-1a five comparables across three domains qualify', () => {
    const r = qualifyMarketEvidence({ observations: DESKS, subject: { object_class: 'wooden desk' } });
    assert.equal(r.comparable_qualified, true, r.set_failures.join(','));
    assert.equal(r.evidence_class, VERIFIED_COMPARABLE);
    assert.equal(r.counts.admitted, 5);
    assert.ok(r.distinct_sources >= MIN_COMPARABLE_SOURCES);
  });

  test('OW-1b it is language-agnostic — the class is the subject’s own words', () => {
    // Nothing here is a Hebrew rule; the subject supplies its vocabulary and
    // the listing has to use it. An English fixture and a Hebrew one exercise
    // the same single code path.
    const hebrew = [
      obs('yad2.co.il', 'a', 180, 'שולחן עץ מלא'),
      obs('facebook.com', 'b', 220, 'שולחן עבודה'),
      obs('ebay.co.il', 'c', 150, 'שולחן כתיבה'),
      obs('agora.co.il', 'd', 200, 'שולחן עץ'),
      obs('yad2.co.il', 'e', 240, 'שולחן גדול'),
    ];
    const r = qualifyMarketEvidence({ observations: hebrew, subject: { object_class: 'שולחן עץ' } });
    assert.equal(r.comparable_qualified, true, r.set_failures.join(','));
  });

  test('OW-1c the bar is HIGHER than the product path, not lower', () => {
    assert.ok(COMPARABLE_QUORUM > 3, 'a class spans more price variance than a product');
    assert.ok(MIN_COMPARABLE_SOURCES > 2);
    const thin = qualifyMarketEvidence({ observations: DESKS.slice(0, 4), subject: { object_class: 'wooden desk' } });
    assert.equal(thin.comparable_qualified, false);
    assert.ok(thin.set_failures.includes(SET_FAILURE.COMPARABLE_QUORUM));
    const oneSource = qualifyMarketEvidence({
      observations: DESKS.map((o, i) => ({ ...o, source_domain: 'yad2.co.il', listing_id_or_reference: `x${i}` })),
      subject: { object_class: 'wooden desk' },
    });
    assert.equal(oneSource.comparable_qualified, false);
    assert.ok(oneSource.set_failures.includes(SET_FAILURE.COMPARABLE_DIVERSITY));
  });

  test('OW-1d a listing that does not name the class is refused', () => {
    const mixed = [...DESKS.slice(0, 4), obs('ksp.co.il', 'z', 900, 'office chair ergonomic')];
    const r = qualifyMarketEvidence({ observations: mixed, subject: { object_class: 'wooden desk' } });
    assert.equal(r.counts.admitted, 4, 'the chair must not be admitted as a desk');
    assert.equal(r.comparable_qualified, false);
  });

  test('OW-1e the same hygiene applies — FX, new-retail, parts, duplicates', () => {
    const dirty = [
      ...DESKS,
      obs('amazon.com', 'f', 95, 'wooden desk', 'USD'),          // no FX proof
      { ...obs('ksp.co.il', 'g', 900, 'wooden desk'), listing_kind: 'new_retail' },
      { ...obs('yad2.co.il', 'h', 50, 'wooden desk for parts'), listing_kind: 'used_listing' },
      obs('yad2.co.il', 'a', 180, 'solid wood desk'),            // exact duplicate
    ];
    const r = qualifyMarketEvidence({ observations: dirty, subject: { object_class: 'wooden desk' } });
    assert.equal(r.counts.admitted, 5, 'only the five clean ILS used listings may be admitted');
    const reasons = new Set(r.disqualified.map((d) => d.reason));
    for (const expected of ['foreign_currency_without_fx_proof', 'not_a_used_listing', 'parts_or_broken', 'duplicate_listing']) {
      assert.ok(reasons.has(expected), `expected a ${expected} rejection, got ${[...reasons].join(',')}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OW-2 · THE NEW CLASS GRANTS STRICTLY LESS
//
// The half that decides whether this was safe. A class-level set must not be
// able to do anything a product-level set does.
// ════════════════════════════════════════════════════════════════════════════
describe('OW-2 a comparable token is not market evidence', () => {
  const token = () => qualifyMarketEvidence({ observations: DESKS, subject: { object_class: 'wooden desk' } }).comparable_token;

  test('OW-2a the two mints are disjoint', () => {
    const c = token();
    assert.ok(isComparableEvidence(c));
    assert.equal(isMarketEvidence(c), false,
      'a class-level token that reads as VERIFIED_MARKET would satisfy every rule '
      + 'written for product-level evidence');
    assert.equal(hasVerifiedMarket({ market_evidence: c }), false);
    assert.equal(hasVerifiedMarket({ comparable_evidence: c }), false);
    assert.equal(hasVerifiedComparable({ comparable_evidence: c }), true);
  });

  test('OW-2b the product path never mints a comparable token, and vice versa', () => {
    const product = qualifyMarketEvidence({
      observations: [
        obs('yad2.co.il', 'a', 480, 'Acme XR-500'), obs('facebook.com', 'b', 520, 'Acme XR-500'),
        obs('ebay.co.il', 'c', 450, 'Acme XR-500'),
      ],
      subject: { object_class: 'blender', brand: 'Acme', model: 'XR-500' },
    });
    assert.equal(product.qualified, true, product.set_failures.join(','));
    assert.equal(product.comparable_qualified, false);
    assert.equal(product.comparable_token, null);
    const generic = qualifyMarketEvidence({ observations: DESKS, subject: { object_class: 'wooden desk' } });
    assert.equal(generic.qualified, false, '`qualified` must keep meaning PRODUCT level');
    assert.equal(generic.token, null);
  });

  test('OW-2c a forged token grants nothing', () => {
    const real = token();
    const revived = JSON.parse(JSON.stringify(real));
    assert.equal(isComparableEvidence(revived), false,
      'a serialised token still granting would let a cache or a log replay authority');
    assert.equal(hasVerifiedComparable({ comparable_evidence: { class: VERIFIED_COMPARABLE } }), false,
      'a caller asserting the class name must buy nothing');
  });

  test('OW-2d it earns its own pricing source, distinct from the product one', () => {
    const c = token();
    assert.deepEqual(derivePricingSource({ stage: 'stage2', comparable_evidence: c }),
      { source: 'verified_comparable', grade: 'MEDIUM' });
    // And an ASSERTED one falls through to the ordinary estimate.
    assert.equal(derivePricingSource({ stage: 'stage2', comparable_evidence: { class: VERIFIED_COMPARABLE } }).source,
      'stage2_ai');
  });

  test('OW-2e a BRANDED subject without a model is still refused', () => {
    // The LG-monitor case, unchanged and load-bearing: a brand is a promise of
    // specificity that has not been kept, and listings for one model of that
    // brand are not evidence about an unknown model of it.
    const r = qualifyMarketEvidence({
      observations: DESKS.map((o) => ({ ...o, title: `IKEA ${o.title}` })),
      subject: { object_class: 'wooden desk', brand: 'IKEA' },
    });
    assert.equal(r.qualified, false);
    assert.equal(r.comparable_qualified, false);
    assert.ok(r.set_failures.includes(SET_FAILURE.BRANDED_WITHOUT_MODEL));
    assert.ok(r.set_failures.includes(SET_FAILURE.IDENTITY_INSUFFICIENT));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OW-3 · THE THREE VALIDATION SCENARIOS, END TO END
// ════════════════════════════════════════════════════════════════════════════
describe('OW-3 A / B / C through the real pipeline', () => {
  const ident = (o) => ({
    subject: {
      object_class: null, category_candidate: null, brand: null, product_name: null,
      family: null, model: null, variant: null,
      identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null }, ...o,
    },
    confidence: { overall: 0.85, object_class: 0.9, brand: 0.9, model: 0.8, variant: 0 },
    evidence: [{ type: 'visible_text', value: 'x', source: 'image', confidence: 0.9 }],
    references: [], ambiguities: [], alternatives: [],
  });
  const q = (o) => ({
    product_identity: '', variant: null, condition_target: 'used', geography: 'Israel',
    currency: 'ILS', market: 'second_hand', search_terms: ['x'], specificity: 'exact_model', ...o,
  });
  const provider = ({ identity, query, observations }) => async (_u, init) => {
    const n = JSON.parse(init.body)?.text?.format?.name ?? '';
    const p = n.includes('identity') ? identity
      : n.includes('condition') ? { grade: 'Good', confidence: 0.7, observed: [], not_visible: [], authenticity_observation: 'insufficient_evidence' }
        : n.includes('market_query') ? query
          : { observations, search_performed: true, notes: null };
    return new Response(JSON.stringify({
      model: 't', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(p) }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const run = (c) => runPhaseB({
    images: ['aGk='], language: 'en', ocrText: c.ocr, existingRecognition: c.existing,
    apiKey: 'k', model: 't', marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
    fetchImpl: provider(c),
  });

  test('OW-3a TEST A — exact identity prices from VERIFIED_MARKET', async () => {
    const r = await run({
      ocr: ['ACME', 'XR-500'],
      existing: { brand_candidates: [{ brand: 'Acme' }], model_candidates: [{ model: 'XR-500', confidence: 0.9, resolved: true }] },
      identity: ident({ object_class: 'blender', brand: 'Acme', model: 'XR-500' }),
      query: q({ product_identity: 'Acme XR-500' }),
      observations: [
        obs('yad2.co.il', 'a', 480, 'Acme XR-500 blender'), obs('facebook.com', 'b', 520, 'Acme XR-500'),
        obs('ebay.co.il', 'c', 450, 'Acme XR-500 used'), obs('agora.co.il', 'd', 560, 'Acme XR-500'),
      ],
    });
    assert.equal(r.identity_candidate.reconciliation.agreement, 'confirm');
    assert.equal(r.market_evidence.query.specificity, 'exact_model');
    assert.equal(r.validation.market_evidence.qualified, true);
    assert.equal(r.valuation_candidate.status, 'PRICED');
    assert.equal(r.validation.action, 'accept');
    assert.equal(r.status, PHASE_B_STATUS.COMPLETE);
  });

  test('OW-3b TEST B — a disputed model earns NO market authority', async () => {
    const r = await run({
      ocr: ['ACME'],
      existing: {
        brand_candidates: [{ brand: 'Acme' }],
        model_candidates: [{ model: 'XR-500', confidence: 0.45 }, { model: 'XR-400', confidence: 0.4 }],
      },
      identity: ident({ object_class: 'blender', brand: 'Acme', model: 'ZT-900' }),
      query: q({ product_identity: 'Acme ZT-900' }),
      observations: [
        obs('yad2.co.il', 'a', 480, 'Acme ZT-900'), obs('facebook.com', 'b', 520, 'Acme ZT-900'),
        obs('ebay.co.il', 'c', 450, 'Acme ZT-900'),
      ],
    });
    assert.equal(r.identity_candidate.reconciliation.conflict, true);
    // The SEARCH drops to the level both readings support...
    assert.equal(r.market_evidence.query.specificity, 'brand_category');
    assert.ok(!/zt-900/i.test(r.market_evidence.query.product_identity));
    // ...and so does QUALIFICATION. Capping only the query would let listings
    // naming the disputed model be admitted at product level anyway.
    assert.equal(r.validation.market_evidence.qualified, false,
      'a disputed model must not qualify as this product’s market');
    assert.equal(r.validation.market_evidence.comparable_qualified, false,
      'a BRANDED subject does not fall back to the generic path either');
    assert.notEqual(r.validation.action, 'accept');
    assert.equal(r.status, PHASE_B_STATUS.PRICED_GUARD_WITHHELD);
  });

  test('OW-3c TEST C — a generic object prices, with no catalog and no brand', async () => {
    const r = await run({
      ocr: [], existing: { brand_candidates: [], model_candidates: [] },
      identity: ident({ object_class: 'wooden desk', category_candidate: 'Furniture' }),
      query: q({ product_identity: 'wooden desk', specificity: 'category_only' }),
      observations: [...DESKS, obs('amazon.com', 'f', 95, 'desk organiser', 'USD')],
    });
    assert.equal(r.identity_candidate.subject.brand, null, 'no brand may be fabricated');
    assert.equal(r.identity_candidate.subject.model, null, 'no model may be fabricated');
    assert.equal(r.validation.market_evidence.qualified, false);
    assert.equal(r.validation.market_evidence.comparable_qualified, true);
    assert.equal(r.validation.market_evidence.evidence_class, VERIFIED_COMPARABLE);
    assert.equal(r.valuation_candidate.status, 'PRICED');
    assert.equal(r.validation.action, 'accept', r.validation.degraded_reason ?? '');
    assert.equal(r.status, PHASE_B_STATUS.COMPLETE);
    // The foreign listing stayed context_only and never entered the price.
    assert.equal(r.market_evidence.counts.context_only, 1);
    assert.ok(r.valuation_candidate.mid >= 150 && r.valuation_candidate.mid <= 240,
      `the median must sit inside the observed ILS range, got ${r.valuation_candidate.mid}`);
  });

  test('OW-3d a generic object with THIN evidence still refuses', async () => {
    const r = await run({
      ocr: [], existing: { brand_candidates: [], model_candidates: [] },
      identity: ident({ object_class: 'wooden desk' }),
      query: q({ product_identity: 'wooden desk', specificity: 'category_only' }),
      observations: DESKS.slice(0, 3),
    });
    // The guard DOES run — Phase B's own filter kept three ILS listings, which
    // meets its own MIN_OBSERVATIONS_TO_PRICE — so a report exists. What must
    // not exist is any GRANT, and without one the identity floor applies
    // normally and the number is withheld.
    assert.equal(r.validation.market_evidence.qualified, false);
    assert.equal(r.validation.market_evidence.comparable_qualified, false,
      'three listings are below the class-level quorum and must grant nothing');
    assert.notEqual(r.validation.action, 'accept',
      'with no grant, an unidentified subject may not carry a price');
    assert.equal(r.status, PHASE_B_STATUS.PRICED_GUARD_WITHHELD);
  });
});
