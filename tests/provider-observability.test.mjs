// ══════════════════════════════════════════════════════════════════════════════
// SEC-9 — EVERY BILLABLE PROVIDER IS OBSERVABLE IN THE HARNESS.
//
// WHY THIS EXISTS
// The round-9 provider INVENTORY in tests/refund-crossproduct.test.mjs listed
// four hosts. The harness that every refund test runs against modelled THREE,
// and answered anything else with `200 []`. So
// `generateQueryEmbedding@api.voyageai.com` — inventoried as DOWNSTREAM, and
// therefore claimed to be covered — was silently stubbed as a successful empty
// response, counted in no `providerCalls` bucket, across all 50 passing tests.
// Worse, the harness set neither VOYAGE_API_KEY nor GOOGLE_VISION_API_KEY, so
// both helpers returned null at their key check and never reached fetch at all.
// Two of four inventoried providers were unreachable in every test.
//
// That is the "verification artefact quietly not verifying" class again: the
// inventory asserted coverage, the harness could not deliver it, and nothing
// compared the two. A harness that invents a success for an unmodelled host
// launders an unknown into a pass — which is strictly worse than having no
// opinion, because a green suite is read as evidence.
//
// THE PROPERTY, in one line:
//   every host in the provider inventory is reachable AND counted, and any host
//   that is not is a loud failure rather than a quiet 200.
//
//   node --test tests/provider-observability.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, IMG, VALID_RECOGNITION, anthropicText } from './helpers/analyze-harness.mjs';

let h;
const savedEnv = {};
const ENV_KEYS = ['RECOGNITION_ENGINE', 'OPENAI_API_KEY', 'VOYAGE_API_KEY', 'GOOGLE_VISION_API_KEY'];
before(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  h = await harness();
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  h?.restore();
});

// A recognition weak enough to trigger the Vision fallback and the embedding
// path: low confidences everywhere, no readable text.
const WEAK_RECOGNITION = {
  ...VALID_RECOGNITION,
  category_confidence: 0.5,
  brand_candidates: [{ brand: 'Unknown', confidence: 0.2, evidence: 'shape_only' }],
  model_candidates: [{ model: 'unidentified', confidence: 0.1, evidence: 'none' }],
  ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
};

describe('every inventoried provider host is reachable AND counted', () => {
  test('anthropic is observed', async () => {
    delete process.env.RECOGNITION_ENGINE;
    h.anthropic(() => anthropicText(VALID_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.ok(r.providerCalls.anthropic > 0, 'the Anthropic bucket must count the Stage-1 call');
  });

  test('voyage is observed — the bucket SEC-9 was missing', async () => {
    // The embedding path needs VOYAGE_API_KEY (the harness now sets it) and
    // enough budget. A weak recognition keeps the pipeline on the full path.
    delete process.env.RECOGNITION_ENGINE;
    let sawVoyage = 0;
    h.voyage(() => { sawVoyage++; return { body: { data: [{ embedding: new Array(1024).fill(0.01) }] } }; });
    h.anthropic(() => anthropicText(WEAK_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });

    assert.ok(sawVoyage > 0,
      'api.voyageai.com was never called — generateQueryEmbedding is unreachable in the harness, ' +
      'so its INVENTORY entry asserts coverage the tests cannot deliver');
    assert.equal(r.providerCalls.voyage, sawVoyage,
      'every Voyage call must land in the voyage bucket, not in the catch-all');
  });

  test('google vision is observed', async () => {
    delete process.env.RECOGNITION_ENGINE;
    let sawVision = 0;
    h.vision(() => { sawVision++; return { body: { responses: [{ labelAnnotations: [] }] } }; });
    h.anthropic(() => anthropicText(WEAK_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });

    assert.ok(sawVision > 0, 'vision.googleapis.com was never called on a weak-identity scan');
    assert.equal(r.providerCalls.vision, sawVision, 'every Vision call must land in the vision bucket');
  });

  test('openai is observed when the engine flag selects it', async () => {
    process.env.RECOGNITION_ENGINE = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test-key-1234567890';
    let sawOpenAI = 0;
    h.openai(() => { sawOpenAI++; return { status: 500, body: { error: { message: 'server error' } } }; });
    h.anthropic(() => anthropicText(VALID_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });

    assert.ok(sawOpenAI > 0, 'api.openai.com was never called with RECOGNITION_ENGINE=openai');
    assert.equal(r.providerCalls.openai, sawOpenAI, 'every OpenAI call must land in the openai bucket');
    delete process.env.RECOGNITION_ENGINE;
    delete process.env.OPENAI_API_KEY;
  });
});

describe('an unmodelled external host FAILS LOUDLY', () => {
  test('an unknown host throws instead of returning a synthetic 200', async () => {
    // The stub is installed by harness(); call it the way api/ code would.
    // Before SEC-9 this resolved to `200 []` and a new provider could ship
    // completely invisible to every refund test.
    await assert.rejects(
      () => globalThis.fetch('https://api.some-new-market-provider.example/v1/search', {
        method: 'POST', body: JSON.stringify({ q: 'ninja blender' }),
      }),
      /UNSTUBBED EXTERNAL HOST/,
      'an unmodelled external host must be a loud failure, never a silent success');
  });

  test('the failure names the host and says what to do about it', async () => {
    let msg = '';
    try {
      await globalThis.fetch('https://api.another-unmodelled-host.example/x');
    } catch (e) { msg = e.message; }
    assert.match(msg, /another-unmodelled-host\.example/, 'the message must name the host');
    assert.match(msg, /providerCalls bucket/, 'the message must say to add a bucket');
    assert.match(msg, /INVENTORY/, 'the message must point at the provider inventory');
  });

  test('supabase is still answered — only EXTERNAL unknowns fail', async () => {
    const res = await globalThis.fetch('https://fake.supabase.co/rest/v1/products?select=*');
    assert.equal(res.status, 200, 'our own Supabase must keep working');
  });
});

// ── THE LINK BETWEEN THE TWO ARTEFACTS ──────────────────────────────────────
test('SEC-9 every host in the provider INVENTORY has a harness bucket', () => {
  // The defect was a DISAGREEMENT between two files that each looked correct
  // alone. Assert the agreement directly, so neither can drift again.
  const xp = readFileSync(new URL('./refund-crossproduct.test.mjs', import.meta.url), 'utf8');
  const hs = readFileSync(new URL('./helpers/analyze-harness.mjs', import.meta.url), 'utf8');

  const hosts = [...xp.matchAll(/host:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(hosts.length >= 4, `expected the inventory hosts, found ${hosts.length}`);

  for (const host of new Set(hosts)) {
    assert.ok(hs.includes(host),
      `the provider INVENTORY declares ${host} but tests/helpers/analyze-harness.mjs does not route it. ` +
      'It would fall through to the unstubbed-host error — or, before SEC-9, to a synthetic 200.');
  }

  // And the buckets must exist for the ones we route.
  for (const bucket of ['anthropic', 'openai', 'vision', 'voyage']) {
    assert.match(hs, new RegExp(`providerCalls\\.${bucket}\\+\\+`),
      `the harness must count ${bucket} calls in its own bucket`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// HIGH-1 — THE OBSERVABILITY PROPERTY, NOT THE STUB
//
// The previous round left this HIGH open with an exact diagnosis: the harness
// CAN throw for an unknown host, but the throw is raised inside production's own
// call stack, so `fetchWithRetry`'s catch — or any other — swallows it and the
// test still reports green. A guard whose only signal is an exception is a guard
// that the code under test gets to veto.
//
//   PROPERTY  If any unmodelled external host is ATTEMPTED during a request, the
//             test fails — whether or not production catches the error.
//   PRODUCER  the patched globalThis.fetch, which records before it throws
//   CONSUMER  run()'s post-handler check, outside production's call stack
//   EFFECT    the test goes red; the error names every host attempted
// ══════════════════════════════════════════════════════════════════════════════
describe('HIGH-1 an attempted unknown host fails the test even when swallowed', () => {
  test('control — a clean run records no unknown hosts', async () => {
    delete process.env.RECOGNITION_ENGINE;
    h.anthropic(() => anthropicText(VALID_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.deepEqual(r.unknownHosts, [], 'the control must be clean, or the witnesses below prove nothing');
    assert.doesNotThrow(() => h.assertNoUnknownHosts());
  });

  test('WITNESS the error PROPAGATES — run() rejects', async () => {
    delete process.env.RECOGNITION_ENGINE;
    // The responder runs inside production's Stage-1 fetch. Letting the stub's
    // error escape is the easy half of the property.
    h.anthropic(async () => {
      await globalThis.fetch('https://api.market-research-vendor.example/v1/search?q=ninja');
      return anthropicText(VALID_RECOGNITION);
    });
    await assert.rejects(() => h.run({ imageData: IMG, lang: 'en' }),
      /UNMODELLED EXTERNAL HOST ATTEMPTED/,
      'an unmodelled host attempted mid-request must fail the test');
  });

  test('WITNESS the error is SWALLOWED by a try/catch — run() STILL rejects', async () => {
    delete process.env.RECOGNITION_ENGINE;
    // This is the finding, reproduced exactly. The unknown provider is called
    // inside a catch that discards the error and carries on, which is what
    // every real fallback path in api/analyze.js does. Before this round the
    // request completed 200 and the test passed.
    let swallowed = false;
    h.anthropic(async () => {
      try {
        await globalThis.fetch('https://api.quiet-market-vendor.example/v1/prices', {
          method: 'POST', body: JSON.stringify({ q: 'ninja blender' }),
        });
      } catch { swallowed = true; /* exactly the shape that hid this */ }
      return anthropicText(VALID_RECOGNITION);
    });

    let err = null;
    try { await h.run({ imageData: IMG, lang: 'en' }); } catch (e) { err = e; }

    assert.equal(swallowed, true, 'the negative control must actually have swallowed the throw');
    assert.ok(err, 'a swallowed unknown-host attempt MUST still fail the test — this is HIGH-1');
    assert.match(err.message, /UNMODELLED EXTERNAL HOST ATTEMPTED/);
    assert.deepEqual(err.unknownHosts, ['https://api.quiet-market-vendor.example/v1/prices'],
      'the error must name the host that was attempted');
  });

  test('WITNESS a host reached only on a FALLBACK path is still observed', async () => {
    delete process.env.RECOGNITION_ENGINE;
    // A provider added to a rescue/fallback branch is the realistic way a new
    // billable call arrives, and the branch is reached only when something has
    // already failed — i.e. inside a catch, by construction.
    h.anthropic(async (body, url) => {
      if (String(url).includes('messages')) {
        try { await globalThis.fetch('https://enrich.example/v1/comps'); } catch { /* swallowed */ }
      }
      return anthropicText(VALID_RECOGNITION);
    });
    await assert.rejects(() => h.run({ imageData: IMG, lang: 'en' }), /enrich\.example/);
  });

  test('the record survives a request that ends in a THROWN handler error', async () => {
    delete process.env.RECOGNITION_ENGINE;
    h.anthropic(async () => {
      try { await globalThis.fetch('https://api.late-vendor.example/x'); } catch { /* swallowed */ }
      return { status: 500, body: { error: 'upstream' } };
    });
    await assert.rejects(() => h.run({ imageData: IMG, lang: 'en' }),
      /late-vendor\.example/,
      'a failed request must not be a way to lose the observation');
  });

  test('allowUnknownHosts is a negative-control hatch, and is used NOWHERE ELSE', async () => {
    // A quieting flag that spreads is a quieting flag. Assert that this file is
    // the only one that can use it, so a future test cannot silence a real
    // finding by copying a line.
    const here = new URL('.', import.meta.url);
    const { readdirSync } = await import('node:fs');
    const offenders = [];
    for (const f of readdirSync(here)) {
      if (!f.endsWith('.mjs') || f === 'provider-observability.test.mjs') continue;
      const src = readFileSync(new URL(f, here), 'utf8');
      if (src.includes('allowUnknownHosts')) offenders.push(f);
    }
    assert.deepEqual(offenders, [],
      `allowUnknownHosts appears in ${offenders.join(', ')} — it exists only to prove the ` +
      'mechanism works, never to accept an unmodelled provider');

    // And it must actually work, or the test above is asserting about nothing.
    delete process.env.RECOGNITION_ENGINE;
    h.anthropic(async () => {
      try { await globalThis.fetch('https://api.hatch-check.example/x'); } catch { /* swallowed */ }
      return anthropicText(VALID_RECOGNITION);
    });
    const r = await h.run({ imageData: IMG, lang: 'en' }, { allowUnknownHosts: true });
    // Deduped: the responder runs once per Anthropic call, and a scan makes
    // several. The count is not the property; the RECORD is.
    assert.deepEqual([...new Set(r.unknownHosts)], ['https://api.hatch-check.example/x'],
      'the hatch must still RECORD; it only suppresses the throw');
    assert.ok(r.unknownHosts.length > 0);
    h.anthropic(() => anthropicText(VALID_RECOGNITION));
  });
});
