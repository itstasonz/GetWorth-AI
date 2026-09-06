#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN-015 — recognition benchmark.
//
// Purpose: make recognition quality a NUMBER that moves between commits, so an
// accuracy change can be proven rather than asserted. Run it before and after a
// recognition change and diff the two JSON reports.
//
//   node scripts/recognition-benchmark.mjs                 # human-readable
//   node scripts/recognition-benchmark.mjs --json          # machine-diffable
//   node scripts/recognition-benchmark.mjs --json > docs/baselines/x.json
//   node scripts/recognition-benchmark.mjs --filter mouse  # subset by id
//
// ── Two tiers, and why ────────────────────────────────────────────────────────
// TIER 1 — IDENTITY (offline). Needs no credentials, no network, no images, so
//   it runs anywhere including CI and is the tier that gates commits. It scores
//   the identity layer directly:
//
//     convergence — every spelling of ONE product must produce ONE key.
//                   Under-merging fragments catalog matches, price history and
//                   the learning loop across spellings of the same item.
//     separation  — genuinely different products must keep DIFFERENT keys.
//                   Over-merging is worse than under-merging: it silently
//                   prices a G502 X Plus as a G502.
//
//   These two pull in opposite directions on purpose. Normalization that only
//   chases convergence starts merging siblings, and the separation score is
//   what catches that. Report both or neither.
//
// TIER 2 — PIPELINE (live). Per-stage latency and end-to-end recognition
//   accuracy against fixture photos. Requires ANTHROPIC_API_KEY and fixture
//   images, and costs real money per run. It SKIPS rather than fails when
//   either is absent, so tier 1 stays runnable on every machine.
//
// Adding a case is a data edit to tests/fixtures/recognition/cases.json - never
// a change to this file.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CASES_PATH = join(ROOT, 'tests/fixtures/recognition/cases.json');
const FIXTURE_DIR = join(ROOT, 'tests/fixtures/recognition');

const JSON_OUT = process.argv.includes('--json');
const filterIdx = process.argv.indexOf('--filter');
const FILTER = filterIdx > -1 ? process.argv[filterIdx + 1] : null;

const { buildRecognitionMemoryKey, MEMORY_KEY_VERSION } =
  await import(new URL('../api/_lib/recognition-memory.js', import.meta.url).href);

const { cases } = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
const selected = FILTER ? cases.filter((c) => c.id.includes(FILTER)) : cases;

const keyOf = (category, brand, model) => {
  const r = buildRecognitionMemoryKey({ category, brand, model });
  return r?.ok ? r.key : null;
};

// ── TIER 1 ────────────────────────────────────────────────────────────────────
const results = [];

for (const c of selected) {
  // The control case carries no identity by design; scoring it would invent one.
  if (!c.brand || !c.model) {
    results.push({ id: c.id, product_type: c.product_type, skipped: 'no identity (control case)' });
    continue;
  }

  // CONVERGENCE — the cross product of brand and model spellings should be one key.
  const brands = c.brand_variants?.length ? c.brand_variants : [c.brand];
  const models = c.model_variants?.length ? c.model_variants : [c.model];
  const keys = new Map();
  for (const b of brands) {
    for (const m of models) {
      const k = keyOf(c.category, b, m);
      if (!keys.has(k)) keys.set(k, []);
      keys.get(k).push(`${b} / ${m}`);
    }
  }
  const total = brands.length * models.length;
  const distinct = keys.size;
  // 1.0 when every spelling agrees; approaches 0 as the identity fragments.
  const convergence = total <= 1 ? 1 : (total - distinct) / (total - 1);

  // SEPARATION — the canonical key must differ from each sibling's key.
  const canonical = keyOf(c.category, c.brand, c.model);
  const collisions = [];
  for (const d of c.distinct_from || []) {
    const dk = keyOf(c.category, d.brand ?? c.brand, d.model);
    if (dk === canonical) collisions.push(`${d.brand ?? c.brand} ${d.model}`);
  }
  const siblings = (c.distinct_from || []).length;
  const separation = siblings === 0 ? null : (siblings - collisions.length) / siblings;

  results.push({
    id: c.id, product_type: c.product_type, category: c.category,
    canonical_key: canonical,
    convergence: Number(convergence.toFixed(3)),
    distinct_keys: distinct, spellings: total,
    fragments: distinct > 1 ? [...keys.entries()].map(([k, v]) => ({ key: k, from: v })) : [],
    separation: separation === null ? null : Number(separation.toFixed(3)),
    collisions,
  });
}

const scored = results.filter((r) => !r.skipped);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const convergenceMean = mean(scored.map((r) => r.convergence));
const separationMean = mean(scored.filter((r) => r.separation !== null).map((r) => r.separation));

// ── TIER 1b — RANKING (offline) ───────────────────────────────────────────────
// Measures top-1 retrieval accuracy under the two pressures that actually cause
// wrong identities in production:
//
//   1. a SIBLING found by strategy 3a, which strips a variant suffix and so
//      matches "G502 X Plus" for a "G502 Hero" query, carrying a 0.85 constant;
//   2. a SEMANTIC decoy whose real cosine (unbounded above 0.60) can exceed
//      every catalog constant.
//
// Both scored on ONE flat axis before SCAN-016, so the decoys outranked the
// truth. The OLD column below recomputes that flat sort on the same synthetic
// rows, so before/after is reproduced on every run rather than remembered.
const { rankCandidates } = await import(new URL('../api/analyze.js', import.meta.url).href);

const rankingResults = [];
for (const c of selected) {
  if (!c.brand || !c.model) continue;

  // The true row is deliberately given the WEAKEST plausible provenance
  // (found only as a secondary model candidate, 0.72) while the decoys get the
  // strongest constants. If ranking is correct, evidence beats score anyway.
  const truth = { id: 'truth', brand: c.brand, model: c.model, similarity: 0.72,
                  _source: 'model_candidates', _evidence_grade: false };
  const siblings = (c.distinct_from || []).map((d, i) => ({
    id: `sibling${i}`, brand: d.brand ?? c.brand, model: d.model, similarity: 0.85,
    _source: 'normalized_model', _evidence_grade: false,
  }));
  const decoy = { id: 'semantic', brand: c.brand, model: `${c.model} LOOKALIKE`,
                  similarity: 0.95, _source: 'vector', _evidence_grade: false };

  const pool = [...siblings, decoy, truth];

  const oldTop = [...pool].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))[0];
  const neu = rankCandidates(pool, { queryModel: c.model });

  rankingResults.push({
    id: c.id,
    old_top: oldTop.id, old_correct: oldTop.id === 'truth',
    new_top: neu.rows[0].id, new_correct: neu.rows[0].id === 'truth',
    exact_match_flag: neu.exactMatch,
    siblings_demoted: neu.rows.filter((r) => r._sibling_of).length,
  });
}

// DB-MISSING control: the scanned item is absent from the catalog entirely.
// The only rows are a sibling and a semantic decoy. Correct behaviour is
// exact_match=false, so the item becomes a candidate submission instead of
// being silently renamed to the nearest catalog product.
const dbMissing = rankCandidates([
  { id: 'sibling', brand: 'Logitech', model: 'G502 X Plus', similarity: 0.85, _source: 'normalized_model' },
  { id: 'semantic', brand: 'Logitech', model: 'G903', similarity: 0.96, _source: 'vector' },
], { queryModel: 'G900 Chaos Spectrum' });

const oldRankAcc = rankingResults.length
  ? rankingResults.filter((r) => r.old_correct).length / rankingResults.length : null;
const newRankAcc = rankingResults.length
  ? rankingResults.filter((r) => r.new_correct).length / rankingResults.length : null;

// ── TIER 2 preflight ──────────────────────────────────────────────────────────
const withImages = selected.filter((c) => c.image && existsSync(join(FIXTURE_DIR, c.image)));
const tier2 = {
  runnable: Boolean(process.env.ANTHROPIC_API_KEY) && withImages.length > 0,
  anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
  google_vision_key: Boolean(process.env.GOOGLE_VISION_API_KEY),
  voyage_key: Boolean(process.env.VOYAGE_API_KEY),
  fixtures_present: withImages.length,
  fixtures_expected: selected.length,
  skipped_reason: null,
};
if (!tier2.runnable) {
  tier2.skipped_reason = !process.env.ANTHROPIC_API_KEY
    ? 'ANTHROPIC_API_KEY not set'
    : 'no fixture images present';
}

const report = {
  generated_at: new Date().toISOString(),
  memory_key_version: MEMORY_KEY_VERSION,
  tier1: {
    cases_scored: scored.length,
    cases_skipped: results.length - scored.length,
    convergence_mean: convergenceMean === null ? null : Number(convergenceMean.toFixed(3)),
    separation_mean: separationMean === null ? null : Number(separationMean.toFixed(3)),
    fully_converged: scored.filter((r) => r.convergence === 1).length,
    fully_separated: scored.filter((r) => r.separation === 1).length,
    results,
  },
  tier1b_ranking: {
    cases: rankingResults.length,
    top1_flat_sort: oldRankAcc === null ? null : Number(oldRankAcc.toFixed(3)),
    top1_evidence_class: newRankAcc === null ? null : Number(newRankAcc.toFixed(3)),
    db_missing_control: {
      exact_match: dbMissing.exactMatch,
      correct: dbMissing.exactMatch === false,
    },
    results: rankingResults,
  },
  tier2,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ── Human-readable ────────────────────────────────────────────────────────────
const pct = (n) => (n === null ? '  n/a' : `${(n * 100).toFixed(1)}%`.padStart(6));
console.log('\nRECOGNITION BENCHMARK — tier 1 (identity, offline)\n');
console.log('  ' + 'case'.padEnd(38) + 'conv'.padStart(7) + 'sep'.padStart(8) + '  notes');
console.log('  ' + '─'.repeat(76));
for (const r of results) {
  if (r.skipped) {
    console.log('  ' + r.id.padEnd(38) + '     —'.padStart(7) + '       —' + `  ${r.skipped}`);
    continue;
  }
  const notes = [];
  if (r.convergence < 1) notes.push(`${r.distinct_keys} identities for 1 product`);
  if (r.collisions.length) notes.push(`MERGED WITH ${r.collisions.join(', ')}`);
  console.log('  ' + r.id.padEnd(38) + pct(r.convergence).padStart(7) + pct(r.separation).padStart(8) +
    (notes.length ? `  ${notes.join('; ')}` : ''));
}
console.log('  ' + '─'.repeat(76));
console.log('  ' + 'MEAN'.padEnd(38) + pct(convergenceMean).padStart(7) + pct(separationMean).padStart(8));
console.log(`\n  convergence  ${report.tier1.fully_converged}/${scored.length} products have a single identity across their spellings`);
console.log(`  separation   ${report.tier1.fully_separated}/${scored.filter((r) => r.separation !== null).length} products stay distinct from their siblings`);

console.log('\nRECOGNITION BENCHMARK — tier 1b (ranking, offline)\n');
console.log('  Top-1 accuracy with a 0.85 sibling and a 0.95 semantic decoy in the pool,');
console.log('  where the true row is deliberately the weakest-scoring candidate (0.72).\n');
const failing = rankingResults.filter((r) => !r.new_correct);
console.log(`  flat similarity sort (before)  ${pct(oldRankAcc)}   ${rankingResults.filter((r) => r.old_correct).length}/${rankingResults.length} correct`);
console.log(`  evidence-class ranking (after) ${pct(newRankAcc)}   ${rankingResults.filter((r) => r.new_correct).length}/${rankingResults.length} correct`);
if (failing.length) {
  console.log(`\n  still wrong: ${failing.map((r) => `${r.id} -> ${r.new_top}`).join(', ')}`);
}
console.log(`\n  DB-missing control: exact_match=${dbMissing.exactMatch} ` +
  `${dbMissing.exactMatch === false ? 'PASS — item stays unmatched, becomes a candidate' : 'FAIL — nearest row adopted as identity'}`);

console.log('\nRECOGNITION BENCHMARK — tier 2 (live pipeline)\n');
if (tier2.runnable) {
  console.log(`  ready: ${tier2.fixtures_present}/${tier2.fixtures_expected} fixtures, keys present`);
  console.log('  (live stage timing not yet implemented — see SCAN-015)');
} else {
  console.log(`  SKIPPED — ${tier2.skipped_reason}`);
  console.log(`  fixtures ${tier2.fixtures_present}/${tier2.fixtures_expected}` +
    `  ANTHROPIC_API_KEY=${tier2.anthropic_key}  GOOGLE_VISION_API_KEY=${tier2.google_vision_key}` +
    `  VOYAGE_API_KEY=${tier2.voyage_key}`);
  console.log('  Tier 2 is skipped, not failed: tier 1 must stay runnable without credentials.');
}
console.log('');
