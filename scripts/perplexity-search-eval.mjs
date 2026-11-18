#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// PERPLEXITY SEARCH API — does it add Israeli second-hand evidence? (2026-11-18)
//
//   node --env-file=<env> scripts/perplexity-search-eval.mjs record <dir> <web|fast>     LIVE, PAID (hard cap below)
//   node scripts/perplexity-search-eval.mjs compare <pplxDir> <out.json> <openaiDir...>    OFFLINE, free
//
// record   sends each item's Search API requests (perplexity-search.js, exactly as the price step would) and keeps both
//          raw answers and the latency. The key is read from the environment and never printed.
// compare  replays, per item, the OpenAI recordings made by il-coverage-eval.mjs (the 20-set and the 10-item holdout)
//          and the Search API recordings through the production price step (service.js runPrice), three ways:
//            openai     the OpenAI stages only (Production today)
//            pplx       the Search API only (the OpenAI stages answer with no evidence)
//            both       both, as the flag would run them
//          and reports, per item, the queries, the candidates, the priced candidates, what bound to the exact product in
//          Israel, why the rest was set aside, the URLs and prices used, and the State A/B/C/D each arm reaches.
// ══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ITEMS as SET20 } from './il-coverage-eval.mjs';
import { runPrice, resetMarketCache } from '../api/_lib/scan/service.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { verifyEvidence, sameListing } from '../api/_lib/scan/valuation.js';
import { isBound } from '../api/_lib/scan/binding.js';
import { getFxTable } from '../api/_lib/scan/fx.js';
import { mayUseInScan, sourceOf } from '../api/_lib/market/sources.js';
import { perplexitySearchRequests, parsePerplexitySearch, searchApiKeep, researchPerplexitySearch, PPLX_SEARCH_URL, PPLX_SEARCH_PRICE_USD } from '../api/_lib/scan/perplexity-search.js';

const CAP_USD = 1.0;
const NOW = Date.parse('2026-11-18T12:00:00Z');
const TODAY = '2026-11-18';
const MODEL = 'gpt-6-luna';

const hb = { is_sellable_item: true, visible_text: [], model_number: null, variant: null, color: null, configuration: 'complete_item', included_items: [], exact_model_established: true, alternatives: [], identity_confidence: 'high', uncertainty_note: null, visible_condition: 'good', condition_notes: [], listing_description: null, market_class: 'consumer_electronics', identity_precision: 'exact_model', attributes: [], clarifications: [], eligibility_notes: [], followup: { kind: 'none', affects: 'none', question: null, options: [] } };
const H = (id, o) => ({ id, holdout: true, raw: { ...hb, ...o, search: { aliases: [], model_numbers: [], ...o.search } } });
// The 10-item holdout (fixed 2026-11-15, recordings %TEMP%/gw-dhold).
export const HOLDOUT = [
  H('iphone14', { category: 'Electronics', item_type: 'smartphone', brand: 'Apple', product_family: 'iPhone', model: 'iPhone 14', size_or_capacity: '128 GB', display_name: 'Apple iPhone 14 128GB', canonical_name: 'apple iphone 14', search: { hebrew_name: 'אייפון 14' } }),
  H('galaxys22', { category: 'Electronics', item_type: 'smartphone', brand: 'Samsung', product_family: 'Galaxy S', model: 'Galaxy S22', size_or_capacity: '128 GB', display_name: 'Samsung Galaxy S22 128GB', canonical_name: 'samsung galaxy s22', search: { hebrew_name: 'גלקסי S22' } }),
  H('ps4pro', { category: 'Electronics', item_type: 'game console', brand: 'Sony', product_family: 'PlayStation 4', model: 'PlayStation 4 Pro', display_name: 'Sony PlayStation 4 Pro', canonical_name: 'sony playstation 4 pro', search: { hebrew_name: 'פלייסטיישן 4 פרו', aliases: ['PS4 Pro'] } }),
  H('xboxs', { category: 'Electronics', item_type: 'game console', brand: 'Microsoft', product_family: 'Xbox Series', model: 'Xbox Series S', display_name: 'Microsoft Xbox Series S', canonical_name: 'microsoft xbox series s', search: { hebrew_name: 'אקסבוקס סירייס S' } }),
  H('airpods3', { category: 'Electronics', item_type: 'earbuds', brand: 'Apple', product_family: 'AirPods', model: 'AirPods 3', display_name: 'Apple AirPods (3rd generation)', canonical_name: 'apple airpods 3', search: { hebrew_name: 'איירפודס 3' } }),
  H('watchse', { category: 'Electronics', item_type: 'smartwatch', brand: 'Apple', product_family: 'Apple Watch', model: 'Apple Watch SE', display_name: 'Apple Watch SE', canonical_name: 'apple watch se', search: { hebrew_name: 'אפל ווטש SE' } }),
  H('kindle', { category: 'Electronics', item_type: 'e-reader', brand: 'Amazon', product_family: 'Kindle', model: 'Kindle Paperwhite', display_name: 'Amazon Kindle Paperwhite', canonical_name: 'amazon kindle paperwhite', search: { hebrew_name: 'קינדל פייפרווייט' } }),
  H('gopro9', { category: 'Electronics', item_type: 'action camera', brand: 'GoPro', product_family: 'HERO', model: 'HERO9 Black', display_name: 'GoPro HERO9 Black', canonical_name: 'gopro hero9 black', search: { hebrew_name: 'גופרו 9', aliases: ['GoPro 9'] } }),
  H('vertuo', { category: 'Home', item_type: 'coffee machine', brand: 'Nespresso', product_family: 'Vertuo', model: 'Vertuo Next', display_name: 'Nespresso Vertuo Next', canonical_name: 'nespresso vertuo next', market_class: 'household', search: { hebrew_name: 'נספרסו ורטואו נקסט' } }),
  H('roomba', { category: 'Home', item_type: 'robot vacuum', brand: 'iRobot', product_family: 'Roomba', model: 'Roomba i7', display_name: 'iRobot Roomba i7', canonical_name: 'irobot roomba i7', market_class: 'household', search: { hebrew_name: 'רומבה i7' } }),
];
const ALL = [...SET20, ...HOLDOUT];
const reqName = (init) => (String(init?.body ?? '').includes('"-yad2.co.il"') ? 'open' : 'boards');

async function record(dir, searchType) {
  if (!process.env.PERPLEXITY_API_KEY) { console.log('PERPLEXITY_API_KEY is not set in this environment'); process.exit(1); }
  fs.mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, 'spend.json');
  const spend = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { usd: 0, requests: 0, items: {} };
  const per = PPLX_SEARCH_PRICE_USD[searchType];
  for (const item of ALL) {
    const file = path.join(dir, `${item.id}.json`);
    if (fs.existsSync(file)) continue;
    if (spend.usd + 2 * per > CAP_USD) { console.log(`STOP before ${item.id}: spent $${spend.usd.toFixed(4)} of $${CAP_USD}`); break; }
    const identity = normalizeIdentity(item.raw);
    const responses = {};
    const fetchImpl = async (url, init) => {
      const t = Date.now();
      const res = await fetch(url, init);
      const text = await res.text();
      responses[reqName(init)] = { status: res.status, body: text, ms: Date.now() - t };
      return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
    };
    let meta = null; let error = null;
    try { ({ meta } = await researchPerplexitySearch({ identity, key: process.env.PERPLEXITY_API_KEY, searchType, fetchImpl, today: TODAY })); } catch (err) { error = String(err?.message ?? err); }
    const paid = Object.values(responses).filter((r) => r.status === 200).length;
    spend.usd += paid * per; spend.requests += paid; spend.items[item.id] = paid * per;
    fs.writeFileSync(ledger, JSON.stringify(spend, null, 1));
    fs.writeFileSync(file, JSON.stringify({ id: item.id, search_type: searchType, recorded_at: new Date().toISOString(), ms: meta?.ms ?? null, error, requests: perplexitySearchRequests({ identity, searchType }).map((r) => r.body), responses }));
    const n = Object.fromEntries(Object.entries(responses).map(([k, r]) => [k, `${r.status}/${r.ms}ms/${(() => { try { return JSON.parse(r.body).results.length; } catch { return '?'; } })()}`]));
    console.log(item.id.padEnd(13), JSON.stringify(n), meta ? `${meta.ms} ms` : error);
  }
  console.log(`SPENT $${spend.usd.toFixed(4)} in ${spend.requests} requests (cap $${CAP_USD})`);
}

// An OpenAI answer with no evidence and no search: what the price step sees when only the Search API reports.
const EMPTY_SSE = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', model: MODEL, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"evidence":[]}' }] }], usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`;
const openaiStage = (init) => { const b = String(init?.body ?? ''); return /SEARCH — LOOK CLOSER/.test(b) ? 'deep' : (/SEARCH — LOOK FURTHER/.test(b) ? 'expand' : 'local'); };
const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, v) => { m.set(k, v); } }; };

function stateOf(v) {
  if (v?.status === 'priced') return 'A';
  if (v?.comparative) return 'B';
  if (v?.retail_new_ils) return 'C';
  return 'D';
}
const usedIl = (v) => (v?.evidence ?? []).filter((e) => e.used && e.market === 'IL' && e.kind !== 'new_retail');
const retailIl = (v) => (v?.evidence ?? []).filter((e) => e.kind === 'new_retail' && e.market === 'IL' && (e.binding === 'strong' || e.binding === 'verified_row')).map((e) => ({ url: e.url, price: e.price, title: e.title, used: e.used }));

async function arm(item, oRec, pRec, mode) {
  resetMarketCache();
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === PPLX_SEARCH_URL) {
      const r = pRec?.responses?.[reqName(init)];
      return r ? new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 503 });
    }
    if (!String(url).includes('api.openai.com')) return fetch(url, init);
    if (mode === 'pplx') return new Response(EMPTY_SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const s = oRec?.responses?.[openaiStage(init)];
    return s ? new Response(s.body, { status: s.status, headers: { 'content-type': 'text/event-stream' } }) : new Response('{"error":{"message":"not recorded"}}', { status: 500 });
  };
  const perplexitySearch = mode === 'openai' ? null : { key: 'replay', searchType: pRec.search_type };
  const r = await runPrice({ identity: normalizeIdentity(item.raw), scanUuid: null, model: MODEL, apiKey: 'replay', fetchImpl, now: () => NOW, store: memStore(), marketplace: async () => [], marketplaceListings: async () => [], background: () => {}, perplexity: null, perplexitySearch, deep: false });
  const v = r.valuation;
  return {
    state: stateOf(v), status: r.status, worth: v?.prices?.good?.worth ?? null, confidence: v?.price_confidence ?? null, withdrawn: v?.withdrawn ?? null,
    comparative: v?.comparative ?? null, retail_new_ils: v?.retail_new_ils ?? null,
    used_il: usedIl(v).map((e) => ({ url: e.url, price: e.price, currency: e.currency, title: e.title, binding: e.binding, listed: e.listed, freshness: e.freshness, condition: e.condition })),
    retail_il: retailIl(v), stages: r.call?.stages ?? [], search_provider: r.call?.search_provider ?? null,
  };
}

async function compare(pDir, outFile, oDirs) {
  const fx = await getFxTable();
  const out = [];
  for (const item of ALL) {
    const oFile = oDirs.map((d) => path.join(d, `${item.id}.json`)).find((f) => fs.existsSync(f));
    const pFile = path.join(pDir, `${item.id}.json`);
    if (!oFile || !fs.existsSync(pFile)) { console.log(item.id.padEnd(13), 'missing recording', !oFile ? 'openai' : 'perplexity'); continue; }
    const oRec = JSON.parse(fs.readFileSync(oFile, 'utf8'));
    const pRec = JSON.parse(fs.readFileSync(pFile, 'utf8'));
    const identity = normalizeIdentity(item.raw);
    // The Search API's own funnel, through the same checks.
    const bodies = Object.values(pRec.responses).filter((r) => r.status === 200).map((r) => JSON.parse(r.body));
    const parsed = parsePerplexitySearch(bodies, { today: TODAY, identity, queries: pRec.requests.flatMap((b) => b.query) });
    const checked = verifyEvidence(parsed.raw.evidence, parsed.provenance, fx, TODAY, { identity, answer: null });
    const refused = checked.evidence.filter((e) => !mayUseInScan(sourceOf(e.url)));
    const kept = checked.evidence.filter((e) => mayUseInScan(sourceOf(e.url)));
    const pooled = searchApiKeep(kept, isBound);
    const reasons = {};
    for (const e of kept) if (!isBound(e)) reasons[e.binding_reason] = (reasons[e.binding_reason] ?? 0) + 1;
    for (const e of kept) if (isBound(e) && !pooled.includes(e)) reasons.one_page_two_prices = (reasons.one_page_two_prices ?? 0) + 1;
    for (const e of pooled) if (e.match === 'exact' && e.market === 'IL' && !['used_listing', 'sold'].includes(e.kind)) reasons[`kind_${e.kind}`] = (reasons[`kind_${e.kind}`] ?? 0) + 1;
    for (const e of pooled) if (e.match !== 'exact') reasons[`match_${e.match}`] = (reasons[`match_${e.match}`] ?? 0) + 1;
    if (refused.length) reasons.source_not_authorized = refused.length;
    const exactIlUsed = pooled.filter((e) => e.match === 'exact' && e.market === 'IL' && ['used_listing', 'sold'].includes(e.kind));
    const newRetail = pooled.filter((e) => e.kind === 'new_retail' && e.market === 'IL').map((e) => ({ url: e.url, price: e.price, title: e.title, match: e.match, binding: e.binding }));
    const [openai, pplx, both] = [await arm(item, oRec, pRec, 'openai'), await arm(item, oRec, pRec, 'pplx'), await arm(item, oRec, pRec, 'both')];
    // Ads the combined arm used that OpenAI's did not: one ad reached by both providers is one ad.
    const added = both.used_il.filter((e) => !openai.used_il.some((o) => sameListing(o, e)));
    const row = {
      id: item.id, name: item.raw.display_name, holdout: !!item.holdout,
      queries: parsed.provenance.queries, results: parsed.provenance.sources.length, hosts: [...new Set(parsed.provenance.sources.map((u) => sourceOf(u)?.id ?? new URL(u).hostname))],
      candidates_priced: new Set(parsed.raw.evidence.map((e) => e.url)).size, claims: parsed.raw.evidence.length, verified: checked.evidence.length,
      exact_il_secondhand: exactIlUsed.map((e) => ({ url: e.url, price: e.price, title: e.title, binding: e.binding, listed: e.listed })),
      new_retail: newRetail, rejected: checked.unverified + checked.evidence.length - exactIlUsed.length - newRetail.length, reasons,
      pplx_ms: pRec.ms, openai_live_ms: oRec.live_ms, openai, pplx, both, added,
    };
    out.push(row);
    console.log(item.id.padEnd(13), `res ${String(row.results).padStart(2)} priced ${String(row.candidates_priced).padStart(2)} exactIL ${row.exact_il_secondhand.length}`, `| openai ${openai.state}${openai.worth ? ` ₪${openai.worth}` : ''} | pplx ${pplx.state}${pplx.worth ? ` ₪${pplx.worth}` : ''} | both ${both.state}${both.worth ? ` ₪${both.worth}` : ''}`, added.length ? `+${added.length} ads` : '', `${pRec.ms} ms`);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  const tally = (k) => out.reduce((t, o) => { t[o[k].state] = (t[o[k].state] ?? 0) + 1; return t; }, {});
  console.log('openai', JSON.stringify(tally('openai')), 'pplx', JSON.stringify(tally('pplx')), 'both', JSON.stringify(tally('both')));
  console.log('added ads', out.reduce((n, o) => n + o.added.length, 0), 'items with added ads', out.filter((o) => o.added.length).length);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [step, ...args] = process.argv.slice(2);
  if (step === 'record') await record(args[0], args[1] === 'web' ? 'web' : 'fast');
  else if (step === 'compare') await compare(args[0], args[1], args.slice(2));
  else { console.error('usage: record <dir> <web|fast> | compare <pplxDir> <out.json> <openaiDir...>'); process.exit(1); }
}
