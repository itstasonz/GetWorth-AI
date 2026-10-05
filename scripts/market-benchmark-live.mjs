// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE LIVE HALF OF THE BENCHMARK (GW-BENCHMARK-001 M3)
//
// Everything that may cost money lives here, behind `liveGate`. The engine is
// reached through ONE door, `runEngine`, which takes the photograph(s) and the
// environment and nothing else. The frozen configuration is recorded before
// the first call; a hard ceiling in dollars stops the run before the call that
// would exceed it; one failed item is a result, not an abort; a broken runner
// is an abort, and the run is marked invalid.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scoreItem, buildReport, datasetReadiness, missesOf } from './market-benchmark-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);
export const LIVE_ENV = 'SCAN_ENGINE_V2_BENCHMARK_LIVE';
export const CAPTURE_FORMAT = 'gw-market-capture/2';
/** USD, estimates from the witness's measured usage; `_max` is the ceiling the conservative ledger charges. */
export const RATE = Object.freeze({ identity_call: 0.003, identity_call_max: 0.006, search_action: 0.01, search_tokens: 0.003, search_tokens_max: 0.008, ebay_call: 0, fx_call: 0 });
export const MAX_RUNTIME_PER_ITEM_S = 30;
/** The paths whose change during a live run makes the measurement invalid. */
export const FROZEN_PATHS = Object.freeze(['api/_lib/v2', 'api/v2', 'scripts/market-benchmark.mjs', 'scripts/market-benchmark-live.mjs', 'scripts/market-benchmark-report.mjs', 'tests/fixtures/scan-v2']);
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ── THE ENGINE, SEEN ONLY THROUGH THIS DOOR ─────────────────────────────────
/**
 * Identify, then price, from a photograph. THE ONLY ARGUMENTS ARE THE
 * PHOTOGRAPH(S) AND THE ENVIRONMENT: no label, no expectation, no reference.
 * The follow-up photograph is sent only when the engine asks for one; `first`
 * is the first photograph's own result, kept whatever happens afterwards.
 */
export async function runEngine({ photoBase64, followupPhotoBase64 = null, env, model, apiKey, providers = null, fx = null, fetchImpl = fetch, safetyIdentifier = 'gw-bench' }) {
  const { runV2Identify, runV2Price } = await imp('api/_lib/v2/scan.js');
  const t0 = Date.now();
  const first = await runV2Identify({ image: photoBase64, model, apiKey, safetyIdentifier, fetchImpl });
  let identify = first;
  let followup = null;
  if (first.ok && first.sufficiency.decision === 'NEED_FOLLOWUP' && followupPhotoBase64) {
    followup = await runV2Identify({ image: followupPhotoBase64, priorState: { identity: first.identity, sufficiency: first.sufficiency, followups_used: first.followups_used }, model, apiKey, safetyIdentifier, fetchImpl });
    if (followup.ok) identify = followup;
  }
  const identityMs = Date.now() - t0;
  let price = null;
  if (identify.ok && identify.sufficiency.decision === 'SEARCH_NOW') {
    price = await runV2Price({ state: { identity: identify.identity, sufficiency: identify.sufficiency, followups_used: identify.followups_used ?? 0 }, model, apiKey, safetyIdentifier, fetchImpl, providers, fx, env });
  }
  return { first, identify, followup, price, timings: { identity_ms: identityMs, total_ms: Date.now() - t0 } };
}

/** The conservative dollar charge of one engine result: ceiling rates for every call it made. */
export function chargeOf(result) {
  const identityCalls = (result.first ? 1 : 0) + (result.followup ? 1 : 0);
  const searchActions = result.price?.calls?.search ?? 0;
  const ledger = result.price?.calls?.cost_usd ?? 0;
  return Number((identityCalls * RATE.identity_call_max + Math.max(ledger, searchActions * RATE.search_action) + searchActions * RATE.search_tokens_max).toFixed(4));
}
/** The most one item can cost under a configuration: the number the ceiling check uses before each call. */
export const perItemMaximum = (profiles) => Number((2 * RATE.identity_call_max + profiles * (RATE.search_action + RATE.search_tokens_max)).toFixed(4));

// ── THE CAPTURE ─────────────────────────────────────────────────────────────
export function buildCapture({ item, input, build, config, engine, finalResult }) {
  const { first, identify, followup, price, timings } = engine;
  const idBlock = (r) => (r ? { raw: r.identity ?? null, normalized: r.identity ?? null, sufficiency: r.sufficiency ?? null, ok: r.ok, failure: r.failure ?? null, timings: r.timings ?? null, usage: r.calls?.usage ?? null } : null);
  return {
    format: CAPTURE_FORMAT, item_id: item.benchmark_id, captured_at: new Date().toISOString(), build,
    input: { image_sha256: input.image_sha256, master_sha256: input.master_sha256 ?? null, preparation: input.preparation ?? null, followup_image_sha256: input.followup_image_sha256 ?? null, photo_count: input.followup_image_sha256 ? 2 : 1 },
    configuration: config, timings,
    identity: { request: { model: config.model, image_bytes: input.image_bytes ?? null }, ...(idBlock(identify) ?? { raw: null, normalized: null, sufficiency: null, ok: false, failure: null, timings: null, usage: null }),
      first_photo: idBlock(first), followup_requested: first?.ok === true && first.sufficiency?.decision === 'NEED_FOLLOWUP', followup_supplied: !!followup, followup: idBlock(followup) },
    providers: (price?.market_data?.raw_ledger ?? []).map((r) => ({ provider: r.provider, profile: r.profile, status: r.status, request: { profile: r.profile, queries: r.raw?.plan?.queries?.map((q) => q.text) ?? null }, executed_queries: r.raw?.search?.provenance?.queries ?? null,
      raw: r.provider === 'openai_web_search' ? { output: r.raw?.search?.raw_output ?? null, provenance: r.raw?.search?.provenance ?? null } : r.raw,
      timings: r.raw?.search?.timings ?? null, elapsed_ms: r.elapsed_ms ?? null, started_at: r.started_at, first_result_at: r.first_result_at ?? null, completed_at: r.completed_at, error_class: r.error_class ?? null, result_count: r.result_count ?? 0, normalized_count: r.normalized_count ?? 0, billed: r.billed, cost_usd: r.cost_usd })),
    observations: price?.market_data?.observations ?? [], dedupe: price?.market_data?.dedupe ?? null, independence: price?.market_data?.independence ?? null,
    qualification: price?.evidence ? { market: price.evidence.market, accounting: price.evidence.accounting, counts: price.evidence.counts, entries: price.evidence.entries.map((e) => ({ domain: e.observation.source_domain, price: e.observation.observed_price, currency: e.observation.currency, kind: e.kind, relation: e.relation, configuration: e.configuration, tier: e.tier, admitted: e.admitted, anchor: e.retail_anchor, reason: e.reason })) } : null,
    valuation: price?.valuation ?? null,
    final_result: finalResult,
    fx: price?.market_data?.fx ? { ...price.market_data.fx, table: price.market_data.fx_table ?? null } : null,
    cost: { conservative_usd: chargeOf(engine), ledger_usd: price?.calls?.cost_usd ?? 0 },
  };
}

// ── FREEZE ──────────────────────────────────────────────────────────────────
const git = (args) => { const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
/** What a measurement is a measurement OF: code, data, photographs and configuration, hashed. */
export async function freezeRecord({ manifest, env, config }) {
  const cfg = await imp('api/_lib/v2/config.js');
  const readiness = datasetReadiness(manifest, { readFile: (p) => readFileSync(p) });
  const photoHashes = Object.fromEntries(readiness.items.filter((i) => i.photo.sha256).map((i) => [i.id, { master: i.photo.sha256, prepared: i.photo.prepared_sha256 ?? null, followup: i.photo.followup_sha256 ?? null }]));
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const dirty = (git(['status', '--porcelain', '--', ...FROZEN_PATHS]) ?? '').split('\n').filter(Boolean);
  return {
    frozen_at: new Date().toISOString(),
    git_sha: git(['rev-parse', 'HEAD']), git_branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), frozen_paths_dirty: dirty,
    engine_version: `${pkg.name ?? 'getworth'}@${pkg.version ?? '0'}+${(git(['rev-parse', '--short', 'HEAD']) ?? 'local')}`,
    manifest: { path: manifest.path, sha256: sha256(readFileSync(manifest.path)), items: manifest.items.length, excluded_from_benchmark: manifest.excluded_from_benchmark === true },
    photo_set: { items_with_photo: Object.keys(photoHashes).length, sha256: sha256(Object.entries(photoHashes).sort(([a], [b]) => a.localeCompare(b)).map(([id, h]) => `${id}:${h.master}:${h.prepared ?? ''}:${h.followup ?? ''}`).join('\n')), hashes: photoHashes },
    configuration: { ...config, market: 'IL', identify_timeout_ms: cfg.V2_IDENTIFY_TIMEOUT_MS, search_timeout_ms: cfg.V2_SEARCH_TIMEOUT_MS, market_budget_ms: cfg.V2_MARKET_BUDGET_MS, max_followups: cfg.V2_MAX_FOLLOWUPS, image_preparation: 'the PWA-prepared derivative when the capture helper stored one (1280 px / JPEG 0.82 / skipped under 150 KB), otherwise the master as-is' },
    provider_configuration: { search_profiles: config.profiles, ebay: config.ebay, fx: config.fx, provider_hosts: ['api.openai.com'].concat(config.ebay ? ['api.ebay.com'] : [], config.fx ? ['www.boi.org.il'] : []) },
    env_present: { [LIVE_ENV]: env[LIVE_ENV] ?? null, SCAN_ENGINE_V2_SEARCH_PROFILES: env.SCAN_ENGINE_V2_SEARCH_PROFILES ?? null, SCAN_ENGINE_V2_EBAY_ENABLED: env.SCAN_ENGINE_V2_EBAY_ENABLED ?? null, SCAN_ENGINE_V2_FX_ENABLED: env.SCAN_ENGINE_V2_FX_ENABLED ?? null },
  };
}

// ── THE GATE ────────────────────────────────────────────────────────────────
export function liveGate({ argv, env, plan }) {
  if (!argv.includes('--live')) return { allowed: false, reason: 'not --live' };
  const num = (n) => (argv.includes(n) ? Number(argv[argv.indexOf(n) + 1]) : NaN);
  const approved = num('--approve-usd');
  const a = plan.runnable_today?.profile_a_one_search_profile ?? {};
  const estimate = a.estimated_cost_usd ?? 0;
  if (!(approved >= estimate)) return { allowed: false, reason: `--approve-usd must be at least ${estimate}` };
  if (env[LIVE_ENV] !== 'yes') return { allowed: false, reason: `${LIVE_ENV} must be exactly 'yes'` };
  if (plan.runnable === 0) return { allowed: false, reason: 'no item has a photograph' };
  const ceiling = Number.isFinite(num('--ceiling-usd')) ? num('--ceiling-usd') : (a.maximum_cost_usd ?? approved);
  if (!(ceiling >= approved)) return { allowed: false, reason: '--ceiling-usd must be at least the approved amount' };
  return { allowed: true, reason: null, approved, ceiling };
}

// ── ONE ITEM ────────────────────────────────────────────────────────────────
const pick = (item, prepared, master) => { const p = item.photo?.[prepared]; return p && existsSync(p) ? { path: p, preparation: 'pwa_prepared' } : { path: item.photo?.[master], preparation: 'master_as_is' }; };
/** One live item. `engine` is injectable so the leakage test can watch what reaches it. */
export async function liveItem(item, { env, engine = runEngine, readFile = readFileSync, model, apiKey, build = 'local', config = {} }) {
  const primary = pick(item, 'prepared_path_resolved', 'photo_path_resolved');
  const image = readFile(primary.path);
  const master = primary.preparation === 'master_as_is' ? image : readFile(item.photo.photo_path_resolved);
  const fu = item.photo?.followup_photo_path_resolved ? pick(item, 'followup_prepared_path_resolved', 'followup_photo_path_resolved') : null;
  const followup = fu && fu.path && existsSync(fu.path) ? readFile(fu.path) : null;
  const result = await engine({ photoBase64: image.toString('base64'), followupPhotoBase64: followup ? followup.toString('base64') : null, env, model, apiKey, safetyIdentifier: `gw-bench-${sha256(image).slice(0, 12)}` });
  const { describeSearch, describeEvidence, describeMarketData } = await imp('api/_lib/v2/report.js');
  const finalResult = result.price ? { valuation: result.price.valuation, search: describeSearch(result.price.plan, result.price.search), evidence: describeEvidence(result.price.evidence), market_data: describeMarketData(result.price.market_data) } : { identity: result.identify?.identity ?? null, sufficiency: result.identify?.sufficiency ?? null };
  const input = { image_sha256: sha256(image), master_sha256: sha256(master), preparation: primary.preparation, image_bytes: image.length, followup_image_sha256: followup ? sha256(followup) : null };
  const capture = buildCapture({ item, input, build, config, engine: result, finalResult });
  const row = scoreItem({ item, identify: result.identify, first: result.first, price: result.price, timings: result.timings });
  return { capture, row, charge: chargeOf(result) };
}

// ── THE RUN ─────────────────────────────────────────────────────────────────
/**
 * The frozen run. Items in manifest order; every first result stands; a
 * failed item is a row; a thrown runner is an abort (`valid: false`); the
 * ceiling stops the run BEFORE the call that could exceed it.
 */
export async function runLive({ manifest, env, gate, only = null, outDir, model, apiKey, config, build, engine = runEngine, log = () => {} }) {
  mkdirSync(outDir, { recursive: true });
  const freeze = await freezeRecord({ manifest, env, config });
  writeFileSync(join(outDir, 'freeze.json'), JSON.stringify(freeze, null, 1));
  const items = manifest.items.filter((i) => i.photo.present && (!only || only.includes(i.benchmark_id)));
  const perItem = perItemMaximum(config.profiles?.length ?? 1);
  const rows = []; const state = { spent_conservative_usd: 0, ceiling_usd: gate.ceiling, approved_usd: gate.approved, stopped_by_ceiling: false, items_completed: 0, items_skipped: [], infrastructure_error: null, valid: true };
  for (const item of items) {
    if (state.spent_conservative_usd + perItem > gate.ceiling) { state.stopped_by_ceiling = true; state.items_skipped = items.slice(rows.length).map((i) => i.benchmark_id); break; }
    let out;
    try { out = await liveItem(item, { env, engine, model, apiKey, build, config }); }
    catch (err) { state.infrastructure_error = { item: item.benchmark_id, error: String(err?.stack ?? err).slice(0, 600) }; state.valid = false; state.items_skipped = items.slice(rows.length).map((i) => i.benchmark_id); break; }
    writeFileSync(join(outDir, `${item.benchmark_id}.capture.json`), JSON.stringify(out.capture, null, 1));
    rows.push(out.row);
    state.spent_conservative_usd = Number((state.spent_conservative_usd + out.charge).toFixed(4));
    state.items_completed += 1;
    log(`${item.benchmark_id}: ${out.row.decision ?? out.row.photo_failure} · ${out.row.valuation_state ?? '-'} · $${out.charge} (spent $${state.spent_conservative_usd} of $${gate.ceiling})`);
  }
  const report = { mode: 'live', out_dir: outDir, build, excluded_from_benchmark: manifest.excluded_from_benchmark === true, counts_toward_benchmark: manifest.excluded_from_benchmark !== true, freeze, cost: state, ...buildReport(rows), misses_for_profile_2_experiment: missesOf(rows) };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}
