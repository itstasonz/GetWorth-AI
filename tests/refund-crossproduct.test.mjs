// ══════════════════════════════════════════════════════════════════════════════
// REFUND CROSS-PRODUCT — the test design that four rounds of patching lacked.
//
// WHY THIS EXISTS
// Rounds 3-6 each shipped a refund defect past a fully green suite. Round 6
// finally built a harness that drives the REAL handler and observes refunds as
// actual `decrement_user_daily_scan` RPCs — and STILL missed a defect, because
// the 17-case matrix enumerated billed-then-failing witnesses on one axis and
// engine paths on the other WITHOUT EVER CROSSING THEM. RL-16 walked the exact
// broken path but asserted on a successful scan, where refunds===0 holds
// trivially.
//
// So the unit of coverage here is not a case. It is a CROSS-PRODUCT:
//
//     ENGINE PATH  ×  BILLABLE SITE  ×  POST-BILLING FAILURE  ×  FALLBACK STATE
//
// Every combination that can exist is generated, not hand-listed. A new engine
// path cannot bypass the invariant, because adding one to ENGINE_PATHS
// multiplies it through every failure location automatically.
//
// THE INVARIANT
//   Once ANY provider attempt is known to be billable/consumed, that request's
//   cost state is monotonic. No engine switch, fallback, later provider
//   failure, parse failure, validation failure, internal exception or logging
//   failure may erase it.
//
// ORACLE: the real `decrement_user_daily_scan` RPC. Nothing else.
//
//   node --test tests/refund-crossproduct.test.mjs
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

// ── AXIS 1: POST-BILLING FAILURE LOCATION ───────────────────────────────────
// Each entry is an Anthropic 200 response — the provider HAS billed — shaped so
// the request then fails at a specific point in OUR code.
const FAILURE_POINTS = {
  'body-parse':        () => ({ status: 200, rawBody: '<html>not json</html>' }),
  'content-extract':   () => ({ status: 200, body: { content: 'not-an-array' } }),
  'contract/parse':    () => anthropicText('I am sorry, I cannot help with that.'),
  'truncation':        () => ({ status: 200, body: { content: [{ type: 'text', text: '{"a":' }], stop_reason: 'max_tokens' } }),
  'calibration':       () => anthropicText({ ...VALID_RECOGNITION, model_candidates: [{ model: 910006178, confidence: 0.9, evidence: 'ocr' }] }),
  'logging':           () => anthropicText({ ...VALID_RECOGNITION, ocr_text: { raw_texts: [{ toString: 1, valueOf: 2 }], logos_detected: [], has_readable_text: true } }),
  'normalization':     () => anthropicText({ ...VALID_RECOGNITION, brand_candidates: [{ brand: 3120, confidence: 0.9, evidence: 'ocr' }] }),
  'arbitrary-unknown': () => anthropicText({ ...VALID_RECOGNITION, category_confidence: { toString: 1, valueOf: 2 } }),
};

// ── AXIS 2: ENGINE PATH ─────────────────────────────────────────────────────
// `anthropicRole` says which Anthropic call carries the failing response:
//   'primary'  — the flag is off, Stage 1 calls Anthropic directly
//   'fallback' — the flag is on, OpenAI fails UNCONSUMED, Anthropic takes over
//   'post-openai-consumed' — OpenAI is BILLED then rejected; Anthropic follows
const ENGINE_PATHS = {
  'current-engine': {
    setup: () => { delete process.env.RECOGNITION_ENGINE; h.openai(() => { throw new Error('OpenAI must not be called'); }); },
    anthropicRole: 'primary',
  },
  'openai-unconsumed-fallback': {
    setup: () => {
      process.env.RECOGNITION_ENGINE = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test-key-1234567890';
      // A 500 is NOT a billed completion: the ledger must stay empty, so the
      // ONLY consumption evidence in this request comes from the Anthropic
      // fallback. That is precisely the path round 6 left unmarked.
      h.openai(() => ({ status: 500, body: { error: { message: 'server error' } } }));
    },
    anthropicRole: 'fallback',
  },
  'openai-consumed-then-fallback': {
    setup: () => {
      process.env.RECOGNITION_ENGINE = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test-key-1234567890';
      // 200 WITH usage tokens, rejected by our schema: billed, and monotonic
      // consumption must survive everything the fallback then does.
      h.openai(() => ({ status: 200, body: {
        output: [{ content: [{ type: 'output_text', text: 'NOT JSON' }] }],
        output_text: 'NOT JSON', usage: { input_tokens: 1200, output_tokens: 800 },
      } }));
    },
    anthropicRole: 'post-openai-consumed',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// THE CROSS-PRODUCT — generated, not enumerated
// ─────────────────────────────────────────────────────────────────────────────
for (const [engineName, engine] of Object.entries(ENGINE_PATHS)) {
  for (const [failName, failResponse] of Object.entries(FAILURE_POINTS)) {
    test(`XP [${engineName}] × [${failName}] — billed Anthropic, later failure ⇒ NO REFUND`, async () => {
      engine.setup();
      h.anthropic(failResponse);
      const r = await h.run({ imageData: IMG, lang: 'en' });

      assert.ok(r.providerCalls.anthropic > 0,
        'fixture: the Anthropic call must actually happen on this path');
      assert.equal(r.refunds, 0,
        `a BILLED ${engine.anthropicRole} Anthropic call must not be refunded by a later ` +
        `${failName} failure (status=${r.status}, rpc=${r.rpcLog.join(',')})`);
    });
  }
}

// ── AXIS 3: the serialOCR billable site, crossed with its own failure points ──
// NOT APPLICABLE to the engine axis: `serialOCR` returns before Stage 1 is
// reached (api/analyze.js, the early-exit block), so no engine path can alter
// it. Evidence: the early exit `return json({ ocrText, ... })` precedes
// `resolveRecognitionEngine()`.
for (const [failName, failResponse] of Object.entries({
  'body-parse': FAILURE_POINTS['body-parse'],
  'content-extract': FAILURE_POINTS['content-extract'],
})) {
  test(`XP [serialOCR] × [${failName}] — billed, later failure ⇒ NO REFUND`, async () => {
    delete process.env.RECOGNITION_ENGINE;
    h.anthropic(failResponse);
    const r = await h.run({ imageData: IMG, lang: 'en', serialOCR: true });
    assert.ok(r.providerCalls.anthropic > 0, 'fixture: serialOCR must call the provider');
    assert.equal(r.refunds, 0, `a BILLED serialOCR call must not be refunded by a later ${failName} failure`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER DIRECTION — unconsumed failures must STILL refund on every path
// ─────────────────────────────────────────────────────────────────────────────
const UNCONSUMED = {
  'network-throw': () => ({ throw: new TypeError('fetch failed') }),
  'http-401': () => ({ status: 401, body: { error: { message: 'auth' } } }),
  'http-429': () => ({ status: 429, body: { error: { message: 'rate' } } }),
  'http-503': () => ({ status: 503, body: { error: { message: 'overloaded' } } }),
};
for (const [engineName, engine] of Object.entries(ENGINE_PATHS)) {
  for (const [failName, failResponse] of Object.entries(UNCONSUMED)) {
    test(`XP [${engineName}] × [${failName}] — refund iff nothing was billed`, async () => {
      engine.setup();
      h.anthropic(failResponse);
      const r = await h.run({ imageData: IMG, lang: 'en' });
      if (engine.anthropicRole === 'post-openai-consumed') {
        // OpenAI already billed: monotonic consumption forbids a refund even
        // though the Anthropic failure is itself a named refundable class.
        assert.equal(r.refunds, 0,
          'prior OpenAI consumption must survive an unconsumed fallback failure');
      } else {
        assert.equal(r.refunds, 1,
          `nothing was billed on this path, so ${failName} must still refund`);
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLS — the matrix must be able to distinguish a healthy scan
// ─────────────────────────────────────────────────────────────────────────────
test('XP control — a healthy scan on every engine path refunds nothing and returns 200', async () => {
  for (const [name, engine] of Object.entries(ENGINE_PATHS)) {
    engine.setup();
    if (name === 'openai-consumed-then-fallback') {
      h.openai(() => ({ status: 200, body: {
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(VALID_RECOGNITION) }] }],
        output_text: JSON.stringify(VALID_RECOGNITION), usage: { input_tokens: 1200, output_tokens: 400 },
      } }));
    }
    h.anthropic(() => anthropicText(VALID_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.equal(r.refunds, 0, `${name}: a healthy scan refunds nothing`);
    assert.equal(r.status, 200, `${name}: a healthy scan returns 200, got ${r.status}`);
  }
});

test('XP control — a request rejected before any provider call refunds nothing', async () => {
  delete process.env.RECOGNITION_ENGINE;
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  const r = await h.run({ imageData: 'not-a-valid-image', lang: 'en' });
  assert.equal(r.providerCalls.anthropic, 0, 'no provider may be called');
  assert.equal(r.refunds, 0, 'nothing was billed, and nothing was charged for');
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURAL — every provider call site must have an EXPLICIT ledger relationship
//
// The round-6 defect was not a wrong idea; it was a caller that forgot an
// argument. Threading a callback means any call site can omit it and nothing
// notices. This derives the provider call sites FROM SOURCE and requires each
// to be either directly ledger-marked, or covered by the stated downstream
// invariant — so a newly added provider call cannot ship uncovered.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

const ANALYZE = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
const OPENAI_LIB = readFileSync(new URL('../api/_lib/openai-recognition.js', import.meta.url), 'utf8');

const PROVIDER_HOSTS = ['api.anthropic.com', 'api.openai.com', 'vision.googleapis.com', 'api.voyageai.com'];

test('XP-STRUCT every provider host in source is inside a ledger-covered helper', () => {
  const lines = ANALYZE.split(/\r?\n/);
  const found = [];
  lines.forEach((l, i) => {
    for (const host of PROVIDER_HOSTS) {
      if (!l.includes(host)) continue;
      let fn = '?';
      for (let j = i; j >= 0 && j > i - 150; j--) {
        const m = /^(?:export )?(?:async )?function (\w+)/.exec(lines[j]);
        if (m) { fn = m[1]; break; }
      }
      found.push({ line: i + 1, host, fn });
    }
  });
  assert.ok(found.length >= 7, `expected the known provider sites, found ${found.length}`);

  // Helpers that mark the ledger themselves, at the provider's own 2xx.
  const DIRECT = new Set(['recognize', 'ocrSerialLabel']);
  // Helpers reachable ONLY after Stage 1 delivered, and therefore covered by
  // the explicit invariant check that follows `await runStage1()`. This is a
  // documented, asserted dependency — not an assumption.
  const DOWNSTREAM = new Set(['fallbackVision', 'generateEmbedding', 'generateQueryEmbedding',
    'verifyAndPrice', 'preQuoteFromAI']);

  for (const site of found) {
    const covered = DIRECT.has(site.fn) || DOWNSTREAM.has(site.fn);
    assert.ok(covered,
      `provider call in ${site.fn}() at api/analyze.js:${site.line} has NO ledger relationship — ` +
      'add onBilled marking at its res.ok, or classify it as downstream-of-Stage-1 here');
  }

  // ── ORDERING, NOT MEMBERSHIP (round 8, MEDIUM-2) ────────────────────────
  // The check above asserts a NAME is in a set. That is not the property being
  // claimed. Round 7 proved it: inserting a `fallbackVision(...)` call ABOVE
  // `await runStage1()` left all 43 cases green, because nothing looked at call
  // ORDER. A DOWNSTREAM classification is only true if the call genuinely
  // cannot execute before Stage 1 has marked the ledger — so assert that.
  const stage1Idx = ANALYZE.indexOf('recognition = await runStage1();');
  assert.ok(stage1Idx > -1, 'the Stage-1 call must be locatable');

  for (const fn of DOWNSTREAM) {
    // Every INVOCATION of a downstream provider helper inside handleRequest
    // must appear after the Stage-1 call that marks the ledger.
    const callRe = new RegExp(String.raw`(?<![\w.])${fn}\s*\(`, 'g');
    for (const m of ANALYZE.matchAll(callRe)) {
      // Skip the declaration itself.
      const before = ANALYZE.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s$/.test(before) || /async function\s$/.test(before)) continue;
      assert.ok(m.index > stage1Idx,
        `${fn}() is called at source index ${m.index}, BEFORE await runStage1() at ${stage1Idx}. ` +
        'A downstream-classified provider call cannot run before the ledger is marked — ' +
        'either move it after Stage 1, or thread onBilled into it and reclassify it DIRECT.');
    }
  }

  // The direct markers must exist and sit at the provider response.
  for (const fn of DIRECT) {
    const body = ANALYZE.slice(ANALYZE.indexOf(`function ${fn}(`));
    assert.match(body.slice(0, 3000), /if \(res\.ok\) onBilled\?\.\('anthropic'/,
      `${fn} must mark the ledger at res.ok`);
  }
  assert.match(OPENAI_LIB, /if \(res\.ok\) onBilled\?\.\('openai'/,
    'the OpenAI adapter must mark the ledger at res.ok');

  // And the downstream invariant must actually be asserted in the code.
  assert.match(ANALYZE, /if \(!providerLedger\.consumed\) \{/,
    'the downstream-coverage invariant must be checked after Stage 1');
});

test('XP-STRUCT every recognize()/ocrSerialLabel() CALL passes the ledger', () => {
  // The round-6 HIGH in one assertion: a call site that omits onBilled.
  const lines = ANALYZE.split(/\r?\n/);
  const calls = [];
  lines.forEach((l, i) => {
    if (/\b(recognize|ocrSerialLabel)\(imageList/.test(l)) calls.push({ line: i + 1, text: l.trim() });
  });
  assert.ok(calls.length >= 3, `expected the known call sites, found ${calls.length}`);
  for (const c of calls) {
    assert.match(c.text, /onBilled/,
      `api/analyze.js:${c.line} calls a billable helper WITHOUT the ledger: ${c.text.slice(0, 70)}`);
  }
});

test('XP-STRUCT the OpenAI adapter call passes the ledger', () => {
  const m = /recognizeWithOpenAI\(imageList,\s*\{([^}]*)\}/.exec(ANALYZE);
  assert.ok(m, 'the adapter call site must be present');
  assert.match(m[1], /onBilled/, 'the OpenAI adapter call must pass the ledger');
});
