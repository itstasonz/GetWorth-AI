#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// TEMPORARY — WEB SEARCH FORENSIC AUDIT (development only, delete after use)
//
// Observes the REAL market-research adapter from the outside. Nothing under
// api/ is modified: this file hands `createMarketResearch` a wrapping
// `fetchImpl`, which is the injection point the adapter already exposes, and
// reads the request it builds and the raw response it receives.
//
//   node scripts/websearch-audit.mjs                       offline, no cost
//   node --env-file=.env.local scripts/websearch-audit.mjs --live
//                                                          ONE billed call
//
// --live sends a single TEXT-ONLY market_research request. No image, no
// identity, no condition call. The key is never printed: the authorization
// header is not read, and the request BODY (which is what is printed) never
// contains it.
// ══════════════════════════════════════════════════════════════════════════════
import {
  createMarketResearch, MARKET_MECHANISM, normalizeObservations, rejectOutliers, normalizeCurrency,
} from '../api/_lib/phaseb/market-research.js';
import { qualifyMarketEvidence } from '../api/_lib/market-evidence.js';
import { resolveEnrichmentModel, resolveMarketRegion, ENRICHMENT_KEY_ENV } from '../api/_lib/phaseb/config.js';
import { buildMarketReport, concludeMarketReport } from '../api/_lib/phaseb/market-report.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const live = argv.includes('--live');

const brand = flag('--brand', 'Ninja');
const model = flag('--model-name', 'Power Blender Duo Pro');
const objectClass = flag('--class', 'blender');
const query = {
  product_identity: flag('--product', `${brand} ${model}`),
  variant: null,
  condition_target: 'used',
  geography: 'Israel',
  currency: 'ILS',
  market: 'second_hand',
  search_terms: (flag('--terms', `${brand} ${model} יד שניה|${brand} blender used Israel|נינג'ה בלנדר יד 2`)).split('|'),
  specificity: flag('--specificity', 'family'),
};

// A response in the shape OpenAI documents when `include` is NOT sent: the
// web_search_call carries a query and no sources; citations live on the message.
const simulated = () => new Response(JSON.stringify({
  model: 'SIMULATED',
  usage: { input_tokens: 0, output_tokens: 0 },
  output: [
    {
      type: 'web_search_call', status: 'completed',
      action: { type: 'search', query: 'SIMULATED QUERY', sources: [{ type: 'url', url: 'https://simulated.example/listing' }] },
    },
    {
      type: 'message',
      content: [{
        type: 'output_text',
        annotations: [{ type: 'url_citation', url: 'https://simulated.example/listing', title: 'SIMULATED' }],
        text: JSON.stringify({
          search_performed: true,
          notes: null,
          observations: [{
            source: 'https://simulated.example/listing', source_domain: 'simulated.example',
            listing_id_or_reference: 'sim-1', title: 'Ninja Power Blender Duo Pro', observed_price: 90,
            currency: 'USD', condition: 'used', location: null, observed_at: null,
            listing_kind: 'used_listing',
            match: { brand: 'Ninja', model: 'Power Blender Duo Pro', variant: null, confidence: 0.8 },
          }],
        }),
      }],
    },
  ],
}), { status: 200, headers: { 'content-type': 'application/json' } });

let sentBody = null;
let rawResponse = null;
const spy = async (url, init) => {
  sentBody = JSON.parse(init.body);
  const res = live ? await fetch(url, init) : simulated();
  // The response BODY only. It holds no key: the key travels in a request
  // header, which this script never reads.
  try { rawResponse = await res.clone().json(); } catch { rawResponse = null; }
  return res;
};

const apiKey = live ? process.env[ENRICHMENT_KEY_ENV] : 'AUDIT-OFFLINE';
if (live && !apiKey) {
  process.stderr.write(`${ENRICHMENT_KEY_ENV} is not set; --live needs it.\n`);
  process.exit(3);
}

const marketRegion = resolveMarketRegion(flag('--region'));
const adapter = createMarketResearch({
  mechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
  model: resolveEnrichmentModel(process.env),
  apiKey,
  language: flag('--language', 'he'),
  market: marketRegion,
  fetchImpl: spy,
});

const t0 = Date.now();
let research = null;
let failure = null;
try { research = await adapter.search(query); } catch (err) { failure = String(err?.message ?? err).slice(0, 300); }
const latencyMs = Date.now() - t0;

// ── The SAME assembly the pipeline runs. Nothing here re-derives a rule. ─────
const observations = research?.observations ?? [];
const normalized = normalizeObservations(observations);
const { kept, dropped } = rejectOutliers(normalized.accepted);
const qualification = qualifyMarketEvidence({
  observations,
  subject: { brand, model: model === 'null' ? null : model, object_class: objectClass },
});
const report = concludeMarketReport(
  buildMarketReport({ research, normalized, kept, dropped, query, marketRegion }),
  { research, qualification },
);
const webTool = (sentBody?.tools ?? []).find((t) => t?.type === 'web_search') ?? null;
const line = (o) => ({
  domain: o?.source_domain ?? null, price: o?.observed_price ?? null,
  currency: normalizeCurrency(o?.currency), currency_as_written: o?.currency ?? null,
  kind: o?.listing_kind ?? null,
  title: String(o?.title ?? '').slice(0, 70),
});

const dumpPath = flag('--dump');
if (dumpPath && rawResponse) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dumpPath, JSON.stringify({
    status: rawResponse.status ?? null,
    incomplete_details: rawResponse.incomplete_details ?? null,
    usage: rawResponse.usage ?? null,
    output: rawResponse.output ?? [],
  }, null, 2));
}
const observedUrls = new Set([...observations, ...(research?.unbound ?? []).map((u) => u.observation)].map((o) => o?.source));
const extractedAll = [...observations, ...(research?.unbound ?? []).map((u) => u.observation)];

const out = {
  MODE: live ? 'LIVE (one billed, text-only call)' : 'OFFLINE — response is SIMULATED; only the REQUEST section is evidence',
  REQUEST: sentBody && {
    model: sentBody.model,
    tools: sentBody.tools ?? null,
    tool_choice: sentBody.tool_choice ?? '(absent — model decides)',
    search_context_size: webTool?.search_context_size ?? '(absent)',
    user_location: webTool?.user_location ?? '(absent)',
    include: sentBody.include ?? '(absent)',
    reasoning: sentBody.reasoning,
    max_output_tokens: sentBody.max_output_tokens,
    store: sentBody.store,
  },
  QUERY_INTENT: { product: query.product_identity, specificity: query.specificity, terms: query.search_terms },
  ...report.diagnostics,
  MODEL_CLAIMED_SEARCH: report.model_claimed_search,
  SOURCE_TITLES: (research?.provenance?.source_details ?? []).filter((s) => s.title).map((s) => `${s.domain}: ${s.title}`).slice(0, 20),
  PAGES_OPENED: research?.provenance?.pages_opened?.length ?? 0,
  CITATIONS: research?.provenance?.citations?.length ?? 0,
  BINDINGS: research?.bindings ?? null,
  ILS_SOURCES: [...new Set(observations.filter((o) => normalizeCurrency(o?.currency) === marketRegion.currency).map((o) => o.source_domain))],
  FOREIGN_SOURCES: [...new Set(observations.filter((o) => { const c = normalizeCurrency(o?.currency); return c && c !== marketRegion.currency; }).map((o) => o.source_domain))],
  BY_CLASS: report.counts.by_class,
  OBSERVATIONS_BOUND: observations.map(line),
  OBSERVATIONS_UNBOUND: (research?.unbound ?? []).map((u) => ({ ...line(u.observation), reason: u.reason })),
  PHASE_B_FILTER: { accepted: kept.length, rejected: normalized.rejected.map((r) => r.reason), context_only: normalized.context.length },
  QUALIFICATION_SET_FAILURES: qualification.set_failures,
  QUALIFICATION_DISQUALIFIED: qualification.disqualified.map((d) => `${d.observation?.source_domain}: ${d.reason}`),
  RAW_CURRENCIES: extractedAll.map((o) => o?.currency ?? null),
  NORMALIZED_CURRENCIES: extractedAll.map((o) => normalizeCurrency(o?.currency)),
  REJECTION_REASONS: [
    ...(research?.unbound ?? []).map((u) => `${u.observation?.source_domain}: ${u.reason} (binding)`),
    ...qualification.disqualified.map((d) => `${d.observation?.source_domain}: ${d.reason} (qualification)`),
    ...qualification.set_failures.map((f) => `SET: ${f}`),
  ],
  ADMITTED_LISTINGS: qualification.admitted.map((a) => `${a.source_domain}: ${a.normalized_ils_price} ILS — ${String(a.title ?? '').slice(0, 60)}`),
  DISTINCT_ADMITTED_DOMAINS: [...new Set(qualification.admitted.map((a) => a.source_domain))],
  SOURCES_THAT_BECAME_OBSERVATIONS: (research?.provenance?.sources ?? []).filter((u) => observedUrls.has(u)),
  SOURCES_THAT_DID_NOT: (research?.provenance?.sources ?? []).filter((u) => !observedUrls.has(u)),
  RESPONSE_STATUS: rawResponse?.status ?? null,
  USAGE: rawResponse?.usage ? {
    input_tokens: rawResponse.usage.input_tokens, output_tokens: rawResponse.usage.output_tokens,
    reasoning_tokens: rawResponse.usage.output_tokens_details?.reasoning_tokens ?? null,
  } : null,
  OUTPUT_ITEM_TYPES: (rawResponse?.output ?? []).map((i) => (i?.type === 'web_search_call' ? `web_search_call:${i?.action?.type}:${i?.status}` : i?.type)),
  TOTAL_LATENCY_MS: latencyMs,
  NOTES: research?.notes ?? null,
  FAILURE: failure,
};

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
