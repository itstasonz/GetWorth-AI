// ══════════════════════════════════════════════════════════════════════════════
// serialOCR — the three outcomes, observed at the WIRE.
//
// WHY THIS EXISTS
// Round 8 changed production semantics for the serialOCR endpoint: `ocrSerialLabel`
// stopped returning `''` for every non-2xx and started returning one of three
// outcomes — OCR_FOUND, OCR_NO_TEXT, OCR_PROVIDER_FAILURE — so that "the photo
// genuinely has no text" and "the provider failed" could no longer render as the
// same empty string. That shipped with NO committed regression coverage, which is
// precisely the condition under which the old behaviour quietly comes back: the
// collapse is invisible at the call site (both produce a string), and every
// existing suite would stay green.
//
// WHAT IS ASSERTED
// Not the helper's return value — the helper is not the thing that reaches the
// user. Every assertion here is against the RESPONSE the client receives and the
// REFUND RPC the handler did or did not make, driven through the real exported
// handler by tests/helpers/analyze-harness.mjs.
//
// THE PROPERTY, in one line:
//   a successful scan with no text and a failed scan must never be the same
//   response, and only the failed one may return the user's scan.
//
//   node --test tests/serial-ocr.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { harness, IMG } from './helpers/analyze-harness.mjs';

let h;
const savedEnv = {};
before(async () => {
  for (const k of ['RECOGNITION_ENGINE', 'OPENAI_API_KEY']) savedEnv[k] = process.env[k];
  delete process.env.RECOGNITION_ENGINE;
  h = await harness();
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  h?.restore();
});

// The Anthropic messages shape ocrSerialLabel reads: content[] -> first text part.
const ocrBody = (text) => ({
  status: 200,
  body: {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 400, output_tokens: 20 },
  },
});

const runOCR = () => h.run({ imageData: IMG, lang: 'en', serialOCR: true });

// ── SUCCESS OUTCOMES ────────────────────────────────────────────────────────
describe('200 from the provider is a SUCCESS, whatever the label said', () => {
  test('OCR_FOUND — text on the label reaches the client verbatim', async () => {
    const LABEL = 'S/N: ABC-12345\nIMEI 990000862471854';
    h.anthropic(() => ocrBody(`  ${LABEL}  `));
    const r = await runOCR();

    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    // .trim() is the only transform the endpoint performs; the interior is intact.
    assert.equal(r.payload.ocrText, LABEL);
    assert.deepEqual(r.payload.raw_texts, [LABEL],
      'raw_texts is the array form of the same extraction');
    assert.equal(r.payload.code, undefined, 'a success carries no failure code');
    assert.equal(r.payload.error, undefined, 'a success carries no error string');
    assert.equal(r.refunds, 0, 'the provider billed — the scan is consumed, not returned');
  });

  test('OCR_NO_TEXT — a genuinely blank label is 200 with an empty string', async () => {
    // THE ROUND-8 DISTINCTION. This response and the 503 below were the same
    // wire result before round 8: HTTP 200, `ocrText: ''`. The client could not
    // tell them apart, so it retried a failure it could not see and burned a
    // scan on every attempt.
    h.anthropic(() => ocrBody('   \n  '));
    const r = await runOCR();

    assert.equal(r.status, 200, 'the provider answered; a blank photo is not a failure');
    assert.equal(r.payload.ocrText, '', 'no text found is the empty string, and that is a RESULT');
    assert.deepEqual(r.payload.raw_texts, ['']);
    assert.equal(r.payload.code, undefined, 'OCR_NO_TEXT must not carry a failure code');
    assert.equal(r.refunds, 0, 'the provider billed for a real answer — no refund');
  });

  test('both success outcomes bill exactly one provider call and skip the pipeline', async () => {
    // serialOCR is an early exit. If it ever stopped returning before the
    // pipeline, a caller asking for a label read would silently pay for a full
    // recognition — the same "one flag, two behaviours" class this suite covers.
    for (const text of ['SN-1', '']) {
      h.anthropic(() => ocrBody(text));
      const r = await runOCR();
      assert.equal(r.providerCalls.anthropic, 1, `exactly one OCR call for ${JSON.stringify(text)}`);
      assert.equal(r.providerCalls.openai, 0, 'serialOCR never reaches the recognition engine');
      assert.equal(r.providerCalls.vision, 0, 'serialOCR never reaches Vision');
    }
  });
});

// ── PROVIDER FAILURE OUTCOMES ───────────────────────────────────────────────
// Every one of these must be DISTINGUISHABLE from the blank-label success above,
// and every one must return the scan, because a non-2xx means nothing was billed.
describe('a provider failure is a FAILURE, and returns the scan', () => {
  const FAILURES = {
    // `attempts` is what fetchWithRetry does with each status: 5xx and transport
    // errors are retried once, everything else is returned on the first answer.
    '401 auth': {
      respond: () => ({ status: 401, body: { error: { message: 'invalid x-api-key' } } }),
      kind: 'anthropic_auth_error', attempts: 1,
    },
    '429 rate limited': {
      respond: () => ({ status: 429, body: { error: { message: 'rate_limit_error' } } }),
      kind: 'anthropic_rate_limited', attempts: 1,
    },
    '503 upstream': {
      respond: () => ({ status: 503, body: { error: { message: 'overloaded_error' } } }),
      kind: 'anthropic_upstream_error', attempts: 2,
    },
    'network failure': {
      respond: () => ({ throw: new TypeError('fetch failed') }),
      kind: 'anthropic_upstream_error', attempts: 2,
    },
  };

  for (const [name, f] of Object.entries(FAILURES)) {
    test(`${name} ⇒ 503 OCR_PROVIDER_FAILURE, retryable, scan refunded`, async () => {
      h.anthropic(f.respond);
      const r = await runOCR();

      assert.equal(r.status, 503, `${name} must surface AS a failure, not as a 200 (got ${r.status})`);
      assert.equal(r.payload.code, 'OCR_PROVIDER_FAILURE',
        'the client needs a machine-readable reason it can branch on');
      assert.equal(r.payload.retryable, true, 'nothing was billed, so retrying is the correct advice');
      assert.ok(typeof r.payload.error === 'string' && r.payload.error.length > 0,
        'a human-readable message must accompany the code');
      assert.equal(r.payload.ocrText, undefined,
        'a failure must NOT carry an ocrText field — that is exactly the collapse round 8 removed');

      assert.equal(r.refunds, 1,
        `a non-2xx means the provider did not bill, so ${name} must return the scan ` +
        `(rpc=${r.rpcLog.join(',')})`);
      assert.equal(r.providerCalls.anthropic, f.attempts,
        `${name}: expected ${f.attempts} attempt(s) from fetchWithRetry`);
    });

    test(`${name} is classified ${f.kind}`, async () => {
      // The failureKind is what the refund policy reads. Asserting it through
      // the handler's own log keeps the classification observable without
      // re-exporting an internal, and catches a silent reclassification into a
      // NON-refundable kind — which would look identical on the wire but
      // quietly stop refunding.
      h.anthropic(f.respond);
      const r = await runOCR();
      assert.match(r.log, new RegExp(String.raw`\[SerialOCR\] provider failed \(${f.kind},`),
        `expected failureKind ${f.kind} in the handler log`);
      assert.match(r.log, /quota refunded\)/, 'the log must record that the refund happened');
    });
  }

  test('a 4xx that is neither auth nor rate-limit still fails closed as a failure', async () => {
    h.anthropic(() => ({ status: 400, body: { error: { message: 'invalid_request_error' } } }));
    const r = await runOCR();
    assert.equal(r.status, 503, 'any non-2xx is a provider failure');
    assert.equal(r.payload.code, 'OCR_PROVIDER_FAILURE');
    assert.match(r.log, /\[SerialOCR\] provider failed \(anthropic_api_error,/,
      'the residual bucket is anthropic_api_error, which is refundable');
    assert.equal(r.refunds, 1);
  });
});

// ── THE DISTINCTION ITSELF ──────────────────────────────────────────────────
describe('the blank label and the failed provider are never the same response', () => {
  test('OCR_NO_TEXT and OCR_PROVIDER_FAILURE differ in status, body and refund', async () => {
    h.anthropic(() => ocrBody(''));
    const ok = await runOCR();
    h.anthropic(() => ({ status: 503, body: { error: { message: 'overloaded_error' } } }));
    const bad = await runOCR();

    assert.notEqual(ok.status, bad.status, 'the status must differ');
    assert.notDeepEqual(ok.payload, bad.payload, 'the body must differ');
    assert.notEqual(ok.refunds, bad.refunds, 'the entitlement outcome must differ');

    // And specifically in the direction that matters: the SUCCESS consumes the
    // scan, the FAILURE returns it. Reversed, every `notEqual` above would still
    // hold — so pin the direction.
    assert.equal(ok.refunds, 0, 'a billed success consumes the scan');
    assert.equal(bad.refunds, 1, 'an unbilled failure returns it');
  });
});

// ── MONOTONIC CONSUMPTION, ON THIS PATH TOO ─────────────────────────────────
describe('a BILLED serialOCR call is never refunded by a later failure of ours', () => {
  test('200 whose body cannot be parsed ⇒ no refund', async () => {
    // The provider answered 2xx and charged. Everything after that — res.json(),
    // the content lookup, .trim() — is our code, and a throw there is our bug.
    h.anthropic(() => ({ status: 200, rawBody: '<html>502 Bad Gateway</html>' }));
    const r = await runOCR();
    assert.ok(r.providerCalls.anthropic > 0, 'fixture: the provider must have been called');
    assert.equal(r.refunds, 0,
      'the provider billed at res.ok; a later parse failure of ours may not return the scan');
    assert.notEqual(r.status, 200, 'the user still gets a failure — the delta is the allowance');
  });
});
