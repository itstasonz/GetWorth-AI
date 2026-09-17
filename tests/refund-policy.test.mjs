// ══════════════════════════════════════════════════════════════════════════════
// GW-PROMPT-INJECTION-001 — REFUND POLICY.
//
// THE INVARIANT
//   An INTERNAL application failure must NEVER refund a paid upstream call that
//   already succeeded.
//
// WHY THIS SUITE EXISTS
//   The old policy refunded on `quotaCharged` alone, inside a catch that wraps
//   BOTH the paid Vision call AND all of our own post-processing. Reaching a
//   catch block is not evidence that the provider failed. So any throw after
//   the paid call — a TypeError in calibration, a logging bug, a future unknown
//   exception — returned the user's quota while GetWorth had already been
//   billed: an unbounded supply of free paid calls.
//
//   It needed no attack to reach. A product whose model number arrives from
//   Stage 1 as a JSON number (`{"model": 910006178}`) throws
//   `m0.model.toLowerCase is not a function` inside that try. That also 503s a
//   legitimate scan of a numerically-named product.
//
// WHAT IS TESTED
//   The POLICY, not the witnesses. `isRefundEligible` is pure and exported so
//   eligibility can be asserted directly, rather than inferred from which catch
//   block happened to run. The two historical witnesses are covered as
//   REGRESSION rows, not as the definition of the bug.
//
//   node --test tests/refund-policy.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ANALYZE_URL = new URL('../api/analyze.js', import.meta.url);
const A = await import(ANALYZE_URL.href);
const src = readFileSync(ANALYZE_URL, 'utf8');

const { isRefundEligible, REFUNDABLE_FAILURE_KINDS, calibrateRecognition } = A;

const CHARGED = { quotaCharged: true };

// ─────────────────────────────────────────────────────────────────────────────
// §1 The policy matrix — the cases the ticket enumerates
// ─────────────────────────────────────────────────────────────────────────────

test('RP-01 A — a provider failure BEFORE a usable result is refundable', () => {
  // Existing product policy: the user got nothing and we were not billed for a
  // delivered result, so the scan must not consume their allowance.
  for (const kind of ['stage1_timeout', 'anthropic_auth_error', 'anthropic_rate_limited',
    'anthropic_upstream_error', 'anthropic_api_error', 'upstream_network_error',
    'openai_timeout', 'openai_network', 'openai_auth', 'openai_rate_limited',
    'openai_upstream_5xx', 'openai_http_500', 'openai_http_429']) {
    assert.equal(isRefundEligible({ ...CHARGED, failureKind: kind, paidCallConsumed: false }), true,
      `${kind} is a named provider failure and must refund`);
  }
});

test('RP-02 B–G — ANY failure after a consumed paid call refunds NOTHING', () => {
  // One assertion per enumerated internal-failure class, plus classes that do
  // not exist yet. The discriminator is `paidCallConsumed`, which is a fact
  // about billing rather than a guess about an exception's type — so it holds
  // for faults nobody has enumerated.
  const INTERNAL = [
    ['B TypeError', 'other_failure'],
    ['C calibration failure', 'other_failure'],
    ['D logging failure', 'internal_fatal_after_paid_call'],
    ['E response normalization failure', 'other_failure'],
    ['F prompt/post-processing failure', 'internal_fatal_after_paid_call'],
    ['G unknown internal error', 'some_future_failure_nobody_named'],
    ['G RangeError', 'other_failure'],
    ['G unexpected response shape', 'other_failure'],
  ];
  for (const [label, kind] of INTERNAL) {
    assert.equal(isRefundEligible({ ...CHARGED, failureKind: kind, paidCallConsumed: true }), false,
      `${label} must NOT refund a consumed paid call`);
  }

  // And the invariant beats the allow-list: even a genuinely refundable class
  // cannot refund once the paid call delivered.
  for (const kind of REFUNDABLE_FAILURE_KINDS) {
    assert.equal(isRefundEligible({ ...CHARGED, failureKind: kind, paidCallConsumed: true }), false,
      `${kind} must NOT refund once the paid call was consumed`);
  }
});

test('RP-03 H — malformed client input rejected before the paid call', () => {
  // Nothing charged yet ⇒ nothing to refund, so no loop can exist here.
  assert.equal(isRefundEligible({ quotaCharged: false, failureKind: 'pre_paid_call_fatal', paidCallConsumed: false }), false);
  assert.equal(isRefundEligible({ quotaCharged: false, failureKind: 'stage1_timeout', paidCallConsumed: false }), false);
  // Charged but not yet billed: refunding is correct and costs nothing.
  assert.equal(isRefundEligible({ ...CHARGED, failureKind: 'pre_paid_call_fatal', paidCallConsumed: false }), true);
});

test('RP-04 the default is NO REFUND — eligibility must be positively named', () => {
  // Unclassified buckets are exactly where our own exceptions land.
  for (const kind of ['other_failure', 'openai_unknown', 'unknown', '', 'internal_fatal_after_paid_call']) {
    assert.equal(isRefundEligible({ ...CHARGED, failureKind: kind, paidCallConsumed: false }), false,
      `"${kind}" is not a named provider failure and must not refund`);
  }
  // Non-strings and missing context fail closed rather than throwing.
  for (const kind of [null, undefined, {}, [], 42, true, Symbol('x')]) {
    assert.doesNotThrow(() => isRefundEligible({ ...CHARGED, failureKind: kind, paidCallConsumed: false }));
    assert.equal(isRefundEligible({ ...CHARGED, failureKind: kind, paidCallConsumed: false }), false);
  }
  assert.equal(isRefundEligible({}), false, 'no context at all must not refund');
  assert.equal(isRefundEligible(), false, 'no argument at all must not refund');
});

test('RP-05 the allow-list contains no catch-all', () => {
  // A catch-all here silently reopens the loop, which is how the defect
  // survived four rounds. Assert the shape of the list itself.
  for (const forbidden of ['other_failure', 'openai_unknown', 'unknown', 'internal_fatal_after_paid_call', '*']) {
    assert.equal(REFUNDABLE_FAILURE_KINDS.includes(forbidden), false,
      `${forbidden} must never be refundable`);
  }
  assert.ok(Object.isFrozen(REFUNDABLE_FAILURE_KINDS), 'the allow-list must be frozen');
  for (const k of REFUNDABLE_FAILURE_KINDS) {
    assert.equal(typeof k, 'string');
    assert.ok(k.length > 0);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 The two historical witnesses — regression rows, not the definition
// ─────────────────────────────────────────────────────────────────────────────

test('RP-06 WITNESS A — a numeric Stage-1 model still fails, but refunds nothing', () => {
  // Reproduce the throw itself. The fix must NOT be "stop throwing" — input
  // validation is not weakened here; only the refund decision changed.
  const rec = {
    category: 'Electronics', category_confidence: 0.9,
    brand_candidates: [{ brand: 'Logitech', confidence: 0.9, evidence: 'ocr' }],
    model_candidates: [{ model: 910006178, confidence: 0.9, evidence: 'ocr' }],
    ocr_text: { raw_texts: ['Logitech'], logos_detected: [] },
    visual_features: { condition: 'Good', materials: [], colors: [] },
  };
  assert.throws(() => calibrateRecognition(rec), TypeError,
    'the witness must still throw — we did not paper over it');

  // It is an internal fault, and calibration runs after the paid call.
  assert.equal(isRefundEligible({ ...CHARGED, failureKind: 'other_failure', paidCallConsumed: true }), false,
    'witness A must not refund');
});

test('RP-07 WITNESS B — a hostile raw_texts element still fails, but refunds nothing', () => {
  const bomb = JSON.parse('{"toString":1,"valueOf":2}');
  const rec = {
    category: 'Electronics', category_confidence: 0.9,
    brand_candidates: [{ brand: 'Logitech', confidence: 0.9, evidence: 'ocr' }],
    model_candidates: [{ model: 'G502', confidence: 0.9, evidence: 'ocr' }],
    ocr_text: { raw_texts: [bomb], logos_detected: [] },
    visual_features: { condition: 'Good', materials: [], colors: [] },
  };
  // Passes calibration untouched, then throws at the Stage-1-end log line,
  // which sits OUTSIDE the Stage-1 try and reaches the outer fatal catch.
  const out = calibrateRecognition(rec);
  assert.throws(() => (out.ocr_text?.raw_texts || []).join('|'), TypeError,
    'the witness must still throw at the log join');

  assert.equal(isRefundEligible({ ...CHARGED, failureKind: 'internal_fatal_after_paid_call', paidCallConsumed: true }), false,
    'witness B must not refund');
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 WIRING — the policy must actually be the gate at both refund sites
// ─────────────────────────────────────────────────────────────────────────────

test('RP-08 every refundDailyQuota call site is gated by isRefundEligible', () => {
  // A correct policy with no call sites is the defect this whole ticket began
  // with. Assert the wiring directly.
  const calls = [...src.matchAll(/await refundDailyQuota\(/g)];
  assert.ok(calls.length >= 2, `expected the known refund sites, found ${calls.length}`);
  for (const m of calls) {
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    assert.match(before, /isRefundEligible\(/,
      'every refundDailyQuota() call must be guarded by isRefundEligible()');
  }
  // And the old unconditional form must be gone.
  assert.equal(/if \(quotaCharged\) \{ await refundDailyQuota/.test(src), false,
    'no refund may be gated on quotaCharged alone');
});

test('RP-09 paidCallConsumed is set at every paid upstream boundary', () => {
  // Two paid Anthropic calls sit after the quota charge: the serialOCR early
  // exit and Stage 1. Both must mark the quota as consumed.
  assert.match(src, /let paidCallConsumed = false;/, 'the flag must exist');
  const afterOcr = src.slice(src.indexOf('await ocrSerialLabel('), src.indexOf('await ocrSerialLabel(') + 220);
  assert.match(afterOcr, /paidCallConsumed = true/,
    'the serialOCR paid call must mark the quota consumed');
  const afterStage1 = src.slice(src.indexOf('recognition = await runStage1();'),
                                src.indexOf('recognition = await runStage1();') + 420);
  assert.match(afterStage1, /paidCallConsumed = true/,
    'Stage 1 must mark the quota consumed immediately after it returns');
});

test('RP-10 the outer fatal catch classifies by whether the paid call was consumed', () => {
  // EQUIVALENT-MUTANT NOTE. Collapsing this to a constant `pre_paid_call_fatal`
  // does NOT produce a refund — `isRefundEligible` checks `paidCallConsumed`
  // first and unconditionally, so the invariant still blocks it. That is
  // defence in depth working as intended. It is pinned here anyway so the
  // classification cannot silently drift into something a future edit trusts,
  // and so the two gates stay independently observable.
  assert.match(src,
    /const fatalKind = paidCallConsumed \? 'internal_fatal_after_paid_call' : 'pre_paid_call_fatal';/,
    'the outer catch must classify on paidCallConsumed');

  // Both gates are independently load-bearing: each alone refuses the refund.
  assert.equal(isRefundEligible({ quotaCharged: true, failureKind: 'internal_fatal_after_paid_call', paidCallConsumed: false }), false,
    'classification alone must refuse an internal fatal');
  assert.equal(isRefundEligible({ quotaCharged: true, failureKind: 'stage1_timeout', paidCallConsumed: true }), false,
    'the paid-call invariant alone must refuse a named provider failure');
});
