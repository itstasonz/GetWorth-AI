#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE MARKET-DATA BENCHMARK (GW-MARKET-DATA-001 §7)
//
//   node scripts/market-benchmark.mjs --manifest tests/fixtures/scan-v2/benchmark-44.json            # DRY RUN (default)
//   node scripts/market-benchmark.mjs --manifest <m> --replay tests/fixtures/scan-v2/captures          # costs nothing
//   node --env-file=.env.local scripts/market-benchmark.mjs --manifest <m> --live --approve-usd 2.00 --out <dir>
//
// THREE MODES, AND THE DEFAULT IS NOT LIVE.
//   dry-run   prints exactly what a live run WOULD call: items, identity calls,
//             search actions per profile, eBay calls, FX calls, the estimated
//             cost and the maximum runtime. Makes no call.
//   replay    runs the whole engine over PERSISTED captures (format below) and
//             computes every metric. Makes no call; the fetch it hands the
//             engine refuses every URL and the run fails if one is attempted.
//   live      the only mode that may call a paid provider. It refuses to start
//             unless --live is given, --approve-usd is at least the estimate,
//             and SCAN_ENGINE_V2_BENCHMARK_LIVE is exactly 'yes'. It writes one
//             capture per item so the run can be replayed forever.
//
// CAPTURE FORMAT (gw-market-capture/1), one file per item:
//   { format, item_id, captured_at, build,
//     identity: { request (no image), raw (the vision JSON), timings, usage },
//     providers: [{ provider, profile, request (no secrets), raw, timings, billed, cost_usd }],
//     fx: { raw, retrieved_at } | null }
//   A `raw` may be { "$ref": "<relative file>#/<json pointer>" } to point at a committed fixture.
//
// Nothing here is imported by api/ or src/.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);

export const MODE = Object.freeze({ DRY_RUN: 'dry-run', REPLAY: 'replay', LIVE: 'live' });
export const LIVE_ENV = 'SCAN_ENGINE_V2_BENCHMARK_LIVE';
/** USD, estimates from the witness's measured usage; the live run reports actuals. */
export const RATE = Object.freeze({ identity_call: 0.003, search_action: 0.01, search_tokens: 0.003, ebay_call: 0, fx_call: 0 });
export const MAX_RUNTIME_PER_ITEM_S = 30;

// ── MANIFEST AND CAPTURES ───────────────────────────────────────────────────
export function loadManifest(path) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.format !== 'gw-benchmark-manifest/1' || !Array.isArray(m.items)) throw new Error('not a gw-benchmark-manifest/1');
  const base = dirname(resolve(path));
  return { ...m, path: resolve(path), items: m.items.map((i) => ({ ...i, photo_path: i.photo ? resolve(base, i.photo) : null, photo_present: i.photo ? existsSync(resolve(base, i.photo)) : false })) };
}

/** Resolve { "$ref": "file#/pointer" } values relative to the capture file. */
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
    if (c.format !== 'gw-market-capture/1') continue;
    out.set(c.item_id, c);
  }
  return out;
}

// ── THE PLAN: WHAT A LIVE RUN WOULD CALL ────────────────────────────────────
/** The calls and cost for a set of items. Every number is a count of requests, not a guess at results. */
function callsFor(items, { profiles, ebayEnabled, fxEnabled }) {
  const followups = items.filter((i) => i.followup_photo).length;
  const identity = items.length + followups;
  const searchActions = items.length * profiles.length;
  const ebay = ebayEnabled ? items.length : 0;
  const fx = fxEnabled && items.length ? 1 : 0;
  const cost = {
    identity_usd: Number((identity * RATE.identity_call).toFixed(3)),
    search_usd: Number((searchActions * (RATE.search_action + RATE.search_tokens)).toFixed(3)),
    ebay_usd: ebay * RATE.ebay_call, fx_usd: fx * RATE.fx_call,
  };
  cost.total_usd = Number((cost.identity_usd + cost.search_usd + cost.ebay_usd + cost.fx_usd).toFixed(2));
  return { items: items.length, calls: { identity, search_actions: searchActions, ebay, fx, other: 0 }, estimated_cost: cost, max_runtime_s: items.length * MAX_RUNTIME_PER_ITEM_S };
}

export function planRun(manifest, { profiles = ['local'], ebayEnabled = false, fxEnabled = false } = {}) {
  const items = manifest.items;
  const runnable = items.filter((i) => i.photo_present);
  const opts = { profiles, ebayEnabled, fxEnabled };
  const now = callsFor(runnable, opts);
  return {
    mode: MODE.DRY_RUN, manifest: manifest.path, items: items.length, runnable: runnable.length,
    missing_photos: items.filter((i) => !i.photo_present).map((i) => i.id),
    profiles,
    // What a live run would call TODAY (items with a photograph on disk)...
    calls: now.calls, estimated_cost: now.estimated_cost, max_runtime_s: now.max_runtime_s,
    // ...and what the full manifest will call once every photograph is in place.
    full_manifest: callsFor(items, opts),
    per_item_calls: { identity: 1, followup_identity: '1 when the manifest names a follow-up photograph', search_actions: profiles.length, ebay: ebayEnabled ? 1 : 0 },
    rates_usd: RATE,
  };
}

// ── METRICS, ONE ROW PER ITEM ───────────────────────────────────────────────
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const contains = (a, b) => !!b && String(a ?? '').toLowerCase().includes(String(b).toLowerCase());
export function itemMetrics({ item, identify, price, timings = {} }) {
  const id = identify?.identity ?? null;
  const ex = item.expect ?? {};
  const gt = item.ground_truth ?? {};
  const v = price?.valuation ?? null;
  const ev = price?.evidence ?? null;
  const md = price?.market_data ?? null;
  const tiers = ev?.counts?.by_tier ?? {};
  const recommended = v?.recommended ?? null;
  const err = recommended && gt.used_asking_ils ? Math.abs(recommended - gt.used_asking_ils) : null;
  return {
    id: item.id, category: item.category,
    brand_correct: ex.brand === null ? (id?.brand?.value ?? null) === null : same(id?.brand?.value, ex.brand),
    exact_model_correct: ex.model === null ? (id?.model?.value ?? null) === null : (same(id?.model?.value, ex.model) || contains(id?.model?.value, ex.model)),
    configuration_correct: same(id?.configuration ?? 'UNKNOWN', ex.configuration ?? 'UNKNOWN'),
    recognition_correct: (ex.brand === null ? (id?.brand?.value ?? null) === null : same(id?.brand?.value, ex.brand)) && same(identify?.sufficiency?.level, ex.level),
    followup_required: identify?.sufficiency?.decision === 'NEED_FOLLOWUP',
    decision: identify?.sufficiency?.decision ?? null,
    identity_latency_ms: identify?.timings?.identity_complete_ms ?? timings.identity_ms ?? null,
    market_identity_correct: ex.market_model_number ? (ev?.market?.exact_roots ?? []).includes(ex.market_model_number) : null,
    raw_results: ev?.accounting?.total ?? 0,
    normalized_observations: md?.dedupe?.counts?.normalized_count ?? 0,
    duplicate_observations: md?.dedupe?.counts?.duplicate_count ?? 0,
    local_used_coverage: tiers.A_LOCAL_USED_EXACT ?? 0,
    international_used_coverage: tiers.B_INTERNATIONAL_USED_EXACT ?? 0,
    retail_anchor_coverage: v?.retail_anchor?.shops ?? 0,
    qualified_exact_comparables: ev?.counts?.admitted ?? 0,
    distinct_sources: md?.independence?.admitted?.distinct_origin_count ?? 0,
    distinct_providers: md?.independence?.admitted?.distinct_provider_count ?? 0,
    valuation_available: typeof recommended === 'number' && recommended > 0,
    valuation_tier: v?.evidence_state ?? null, valuation_state: v?.state ?? null,
    valuation_confidence: v?.confidence?.pricing?.used_market ?? null,
    limitation: v?.limitation?.code ?? null,
    ground_truth_used_ils: gt.used_asking_ils ?? null, ground_truth_retail_ils: gt.retail_ils ?? null,
    absolute_error_ils: err, percentage_error: err !== null ? Number((100 * err / gt.used_asking_ils).toFixed(1)) : null,
    anchor_error_pct: v?.retail_anchor?.median && gt.retail_ils ? Number((100 * Math.abs(v.retail_anchor.median - gt.retail_ils) / gt.retail_ils).toFixed(1)) : null,
    market_data_latency_ms: price?.timings?.market_data_ms ?? null,
    total_latency_ms: timings.total_ms ?? null,
    within_8s: typeof timings.total_ms === 'number' ? timings.total_ms <= 8000 : null,
  };
}

/** Coverage, over the rows that were actually measured. No row, no number. */
export function summarize(rows) {
  const pct = (list, f) => (list.length ? Number((100 * list.filter(f).length / list.length).toFixed(1)) : null);
  const obvious = rows.filter((r) => r.decision !== null);
  return {
    items_measured: rows.length,
    identified_correctly_pct: pct(obvious, (r) => r.recognition_correct),
    exact_model_pct: pct(obvious, (r) => r.exact_model_correct),
    followup_pct: pct(obvious, (r) => r.followup_required),
    local_used_evidence_pct: pct(obvious, (r) => r.local_used_coverage > 0),
    international_used_evidence_pct: pct(obvious, (r) => r.international_used_coverage > 0),
    retail_anchor_pct: pct(obvious, (r) => r.retail_anchor_coverage > 0),
    defensible_valuation_pct: pct(obvious, (r) => r.valuation_available),
    within_8s_pct: pct(obvious.filter((r) => r.within_8s !== null), (r) => r.within_8s),
    by_category: Object.fromEntries([...new Set(rows.map((r) => r.category))].map((c) => [c, { n: rows.filter((r) => r.category === c).length, valuation_pct: pct(rows.filter((r) => r.category === c), (r) => r.valuation_available) }])),
  };
}

// ── REPLAY: THE ENGINE OVER CAPTURES, NO NETWORK ────────────────────────────
const refuse = async (url) => { throw new Error(`[benchmark replay] network call attempted: ${String(url).slice(0, 80)}`); };

/** A provider that replays a captured raw response. */
export async function replayProvider(captured) {
  const { defineProvider, PROVIDER_STATUS } = await imp('api/_lib/v2/market/provider.js');
  const { extractSearchProvenance } = await imp('api/_lib/phaseb/search-provenance.js');
  const { SEARCH_OUTCOME } = await imp('api/_lib/v2/search.js');
  const { normalizeEbayItems } = await imp('api/_lib/v2/market/ebay-provider.js');
  const { PROVIDER_CLASS } = await imp('api/_lib/v2/market/provider.js');
  if (captured.provider === 'openai_web_search') {
    return defineProvider({
      id: 'openai_web_search', kind: 'discovery', profile_name: captured.profile ?? 'local',
      classes: [PROVIDER_CLASS.SEARCH_DISCOVERY, PROVIDER_CLASS.LOCAL_USED, PROVIDER_CLASS.LOCAL_RETAIL, PROVIDER_CLASS.INTERNATIONAL_USED, PROVIDER_CLASS.INTERNATIONAL_RETAIL],
      supports: () => true,
      async search(identity, ctx) {
        const provenance = extractSearchProvenance(captured.raw?.output ?? []);
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

export async function replayItem(item, capture) {
  const { normalizeIdentity } = await imp('api/_lib/v2/identity.js');
  const { decideSufficiency } = await imp('api/_lib/v2/sufficiency.js');
  const { runV2Price } = await imp('api/_lib/v2/scan.js');
  const { createFxSource, parseBoiRates } = await imp('api/_lib/v2/market/fx.js');
  const t0 = Date.now();
  const identity = normalizeIdentity(capture.identity?.raw);
  const sufficiency = decideSufficiency(identity);
  const identify = { identity, sufficiency, timings: capture.identity?.timings ?? null };
  const providers = (await Promise.all((capture.providers ?? []).map(replayProvider))).filter(Boolean);
  const fx = capture.fx?.raw ? createFxSource({ enabled: true, seed: parseBoiRates(capture.fx.raw, Date.parse(capture.fx.retrieved_at ?? capture.captured_at)), fetchImpl: refuse }) : createFxSource({ enabled: false, fetchImpl: refuse });
  const price = await runV2Price({ state: { identity, sufficiency, followups_used: 0 }, model: 'replay', apiKey: 'replay', fetchImpl: refuse, providers, fx, env: {} });
  return itemMetrics({ item, identify, price, timings: { total_ms: Date.now() - t0 + (capture.identity?.timings?.identity_complete_ms ?? 0), identity_ms: capture.identity?.timings?.identity_complete_ms ?? null } });
}

// ── LIVE: THE ONLY MODE THAT CALLS ANYTHING ─────────────────────────────────
export function liveGate({ argv, env, plan }) {
  if (!argv.includes('--live')) return { allowed: false, reason: 'not --live' };
  const i = argv.indexOf('--approve-usd');
  const approved = i >= 0 ? Number(argv[i + 1]) : NaN;
  if (!(approved >= plan.estimated_cost.total_usd)) return { allowed: false, reason: `--approve-usd must be at least ${plan.estimated_cost.total_usd}` };
  if (env[LIVE_ENV] !== 'yes') return { allowed: false, reason: `${LIVE_ENV} must be exactly 'yes'` };
  if (plan.runnable === 0) return { allowed: false, reason: 'no item has a photograph' };
  return { allowed: true, reason: null };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const manifest = loadManifest(flag('--manifest') ?? join(REPO, 'tests/fixtures/scan-v2/benchmark-44.json'));
  const { resolveSearchProfiles } = await imp('api/_lib/v2/config.js');
  const { ebayConfig } = await imp('api/_lib/v2/market/ebay-provider.js');
  const profiles = flag('--profiles')?.split(',') ?? resolveSearchProfiles(env);
  const plan = planRun(manifest, { profiles, ebayEnabled: ebayConfig(env).enabled, fxEnabled: String(env.SCAN_ENGINE_V2_FX_ENABLED).toLowerCase() === 'true' });

  if (argv.includes('--replay')) {
    const captures = loadCaptures(resolve(flag('--replay')));
    const rows = [];
    for (const item of manifest.items) { const c = captures.get(item.id); if (c) rows.push(await replayItem(item, c)); }
    const out = { mode: MODE.REPLAY, captures: captures.size, rows, summary: summarize(rows), network_calls: 0 };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  const gate = liveGate({ argv, env, plan });
  if (!gate.allowed) {
    const out = { ...plan, live_refused: argv.includes('--live') ? gate.reason : null, note: 'DRY RUN. No call was made. Run with --live --approve-usd <n> and SCAN_ENGINE_V2_BENCHMARK_LIVE=yes to spend.' };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return out;
  }
  // LIVE. Reached only through the gate above.
  const outDir = flag('--out') ?? join(REPO, 'benchmark-out', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });
  const { runV2Identify, runV2Price } = await imp('api/_lib/v2/scan.js');
  const { resolveV2Model, V2_KEY_ENV } = await imp('api/_lib/v2/config.js');
  const rows = [];
  for (const item of manifest.items.filter((i) => i.photo_present)) {
    const t0 = Date.now();
    const identify = await runV2Identify({ image: readFileSync(item.photo_path).toString('base64'), model: resolveV2Model(env), apiKey: env[V2_KEY_ENV], safetyIdentifier: `gw-bench-${item.id}` });
    let price = null;
    if (identify.ok && identify.sufficiency.decision === 'SEARCH_NOW') {
      price = await runV2Price({ state: { identity: identify.identity, sufficiency: identify.sufficiency, followups_used: 0 }, model: resolveV2Model(env), apiKey: env[V2_KEY_ENV], safetyIdentifier: `gw-bench-${item.id}`, env });
    }
    const capture = {
      format: 'gw-market-capture/1', item_id: item.id, captured_at: new Date().toISOString(), build: env.VERCEL_GIT_COMMIT_SHA ?? 'local',
      identity: { request: { model: resolveV2Model(env), image_bytes: 0 }, raw: identify.identity ?? null, timings: identify.timings, usage: identify.calls?.usage ?? null },
      providers: (price?.market_data?.raw_ledger ?? []).map((r) => ({ provider: r.provider, profile: r.profile, request: { profile: r.profile }, raw: r.provider === 'openai_web_search' ? { output: r.raw?.search?.provenance ? r.raw.search.raw_output ?? null : null, provenance: r.raw?.search?.provenance ?? null } : r.raw, timings: r.timings ?? null, billed: r.billed, cost_usd: r.cost_usd })),
      fx: null,
    };
    writeFileSync(join(outDir, `${item.id}.capture.json`), JSON.stringify(capture, null, 1));
    rows.push(itemMetrics({ item, identify, price, timings: { total_ms: Date.now() - t0, identity_ms: identify.timings?.identity_complete_ms ?? null } }));
  }
  const out = { mode: MODE.LIVE, out_dir: outDir, rows, summary: summarize(rows) };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(out, null, 1));
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { process.stderr.write(`${err?.stack ?? err}\n`); process.exit(1); });
}
