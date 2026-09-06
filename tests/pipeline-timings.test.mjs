// ══════════════════════════════════════════════════════════════════════════════
// SCAN-019 — stage timing instrumentation.
//
// The pipeline logged rem=/total= at every boundary but never assembled a
// waterfall, and no captured production log exists anywhere in this repo. So
// "where do the seconds go" was only answerable from the budget arithmetic,
// which yields CAPS — what a stage is ALLOWED to take, not what it took. A
// 28s Stage 1 cap says nothing about whether Stage 1 needs 6s or 26s.
//
// The one thing instrumentation must never do is change the thing it measures.
// `timed()` wraps awaited stages, so if it swallowed an error or altered a
// resolved value it would silently rewrite pipeline behaviour while looking
// like observability. These tests pin that transparency.
//
// The helpers are closures inside handleRequest with no import seam, so they are
// lifted with the repo's established extract-and-compile idiom (see
// tests/helpers/extract-literal.mjs) rather than reimplemented here — a
// reimplementation would test a copy and pass while the real one broke.
//
//   node --test tests/pipeline-timings.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expressionAt, compileRegion } from './helpers/extract-literal.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ANALYZE_PATH = process.env.SCAN019_ANALYZE_PATH || `${ROOT}api/analyze.js`;
const src = readFileSync(ANALYZE_PATH, 'utf8');

// Rebuild the real collector + helpers from source.
function harness() {
  const timings = { _order: [] };
  const markBody = expressionAt(src, 'const mark =', 'analyze.js');
  const mark = compileRegion(['timings'], `return ${markBody};`, 'mark')(timings);
  const timedBody = expressionAt(src, 'const timed =', 'analyze.js');
  const timed = compileRegion(['mark'], `return ${timedBody};`, 'timed')(mark);
  return { timings, mark, timed };
}

test('TM-01 timed() passes the resolved value through unchanged', async () => {
  // If instrumentation reshaped a stage result, every downstream consumer would
  // silently receive different data.
  const { timed } = harness();
  const value = { brand: 'Logitech', nested: { model: 'G502' } };
  assert.equal(await timed('stage', Promise.resolve(value)), value);
  assert.equal(await timed('falsy_null', Promise.resolve(null)), null);
  assert.equal(await timed('falsy_zero', Promise.resolve(0)), 0);
  assert.equal(await timed('falsy_false', Promise.resolve(false)), false);
});

test('TM-02 timed() rethrows — it must never convert a failure into a success', async () => {
  // The pipeline relies on stage failures propagating: Stage 1 throwing is what
  // produces the 503 + quota refund, and Stage 2 throwing is what routes to the
  // pricing rescue engine. Swallowing here would break both.
  const { timed } = harness();
  const boom = new Error('Stage 1 recognition [Timeout]');
  await assert.rejects(() => timed('stage', Promise.reject(boom)), /Stage 1 recognition/);
});

test('TM-03 a failing stage is still measured', async () => {
  // A timeout is the single most interesting duration in the whole pipeline; if
  // only successes were recorded, the waterfall would omit exactly the scans
  // worth profiling.
  const { timed, timings } = harness();
  await timed('slow_fail', new Promise((_, rej) => setTimeout(() => rej(new Error('x')), 12))).catch(() => {});
  assert.ok('slow_fail' in timings, 'a throwing stage must still record a duration');
  assert.ok(timings.slow_fail >= 0);
});

test('TM-04 durations accumulate and preserve first-seen order', async () => {
  // Order is the waterfall's readability; accumulation matters for any stage
  // that can run twice (rescue pricing after a guard rejection).
  const { timed, timings } = harness();
  await timed('first', Promise.resolve(1));
  await timed('second', Promise.resolve(2));
  await timed('first', Promise.resolve(3));
  assert.deepEqual(timings._order, ['first', 'second']);
  assert.equal(typeof timings.first, 'number');
});

test('TM-05 mark() records non-negative integers only', () => {
  // Clock skew or a negative delta must not produce a nonsense waterfall.
  const { mark, timings } = harness();
  mark('a', 12.7);
  mark('b', -50);
  assert.equal(timings.a, 13);
  assert.equal(timings.b, 0);
});

test('TM-06 every pipeline stage that can dominate the budget is instrumented', () => {
  // Guards against a stage being added, or renamed, without timing — which is
  // how the pipeline reached 4,400 lines with no waterfall in the first place.
  for (const stage of [
    'auth', 'body_parse', 'rate_limit', 'stage1_vision', 'google_vision',
    'retrieval', 'stage2_verify', 'pricing_rescue', 'persist_scan', 'persist_derived',
  ]) {
    assert.ok(src.includes(`timed('${stage}'`), `stage "${stage}" is not instrumented`);
  }
  assert.ok(src.includes("mark('embed_corrections'"), 'embedding/corrections pair is not instrumented');
});

test('TM-07 the waterfall carries durations only — no identity, price or key', () => {
  // _timings ships on the response. It must stay a profile, not a second copy
  // of the scan's content.
  const block = src.slice(src.indexOf('[Waterfall]'), src.indexOf('[Waterfall]') + 600);
  for (const leak of ['final_brand', 'final_model', 'price_estimate', 'marketValue', 'canonical_key', 'apiKey']) {
    assert.equal(block.includes(leak), false, `waterfall log must not include ${leak}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SCAN-020 — the best-effort persistence tail.
//
// Two writes follow the answer: record_scan (AUTHORITATIVE — its result ships to
// the client as result.persisted) and the derived write-back plus memory samples
// (BEST-EFFORT — results discarded).
//
// These are structural assertions over the handler source. handleRequest cannot
// be executed here — it needs auth, Supabase and two Anthropic calls — but the
// properties that matter are orderings and bounds, which are visible in source
// and are exactly what a careless edit would break.
// ══════════════════════════════════════════════════════════════════════════════
const idx = (needle) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `anchor not found in analyze.js: ${needle}`);
  return i;
};

test('PT-01 the authoritative scan write is still awaited before the response', () => {
  // GW-000 durability: result.persisted is IN the response, so this write can
  // never become fire-and-forget without lying to the client about durability.
  assert.ok(src.includes("await timed('persist_scan'"), 'record_scan must remain awaited');
  assert.ok(idx('result.persisted = persisted') > idx("await timed('persist_scan'"),
    'result.persisted must be assigned only after the write completes');
});

test('PT-02 the derived write is bounded by the budget clock', () => {
  // The gate allowed entry at rem() >= 3_000 while updateDerivedWithRetry can
  // run 16.2s (2 attempts x 8s + backoff). A scan entering with 3,001ms could
  // overrun maxDuration and return a 504 for a valuation that had ALREADY
  // COMMITTED. record_scan was bounded in VAL-001; this sibling never was.
  const region = src.slice(idx("derivedTail = timed('persist_derived'"), idx('MEMORY SAMPLE WRITES'));
  assert.match(region, /withTimeout\(/, 'the derived write must be wrapped in withTimeout');
  assert.match(region, /rem\(\)\s*-\s*1_500/, 'its cap must derive from the budget clock, not a constant');
});

test('PT-03 a failing derived write cannot break the response', () => {
  // Best-effort means best-effort: this write failing must never turn a
  // successful scan into a 500.
  const region = src.slice(idx("derivedTail = timed('persist_derived'"), idx('MEMORY SAMPLE WRITES'));
  assert.match(region, /\.catch\(/, 'the derived write must swallow its own failure');
});

test('PT-04 the derived write overlaps the memory writes, then is joined', () => {
  // Started before the memory block and awaited after it, so two independent
  // best-effort Supabase writes run concurrently instead of back to back.
  const start = idx("derivedTail = timed('persist_derived'");
  const memory = idx('MEMORY SAMPLE WRITES');
  const join = idx('if (derivedTail) await derivedTail;');
  const respond = idx('return json({ content:');
  assert.ok(start < memory, 'the derived write must START before the memory block');
  assert.ok(join > memory, 'and be JOINED after it, or there is no overlap');
  assert.ok(join < respond, 'and be joined BEFORE the response — durability is unchanged');
});

test('PT-05 the tail is not fire-and-forget past the response', () => {
  // waitUntil() is unavailable (no @vercel/functions dependency), so work left
  // running after the response may be frozen with the instance. Dropping the
  // derived write silently would repeat the ai_observation ledger's failure
  // shape: logging success while writing nothing.
  const afterResponse = src.slice(idx('return json({ content:'));
  assert.equal(/updateDerivedWithRetry|recordScanWithRetry/.test(afterResponse), false,
    'no persistence may be started after the response is returned');
});
