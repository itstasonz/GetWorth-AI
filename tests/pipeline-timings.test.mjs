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

// ══════════════════════════════════════════════════════════════════════════════
// SCAN-021 — rate-limit bounding and the retrieval gate.
//
// The rate limiter is a security control, so its FAILURE behaviour matters more
// than its success behaviour: a limiter that allows on error is not a limiter.
// ══════════════════════════════════════════════════════════════════════════════

test('RL-01 the rate-limit RPC is bounded', () => {
  // It was the only network call in the pipeline with no timeout. A hung
  // Supabase connection blocked until maxDuration killed the function — a 504
  // in which no rate-limit decision was ever made and no scan ever happened.
  const region = src.slice(idx("blog('[Timing] rate-limit check start')"), idx("blog(`[Timing] rate-limit check done"));
  assert.match(region, /withTimeout\(/, 'checkRateLimit must be wrapped in withTimeout');
  assert.match(region, /RATE_LIMIT_TIMEOUT_MS/, 'the cap must be the named constant');
});

test('RL-02 a rate-limit timeout DENIES — it never opens the door', () => {
  // Allowing on timeout would turn a Supabase outage into a simultaneous bypass
  // of the daily quota, the per-IP burst guard and the per-user guard.
  const region = src.slice(idx("blog('[Timing] rate-limit check start')"), idx("blog(`[Timing] rate-limit check done"));
  const handler = region.slice(region.indexOf('.catch('));
  assert.match(handler, /allowed:\s*false/, 'the timeout handler must deny');
  assert.equal(/allowed:\s*true/.test(handler), false, 'the timeout handler must never allow');
  assert.match(handler, /charged:\s*false/, 'a denied scan must not consume quota');
});

test('RL-03 every checkRateLimit exit fails closed', () => {
  // The function had correct fail-closed semantics before this change; this
  // pins them so a future refactor cannot quietly invert one branch.
  const fn = src.slice(idx('async function checkRateLimit'), idx('// Refund a previously-charged daily scan'));
  const allowTrue = (fn.match(/allowed:\s*true/g) || []).length;
  assert.equal(allowTrue, 1, 'exactly one path may allow — the one where the DB said so');

  // Each error/empty/exception branch denies.
  for (const reason of ['rpc_failed', 'empty_result', 'check_failed']) {
    assert.ok(fn.includes(reason), `the ${reason} branch must still exist`);
  }
});

test('RL-04 a timeout is distinguishable in logs but not a new client behaviour', () => {
  // quota_timeout separates "DB said no" from "DB did not answer". It must not
  // be 'user_daily', or the response would be marked non-retryable and the user
  // told to come back tomorrow because of a transient fault.
  const region = src.slice(idx("blog('[Timing] rate-limit check start')"), idx("blog(`[Timing] rate-limit check done"));
  assert.match(region, /limitType:\s*'quota_timeout'/);
  assert.equal(/limitType:\s*'user_daily'/.test(region), false,
    'a transient timeout must not present as the daily quota being exhausted');
});

test('RG-01 retrieval is no longer gated behind the embedding', () => {
  // Both sat at rem() >= 9_000, so a slow Stage 1 dropped BOTH and Stage 2
  // priced with zero catalog evidence. The embedding powers only 7_vector
  // (SEMANTIC class, cannot establish identity); retrieval's exact-model and
  // OCR-model strategies need no embedding at all.
  const embGate = src.indexOf('if (rem() >= 9_000) {', idx('EMBEDDING + CORRECTIONS'));
  const retGate = src.indexOf('if (rem() >= 6_000) {', idx('SCAN-021: retrieval no longer shares'));
  assert.notEqual(embGate, -1, 'the embedding keeps the higher gate');
  assert.notEqual(retGate, -1, 'retrieval must have its own, lower gate');
  assert.ok(retGate > embGate, 'retrieval still runs after the embedding');
});

test('RG-02 the retrieval cap can never go negative', () => {
  // min(4500, rem() - 8000) is NEGATIVE below rem()=8s, which is precisely why
  // a shared 9s gate was needed. A floored cap is what makes the lower gate safe.
  const region = src.slice(idx('SCAN-021: retrieval no longer shares'), idx("plog('Retrieval start'"));
  assert.match(region, /Math\.max\(1_200,\s*Math\.min\(4_500,\s*rem\(\) - 8_000\)\)/,
    'the retrieval cap must be floored, not just capped');

  // Model the expression across the newly-admitted budget range.
  const capFor = (r) => Math.max(1200, Math.min(4500, r - 8000));
  for (const r of [6000, 6500, 7000, 8000, 9000, 20000]) {
    assert.ok(capFor(r) > 0, `cap must stay positive at rem()=${r}`);
  }
  assert.equal(capFor(20000), 4500, 'a healthy budget still gets the full cap');
});

test('RG-03 the budget ceiling is unchanged — this is not a timeout increase', () => {
  // The brief was explicit that latency must not be "solved" by giving the
  // request more time.
  assert.match(src, /const BUDGET_MS = 50_000;/, 'BUDGET_MS must remain 50s');
  assert.match(src, /export const config = \{ maxDuration: 60 \};/, 'maxDuration must remain 60s');
  assert.match(src, /Math\.max\(Math\.min\(28_000, rem\(\) - 12_000\), 8_000\)/, 'Stage 1 cap unchanged');
  assert.match(src, /Math\.max\(8_000, Math\.min\(24_000, rem\(\) - STAGE2_RESERVE_MS\)\)/, 'Stage 2 cap unchanged');
});

// ══════════════════════════════════════════════════════════════════════════════
// GW-RC-PERF-002 — the timing snapshot must reach the database.
//
// Production evidence: 5 current-engine scans, `timings_anywhere = 0`. The
// instrumentation ran, the response carried it, and NOTHING was stored.
//
// Cause: `ai_raw_response: result` stores a reference, but supabase.rpc()
// SERIALISES the object at call time. `result._timings` was assigned ~244 lines
// AFTER the write, so the serialised copy could never contain it — while
// stage2_status, fast_path and _debug (all assigned earlier) were persisted
// normally. That asymmetry is the signature of an ordering defect, not a
// serialisation or schema problem.
//
// These tests pin the ORDERING and the SEMANTICS. They deliberately avoid line
// numbers: positions are derived from unique code anchors, so the tests survive
// edits elsewhere in a 4,500-line handler and fail only if the actual ordering
// of these operations changes.
// ══════════════════════════════════════════════════════════════════════════════

test('PF-01 the timing snapshot is attached BEFORE the valuation is serialised', () => {
  // THE regression. If this ordering inverts again, timings silently stop
  // persisting and no test other than this one would notice.
  const preSnapshot = idx("result._timings = snapshotTimings('pre_persist')");
  const rowBuilt    = idx('const valuationRow = {');
  const rowCapture  = idx('ai_raw_response:   result,');
  const persistCall = idx("timed('persist_scan'");

  assert.ok(preSnapshot < rowBuilt,
    'the snapshot must be attached before valuationRow is constructed');
  assert.ok(preSnapshot < rowCapture,
    'the snapshot must exist before `result` is referenced as ai_raw_response');
  assert.ok(preSnapshot < persistCall,
    'the snapshot must exist before supabase.rpc serialises the row');
});

test('PF-02 the response still receives the COMPLETE object, after persistence', () => {
  // The fix must not degrade the API response to the partial snapshot.
  const preSnapshot   = idx("result._timings = snapshotTimings('pre_persist')");
  const persistCall   = idx("timed('persist_scan'");
  const finalSnapshot = idx("result._timings = snapshotTimings('complete')");
  const respond       = idx('return json({ content:');

  assert.ok(persistCall < finalSnapshot, 'the complete snapshot is taken after persistence');
  assert.ok(finalSnapshot < respond, 'and before the response is sent');
  assert.ok(preSnapshot < finalSnapshot, 'the complete snapshot overwrites the partial one');
});

test('PF-03 one shared source — no second timing implementation', () => {
  // A duplicated `const { _order, ...flat } = timings` in two places is how the
  // two objects would silently diverge.
  const helper = (src.match(/const snapshotTimings = \(phase\) =>/g) || []).length;
  assert.equal(helper, 1, 'snapshotTimings must be defined exactly once');

  const inlineDestructure = (src.match(/const \{ _order, \.\.\.flat \} = timings;/g) || []).length;
  assert.equal(inlineDestructure, 1,
    'the _order strip must live only inside snapshotTimings — no inline duplicate');

  assert.equal((src.match(/result\._timings = /g) || []).length, 2,
    'exactly two assignments: the pre-persist snapshot and the complete one');
});

test('PF-04 the persisted snapshot does not fabricate a final duration', () => {
  // total/unaccounted are measured just before the response and INCLUDE
  // persistence. Computing them at snapshot time would report a duration for
  // work that had not happened. Their absence from the persisted copy is
  // correct telemetry, not a missing field.
  const region = src.slice(
    idx("result._timings = snapshotTimings('pre_persist')") - 900,
    idx('const valuationRow = {'),
  );
  assert.equal(/timings\.total\s*=/.test(region), false,
    'total must not be computed before the request has finished');
  assert.equal(/timings\.unaccounted\s*=/.test(region), false,
    'unaccounted derives from total and must not be computed early');

  // And they ARE still computed for the response.
  assert.match(src, /timings\.total = totalWall;/);
  assert.match(src, /timings\.unaccounted = Math\.max\(0, totalWall - measured\);/);
});

test('PF-05 snapshotTimings strips bookkeeping, tags the phase, and preserves stages', () => {
  // Behavioural: run the real extracted helper rather than a reimplementation.
  const body = expressionAt(src, 'const snapshotTimings =', 'analyze.js');
  const timings = { _order: ['stage1_vision', 'stage2_verify'], stage1_vision: 1200, stage2_verify: 9000 };
  const snapshotTimings = compileRegion(['timings'], `return ${body};`, 'snapshotTimings')(timings);

  const pre = snapshotTimings('pre_persist');
  assert.equal('_order' in pre, false, '_order is bookkeeping and must never ship');
  assert.equal(pre.snapshot, 'pre_persist', 'the object must say which snapshot it is');
  assert.equal(pre.stage1_vision, 1200);
  assert.equal(pre.stage2_verify, 9000);

  // Independent copies — mutating one must not affect the other.
  const complete = snapshotTimings('complete');
  assert.equal(complete.snapshot, 'complete');
  pre.stage1_vision = 0;
  assert.equal(complete.stage1_vision, 1200);
});

test('PF-06 both dominant stages are captured by the persisted snapshot', () => {
  // The snapshot is only useful if the two costs that dominate the waterfall
  // are already measured when it is taken. Both must be timed upstream of it.
  const preSnapshot = idx("result._timings = snapshotTimings('pre_persist')");
  for (const stage of ['stage1_vision', 'stage2_verify', 'retrieval', 'google_vision', 'rate_limit', 'auth']) {
    assert.ok(idx(`timed('${stage}'`) < preSnapshot,
      `${stage} must be measured before the persisted snapshot is taken`);
  }
  // The two persistence timers legitimately come after — documented, not a bug.
  assert.ok(idx("timed('persist_scan'") > preSnapshot);
});

test('PF-07 the snapshot carries timing telemetry only — no PII', () => {
  // _timings ships to the DB now, so the no-PII rule matters more, not less.
  const helper = expressionAt(src, 'const snapshotTimings =', 'analyze.js');
  for (const leak of ['user', 'email', 'brand', 'model', 'ocr', 'price', 'token', 'apiKey', 'image']) {
    assert.equal(new RegExp(leak, 'i').test(helper), false,
      `snapshotTimings must not reference ${leak}`);
  }
});
