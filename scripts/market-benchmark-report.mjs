// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — BENCHMARK SCORING, COHORTS, FAILURE TAXONOMY, READINESS
//
// Pure functions over ENGINE OUTPUT and GROUND TRUTH. Nothing here touches a
// provider, and nothing here is imported by the engine: the scorer sees the
// truth, the engine never does (scripts/market-benchmark.mjs keeps the two
// paths apart, and tests/scan-v2-benchmark.test.mjs proves it).
// ══════════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';

export const COHORT = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D' });
export const COHORT_NAME = Object.freeze({
  A: 'obvious identifiable items', B: 'identifiable family / ambiguous model', C: 'generic / low-identity items', D: 'configuration / adversarial',
});
export const GT_CLASS = Object.freeze({ A: 'RECENT_SOLD_EVIDENCE', B: 'MULTIPLE_LOCAL_ASKING_PRICES', C: 'HUMAN_VERIFIED_RANGE', D: 'RETAIL_ONLY', E: 'NO_RELIABLE_VALUE' });
/** Classes whose reference value may score a used valuation. Retail never may. */
export const SCORABLE_GT = Object.freeze(new Set(['A', 'B', 'C']));
export const FAILURE = Object.freeze([
  'PHOTO_PIPELINE', 'RECOGNITION_BRAND', 'RECOGNITION_MODEL', 'RECOGNITION_CONFIGURATION', 'UNNECESSARY_FOLLOWUP', 'MARKET_IDENTITY',
  'DISCOVERY_COVERAGE', 'NORMALIZATION', 'DEDUPLICATION', 'QUALIFICATION', 'FX', 'CALIBRATION', 'VALUATION', 'TIMEOUT', 'PROVIDER_FAILURE', 'OTHER',
]);
export const SPECIAL_CASE = Object.freeze(['complete_product', 'base_only', 'box_only', 'accessory_only', 'part', 'bundle', 'generic_item', 'sibling_trap', 'multiple_objects', 'other']);

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const contains = (a, b) => !!b && String(a ?? '').toLowerCase().includes(String(b).toLowerCase());
const tokens = (v) => String(v ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const COMPLETE_LIKE = new Set(['COMPLETE', 'UNKNOWN']);

/** Median and P95 of a list of numbers; null when empty. */
export function percentiles(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, p95: null, max: null };
  const at = (q) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  return { n: v.length, median: at(0.5), p95: at(0.95), max: v[v.length - 1] };
}

// ── ONE ROW PER ITEM ────────────────────────────────────────────────────────
/**
 * Score one item: the engine's output against the item's ground truth.
 * `identify` / `price` are the engine's own results; `timings` the measured
 * wall-clock; `failure` is left null here and set by `classifyFailure`.
 */
export function scoreItem({ item, identify, price, timings = {} }) {
  const gt = item.identity ?? {};
  const exp = item.expected_recognition ?? {};
  const vgt = item.valuation_ground_truth ?? {};
  const id = identify?.identity ?? null;
  const v = price?.valuation ?? null;
  const ev = price?.evidence ?? null;
  const md = price?.market_data ?? null;
  const tiers = ev?.counts?.by_tier ?? {};
  const engineBrand = id?.brand?.value ?? null;
  const engineModel = id?.model?.value ?? null;
  const engineConfig = id?.configuration ?? 'UNKNOWN';
  const decision = identify?.sufficiency?.decision ?? null;
  const level = identify?.sufficiency?.level ?? null;

  const brandCorrect = gt.brand === null || gt.brand === undefined ? engineBrand === null : (same(engineBrand, gt.brand) || (gt.brand_alternatives ?? []).some((b) => same(engineBrand, b)));
  const exactModel = gt.exact_model ? (same(engineModel, gt.exact_model) || contains(engineModel, gt.exact_model)) : null;
  const familyOk = gt.product_family ? tokens(engineModel).some((t) => tokens(gt.product_family).includes(t)) || contains(engineModel, gt.product_family) : null;
  const modelCorrect = exp.exact_model_expected ? exactModel === true
    : (exp.family_only_acceptable ? (exactModel === true || familyOk === true) : (exp.generic_only_acceptable ? level !== 'product' : exactModel));
  const configCorrect = gt.configuration === 'COMPLETE' ? COMPLETE_LIKE.has(engineConfig) : (same(engineConfig, gt.configuration) || (gt.configuration_alternatives ?? []).some((c) => same(engineConfig, c)));
  const unnecessaryFollowup = exp.exact_model_expected === true && decision === 'NEED_FOLLOWUP';
  const mustNotBe = item.must_not_be ? !(contains(engineModel, item.must_not_be) || contains(engineBrand, item.must_not_be)) : null;
  const knownNumbers = item.market_identity?.known_model_numbers ?? [];
  const exactRoots = ev?.market?.exact_roots ?? [];
  const recommended = v?.recommended ?? null;
  const ref = SCORABLE_GT.has(vgt.class) ? (vgt.reference_ils ?? null) : null;
  const err = typeof recommended === 'number' && ref ? Math.abs(recommended - ref) : null;
  const obs = md?.observations ?? [];
  return {
    id: item.benchmark_id, cohort: item.cohort, category: item.category, special_case: item.special_case ?? null,
    // recognition
    engine_ok: identify?.ok !== false, photo_failure: identify?.ok === false ? (identify.failure ?? 'provider_failed') : null,
    brand_engine: engineBrand, brand_truth: gt.brand ?? null, brand_correct: brandCorrect,
    model_engine: engineModel, model_truth: gt.exact_model ?? null, exact_model_correct: exactModel, family_acceptable: familyOk, model_correct: modelCorrect,
    configuration_engine: engineConfig, configuration_truth: gt.configuration ?? null, configuration_correct: configCorrect,
    decision, level, expected_decision: exp.decision ?? null, decision_as_expected: exp.decision ? decision === exp.decision : null,
    unnecessary_followup: unnecessaryFollowup, must_not_be_respected: mustNotBe,
    recognition_correct: brandCorrect && modelCorrect === true && configCorrect && !unnecessaryFollowup && mustNotBe !== false,
    identity_latency_ms: identify?.timings?.identity_complete_ms ?? timings.identity_ms ?? null,
    // market identity
    market_identity_correct: knownNumbers.length ? knownNumbers.some((n) => exactRoots.includes(String(n).toUpperCase())) : null,
    market_exact_roots: exactRoots,
    // market data
    raw_results: ev?.accounting?.total ?? 0,
    normalized_observations: md?.dedupe?.counts?.normalized_count ?? 0,
    duplicate_observations: md?.dedupe?.counts?.duplicate_count ?? 0,
    exact_product_observations: obs.filter((o) => o.relation === 'EXACT_PRODUCT').length,
    local_used_coverage: tiers.A_LOCAL_USED_EXACT ?? 0,
    international_used_coverage: tiers.B_INTERNATIONAL_USED_EXACT ?? 0,
    retail_anchor_coverage: v?.retail_anchor?.shops ?? 0,
    qualified_exact_comparables: ev?.counts?.admitted ?? 0,
    distinct_sources: md?.independence?.admitted?.distinct_origin_count ?? 0,
    distinct_providers: md?.independence?.admitted?.distinct_provider_count ?? 0,
    providers: (md?.ledger ?? []).map((r) => `${r.provider}${r.profile ? `:${r.profile}` : ''}=${r.status}`),
    provider_timeouts: (md?.ledger ?? []).filter((r) => r.status === 'TIMED_OUT').length,
    provider_failures: (md?.ledger ?? []).filter((r) => r.status === 'FAILED').length,
    fx_status: md?.fx?.status ?? null,
    // valuation
    valuation_available: typeof recommended === 'number' && recommended > 0,
    valuation_tier: v?.evidence_state ?? null, valuation_state: v?.state ?? null,
    valuation_confidence: v?.confidence?.pricing?.used_market ?? null, limitation: v?.limitation?.code ?? null,
    recommended_ils: recommended, low_ils: v?.low ?? null, high_ils: v?.high ?? null,
    valuation_gt_class: vgt.class ?? null, reference_ils: ref,
    absolute_error_ils: err, percentage_error: err !== null ? Number((100 * err / ref).toFixed(1)) : null,
    anchor_error_pct: v?.retail_anchor?.median && vgt.retail_reference_ils ? Number((100 * Math.abs(v.retail_anchor.median - vgt.retail_reference_ils) / vgt.retail_reference_ils).toFixed(1)) : null,
    // performance and cost
    market_data_latency_ms: price?.timings?.market_data_ms ?? null,
    valuation_latency_ms: price?.timings?.total_ms ?? null,
    total_latency_ms: timings.total_ms ?? null,
    within_8s: typeof timings.total_ms === 'number' ? timings.total_ms <= 8000 : null,
    cost_usd: price?.calls?.cost_usd ?? null,
    failure: null,
  };
}

/** The ONE primary failure class of a row that fell short, or null when it did not. */
export function classifyFailure(row) {
  return failureOf(row).primary;
}
/** Primary and, where one stands behind it, secondary failure classes. */
export function failureOf(row) {
  const primary = primaryFailure(row);
  const secondary = primary && primary !== 'CALIBRATION' && row.limitation === 'no_calibrated_resale_factor' ? 'CALIBRATION' : null;
  return { primary, secondary };
}
function primaryFailure(row) {
  const cohort = row.cohort;
  if (!row.engine_ok) return 'PHOTO_PIPELINE';
  if (!row.brand_correct) return 'RECOGNITION_BRAND';
  // A follow-up asked of an obvious item explains the missing model: it is the cause, not the model.
  if (row.unnecessary_followup) return 'UNNECESSARY_FOLLOWUP';
  if (row.model_correct === false || row.must_not_be_respected === false) return 'RECOGNITION_MODEL';
  if (!row.configuration_correct) return 'RECOGNITION_CONFIGURATION';
  if (row.decision !== 'SEARCH_NOW') return null;                       // nothing further was asked of the engine
  if (cohort === COHORT.D || cohort === COHORT.C) return null;          // pricing is not the question for these cohorts
  if (row.valuation_available) return null;
  if (row.provider_failures > 0 && row.raw_results === 0) return 'PROVIDER_FAILURE';
  if (row.provider_timeouts > 0 && row.raw_results === 0) return 'TIMEOUT';
  if (row.market_identity_correct === false) return 'MARKET_IDENTITY';
  if (row.raw_results === 0 || (row.exact_product_observations === 0 && row.retail_anchor_coverage === 0)) return 'DISCOVERY_COVERAGE';
  if (row.normalized_observations === 0) return 'NORMALIZATION';
  // No used listing reached the engine, local or abroad: discovery is the primary cause, whatever the valuation said afterwards.
  if (row.local_used_coverage === 0 && row.international_used_coverage === 0) return 'DISCOVERY_COVERAGE';
  if (row.qualified_exact_comparables === 0 && row.exact_product_observations > 0 && row.local_used_coverage > 0) return 'QUALIFICATION';
  if (row.fx_status === 'FAILED' && row.international_used_coverage > 0) return 'FX';
  if (row.limitation === 'no_calibrated_resale_factor') return 'CALIBRATION';
  if (row.limitation === 'guard_declined_the_market_price' || row.limitation === 'estimate_not_below_retail') return 'VALUATION';
  if (row.limitation === 'no_retail_anchor') return 'DISCOVERY_COVERAGE';
  return 'OTHER';
}

// ── COHORT SUMMARIES ────────────────────────────────────────────────────────
const frac = (list, f) => ({ n: list.filter(f).length, of: list.length, pct: list.length ? Number((100 * list.filter(f).length / list.length).toFixed(1)) : null });

export function summarizeCohort(rows) {
  const r = rows;
  const measured = r.filter((x) => x.engine_ok);
  return {
    n: r.length,
    recognition: {
      brand_correct: frac(r, (x) => x.brand_correct),
      exact_model_correct: frac(r, (x) => x.exact_model_correct === true),
      model_correct_or_acceptable: frac(r, (x) => x.model_correct === true),
      configuration_correct: frac(r, (x) => x.configuration_correct),
      unnecessary_followup: frac(r, (x) => x.unnecessary_followup),
      decision_as_expected: frac(r.filter((x) => x.decision_as_expected !== null), (x) => x.decision_as_expected),
      must_not_be_respected: frac(r.filter((x) => x.must_not_be_respected !== null), (x) => x.must_not_be_respected),
      identity_latency_ms: percentiles(measured.map((x) => x.identity_latency_ms)),
    },
    market_data: {
      market_identity_correct: frac(r.filter((x) => x.market_identity_correct !== null), (x) => x.market_identity_correct),
      local_used_coverage: frac(r, (x) => x.local_used_coverage > 0),
      international_used_coverage: frac(r, (x) => x.international_used_coverage > 0),
      retail_anchor_coverage: frac(r, (x) => x.retail_anchor_coverage > 0),
      qualified_evidence_coverage: frac(r, (x) => x.qualified_exact_comparables > 0),
      distinct_sources: percentiles(r.map((x) => x.distinct_sources)),
    },
    valuation: {
      available: frac(r, (x) => x.valuation_available),
      verified_local: frac(r, (x) => x.valuation_state === 'VERIFIED_MARKET_VALUE' || x.valuation_state === 'USED_EVIDENCE_ESTIMATE'),
      verified_used: frac(r, (x) => x.valuation_tier === 'VERIFIED_USED_MARKET'),
      market_informed_estimate: frac(r, (x) => x.valuation_state === 'MARKET_INFORMED_ESTIMATE'),
      below_quorum: frac(r, (x) => x.valuation_state === 'USED_EVIDENCE_BELOW_QUORUM'),
      insufficient: frac(r, (x) => x.valuation_tier === 'INSUFFICIENT_EVIDENCE'),
      error_pct: percentiles(r.map((x) => x.percentage_error)),
      scorable_rows: r.filter((x) => x.reference_ils !== null).length,
    },
    performance: {
      total_latency_ms: percentiles(measured.map((x) => x.total_latency_ms)),
      market_data_latency_ms: percentiles(measured.map((x) => x.market_data_latency_ms)),
      within_8s: frac(measured.filter((x) => x.within_8s !== null), (x) => x.within_8s),
      cost_usd: Number(r.reduce((n, x) => n + (x.cost_usd ?? 0), 0).toFixed(3)),
    },
    failures: Object.fromEntries(FAILURE.map((f) => [f, r.filter((x) => x.failure === f).length]).filter(([, n]) => n > 0)),
    failed_items: r.filter((x) => x.failure).map((x) => ({ id: x.id, failure: x.failure })),
  };
}

/** The report: per-item rows with their failure class, and one summary per cohort. Never one number across cohorts. */
export function buildReport(rows) {
  const scored = rows.map((r) => ({ ...r, ...(() => { const f = failureOf(r); return { failure: f.primary, secondary_failure: f.secondary }; })() }));
  const cohorts = {};
  for (const c of Object.values(COHORT)) {
    const mine = scored.filter((r) => r.cohort === c);
    if (mine.length) cohorts[c] = { name: COHORT_NAME[c], ...summarizeCohort(mine) };
  }
  return { items_measured: scored.length, cohorts, rows: scored };
}

// ── EXPERIMENTS ─────────────────────────────────────────────────────────────
/** The misses the second-profile experiment runs on: identity right, evidence insufficient, cohort A or B. */
export function missesOf(rows) {
  return rows.filter((r) => (r.cohort === COHORT.A || r.cohort === COHORT.B) && r.recognition_correct && r.decision === 'SEARCH_NOW' && !r.valuation_available).map((r) => r.id);
}
/** Incremental effect of a variant run over a baseline, item by item and in total. */
export function compareRuns(baselineRows, variantRows) {
  const base = new Map(baselineRows.map((r) => [r.id, r]));
  const keys = ['raw_results', 'normalized_observations', 'exact_product_observations', 'qualified_exact_comparables', 'distinct_sources', 'local_used_coverage', 'international_used_coverage', 'retail_anchor_coverage'];
  const items = variantRows.filter((v) => base.has(v.id)).map((v) => {
    const b = base.get(v.id);
    const delta = Object.fromEntries(keys.map((k) => [k, (v[k] ?? 0) - (b[k] ?? 0)]));
    return { id: v.id, delta, new_valuation: !b.valuation_available && v.valuation_available, added_latency_ms: (v.market_data_latency_ms ?? 0) - (b.market_data_latency_ms ?? 0), added_cost_usd: Number(((v.cost_usd ?? 0) - (b.cost_usd ?? 0)).toFixed(4)) };
  });
  const sum = (f) => items.reduce((n, i) => n + f(i), 0);
  return {
    items: items.length, per_item: items,
    totals: Object.fromEntries(keys.map((k) => [`new_${k}`, sum((i) => i.delta[k])])),
    new_valuations: sum((i) => (i.new_valuation ? 1 : 0)),
    added_latency_ms: percentiles(items.map((i) => i.added_latency_ms)),
    added_cost_usd: Number(sum((i) => i.added_cost_usd).toFixed(4)),
  };
}

// ── READINESS ───────────────────────────────────────────────────────────────
const MAGIC = [[0xFF, 0xD8, 0xFF], [0x89, 0x50, 0x4E, 0x47], [0x52, 0x49, 0x46, 0x46]];
const REQUIRED_ITEM_FIELDS = ['benchmark_id', 'cohort', 'category', 'subcategory', 'photo', 'identity', 'condition', 'expected_recognition', 'market_identity', 'special_case', 'ground_truth_source', 'valuation_ground_truth'];

/** Is the dataset ready for a live run? One verdict per item; photographs are read with `readFile`. */
export function datasetReadiness(manifest, { readFile } = {}) {
  const items = (manifest.items ?? []).map((item) => {
    const problems = [];
    for (const k of REQUIRED_ITEM_FIELDS) if (item[k] === undefined || item[k] === null) problems.push(`missing ${k}`);
    if (!Object.values(COHORT).includes(item.cohort)) problems.push('cohort not A-D');
    if (!SPECIAL_CASE.includes(item.special_case)) problems.push('special_case unknown');
    const exp = item.expected_recognition ?? {};
    if ([exp.exact_model_expected, exp.family_only_acceptable, exp.generic_only_acceptable].filter((x) => x === true).length !== 1) problems.push('expected recognition level must name exactly one of exact / family / generic');
    const vgt = item.valuation_ground_truth ?? {};
    if (!Object.keys(GT_CLASS).includes(vgt.class)) problems.push('valuation ground-truth class not A-E');
    if (SCORABLE_GT.has(vgt.class) && !(vgt.reference_ils > 0)) problems.push(`class ${vgt.class} needs a reference value`);
    const id = item.identity ?? {};
    if (item.cohort !== COHORT.C && !id.brand && item.special_case !== 'multiple_objects') problems.push('identity.brand unknown');
    if (exp.exact_model_expected && !id.exact_model) problems.push('identity.exact_model unknown while exact model is expected');
    if (!id.configuration) problems.push('identity.configuration unknown');
    if (!item.ground_truth_source || /^pending/i.test(item.ground_truth_source)) problems.push('ground truth not yet confirmed by a person');
    let photo = { present: false, loads: false, bytes: 0, sha256: null };
    try {
      const buf = readFile ? readFile(item.photo?.photo_path_resolved ?? item.photo?.photo_path) : null;
      if (buf) {
        const head = [...buf.subarray(0, 4)];
        const loads = buf.length >= 512 && MAGIC.some((m) => m.every((b, i) => head[i] === b));
        photo = { present: true, loads, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), followup_sha256: null };
        const fp = item.photo?.followup_photo_path_resolved ?? item.photo?.followup_photo_path;
        if (fp) { try { const fb = readFile(fp); if (fb) photo.followup_sha256 = createHash('sha256').update(fb).digest('hex'); else problems.push('follow-up photograph missing'); } catch { problems.push('follow-up photograph missing'); } }
        if (!loads) problems.push('photograph does not load as a JPEG, PNG or WEBP');
      } else problems.push('photograph missing');
    } catch { problems.push('photograph missing'); }
    return { id: item.benchmark_id, cohort: item.cohort, photo, problems, ready: problems.length === 0 };
  });
  return {
    items_total: items.length, ready: items.length > 0 && items.every((i) => i.ready),
    ready_items: items.filter((i) => i.ready).length,
    photos_present: items.filter((i) => i.photo.present).length, photos_loading: items.filter((i) => i.photo.loads).length,
    missing_photos: items.filter((i) => !i.photo.present).map((i) => i.id),
    hashes: Object.fromEntries(items.filter((i) => i.photo.sha256).map((i) => [i.id, i.photo.followup_sha256 ? { photo: i.photo.sha256, followup: i.photo.followup_sha256 } : i.photo.sha256])),
    items,
  };
}
