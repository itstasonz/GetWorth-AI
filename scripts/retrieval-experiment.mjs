#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// TEMPORARY — SIX-CALL RETRIEVAL EXPERIMENT (development only, delete after use)
//
//   node --env-file=.env.local scripts/retrieval-experiment.mjs --out <dir>
//   node scripts/retrieval-experiment.mjs --dry            prints the six requests, sends none
//
// Six TEXT-ONLY market-research calls about ONE fixed identity. No photograph,
// no Phase A, no identity stage, no condition stage. Each call changes exactly
// one thing, named in its `change` field. Calls 5 and 6 run concurrently.
//
// The identity is a fixed input to a measurement, stated here rather than in
// any production file: what Phase A read off the witness item, and nothing
// that was learned about it afterwards.
//
// The key is never read by this file. It travels in a request header built by
// callStructured; only response BODIES are saved.
// ══════════════════════════════════════════════════════════════════════════════
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { callStructured } from '../api/_lib/phaseb/openai-client.js';
import { MARKET_EVIDENCE_SCHEMA } from '../api/_lib/phaseb/schemas.js';
import { buildMarketEvidencePrompt } from '../api/_lib/phaseb/prompts.js';
import { buildSearchTool, SEARCH_TOOL_CHOICE, normalizeCurrency } from '../api/_lib/phaseb/market-research.js';
import { extractSearchProvenance, bindObservations } from '../api/_lib/phaseb/search-provenance.js';
import {
  buildIdentityContext, enforceQueryPlan, assessIdentityDiscovery, QUERY_PURPOSE as P,
} from '../api/_lib/phaseb/identity-expansion.js';
import { qualifyMarketEvidence } from '../api/_lib/market-evidence.js';
import { resolveEnrichmentModel, resolveMarketRegion, ENRICHMENT_KEY_ENV } from '../api/_lib/phaseb/config.js';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',').map(Number) : null;
const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
if (outDir) mkdirSync(outDir, { recursive: true });

// ── THE FIXED IDENTITY: what was observed, and only that ─────────────────────
const IDENTITY = {
  subject: {
    object_class: 'blender', category_candidate: 'Home', brand: 'Ninja',
    product_name: 'Ninja Power Blender Duo Pro', family: null, model: 'Power Blender Duo Pro', variant: null,
    identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null },
  },
  evidence: [
    { type: 'visible_text', value: 'NINJA', source: 'image', confidence: 0.99 },
    { type: 'visible_text', value: 'POWER BLENDER DUO PRO', source: 'image', confidence: 0.97 },
    { type: 'visible_text', value: 'BLENDSENSE', source: 'image', confidence: 0.9 },
  ],
  attributes: { materials: [], colors: [], finish: null, shape: null, dimensions: null, style: null, distinctive: [] },
  known_aliases: [], alternatives: [], ambiguities: [],
  confidence: { overall: 0.97 },
};
const SUBJECT = IDENTITY.subject;
const context = buildIdentityContext({
  identity: IDENTITY, ocrText: ['NINJA', 'POWER BLENDER DUO PRO', 'BLENDSENSE'],
  corroboration: { subject_text_permitted: true },
});
const market = resolveMarketRegion();
const model = resolveEnrichmentModel(process.env);

const PLAN_FULL = [
  { purpose: P.EXACT_IDENTITY, text: 'Ninja Power Blender Duo Pro' },
  { purpose: P.LOCAL_SECOND_HAND, text: "נינג'ה Power Blender Duo Pro יד שנייה" },
  { purpose: P.GENERIC_COMPARABLE, text: "בלנדר נינג'ה יד שנייה למכירה" },
];
const intent = (queries) => {
  const plan = enforceQueryPlan({ queries }, context);
  return {
    product_identity: 'Ninja Power Blender Duo Pro', variant: null, condition_target: 'used',
    geography: market.name, currency: market.currency, market: 'second_hand', specificity: 'exact_model',
    queries: plan.queries, search_terms: plan.queries.map((q) => q.text),
  };
};
const base = (queries = PLAN_FULL) => buildMarketEvidencePrompt({
  query: intent(queries), snippets: [], language: 'he', market, context,
});

const OPEN_PAGES = `

ADDITIONAL INSTRUCTION FOR THIS RUN
Before you extract an observation, OPEN the page it comes from and read the
listing itself. Do not extract a price from a search-result summary or from a
category page. Open each promising result, and take the title, price,
currency and condition from the opened page.`;

const DISCOVER_FIRST = `

ADDITIONAL INSTRUCTION FOR THIS RUN
Work in two steps, in this order.
STEP 1 — RESOLVE THE IDENTITY. Search for the product itself and establish,
from what the results show, its full commercial name, any other name it is
sold under, and its model number or other identifiers. Report these in
"identity_discovery".
STEP 2 — FIND LISTINGS. Then run NEW searches that use what step 1 found —
the model number and the other names — to look for second-hand listings in
${market.name}. Extract the observations from those searches.`;

const IDENTITY_ONLY = `

THIS RUN HAS ONE JOB: establish what this product is called on the web. Find
its full commercial name, other names it is sold under, and its model number
or other identifiers, and report them in "identity_discovery". Extract a
listing only if you happen to read one for exactly this product.`;

const LOCAL_ONLY = `

THIS RUN HAS ONE JOB: find second-hand listings for this item, or for items of
the same kind, offered in ${market.name} and priced in ${market.currency}.`;

const SOURCES = 'web_search_call.action.sources';
const CALLS = [
  { n: 1, arch: 'B', name: 'results_include', change: 'include += web_search_call.results',
    prompt: base(), include: [SOURCES, 'web_search_call.results'], effort: 'low', maxOut: 6000 },
  { n: 2, arch: 'C', name: 'open_pages', change: 'prompt instructs the model to open listing pages',
    prompt: base() + OPEN_PAGES, include: [SOURCES], effort: 'low', maxOut: 6000 },
  { n: 3, arch: 'D', name: 'reasoning_medium', change: 'reasoning effort medium (output cap raised so it cannot truncate)',
    prompt: base(), include: [SOURCES], effort: 'medium', maxOut: 12000 },
  { n: 4, arch: 'E', name: 'discover_then_retrieve', change: 'prompt instructs discovery first, then searches using what it found',
    prompt: base() + DISCOVER_FIRST, include: [SOURCES], effort: 'low', maxOut: 6000 },
  { n: 5, arch: 'F', name: 'parallel_identity', change: 'narrow prompt, EXACT_IDENTITY query only',
    prompt: base([PLAN_FULL[0]]) + IDENTITY_ONLY, include: [SOURCES], effort: 'low', maxOut: 6000 },
  { n: 6, arch: 'F', name: 'parallel_local', change: 'narrow prompt, LOCAL_SECOND_HAND + GENERIC_COMPARABLE queries only',
    prompt: base([PLAN_FULL[1], PLAN_FULL[2]]) + LOCAL_ONLY, include: [SOURCES], effort: 'low', maxOut: 6000 },
].filter((c) => !only || only.includes(c.n));

// Published rates, USD. Model tokens per 1M; search per action.
const RATE = { input: 0.20, cached: 0.02, output: 1.20, search_action: 0.01 };

async function run(call) {
  let raw = null;
  let requestBody = null;
  const spy = async (url, init) => {
    requestBody = JSON.parse(init.body);
    const res = await fetch(url, init);
    try { raw = await res.clone().json(); } catch { raw = null; }
    return res;
  };
  const t0 = Date.now();
  let data = null;
  let failure = null;
  try {
    ({ data } = await callStructured({
      stage: `experiment_${call.n}`, prompt: call.prompt, schema: MARKET_EVIDENCE_SCHEMA,
      schemaName: 'getworth_market_evidence', model, apiKey: process.env[ENRICHMENT_KEY_ENV],
      timeoutMs: 150_000, maxOutputTokens: call.maxOut, reasoningEffort: call.effort,
      tools: [buildSearchTool(market)], toolChoice: SEARCH_TOOL_CHOICE, include: call.include, fetchImpl: spy,
    }));
  } catch (err) { failure = String(err?.message ?? err).slice(0, 400); }
  const ms = Date.now() - t0;

  if (outDir) {
    writeFileSync(join(outDir, `call${call.n}-${call.name}.json`), JSON.stringify({
      call: call.n, name: call.name, change: call.change, wall_clock_ms: ms, failure,
      request: requestBody && {
        model: requestBody.model, tools: requestBody.tools, tool_choice: requestBody.tool_choice,
        include: requestBody.include, reasoning: requestBody.reasoning, max_output_tokens: requestBody.max_output_tokens,
      },
      prompt: call.prompt,
      response: raw && { status: raw.status ?? null, incomplete_details: raw.incomplete_details ?? null, error: raw.error ?? null, usage: raw.usage ?? null, output: raw.output ?? [] },
    }, null, 2));
  }

  const output = raw?.output ?? [];
  const prov = extractSearchProvenance(output);
  const calls = output.filter((i) => i?.type === 'web_search_call');
  const actions = calls.map((c) => c?.action?.type ?? 'unknown');
  const extracted = Array.isArray(data?.observations) ? data.observations : [];
  const { bound, unbound, bindings } = bindObservations(extracted, prov);
  const discovery = assessIdentityDiscovery(data?.identity_discovery, prov);
  const qual = qualifyMarketEvidence({ observations: bound, subject: SUBJECT });
  const u = raw?.usage ?? {};
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const searchActions = actions.filter((a) => a === 'search').length;
  const modelCost = (((u.input_tokens ?? 0) - cached) * RATE.input + cached * RATE.cached + (u.output_tokens ?? 0) * RATE.output) / 1e6;
  const searchCost = searchActions * RATE.search_action;

  // What came back on the search items themselves, beyond the action.
  const callKeys = [...new Set(calls.flatMap((c) => Object.keys(c)))];
  const actionKeys = [...new Set(calls.flatMap((c) => Object.keys(c?.action ?? {})))];
  const sourceKeys = [...new Set(calls.flatMap((c) => (c?.action?.sources ?? []).flatMap((s) => (typeof s === 'object' && s ? Object.keys(s) : ['(string)']))))];
  const resultsField = calls.flatMap((c) => (Array.isArray(c?.results) ? c.results : (Array.isArray(c?.action?.results) ? c.action.results : [])));

  return {
    CALL: call.n, ARCHITECTURE: call.arch, NAME: call.name, CHANGE: call.change, FAILURE: failure,
    RESPONSE_STATUS: raw?.status ?? null,
    HTTP_CALLS: 1,
    WEB_SEARCH_ACTIONS: searchActions,
    PAGE_OPEN_ACTIONS: actions.filter((a) => a === 'open_page').length,
    FIND_IN_PAGE_ACTIONS: actions.filter((a) => a === 'find_in_page' || a === 'find').length,
    ACTION_SEQUENCE: calls.map((c) => {
      const a = c?.action ?? {};
      if (a.type === 'search') return `search[${[a.query, ...(a.queries ?? [])].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' | ')}]`;
      return `${a.type}[${a.url ?? ''}${a.pattern ? ` ~ ${a.pattern}` : ''}]`;
    }),
    EXECUTED_QUERIES: prov.queries,
    SOURCE_COUNT: prov.sources.length,
    SOURCE_DOMAINS: prov.source_domains,
    SOURCES: prov.sources,
    PAGES_OPENED: prov.pages_opened,
    WEB_SEARCH_CALL_KEYS: callKeys, ACTION_KEYS: actionKeys, SOURCE_KEYS: sourceKeys,
    RESULTS_FIELD_ITEMS: resultsField.length,
    RESULTS_FIELD_SAMPLE: resultsField.slice(0, 2),
    CITATIONS: prov.citations.length,
    IDENTITY_ALIASES_FOUND: discovery.claims.filter((c) => ['alias', 'regional_name', 'canonical_name'].includes(c.kind))
      .map((c) => `${c.kind}: ${c.value} @ ${c.source_domains.join(',')}${c.corroborated ? ' (2+ domains)' : ''}`),
    MODEL_NUMBERS_FOUND: discovery.claims.filter((c) => ['model_number', 'mpn', 'sku'].includes(c.kind))
      .map((c) => `${c.kind}: ${c.value} @ ${c.source_domains.join(',')}${c.corroborated ? ' (2+ domains)' : ''}`),
    DISCOVERY_DROPPED: discovery.dropped,
    OBSERVATIONS: extracted.map((o) => ({
      domain: o?.source_domain ?? null, url: o?.source ?? null, title: String(o?.title ?? '').slice(0, 80),
      price: o?.observed_price ?? null, currency_raw: o?.currency ?? null, currency: normalizeCurrency(o?.currency),
      kind: o?.listing_kind ?? null, listing_model: o?.match?.model ?? null, match: o?.match?.confidence ?? null,
    })),
    PROVENANCE_BOUND: bound.length, UNBOUND: unbound.map((x) => x.reason), BINDINGS: bindings,
    QUALIFICATION: { admitted: qual.counts.admitted, reasons: qual.disqualified.map((d) => d.reason), set_failures: qual.set_failures },
    NOTES: data?.notes ?? null,
    INPUT_TOKENS: u.input_tokens ?? null, CACHED_INPUT_TOKENS: cached,
    OUTPUT_TOKENS: u.output_tokens ?? null, REASONING_TOKENS: u.output_tokens_details?.reasoning_tokens ?? null,
    SEARCH_TOOL_COST: Number(searchCost.toFixed(5)), MODEL_COST: Number(modelCost.toFixed(5)),
    TOTAL_COST: Number((searchCost + modelCost).toFixed(5)),
    WALL_CLOCK_MS: ms,
  };
}

if (dry) {
  for (const c of CALLS) {
    process.stdout.write(`${JSON.stringify({ call: c.n, name: c.name, change: c.change, include: c.include, effort: c.effort, prompt_chars: c.prompt.length }, null, 2)}\n`);
  }
  process.stdout.write(`\nIDENTITY CONTEXT\n${JSON.stringify(context, null, 2)}\n\nPROMPT TAIL (call 4)\n${CALLS.find((c) => c.n === 4)?.prompt.slice(-900) ?? ''}\n`);
  process.exit(0);
}
if (!process.env[ENRICHMENT_KEY_ENV]) { process.stderr.write(`${ENRICHMENT_KEY_ENV} is not set.\n`); process.exit(3); }

const results = [];
for (const c of CALLS.filter((x) => x.n <= 4)) results.push(await run(c));
const pair = CALLS.filter((x) => x.n >= 5);
if (pair.length) {
  const t0 = Date.now();
  const both = await Promise.all(pair.map(run));
  const wall = Date.now() - t0;
  results.push(...both.map((r) => ({ ...r, PARALLEL_PAIR_WALL_CLOCK_MS: wall })));
}
const text = JSON.stringify(results, null, 2);
if (outDir) writeFileSync(join(outDir, 'summary.json'), text);
process.stdout.write(`${text}\n`);
