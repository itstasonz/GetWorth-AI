#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — REAL-PHOTOGRAPH BENCHMARK (development only, BILLED)
//
//   node scripts/scan-v2-benchmark.mjs --manifest <file.json> --dry
//   node --env-file=.env.local scripts/scan-v2-benchmark.mjs --manifest <file.json> [--identify-only] [--only <id>] [--out <dir>]
//
// Runs the V2 engine itself — runV2Identify and runV2Price, the functions the
// two endpoints call — over real photographs, and records for each item what
// the product gate asks for: identity, time to identity, the sufficiency
// decision, the follow-up, search time, real sources, admitted listings, the
// price state and price, total latency, and the number of provider calls.
//
// BILLED. Per item: one identity call, one more when a follow-up photograph is
// supplied and asked for, and one search call when the gate says SEARCH_NOW.
// `--identify-only` stops after identity (no search call at all), which is the
// cheapest way to measure time-to-identity. `--dry` makes no call.
//
// The manifest is a JSON array:
//   { "id": "ninja", "label": "Ninja blender", "photo": "path.jpg",
//     "followup_photo": "label.jpg" | null,
//     "expect": { "brand": "Ninja", "model": "Power Blender Duo Pro", "decision": "SEARCH_NOW" } }
// See tests/fixtures/scan-v2/benchmark.example.json for the ten-item template.
//
// Photographs are sent as they are on disk. The PWA compresses to 1280px at
// 0.82 before upload; use photographs of about that size for comparable times.
//
// The key is read from the environment by the engine and is never printed.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { runV2Identify, runV2Price } from '../api/_lib/v2/scan.js';
import { resolveV2Model, V2_KEY_ENV } from '../api/_lib/v2/config.js';
import { DECISION } from '../api/_lib/v2/sufficiency.js';
import { describeSearch, describeEvidence } from '../api/_lib/v2/report.js';

const argv = process.argv.slice(2);
const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const dry = argv.includes('--dry');
const identifyOnly = argv.includes('--identify-only');
const only = flag('--only');
const outDir = flag('--out');
const manifestPath = flag('--manifest');
if (!manifestPath) { process.stderr.write('--manifest <file.json> is required.\n'); process.exit(2); }

const base = dirname(resolve(manifestPath));
const items = JSON.parse(readFileSync(manifestPath, 'utf8')).filter((i) => !only || i.id === only);
const at = (p) => (p ? resolve(base, p) : null);

// USD per million tokens, and per search action, as scripts/retrieval-experiment.mjs records them.
const RATE = { input: 0.20, output: 1.20, search_action: 0.01 };
const cost = (usage) => (usage ? ((usage.input_tokens ?? 0) * RATE.input + (usage.output_tokens ?? 0) * RATE.output) / 1e6 : 0);

const missing = items.flatMap((i) => [i.photo, i.followup_photo].filter(Boolean).map(at).filter((p) => !existsSync(p)));
if (dry) {
  process.stdout.write(`${JSON.stringify({
    model: resolveV2Model(process.env),
    items: items.map((i) => ({
      id: i.id, label: i.label, photo: i.photo ?? null, followup_photo: i.followup_photo ?? null,
      max_billed_calls: i.photo ? 1 + (i.followup_photo ? 1 : 0) + (identifyOnly ? 0 : 1) : 0,
    })),
    items_without_a_photo: items.filter((i) => !i.photo).map((i) => i.id),
    photographs_not_found: missing,
  }, null, 2)}\n`);
  process.exit(0);
}
if (missing.length) { process.stderr.write(`Photographs not found:\n  ${missing.join('\n  ')}\n`); process.exit(2); }
const apiKey = process.env[V2_KEY_ENV];
if (!apiKey) { process.stderr.write(`${V2_KEY_ENV} is not set.\n`); process.exit(3); }

const model = resolveV2Model(process.env);
const load = (p) => readFileSync(p).toString('base64');
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const stateOf = (r) => ({ identity: r.identity, sufficiency: r.sufficiency, followups_used: r.followups_used });

const records = [];
for (const item of items) {
  if (!item.photo) { records.push({ id: item.id, label: item.label, skipped: 'no photograph in the manifest' }); continue; }
  const t0 = Date.now();
  const rec = { id: item.id, label: item.label, model, ai_calls: 0, search_calls: 0, cost_usd: 0 };

  let step = await runV2Identify({ image: load(at(item.photo)), language: 'he', model, apiKey });
  rec.ai_calls += 1;
  rec.cost_usd += cost(step.calls.usage);
  rec.time_to_identity_ms = step.timings.identity_complete_ms;
  rec.identity_first_event_ms = step.timings.identity_first_event_ms ?? null;
  rec.identity_tokens = step.calls.usage;
  if (!step.ok) { rec.failure = `identity: ${step.failure}`; records.push(rec); continue; }
  rec.first_decision = step.sufficiency.decision;
  rec.followup_requested = step.sufficiency.followup ?? null;

  if (step.sufficiency.decision === DECISION.NEED_FOLLOWUP && item.followup_photo) {
    const second = await runV2Identify({ image: load(at(item.followup_photo)), priorState: stateOf(step), language: 'he', model, apiKey });
    rec.ai_calls += 1;
    rec.cost_usd += cost(second.calls.usage);
    rec.followup_identity_ms = second.timings.identity_complete_ms;
    if (!second.ok) { rec.failure = `follow-up identity: ${second.failure}`; records.push(rec); continue; }
    step = second;
  }
  const id = step.identity;
  rec.identity = {
    brand: id.brand, model: id.model, variant: id.variant, object_class: id.object_class, local_name: id.local_name,
    candidates: id.ranked_candidates, visible_text: id.visible_text, condition: id.condition.grade, missing_evidence: id.missing_evidence,
  };
  rec.decision = step.sufficiency.decision;
  rec.level = step.sufficiency.level;
  rec.reasons = step.sufficiency.reasons;
  rec.followups_used = step.followups_used;
  if (item.expect) {
    rec.identity_correct = {
      brand: item.expect.brand === undefined ? null : same(id.brand.value, item.expect.brand),
      model: item.expect.model === undefined ? null : same(id.model.value, item.expect.model),
      decision: item.expect.decision === undefined ? null : rec.first_decision === item.expect.decision,
    };
  }

  if (!identifyOnly) {
    const priced = await runV2Price({ state: stateOf(step), model, apiKey });
    rec.search_calls += priced.calls.search;
    rec.cost_usd += cost(priced.calls.usage) + priced.calls.search * RATE.search_action;
    const search = describeSearch(priced.plan, priced.search);
    const evidence = describeEvidence(priced.evidence);
    rec.search_ms = priced.timings.search_complete_ms !== undefined
      ? priced.timings.search_complete_ms - priced.timings.search_start_ms : null;
    rec.search_results_available_ms = priced.search?.timings?.results_available_ms ?? null;
    rec.search = { outcome: search.outcome, failure: search.failure, queries: search.planned_queries.map((q) => q.text), results: search.results, domains: search.domains };
    rec.evidence = evidence ? { counts: evidence.counts, set_failures: evidence.set_failures, admitted: evidence.admitted, timings: evidence.timings } : null;
    rec.price_state = priced.valuation.state;
    rec.price = { low: priced.valuation.low, recommended: priced.valuation.recommended, high: priced.valuation.high, basis: priced.valuation.basis, reason: priced.valuation.reason };
  }
  rec.total_latency_ms = Date.now() - t0;
  rec.cost_usd = Number(rec.cost_usd.toFixed(5));
  records.push(rec);
  process.stderr.write(`${item.id}: ${rec.decision} ${rec.price_state ?? ''} ${rec.total_latency_ms}ms\n`);
}

const done = records.filter((r) => r.time_to_identity_ms !== undefined).map((r) => r.time_to_identity_ms).sort((a, b) => a - b);
const median = done.length === 0 ? null
  : (done.length % 2 ? done[(done.length - 1) / 2] : Math.round((done[done.length / 2 - 1] + done[done.length / 2]) / 2));
const out = {
  model,
  items: records.length,
  median_time_to_identity_ms: median,
  identity_over_8s: records.filter((r) => (r.time_to_identity_ms ?? 0) > 8000).map((r) => r.id),
  total_cost_usd: Number(records.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(5)),
  records,
};
const text = JSON.stringify(out, null, 2);
if (outDir) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, 'scan-v2-benchmark.json'), text); }
process.stdout.write(`${text}\n`);
