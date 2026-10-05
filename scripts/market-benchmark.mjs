#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE MARKET-DATA BENCHMARK RUNNER (GW-BENCHMARK-001)
//
//   node scripts/market-benchmark.mjs [--manifest <m>]                      DRY RUN (default): what a live run would call
//   node scripts/market-benchmark.mjs --readiness                            is the dataset ready? photographs, hashes, truth
//   node scripts/market-benchmark.mjs --freeze                               the record of what a run would measure (SHA, hashes, config)
//   node scripts/market-benchmark.mjs --replay <captures dir> [--out <dir>]  the engine over persisted captures; no network
//   node scripts/market-benchmark.mjs --replay <variant dir> --compare <baseline dir>   incremental effect of a variant run
//   node --env-file=.env.local scripts/market-benchmark.mjs --live --approve-usd <est> [--ceiling-usd <max>] [--only id,id] [--profiles a,b] [--out <dir>]
//
// THE ENGINE NEVER SEES THE TRUTH. `runEngine` (market-benchmark-live.mjs)
// takes a photograph and the environment, and nothing else; the manifest's
// identity, aliases and reference prices reach only the scorer
// (market-benchmark-report.mjs). The benchmark suite proves that mechanically.
//
// LIVE is the only mode that may call a provider, and it refuses unless
// --live is given, --approve-usd is at least the estimate, and
// SCAN_ENGINE_V2_BENCHMARK_LIVE is exactly 'yes'. npm test never passes those.
// A manifest marked excluded_from_benchmark (the preflight set) runs the same
// machinery and its report says it counts toward nothing.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scoreItem, buildReport, datasetReadiness, preflightReadiness, missesOf, compareRuns, compareReplay } from './market-benchmark-report.mjs';
import { RATE, MAX_RUNTIME_PER_ITEM_S, liveGate, runLive, freezeRecord } from './market-benchmark-live.mjs';

export { RATE, MAX_RUNTIME_PER_ITEM_S, LIVE_ENV, CAPTURE_FORMAT, liveGate, liveItem, runEngine, buildCapture, sha256, chargeOf, perItemMaximum, freezeRecord, runLive, FROZEN_PATHS } from './market-benchmark-live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);

export const MODE = Object.freeze({ DRY_RUN: 'dry-run', READINESS: 'readiness', FREEZE: 'freeze', REPLAY: 'replay', LIVE: 'live', COMPARE: 'compare' });
export const DEFAULT_MANIFEST = join(REPO, 'tests/fixtures/scan-v2/benchmark-44.json');

// ── MANIFEST AND CAPTURES ───────────────────────────────────────────────────
export function loadManifest(path = DEFAULT_MANIFEST) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.format !== 'gw-benchmark-manifest/2' || !Array.isArray(m.items)) throw new Error('not a gw-benchmark-manifest/2');
  const base = dirname(resolve(path));
  const abs = (p) => (p ? resolve(base, p) : null);
  const excluded = m.excluded_from_benchmark === true;
  for (const i of m.items) {
    if ((i.excluded_from_benchmark === true) !== excluded) throw new Error(`${i.benchmark_id}: excluded_from_benchmark must match the manifest (${excluded})`);
  }
  return {
    ...m, path: resolve(path), excluded_from_benchmark: excluded,
    items: m.items.map((i) => ({
      ...i, excluded_from_benchmark: excluded,
      photo: {
        ...i.photo,
        photo_path_resolved: abs(i.photo?.photo_path), prepared_path_resolved: abs(i.photo?.prepared?.path ?? null),
        followup_photo_path_resolved: abs(i.photo?.followup_photo_path ?? null), followup_prepared_path_resolved: abs(i.photo?.followup_prepared?.path ?? null),
        present: i.photo?.photo_path ? existsSync(abs(i.photo.photo_path)) : false,
      },
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
    mode: MODE.DRY_RUN, manifest: manifest.path, excluded_from_benchmark: manifest.excluded_from_benchmark === true, items: items.length, runnable: runnable.length,
    missing_photos: items.filter((i) => !i.photo.present).map((i) => i.benchmark_id),
    runnable_today: both(runnable), full_manifest: both(items), rates_usd: RATE,
    first_live_configuration: 'profile_a_one_search_profile',
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
  const firstRaw = capture.identity?.first_photo?.raw ?? capture.identity?.raw;
  const firstIdentity = normalizeIdentity(firstRaw);
  const first = { ok: true, identity: firstIdentity, sufficiency: decideSufficiency(firstIdentity), timings: capture.identity?.first_photo?.timings ?? capture.identity?.timings ?? null };
  const identity = normalizeIdentity(capture.identity?.raw);
  const sufficiency = decideSufficiency(identity, { followupsUsed: capture.identity?.followup_supplied ? 1 : 0 });
  const identify = { ok: true, identity, sufficiency, timings: capture.identity?.timings ?? null };
  const providers = (await Promise.all((capture.providers ?? []).map(replayProvider))).filter(Boolean);
  const fxSeed = capture.fx?.table ?? (capture.fx?.raw ? parseBoiRates(capture.fx.raw, Date.parse(capture.fx.retrieved_at ?? capture.captured_at)) : null);
  const fx = fxSeed ? createFxSource({ enabled: true, seed: fxSeed, fetchImpl: refuse, now: () => Date.parse(fxSeed.retrieved_at ?? capture.captured_at) }) : createFxSource({ enabled: false, fetchImpl: refuse });
  const price = sufficiency.decision === 'SEARCH_NOW'
    ? await runV2Price({ state: { identity, sufficiency, followups_used: 0 }, model: 'replay', apiKey: 'replay', fetchImpl: refuse, providers, fx, env: {} }) : null;
  const identityMs = capture.identity?.timings?.identity_complete_ms ?? capture.timings?.identity_ms ?? 0;
  return { first, identify, followup: capture.identity?.followup_supplied ? identify : null, price, timings: { total_ms: Date.now() - t0 + identityMs, identity_ms: identityMs } };
}
/** Replay one item and score it. The scorer is the only reader of `item`. */
export async function replayItem(item, capture) {
  const result = await replayEngine(capture);
  return scoreItem({ item, identify: result.identify, first: result.first, price: result.price, timings: result.timings });
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2), env = process.env) {
  const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const manifest = loadManifest(flag('--manifest') ?? DEFAULT_MANIFEST);
  const only = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const { ebayConfig } = await imp('api/_lib/v2/market/ebay-provider.js');
  const { resolveV2Model, V2_KEY_ENV, resolveSearchProfiles } = await imp('api/_lib/v2/config.js');
  const runEnv = flag('--profiles') ? { ...env, SCAN_ENGINE_V2_SEARCH_PROFILES: flag('--profiles') } : env;
  const config = { model: resolveV2Model(runEnv), profiles: resolveSearchProfiles(runEnv), ebay: ebayConfig(runEnv).enabled, fx: String(runEnv.SCAN_ENGINE_V2_FX_ENABLED).toLowerCase() === 'true' };
  const plan = planRun(manifest, { ebayEnabled: config.ebay, fxEnabled: config.fx, only });
  const print = (o) => { process.stdout.write(`${JSON.stringify(o, null, 2)}\n`); return o; };

  if (argv.includes('--readiness')) {
    const r = datasetReadiness(manifest, { readFile: (p) => readFileSync(p) });
    if (Object.keys(r.hashes).length) writeFileSync(join(dirname(manifest.path), 'photo-hashes.json'), JSON.stringify(r.hashes, null, 1));
    if (manifest.excluded_from_benchmark) {
      const benchmarkIds = loadManifest(DEFAULT_MANIFEST).items.map((i) => i.benchmark_id);
      return print({ mode: MODE.READINESS, excluded_from_benchmark: true, preflight: preflightReadiness(manifest, { readFile: (p) => readFileSync(p), benchmarkIds }), dataset: r });
    }
    return print({ mode: MODE.READINESS, excluded_from_benchmark: manifest.excluded_from_benchmark, ...r });
  }
  if (argv.includes('--freeze')) return print({ mode: MODE.FREEZE, ...(await freezeRecord({ manifest, env: runEnv, config })) });
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
    const liveReport = existsSync(join(resolve(flag('--replay')), 'report.json')) ? JSON.parse(readFileSync(join(resolve(flag('--replay')), 'report.json'), 'utf8')) : null;
    const out = { mode: MODE.REPLAY, excluded_from_benchmark: manifest.excluded_from_benchmark, captures: captures.size, ...report, misses_for_profile_2_experiment: missesOf(report.rows), replay_verification: liveReport?.rows ? compareReplay(liveReport.rows, report.rows) : null, network_calls: 0 };
    if (flag('--out')) { mkdirSync(resolve(flag('--out')), { recursive: true }); writeFileSync(join(resolve(flag('--out')), 'report.json'), JSON.stringify(out, null, 1)); }
    return print(out);
  }
  const gate = liveGate({ argv, env, plan });
  if (!gate.allowed) return print({ ...plan, live_refused: argv.includes('--live') ? gate.reason : null, note: 'DRY RUN. No call was made.' });

  // LIVE. Reached only through the gate. A dirty frozen path makes the measurement meaningless: refuse.
  const freeze = await freezeRecord({ manifest, env: runEnv, config });
  if (freeze.frozen_paths_dirty.length && !argv.includes('--allow-dirty')) return print({ live_refused: 'frozen paths have uncommitted changes', frozen_paths_dirty: freeze.frozen_paths_dirty, note: 'commit or stash them, or pass --allow-dirty for a preflight that is not a measurement' });
  const outDir = resolve(flag('--out') ?? join(REPO, 'benchmark-out', new Date().toISOString().replace(/[:.]/g, '-')));
  return print(await runLive({ manifest, env: runEnv, gate, only, outDir, model: config.model, apiKey: runEnv[V2_KEY_ENV], config, build: freeze.git_sha ?? 'local', log: (line) => process.stderr.write(`${line}\n`) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { process.stderr.write(`${err?.stack ?? err}\n`); process.exit(1); });
}
