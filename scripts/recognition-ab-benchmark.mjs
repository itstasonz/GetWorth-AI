#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — controlled A/B benchmark, current engine vs OpenAI.
//
// WHY THIS FILE EXISTS
// The ticket's hypothesis is testable but not yet tested: can ONE strong
// multimodal call replace enough recognition work to remove 10-20s from the
// user journey WITHOUT losing identity quality? Nothing in this prototype is
// allowed to claim that. This harness is what would earn the claim.
//
// WHAT IT ACTUALLY MEASURES — and why it runs the whole pipeline
// It invokes the REAL api/analyze.js handler twice per fixture image, flipping
// RECOGNITION_ENGINE between the two passes, in one process. That matters:
//   • recognition latency alone cannot answer the question, because the whole
//     point is whether a better identity lets retrieval and Stage 2 do less
//     work. Only the end-to-end number shows that.
//   • DB retrieval result and price provenance are produced by retrieval and
//     VAL-001. Simulating them would be measuring a simulation.
// A Stage-1-only comparison would be cheaper and would answer a question
// nobody asked.
//
// ORDER IS ALTERNATED per image (openai-first on odd cases) so that neither
// engine systematically eats cold-start or cold-pool cost. Warm/cold effects
// are otherwise the largest source of bias in a two-pass design.
//
// ACCURACY IS SCORED AGAINST GROUND TRUTH, NEVER AGAINST CONFIDENCE.
// A model that says 0.97 and is wrong scores zero, and the report surfaces
// exactly that case (`confident_and_wrong`) because it is the failure mode
// that costs a real seller money.
//
// COSTS REAL MONEY AND WRITES REAL ROWS. It runs the production pipeline, so
// it consumes scan quota and persists valuations for the user whose token is
// supplied. Point it at a staging project, or at a dedicated benchmark user.
//
//   node scripts/recognition-ab-benchmark.mjs
//   node scripts/recognition-ab-benchmark.mjs --json > docs/baselines/ab.json
//   node scripts/recognition-ab-benchmark.mjs --filter mouse --repeat 3
//
// REQUIRES: ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL, SUPABASE_*_KEY,
//           BENCH_JWT (a valid Supabase access token), and fixture images in
//           tests/fixtures/recognition/. Missing any of these SKIPS rather
//           than fails — the offline tiers of recognition-benchmark.mjs must
//           stay runnable on every machine, and so must this one's preflight.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE_DIR = join(ROOT, 'tests/fixtures/recognition');
const CASES_PATH = join(FIXTURE_DIR, 'cases.json');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const arg = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : dflt;
};
const FILTER = arg('--filter');
const REPEAT = Math.max(1, parseInt(arg('--repeat', '1'), 10) || 1);

// PACING — without this the harness cannot collect a sample (performance and
// architecture reviews). api/analyze.js enforces USER_RATE_PER_MIN = 5 and
// VISION_RATE_PER_MIN = 5 per IP, and this harness uses one JWT and a
// hardcoded x-forwarded-for, so from the 6th scan in any minute checkRateLimit
// DENIES. `attributable` correctly discards those, which keeps the numbers
// honest but silently truncates the sample.
//
// Worse, the guard bites harder the FASTER the engine is: the more true the
// hypothesis under test, the more OpenAI scans get 429'd. A benchmark whose
// sampling penalises the thing it is measuring is not a benchmark.
//
// 13s between scans keeps both engines under 5/min with margin. Override for
// a project whose limits differ.
const PACE_MS = Math.max(0, parseInt(arg('--pace-ms', '13000'), 10) || 0);

const ENGINES = ['current', 'openai'];

// ── PREFLIGHT ─────────────────────────────────────────────────────────────────
const { cases } = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const selected = (FILTER ? cases.filter((c) => c.id.includes(FILTER)) : cases)
  .filter((c) => c.image && existsSync(join(FIXTURE_DIR, c.image)));

const missing = [
  ['ANTHROPIC_API_KEY', !!process.env.ANTHROPIC_API_KEY],
  ['OPENAI_API_KEY', !!process.env.OPENAI_API_KEY],
  ['SUPABASE_URL', !!process.env.SUPABASE_URL],
  ['SUPABASE_SERVICE_KEY|SUPABASE_KEY|SUPABASE_ANON_KEY',
    !!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY)],
  ['BENCH_JWT', !!process.env.BENCH_JWT],
].filter(([, ok]) => !ok).map(([n]) => n);

if (missing.length || selected.length === 0) {
  const reason = missing.length
    ? `missing credentials: ${missing.join(', ')}`
    : 'no fixture images present in tests/fixtures/recognition/';
  const skip = {
    skipped: true, reason,
    fixtures_present: selected.length,
    fixtures_expected: (FILTER ? cases.filter((c) => c.id.includes(FILTER)) : cases).length,
  };
  if (JSON_OUT) { console.log(JSON.stringify(skip, null, 2)); process.exit(0); }
  console.log('\nRECOGNITION A/B BENCHMARK — SKIPPED\n');
  console.log(`  ${reason}`);
  console.log(`  fixtures ${skip.fixtures_present}/${skip.fixtures_expected}`);
  console.log('\n  This harness runs the real pipeline against real providers. It is skipped,');
  console.log('  not failed, so the offline recognition benchmark stays runnable everywhere.\n');
  process.exit(0);
}

const { default: handler } = await import(new URL('../api/analyze.js', import.meta.url).href);
// Import the default rather than restating it: a hardcoded model string in the
// report would silently misattribute results after the default changes.
const { OPENAI_MODEL_DEFAULT } = await import(new URL('../api/_lib/openai-recognition.js', import.meta.url).href);

// ── ONE SCAN ──────────────────────────────────────────────────────────────────
// Drives the real Node-serverless entry point with a minimal (req, res) pair.
// toWebRequest() reads nodeReq.body when it is already an object, so no stream
// emulation is needed.
async function scan(imageB64, engine) {
  process.env.RECOGNITION_ENGINE = engine;
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    end(text) { chunks.push(text); },
  };
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.BENCH_JWT}`,
      origin: process.env.ALLOWED_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173',
      'x-forwarded-for': '127.0.0.1',
    },
    body: { images: [imageB64], lang: 'en' },
  };

  const t0 = Date.now();
  await handler(req, res);
  const wallMs = Date.now() - t0;

  let parsed = null;
  try {
    const envelope = JSON.parse(chunks.join(''));
    parsed = envelope?.content?.[0]?.text ? JSON.parse(envelope.content[0].text) : envelope;
  } catch { /* fall through to the error shape below */ }

  return { status: res.statusCode, wallMs, result: parsed };
}

// ── SCORING ───────────────────────────────────────────────────────────────────
// Deliberately forgiving on FORM and strict on IDENTITY: "Logitech G" vs
// "Logitech" is the same brand, but "G903" vs "G502 Hero" is a different
// product and must score zero however close the strings look.
const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const brandMatch = (got, truth, variants = []) => {
  const g = fold(got);
  if (!g) return false;
  return [truth, ...variants].some((v) => { const f = fold(v); return !!f && (g === f || g.startsWith(f) || f.startsWith(g)); });
};
const modelExact = (got, truth, variants = []) => {
  const g = fold(got);
  if (!g) return false;
  return [truth, ...variants].some((v) => fold(v) === g);
};
// Family credit: the answer names the right product line even when the exact
// variant is wrong. This is the score that separates "usefully uncertain" from
// "confidently wrong", and the prototype should be judged on it.
const familyMatch = (gotModel, gotFamily, truth) => {
  const t = fold(truth);
  const stem = t.slice(0, Math.max(3, Math.min(5, t.length)));
  return [gotModel, gotFamily].some((v) => { const f = fold(v); return !!f && !!stem && (f.includes(stem) || stem.includes(f)); });
};

function score(c, res) {
  const r = res.result || {};
  const dbg = r._debug || {};
  const identity = {
    brand: dbg.stage2?.final_brand ?? null,
    model: dbg.stage2?.final_model ?? null,
    family: dbg.stage1?.model_candidates ?? null,
    category: r.category ?? null,
    name: r.name ?? null,
  };
  const brand_correct = brandMatch(identity.brand, c.brand, c.brand_variants);
  const exact_correct = modelExact(identity.model, c.model, c.model_variants);
  const family_correct = exact_correct || familyMatch(identity.model, identity.family, c.model);
  const category_correct = fold(identity.category) === fold(c.category);
  const confidence = r.confidence ?? null;

  return {
    engine_used: r.recognition_engine ?? null,
    http_status: res.status,
    identity,
    brand_correct, family_correct, exact_correct, category_correct,
    confidence,
    // The number that matters most in the report: certain AND wrong.
    confident_and_wrong: !!(confidence !== null && confidence >= 0.80 && !exact_correct),
    db_retrieval: {
      db_match_found: r.db_match_found ?? null,
      source_table: r.candidate_source_table ?? null,
      candidates: dbg.retrieval?.candidates_count ?? null,
      top3: dbg.retrieval?.top3 ?? null,
    },
    price_provenance: {
      pricing_source: dbg.pricing?.guard_pricing_source ?? null,
      pricing_grade: r.marketValue?.pricing_confidence ?? null,
      degraded: dbg.pricing?.guard_degraded_reason ?? null,
      price_mid: r.marketValue?.mid ?? null,
      stage2_status: r.stage2_status ?? null,
    },
    latency: {
      recognition_ms: r._timings?.openai_recognition_ms ?? r._timings?.stage1_vision ?? null,
      stage1_span_ms: r._timings?.stage1_openai ?? r._timings?.stage1_vision ?? null,
      retrieval_ms: r._timings?.retrieval_ms ?? null,
      pricing_ms: r._timings?.pricing_ms ?? null,
      persistence_ms: r._timings?.persistence_ms ?? null,
      server_total_ms: r._timings?.total_ms ?? null,
      wall_ms: res.wallMs,
    },
    fallback_reason: dbg.recognition_engine?.fallback_reason ?? null,
    // Google Vision's trigger is ENGINE-DEPENDENT (performance review): it
    // fires when the top brand confidence is below threshold, and the OpenAI
    // prompt explicitly instructs `brand: null` when unsure — so the honest
    // -uncertainty design systematically buys an extra up-to-5s Vision call.
    // Tracked per scan because it would otherwise hide inside total_ms and be
    // misread as model latency.
    vision_used: dbg.pipeline?.vision_used ?? null,
    error: res.status >= 400 ? (r.error || r.code || `HTTP ${res.status}`) : null,
  };
}

// ── RUN ───────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let caseIndex = 0;
let scansRun = 0;

// USER_DAILY_LIMIT is 50 in api/analyze.js. The docstring's own `--repeat 3`
// over 24 fixtures is 144 scans — the tail would 429 and vanish from the
// sample without the operator ever being told why the numbers look thin.
const plannedScans = selected.length * REPEAT * ENGINES.length;
if (plannedScans > 50 && !JSON_OUT) {
  console.error(`\n  WARNING: ${plannedScans} scans planned but USER_DAILY_LIMIT is 50 per user.`);
  console.error('  Scans past the cap will 429 and be dropped from the sample. Use --filter,');
  console.error('  lower --repeat, or split the run across days / benchmark users.\n');
}
for (const c of selected) {
  const imageB64 = readFileSync(join(FIXTURE_DIR, c.image)).toString('base64');
  for (let rep = 0; rep < REPEAT; rep++) {
    // Alternate which engine goes first so cold-start cost does not land on
    // the same engine every time.
    const order = (caseIndex + rep) % 2 === 0 ? ENGINES : [...ENGINES].reverse();
    const row = {
      id: c.id, rep, category_truth: c.category,
      ground_truth: { brand: c.brand ?? null, model: c.model ?? null, category: c.category },
      order,
    };
    for (const engine of order) {
      if (scansRun > 0 && PACE_MS > 0) {
        if (!JSON_OUT) process.stderr.write(`  … pacing ${PACE_MS}ms (rate limit)\n`);
        await sleep(PACE_MS);
      }
      if (!JSON_OUT) process.stderr.write(`  ${c.id} rep${rep} ${engine} … `);
      try {
        row[engine] = score(c, await scan(imageB64, engine));
        scansRun++;
        if (!JSON_OUT) {
          const s = row[engine];
          process.stderr.write(`${s.latency.wall_ms}ms (engine=${s.engine_used}${s.vision_used ? ' +vision' : ''})\n`);
        }
      } catch (err) {
        row[engine] = { error: err?.message || String(err) };
        scansRun++;
        if (!JSON_OUT) process.stderr.write(`ERROR ${err?.message}\n`);
      }
    }
    rows.push(row);
  }
  caseIndex++;
}
delete process.env.RECOGNITION_ENGINE;

// ── AGGREGATE ─────────────────────────────────────────────────────────────────
const pctOf = (arr, pred) => (arr.length ? arr.filter(pred).length / arr.length : null);
const median = (ns) => {
  const v = ns.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};

function summarize(engine) {
  // ACCURACY and LATENCY need DIFFERENT denominators, and conflating them was
  // a real bias (performance review).
  //
  //   accuracy → `attributable` only. A scan that fell back to the current
  //     engine is not an OpenAI answer, and scoring it as one would launder
  //     the current engine's accuracy into the prototype's number.
  //
  //   latency → ALL scans. A fallback costs the full OpenAI timeout PLUS a
  //     complete Anthropic Stage 1. That IS the cost of routing to OpenAI, and
  //     excluding it would compute the end-to-end verdict over a sample that
  //     by construction contains no OpenAI failures — flattering precisely the
  //     scans the ticket's failure threshold is about. Both are reported so
  //     the difference is visible rather than assumed away.
  const all = rows.map((r) => r[engine]).filter(Boolean);
  const ok = all.filter((s) => !s.error);
  const attributable = all.filter((s) => !s.error && s.engine_used === engine);
  const fellBack = all.filter((s) => s.engine_used && s.engine_used !== engine).length;
  const totalOf = (set) => median(set.map((s) => s.latency.server_total_ms ?? s.latency.wall_ms));
  return {
    scans: all.length,
    attributable: attributable.length,
    fell_back: fellBack,
    errors: all.filter((s) => s.error).length,
    brand_accuracy: pctOf(attributable, (s) => s.brand_correct),
    family_accuracy: pctOf(attributable, (s) => s.family_correct),
    exact_model_accuracy: pctOf(attributable, (s) => s.exact_correct),
    category_accuracy: pctOf(attributable, (s) => s.category_correct),
    confident_and_wrong_rate: pctOf(attributable, (s) => s.confident_and_wrong),
    db_match_rate: pctOf(attributable, (s) => s.db_retrieval.db_match_found === true),
    recognition_ms_median: median(attributable.map((s) => s.latency.recognition_ms)),
    // Clean-run latency: only scans this engine actually answered.
    server_total_ms_median: totalOf(attributable),
    // Honest latency: what routing to this engine really costs, fallbacks in.
    server_total_ms_median_all: totalOf(ok),
    wall_ms_median: median(ok.map((s) => s.latency.wall_ms)),
    // Measurement-boundary check. stage1_span_ms − recognition_ms should be a
    // few ms; a large gap means the timing boundary moved and the A/B numbers
    // are no longer comparable. Collected and printed, not merely stored.
    stage1_overhead_ms_median: median(attributable.map((s) =>
      (Number.isFinite(s.latency.stage1_span_ms) && Number.isFinite(s.latency.recognition_ms))
        ? s.latency.stage1_span_ms - s.latency.recognition_ms
        : null)),
    google_vision_rate: pctOf(attributable, (s) => s.vision_used === true),
  };
}

const report = {
  generated_at: new Date().toISOString(),
  openai_model: process.env.OPENAI_RECOGNITION_MODEL || `${OPENAI_MODEL_DEFAULT} (default)`,
  cases: selected.length,
  repeats: REPEAT,
  // Targets restated from the ticket so a reader does not have to hold them in
  // their head while reading the numbers.
  targets: {
    recognition_target_ms: 5_000, recognition_acceptable_ms: 8_000, recognition_failure_ms: 10_000,
    e2e_target_ms: 10_000, e2e_acceptable_ms: 15_000,
  },
  summary: Object.fromEntries(ENGINES.map((e) => [e, summarize(e)])),
  rows,
};

if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

// ── HUMAN-READABLE ────────────────────────────────────────────────────────────
const pct = (n) => (n === null ? '   n/a' : `${(n * 100).toFixed(1)}%`.padStart(6));
const ms = (n) => (n === null ? '  n/a' : `${n}ms`.padStart(7));
const S = report.summary;

console.log('\nRECOGNITION A/B BENCHMARK — current engine vs OpenAI\n');
console.log(`  model under test: ${report.openai_model}`);
console.log(`  ${report.cases} fixtures x ${REPEAT} repeat(s), real pipeline, real providers\n`);
console.log('  ' + 'metric'.padEnd(26) + 'current'.padStart(9) + 'openai'.padStart(9));
console.log('  ' + '─'.repeat(44));
for (const [label, key] of [
  ['brand correct', 'brand_accuracy'],
  ['family correct', 'family_accuracy'],
  ['exact model correct', 'exact_model_accuracy'],
  ['category correct', 'category_accuracy'],
  ['confident AND wrong', 'confident_and_wrong_rate'],
  ['db match found', 'db_match_rate'],
]) {
  console.log('  ' + label.padEnd(26) + pct(S.current[key]).padStart(9) + pct(S.openai[key]).padStart(9));
}
console.log('  ' + '─'.repeat(44));
for (const [label, key] of [
  ['recognition (median)', 'recognition_ms_median'],
  ['server total, clean', 'server_total_ms_median'],
  ['server total, ALL', 'server_total_ms_median_all'],
  ['stage1 overhead', 'stage1_overhead_ms_median'],
  ['wall clock, ALL', 'wall_ms_median'],
]) {
  console.log('  ' + label.padEnd(26) + ms(S.current[key]).padStart(9) + ms(S.openai[key]).padStart(9));
}
console.log('  ' + 'google vision fired'.padEnd(26) + pct(S.current.google_vision_rate).padStart(9) + pct(S.openai.google_vision_rate).padStart(9));
console.log('  ' + '─'.repeat(44));
console.log('  ' + 'attributable scans'.padEnd(26) + String(S.current.attributable).padStart(9) + String(S.openai.attributable).padStart(9));
console.log('  ' + 'fell back to other'.padEnd(26) + String(S.current.fell_back).padStart(9) + String(S.openai.fell_back).padStart(9));
console.log('  ' + 'errors'.padEnd(26) + String(S.current.errors).padStart(9) + String(S.openai.errors).padStart(9));

const rec = S.openai.recognition_ms_median;
const e2e = S.openai.server_total_ms_median;
console.log('\n  VERDICT AGAINST THE TICKET TARGETS');
if (rec === null) {
  console.log('    recognition   NO DATA — no scan was attributable to the OpenAI engine');
} else {
  console.log(`    recognition   ${rec}ms — ` + (
    rec <= 5_000 ? 'TARGET MET (<=5s)'
    : rec <= 8_000 ? 'ACCEPTABLE (<=8s)'
    : rec <= 10_000 ? 'above acceptable, below the failure line'
    : 'FAILURE (>10s)'));
}
if (e2e !== null) {
  console.log(`    end-to-end    ${e2e}ms — ` + (
    e2e <= 10_000 ? 'TARGET MET (<=10s)'
    : e2e <= 15_000 ? 'ACCEPTABLE for a prototype (<=15s)'
    : 'above the acceptable prototype ceiling'));
}
if (S.openai.exact_model_accuracy !== null && S.current.exact_model_accuracy !== null) {
  const d = S.openai.exact_model_accuracy - S.current.exact_model_accuracy;
  console.log(`    exact-model   ${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}pp vs the current engine`);
}
console.log('\n  READ THESE CAVEATS BEFORE QUOTING ANY NUMBER ABOVE');
console.log('  1. Latency alone does not decide this. A faster engine that is confidently');
console.log('     wrong more often is a regression — read confident-AND-wrong alongside speed.');
console.log('  2. "server total, clean" excludes fallbacks; "ALL" includes them. The honest');
console.log('     cost of routing to an engine is ALL. A large gap means fallbacks are common.');
console.log('  3. Google Vision fires on low brand confidence, and the OpenAI prompt asks for');
console.log('     brand:null when unsure — so honest uncertainty BUYS an extra <=5s call.');
console.log('     A higher vision rate on one engine means its total is not like-for-like.');
console.log('  4. The 24h vision_cache is keyed on the image hash, so the second engine to');
console.log('     scan a fixture may get a cached Vision result the first one paid for.');
console.log('  5. The OpenAI adapter applies a STRICTER text-evidence rule than the current');
console.log('     engine (>=2 alphanumeric chars to count as readable text). Some accuracy');
console.log('     difference comes from that, not from the model. See the prototype doc.');
console.log('  6. stage1 overhead should be a few ms. A large value means the measurement');
console.log('     boundary moved and the two engines are no longer being timed alike.\n');
