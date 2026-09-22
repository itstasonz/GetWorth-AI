// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — FRESH-SCAN ISOLATION
//
// THE OBSERVED SYMPTOM THIS EXISTS FOR: a scan appeared to return a product
// that had been scanned shortly before it. That is the single most expensive
// class of bug this engine can have, because it does not look like a bug. It
// looks like a confident, well-formed, completely wrong answer, and every
// downstream trust control — corroboration, qualification, the guard — will
// happily validate stale evidence, since the evidence is internally consistent.
// It is just about a different object.
//
// ── WHAT "ISOLATED" HAS TO MEAN HERE ───────────────────────────────────────
//
// Not "we did not write a cache". The claim has to be checkable against a run,
// because the ways state leaks are mostly not caches:
//
//   module-level mutable bindings      a `let` that survives the request
//   closures captured at import time   bound once, shared by every caller
//   objects reused across calls        a frozen-looking default that is not
//   a mint that outlives its request   a token still granting on the next one
//   fixture/test-path leakage          a mock reachable from the live path
//
// So the shape of every test below is the same: run SCAN A, run SCAN B, and
// assert that nothing of A is findable anywhere in B — by deep string search
// over the whole serialised candidate, not by checking the fields we happened
// to think of.
//
// ── DEEP SEARCH, NOT FIELD-BY-FIELD ASSERTIONS ─────────────────────────────
//
// A field-by-field test proves the fields it names are clean. It says nothing
// about the field somebody adds next quarter, which is exactly where a leak
// would appear. `occurrences()` below walks the entire JSON and counts a
// needle anywhere in it, so a new field carrying stale content fails this
// without anyone remembering to extend the list.
//
//   node --test tests/phaseb-isolation.test.mjs
//
// §30: every OpenAI call here is MOCKED. No test in this file spends credits.
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, relative } from 'node:path';

import { runPhaseB, PHASE_B_STATUS } from '../api/_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from '../api/_lib/phaseb/market-research.js';
import { qualifyMarketEvidence, isMarketEvidence } from '../api/_lib/market-evidence.js';
import {
  LOGITECH, NINJA, UNKNOWN, LG, mockOpenAI, IMG,
} from './fixtures/phaseb/benchmarks.mjs';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'sk-test-not-a-real-key';

/**
 * Run one scan through the REAL pipeline with a fixture-backed provider.
 *
 * Deliberately constructs a FRESH mock per call. Sharing one mock between A and
 * B would let the harness itself be the thing that carries state, and a test
 * that leaks in the same way as the code cannot detect the code leaking.
 */
const scan = (fx, overrides = {}) => runPhaseB({
  images: [IMG],
  language: 'en',
  existingRecognition: fx.recognition,
  ocrText: fx.ocr,
  apiKey: KEY,
  model: 'test-model',
  marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
  fetchImpl: mockOpenAI(fx),
  ...overrides,
});

/** How many times does `needle` appear anywhere in the serialised result? */
function occurrences(value, needle) {
  const hay = JSON.stringify(value ?? null).toLowerCase();
  const n = String(needle).toLowerCase();
  if (!n) return 0;
  let count = 0;
  let i = hay.indexOf(n);
  while (i !== -1) { count++; i = hay.indexOf(n, i + n.length); }
  return count;
}

/**
 * A result with every measured duration removed.
 *
 * Two runs of identical input must agree on CONTENT, and they will never agree
 * on milliseconds. The nulling is recursive because durations appear in three
 * places — `timings`, `stages[]`, and the call ledger inside `model_metadata` —
 * and a comparison that flattens only the first two fails intermittently, which
 * is worse than not comparing at all.
 */
function withoutTimings(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => withoutTimings(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = /(^|_)(ms|duration_ms|started_ms|timings)$/.test(k) ? null : withoutTimings(v, depth + 1);
  }
  return out;
}

const content = (r) => JSON.stringify(withoutTimings(r));

/** Every string leaf in a value, lower-cased — used to compare two results. */
function stringLeaves(value, out = new Set(), depth = 0) {
  if (depth > 12 || value == null) return out;
  if (typeof value === 'string') { if (value.trim()) out.add(value.trim().toLowerCase()); return out; }
  if (Array.isArray(value)) { for (const v of value) stringLeaves(v, out, depth + 1); return out; }
  if (typeof value === 'object') { for (const v of Object.values(value)) stringLeaves(v, out, depth + 1); }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// ISO-1 · THE REGRESSION THE ORDER ASKS FOR
//
// SCAN A = a known product with a full identity, a market and a price.
// SCAN B = an unrelated object with no identity and no market at all.
//
// UNKNOWN is chosen as B precisely because it is the emptiest possible result.
// If anything of A survives into B, there is nothing of B's own to hide it: a
// leak shows up as content in a candidate that should be almost entirely null.
// ════════════════════════════════════════════════════════════════════════════
describe('ISO-1 an unrelated second scan inherits nothing from the first', () => {
  test('ISO-1a B contains no identity, listing or price originating in A', async () => {
    const a = await scan(LOGITECH);
    const b = await scan(UNKNOWN);

    // A really did produce the things we are about to look for. A test that
    // searches for absent content in B proves nothing if it was absent in A
    // too — that is how this test would rot into a tautology.
    assert.equal(a.identity_candidate?.subject?.brand, 'Logitech');
    assert.ok(a.market_evidence.counts.returned >= 4, 'A must actually have found listings');
    assert.ok(occurrences(a, 'yad2.co.il') > 0, 'A must actually name its sources');

    // ── IDENTITY ──────────────────────────────────────────────────────────
    for (const needle of ['logitech', 'g pro x superlight', 'g502', 'gaming mouse']) {
      assert.equal(occurrences(b, needle), 0,
        `scan B carries "${needle}" from scan A — identity leaked across requests`);
    }

    // ── MARKET EVIDENCE AND PROVENANCE ────────────────────────────────────
    for (const needle of ['yad2.co.il', 'facebook.com', 'superlight']) {
      assert.equal(occurrences(b, needle), 0,
        `scan B carries market evidence "${needle}" from scan A`);
    }

    // ── LISTING REFERENCES AND PRICES ─────────────────────────────────────
    for (const ref of ['l-1', 'l-2', 'l-3', 'l-4', 'l-5']) {
      assert.equal(occurrences(b.market_evidence, ref), 0,
        `scan B carries listing reference ${ref} from scan A`);
    }

    // ── THE VALUATION ─────────────────────────────────────────────────────
    assert.equal(b.valuation_candidate.low, null, 'B must not inherit a price');
    assert.equal(b.valuation_candidate.mid, null);
    assert.equal(b.valuation_candidate.high, null);
    assert.equal(b.valuation_candidate.sample_size, 0,
      'B priced from a non-empty sample — A\u2019s observations reached B');

    // ── CONFIDENCE ────────────────────────────────────────────────────────
    assert.ok((b.identity_candidate?.confidence?.overall ?? 1) < 0.5,
      'B inherited a confident identity it has no evidence for');

    // ── STATUS ────────────────────────────────────────────────────────────
    //
    // IDENTIFIED_PENDING_MARKET, not UNKNOWN, and that is correct: the fixture
    // does establish an object_class ("unidentified plastic object"), which is
    // a real if useless answer. §"UNKNOWN must remain safely unknown/pending"
    // is satisfied by PENDING — what matters is that no brand, no model and no
    // price were acquired, which is asserted above. UNKNOWN is reserved for a
    // candidate with neither brand nor object class, and ISO-4c covers it.
    assert.ok(
      b.status === PHASE_B_STATUS.UNKNOWN || b.status === PHASE_B_STATUS.IDENTIFIED_PENDING_MARKET,
      `an unidentifiable object must stay unknown or pending; got ${b.status}`);
    assert.notEqual(b.status, PHASE_B_STATUS.COMPLETE, 'B was completed by A’s evidence');
  });

  test('ISO-1b the leak is not hidden by running B first', async () => {
    // ORDER INDEPENDENCE. A leak that only flows forwards would pass ISO-1a on
    // a reversed run, so the same pair is run in the other order and B\u2019s
    // result must be byte-identical to the one it produced when it went second.
    const bFirst = await scan(UNKNOWN);
    await scan(LOGITECH);
    const bSecond = await scan(UNKNOWN);

    assert.equal(content(bFirst), content(bSecond),
      'the same input produced different output depending on what ran before it');
  });

  test('ISO-1c two different known products do not blend', async () => {
    // Both scans have a real identity and a real market, so neither result is
    // "empty enough" to make a leak obvious. This is the realistic shape of the
    // reported symptom: two plausible scans, one wrong.
    const first = await scan(LOGITECH);
    const second = await scan(NINJA);

    assert.notEqual(second.identity_candidate?.subject?.brand, 'Logitech');
    for (const needle of ['logitech', 'superlight']) {
      assert.equal(occurrences(second, needle), 0,
        `the Ninja scan carries "${needle}" from the Logitech scan before it`);
    }

    // And the reverse direction, so this is not one-sided.
    const ninjaBrand = second.identity_candidate?.subject?.brand;
    assert.ok(ninjaBrand, 'the Ninja fixture must establish a brand for this to mean anything');
    assert.equal(occurrences(first, ninjaBrand), 0,
      'the earlier scan somehow contains the later one\u2019s brand');
  });

  test('ISO-1d a family-level scan does not acquire an exact model from a neighbour', async () => {
    // The specific failure that would be hardest to notice in production: LG is
    // deliberately model-less, so any model string appearing in its candidate
    // came from somewhere it should not have.
    await scan(LOGITECH);
    const lg = await scan(LG);
    assert.equal(lg.identity_candidate?.subject?.model, null,
      'the family-level candidate acquired a model');
    assert.equal(occurrences(lg, 'superlight'), 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISO-2 · NO SHARED MUTABLE STATE BETWEEN RUNS
//
// ISO-1 proves the output is clean. These prove the MECHANISM is clean, so a
// future refactor that introduces sharing fails here with a useful message
// rather than in ISO-1 with "a string appeared".
// ════════════════════════════════════════════════════════════════════════════
describe('ISO-2 nothing in the Phase-B tree survives a request', () => {
  test('ISO-2a the call ledger is per-run, and counts only this run', async () => {
    const one = await scan(LOGITECH);
    const two = await scan(LOGITECH);
    const three = await scan(LOGITECH);
    // A ledger accumulating across runs would show 4, then 8, then 12.
    assert.equal(one.model_metadata.calls.attempts, two.model_metadata.calls.attempts);
    assert.equal(two.model_metadata.calls.attempts, three.model_metadata.calls.attempts);
    for (const r of [one, two, three]) {
      const ids = r.model_metadata.calls.by_stage.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, 'a ledger id repeated within one run');
      assert.ok(ids.every((id) => /-[1-9]\d?$/.test(id)),
        `ledger ids restart per request; got ${ids.join(', ')}`);
    }
  });

  test('ISO-2b timings and stages are rebuilt, never appended to', async () => {
    const one = await scan(LOGITECH);
    const two = await scan(LOGITECH);
    assert.equal(one.stages.length, two.stages.length,
      'the stage list grew between runs — it is shared, not per-request');
    assert.deepEqual(one.stages.map((s) => s.stage), two.stages.map((s) => s.stage));
    assert.deepEqual(Object.keys(one.timings).sort(), Object.keys(two.timings).sort());
  });

  test('ISO-2c no module in the Phase-B tree holds a reassignable binding', () => {
    // The structural version of ISO-1. A `let` or `var` at module scope is the
    // mechanism by which every leak of this kind actually happens, so it is
    // banned by inspection rather than discovered by symptom.
    const files = [
      'api/_lib/phaseb/pipeline.js',
      'api/_lib/phaseb/openai-client.js',
      'api/_lib/phaseb/market-research.js',
      'api/_lib/phaseb/valuation.js',
      'api/_lib/phaseb/validation.js',
      'api/_lib/phaseb/prompts.js',
      'api/_lib/phaseb/schemas.js',
      'api/_lib/phaseb/config.js',
      'api/_lib/market-evidence.js',
    ];
    const offenders = [];
    for (const rel of files) {
      const abs = resolvePath(REPO, rel);
      assert.ok(existsSync(abs), `${rel} is missing`);
      const src = readFileSync(abs, 'utf8');
      src.split('\n').forEach((line, i) => {
        // COLUMN ZERO IS THE WHOLE TEST. An indented `let` is a local inside
        // a function and is reborn on every call; an unindented one is module
        // state, shared by every request the process ever serves. They look
        // identical and they are opposites.
        if (/^(let|var)\s+\w/.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, [],
      'a module-scope mutable binding in the Phase-B tree. Request state must live in the '
      + 'request: a `let` here is how one scan\u2019s identity reaches the next scan\u2019s answer.');
  });

  test('ISO-2d no test fixture is reachable from the production Phase-B tree', () => {
    // The live path must not be able to import a mock. If it can, a failed
    // provider has somewhere to silently fall back TO, and a benchmark can
    // succeed without a provider ever answering.
    const seen = new Set();
    const queue = [resolvePath(REPO, 'api/enrich.js')];
    const RE = /(?:^|[^\w$])(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"\n]*)['"]/g;
    const offenders = [];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      const here = relative(REPO, file).split('\\').join('/');
      for (const m of src.matchAll(RE)) {
        const spec = m[1];
        if (/(^|\/)(tests?|fixtures?|__mocks__|mocks?)\//i.test(spec) || /\.(test|spec|fixture|mock)\./i.test(spec)) {
          offenders.push(`${here} -> ${spec}`);
        }
        if (!spec.startsWith('.')) continue;
        for (const cand of [spec, `${spec}.js`, `${spec}.mjs`]) {
          const abs = resolvePath(dirname(file), cand);
          if (existsSync(abs)) { queue.push(abs); break; }
        }
      }
    }
    assert.deepEqual(offenders, [],
      'the production Phase-B path can import a test fixture or mock');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISO-3 · THE MINT DOES NOT OUTLIVE ITS REQUEST
//
// VERIFIED_MARKET is granted by WeakSet membership. A token minted for scan A
// must not still read as authoritative when scan B\u2019s guard asks — and, more
// subtly, A\u2019s token must not be reachable from B\u2019s result at all, since a
// serialised copy of it would be the one object shape that looks authoritative
// to a careless reader.
// ════════════════════════════════════════════════════════════════════════════
describe('ISO-3 market authority is per-request', () => {
  const SUBJECT = { brand: 'Logitech', model: 'G Pro X Superlight', object_class: 'gaming mouse' };
  const listing = (domain, ref, price) => ({
    source: `https://${domain}/${ref}`, source_domain: domain, listing_id_or_reference: ref,
    title: 'Logitech G Pro X Superlight', observed_price: price, currency: 'ILS',
    listing_kind: 'used_listing', condition: 'used', location: 'Tel Aviv', observed_at: null,
    match: { brand: 'Logitech', model: 'G Pro X Superlight', variant: null, confidence: 0.9 },
  });

  test('ISO-3a two qualifications mint two distinct tokens', () => {
    const observations = [listing('yad2.co.il', 'a', 340), listing('facebook.com', 'b', 380), listing('ebay.co.il', 'c', 360)];
    const first = qualifyMarketEvidence({ observations, subject: SUBJECT });
    const second = qualifyMarketEvidence({ observations, subject: SUBJECT });
    assert.ok(first.qualified && second.qualified, 'both sets must qualify for this to be meaningful');
    assert.notEqual(first.token, second.token, 'the same token object was handed to two requests');
    assert.ok(isMarketEvidence(first.token) && isMarketEvidence(second.token));
  });

  test('ISO-3b a token cannot survive serialisation into the next request', () => {
    const observations = [listing('yad2.co.il', 'a', 340), listing('facebook.com', 'b', 380), listing('ebay.co.il', 'c', 360)];
    const { token } = qualifyMarketEvidence({ observations, subject: SUBJECT });
    assert.ok(isMarketEvidence(token));
    // This is what a token would look like if it were cached, logged and read
    // back — the exact path by which stale authority would return.
    const revived = JSON.parse(JSON.stringify(token));
    assert.equal(isMarketEvidence(revived), false,
      'a serialised token still grants authority; a cache or a log could replay it');
  });

  test('ISO-3c no token is present in a candidate that did not earn one', async () => {
    const b = await scan(UNKNOWN);
    assert.equal(b.validation.market_evidence, null,
      'a candidate with no qualification is carrying a market-evidence report');
    assert.equal(occurrences(b, 'VERIFIED_MARKET'), 0);
  });

  test('ISO-3d a priced scan does not leave its admitted set visible to the next', async () => {
    const priced = await scan(LOGITECH);
    const next = await scan(UNKNOWN);
    const before = stringLeaves(priced.validation ?? {});
    const after = stringLeaves(next.validation ?? {});
    const shared = [...after].filter((s) => before.has(s) && s.length > 6 && !/^(no priced candidate to validate|derived)$/.test(s));
    assert.deepEqual(shared, [],
      `the later validation shares content with the earlier one: ${shared.join(', ')}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISO-4 · THE INPUT IS THE ONLY THING THAT DECIDES THE OUTPUT
// ════════════════════════════════════════════════════════════════════════════
describe('ISO-4 identical input, identical answer; different input, different answer', () => {
  test('ISO-4a the same scan run twice is deterministic', async () => {
    assert.equal(content(await scan(LOGITECH)), content(await scan(LOGITECH)));
  });

  test('ISO-4b a scan with no existing recognition is not rescued by a previous one', async () => {
    // The nastiest version of the reported symptom: scan B genuinely has no
    // Phase-A context. If the engine were carrying A\u2019s, B would look
    // identified. It must instead look exactly as empty as it is.
    await scan(LOGITECH);
    const bare = await scan(UNKNOWN, { existingRecognition: null, ocrText: null });
    assert.equal(bare.identity_candidate?.subject?.brand, null);
    assert.equal(bare.identity_candidate?.subject?.model, null);
    assert.equal(occurrences(bare, 'logitech'), 0);
    assert.notEqual(bare.status, PHASE_B_STATUS.COMPLETE);
    assert.equal(bare.valuation_candidate.mid, null);
  });

  test('ISO-4c a candidate with neither brand nor object class is UNKNOWN', async () => {
    // The status floor itself, so ISO-1a's looser assertion is anchored to a
    // case that pins the vocabulary rather than accepting either answer.
    const blank = {
      ...UNKNOWN,
      identity: {
        ...UNKNOWN.identity,
        subject: { ...UNKNOWN.identity.subject, object_class: null, brand: null },
      },
    };
    await scan(LOGITECH);
    const r = await scan(blank);
    assert.equal(r.status, PHASE_B_STATUS.UNKNOWN);
    assert.equal(occurrences(r, 'logitech'), 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISO-5 · THE LIVE BENCHMARK RUNNER
//
// The runner makes two claims that are worth exactly nothing unless they are
// checked mechanically, because both are claims about what the code does NOT
// do — and "I did not add a fallback" is the kind of sentence this repository
// has learned to distrust:
//
//   1. --live runs the SAME pipeline /api/enrich runs. Not a copy of it, not a
//      simplified one. If the benchmark had its own engine, a green benchmark
//      would say nothing about the product.
//
//   2. --live cannot reach a mock. If a recorded transcript were reachable as
//      a fallback, a 401 would print as a successful scan, and we would have
//      built a tool whose entire purpose is to lie convincingly.
// ════════════════════════════════════════════════════════════════════════════
describe('ISO-5 the live runner cannot fake a result', () => {
  const RUNNER = resolvePath(REPO, 'scripts/phaseb-live-benchmark.mjs');
  const src = () => readFileSync(RUNNER, 'utf8');

  test('ISO-5a the runner exists and takes an arbitrary image path', () => {
    assert.ok(existsSync(RUNNER), 'scripts/phaseb-live-benchmark.mjs is missing');
    const s = src();
    assert.match(s, /--image/, 'the runner must accept --image');
    assert.match(s, /readFileSync\([^)]*\)\.toString\('base64'\)/,
      'the runner must read a real file from disk, not a named fixture');
  });

  test('ISO-5b the runner drives the production pipeline, not a copy', () => {
    const s = src();
    assert.match(s, /import \{ runPhaseB[^}]*\} from '\.\.\/api\/_lib\/phaseb\/pipeline\.js'/,
      'the benchmark must import the same runPhaseB that /api/enrich calls');
    // A second orchestrator in the runner would mean the benchmark measures
    // the benchmark. These are the stage calls only the pipeline may make.
    assert.ok(!/callStructured\s*\(/.test(s),
      'the runner constructs its own provider call — it must go through the pipeline');
    assert.ok(!/buildIdentityPrompt|buildMarketQueryPrompt|buildConditionPrompt/.test(s),
      'the runner builds its own prompts — it must use the pipeline’s');
    assert.ok(!/computeValuationCandidate\s*\(|qualifyMarketEvidence\s*\(|applyGuard\s*\(/.test(s),
      'the runner runs valuation, qualification or the guard itself — those belong to the pipeline');
  });

  test('ISO-5c the live branch passes no fetch override and no mock mechanism', () => {
    const s = src();
    // Isolate the live branch: from the marker to the rehearsal branch.
    const start = s.indexOf("if (args.mode === 'live')");
    // AFTER `start`, deliberately. The rehearsal's own doc comment carries the
    // same marker higher up the file, and searching from zero finds that one,
    // producing an empty slice that passes every assertion below it. A test
    // that examines nothing is worse than no test: it reports a guarantee.
    const end = s.indexOf('// ── REHEARSAL', start);
    assert.ok(start > 0 && end > start, 'the live branch must be identifiable');
    // CODE ONLY. The live branch explains in a comment that it deliberately
    // passes no `fetchImpl`, and a test that reads comments would fail on the
    // sentence describing the very property it is checking. Strip them, so the
    // assertion is about what runs.
    const live = s.slice(start, end)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.ok(!/fetchImpl/.test(live),
      'the live branch overrides fetch — a live scan must use the real network or fail');
    assert.ok(!/mockSearch|MARKET_MECHANISM\.MOCK|rehearsalTranscript/.test(live),
      'a mock is reachable from the live branch');
    assert.match(live, /marketMechanism: MARKET_MECHANISM\.OPENAI_WEB_SEARCH/,
      'the live branch must ask for real market research');
  });

  test('ISO-5d a live failure is reported, never substituted', () => {
    const s = src();
    const start = s.indexOf('if (fatal)');
    assert.ok(start > 0, 'the runner must have an explicit failure branch');
    const block = s.slice(start, start + 900);
    assert.match(block, /FINAL RESULT\s+ERROR/,
      'a live failure must print ERROR as the final result');
    assert.ok(!/rehearsalTranscript|fallback|retryWithMock/i.test(block),
      'the failure branch reaches for a substitute result');
    assert.match(block, /process\.exit\(5\)/, 'a failed live run must exit non-zero');
  });

  test('ISO-5e the rehearsal is opt-in and labels itself everywhere', () => {
    const s = src();
    assert.match(s, /--rehearse/, 'the rehearsal must be an explicit flag');
    assert.match(s, /REHEARSAL \(NO PROVIDER WAS CALLED\)/,
      'a rehearsal report must say so in its heading');
    assert.match(s, /SIMULATED/,
      'rehearsal latencies must be labelled simulated, not printed as measurements');
    // The one that matters: nothing selects the rehearsal transcript except the
    // mode the user asked for. A transcript chosen on error is a fallback.
    const uses = [...s.matchAll(/(?<!function\s)rehearsalTranscript\s*\(/g)];
    assert.equal(uses.length, 1,
      `the transcript must be CALLED in exactly one place; found ${uses.length}`);
  });

  test('ISO-5f the runner never prints a key and never writes one', () => {
    const s = src();
    // Reading the key to authenticate is the point; printing it is not.
    assert.ok(!/console\.log\([^)]*ENRICHMENT_KEY_ENV|write\([^)]*process\.env\[ENRICHMENT_KEY_ENV\]/.test(s),
      'the runner prints the API key');
    assert.match(s, /redacted/, 'an upstream error body must be scrubbed before printing');
    assert.ok(!/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/.test(s),
      'the benchmark writes to the database; Phase B is read-only');
  });
});
