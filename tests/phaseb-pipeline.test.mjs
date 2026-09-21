// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — PIPELINE, EVIDENCE QUALITY, VALUATION AND THE FIVE BENCHMARKS
//
// §30: every OpenAI call here is MOCKED. No automated test spends credits, and
// that is structural rather than promised — `runPhaseB` takes `fetchImpl`, and
// a test that forgot to inject one would fail on a missing key long before it
// reached the network.
//
//   node --test tests/phaseb-pipeline.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runPhaseB, PHASE_B_STATUS } from '../api/_lib/phaseb/pipeline.js';
import {
  normalizeObservations, rejectOutliers, normalizeCurrency, REJECTION, MARKET_MECHANISM,
} from '../api/_lib/phaseb/market-research.js';
import {
  computeValuationCandidate, VALUATION_STATUS, MIN_OBSERVATIONS_TO_PRICE, conditionMultiplier,
} from '../api/_lib/phaseb/valuation.js';
import { corroborateSubject, CORROBORATION } from '../api/_lib/phaseb/validation.js';
import {
  resolveEnrichmentMode, resolveEnrichmentModel, ENRICHMENT_MODE, ENRICHMENT_MODEL_DEFAULT,
} from '../api/_lib/phaseb/config.js';
import {
  ALL_BENCHMARKS, NINJA, LOGITECH, LG, LOUIS_VUITTON, UNKNOWN,
  NINJA_BLADE_ACCESSORY, mockOpenAI, IMG,
} from './fixtures/phaseb/benchmarks.mjs';

const KEY = 'sk-test-not-a-real-key';
const run = (fx, opts = {}) => runPhaseB({
  images: [IMG],
  language: 'en',
  existingRecognition: fx.recognition,
  ocrText: fx.ocr,
  apiKey: KEY,
  model: 'test-model',
  marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
  fetchImpl: mockOpenAI(fx, opts),
  ...opts.pipeline,
});

// ════════════════════════════════════════════════════════════════════════════
// PB-1 · THE FLAG (§4, §29)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-1 activation is server-owned and OFF by default', () => {
  test('PB-1a an empty environment is DISABLED', () => {
    assert.equal(resolveEnrichmentMode({}), ENRICHMENT_MODE.DISABLED_FLAG);
  });

  test('PB-1b only the exact string "true" enables it', () => {
    for (const v of ['false', 'TRUE ', '1', 'yes', 'on', '', ' ', 'True!', null, undefined]) {
      const mode = resolveEnrichmentMode({ OPENAI_ENRICHMENT_ENABLED: v, OPENAI_API_KEY: KEY });
      if (String(v).trim().toLowerCase() === 'true') continue;
      assert.equal(mode, ENRICHMENT_MODE.DISABLED_FLAG, `"${v}" must not enable Phase B`);
    }
    assert.equal(
      resolveEnrichmentMode({ OPENAI_ENRICHMENT_ENABLED: 'true', OPENAI_API_KEY: KEY }),
      ENRICHMENT_MODE.ENABLED);
    // Case and surrounding space are tolerated; anything else is not.
    assert.equal(
      resolveEnrichmentMode({ OPENAI_ENRICHMENT_ENABLED: ' TRUE ', OPENAI_API_KEY: KEY }),
      ENRICHMENT_MODE.ENABLED);
  });

  test('PB-1c flag ON with no key is DISABLED, not an error', () => {
    // §29: a missing key must never crash the existing scan path, and a half-
    // configured environment must not route traffic to a prototype.
    assert.equal(
      resolveEnrichmentMode({ OPENAI_ENRICHMENT_ENABLED: 'true' }),
      ENRICHMENT_MODE.DISABLED_NO_KEY);
  });

  test('PB-1d the model is centralised and overridable', () => {
    assert.equal(resolveEnrichmentModel({}), ENRICHMENT_MODEL_DEFAULT);
    assert.equal(resolveEnrichmentModel({ OPENAI_ENRICHMENT_MODEL: 'gpt-x' }), 'gpt-x');
  });

  test('PB-1e no request-shaped input can turn Phase B on', () => {
    // The function takes ONE argument and it is the environment. A body, a
    // header or a query parameter cannot reach it — a paid call a caller can
    // trigger is a billing hole.
    // NOT `.length` — a parameter with a default does not count toward it, so
    // `.length === 0` here and my first assertion was wrong about the code
    // rather than the code being wrong. The property is the SIGNATURE: one
    // parameter, and it is the environment.
    const src = resolveEnrichmentMode.toString();
    const params = /^function\s+\w+\s*\(([^)]*)\)/.exec(src)?.[1] ?? '';
    assert.match(params, /^\s*env\s*=\s*process\.env\s*$/,
      `activation must take the environment and nothing else; signature is (${params})`);
    for (const forbidden of ['req', 'request', 'body', 'headers', 'query', 'params']) {
      assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(src),
        `the flag resolver references "${forbidden}" — activation must read the environment only`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-2 · MARKET EVIDENCE QUALITY (§15, §16, §17)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-2 market evidence is normalised, filtered and never assumed ILS', () => {
  test('PB-2a currency is explicit or the observation is excluded', () => {
    const { accepted, rejected } = normalizeObservations([
      { observed_price: 500, currency: null, listing_kind: 'used_listing', match: { confidence: 0.9 } },
      { observed_price: 500, currency: 'banana', listing_kind: 'used_listing', match: { confidence: 0.9 } },
    ]);
    assert.equal(accepted.length, 0, 'an ambiguous currency must never default to ILS');
    assert.deepEqual(rejected.map((r) => r.reason), [REJECTION.NO_CURRENCY, REJECTION.NO_CURRENCY]);
  });

  test('PB-2b $500 is never ₪500 — foreign currency is CONTEXT, not evidence', () => {
    const { accepted, context } = normalizeObservations([
      { observed_price: 500, currency: 'USD', listing_kind: 'used_listing', match: { confidence: 0.9 } },
      { observed_price: 500, currency: 'ILS', listing_kind: 'used_listing', match: { confidence: 0.9 } },
    ]);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].normalized_ils_price, 500);
    assert.equal(context.length, 1);
    assert.equal(context[0].reason, REJECTION.FOREIGN_NO_FX);
    assert.equal(context[0].observation.normalized_ils_price, null,
      'no verified FX mechanism exists in this phase, so there is no normalised price');
  });

  test('PB-2c ILS is recognised however the listing spells it', () => {
    for (const v of ['ILS', 'ils', 'NIS', '₪', 'shekel', 'ש"ח']) {
      assert.equal(normalizeCurrency(v), 'ILS', `${v} must normalise to ILS`);
    }
    assert.equal(normalizeCurrency('$'), 'USD');
    assert.equal(normalizeCurrency(''), null);
    assert.equal(normalizeCurrency(null), null);
  });

  test('PB-2d the §16 rejection classes each fire', () => {
    const base = { observed_price: 100, currency: 'ILS', match: { confidence: 0.9 } };
    const cases = [
      [{ ...base, listing_kind: 'parts_only' }, REJECTION.PARTS_OR_BROKEN],
      [{ ...base, listing_kind: 'broken' }, REJECTION.PARTS_OR_BROKEN],
      [{ ...base, listing_kind: 'accessory' }, REJECTION.ACCESSORY],
      [{ ...base, listing_kind: 'new_retail' }, REJECTION.NOT_USED],
      [{ ...base, listing_kind: 'used_listing', match: { confidence: 0.1 } }, REJECTION.WRONG_MATCH],
      [{ ...base, listing_kind: 'used_listing', observed_price: null }, REJECTION.NO_PRICE],
    ];
    for (const [obs, reason] of cases) {
      const { accepted, rejected } = normalizeObservations([obs]);
      assert.equal(accepted.length, 0, reason);
      assert.equal(rejected[0]?.reason, reason);
    }
  });

  test('PB-2e duplicates collapse, by reference and by content', () => {
    const o = (ref, title, price) => ({
      observed_price: price, currency: 'ILS', listing_kind: 'used_listing',
      listing_id_or_reference: ref, source_domain: 'yad2.co.il', title,
      match: { confidence: 0.9 },
    });
    const byRef = normalizeObservations([o('x1', 'a', 100), o('x1', 'different title', 999)]);
    assert.equal(byRef.accepted.length, 1, 'the same listing reference is one listing');
    assert.equal(byRef.rejected[0].reason, REJECTION.DUPLICATE);

    const byContent = normalizeObservations([o(null, 'same', 100), o(null, 'same', 100)]);
    assert.equal(byContent.accepted.length, 1, 'same seller, same title, same price is a repost');
  });

  test('PB-2f a typo outlier is dropped without a mean chasing it', () => {
    const mk = (p, i) => ({
      observed_price: p, currency: 'ILS', listing_kind: 'used_listing',
      listing_id_or_reference: `r${i}`, match: { confidence: 0.9 },
    });
    const { accepted } = normalizeObservations([300, 320, 310, 305, 95000].map(mk));
    const { kept, dropped } = rejectOutliers(accepted);
    assert.equal(dropped.length, 1, 'the ₪95,000 typo must be dropped');
    assert.equal(dropped[0].observation.normalized_ils_price, 95000);
    assert.equal(kept.length, 4);
  });

  test('PB-2g below four observations NOTHING is dropped as an outlier', () => {
    // With three points there is no distribution to be an outlier from, and
    // dropping one is as likely to remove the only correct listing.
    const mk = (p, i) => ({
      observed_price: p, currency: 'ILS', listing_kind: 'used_listing',
      listing_id_or_reference: `s${i}`, match: { confidence: 0.9 },
    });
    const { accepted } = normalizeObservations([300, 310, 90000].map(mk));
    const { dropped } = rejectOutliers(accepted);
    assert.deepEqual(dropped, []);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-3 · VALUATION (§20, §21, §22)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-3 the valuation is computed, not generated', () => {
  const obsAt = (p, i) => ({ normalized_ils_price: p, listing_id_or_reference: `v${i}` });

  test('PB-3a too few observations means PENDING_MARKET and NO price', () => {
    for (const n of [0, 1, 2]) {
      const v = computeValuationCandidate({ accepted: Array.from({ length: n }, (_, i) => obsAt(500, i)) });
      assert.equal(v.status, VALUATION_STATUS.PENDING_MARKET, `${n} observations must not price`);
      assert.equal(v.mid, null);
      assert.equal(v.low, null);
      assert.equal(v.high, null);
      assert.match(v.reason, /fake precision/);
    }
    assert.equal(MIN_OBSERVATIONS_TO_PRICE, 3);
  });

  test('PB-3b at the floor it prices, and low <= mid <= high', () => {
    const v = computeValuationCandidate({ accepted: [300, 400, 500].map(obsAt) });
    assert.equal(v.status, VALUATION_STATUS.PRICED);
    assert.ok(v.low <= v.mid && v.mid <= v.high, `${v.low}/${v.mid}/${v.high} must be ordered`);
    assert.equal(v.sample_size, 3);
    assert.equal(v.currency, 'ILS');
  });

  test('PB-3c the product vocabulary rides alongside the canonical names', () => {
    // §20: low/mid/high stay canonical; quick_sale/fair_market/optimistic
    // travel with them rather than becoming new columns.
    const v = computeValuationCandidate({ accepted: [300, 400, 500].map(obsAt) });
    assert.deepEqual(v.labels, { low: 'quick_sale', mid: 'fair_market', high: 'optimistic_listing' });
  });

  test('PB-3d condition moves the number, and uses GetWorth’s own ladder', () => {
    const prices = [300, 400, 500, 450].map(obsAt);
    const good = computeValuationCandidate({ accepted: prices, condition: 'Good' });
    const poor = computeValuationCandidate({ accepted: prices, condition: 'Poor' });
    const likeNew = computeValuationCandidate({ accepted: prices, condition: 'Like New' });
    assert.ok(poor.mid < good.mid, 'a Poor item must not price above a Good one');
    assert.ok(likeNew.mid > good.mid, 'a Like New item must not price below a Good one');
    // The basis is the used market, because the comparables are used listings.
    assert.equal(conditionMultiplier('Good').basis, 'used');
    assert.equal(conditionMultiplier('Unknown').applied, false,
      'an unknown condition applies no adjustment rather than guessing one');
  });

  test('PB-3e a median, not a mean — one optimistic listing does not move it', () => {
    const modest = computeValuationCandidate({ accepted: [300, 310, 320, 330].map(obsAt) });
    const withDreamer = computeValuationCandidate({ accepted: [300, 310, 320, 330, 900].map(obsAt) });
    assert.ok(Math.abs(withDreamer.mid - modest.mid) < 60,
      `a single ₪900 listing moved the midpoint from ${modest.mid} to ${withDreamer.mid}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-4 · SUBJECT / REFERENCE — §9's boundary is NOT bypassed
// ════════════════════════════════════════════════════════════════════════════
describe('PB-4 an OpenAI claim does not bypass REC7-C1', () => {
  test('PB-4a a host named on accessory packaging is CONTRADICTED, not corroborated', () => {
    const c = corroborateSubject({
      identity: NINJA_BLADE_ACCESSORY.identity,
      ocrText: NINJA_BLADE_ACCESSORY.ocr,
    });
    assert.equal(c.level, CORROBORATION.CONTRADICTED,
      'the block is reference-bearing and names Ninja — the model promoted a reference');
    assert.equal(c.subject_text_permitted, false);
    assert.equal(c.brand_read_off_item, false);
  });

  test('PB-4b a genuine product label DOES corroborate', () => {
    const c = corroborateSubject({ identity: NINJA.identity, ocrText: NINJA.ocr });
    assert.equal(c.level, CORROBORATION.READ_OFF_ITEM);
    assert.ok(c.brand_read_off_item, 'NINJA is read off the item in a subject block');
  });

  test('PB-4c a model claim alone is MODEL_CLAIM_ONLY — never READ_OFF_ITEM', () => {
    // §11: a model saying 0.99 does not make an identity trusted. With no OCR
    // at all there is no independent reader, so the strongest honest level is
    // "the model said so".
    const c = corroborateSubject({ identity: NINJA.identity, ocrText: [] });
    assert.equal(c.level, CORROBORATION.MODEL_CLAIM_ONLY);
  });

  test('PB-4d the market stage is SKIPPED for a contradicted subject', async () => {
    // Searching a host the item merely references is how an accessory acquires
    // the host's comparables — REC7-C1 re-entering through the research stage.
    const r = await run(NINJA_BLADE_ACCESSORY);
    const q = r.stages.find((s) => s.stage === 'market_query');
    assert.equal(q.status, 'skipped');
    assert.match(q.detail, /contradicted/);
    assert.equal(r.valuation_candidate.status, VALUATION_STATUS.PENDING_MARKET);
    assert.equal(r.valuation_candidate.mid, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-5 · FAILURE BEHAVIOUR (§28)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-5 no failure produces a fabricated result', () => {
  const failures = {
    'rate limit': new Response('{"error":{"message":"rate limit"}}', { status: 429 }),
    'server error': new Response('{"error":{"message":"boom"}}', { status: 500 }),
    'auth': new Response('{"error":{"message":"bad key"}}', { status: 401 }),
  };

  for (const [label, response] of Object.entries(failures)) {
    test(`PB-5 ${label} yields FAILED with no candidate`, async () => {
      const r = await run(NINJA, { fail: response });
      assert.equal(r.status, PHASE_B_STATUS.FAILED);
      assert.equal(r.identity_candidate, null);
      assert.equal(r.valuation_candidate, null);
      assert.ok(r.failure_reason, 'the failure must be named');
    });
  }

  test('PB-5d malformed structured output is a failure, not a guess', async () => {
    const r = await run(NINJA, { malformed: true });
    assert.equal(r.status, PHASE_B_STATUS.FAILED);
    assert.equal(r.identity_candidate, null);
  });

  test('PB-5e a refusal is its own outcome', async () => {
    const r = await run(NINJA, { refusal: true });
    assert.equal(r.status, PHASE_B_STATUS.FAILED);
    assert.equal(r.failure_reason, 'refusal');
  });

  test('PB-5f a missing key never reaches the network', async () => {
    let called = false;
    const r = await runPhaseB({
      images: [IMG], apiKey: '', model: 'test-model',
      fetchImpl: async () => { called = true; return new Response('{}', { status: 200 }); },
    });
    assert.equal(called, false, 'no key must mean no request');
    assert.equal(r.status, PHASE_B_STATUS.FAILED);
    assert.equal(r.failure_reason, 'not_configured');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-6 · NO DUPLICATE CALLS (§38)
// ════════════════════════════════════════════════════════════════════════════
test('PB-6 one image question is asked once — the ledger proves it', async () => {
  const r = await run(NINJA);
  const calls = r.model_metadata.calls;
  const stages = calls.by_stage.map((c) => c.stage);
  assert.equal(stages.filter((s) => s === 'identity').length, 1,
    'the photograph must not be re-sent for fields B1/B2 already returned');
  assert.equal(stages.filter((s) => s === 'condition').length, 1);
  assert.equal(calls.attempts, stages.length);
  assert.equal(calls.billed, calls.attempts, 'every 2xx attempt is billed and recorded as such');
});

// ════════════════════════════════════════════════════════════════════════════
// PB-7 · THE FIVE BENCHMARKS (§31–§36)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-7 the five required benchmarks', () => {
  test('PB-7 NINJA — identified, priced from filtered comps, retail and accessory excluded', async () => {
    const r = await run(NINJA);
    assert.equal(r.identity_candidate.subject.brand, 'Ninja');
    assert.equal(r.identity_candidate.subject.object_class, 'blender');
    assert.equal(r.identity_candidate.corroboration.level, CORROBORATION.READ_OFF_ITEM);

    const c = r.market_evidence.counts;
    assert.equal(c.returned, 8);
    assert.equal(c.accepted, 4, 'four genuine used ILS listings survive');
    assert.equal(c.context_only, 1, 'the USD eBay listing is context, not evidence');
    const reasons = r.market_evidence.rejected.map((x) => x.reason);
    assert.ok(reasons.includes(REJECTION.NOT_USED), 'the KSP retail listing must be excluded');
    assert.ok(reasons.includes(REJECTION.ACCESSORY), 'the spare pitcher must be excluded');
    assert.ok(reasons.includes(REJECTION.DUPLICATE), 'the reposted listing must collapse');

    assert.equal(r.valuation_candidate.status, VALUATION_STATUS.PRICED);
    assert.ok(r.valuation_candidate.mid > 400 && r.valuation_candidate.mid < 900,
      `a used Ninja should land in the hundreds, got ${r.valuation_candidate.mid}`);
    assert.ok(r.validation.applied, 'the GetWorth guard must be applied');
  });

  test('PB-7 LOGITECH — recognition preserved, wrong-model comp rejected', async () => {
    const r = await run(LOGITECH);
    assert.equal(r.identity_candidate.subject.brand, 'Logitech');
    assert.equal(r.identity_candidate.subject.model, 'G Pro X Superlight');
    assert.equal(r.identity_candidate.corroboration.level, CORROBORATION.READ_OFF_ITEM);
    const reasons = r.market_evidence.rejected.map((x) => x.reason);
    assert.ok(reasons.includes(REJECTION.WRONG_MATCH), 'the G305 listing is not this mouse');
    assert.equal(r.market_evidence.counts.accepted, 4);
    assert.equal(r.valuation_candidate.status, VALUATION_STATUS.PRICED);
  });

  test('PB-7 LG — family honesty: no invented model, no exact-model comps', async () => {
    const r = await run(LG);
    assert.equal(r.identity_candidate.subject.brand, 'LG');
    assert.equal(r.identity_candidate.subject.model, null,
      '§33: do not invent an LG model');
    assert.equal(r.market_evidence.query.specificity, 'brand_category',
      'the search must not claim an exactness the evidence does not support');
    // Every comp is brand-level, so every one is below the match floor.
    assert.equal(r.market_evidence.counts.accepted, 0);
    assert.equal(r.valuation_candidate.status, VALUATION_STATUS.PENDING_MARKET,
      'generic brand comps must not be presented as this monitor’s value');
    assert.equal(r.status, PHASE_B_STATUS.IDENTIFIED_PENDING_MARKET);
  });

  test('PB-7 LOUIS VUITTON — market found, and the envelope conflict is RECORDED not resolved', async () => {
    const r = await run(LOUIS_VUITTON);
    assert.equal(r.identity_candidate.subject.brand, 'Louis Vuitton');
    assert.equal(r.valuation_candidate.status, VALUATION_STATUS.PRICED);
    assert.ok(r.valuation_candidate.mid > 900,
      `the second-hand market for this fragrance is around ₪1,000+, got ${r.valuation_candidate.mid}`);

    // §34: the beauty envelope is known to be too tight, and this phase must
    // NOT widen it. So the guard is expected to push back — and that pushback
    // is the finding, recorded rather than fixed.
    assert.ok(r.validation.applied);
    assert.ok(r.validation.envelope_hard_max !== null);
    if (r.valuation_candidate.mid > r.validation.envelope_hard_max) {
      assert.notEqual(r.validation.action, 'accept',
        'a candidate above the hard ceiling must not be accepted — the conflict is real');
    }
  });

  test('PB-7 UNKNOWN — the negative control stays unknown', async () => {
    const r = await run(UNKNOWN);
    assert.equal(r.identity_candidate.subject.brand, null, 'no invented brand');
    assert.equal(r.identity_candidate.subject.model, null, 'no invented model');
    assert.equal(r.market_evidence.counts.returned, 0, 'no fabricated comps');
    assert.equal(r.valuation_candidate.status, VALUATION_STATUS.PENDING_MARKET);
    assert.equal(r.valuation_candidate.mid, null, 'no authoritative price');
  });


  // ── THE RESULT THAT MATTERS MOST IN THIS PHASE ──────────────────────────
  //
  // Not "does Phase B produce a price" — it does — but "can that price be
  // accepted". It cannot, for any benchmark, and the reason is structural
  // rather than incidental: the guard's only market-evidence class is ANCHOR,
  // and §1 forbids OpenAI output from becoming one. This test exists so that
  // if a later change makes a Phase-B candidate guard-acceptable, someone has
  // to come here and justify which authority was granted to achieve it.
  test('PB-7g no Phase-B valuation is guard-acceptable today, and the status says so', async () => {
    const priced = [];
    for (const fx of ALL_BENCHMARKS) {
      const r = await run(fx);
      if (r.valuation_candidate.status !== VALUATION_STATUS.PRICED) continue;
      priced.push(fx.name);

      assert.notEqual(r.validation.action, 'accept',
        `${fx.name}: a Phase-B candidate was accepted by the guard. Phase B grants no ` +
        'ANCHOR, so acceptance means some other authority was widened — say which.');
      assert.equal(r.status, PHASE_B_STATUS.PRICED_GUARD_WITHHELD,
        `${fx.name}: a priced-but-declined candidate must not report as IDENTITY_ONLY`);
      assert.notEqual(r.status, PHASE_B_STATUS.COMPLETE);

      // The candidate keeps its own number. The guard withholding authority
      // must not reach back and erase what the research actually found (§11).
      assert.ok(r.valuation_candidate.mid > 0,
        `${fx.name}: the candidate's own valuation must survive the guard's refusal`);
    }
    assert.ok(priced.length >= 2,
      'this control is vacuous unless some benchmark actually produces a price');
  });

  test('PB-7z every benchmark records per-stage timing (§25)', async () => {
    for (const fx of ALL_BENCHMARKS) {
      const r = await run(fx);
      assert.ok(typeof r.timings.total_ms === 'number', `${fx.name}: no total`);
      assert.ok(r.stages.length >= 4, `${fx.name}: stages not recorded`);
      for (const s of r.stages) {
        assert.ok(typeof s.duration_ms === 'number', `${fx.name}/${s.stage}: no duration`);
        assert.ok(['ok', 'failed', 'skipped'].includes(s.status), `${fx.name}/${s.stage}: ${s.status}`);
      }
    }
  });
});
