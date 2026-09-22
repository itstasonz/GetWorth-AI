#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — LIVE OPEN-WORLD BENCHMARK
//
// Point a camera at anything you might actually sell, and run it:
//
//   node --env-file=.env.local scripts/phaseb-live-benchmark.mjs --image photo.jpg
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
// It is not a demo engine, and there is no second intelligence path hiding in
// here. Every scan goes through `runPhaseB` — the same function /api/enrich
// calls, with the same prompts, the same schemas, the same qualification and
// the same guard. This file contributes an image loader, a clock and a
// printer. If it produced a good answer that /api/enrich could not, the
// benchmark would be measuring the benchmark.
//
// It is also not a fixture runner. Nothing here knows what a Ninja is. The
// only input is a path to an image, and the engine is expected to work out
// what to do with whatever is in it — which is the actual product claim, and
// the only claim worth testing.
//
// ── NO MOCK MAY EVER STAND IN FOR A FAILED PROVIDER ─────────────────────────
//
// This is the rule the rest of the file is arranged around. In --live there is
// no mock reachable at all: the fixture module is not imported on that path,
// `fetchImpl` is left to the global, and a provider failure is printed as a
// failure with its stage and its reason. A benchmark that quietly substitutes
// a canned answer for a 401 reports a working engine and a working key, and
// both are false — the single most expensive lie this tool could tell.
//
// --rehearse exists for the opposite reason: to prove, without spending a
// cent, that the wiring reaches the real components. It replays a recorded
// transcript through the same `runPhaseB`, and every line it prints is stamped
// REHEARSAL. It cannot be reached by accident (it is an explicit flag), it
// cannot be reached as a fallback (nothing falls back to it), and its numbers
// are simulated latency, which it says out loud. Its job is to fail loudly if
// the production pipeline stops being importable — not to produce a result.
//
// ── MODES ───────────────────────────────────────────────────────────────────
//
//   --rehearse   offline, no key, no network, no cost. Proves the runner
//                reaches the real pipeline. Default when --live is absent.
//   --preflight  ONE unbilled GET to /v1/models, to prove the key works and
//                the configured model exists. Run this before spending.
//   --live       the real thing. Costs money. Requires an explicit key.
//
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { runPhaseB, PHASE_B_STATUS } from '../api/_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from '../api/_lib/phaseb/market-research.js';
import {
  resolveEnrichmentMode, resolveEnrichmentModel, ENRICHMENT_MODE,
  ENRICHMENT_FLAG, ENRICHMENT_KEY_ENV, STAGE_TIMEOUT_MS,
} from '../api/_lib/phaseb/config.js';
import { VALUATION_STATUS } from '../api/_lib/phaseb/valuation.js';

// ── ARGUMENTS ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { images: [], mode: null, json: null, language: 'en', model: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--image' || a === '-i') out.images.push(next());
    else if (a === '--json') out.json = next();
    else if (a === '--language' || a === '--lang') out.language = next();
    else if (a === '--model') out.model = next();
    else if (a === '--live') out.mode = 'live';
    else if (a === '--rehearse' || a === '--dry-run') out.mode = 'rehearse';
    else if (a === '--preflight') out.mode = 'preflight';
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.images.push(a);
    else throw new Error(`unknown option ${a}`);
  }
  if (!out.mode) out.mode = 'rehearse';
  return out;
}

const USAGE = `
GetWorth Phase B — live open-world benchmark

  node --env-file=.env.local scripts/phaseb-live-benchmark.mjs --image <path> --live

  --image <path>   a photograph. Repeat for up to 4 images of the same object.
  --live           make real, BILLED OpenAI calls.
  --preflight      one unbilled call to verify the key and the model id.
  --rehearse       offline wiring check. No key, no network, no cost. (default)
  --language <x>   'en' or 'he'. Default en.
  --model <id>     override ${'OPENAI_ENRICHMENT_MODEL'} for this run.
  --json <path>    also write the full machine-readable report here.
  --verbose        print every admitted and rejected listing.

Environment for --live (see docs, and never commit these):
  ${ENRICHMENT_FLAG}=true
  ${ENRICHMENT_KEY_ENV}=<your key>
`;

// ── IMAGE LOADING ───────────────────────────────────────────────────────────
//
// Whatever the camera produced. The engine takes bare base64 and sniffs the
// mime itself (detectImageMime in the recognition adapter), so this does not
// need to understand image formats — it needs to refuse things that obviously
// are not images, and to say how big they were, because size is latency.
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function loadImages(paths) {
  if (paths.length === 0) throw new Error('no --image given. This runner takes a photograph, not a fixture name.');
  if (paths.length > 4) throw new Error('at most 4 images of one object');
  const t0 = performance.now();
  const loaded = paths.map((p) => {
    const abs = resolve(p);
    if (!existsSync(abs)) throw new Error(`image not found: ${p}`);
    const stat = statSync(abs);
    if (!stat.isFile()) throw new Error(`not a file: ${p}`);
    if (stat.size === 0) throw new Error(`empty file: ${p}`);
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new Error(`${basename(abs)} is ${(stat.size / 1048576).toFixed(1)}MB; the cap is 8MB. Resize it rather than raising this.`);
    }
    const ext = extname(abs).toLowerCase();
    if (ext && !IMAGE_EXT.has(ext)) {
      // A warning, not a refusal: the engine sniffs the bytes, and an
      // extensionless file straight off a phone is a normal input.
      process.stderr.write(`  ! ${basename(abs)} has an unfamiliar extension (${ext}); reading it anyway\n`);
    }
    return { path: abs, name: basename(abs), bytes: stat.size, base64: readFileSync(abs).toString('base64') };
  });
  return { images: loaded, preprocess_ms: performance.now() - t0 };
}

// ── PREFLIGHT ───────────────────────────────────────────────────────────────
//
// THE CHEAPEST WAY TO NOT WASTE THE FIRST REAL SCAN. A wrong model id is a
// 404 after the photograph has already been uploaded, and a revoked key is a
// 401 in the same place. GET /v1/models answers both questions, generates no
// tokens and is not billed.
async function preflight({ apiKey, model }) {
  const t0 = performance.now();
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const ms = performance.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false, ms,
      reason: `HTTP ${res.status}`,
      detail: body.replace(apiKey, '<redacted>').slice(0, 300),
    };
  }
  const body = await res.json().catch(() => ({}));
  const ids = (Array.isArray(body?.data) ? body.data : []).map((m) => m?.id).filter(Boolean);
  const present = ids.includes(model);
  return {
    ok: present, ms, model, model_count: ids.length, model_available: present,
    reason: present ? null : `the configured model "${model}" is not in this account's model list`,
    // A hint, not a decision. Picking a substitute model automatically is how a
    // benchmark silently measures something other than what it claims to.
    similar: present ? [] : ids.filter((id) => id.startsWith(String(model).split('-').slice(0, 2).join('-'))).slice(0, 8),
  };
}

// ── REHEARSAL TRANSCRIPT ────────────────────────────────────────────────────
//
// A recorded provider, not a recorded ANSWER. It replays four HTTP responses
// through the genuine transport, so the transport, the schema extraction, the
// ledger, normalisation, qualification, valuation and the guard all really
// run. What it cannot prove is anything about OpenAI, and it says so.
//
// The content is deliberately a nondescript object with a made-up model
// number: a rehearsal that replayed a real product would start being read as
// a result about that product.
function rehearsalTranscript({ latencyMs = 0 } = {}) {
  const identity = {
    subject: {
      object_class: 'cordless handheld vacuum', category_candidate: 'Home',
      brand: 'Rehearsal', product_name: 'Rehearsal HV-220', family: 'HV',
      model: 'HV-220', variant: null,
      identifiers: { mpn: null, sku: null, model_number: 'HV-220', serial_visible: null },
    },
    confidence: { overall: 0.82, object_class: 0.9, brand: 0.8, model: 0.78, variant: 0 },
    evidence: [{ type: 'visible_text', value: 'HV-220', source: 'image', confidence: 0.8 }],
    references: [], ambiguities: ['battery age not visible'], alternatives: [],
  };
  const condition = {
    grade: 'Good', confidence: 0.7,
    observed: [{ signal: 'wear', detail: 'light scuffing on the housing' }],
    not_visible: ['battery_health', 'internal_function'],
    authenticity_observation: 'no_obvious_visual_inconsistency',
  };
  const query = {
    product_identity: 'Rehearsal HV-220', variant: null, condition_target: 'used',
    geography: 'Israel', currency: 'ILS', market: 'second_hand',
    search_terms: ['Rehearsal HV-220 יד שניה', 'Rehearsal HV-220 used'],
    specificity: 'exact_model',
  };
  const obs = (domain, ref, price, kind = 'used_listing', conf = 0.88) => ({
    source: `https://${domain}/${ref}`, source_domain: domain, listing_id_or_reference: ref,
    title: 'Rehearsal HV-220 שואב ידני', observed_price: price, currency: 'ILS',
    condition: 'used', location: 'Tel Aviv', observed_at: '2026-09-01', listing_kind: kind,
    match: { brand: 'Rehearsal', model: 'HV-220', variant: null, confidence: conf },
  });
  const market = {
    search_performed: true, notes: null,
    observations: [
      obs('yad2.co.il', 'r-1', 240), obs('yad2.co.il', 'r-2', 280),
      obs('facebook.com', 'r-3', 260), obs('ebay.co.il', 'r-4', 310),
      obs('ksp.co.il', 'r-5', 690, 'new_retail'),
      { ...obs('yad2.co.il', 'r-6', 90), title: 'Rehearsal HV-220 לחלקים', listing_kind: 'parts_only' },
    ],
  };

  return async (_url, init) => {
    const body = JSON.parse(init.body);
    const name = body?.text?.format?.name ?? '';
    const payload = name.includes('identity') ? identity
      : name.includes('condition') ? condition
        : name.includes('market_query') ? query
          : name.includes('market_evidence') ? market
            : null;
    if (payload === null) throw new Error(`[rehearsal] no recorded response for schema "${name}"`);
    // Simulated latency, so the critical-path arithmetic in the report has
    // something to chew on offline. It is labelled SIMULATED everywhere.
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    return new Response(JSON.stringify({
      model: body.model,
      usage: { input_tokens: 1200, output_tokens: 400 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

// ── IDENTITY TIER ───────────────────────────────────────────────────────────
//
// DERIVED HERE, AND ONLY FOR THE REPORT. The engine's own tiering lives in the
// guard (IDENTITY_TIER) and in the query stage's `specificity`; this is a
// reader's summary of what the evidence supported, and it grants nothing. It
// is computed from the CANDIDATE plus GetWorth's corroboration, never from the
// model's confidence alone — a 0.99 with nothing read off the item is still
// only a claim, and the tier says so by refusing to rise above BRAND_CATEGORY.
const TIER = Object.freeze({
  EXACT_MODEL: 'EXACT_MODEL',
  FAMILY: 'FAMILY',
  BRAND_CATEGORY: 'BRAND_CATEGORY',
  GENERIC_COMPARABLE: 'GENERIC_COMPARABLE',
  NEEDS_MORE_EVIDENCE: 'NEEDS_MORE_EVIDENCE',
  UNKNOWN: 'UNKNOWN',
});

function identityTier(result) {
  const s = result?.identity_candidate?.subject ?? {};
  const corr = result?.identity_candidate?.corroboration ?? {};
  const amb = result?.identity_candidate?.ambiguities ?? [];
  const read = corr.level === 'read_off_item' || corr.level === 'catalog';

  if (corr.level === 'contradicted') return TIER.NEEDS_MORE_EVIDENCE;
  if (!s.brand && !s.object_class) return TIER.UNKNOWN;
  if (s.model && read) return TIER.EXACT_MODEL;
  // A model string nobody could corroborate is a claim. It may be right; it is
  // not an exact-model identification, and calling it one is how a guess gets
  // priced as a certainty.
  if (s.model && !read) return amb.length > 0 ? TIER.NEEDS_MORE_EVIDENCE : TIER.FAMILY;
  if (s.family) return TIER.FAMILY;
  if (s.brand && s.object_class) return TIER.BRAND_CATEGORY;
  if (s.object_class) return TIER.GENERIC_COMPARABLE;
  return TIER.UNKNOWN;
}

// ── FINAL RESULT VOCABULARY ─────────────────────────────────────────────────
function finalResult(result, tier) {
  if (!result) return 'ERROR';
  if (result.status === PHASE_B_STATUS.FAILED) return 'ERROR';
  if (result.status === PHASE_B_STATUS.COMPLETE) return 'COMPLETE';
  if (result.status === PHASE_B_STATUS.PRICED_GUARD_WITHHELD) return 'GUARD_WITHHELD';
  if (tier === TIER.NEEDS_MORE_EVIDENCE || tier === TIER.UNKNOWN) return 'NEEDS_MORE_EVIDENCE';
  if (result.valuation_candidate?.status === VALUATION_STATUS.PENDING_MARKET) return 'INSUFFICIENT_MARKET_EVIDENCE';
  return 'NEEDS_MORE_EVIDENCE';
}

// ── CRITICAL PATH ───────────────────────────────────────────────────────────
//
// The question the 5–8s target actually asks. Stage durations alone cannot
// answer it; `at_ms` plus `duration_ms` can. `serial_ms` is what was really
// spent end to end. `ideal_ms` is what the SAME measured stages would cost if
// the ones with no data dependency on each other overlapped — condition needs
// identity only for prompt context, and the query→research chain needs nothing
// from condition, so those two branches can run side by side.
//
// This is arithmetic over measurements, not a proposal that has been tried. It
// says what the ceiling would be, and the residue it cannot remove is the
// thing any real optimisation has to attack.
function criticalPath(stages, totalMs) {
  const by = new Map(stages.map((s) => [s.stage, s]));
  const d = (n) => by.get(n)?.duration_ms ?? 0;
  const provider = ['openai_identity', 'condition', 'market_query', 'market_research'];
  const providerMs = provider.reduce((a, n) => a + d(n), 0);
  const localMs = stages.filter((s) => !provider.includes(s.stage)).reduce((a, s) => a + s.duration_ms, 0);

  // ── MEASURED OVERLAP: SUM OF DURATIONS MINUS THE UNION THEY COVER ───────
  //
  // Computed as a union rather than by summing pairwise intersections. With
  // three stages running at once, the pairwise sum counts the same millisecond
  // three times and reports more overlap than there is wall clock to hold it —
  // a number that would grow as concurrency improved and could exceed the
  // total. The union is exact for any number of stages.
  const spans = stages
    .filter((s) => s.at_ms != null && s.duration_ms > 0)
    .map((s) => [s.at_ms, s.at_ms + s.duration_ms])
    .sort((a, b) => a[0] - b[0]);
  let unionMs = 0;
  let cursor = -Infinity;
  for (const [from, to] of spans) {
    const start = Math.max(from, cursor);
    if (to > start) unionMs += to - start;
    cursor = Math.max(cursor, to);
  }
  const overlapMs = Math.max(0, spans.reduce((a, [f, t]) => a + (t - f), 0) - unionMs);

  const branchA = d('condition');
  const branchB = d('market_query') + d('market_research');
  const idealMs = d('openai_identity') + Math.max(branchA, branchB) + localMs;

  return {
    total_ms: Math.round(totalMs),
    provider_ms: Math.round(providerMs),
    local_ms: Math.round(localMs),
    measured_overlap_ms: Math.round(overlapMs),
    executes_concurrently: overlapMs > 1,
    ideal_concurrent_ms: Math.round(idealMs),
    saving_ms: Math.round(totalMs - idealMs),
    branch_condition_ms: Math.round(branchA),
    branch_research_ms: Math.round(branchB),
    slowest_stage: stages.reduce((m, s) => (s.duration_ms > (m?.duration_ms ?? -1) ? s : m), null)?.stage ?? null,
  };
}

// ── PRINTING ────────────────────────────────────────────────────────────────
const BAR = '═'.repeat(78);
const rule = (t) => `\n${t}\n${'─'.repeat(78)}`;
const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const ms = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}ms`);

function report(ctx) {
  const { result, tier, images, preprocessMs, totalMs, mode, model, scanUuid, verbose } = ctx;
  const L = [];
  const p = (s = '') => L.push(s);

  p(BAR);
  p(`GETWORTH PHASE B — ${mode === 'rehearse' ? 'REHEARSAL (NO PROVIDER WAS CALLED)' : 'LIVE OPEN-WORLD SCAN'}`);
  p(BAR);
  if (mode === 'rehearse') {
    p('!! REHEARSAL. Every number below came from a recorded transcript, not from');
    p('!! OpenAI. Latencies are SIMULATED. This proves the runner reaches the real');
    p('!! Phase B components. It proves nothing about identification or price.');
    p('');
  }

  // ── SCAN ────────────────────────────────────────────────────────────────
  p(rule('SCAN'));
  p(`  scan uuid       ${scanUuid}`);
  p(`  images          ${images.length} (${images.map((i) => `${i.name} ${(i.bytes / 1024).toFixed(0)}KB`).join(', ')})`);
  p('  freshness       FRESH — this runner holds no cache and reuses no prior scan');
  p(`  model           ${model}`);

  if (!result) { p('\n  RESULT          ERROR — the pipeline returned nothing'); return L.join('\n'); }

  // ── IDENTITY ────────────────────────────────────────────────────────────
  const s = result.identity_candidate?.subject ?? {};
  const corr = result.identity_candidate?.corroboration ?? {};
  p(rule('IDENTITY'));
  p(`  object class    ${fmt(s.object_class)}`);
  p(`  brand           ${fmt(s.brand)}`);
  p(`  product name    ${fmt(s.product_name)}`);
  p(`  family          ${fmt(s.family)}`);
  p(`  model           ${fmt(s.model)}`);
  p(`  variant         ${fmt(s.variant)}`);
  p(`  identifiers     ${Object.entries(s.identifiers ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`);
  p(`  IDENTITY TIER   ${tier}`);
  p(`  model confidence ${fmt(result.identity_candidate?.confidence?.overall)}  (a claim, not authority)`);
  p(`  corroboration   ${fmt(corr.level)}  brand_read=${!!corr.brand_read_off_item} model_read=${!!corr.model_read_off_item}`);
  p('  evidence for identity:');
  for (const e of result.identity_candidate?.evidence ?? []) {
    p(`    - [${e.type}/${e.source}] ${String(e.value).slice(0, 62)} (${e.confidence})`);
  }
  if (!(result.identity_candidate?.evidence ?? []).length) p('    (none reported)');
  p('  unresolved questions:');
  for (const a of result.identity_candidate?.ambiguities ?? []) p(`    - ${a}`);
  if (!(result.identity_candidate?.ambiguities ?? []).length) p('    (none reported)');
  const refs = result.identity_candidate?.references ?? [];
  if (refs.length) {
    p('  referenced (NOT the subject):');
    for (const r of refs) p(`    - ${r.relation}: ${fmt(r.brand)} ${fmt(r.product)} ${fmt(r.model)}`);
  }

  // ── CONDITION ───────────────────────────────────────────────────────────
  const c = result.condition_candidate;
  p(rule('CONDITION'));
  if (!c) p('  (stage did not produce a grade)');
  else {
    p(`  grade           ${fmt(c.grade)} (confidence ${fmt(c.confidence)})`);
    p(`  observed        ${(c.observed ?? []).map((o) => o.signal).join(', ') || '—'}`);
    p(`  not visible     ${(c.not_visible ?? []).join(', ') || '—'}`);
    p(`  authenticity    ${fmt(c.authenticity_observation)}`);
  }

  // ── RESEARCH ────────────────────────────────────────────────────────────
  const me = result.market_evidence ?? {};
  const q = me.query;
  p(rule('RESEARCH'));
  p(`  mechanism       ${fmt(me.mechanism)}   search performed: ${!!me.search_performed}`);
  if (!q) p('  structured query: (the query stage produced nothing)');
  else {
    p(`  specificity     ${fmt(q.specificity)}`);
    p(`  geography       ${fmt(q.geography)}   currency: ${fmt(q.currency)}   market: ${fmt(q.market)}`);
    p(`  condition target ${fmt(q.condition_target)}`);
    p('  search terms:');
    for (const t of q.search_terms ?? []) p(`    - ${t}`);
  }
  p(`  sources consulted ${(me.provenance?.sources ?? []).length}`);
  for (const u of (me.provenance?.sources ?? []).slice(0, 10)) p(`    - ${u}`);
  p(`  candidates discovered ${me.counts?.returned ?? 0}`);

  // ── MARKET EVIDENCE ─────────────────────────────────────────────────────
  const gm = result.validation?.market_evidence;
  const rejected = me.rejected ?? [];
  const byReason = new Map();
  for (const r of rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  const domains = new Set((me.accepted ?? []).map((o) => o.source_domain).filter(Boolean));
  const newRetail = rejected.filter((r) => r.reason === 'not_a_used_listing').length;

  p(rule('MARKET EVIDENCE'));
  p(`  raw candidates          ${me.counts?.returned ?? 0}`);
  p(`  duplicates removed      ${byReason.get('duplicate_listing') ?? 0}`);
  p(`  rejected                ${me.counts?.rejected ?? 0}`);
  for (const [reason, n] of byReason) p(`      ${String(reason).padEnd(34)} ${n}`);
  p(`  foreign-currency context ${me.counts?.context_only ?? 0}  (real evidence, not priceable without verified FX)`);
  p(`  admitted (Phase B filter) ${me.counts?.accepted ?? 0}`);
  p(`  distinct source domains ${domains.size}  ${[...domains].join(', ') || ''}`);
  p(`  new-retail evidence     ${newRetail}   second-hand evidence: ${me.counts?.accepted ?? 0}`);
  p('');
  p('  VERIFIED_MARKET (the independent second reading — this is what grants):');
  if (!gm) p('    not evaluated: no priced candidate reached the guard');
  else {
    p(`    qualified             ${gm.qualified}`);
    p(`    admitted / considered ${gm.admitted} / ${gm.considered}`);
    p(`    distinct sources      ${gm.distinct_sources}`);
    if (gm.set_failures?.length) p(`    set failures          ${gm.set_failures.join(', ')}`);
    if (verbose) for (const d of gm.disqualified ?? []) p(`      x ${String(d.title ?? '').slice(0, 40)} [${d.source_domain}] ${d.reason}`);
  }
  if (verbose) {
    p('  admitted listings:');
    for (const o of me.accepted ?? []) {
      p(`    ${String(o.observed_price).padStart(7)} ${o.currency}  ${String(o.source_domain ?? '').padEnd(18)} ${String(o.title ?? '').slice(0, 40)}`);
    }
  }

  // ── VALUATION ───────────────────────────────────────────────────────────
  const v = result.valuation_candidate ?? {};
  const g = result.validation ?? {};
  const displayable = g.action === 'accept' && v.status === VALUATION_STATUS.PRICED;
  p(rule('VALUATION'));
  p(`  status          ${fmt(v.status)}   sample size ${fmt(v.sample_size)}`);
  p(`  quick_sale      ${fmt(v.low)} ${v.currency ?? ''}`);
  p(`  fair_market     ${fmt(v.mid)} ${v.currency ?? ''}`);
  p(`  optimistic      ${fmt(v.high)} ${v.currency ?? ''}`);
  p(`  condition adj.  ${v.condition_adjustment?.applied ? `x${v.condition_adjustment.multiplier.toFixed(3)} (${v.condition_adjustment.reason})` : 'not applied'}`);
  p(`  reason          ${fmt(v.reason)}`);
  p('');
  p(`  VERIFIED_MARKET ${gm?.qualified ? 'GRANTED' : 'NOT GRANTED'}`);
  p(`  guard decision  ${fmt(g.action)}   envelope ${fmt(g.envelope_key)} (hard max ${fmt(g.envelope_hard_max)})`);
  p(`  guard tier      ${fmt(g.identity_tier)}   grade ${fmt(g.pricing_grade)}   needs review ${fmt(g.needs_review)}`);
  p(`  guard prices    ${fmt(g.prices?.low)} / ${fmt(g.prices?.mid)} / ${fmt(g.prices?.high)}`);
  p(`  violations      ${(g.violations ?? []).length ? g.violations.map((x) => (typeof x === 'string' ? x : x.code ?? JSON.stringify(x))).join(', ') : 'none'}`);
  if (g.degraded_reason) p(`  degraded        ${g.degraded_reason}`);
  if (g.guard_error) p(`  GUARD ERROR     ${g.guard_error}  (treated as a rejection)`);
  p(`  DISPLAYABLE     ${displayable ? 'YES' : 'NO'}`);

  // ── PERFORMANCE ─────────────────────────────────────────────────────────
  const cp = criticalPath(result.stages ?? [], totalMs);
  p(rule(`PERFORMANCE${mode === 'rehearse' ? '  (SIMULATED — not a latency measurement)' : ''}`));
  p(`  image preprocessing        ${ms(preprocessMs)}`);
  for (const st of result.stages ?? []) {
    p(`  ${st.stage.padEnd(26)} ${ms(st.duration_ms).padStart(8)}  @+${ms(st.at_ms)}  ${st.status}${st.detail ? `  (${String(st.detail).slice(0, 40)})` : ''}`);
  }
  p(`  ${'PIPELINE TOTAL'.padEnd(26)} ${ms(result.timings?.total_ms).padStart(8)}`);
  p(`  ${'WALL CLOCK TOTAL'.padEnd(26)} ${ms(totalMs).padStart(8)}   (includes image load)`);
  p('');
  p(`  provider time              ${ms(cp.provider_ms)}   (${((cp.provider_ms / Math.max(1, cp.total_ms)) * 100).toFixed(0)}% of the run)`);
  p(`  local compute              ${ms(cp.local_ms)}`);
  p(`  measured concurrency       ${cp.executes_concurrently ? `${ms(cp.measured_overlap_ms)} overlapped` : 'NONE — every stage runs strictly end to end'}`);
  p(`  slowest stage              ${fmt(cp.slowest_stage)}`);
  p(`  if the two branches overlapped: ${ms(cp.ideal_concurrent_ms)}  (saving ${ms(cp.saving_ms)})`);
  p(`      branch A  condition                ${ms(cp.branch_condition_ms)}`);
  p(`      branch B  market_query + research  ${ms(cp.branch_research_ms)}`);
  p(`  TARGET 5000–8000ms         ${cp.total_ms <= 8000 ? 'MET' : `MISSED by ${ms(cp.total_ms - 8000)}`}`);

  // ── PROVIDER USAGE ──────────────────────────────────────────────────────
  const calls = result.model_metadata?.calls ?? { attempts: 0, billed: 0, by_stage: [] };
  p(rule('PROVIDER USAGE'));
  p(`  OpenAI calls attempted  ${calls.attempts}`);
  p(`  OpenAI calls BILLED     ${calls.billed}${mode === 'rehearse' ? '  (recorded transcript — nothing was actually billed)' : ''}`);
  for (const c of calls.by_stage) {
    p(`    ${c.id.padEnd(20)} ${String(c.status).padEnd(9)} ${ms(c.duration_ms).padStart(8)} billed=${c.billed}${c.failure_code ? ` failure=${c.failure_code}` : ''}`);
  }
  p('  search provider calls   ' + (me.mechanism === MARKET_MECHANISM.OPENAI_WEB_SEARCH && me.search_performed ? '1 (hosted web_search, inside the market_research call)' : '0'));
  p('  token usage             not returned per stage by the ledger summary; see --json');
  p('  cost                    not computed here — this runner does not hold a price list, and');
  p('                          a made-up cost is worse than no cost. Read it from the OpenAI dashboard.');

  // ── FINAL ───────────────────────────────────────────────────────────────
  p(rule('FINAL RESULT'));
  p(`  ${finalResult(result, tier)}`);
  if (result.failure_reason) p(`  failure reason  ${result.failure_reason}`);
  p(`  phase B status  ${result.status}`);
  p('');
  p('  Phase B output is a READ-ONLY CANDIDATE. Nothing above was written to any');
  p('  catalog, recognition memory, price observation or valuation table.');
  p(BAR);
  return L.join('\n');
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (err) {
    process.stderr.write(`${err.message}\n${USAGE}`); process.exit(2);
  }
  if (args.help) { process.stdout.write(USAGE); return; }

  const model = args.model || resolveEnrichmentModel(process.env);

  // ── PREFLIGHT ───────────────────────────────────────────────────────────
  if (args.mode === 'preflight') {
    const key = process.env[ENRICHMENT_KEY_ENV];
    if (!key) {
      process.stderr.write(`\n  ${ENRICHMENT_KEY_ENV} is not set. Preflight needs the key it is checking.\n`);
      process.exit(3);
    }
    process.stdout.write(`\n  Preflight (unbilled) against model "${model}"...\n`);
    const r = await preflight({ apiKey: key, model });
    process.stdout.write(`  key            ${r.reason && r.reason.startsWith('HTTP 401') ? 'REJECTED' : 'accepted'}\n`);
    process.stdout.write(`  models visible ${r.model_count ?? '—'}\n`);
    process.stdout.write(`  "${model}"      ${r.model_available ? 'AVAILABLE' : 'NOT AVAILABLE'}\n`);
    if (!r.ok) {
      process.stdout.write(`  PREFLIGHT FAILED: ${r.reason}\n`);
      if (r.detail) process.stdout.write(`  ${r.detail}\n`);
      if (r.similar?.length) process.stdout.write(`  models with a similar prefix: ${r.similar.join(', ')}\n`);
      process.stdout.write('\n  Do NOT run --live until this passes: a wrong model id costs an upload and returns a 404.\n\n');
      process.exit(4);
    }
    process.stdout.write(`  PREFLIGHT OK in ${Math.round(r.ms)}ms. Safe to run --live.\n\n`);
    return;
  }

  // ── IMAGES ──────────────────────────────────────────────────────────────
  let images;
  let preprocessMs;
  try { ({ images, preprocess_ms: preprocessMs } = loadImages(args.images)); } catch (err) {
    process.stderr.write(`\n  ${err.message}\n${USAGE}`); process.exit(2);
  }

  const scanUuid = randomUUID();
  const wall0 = performance.now();
  let result = null;
  let fatal = null;

  if (args.mode === 'live') {
    // ── THE LIVE PATH. NO MOCK IS REACHABLE FROM HERE. ────────────────────
    //
    // `fetchImpl` is deliberately not passed, so `runPhaseB` uses the global
    // fetch. There is no fallback, no retry into a transcript and no default
    // answer: whatever the provider does is what gets reported.
    const mode = resolveEnrichmentMode(process.env);
    if (mode !== ENRICHMENT_MODE.ENABLED) {
      process.stderr.write(`\n  Phase B is not enabled: ${mode}\n`
        + `  Required: ${ENRICHMENT_FLAG}=true and ${ENRICHMENT_KEY_ENV}=<key>\n`
        + '  Put them in .env.local (which is gitignored) and pass --env-file=.env.local.\n\n');
      process.exit(3);
    }
    process.stderr.write(`\n  LIVE. This will make billed OpenAI calls against "${model}".\n`
      + `  Stage ceilings: identity ${STAGE_TIMEOUT_MS.identity}ms, condition ${STAGE_TIMEOUT_MS.condition}ms, `
      + `query ${STAGE_TIMEOUT_MS.market_query}ms, research ${STAGE_TIMEOUT_MS.market_research}ms.\n\n`);
    try {
      result = await runPhaseB({
        images: images.map((i) => i.base64),
        language: args.language,
        existingRecognition: null,
        ocrText: null,
        catalogCandidates: [],
        model,
        apiKey: process.env[ENRICHMENT_KEY_ENV],
        marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
        safetyIdentifier: `gw-bench-${scanUuid}`,
      });
    } catch (err) {
      fatal = err?.message ?? String(err);
    }
  } else {
    // ── REHEARSAL ─────────────────────────────────────────────────────────
    result = await runPhaseB({
      images: images.map((i) => i.base64),
      language: args.language,
      existingRecognition: null,
      ocrText: null,
      catalogCandidates: [],
      model: `${model} (REHEARSAL)`,
      // Deliberately NOT shaped like a key. It only has to be non-empty:
      // `callStructured` refuses an absent key before it builds a request, and
      // the rehearsal's recorded transport never looks at it. A placeholder
      // that reads as `sk-…` trips every credential scanner that will ever
      // touch this repository — GitHub push protection included — and a
      // scanner that has learned to ignore this line is a scanner that will
      // ignore a real one on the day it matters.
      apiKey: 'REHEARSAL',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
      fetchImpl: rehearsalTranscript({ latencyMs: Number(process.env.GW_REHEARSAL_LATENCY_MS ?? 0) }),
      safetyIdentifier: `gw-rehearsal-${scanUuid}`,
    });
  }

  const totalMs = performance.now() - wall0;

  if (fatal) {
    // A FAILURE IS REPORTED AS A FAILURE. Nothing is substituted.
    process.stdout.write(`\n${BAR}\nGETWORTH PHASE B — LIVE SCAN FAILED\n${BAR}\n`);
    process.stdout.write(`  scan uuid   ${scanUuid}\n`);
    process.stdout.write(`  after       ${Math.round(totalMs)}ms\n`);
    process.stdout.write(`  reason      ${fatal}\n`);
    process.stdout.write('\n  FINAL RESULT  ERROR\n');
    process.stdout.write('  No result was manufactured to fill this gap.\n\n');
    process.exit(5);
  }

  const tier = identityTier(result);
  const text = report({
    result, tier, images, preprocessMs, totalMs,
    mode: args.mode, model, scanUuid, verbose: args.verbose,
  });
  process.stdout.write(`${text}\n`);

  if (args.json) {
    writeFileSync(args.json, `${JSON.stringify({
      mode: args.mode,
      rehearsal: args.mode === 'rehearse',
      scan_uuid: scanUuid,
      model,
      images: images.map((i) => ({ name: i.name, bytes: i.bytes })),
      preprocess_ms: preprocessMs,
      wall_clock_ms: totalMs,
      identity_tier: tier,
      final_result: finalResult(result, tier),
      critical_path: criticalPath(result.stages ?? [], totalMs),
      phase_b: result,
    }, null, 2)}\n`);
    process.stderr.write(`  report written to ${args.json}\n`);
  }

  // A run that could not produce a usable answer exits non-zero, so a harness
  // can tell "the engine ran and said no" from "the engine ran and priced it".
  const fr = finalResult(result, tier);
  process.exit(fr === 'COMPLETE' ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\n  benchmark crashed: ${err?.stack ?? err}\n`);
  process.exit(6);
});
