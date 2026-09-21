// ══════════════════════════════════════════════════════════════════════════════
// ROUND-4 PROPERTIES — the classes, not the witnesses
//
// The round-3 review found 3 CRITICAL and 9 HIGH against a suite that was green.
// Each fix below closes a PROPERTY CLASS, and each is asserted from both sides:
// the input that must be refused, and the input that must still work. A gate
// tested only from the permitted side has not been tested.
//
//   node --test tests/round4-properties.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);
const G = await import(GUARD_URL.href);
const {
  validateQuote, resolveEnvelope, resolveEnvelopeKey, derivePricingSource,
  resolveValuationVerdict, VALUATION_VERDICT, ENVELOPES,
  bucketEntryRequirement, bucketEntryPermitted,
} = G;

const AUTHORITY_URL = process.env.VAL001_AUTHORITY_PATH
  ? new URL(`file://${process.env.VAL001_AUTHORITY_PATH}`)
  : new URL('../api/_lib/pricing-authority.js', import.meta.url);
const A = await import(AUTHORITY_URL.href);
const { deriveEvidence, evidenceList, anchorPrice, isPricedAnchor } = A;

const ID = { brandOk: true, modelOk: true, brandC: 0.94, modelC: 0.88,
  brandConfLabel: 'confirmed_by_text', identityHigh: true };
const NINJA = {
  category: 'Home', category_confidence: 0.92, subcategory: 'blender',
  brand_candidates: [{ brand: 'Ninja', confidence: 0.94 }],
  model_candidates: [{ model: 'Detect Power Blender Pro', confidence: 0.88 }],
  ocr_text: { raw_texts: ['NINJA', 'Detect Power Blender Pro'] },
};
const q = (mid) => ({ low: Math.round(mid * 0.7), mid, high: Math.round(mid * 1.4), currency: 'ILS' });

// ════════════════════════════════════════════════════════════════════════════
// C-1 · IDENTITY EVIDENCE IS NOT MARKET-PRICE EVIDENCE
// ════════════════════════════════════════════════════════════════════════════
describe('C1 a row must carry a price to carry pricing authority', () => {
  // Every malformed price the brief names, plus the shapes the fuzz found.
  const PRICELESS = [
    ['{id:x} — the round-3 test fixture', { id: 'x' }],
    ['approved product_candidate', { id: 'pc-77', brand: 'Ninja', retail_price_ils: null, avg_used_price_ils: null }],
    ['price 0', { retail_price_ils: 0 }],
    ['price negative', { retail_price_ils: -5 }],
    ['price NaN', { retail_price_ils: NaN }],
    ['price Infinity', { retail_price_ils: Infinity }],
    ['price -Infinity', { retail_price_ils: -Infinity }],
    ['price numeric string', { retail_price_ils: '900' }],
    ['price empty string', { retail_price_ils: '' }],
    ['price true', { retail_price_ils: true }],
    ['price object', { retail_price_ils: { amount: 900 } }],
    ['price array', { retail_price_ils: [900] }],
    ['missing price field', { id: 'r', brand: 'Ninja', model: 'X' }],
    ['empty object', {}],
    ['a Date', new Date()],
  ];
  const PRICED = [
    ['retail_price_ils', { id: 'r', retail_price_ils: 900 }],
    ['avg_used_price_ils only', { id: 'r', avg_used_price_ils: 900 }],
    ['modest but real', { id: 'r', retail_price_ils: 500 }],
  ];

  test('C1-a no priceless shape yields ANCHOR, a priced one always does', () => {
    for (const [label, a] of PRICELESS) {
      const list = evidenceList({ anchor: a });
      assert.ok(!list.includes('ANCHOR'), `${label} must not be market evidence`);
      assert.ok(list.includes('CATALOG_IDENTITY'), `${label} is still identity evidence`);
      assert.equal(isPricedAnchor(a), false, label);
      assert.equal(anchorPrice(a), null, label);
    }
    for (const [label, a] of PRICED) {
      assert.ok(evidenceList({ anchor: a }).includes('ANCHOR'), label);
      assert.ok(anchorPrice(a) > 0, label);
    }
  });

  test('C1-b no priceless shape defeats V-MARKET-EVIDENCE', () => {
    // The CRITICAL itself: PENDING_MARKET / ₪0 became ANCHORED / HIGH / ₪400.
    for (const [label, anchor] of PRICELESS) {
      const ctx = { stage: 'stage2', identity: ID, recognition: NINJA, anchor,
        evidence: deriveEvidence({ recognition: NINJA, anchor }).classes };
      const v = validateQuote(q(400), ctx);
      assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET, label);
      assert.equal(v.action, 'pending', label);
      assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 }, `${label} shipped a number`);
      assert.notEqual(derivePricingSource(ctx).source, 'stage2_comp_anchored', label);
      assert.notEqual(derivePricingSource(ctx).grade, 'HIGH', label);
    }
  });

  test('C1-c a PRICED row still prices — the fix is not "refuse everything"', () => {
    for (const [label, anchor] of PRICED) {
      const ctx = { stage: 'stage2', identity: ID, recognition: NINJA, anchor,
        evidence: deriveEvidence({ recognition: NINJA, anchor }).classes };
      const v = validateQuote(q(400), ctx);
      assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.ANCHORED, label);
      assert.equal(v.action, 'accept', label);
      assert.equal(v.prices.mid, 400, label);
    }
  });

  test('C1-d a priceless row opens no evidence-gated bucket', () => {
    // The second consequence: ANCHOR short-circuits bucketEntryPermitted, so an
    // empty object opened all 13 gated buckets and moved a watch 6,400 → 250,000.
    const watch = { category: 'Watches', subcategory: 'watch', category_confidence: 0.8,
      brand_candidates: [{ brand: 'Rolex', confidence: 0.9 }],
      model_candidates: [{ model: 'Submariner', confidence: 0.9 }], ocr_text: { raw_texts: [] } };
    for (const [label, anchor] of PRICELESS) {
      const ev = deriveEvidence({ recognition: watch, anchor }).classes;
      assert.equal(resolveEnvelopeKey(watch, ev), 'watches', `${label} opened a wider bucket`);
      const gatedOpen = Object.keys(ENVELOPES).filter((k) => {
        const parent = ENVELOPES[k.split(':')[0]];
        return k.includes(':') && parent && ENVELOPES[k].hard_max > parent.hard_max
          && bucketEntryPermitted(k, ev);
      });
      assert.deepEqual(gatedOpen, [], `${label} opened ${gatedOpen.length} gated buckets`);
    }
  });

  test('C1-e the caller cannot ASSERT the class it has not earned', () => {
    // VAL-7. `resolveValuationVerdict` tested `have.has('ANCHOR')`, and
    // asEvidenceSet accepts any array — so `evidence: ['ANCHOR']` alone produced
    // ANCHORED. The verdict is derived from the anchor OBJECT now.
    const ctx = { stage: 'stage2', identity: ID, recognition: NINJA,
      evidence: ['ANCHOR', 'DERIVED'] };
    assert.equal(resolveValuationVerdict(ctx), VALUATION_VERDICT.PENDING_MARKET);
    assert.equal(validateQuote(q(400), ctx).prices.mid, 0);
  });

  test('C1-f the guard and the shared module agree about what a price is', () => {
    // The guard may not import at will, so it keeps its own copy. Asserted over
    // the whole matrix rather than trusted, exactly as confidence() is.
    for (const [, a] of [...PRICELESS, ...PRICED]) {
      const viaModule = isPricedAnchor(a);
      const viaGuard = derivePricingSource({ stage: 'stage2', anchor: a }).source === 'stage2_comp_anchored';
      assert.equal(viaGuard, viaModule, `disagreement on ${JSON.stringify(a)}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C-3 · UNCERTAINTY REDUCES AUTHORITY
// ════════════════════════════════════════════════════════════════════════════
describe('C3 an unresolved bucket fails closed', () => {
  const CONFIRMED = { brandOk: true, modelOk: true, brandC: 0.95, modelC: 0.95,
    brandConfLabel: 'confirmed_by_text', identityHigh: true };

  test('C3-a the reported witnesses no longer inherit the global ceiling', () => {
    // These are the strings the §6 token fix was written to CORRECT. Before
    // round 4 they went from a wrong-but-tight bucket to 500,000 — the fix for a
    // widening defect widened by 31x-250x.
    for (const [cat, wasCeiling] of [['Tablet', 16000], ['Watchdog', 6400], ['Caravan', 2000]]) {
      const rec = { category: cat, category_confidence: 0.9,
        brand_candidates: [{ brand: 'X', confidence: 0.9 }],
        model_candidates: [{ model: 'Y1', confidence: 0.9 }], ocr_text: { raw_texts: [] } };
      const e = resolveEnvelope({ recognition: rec, identity: CONFIRMED });
      assert.equal(e.basis, 'manual_only', `${cat} must fail closed`);
      assert.equal(e.hard_max, 2000, `${cat} had ${wasCeiling}, briefly had 500000, must be 2000`);
      assert.equal(validateQuote(q(100000), { stage: 'pre', pre_source: 'catalog',
        anchorModelEvidence: true, identity: CONFIRMED, recognition: rec }).prices.mid, 0);
    }
  });

  test('C3-b NO identity tier buys the global ceiling', () => {
    // The old branch: confirmed identity → GLOBAL_ENVELOPE, weak → MANUAL_ONLY.
    // Strengthening the identity does not make the BUCKET better known.
    const rec = { category: 'Quantum Widgets', category_confidence: 0.99 };
    for (const identity of [
      { brandOk: true, modelOk: true, brandC: 0.99, modelC: 0.99, brandConfLabel: 'confirmed_by_text' },
      { brandOk: true, modelOk: false, brandC: 0.99 },
      { brandOk: false, modelOk: false },
      null,
    ]) {
      const e = resolveEnvelope({ recognition: rec, identity });
      assert.equal(e.hard_max, 2000);
      assert.notEqual(e.basis, 'global');
    }
  });

  test('C3-c malformed and inherited envelope keys fail closed', () => {
    // VAL-6. `ENVELOPES['__proto__']` returned Object.prototype: truthy, so the
    // `!env` guard passed, and floor/soft_max/hard_max were all undefined. Every
    // comparison against undefined is false, so ₪999,999,999 was ACCEPTED with
    // zero violations.
    const rec = { category: 'Electronics', category_confidence: 0.9 };
    for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
      'hasOwnProperty', '', 'nope', 'Electronics']) {
      const e = resolveEnvelope({ envelope_key: key, identity: CONFIRMED, recognition: rec });
      assert.ok(Number.isFinite(e.floor) && Number.isFinite(e.hard_max),
        `${key}: bounds must be real numbers, got ${e.floor}/${e.hard_max}`);
      assert.ok(e.hard_max <= 6400, `${key}: must not exceed the electronics parent`);
      const v = validateQuote({ low: 1, mid: 999999999, high: 1000000000, currency: 'ILS' },
        { stage: 'pre', pre_source: 'catalog', anchorModelEvidence: true,
          envelope_key: key, identity: CONFIRMED, recognition: rec });
      assert.equal(v.prices.mid, 0, `${key} accepted ₪999,999,999`);
      assert.ok(v.violations.length > 0, `${key} produced no violation`);
    }
  });

  test('C3-d a caller-supplied key is subject to bucket authority', () => {
    // VAL-5. §3 stated the rule unconditionally and checked one of the two places
    // a key can come from. `envelope_key:'watches:luxury'` with DERIVED-only
    // handed over hard 250,000.
    const rec = { category: 'Watches', category_confidence: 0.9 };
    const weak = resolveEnvelope({ envelope_key: 'watches:luxury', identity: CONFIRMED,
      recognition: rec, evidence: new Set(['DERIVED']) });
    assert.equal(weak.key, 'watches', 'must fall back to the parent, not honour the request');
    assert.ok(weak.hard_max < 250000);
    const strong = resolveEnvelope({ envelope_key: 'watches:luxury', identity: CONFIRMED,
      recognition: rec, evidence: new Set(['DERIVED', 'OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT']) });
    assert.equal(strong.key, 'watches:luxury', 'and must be honoured when the evidence is there');
  });

  test('C3-e every envelope this module can return has finite bounds', () => {
    // The class, over the whole table plus adversarial keys, rather than the
    // three prototype names somebody thought of.
    const keys = [...Object.keys(ENVELOPES), '__proto__', 'constructor', 'prototype',
      '__defineGetter__', 'isPrototypeOf', 'x', '', 'a:b:c', ':', 'electronics:'];
    for (const key of keys) {
      const e = resolveEnvelope({ envelope_key: key, identity: CONFIRMED,
        recognition: { category: 'Electronics', category_confidence: 0.9 },
        evidence: new Set(['DERIVED', 'OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT']) });
      for (const f of ['floor', 'soft_max', 'hard_max']) {
        assert.ok(Number.isFinite(e[f]) && e[f] > 0, `${key}.${f} = ${e[f]}`);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C-2 · THE GUARD RECEIVES WHAT WAS ESTABLISHED
// ════════════════════════════════════════════════════════════════════════════
describe('C2 no field established upstream may be silently dropped', () => {
  test('C2-a every ctx.<name> the guard reads is provided by the production caller', () => {
    // GENERALISED FROM THE `comps` TEST, which asserted one field name. That test
    // already stated the rule — "a field the guard reads must be listed here or
    // it is silently dropped" — and checked a single instance of it, while five
    // more were being dropped beside it. The field list is derived from the
    // guard's own source now, so the next one cannot be missed.
    const guard = readFileSync(new URL('../api/_lib/valuation-guard.js', import.meta.url), 'utf8');
    const analyze = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');

    const read = new Set();
    for (const m of guard.matchAll(/\bctx(?:\?)?\.([A-Za-z_$][\w$]*)/g)) read.add(m[1]);
    assert.ok(read.size >= 8, `fixture: expected to find ctx reads, found ${read.size}`);

    const start = analyze.indexOf('const gctx = {');
    const end = analyze.indexOf('let verdict = null;', start);
    assert.ok(start > 0 && end > start, 'fixture: the gctx builder must be locatable');
    const gctx = analyze.slice(start, end);

    // The spread is what makes this safe: it forwards the composition point's
    // fields without each one needing to be named here.
    assert.match(gctx, /\.\.\.guardCtx/,
      'gctx must forward the caller context rather than rebuilding it from a whitelist');

    // DELIBERATELY WITHHELD, with the reason, so an intentional omission is
    // distinguishable from an accidental one. That distinction is the whole point:
    // C-2 was five accidental omissions sitting beside one deliberate design
    // decision, and nothing in the code could tell them apart.
    const WITHHELD = {
      envelope_key: 'the caller may choose which envelope BOUNDS a price, never the '
        + 'evidence that decides whether there is a price at all',
      // WITHHELD BY THE PHASE-B ISOLATION, not by oversight. Market evidence is
      // minted on the /api/enrich path and handed to the guard there; §2
      // forbids the scan path from routing through Phase B, so gctx must NOT
      // acquire this field. The day it does, this declaration has to be deleted
      // and the isolation argued again — which is exactly the conversation the
      // deliberate/accidental distinction exists to force.
      market_evidence: 'minted only on the /api/enrich path; §2 forbids the scan path '
        + 'from routing through Phase B, so the production caller must not set it',
    };
    // Tokenised rather than regex-escaped: every attempt to write a word-boundary
    // escape through this toolchain produced a literal control character instead.
    const tokensOf = (hay) => new Set(hay.split(/[^A-Za-z0-9_$]+/).filter(Boolean));
    const has = (hay, f) => tokensOf(hay).has(f);
    const before = analyze.slice(Math.max(0, start - 4000), start);
    const missing = [...read].filter((f) => !Object.prototype.hasOwnProperty.call(WITHHELD, f)
      && !has(gctx, f) && !has(before, f));
    assert.deepEqual(missing, [],
      'read by the guard, set by no production caller, and not declared withheld');
    for (const f of Object.keys(WITHHELD)) {
      assert.ok(read.has(f), f + ' is declared withheld but the guard no longer reads it');
    }
  });

  test('C2-b the composition point establishes the six round-3 fields', () => {
    const analyze = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
    for (const f of ['evidence', 'pricing_category', 'display_category',
      'pricing_envelope_source', 'category_disagreement']) {
      assert.match(analyze, new RegExp(`guardCtx\\.${f}\\s*=`), `${f} must be established`);
    }
  });
});

describe('H1 a refusal reports what it refused, and never more', () => {
  test('H1-a a degrade never keeps a verdict that claims the number was backed', () => {
    // Found by mutation: removing the MANUAL coercion in degrade() survived,
    // because nothing exercised a scan whose BASE verdict was BOUNDED and which
    // then failed a NUMERIC rule. The verdicts are computed before the numeric
    // rules run, so without the coercion such a scan reports BOUNDED beside its
    // own refusal — the envelope claiming to have bounded a number it rejected.
    const rec = { category: 'Electronics', category_confidence: 0.55 };
    const weak = { brandOk: false, modelOk: false };
    const base = { stage: 'stage2', identity: weak, recognition: rec };
    // Sanity: this context really is BOUNDED when the quote is sound.
    assert.equal(validateQuote(q(200), base).metadata.valuation_verdict, VALUATION_VERDICT.BOUNDED);
    // Now break the quote in each way that exits before the numeric rules pass.
    for (const [label, quote] of [
      ['out of envelope', { low: 90000, mid: 100000, high: 120000, currency: 'ILS' }],
      ['inverted order', { low: 2000, mid: 1200, high: 3000, currency: 'ILS' }],
      ['non-finite mid', { low: 100, mid: 'nan', high: 900, currency: 'ILS' }],
      ['wrong currency', { low: 100, mid: 200, high: 400, currency: 'USD' }],
    ]) {
      const v = validateQuote(quote, base);
      assert.equal(v.action, 'degrade', label);
      assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.MANUAL,
        `${label}: a refusal reported ${v.metadata.valuation_verdict}`);
      assert.notEqual(v.metadata.valuation_verdict, VALUATION_VERDICT.BOUNDED, label);
    }
  });

  test('H1-b PENDING_MARKET is the one verdict a refusal may keep', () => {
    // It is itself a refusal, and the only one /api/enrich can act on. Flattening
    // it to MANUAL is what made a pending scan indistinguishable from an
    // unrecognisable one.
    const v = validateQuote(q(400), { stage: 'stage2', identity: ID, recognition: NINJA,
      evidence: deriveEvidence({ recognition: NINJA }).classes });
    assert.equal(v.action, 'pending');
    assert.equal(v.metadata.valuation_verdict, VALUATION_VERDICT.PENDING_MARKET);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// H-3 · A GATE THAT CANNOT BE OPENED IS NOT A GATE
// ════════════════════════════════════════════════════════════════════════════
describe('H3 every gated bucket is reachable by some real evidence set', () => {
  test('H3-a no bucket is arithmetically unreachable', () => {
    // §5A: "A security rule that makes legitimate states impossible is not
    // correct merely because it fails closed." Enumerated mechanically, so a
    // bucket added tomorrow is covered without anyone listing it.
    const gated = Object.keys(ENVELOPES).filter((k) => {
      const p = ENVELOPES[k.split(':')[0]];
      return k.includes(':') && p && ENVELOPES[k].hard_max > p.hard_max;
    });
    assert.ok(gated.length >= 10, `only ${gated.length} gated buckets — the check would be vacuous`);
    const REACHABLE = [
      new Set(['DERIVED', 'OBJECT_CLASS']),
      new Set(['DERIVED', 'OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT']),
      new Set(['DERIVED', 'ANCHOR']),
    ];
    for (const k of gated) {
      assert.ok(REACHABLE.some((e) => bucketEntryPermitted(k, e)),
        `${k} requires ${[...bucketEntryRequirement(k)].join('+')} and no real evidence set satisfies it`);
      assert.equal(bucketEntryPermitted(k, new Set(['DERIVED'])), false,
        `${k} must still refuse DERIVED alone`);
    }
  });
});
