#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE MARKET-DATA BENCHMARK RUNNER (GW-BENCHMARK-001)
//
//   node scripts/market-benchmark.mjs [--manifest <m>]                      DRY RUN (default): what a live run would call
//   node scripts/market-benchmark.mjs --readiness                            is the dataset ready? photographs, hashes, truth
//   node scripts/market-benchmark.mjs --replay <captures dir> [--out <dir>]  the engine over persisted captures; no network
//   node --env-file=.env.local scripts/market-benchmark.mjs --live --approve-usd <n> [--only id,id] [--profiles a,b] [--out <dir>]
//   node scripts/market-benchmark.mjs --compare <baseline dir> --replay <variant dir>   incremental effect of a variant run
//
// THE ENGINE NEVER SEES THE TRUTH. `runEngine` takes a photograph and the
// environment, and nothing else; the manifest's identity, aliases and
// reference prices reach only the scorer (market-benchmark-report.mjs). The
// benchmark suite proves that mechanically.
//
// LIVE is the only mode that may call a provider, and it refuses unless
// --live is given, --approve-usd is at least the estimate, and
// SCAN_ENGINE_V2_BENCHMARK_LIVE is exactly 'yes'. npm test never passes those.
//
// CAPTURE FORMAT gw-market-capture/2, one file per item: input image hash,
// build SHA, configuration, timestamps, recognition raw + normalised, every
// provider's raw response, timings and executed queries, normalised
// observations, dedupe and qualification decisions, the valuation and the
// final user-facing result. No secret. A `raw` may be { "$ref": "<file>#/<pointer>" }.
// Format /1 captures (identity raw + provider raws) still replay.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scoreItem, buildReport, datasetReadiness, missesOf, compareRuns } from './market-benchmark-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);

export const MODE = Object.freeze({ DRY_RUN: 'dry-run', READINESS: 'readiness', REPLAY: 'replay', LIVE: 'live', COMPARE: 'compare' });
export const LIVE_ENV = 'SCAN_ENGINE_V2_BENCHMARK_LIVE';
export const CAPTURE_FORMAT = 'gw-market-capture/2';
/** USD, estimates from the witness's measured usage; a live run records actuals. `max` is the ceiling a run is approved against. */
export const RATE = Object.freeze({ identity_call: 0.003, identity_call_max: 0.006, search_action: 0.01, search_tokens: 0.003, search_tokens_max: 0.008, ebay_call: 0, fx_call: 0 });
export const MAX_RUNTIME_PER_ITEM_S = 30;
export const DEFAULT_MANIFEST = join(REPO, 'tests/fixtures/scan-v2/benchmark-44.json');

// ── MANIFEST AND CAPTURES ───────────────────────────────────────────────────
export function loadManifest(path = DEFAULT_MANIFEST) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.format !== 'gw-benchmark-manifest/2' || !Array.isArray(m.items)) throw new Error('not a gw-benchmark-manifest/2');
  const base = dirname(resolve(path));
  const abs = (p) => (p ? resolve(base, p) : null);
  return {
    ...m, path: resolve(path),
    items: m.items.map((i) => ({
      ...i,
      photo: { ...i.photo, photo_path_resolved: abs(i.photo?.photo_path), followup_photo_path_resolved: abs(i.photo?.followup_photo_path ?? null), present: i.photo?.photo_path ? existsSync(abs(i.photo.photo_path)) : false },
    })),
  };
}
export function resolveRefs(value, baseDir) {
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, baseDir));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$ref === 'string' && Object.keys(value).length === 1) {
    const [file, pointer = ''] = value.$ref.split('#');
    let target = JSON.parse(readFileSync(resolve(baseDir, file), 'utf8'));
    for (const part of pointer.split('/').filter(Boolean)) target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    return target;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, baseDir)]));
}
export function loadCaptures(dir) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.capture.json'))) {
    const c = resolveRefs(JSON.parse(readFileSync(join(dir, f), 'utf8')), dir);
    if (!/^gw-market-capture\/[12]$/.test(c.format ?? '')) continue;
    out.set(c.item_id, c);
  }
  return out;
}
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ── THE PLAN ────────────────────────────────────────────────────────────────
function callsFor(items, { profiles, ebayEnabled, fxEnabled }) {
  const followups = items.filter((i) => i.photo?.followup_photo_path).length;
  const identity = items.length + followups;
  const searchActions = items.length * profiles.length;
  const ebay = ebayEnabled ? items.length : 0;
  const fx = fxEnabled && items.length ? 1 : 0;
  const est = identity * RATE.identity_call + searchActions * (RATE.search_action + RATE.search_tokens);
  const max = identity * RATE.identity_call_max + searchActions * (RATE.search_action + RATE.search_tokens_max);
  return {
    items: items.length,
    calls: { identity: items.length, followup_identity: followups, search_actions: searchActions, ebay, fx, other: 0 },
    estimated_cost_usd: Number(est.toFixed(2)), maximum_cost_usd: Number(max.toFixed(2)),
    estimated_runtime_s: items.length * 9, maximum_runtime_s: items.length * MAX_RUNTIME_PER_ITEM_S,
  };
}
/** Both configurations, side by side, for the items runnable today and for the full manifest. */
export function planRun(manifest, { ebayEnabled = false, fxEnabled = false, only = null } = {}) {
  const items = manifest.items.filter((i) => !only || only.includes(i.benchmark_id));
  const runnable = items.filter((i) => i.photo.present);
  const both = (list) => ({
    profile_a_one_search_profile: callsFor(list, { profiles: ['local'], ebayEnabled, fxEnabled }),
    profile_b_two_search_profiles: callsFor(list, { profiles: ['local', 'local_used_domains'], ebayEnabled, fxEnabled }),
  });
  return {
    mode: MODE.DRY_RUN, manifest: manifest.path, items: items.length, runnable: runnable.length,
    missing_photos: items.filter((i) => !i.photo.present).map((i) => i.benchmark_id),
    runnable_today: both(runnable), full_manifest: both(items), rates_usd: RATE,
    first_live_configuration: 'profile_a_one_search_profile',
  };
}

// ── THE ENGINE, SEEN ONLY THROUGH THIS DOOR ─────────────────────────────────
/**
 * Identify, then price, from a photograph. THE ONLY ARGUMENTS ARE THE
 * PHOTOGRAPH(S) AND THE ENVIRONMENT: no item, no label, no expectation, no
 * reference price. A follow-up photograph is sent only when the engine asks.
 */
export async function runEngine({ photoBase64, followupPhotoBase64 = null, env, model, apiKey, providers = null, fx = null, fetchImpl = fetch, safetyIdentifier = 'gw-bench' }) {
  const { runV2Identify, runV2Price } = await imp('api/_lib/v2/scan.js');
  const t0 = Date.now();
  let identify = await runV2Identify({ image: photoBase64, model, apiKey, safetyIdentifier, fetchImpl });
  let followup = null;
  if (identify.ok && identify.sufficiency.decision === 'NEED_FOLLOWUP' && followupPhotoBase64) {
    followup = await runV2Identify({ image: followupPhotoBase64, priorState: { identity: identify.identity, sufficiency: identify.sufficiency, followups_used: identify.followups_used }, model, apiKey, safetyIdentifier, fetchImpl });
    if (followup.ok) identify = followup;
  }
  const identityMs = Date.now() - t0;
  let price = null;
  if (identify.ok && identify.sufficiency.decision === 'SEARCH_NOW') {
    price = await runV2Price({ state: { identity: identify.identity, sufficiency: identify.sufficiency, followups_used: identify.followups_used ?? 0 }, model, apiKey, safetyIdentifier, fetchImpl, providers, fx, env });
  }
  return { identify, followup, price, timings: { identity_ms: identityMs, total_ms: Date.now() - t0 } };
}

export function buildCapture({ item, imageHash, followupHash = null, build, config, engine, finalResult }) {
  const { identify, followup, price, timings } = engine;
  return {
    format: CAPTURE_FORMAT, item_id: item.benchmark_id, captured_at: new Date().toISOString(), build,
    input: { image_sha256: imageHash, followup_image_sha256: followupHash, photo_count: followupHash ? 2 : 1 },
    configuration: config, timings,
    identity: { request: { model: config.model, image_bytes: null }, raw: identify.identity ?? null, normalized: identify.identity ?? null, sufficiency: identify.sufficiency ?? null, ok: identify.ok, failure: identify.failure ?? null, timings: identify.timings ?? null, usage: identify.calls?.usage ?? null,
      followup: followup ? { raw: followup.identity ?? null, sufficiency: followup.sufficiency ?? null, timings: followup.timings ?? null } : null },
    providers: (price?.market_data?.raw_ledger ?? []).map((r) => ({ provider: r.provider, profile: r.profile, status: r.status, request: { profile: r.profile, queries: r.raw?.plan?.queries?.map((q) => q.text) ?? null }, executed_queries: r.raw?.search?.provenance?.queries ?? null,
      raw: r.provider === 'openai_web_search' ? { output: r.raw?.search?.raw_output ?? null, provenance: r.raw?.search?.provenance ?? null } : r.raw,
      timings: r.raw?.search?.timings ?? null, elapsed_ms: r.elapsed_ms ?? null, started_at: r.started_at, first_result_at: r.first_result_at ?? null, completed_at: r.completed_at, error_class: r.error_class ?? null, result_count: r.result_count ?? 0, normalized_count: r.normalized_count ?? 0, billed: r.billed, cost_usd: r.cost_usd })),
    observations: price?.market_data?.observations ?? [], dedupe: price?.market_data?.dedupe ?? null, independence: price?.market_data?.independence ?? null,
    qualification: price?.evidence ? { market: price.evidence.market, accounting: price.evidence.accounting, counts: price.evidence.counts, entries: price.evidence.entries.map((e) => ({ domain: e.observation.source_domain, price: e.observation.observed_price, currency: e.observation.currency, kind: e.kind, relation: e.relation, configuration: e.configuration, tier: e.tier, admitted: e.admitted, anchor: e.retail_anchor, reason: e.reason })) } : null,
    valuation: price?.valuation ?? null,
    final_result: finalResult,
    fx: price?.market_data?.fx ? { ...price.market_data.fx, table: price.market_data.fx_table ?? null } : null,
  };
}

// ── REPLAY ──────────────────────────────────────────────────────────────────
const refuse = async (url) => { throw new Error(`[benchmark replay] network call attempted: ${String(url).slice(0, 80)}`); };
export async function replayProvider(captured) {
  const { defineProvider, PROVIDER_STATUS, PROVIDER_CLASS } = await imp('api/_lib/v2/market/provider.js');
  const { extractSearchProvenance } = await imp('api/_lib/phaseb/search-provenance.js');
  const { SEARCH_OUTCOME } = await imp('api/_lib/v2/search.js');
  const { normalizeEbayItems } = await imp('api/_lib/v2/market/ebay-provider.js');
  if (captured.provider === 'openai_web_search') {
    return defineProvider({
      id: 'openai_web_search', kind: 'discovery', profile_name: captured.profile ?? 'local',
      classes: [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED, PROVIDER_CLASS.LOCAL_RETAIL, PROVIDER_CLASS.INTERNATIONAL_USED, PROVIDER_CLASS.INTERNATIONAL_RETAIL],
      supports: () => true,
      async search(identity, ctx) {
        const provenance = captured.raw?.output ? extractSearchProvenance(captured.raw.output) : (captured.raw?.provenance ?? extractSearchProvenance([]));
        if (provenance.results.length) ctx.onFirstResult?.();
        return { status: provenance.search_performed ? PROVIDER_STATUS.COMPLETED : PROVIDER_STATUS.EMPTY, result_count: provenance.results.length, billed: false, cost_usd: 0,
          raw: { plan: ctx.plan, search: { outcome: provenance.search_performed ? SEARCH_OUTCOME.COMPLETED : SEARCH_OUTCOME.NO_SEARCH_RECORDED, provenance, timings: captured.timings ?? null, usage: null, failure: null, stopped_early: true, billed: false } },
          request_id: `replay-${captured.profile ?? 'local'}` };
      },
      normalize: () => [],
    });
  }
  if (captured.provider === 'ebay_browse') {
    return defineProvider({
      id: 'ebay_browse', kind: 'listings', classes: [PROVIDER_CLASS.INTERNATIONAL_USED], supports: () => true,
      async search() { return { status: PROVIDER_STATUS.COMPLETED, raw: captured.raw, result_count: captured.raw?.response?.itemSummaries?.length ?? 0, billed: false }; },
      normalize: (raw) => normalizeEbayItems(raw?.response, { marketplace: raw?.marketplace }),
    });
  }
  return null;
}
/** The engine from a captured recognition onward, no network. Takes the CAPTURE only: no item, no truth. */
export async function replayEngine(capture) {
  const { normalizeIdentity } = await imp('api/_lib/v2/identity.js');
  const { decideSufficiency } = await imp('api/_lib/v2/sufficiency.js');
  const { runV2Price } = await imp('api/_lib/v2/scan.js');
  const { createFxSource, parseBoiRates } = await imp('api/_lib/v2/market/fx.js');
  const t0 = Date.now();
  const identity = normalizeIdentity(capture.identity?.raw);
  const sufficiency = decideSufficiency(identity);
  const identify = { ok: true, identity, sufficiency, timings: capture.identity?.timings ?? null };
  const providers = (await Promise.all((capture.providers ?? []).map(replayProvider))).filter(Boolean);
  const fxSeed = capture.fx?.table ?? (capture.fx?.raw ? parseBoiRates(capture.fx.raw, Date.parse(capture.fx.retrieved_at ?? capture.captured_at)) : null);
  const fx = fxSeed ? createFxSource({ enabled: true, seed: fxSeed, fetchImpl: refuse, now: () => Date.parse(fxSeed.retrieved_at ?? capture.captured_at) }) : createFxSource({ enabled: false, fetchImpl: refuse });
  const price = sufficiency.decision === 'SEARCH_NOW'
    ? await runV2Price({ state: { identity, sufficiency, followups_used: 0 }, model: 'replay', apiKey: 'replay', fetchImpl: refuse, providers, fx, env: {} }) : null;
  const identityMs = capture.identity?.timings?.identity_complete_ms ?? capture.timings?.identity_ms ?? 0;
  return { identify, followup: null, price, timings: { total_ms: Date.now() - t0 + identityMs, identity_ms: identityMs } };
}
/** Replay one item and score it. The scorer is the only reader of `item`. */
export async function replayItem(item, capture) {
  const result = await replayEngine(capture);
  return scoreItem({ item, identify: result.identify, price: result.price, timings: result.timings });
}

// ── LIVE ────────────────────────────────────────────────────────────────────
export function liveGate({ argv, env, plan }) {
  if (!argv.includes('--live')) return { allowed: false, reason: 'not --live' };
  const i = argv.indexOf('--approve-usd');
  const approved = i >= 0 ? Number(argv[i + 1]) : NaN;
  const estimate = plan.runnable_today?.profile_a_one_search_profile?.estimated_cost_usd ?? 0;
  if (!(approved >= estimate)) return { allowed: false, reason: `--approve-usd must be at least ${estimate}` };
  if (env[LIVE_ENV] !== 'yes') return { allowed: false, reason: `${LIVE_ENV} must be exactly 'yes'` };
  if (plan.runnable === 0) return { allowed: false, reason: 'no item has a photograph' };
  return { allowed: true, reason: null };
}
/** One live item. `engine` is injectable so the leakage test can watch what reaches it. */
export async function liveItem(item, { env, engine = runEngine, readFile = readFileSync, model, apiKey, build = 'local', config = {} }) {
  const image = readFile(item.photo.photo_path_resolved);
  const followup = item.photo.followup_photo_path_resolved && existsSync(item.photo.followup_photo_path_resolved) ? readFile(item.photo.followup_photo_path_resolved) : null;
  const result = await engine({ photoBase64: image.toString('base64'), followupPhotoBase64: followup ? followup.toString('base64') : null, env, model, apiKey, safetyIdentifier: `gw-bench-${sha256(image).slice(0, 12)}` });
  const { describeSearch, describeEvidence, describeMarketData } = await imp('api/_lib/v2/report.js');
  const finalResult = result.price ? { valuation: result.price.valuation, search: describeSearch(result.price.plan, result.price.search), evidence: describeEvidence(result.price.evidence), market_data: describeMarketData(result.price.market_data) } : { identity: result.identify.identity, sufficiency: result.identify.sufficiency };
  const capture = buildCapture({ item, imageHash: sha256(image), followupHash: followup ? sha256(followup) : null, build, config, engine: result, finalResult });
  const row = scoreItem({ item, identify: result.identify, price: result.price, timings: result.timings });
  return { capture, row };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const manifest = loadManifest(flag('--manifest') ?? DEFAULT_MANIFEST);
  const only = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const { ebayConfig } = await imp('api/_lib/v2/market/ebay-provider.js');
  const plan = planRun(manifest, { ebayEnabled: ebayConfig(env).enabled, fxEnabled: String(env.SCAN_ENGINE_V2_FX_ENABLED).toLowerCase() === 'true', only });
  const print = (o) => { process.stdout.write(`${JSON.stringify(o, null, 2)}\n`); return o; };

  if (argv.includes('--readiness')) {
    const r = datasetReadiness(manifest, { readFile: (p) => readFileSync(p) });
    if (Object.keys(r.hashes).length) writeFileSync(join(dirname(manifest.path), 'photo-hashes.json'), JSON.stringify(r.hashes, null, 1));
    return print({ mode: MODE.READINESS, ...r });
  }
  if (argv.includes('--replay')) {
    const captures = loadCaptures(resolve(flag('--replay')));
    const rows = [];
    for (const item of manifest.items) { if (only && !only.includes(item.benchmark_id)) continue; const c = captures.get(item.benchmark_id); if (c) rows.push(await replayItem(item, c)); }
    const report = buildReport(rows);
    if (argv.includes('--compare')) {
      const baseRows = [];
      const base = loadCaptures(resolve(flag('--compare')));
      for (const item of manifest.items) { const c = base.get(item.benchmark_id); if (c) baseRows.push(await replayItem(item, c)); }
      return print({ mode: MODE.COMPARE, baseline_items: baseRows.length, variant_items: rows.length, misses_in_baseline: missesOf(baseRows), comparison: compareRuns(baseRows, rows), network_calls: 0 });
    }
    const out = { mode: MODE.REPLAY, captures: captures.size, ...report, misses_for_profile_2_experiment: missesOf(report.rows), network_calls: 0 };
    if (flag('--out')) { mkdirSync(resolve(flag('--out')), { recursive: true }); writeFileSync(join(resolve(flag('--out')), 'report.json'), JSON.stringify(out, null, 1)); }
    return print(out);
  }
  const gate = liveGate({ argv, env, plan });
  if (!gate.allowed) return print({ ...plan, live_refused: argv.includes('--live') ? gate.reason : null, note: 'DRY RUN. No call was made.' });

  // LIVE. Reached only through the gate.
  const { resolveV2Model, V2_KEY_ENV, resolveSearchProfiles } = await imp('api/_lib/v2/config.js');
  const outDir = resolve(flag('--out') ?? join(REPO, 'benchmark-out', new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(outDir, { recursive: true });
  const runEnv = flag('--profiles') ? { ...env, SCAN_ENGINE_V2_SEARCH_PROFILES: flag('--profiles') } : env;
  const config = { model: resolveV2Model(runEnv), profiles: resolveSearchProfiles(runEnv), ebay: ebayConfig(runEnv).enabled, fx: String(runEnv.SCAN_ENGINE_V2_FX_ENABLED).toLowerCase() === 'true' };
  const build = runEnv.VERCEL_GIT_COMMIT_SHA ?? runEnv.GIT_SHA ?? 'local';
  const rows = [];
  for (const item of manifest.items.filter((i) => i.photo.present && (!only || only.includes(i.benchmark_id)))) {
    const { capture, row } = await liveItem(item, { env: runEnv, model: config.model, apiKey: runEnv[V2_KEY_ENV], build, config });
    writeFileSync(join(outDir, `${item.benchmark_id}.capture.json`), JSON.stringify(capture, null, 1));
    rows.push(row);
  }
  const out = { mode: MODE.LIVE, out_dir: outDir, build, configuration: config, ...buildReport(rows), misses_for_profile_2_experiment: missesOf(rows) };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(out, null, 1));
  return print(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { process.stderr.write(`${err?.stack ?? err}\n`); process.exit(1); });
}
