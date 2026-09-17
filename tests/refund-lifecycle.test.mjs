// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER-CONSUMPTION / REFUND LIFECYCLE — end to end through the REAL handler.
//
// WHY THIS SUITE EXISTS
// Three consecutive rounds shipped a refund defect past a green suite. Every
// refund assertion was indirect — it checked that a statement existed, that a
// helper returned, or called the policy function with hand-built arguments.
// None observed the thing that matters.
//
// THE ONLY ORACLE HERE:
//   did the real request handler call `decrement_user_daily_scan`?
//
// THE INVARIANT UNDER TEST
//   Once a provider has answered 2xx — the earliest honest evidence that tokens
//   were generated and billed — no later GetWorth failure may refund the
//   abuse-limiting quota for that request. Consumption is MONOTONIC: a fallback
//   to a second provider cannot erase the first provider's billing.
//
//   node --test tests/refund-lifecycle.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { harness, IMG, VALID_RECOGNITION, anthropicText } from './helpers/analyze-harness.mjs';

let h;
const savedEnv = {};
before(async () => {
  for (const k of ['RECOGNITION_ENGINE', 'OPENAI_API_KEY']) savedEnv[k] = process.env[k];
  h = await harness();
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  h?.restore();
});

const useCurrentEngine = () => { delete process.env.RECOGNITION_ENGINE; };
const useOpenAIEngine = () => {
  process.env.RECOGNITION_ENGINE = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test-key-1234567890';
};

// An OpenAI Responses-API body that satisfies the adapter's contract.
const openaiOk = (rec = VALID_RECOGNITION) => ({
  status: 200,
  body: {
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(rec) }] }],
    output_text: JSON.stringify(rec),
    usage: { input_tokens: 1200, output_tokens: 400 },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 ANTHROPIC — never billed ⇒ refund IS correct
// ─────────────────────────────────────────────────────────────────────────────

test('RL-01 request never sent (client body rejected pre-provider) ⇒ no provider call, no refund', async () => {
  useCurrentEngine();
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  const r = await h.run({ imageData: 'not-a-valid-image', lang: 'en' });
  assert.equal(r.providerCalls.anthropic, 0, 'no provider call may be made');
  assert.equal(r.refunds, 0, 'nothing was charged for, so nothing to refund');
  assert.ok(r.status >= 400 && r.status < 500, `expected a 4xx rejection, got ${r.status}`);
});

test('RL-02 network failure before any response ⇒ REFUND', async () => {
  useCurrentEngine();
  h.anthropic(() => ({ throw: new TypeError('fetch failed') }));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 1, 'the provider never answered, so it never billed');
  assert.equal(r.status, 503);
});

test('RL-03 non-success HTTP responses ⇒ REFUND', async () => {
  useCurrentEngine();
  for (const status of [401, 429, 500, 503]) {
    h.anthropic(() => ({ status, body: { error: { message: 'x' } } }));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.equal(r.refunds, 1, `HTTP ${status} is not a billed completion`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 ANTHROPIC — 2xx received ⇒ BILLED ⇒ refund is forbidden, whatever we break
// ─────────────────────────────────────────────────────────────────────────────

test('RL-04 billed response + local JSON failure ⇒ NO REFUND', async () => {
  useCurrentEngine();
  h.anthropic(() => ({ status: 200, rawBody: '<html>not json</html>' }));
  const r = await h.run({ imageData: IMG, lang: 'en', serialOCR: true });
  assert.equal(r.refunds, 0, 'ROUND-5 HIGH-1: a billed call must never be refunded');
  assert.equal(r.providerCalls.anthropic > 0, true, 'the provider was in fact called');
});

test('RL-05 billed response + content-shape failure ⇒ NO REFUND', async () => {
  useCurrentEngine();
  for (const body of [
    { content: 'not-an-array' },
    { content: [{ type: 'text', text: 12345 }] },
    { content: [{ type: 'text', text: { nested: true } }] },
    {},
  ]) {
    h.anthropic(() => ({ status: 200, body }));
    const r = await h.run({ imageData: IMG, lang: 'en', serialOCR: true });
    assert.equal(r.refunds, 0, `content shape ${JSON.stringify(body).slice(0, 40)} must not refund`);
  }
});

test('RL-06 billed response + truncation / unparseable output ⇒ NO REFUND', async () => {
  useCurrentEngine();
  // max_tokens truncation and a model emitting prose are PROVIDER outcomes, but
  // the provider answered 2xx and billed for the tokens. The user losing a scan
  // here is an entitlement question (GW-SCAN-ENTITLEMENT-001), not a refund bug.
  h.anthropic(() => ({ status: 200, body: { content: [{ type: 'text', text: '{"a":' }], stop_reason: 'max_tokens' } }));
  let r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0, 'max_tokens truncation is a BILLED 200');

  h.anthropic(() => anthropicText('I am sorry, I cannot help with that.'));
  r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0, 'unparseable model prose is a BILLED 200');
});

test('RL-07 billed response + later calibrateRecognition TypeError ⇒ NO REFUND', async () => {
  useCurrentEngine();
  // Round-5 witness A. A numerically-named product is enough — no attack.
  h.anthropic(() => anthropicText({
    ...VALID_RECOGNITION,
    model_candidates: [{ model: 910006178, confidence: 0.9, evidence: 'ocr' }],
  }));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0);
  assert.match(r.log, /NOT refunded/, 'the log must say why it was denied');
});

test('RL-08 billed response + later logging TypeError ⇒ NO REFUND', async () => {
  useCurrentEngine();
  // Round-5 witness B: survives calibration, throws at the Stage-1-end log
  // line, which sits OUTSIDE the Stage-1 try and reaches the outer fatal catch.
  h.anthropic(() => anthropicText({
    ...VALID_RECOGNITION,
    ocr_text: { raw_texts: [{ toString: 1, valueOf: 2 }], logos_detected: [], has_readable_text: true },
  }));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0);
});

test('RL-09 billed response + arbitrary/unknown internal failure ⇒ NO REFUND', async () => {
  useCurrentEngine();
  // Shapes nobody enumerated. The point of a lifecycle model rather than an
  // exception taxonomy is that these need no individual handling.
  for (const rec of [
    { ...VALID_RECOGNITION, brand_candidates: [{ brand: 3120, confidence: 0.9, evidence: 'ocr' }] },
    { ...VALID_RECOGNITION, category_confidence: { toString: 1, valueOf: 2 } },
    { ...VALID_RECOGNITION, model_candidates: 'not-an-array' },
    { ...VALID_RECOGNITION, visual_features: null },
  ]) {
    h.anthropic(() => anthropicText(rec));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.equal(r.refunds, 0, `unknown internal failure must not refund: ${JSON.stringify(rec).slice(0, 50)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 OPENAI — the same lifecycle, plus monotonicity across the fallback
// ─────────────────────────────────────────────────────────────────────────────

test('RL-10 OpenAI request never sent (flag off) ⇒ only Anthropic is called', async () => {
  useCurrentEngine();
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  h.openai(() => { throw new Error('OpenAI must not be called with the flag off'); });
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.providerCalls.openai, 0);
  assert.equal(r.refunds, 0);
});

test('RL-11 OpenAI network failure before response ⇒ unconsumed, Anthropic fallback decides', async () => {
  useOpenAIEngine();
  h.openai(() => ({ throw: new TypeError('fetch failed') }));
  h.anthropic(() => ({ status: 503, body: { error: { message: 'overloaded' } } }));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 1, 'neither provider answered, so neither billed');
});

test('RL-12 OpenAI non-success HTTP ⇒ unconsumed', async () => {
  useOpenAIEngine();
  h.openai(() => ({ status: 429, body: { error: { message: 'rate limited' } } }));
  h.anthropic(() => ({ status: 503, body: { error: { message: 'overloaded' } } }));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 1, 'an OpenAI 429 is not a billed completion');
});

test('RL-13 OpenAI 200 + valid contract ⇒ scan succeeds, no refund', async () => {
  useOpenAIEngine();
  h.openai(() => openaiOk());
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0);
  assert.equal(r.providerCalls.openai, 1);
});

test('RL-14 OpenAI 200 + usage + INVALID contract ⇒ consumed ⇒ NO REFUND', async () => {
  useOpenAIEngine();
  // ROUND-5 HIGH-2. A 200 with usage tokens is billed. GetWorth rejecting the
  // schema afterwards does not un-bill it, and the Anthropic fallback failing
  // must not refund it either — consumption is monotonic.
  h.openai(() => ({ status: 200, body: {
    output: [{ content: [{ type: 'output_text', text: 'THIS IS NOT JSON' }] }],
    output_text: 'THIS IS NOT JSON',
    usage: { input_tokens: 1200, output_tokens: 800 },
  } }));
  h.anthropic(() => ({ status: 503, body: { error: { message: 'overloaded' } } }));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0, 'a billed OpenAI call must not be refunded via the fallback kind');
  assert.equal(r.providerCalls.openai, 1);
  assert.equal(r.providerCalls.anthropic, 1, 'the fallback still ran');
});

test('RL-15 MONOTONIC — a later Anthropic failure cannot erase OpenAI consumption', async () => {
  useOpenAIEngine();
  h.openai(() => ({ status: 200, body: {
    output: [{ content: [{ type: 'output_text', text: 'not json' }] }],
    output_text: 'not json', usage: { input_tokens: 900, output_tokens: 100 },
  } }));
  // Every refundable Anthropic failure class, one at a time. None may refund,
  // because OpenAI already billed for this request.
  for (const anth of [
    () => ({ throw: new TypeError('fetch failed') }),
    () => ({ status: 503, body: { error: { message: 'x' } } }),
    () => ({ status: 429, body: { error: { message: 'x' } } }),
    () => ({ status: 401, body: { error: { message: 'x' } } }),
  ]) {
    h.anthropic(anth);
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.equal(r.refunds, 0, 'OpenAI consumption must survive any fallback outcome');
  }
});

test('RL-16 OpenAI unconsumed ⇒ Anthropic fallback succeeds ⇒ scan completes', async () => {
  useOpenAIEngine();
  h.openai(() => ({ status: 500, body: { error: { message: 'server error' } } }));
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0, 'a completed scan refunds nothing');
  assert.equal(r.providerCalls.anthropic > 0, true, 'the fallback carried the scan');
});

test('RL-17 a healthy scan never refunds and never 503s', async () => {
  useCurrentEngine();
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  const r = await h.run({ imageData: IMG, lang: 'en' });
  assert.equal(r.refunds, 0);
  assert.equal(r.status, 200, `a healthy scan must return 200, got ${r.status}`);
});
