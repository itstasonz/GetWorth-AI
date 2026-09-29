#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// TEMPORARY — TEXT-ONLY RECALL BENCHMARK (development only, delete after use)
//
//   node --env-file=.env.local scripts/recall-benchmark.mjs --identity <file.json> --out <dir>
//   node scripts/recall-benchmark.mjs --identity <file.json> --dry
//
// Runs the market half of Phase B exactly as the pipeline runs it, from a
// structured identity instead of a photograph:
//
//   identity -> REAL query generator (B3) -> server query plan
//            -> REAL web search (B4) -> result preservation -> extraction
//            -> provenance binding -> normalisation -> qualification -> valuation
//
// TWO billed calls: one query-generation call and one research call. No image,
// no Phase A, no identity call, no condition call. Nothing here writes a query,
// names a marketplace, or supplies a listing URL: every function below is the
// one runPhaseB calls, with the arguments runPhaseB gives it.
//
// The identity file is `{ identity: <IDENTITY_SCHEMA shape>, ocr: [..] }` — what
// recognition would hand the market stage. The key is never read here.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { callStructured, createCallLedger } from '../api/_lib/phaseb/openai-client.js';
import { MARKET_QUERY_SCHEMA } from '../api/_lib/phaseb/schemas.js';
import { buildMarketQueryPrompt } from '../api/_lib/phaseb/prompts.js';
import {
  STAGE_TIMEOUT_MS, STAGE_MAX_OUTPUT_TOKENS, resolveEnrichmentModel, resolveMarketRegion, ENRICHMENT_KEY_ENV,
} from '../api/_lib/phaseb/config.js';
import {
  createMarketResearch, MARKET_MECHANISM, normalizeObservations, rejectOutliers, normalizeCurrency,
} from '../api/_lib/phaseb/market-research.js';
import {
  buildIdentityContext, planSearch, supportedPurposes, buildLocalQuery,
} from '../api/_lib/phaseb/identity-expansion.js';
import { providerTextOf } from '../api/_lib/phaseb/market-report.js';
import { corroborateSubject } from '../api/_lib/phaseb/validation.js';
import { buildMarketReport, concludeMarketReport } from '../api/_lib/phaseb/market-report.js';
import { computeValuationCandidate } from '../api/_lib/phaseb/valuation.js';
import { qualifyMarketEvidence } from '../api/_lib/market-evidence.js';
import { sourceSite } from '../api/_lib/source-site.js';

const argv = process.argv.slice(2);
const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const dry = argv.includes('--dry');
// --local-plan: build the query plan locally and make NO query-generation call.
const localPlan = argv.includes('--local-plan');
const outDir = flag('--out');
if (outDir) mkdirSync(outDir, { recursive: true });
const input = JSON.parse(readFileSync(flag('--identity'), 'utf8'));
const { identity, ocr = [] } = input;

const marketRegion = resolveMarketRegion();
const model = resolveEnrichmentModel(process.env);
const language = 'he';
const corroboration = corroborateSubject({ identity, ocrText: ocr, catalogCandidates: [] });
const identityContext = buildIdentityContext({ identity, existingRecognition: null, ocrText: ocr, corroboration });
const purposes = [...supportedPurposes(identityContext, { disputed: false })];
const queryPrompt = buildMarketQueryPrompt({ identity, language, market: marketRegion, context: identityContext, purposes });

if (dry) {
  process.stdout.write(`${JSON.stringify({ corroboration: corroboration.level, purposes, identityContext }, null, 2)}\n\n${queryPrompt}\n`);
  process.exit(0);
}
const apiKey = process.env[ENRICHMENT_KEY_ENV];
if (!apiKey) { process.stderr.write(`${ENRICHMENT_KEY_ENV} is not set.\n`); process.exit(3); }

const raws = {};
const spy = (name) => async (url, init) => {
  const res = await fetch(url, init);
  try {
    const j = await res.clone().json();
    raws[name] = { status: j.status ?? null, incomplete_details: j.incomplete_details ?? null, error: j.error ?? null, usage: j.usage ?? null, output: j.output ?? [] };
  } catch { raws[name] = null; }
  return res;
};
const ledger = createCallLedger();
const RATE = { input: 0.20, cached: 0.02, output: 1.20, search_action: 0.01 };
const costOf = (u) => {
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  return (((u?.input_tokens ?? 0) - cached) * RATE.input + cached * RATE.cached + (u?.output_tokens ?? 0) * RATE.output) / 1e6;
};

// ── B3 · the real query generator ────────────────────────────────────────────
const tq = Date.now();
const tqp = performance.now();
let query = null;
let rawQuery = null;
let failure = null;
try {
  if (localPlan) {
    rawQuery = buildLocalQuery(identityContext, marketRegion);
    query = planSearch(rawQuery, identityContext, { disputed: false, identity });
    throw Object.assign(new Error('local'), { local: true });
  }
  const { data } = await callStructured({
    stage: 'market_query', prompt: queryPrompt, schema: MARKET_QUERY_SCHEMA,
    schemaName: 'getworth_phaseb_market_query', model, apiKey,
    timeoutMs: STAGE_TIMEOUT_MS.market_query, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.market_query,
    reasoningEffort: 'low', ledger, fetchImpl: spy('query'),
  });
  rawQuery = data;
  query = planSearch(data, identityContext, { disputed: false, identity });
} catch (err) { if (!err?.local) failure = `market_query: ${String(err?.message ?? err).slice(0, 300)}`; }
const queryMs = localPlan ? Number((performance.now() - tqp).toFixed(3)) : Date.now() - tq;

// ── B4 · the real research adapter ───────────────────────────────────────────
const tr = Date.now();
let research = null;
if (query) {
  const adapter = createMarketResearch({
    mechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, model, apiKey, ledger, language,
    fetchImpl: spy('research'), market: marketRegion, timeoutMs: STAGE_TIMEOUT_MS.market_research,
  });
  try { research = await adapter.search(query, { identityContext }); } catch (err) {
    failure = `market_research: ${String(err?.message ?? err).slice(0, 300)}`;
  }
}
const researchMs = Date.now() - tr;

// ── B6 · exactly the pipeline's arithmetic ───────────────────────────────────
const normalized = normalizeObservations(research?.observations ?? []);
const { kept, dropped } = rejectOutliers(normalized.accepted);
const report = buildMarketReport({ research, normalized, kept, dropped, query, marketRegion, identityContext });
const market = qualifyMarketEvidence({
  observations: research?.observations ?? [], subject: identity?.subject || {}, providerText: providerTextOf(research),
});
concludeMarketReport(report, { research, qualification: market });
const grantingSet = market.qualified ? market.token : (market.comparable_qualified ? market.comparable_token : null);
const valuation = grantingSet
  ? computeValuationCandidate({
    accepted: rejectOutliers(grantingSet.observations).kept, condition: null,
    identityConfidence: identity?.confidence?.overall ?? 0, specificity: query?.specificity ?? null,
  })
  : null;

if (outDir) {
  writeFileSync(join(outDir, 'raw.json'), JSON.stringify({ queryPrompt, raws }, null, 2));
}
const searchActions = (raws.research?.output ?? []).filter((i) => i?.type === 'web_search_call' && i?.action?.type === 'search').length;
const all = [...(research?.observations ?? []), ...(research?.unbound ?? []).map((u) => u.observation)];
const out = {
  FAILURE: failure,
  QUERY_PLAN_SOURCE: localPlan ? 'LOCAL deterministic builder (no provider call)' : 'AI query generator',
  MODEL: model,
  CORROBORATION: corroboration.level,
  PURPOSES_SUPPORTED: purposes,
  GETWORTH_GENERATED_QUERIES_RAW: rawQuery?.queries ?? null,
  GETWORTH_QUERY_PLAN: query?.queries ?? null,
  QUERIES_DROPPED_BY_SERVER: query?.queries_dropped ?? null,
  SPECIFICITY: query?.specificity ?? null,
  OPENAI_EXECUTED_QUERIES: research?.provenance?.queries ?? [],
  SEARCH_ACTION_COUNT: searchActions,
  PAGE_OPEN_ACTIONS: research?.provenance?.pages_opened?.length ?? 0,
  SOURCE_COUNT: research?.provenance?.sources?.length ?? 0,
  SOURCE_DOMAINS: research?.provenance?.source_domains ?? [],
  RESULTS_WITH_TEXT: (research?.provenance?.results ?? []).filter((r) => r.text).length,
  RESULTS: (research?.provenance?.results ?? []).map((r) => ({ url: r.url, title: r.title, chars: r.text?.length ?? 0 })),
  IDENTITY_DISCOVERY: (research?.identity_discovery?.claims ?? []).map((c) => `${c.kind}: ${c.value} @ ${c.source_domains.join(',')}${c.corroborated ? ' (2+ domains)' : ''}`),
  OBSERVATIONS_EXTRACTED: all.length,
  OBSERVATIONS: (research?.observations ?? []).map((o, i) => ({
    domain: o.source_domain, url: o.source, title: String(o.title ?? '').slice(0, 90), price: o.observed_price,
    currency_raw: o.currency, currency: normalizeCurrency(o.currency), kind: o.listing_kind, condition: o.condition,
    listing_model: o.match?.model ?? null, match: o.match?.confidence ?? null,
    binding: research.binding_levels?.[i]?.level, content_reason: research.binding_levels?.[i]?.content_reason,
  })),
  UNBOUND: (research?.unbound ?? []).map((u) => ({ domain: u.observation?.source_domain, url: u.observation?.source, title: u.observation?.title, reason: u.reason })),
  DOMAIN_BOUND: research?.bindings?.domain ?? 0,
  URL_BOUND: research?.bindings?.url ?? 0,
  CONTENT_BOUND: research?.bindings?.content ?? 0,
  PHASE_B_FILTER: { accepted: kept.length, rejected: [...normalized.rejected, ...dropped].map((r) => `${r.observation?.source_domain}: ${r.reason}`), context_only: normalized.context.length },
  ADMITTED: market.counts.admitted,
  ADMITTED_LISTINGS: market.admitted.map((a) => ({
    site: a.source_site, host: a.source_domain, listing_id: a.listing_id, canonical_url: a.canonical_url,
    duplicate_key: a.duplicate_key, price: a.normalized_ils_price, location: a.location,
    title: String(a.title ?? '').slice(0, 70), match: a.identity_match?.method, tokens: a.identity_match?.matched_tokens,
  })),
  ALIASES_DERIVED: market.vocabulary.aliases.map((a) => `${a.alias} = ${a.canonical} (${a.sites.length} sites)`),
  REJECTED: market.disqualified.length,
  REJECTION_REASONS: market.disqualified.map((d) => `${d.observation?.source_domain}: ${d.reason} — ${String(d.observation?.title ?? '').slice(0, 60)}`),
  SET_FAILURES: market.set_failures,
  DISTINCT_ADMITTED_SOURCE_SITES: [...new Set(market.admitted.map((a) => a.source_site))],
  SOURCE_SITES_REACHED: [...new Set((research?.provenance?.sources ?? []).map((u) => sourceSite(u)).filter(Boolean))],
  VERIFIED_MARKET: market.qualified === true,
  MARKET_OUTCOME: report.outcome,
  VALUATION: valuation ? { status: valuation.status, low: valuation.low, mid: valuation.mid, high: valuation.high, currency: valuation.currency, sample_size: valuation.sample_size, note: 'condition not applied: no photograph in a text-only run' } : null,
  DIAGNOSTICS: report.diagnostics,
  NOTES: research?.notes ?? null,
  QUERY_LATENCY_MS: queryMs,
  RESEARCH_LATENCY_MS: researchMs,
  TOTAL_LATENCY_MS: queryMs + researchMs,
  USAGE: { query: raws.query?.usage ?? null, research: raws.research?.usage ?? null },
  COST: {
    query_model: Number(costOf(raws.query?.usage).toFixed(5)),
    research_model: Number(costOf(raws.research?.usage).toFixed(5)),
    search_tool: Number((searchActions * RATE.search_action).toFixed(5)),
    total: Number((costOf(raws.query?.usage) + costOf(raws.research?.usage) + searchActions * RATE.search_action).toFixed(5)),
  },
  CALLS: ledger.summary(),
};
const text = JSON.stringify(out, null, 2);
if (outDir) writeFileSync(join(outDir, 'summary.json'), text);
process.stdout.write(`${text}\n`);
