/**
 * UI-003 Wave 0 — OBSERVATION PAYLOADS (the GW-005A zero-price sink).
 *
 * Phase A found `valuations` protected and `price_observations` / recognition
 * memory protected, then found this: three client call sites wrote the AI's
 * price straight into `observations.event_payload`.
 *
 *   · AppContext.jsx  OBS.VALUATION_COMPLETED  price_mid
 *   · AppContext.jsx  OBS.VALUATION_CONFIRMED  price_mid      ← not in the brief;
 *   · AppContext.jsx  OBS.LISTING_CREATED      ai_price_mid     found while fixing
 *                                                               the other two
 *
 * `marketValue.mid` is `guardPrices.mid` (api/analyze.js:2710), a literal 0 when
 * the VAL-001 guard returns action:'degrade'. So a REJECTED valuation was being
 * recorded as an OBSERVED market price of ₪0 — in the table whose own migration
 * calls it the substrate for future pricing intelligence. No present symptom,
 * because nothing reads it yet; that is what makes it worth a test rather than a
 * dashboard alert.
 *
 * THE MECHANISM UNDER TEST. `cleanPayload()` in src/lib/observations.js drops
 * null/undefined keys but KEEPS numeric 0 — that asymmetry is both why the bug
 * existed and how it is fixed. `observedPriceMid()` returns null (never 0, never
 * a sentinel) so the key is simply ABSENT from the row, while every other signal
 * in the payload survives. OB-08 pins that dependency: if cleanPayload ever
 * starts preserving nulls, the omission strategy silently stops working.
 *
 * WHY THE SOURCE IS EXECUTED RATHER THAN REGEXED — see the header of
 * tests/persistence-rows.test.mjs and tests/helpers/extract-literal.mjs. These
 * payloads are object literals inside React callbacks; the literal that SHIPS is
 * lifted and evaluated, so reverting a call site to `marketValue.mid` fails
 * these tests rather than quietly passing a text match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { objectLiteralAt, compileRegion } from './helpers/extract-literal.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTEXT_SRC = process.env.UI003_CONTEXT_PATH || `${ROOT}src/contexts/AppContext.jsx`;
const OBS_SRC     = process.env.UI003_OBS_PATH     || `${ROOT}src/lib/observations.js`;
const UTILS_SRC   = process.env.UI003_UTILS_PATH   || `${ROOT}src/lib/utils.js`;

// utils is IMPORTED (not text-extracted) because observedPriceMid and
// hasRealPrice are real exported functions with a seam. The path is env-driven
// for the same reason every other target is: the mutation harness swaps in a
// broken copy, and a hard-coded import would test the pristine original while
// reporting on the mutant — a harness that always says KILLED proves nothing.
const { hasRealPrice, observedPriceMid } = await import(pathToFileURL(UTILS_SRC).href);

const ctxSrc = () => readFileSync(CONTEXT_SRC, 'utf8');

// Extraction is per-PROCESS memoized: the exhaustive corpora below call these
// thousands of times, and re-reading + re-compiling the 5,000-line provider each
// time cost ~8s. The cache is keyed on nothing because the source cannot change
// mid-run — the mutation harness rewrites the FILE and re-spawns node, so each
// mutant still gets a fresh read. Caching across a rewrite would make mutants
// falsely survive, so this must never become a cross-process cache.
const memo = (fn) => { let v, done = false; return () => (done ? v : (done = true, v = fn())); };

// Files the mutation harness may swap for a broken copy. Every OTHER discovered
// file is read straight from disk — the override map exists so a mutant can be
// judged, not to enumerate the call sites (that is the glob's job, below).
const OVERRIDES = {
  'src/contexts/AppContext.jsx': CONTEXT_SRC,
  'src/views/CameraResultsView.jsx': process.env.UI003_CAMERA_PATH || null,
};
for (const k of Object.keys(OVERRIDES)) if (!OVERRIDES[k]) delete OVERRIDES[k];

// Every file that records an observation, DISCOVERED rather than listed — a
// hard-coded list is exactly how the eighth call site went unnoticed. Returns
// [relativePath, source].
const observationFiles = memo(() => {
  const roots = ['src/contexts', 'src/views', 'src/components', 'src/lib'];
  const out = [];
  for (const dir of roots) {
    let entries;
    try { entries = readdirSync(`${ROOT}${dir}`); } catch { continue; }
    for (const name of entries) {
      if (!/\.(jsx?|mjs)$/.test(name) || name.includes('__mutant__') || name.includes('__obsmutant__')) continue;
      const rel = `${dir}/${name}`;
      if (rel === 'src/lib/observations.js') continue;  // the recorder itself, not a call site
      const path = OVERRIDES[rel] || `${ROOT}${rel}`;
      const src = readFileSync(path, 'utf8');
      if (src.includes('recordObservation(')) out.push([rel, src]);
    }
  }
  return out;
});

/**
 * The SHIPPED cleanPayload, lifted and executed. `objectLiteralAt` returns the
 * balanced `{ … }` after the anchor — for a function declaration that is the
 * body, and a body wrapped in braces is a valid `new Function` block.
 */
const _cleanPayload = memo(() => {
  const body = objectLiteralAt(readFileSync(OBS_SRC, 'utf8'),
    'function cleanPayload(payload) {', 'src/lib/observations.js');
  return compileRegion(['payload'], body, 'cleanPayload');
});
const cleanPayload = (payload) => _cleanPayload()(payload);

// ── The three shipped payload literals, each callable with its free identifiers
//    bound. An unbound identifier throws a ReferenceError, which is the correct
//    loud failure rather than a silent undefined.
const _valuationCompleted = memo(() => {
  const body = objectLiteralAt(ctxSrc(), 'recordObservation(OBS.VALUATION_COMPLETED, {', 'AppContext');
  return compileRegion(
    ['analysisResult', 'observedPriceMid', 'hasRealPrice', 'appendMode', 'performance', 'pipelineT0'],
    `return (${body});`, 'VALUATION_COMPLETED payload',
  );
});
function valuationCompleted(marketValue) {
  return _valuationCompleted()(
    { marketValue, category: 'Watches', confidence: 0.91, scan_uuid: 's-1',
      valuation_id: 'v-1', _pipeline: { db_matches: 4 } },
    observedPriceMid, hasRealPrice, false, { now: () => 1500 }, 500,
  );
}

const _valuationConfirmed = memo(() => {
  const body = objectLiteralAt(ctxSrc(), 'recordObservation(OBS.VALUATION_CONFIRMED, {', 'AppContext');
  return compileRegion(
    ['result', 'observedPriceMid', 'hasRealPrice'],
    `return (${body});`, 'VALUATION_CONFIRMED payload',
  );
});
function valuationConfirmed(marketValue) {
  return _valuationConfirmed()({ marketValue, category: 'Watches', confidence: 0.88, scan_uuid: 's-1', valuation_id: 'v-1' },
    observedPriceMid, hasRealPrice);
}

const _listingCreated = memo(() => {
  const body = objectLiteralAt(ctxSrc(), 'recordObservation(OBS.LISTING_CREATED, {', 'AppContext');
  return compileRegion(
    ['newListingId', 'normalizedCategory', 'condition', 'listingRow',
     'observedPriceMid', 'hasRealPrice', 'qualityScore', 'result'],
    `return (${body});`, 'LISTING_CREATED payload',
  );
});
function listingCreated(marketValue, sellerPrice = 950) {
  return _listingCreated()('l-1', 'Watches', 'used', { price: sellerPrice },
    observedPriceMid, hasRealPrice, 78,
    { marketValue, valuation_id: 'v-1', confidence: 0.88 });
}

// The AI-price key each site owns. Everything else in the payload is non-price
// telemetry and must survive untouched.
const SITES = [
  ['VALUATION_COMPLETED', valuationCompleted, 'price_mid'],
  ['VALUATION_CONFIRMED', valuationConfirmed, 'price_mid'],
  ['LISTING_CREATED',     listingCreated,     'ai_price_mid'],
];

// `guard degrade, mislabelled ai_estimate` is the SHIPPED DEFECT shape: the
// guard rejected the quote and emitted 0/0/0, but the old mapping relabelled it
// `ai_estimate` — so the status alone never revealed it. Kept identical to the
// corpus in persistence-rows.test.mjs so both sinks are judged by one standard.
const UNPRICED = [
  ['guard degrade, mislabelled ai_estimate', { pricing_status: 'ai_estimate',    low: 0, mid: 0, high: 0 }],
  ['explicit manual_required',               { pricing_status: 'manual_required', low: 0, mid: 0, high: 0 }],
  ['manual_required over a real triple',     { pricing_status: 'manual_required', low: 800, mid: 1200, high: 1800 }],
  ['negative mid',                           { pricing_status: 'db_based', low: -1, mid: -5, high: 10 }],
  ['non-finite mid',                         { pricing_status: 'db_based', low: 1, mid: NaN, high: 10 }],
  ['zero low, positive mid',                 { pricing_status: 'db_based', low: 0, mid: 1200, high: 1800 }],
  ['absent marketValue',                     undefined],
];
const PRICED = { pricing_status: 'db_based', low: 800, mid: 1200, high: 1800, price_method: 'comp_based' };


// ── 2 + 3 + 5: a degraded / MANUAL_REQUIRED valuation records NO price, at
//              BOTH the named sites and the third one found during the fix.
for (const [site, build, key] of SITES) {
  for (const [name, mv] of UNPRICED) {
    test(`OB-01 ${site}: unpriced (${name}) records no numeric price`, () => {
      const raw = build(mv);
      assert.equal(raw[key], null,
        `${key} = ${JSON.stringify(raw[key])}. It must be null so cleanPayload omits it — ` +
        `0 is a number and would be stored as an observed market price of ₪0.`);

      const stored = cleanPayload(raw);
      assert.ok(!(key in stored),
        `${key} survived cleanPayload as ${JSON.stringify(stored[key])}. The key must be ABSENT ` +
        `from event_payload, not present-and-zero: a future AVG() cannot skip what it can see.`);
    });
  }
}

// ── 1: valid positive prices still reach observations. The fix must not be a
//      blanket suppression — that would trade one data-loss bug for another.
for (const [site, build, key] of SITES) {
  test(`OB-02 ${site}: a priced valuation still records its real price`, () => {
    const stored = cleanPayload(build(PRICED));
    assert.equal(stored[key], 1200, `${key} should carry the real mid`);
  });
}

// ── 3: MANUAL_REQUIRED becomes an explicit marker, never a number. The unpriced
//      state is POSITIVE in the payload — the same rule the valuations row
//      follows (PR-03) — so a consumer never has to infer it from an absence.
test('OB-03 the unpriced state is an explicit marker, not merely a missing key', () => {
  const completed = cleanPayload(valuationCompleted({ pricing_status: 'manual_required', low: 0, mid: 0, high: 0 }));
  assert.equal(completed.price_method, 'manual_required',
    'VALUATION_COMPLETED must mark the manual state positively');
  assert.equal('price_mid' in completed, false);

  for (const [site, build] of [['VALUATION_CONFIRMED', valuationConfirmed], ['LISTING_CREATED', listingCreated]]) {
    const stored = cleanPayload(build({ pricing_status: 'manual_required', low: 0, mid: 0, high: 0 }));
    assert.equal(stored.ai_priced, false, `${site} must carry ai_priced:false`);
  }

  // …and the marker is derived LOCALLY, so a response cached by a pre-fix deploy
  // (priced status over a 0 mid) cannot reintroduce a false provenance claim.
  const stale = cleanPayload(valuationCompleted({ pricing_status: 'ai_estimate', price_method: 'comp_based', low: 0, mid: 0, high: 0 }));
  assert.equal(stale.price_method, 'manual_required',
    "a stale 'comp_based' claim over a 0 mid must not survive into the payload");
});

// ── 4: useful non-price telemetry is PRESERVED. The brief was explicit that the
//      fix must not be "invalid price → lose the observation".
test('OB-04 non-price telemetry survives when the price is dropped', () => {
  const DEGRADED = { pricing_status: 'ai_estimate', low: 0, mid: 0, high: 0 };

  const c = cleanPayload(valuationCompleted(DEGRADED));
  assert.equal(c.category, 'Watches');
  assert.equal(c.confidence, 0.91);
  assert.equal(c.comp_count, 4);
  assert.equal(c.append, false);
  assert.equal(c.duration_ms, 1000);

  const f = cleanPayload(valuationConfirmed(DEGRADED));
  assert.equal(f.category, 'Watches');
  assert.equal(f.confidence, 0.88);

  const l = cleanPayload(listingCreated(DEGRADED));
  assert.equal(l.listing_id, 'l-1');
  assert.equal(l.category, 'Watches');
  assert.equal(l.condition, 'used');
  assert.equal(l.quality_score, 78);
  assert.equal(l.has_valuation, true);
  assert.equal(l.ai_confidence, 0.88);
});

// The seller's own price is a REAL observed signal and shares a payload with the
// AI's estimate. Dropping the estimate must never touch it.
test('OB-05 LISTING_CREATED: the seller\'s real price survives the AI price being dropped', () => {
  const stored = cleanPayload(listingCreated({ pricing_status: 'ai_estimate', low: 0, mid: 0, high: 0 }, 950));
  assert.equal(stored.price, 950, "the seller's chosen price is reality, not an estimate");
  assert.equal('ai_price_mid' in stored, false);
});

// ── 6: the implementation uses the CANONICAL predicate, not a private rule.
test('OB-06 observedPriceMid delegates to hasRealPrice and never invents a price', () => {
  const VALUES = [undefined, null, NaN, Infinity, -1, 0, 0.5, 1, 1200, '1200', '0', 'x', {}];
  const STATUSES = [undefined, 'manual_required', 'ai_estimate', 'db_based'];
  let checked = 0;
  for (const pricing_status of STATUSES) {
    for (const low of VALUES) for (const mid of VALUES) for (const high of VALUES) {
      const mv = { pricing_status, low, mid, high };
      const out = observedPriceMid(mv);
      assert.equal(out === null, !hasRealPrice(mv),
        `observedPriceMid disagreed with hasRealPrice for ${JSON.stringify(mv)} — ` +
        'there must be exactly ONE definition of a real price on the client.');
      if (out !== null) assert.equal(out, Number(mv.mid), 'a priced result must be the mid, unmodified');
      checked++;
    }
  }
  assert.ok(checked > 2000, `corpus collapsed to ${checked} cases`);
  assert.equal(observedPriceMid(undefined), null);
  assert.equal(observedPriceMid(null), null);
});

// ── 7 (behaviour half): exhaustive over field boundaries at all three sites.
//     The PB-08 lesson — a hand-picked corpus only catches what its author
//     thought of. A recorded price is either absent or strictly positive.
test('OB-07 no marketValue shape can put a non-positive price into any payload', () => {
  const VALUES = [undefined, null, NaN, -1, 0, 1, 1200, '1200', '0'];
  const STATUSES = [undefined, 'manual_required', 'ai_estimate', 'db_based'];
  let checked = 0;
  for (const pricing_status of STATUSES) {
    for (const low of VALUES) for (const mid of VALUES) for (const high of VALUES) {
      const mv = { pricing_status, low, mid, high };
      for (const [site, build, key] of SITES) {
        const stored = cleanPayload(build(mv));
        if (key in stored) {
          const v = stored[key];
          assert.ok(typeof v === 'number' && Number.isFinite(v) && v > 0,
            `${site}.${key} = ${JSON.stringify(v)} for ${JSON.stringify(mv)} — ` +
            'a recorded price is either absent or a finite positive number.');
        }
      }
      checked++;
    }
  }
  assert.ok(checked > 900, `corpus collapsed to ${checked} cases`);
});

// The fix DEPENDS on cleanPayload's null/zero asymmetry. Pin it: a well-meaning
// change to "preserve nulls for schema stability" would silently restore the bug
// by writing `price_mid: null` into every degraded row — better than 0, but it
// would also mean the key is no longer absent, which is what OB-01 asserts.
test('OB-08 cleanPayload drops null/undefined and keeps 0 — the asymmetry the fix relies on', () => {
  const out = cleanPayload({ a: null, b: undefined, zero: 0, neg: -1, num: 5, s: 'x', t: true, obj: {}, arr: [] });
  assert.equal('a' in out, false, 'null must be dropped');
  assert.equal('b' in out, false, 'undefined must be dropped');
  assert.equal(out.zero, 0, 'a literal 0 IS kept — this is why observedPriceMid must return null, not 0');
  assert.equal(out.neg, -1);
  assert.equal(out.num, 5);
  assert.equal(out.s, 'x');
  assert.equal(out.t, true);
  assert.equal('obj' in out, false, 'nested objects are dropped (PII containment)');
  assert.equal('arr' in out, false);
});

// ── 7 (source half): a FOURTH observation added later must not be able to
//     reintroduce the defect unnoticed. Behavioural tests above only cover the
//     three sites that exist; this covers the ones that do not exist yet.
test('OB-09 no recordObservation payload reads marketValue?.mid directly', () => {
  // Scanned across EVERY file that records an observation, not just AppContext.
  // The first draft of this test scanned AppContext alone and matched only the
  // `OBS.CONSTANT` call shape — and there is an eighth site in
  // CameraResultsView.jsx that is in neither set (it passes the event type as a
  // string literal, 'scan_result_skipped'). It happens to carry no price today,
  // which is precisely why a narrow guard felt fine and would have rotted: the
  // hole is in the file the next price gets added to, not the ones already fixed.
  const files = observationFiles();
  assert.ok(files.length >= 2,
    `expected recordObservation in at least 2 files, found ${files.length} — ` +
    'the discovery glob has stopped finding call sites and this test is asserting over nothing.');

  const offenders = [];
  for (const [rel, src] of files) {
    // Both call shapes: recordObservation(OBS.X, { … }) and recordObservation('x', { … }).
    for (const m of src.matchAll(/recordObservation\(\s*(?:OBS\.[A-Z_]+|['"][a-z_]+['"])\s*,\s*\{/g)) {
      const body = objectLiteralAt(src, m[0], rel);
      for (const line of body.split('\n')) {
        const code = line.replace(/\/\/.*$/, '');
        if (/marketValue\s*\??\.\s*(mid|low|high)/.test(code) && !/observedPriceMid|hasRealPrice/.test(code)) {
          offenders.push(`${rel} — ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    'An observation payload reads a price off marketValue without the canonical guard. ' +
    'Use observedPriceMid(mv) — it returns null for anything the VAL-001 guard rejected, ' +
    'and cleanPayload then omits the key. Writing marketValue.mid directly records ₪0 for ' +
    'every degraded valuation.\nOffenders:\n  ' + offenders.join('\n  '));
});

// Every site that owns an AI price must route through the helper. Complements
// OB-09: that one bans the bad call, this one requires the good one.
test('OB-10 all three AI-price observation sites call observedPriceMid', () => {
  const src = ctxSrc();
  for (const [site] of SITES) {
    const body = objectLiteralAt(src, `recordObservation(OBS.${site}, {`, 'AppContext');
    assert.match(body, /observedPriceMid\(/,
      `${site} no longer routes its AI price through observedPriceMid — ` +
      'the canonical predicate has been bypassed.');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SCAN-018 — the SERVER-side ai_observation ledger payload.
//
// The tests above cover the CLIENT observation sites. This one covers the
// server's zero-trust ledger payload in api/analyze.js, which had a defect no
// client-side test could have seen: it referenced `preSource`, an identifier
// that exists nowhere in the module. Every other site spells it `pre_source`.
//
// The reference threw a ReferenceError, and the enclosing catch swallowed it as
// "[Memory] sample write failed (shadow, scan unaffected)". That is true of the
// SCAN — the shadow layer is correctly isolated — but it meant the ledger
// recorded nothing at all from the moment it shipped, while logging a message
// that reads like a transient DB hiccup.
//
// Executing the literal with every free identifier bound is what catches this
// class: compileRegion binds each name as a parameter, so ANY unbound
// identifier throws at call time instead of silently becoming undefined.
// ══════════════════════════════════════════════════════════════════════════════
const ANALYZE_PATH = process.env.SCAN018_ANALYZE_PATH || `${ROOT}api/analyze.js`;

test('OB-11 the ai_observation payload references no undefined identifier', () => {
  const body = objectLiteralAt(readFileSync(ANALYZE_PATH, 'utf8'), 'const obsPayload = {', 'analyze.js');

  // Every free identifier the literal reads. An unbound one is the bug.
  const params = [
    'verification', 'result', 'recognition', 'memoryDebug', 'candidates',
    'candidateSourceTable', 'dbMatchFound', 'stage2FallbackUsed',
    'stage2FallbackReason', 'visionData', 'oceContext', 'totalMs',
  ];
  const build = compileRegion(params, `return ${body};`, 'obsPayload');

  // Shapes only need to be navigable — the assertion is that evaluation
  // completes without a ReferenceError.
  const payload = build(
    { raw_match_confidence: 0.8, match_confidence: 0.8, price_method: 'comp_based' },
    { confidence: 0.8, marketValue: { low: 1, mid: 2, high: 3, pre_source: 'catalog', validation: null } },
    {}, { key: 'v2|x|y|z', evidence_gate_passed: true }, [], 'products',
    true, false, null, null, null, 1234,
  );

  assert.equal(typeof payload, 'object');
  assert.equal(payload.v, 1);
  // The field that was broken, now carrying the resolved post-guard value.
  assert.equal(payload.pre_source, 'catalog');
});

test('OB-12 the ledger payload spells pre_source the same way every other site does', () => {
  // A camelCase spelling here cannot be caught by the parser and is swallowed at
  // runtime, so it is worth asserting directly.
  const body = objectLiteralAt(readFileSync(ANALYZE_PATH, 'utf8'), 'const obsPayload = {', 'analyze.js');
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/\bpreSource\b/.test(code), false,
    'the ledger payload must not reference `preSource` — the module spells it pre_source');
});
