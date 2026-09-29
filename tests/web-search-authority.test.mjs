// ══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH AUTHORITY — A MODEL'S MEMORY IS NOT A MARKET
//
// The forensic audit found that the market stage attached a search tool and
// then believed the model about whether it had been used. These tests hold the
// replacement: search is REQUIRED in the request, DERIVED from the platform's
// record in the response, and every observation is BOUND to a source that
// record names before either evidence gate sees it.
//
// Every provider here is a recorded shape. Nothing calls OpenAI.
//
//   node --test tests/web-search-authority.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { runPhaseB, PHASE_B_STATUS, MARKET_OUTCOME } from '../api/_lib/phaseb/pipeline.js';
import {
  createMarketResearch, MARKET_MECHANISM, SEARCH_TOOL_CHOICE, SEARCH_INCLUDE,
} from '../api/_lib/phaseb/market-research.js';
import {
  extractSearchProvenance, bindObservations, classifyMarketEvidence, UNBOUND, BINDING, MARKET_CLASS,
} from '../api/_lib/phaseb/search-provenance.js';
import {
  STAGE_TIMEOUT_MS, PIPELINE_BUDGET_MS, FUNCTION_MAX_DURATION_S, MIN_STAGE_BUDGET_MS,
  resolveMarketRegion, MARKET_REGIONS,
} from '../api/_lib/phaseb/config.js';
import { buildMarketQueryPrompt, buildMarketEvidencePrompt } from '../api/_lib/phaseb/prompts.js';
import { VERIFIED_MARKET_QUORUM, MIN_DISTINCT_SOURCES, COMPARABLE_QUORUM, MIN_COMPARABLE_SOURCES } from '../api/_lib/market-evidence.js';
import { NINJA, mockOpenAI, researchOutput, IMG } from './fixtures/phaseb/benchmarks.mjs';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');

const run = (fx, opts = {}, pipeline = {}) => runPhaseB({
  images: [IMG], language: 'en', existingRecognition: fx.recognition, ocrText: fx.ocr,
  apiKey: 'k', model: 'test-model', marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
  fetchImpl: mockOpenAI(fx, opts), ...pipeline,
});

const withMarket = (fx, market) => ({ ...fx, market });
const listing = (domain, ref, price, o = {}) => ({
  source: `https://${domain}/item/${ref}`, source_domain: domain, listing_id_or_reference: ref,
  title: 'Ninja Detect Power Blender Pro', observed_price: price, currency: 'ILS',
  condition: 'used', location: 'Tel Aviv', observed_at: null, listing_kind: 'used_listing',
  match: { brand: 'Ninja', model: 'Detect Power Blender Pro', variant: null, confidence: 0.9 },
  ...o,
});
const FOUR = [
  listing('yad2.co.il', 'a', 620), listing('facebook.com', 'b', 550),
  listing('agora.co.il', 'c', 700), listing('yad2.co.il', 'd', 800),
];

// ════════════════════════════════════════════════════════════════════════════
// WS-0 · THE REQUEST
// ════════════════════════════════════════════════════════════════════════════
describe('WS-0 the request requires a located search and asks for its record', () => {
  const capture = async (options = {}) => {
    let body = null;
    const adapter = createMarketResearch({
      mechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, model: 'm', apiKey: 'k', ...options,
      fetchImpl: async (_u, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({
          output: researchOutput({ observations: [], search_performed: true, notes: null }),
        }), { status: 200 });
      },
    });
    await adapter.search(NINJA.query);
    return body;
  };

  test('WS-0a web search is REQUIRED, not merely available', async () => {
    const body = await capture();
    assert.equal(body.tools.length, 1, 'one tool, so "required" can only mean this one');
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.tool_choice, 'required');
    assert.equal(SEARCH_TOOL_CHOICE, 'required');
  });

  test('WS-0b the search is located in the market, approximately', async () => {
    const loc = (await capture()).tools[0].user_location;
    assert.deepEqual(loc, { type: 'approximate', country: 'IL', timezone: 'Asia/Jerusalem' });
    assert.ok(!('city' in loc) && !('region' in loc),
      'no city or region: GetWorth has no honest source for either');
  });

  test('WS-0c the location comes from the region handed in, not from the adapter', async () => {
    const elsewhere = { ...MARKET_REGIONS.IL, id: 'XX', name: 'Elsewhere', country: 'GB', timezone: 'Europe/London', currency: 'GBP' };
    const body = await capture({ market: elsewhere });
    assert.deepEqual(body.tools[0].user_location, { type: 'approximate', country: 'GB', timezone: 'Europe/London' });
    const prompt = body.input[0].content.find((c) => c.type === 'input_text').text;
    assert.match(prompt, /Elsewhere priced in GBP/);
  });

  test('WS-0d the response is asked to carry its sources, and context size is stated', async () => {
    const body = await capture();
    assert.deepEqual(body.include, ['web_search_call.action.sources', 'web_search_call.results']);
    assert.deepEqual([...SEARCH_INCLUDE], ['web_search_call.action.sources', 'web_search_call.results']);
    assert.ok(['low', 'medium', 'high'].includes(body.tools[0].search_context_size));
  });

  test('WS-0e an unknown region resolves to the default, never to an unlocated search', () => {
    for (const id of [undefined, null, '', 'ZZ', 42]) {
      assert.equal(resolveMarketRegion(id).country, 'IL', String(id));
    }
    assert.equal(resolveMarketRegion('il').timezone, 'Asia/Jerusalem');
  });

  test('WS-0f the evidence engine names no country', () => {
    const src = read('api/_lib/market-evidence.js') + read('api/_lib/phaseb/search-provenance.js');
    assert.ok(!/Asia\/Jerusalem|user_location|country:\s*'IL'/.test(src),
      'location belongs to the region table and the research adapter');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WS-1 · PROVENANCE IS READ FROM THE PLATFORM'S RECORD
// ════════════════════════════════════════════════════════════════════════════
describe('WS-1 what the search did is read from web_search_call items', () => {
  const output = [
    { type: 'reasoning', summary: [] },
    { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'ninja blender יד שנייה', queries: ['ninja blender יד שנייה', 'נינג׳ה בלנדר מחיר'], sources: [{ type: 'url', url: 'https://www.yad2.co.il/item/1?utm_source=openai' }, 'https://agora.co.il/x'] } },
    { type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: 'https://www.zap.co.il/model.aspx?id=9' } },
    { type: 'web_search_call', status: 'failed', action: { type: 'search', query: 'never finished', sources: [{ url: 'https://failed.example/x' }] } },
    { type: 'message', content: [{ type: 'output_text', text: '{}', annotations: [{ type: 'url_citation', url: 'https://www.facebook.com/marketplace/item/5', title: 'Ninja blender' }] }] },
  ];

  test('WS-1a calls, queries, sources, pages and citations are all preserved', () => {
    const p = extractSearchProvenance(output);
    assert.equal(p.search_performed, true);
    assert.equal(p.web_search_call_count, 3);
    assert.equal(p.completed_call_count, 2);
    assert.equal(p.search_call_count, 1);
    assert.deepEqual(p.queries, ['ninja blender יד שנייה', 'נינג׳ה בלנדר מחיר']);
    assert.deepEqual(p.source_domains, ['agora.co.il', 'facebook.com', 'yad2.co.il', 'zap.co.il']);
    assert.equal(p.pages_opened.length, 1);
    // A page the search had ALREADY returned, then opened, is still recorded as opened.
    const again = extractSearchProvenance([
      { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'q', sources: [{ url: 'https://a.example/x?id=1' }] } },
      { type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: 'https://a.example/x?id=1' } },
      { type: 'web_search_call', status: 'failed', action: { type: 'open_page', url: 'https://a.example/never' } },
    ]);
    assert.deepEqual(again.pages_opened, ['https://a.example/x?id=1']);
    assert.equal(again.sources.length, 1);
    assert.equal(p.citations[0].title, 'Ninja blender');
    assert.equal(p.source_details.find((s) => s.domain === 'facebook.com').title, 'Ninja blender');
  });

  test('WS-1b a call that did not complete contributes nothing', () => {
    const p = extractSearchProvenance(output);
    assert.ok(!p.source_domains.includes('failed.example'));
    assert.ok(!p.queries.includes('never finished'));
    const onlyFailed = extractSearchProvenance([output[3], output[4]]);
    assert.equal(onlyFailed.search_performed, false);
    assert.deepEqual(onlyFailed.source_domains, [],
      'a citation beside no completed call is the model’s text, not a search');
  });

  test('WS-1c total: any input yields a record and never throws', () => {
    for (const bad of [undefined, null, 'x', 7, {}, [null, 1, 'a', {}], [{ type: 'web_search_call' }]]) {
      const p = extractSearchProvenance(bad);
      assert.equal(p.search_performed, false, JSON.stringify(bad));
      assert.deepEqual(p.sources, []);
    }
  });

  test('WS-1d only http(s) URLs are sources', () => {
    const p = extractSearchProvenance([{
      type: 'web_search_call', status: 'completed',
      action: { type: 'search', query: 'q', sources: ['javascript:alert(1)', 'file:///etc/passwd', 'yad2.co.il', 'https://ok.example/a'] },
    }]);
    assert.deepEqual(p.source_domains, ['ok.example']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WS-2 · BINDING
// ════════════════════════════════════════════════════════════════════════════
describe('WS-2 an observation is bound to a source the search reached, or dropped', () => {
  const prov = extractSearchProvenance([{
    type: 'web_search_call', status: 'completed',
    action: { type: 'search', query: 'q', sources: [{ url: 'https://www.yad2.co.il/item/a' }, { url: 'https://agora.co.il/list' }] },
  }]);

  test('WS-2a URL and domain bindings are both recorded', () => {
    const r = bindObservations([
      listing('yad2.co.il', 'a', 1), listing('agora.co.il', 'zzz', 2),
    ], prov);
    assert.equal(r.bound.length, 2);
    assert.deepEqual(r.bindings, { [BINDING.CONTENT]: 0, [BINDING.URL]: 1, [BINDING.DOMAIN]: 1 });
  });

  test('WS-2a2 the query string is part of which page it is; tracking is not', () => {
    const p = extractSearchProvenance([{
      type: 'web_search_call', status: 'completed',
      action: { type: 'search', query: 'q', sources: [
        { url: 'https://www.zap.co.il/model.aspx?modelid=1096583' },
        { url: 'https://www.zap.co.il/model.aspx?modelid=2222222' },
        { url: 'https://www.yad2.co.il/list?pageNumber=7' },
        { url: 'https://www.yad2.co.il/list?pageNumber=11' },
        { url: 'https://www.yad2.co.il/list?pageNumber=11&utm_source=openai#top' },
      ] },
    }]);
    assert.equal(p.sources.length, 4, 'four pages, one of them seen twice');
    const at = (url) => bindObservations([{ ...listing('zap.co.il', 'x', 1), source: url }], p).bindings;
    assert.equal(at('https://zap.co.il/model.aspx?modelid=1096583&utm_campaign=x')[BINDING.URL], 1);
    assert.equal(at('https://zap.co.il/model.aspx?modelid=9999999')[BINDING.URL], 0,
      'a product page the search never returned is not URL-bound');
    assert.equal(at('https://zap.co.il/model.aspx?modelid=9999999')[BINDING.DOMAIN], 1);
  });

  test('WS-2b a domain the search never reached is unbound', () => {
    const r = bindObservations([listing('invented-market.co.il', 'a', 1)], prov);
    assert.equal(r.bound.length, 0);
    assert.equal(r.unbound[0].reason, UNBOUND.NOT_IN_PROVENANCE);
  });

  test('WS-2c a look-alike domain does not bind', () => {
    for (const d of ['evil-yad2.co.il', 'yad2.co.il.evil.example', 'notyad2.co.il']) {
      assert.equal(bindObservations([listing(d, 'a', 1)], prov).bound.length, 0, d);
    }
    assert.equal(bindObservations([listing('m.yad2.co.il', 'a', 1)], prov).bound.length, 1,
      'a subdomain of a reached site is the same site');
  });

  test('WS-2d the domain that is checked is the one qualification counts', () => {
    // source_domain is what the diversity floor reads. A real URL beside a
    // different claimed domain would verify one string and grant on another.
    const r = bindObservations([
      { ...listing('yad2.co.il', 'a', 1), source_domain: 'facebook.com' },
    ], prov);
    assert.equal(r.unbound[0].reason, UNBOUND.SOURCE_MISMATCH);
  });

  test('WS-2e no source at all, and no search at all, are both unbound', () => {
    assert.equal(bindObservations([{ observed_price: 1, currency: 'ILS' }], prov).unbound[0].reason, UNBOUND.NO_SOURCE);
    const none = bindObservations(FOUR, extractSearchProvenance([]));
    assert.equal(none.bound.length, 0);
    assert.ok(none.unbound.every((u) => u.reason === UNBOUND.NO_SEARCH));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WS-A..J · THE REQUIRED SCENARIOS, THROUGH THE REAL PIPELINE
// ════════════════════════════════════════════════════════════════════════════
describe('WS-A..J the scenarios, end to end', () => {
  const good = withMarket(NINJA, { search_performed: true, notes: null, observations: FOUR });

  test('WS-A web search available but NOT called grants no market authority', async () => {
    const r = await run(withMarket(NINJA, { search_performed: false, notes: null, observations: FOUR }), { searched: false });
    assert.equal(r.market_evidence.search_performed, false);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.NO_LIVE_SEARCH);
    assert.equal(r.market_evidence.counts.accepted, 0);
    assert.equal(r.valuation_candidate.mid, null);
    assert.notEqual(r.status, PHASE_B_STATUS.COMPLETE);
    assert.equal(r.market_evidence.diagnostics.FINAL_MARKET_AUTHORITY, 'NONE');
  });

  test('WS-B a real web_search_call with valid sources proceeds to qualification', async () => {
    const r = await run(good);
    const d = r.market_evidence.diagnostics;
    assert.equal(d.WEB_SEARCH_CALLED, true);
    assert.equal(d.WEB_SEARCH_CALL_COUNT, 1);
    assert.equal(d.OBSERVATIONS_PROVENANCE_BOUND, 4);
    assert.equal(r.validation.market_evidence.considered, 4, 'qualification saw the bound set');
    assert.equal(r.validation.market_evidence.qualified, true);
  });

  test('WS-C the model CLAIMS search_performed=true, the record shows no call: rejected', async () => {
    const r = await run(good, { searched: false });
    assert.equal(r.market_evidence.model_claimed_search, true, 'the claim is recorded');
    assert.equal(r.market_evidence.search_performed, false, 'and grants nothing');
    assert.equal(r.market_evidence.counts.returned, 4);
    assert.equal(r.market_evidence.counts.provenance_bound, 0);
    assert.ok(r.market_evidence.rejected.every((x) => x.reason === UNBOUND.NO_SEARCH));
    assert.equal(r.valuation_candidate.status, 'PENDING_MARKET');
    assert.equal(r.valuation_candidate.mid, null, 'a remembered price must never be priced');
    assert.equal(r.validation.market_evidence, null);
    assert.notEqual(r.status, PHASE_B_STATUS.COMPLETE);
  });

  test('WS-D a domain and price the search never returned are rejected', async () => {
    // The search reached two real sites. The model reports those two listings
    // and invents two more on sites the search never touched.
    const r = await run(good, { sources: ['https://yad2.co.il/item/a', 'https://facebook.com/item/b'] });
    const c = r.market_evidence.counts;
    assert.equal(c.returned, 4);
    assert.equal(c.provenance_bound, 3, 'yad2 (two listings) and facebook bind; agora does not');
    assert.equal(c.unbound, 1);
    const invented = r.market_evidence.rejected.find((x) => x.reason === UNBOUND.NOT_IN_PROVENANCE);
    assert.equal(invented.observation.source_domain, 'agora.co.il');
    assert.ok(!r.market_evidence.accepted.some((o) => o.source_domain === 'agora.co.il'));
    assert.ok(!(r.validation?.market_evidence?.disqualified ?? []).some((x) => x.source_domain === 'agora.co.il'),
      'an unbound observation never reaches qualification at all');
  });

  test('WS-D2 inventing enough listings cannot manufacture a quorum', async () => {
    const r = await run(good, { sources: ['https://yad2.co.il/item/a'] });
    assert.equal(r.market_evidence.counts.provenance_bound, 2);
    assert.equal(r.valuation_candidate.status, 'PENDING_MARKET');
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
  });

  test('WS-E Israeli ILS sources may qualify', async () => {
    const r = await run(good);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.VERIFIED_MARKET);
    assert.equal(r.valuation_candidate.currency, 'ILS');
    assert.ok(r.valuation_candidate.mid >= 550 && r.valuation_candidate.mid <= 800);
    assert.equal(r.market_evidence.market.country, 'IL');
  });

  test('WS-F a USD source without verified FX is context only', async () => {
    const usd = [0, 1, 2, 3].map((i) => listing(['ebay.com', 'amazon.com', 'mercari.com', 'ebay.com'][i], `u${i}`, 90 + i, { currency: 'USD' }));
    const r = await run(withMarket(NINJA, { search_performed: true, notes: null, observations: usd }));
    assert.equal(r.market_evidence.search_performed, true);
    assert.equal(r.market_evidence.counts.provenance_bound, 4, 'real sources, really found');
    assert.equal(r.market_evidence.counts.context_only, 4);
    assert.equal(r.market_evidence.counts.accepted, 0);
    assert.equal(r.market_evidence.diagnostics.FOREIGN_CURRENCY_COUNT, 4);
    assert.equal(r.market_evidence.counts.by_class[MARKET_CLASS.FOREIGN_CONTEXT], 4);
    assert.equal(r.valuation_candidate.mid, null, 'no FX is invented');
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
  });

  const generic = (observations) => ({
    recognition: null, ocr: [],
    identity: {
      subject: {
        object_class: 'wooden desk', category_candidate: 'Furniture', brand: null, product_name: null,
        family: null, model: null, variant: null,
        identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null },
      },
      confidence: { overall: 0.8, object_class: 0.9, brand: 0, model: 0, variant: 0 },
      evidence: [{ type: 'shape', value: 'desk', source: 'image', confidence: 0.9 }],
      references: [], ambiguities: [], alternatives: [],
    },
    condition: { grade: 'Good', confidence: 0.7, observed: [], not_visible: [], authenticity_observation: 'insufficient_evidence' },
    query: {
      product_identity: 'wooden desk', variant: null, condition_target: 'used', geography: 'Israel',
      currency: 'ILS', market: 'second_hand', search_terms: ['שולחן עץ יד שנייה'], specificity: 'category_only',
    },
    market: { search_performed: true, notes: null, observations },
  });
  const desk = (domain, ref, price) => listing(domain, ref, price, {
    title: 'wooden desk', match: { brand: null, model: null, variant: null, confidence: 0.8 },
  });
  const DESKS = [
    desk('yad2.co.il', '1', 300), desk('agora.co.il', '2', 350), desk('facebook.com', '3', 280),
    desk('yad2.co.il', '4', 420), desk('homeless.co.il', '5', 390),
  ];

  test('WS-G a generic object still earns a comparable market from a real search', async () => {
    const r = await run(generic(DESKS));
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.VERIFIED_COMPARABLE);
    assert.equal(r.market_evidence.query.specificity, 'category_only');
    assert.equal(r.market_evidence.diagnostics.FINAL_MARKET_AUTHORITY, 'VERIFIED_COMPARABLE');
    assert.equal(r.validation.market_evidence.qualified, false, 'class-level is never product-level');
  });

  test('WS-G2 and earns nothing when the search did not run', async () => {
    const r = await run(generic(DESKS), { searched: false });
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.NO_LIVE_SEARCH);
    assert.equal(r.valuation_candidate.mid, null);
  });

  test('WS-H an established model is searched as an exact model, in the market’s language', async () => {
    const r = await run(good);
    assert.equal(r.market_evidence.query.specificity, 'exact_model');
    const q = buildMarketQueryPrompt({ identity: NINJA.identity });
    for (const hint of MARKET_REGIONS.IL.search_hints) assert.ok(q.includes(hint), hint);
    assert.match(q, /LOCAL_SECOND_HAND should\s+be in Hebrew/);
    assert.match(q, /do not name a specific website/, 'the search stays open-world');
    assert.ok(!/ninja|logitech/i.test(q.replace(/<<<[\s\S]*?>>>/g, '').replace(/brand: .*\n/g, '')),
      'no product is written into the prompt template');
    const e = buildMarketEvidencePrompt({ query: NINJA.query });
    assert.match(e, /Run SEVERAL searches/);
    assert.match(e, /one whose source is not on that list is discarded/);
  });

  test('WS-I a real search with no useful results is INSUFFICIENT_MARKET_EVIDENCE', async () => {
    const r = await run(withMarket(NINJA, { search_performed: true, notes: 'nothing relevant', observations: [] }));
    assert.equal(r.market_evidence.search_performed, true);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
    assert.equal(r.valuation_candidate.status, 'PENDING_MARKET');
    assert.deepEqual([r.valuation_candidate.low, r.valuation_candidate.mid, r.valuation_candidate.high], [null, null, null]);
    assert.equal(r.status, PHASE_B_STATUS.IDENTIFIED_PENDING_MARKET);
  });

  test('WS-J the quorum and the diversity floor are exactly what they were', async () => {
    assert.equal(VERIFIED_MARKET_QUORUM, 3);
    assert.equal(MIN_DISTINCT_SOURCES, 2);
    assert.equal(COMPARABLE_QUORUM, 5);
    assert.equal(MIN_COMPARABLE_SOURCES, 3);
    // Two bound listings: below quorum. Three on one site: below diversity.
    const two = await run(withMarket(NINJA, { search_performed: true, notes: null, observations: FOUR.slice(0, 2) }));
    assert.equal(two.market_evidence.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
    const oneSite = [listing('yad2.co.il', 'a', 600), listing('yad2.co.il', 'b', 650), listing('yad2.co.il', 'c', 700)];
    const mono = await run(withMarket(NINJA, { search_performed: true, notes: null, observations: oneSite }));
    assert.equal(mono.validation.market_evidence.qualified, false);
    assert.ok(mono.validation.market_evidence.set_failures.includes('below_source_diversity_floor'));
    // And the full benchmark fixture still lands where it always did.
    const full = await run(NINJA);
    assert.equal(full.market_evidence.counts.accepted, 4);
    assert.equal(full.validation.action, 'accept');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WS-3 · NEW IS NOT USED
// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 evidence is classified, and new retail never becomes a comparable', () => {
  test('WS-3a the five classes', () => {
    const c = (o, currency = 'ILS') => classifyMarketEvidence(o, { currency, marketCurrency: 'ILS' });
    assert.equal(c({ listing_kind: 'used_listing' }), MARKET_CLASS.USED_LISTING);
    assert.equal(c({ listing_kind: 'new_retail' }), MARKET_CLASS.NEW_RETAIL);
    assert.equal(c({ listing_kind: 'unknown' }), MARKET_CLASS.MARKETPLACE_LISTING);
    assert.equal(c({ listing_kind: 'accessory' }), MARKET_CLASS.OTHER);
    assert.equal(c({ listing_kind: 'used_listing' }, 'USD'), MARKET_CLASS.FOREIGN_CONTEXT);
  });

  test('WS-3b retail prices are kept as context and priced from never', async () => {
    const retail = [1199, 1249, 1299, 1349].map((p, i) => listing(['ksp.co.il', 'ivory.co.il', 'zap.co.il', 'bug.co.il'][i], `n${i}`, p, { listing_kind: 'new_retail' }));
    const r = await run(withMarket(NINJA, { search_performed: true, notes: null, observations: retail }));
    assert.equal(r.market_evidence.retail_context.length, 4);
    assert.equal(r.market_evidence.counts.by_class[MARKET_CLASS.NEW_RETAIL], 4);
    assert.equal(r.market_evidence.counts.accepted, 0);
    assert.equal(r.valuation_candidate.mid, null);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WS-4 · DIAGNOSTICS
// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 the diagnostic record is complete and carries no secret', () => {
  const FIELDS = [
    'WEB_SEARCH_CONFIGURED', 'WEB_SEARCH_REQUIRED', 'WEB_SEARCH_CALLED', 'WEB_SEARCH_CALL_COUNT',
    'SEARCH_QUERIES', 'SOURCE_COUNT_RETURNED', 'SOURCE_DOMAINS', 'OBSERVATIONS_EXTRACTED',
    'OBSERVATIONS_PROVENANCE_BOUND', 'OBSERVATIONS_ADMITTED', 'OBSERVATIONS_REJECTED',
    'FOREIGN_CURRENCY_COUNT', 'FINAL_MARKET_AUTHORITY',
  ];

  test('WS-4a every field is present, and the counts close', async () => {
    const d = (await run(NINJA)).market_evidence.diagnostics;
    for (const f of FIELDS) assert.ok(f in d, f);
    assert.equal(d.OBSERVATIONS_ADMITTED + d.OBSERVATIONS_REJECTED + d.FOREIGN_CURRENCY_COUNT, d.OBSERVATIONS_EXTRACTED);
    assert.equal(d.WEB_SEARCH_REQUIRED, true);
    assert.equal(d.FINAL_MARKET_AUTHORITY, 'VERIFIED_MARKET');
  });

  test('WS-4b present even when the market stage never ran', async () => {
    // The provider's planner, forced, returning no plan at all.
    const r = await run({ ...NINJA, query: null }, {}, { queryPlanner: 'model' });
    const d = r.market_evidence.diagnostics;
    for (const f of FIELDS) assert.ok(f in d, f);
    assert.equal(d.WEB_SEARCH_CALLED, false);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.NOT_RESEARCHED);
  });

  test('WS-4c no key, header, image or identifier reaches the market record', async () => {
    const KEY = 'PLACEHOLDER-KEY-THAT-MUST-NOT-LEAK';
    const r = await runPhaseB({
      images: [IMG], existingRecognition: NINJA.recognition, ocrText: NINJA.ocr, apiKey: KEY, model: 'm',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl: mockOpenAI(NINJA),
      safetyIdentifier: 'gw-user-identifier',
    });
    const text = JSON.stringify(r.market_evidence);
    for (const secret of [KEY, 'Bearer', 'authorization', 'gw-user-identifier', IMG.slice(0, 24)]) {
      assert.ok(!text.includes(secret), `${secret} leaked into the market record`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WS-5 · NO STAGE OUTLIVES ITS CONTAINER
// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 the timeout contract is possible', () => {
  test('WS-5a the function duration in api/enrich.js is the one config.js states', async () => {
    const mod = await import('../api/enrich.js');
    assert.equal(mod.config.maxDuration, FUNCTION_MAX_DURATION_S);
    assert.match(read('api/enrich.js'), /export const config = \{ maxDuration: 60 \};/,
      'a literal: Vercel reads this statically');
  });

  test('WS-5b the pipeline budget fits inside the function, with room to answer', () => {
    assert.ok(PIPELINE_BUDGET_MS < FUNCTION_MAX_DURATION_S * 1000);
    assert.ok(FUNCTION_MAX_DURATION_S * 1000 - PIPELINE_BUDGET_MS >= 3000);
  });

  test('WS-5c every stage ceiling is below the pipeline budget', () => {
    for (const [stage, ms] of Object.entries(STAGE_TIMEOUT_MS)) {
      assert.ok(ms < PIPELINE_BUDGET_MS, `${stage} is allowed ${ms}ms inside a ${PIPELINE_BUDGET_MS}ms budget`);
    }
  });

  test('WS-5d the endpoint hands the pipeline its deadline', () => {
    assert.match(read('api/enrich.js'), /deadlineMs: PIPELINE_BUDGET_MS/);
  });

  test('WS-5e each stage is clamped to what is LEFT, not to its ceiling', async () => {
    const seen = {};
    const slow = (ms) => async (url, init) => {
      const name = JSON.parse(init.body)?.text?.format?.name ?? '';
      if (name.includes('identity')) await new Promise((r) => setTimeout(r, ms));
      // The abort timer each call was given is observable through its signal.
      const started = Date.now();
      init.signal.addEventListener('abort', () => { seen[name] = Date.now() - started; });
      return mockOpenAI(NINJA)(url, init);
    };
    const r = await run(NINJA, {}, { fetchImpl: slow(300), deadlineMs: MIN_STAGE_BUDGET_MS + 250 });
    const stage = (n) => r.stages.find((s) => s.stage === n);
    assert.equal(stage('openai_identity').status, 'ok');
    // 300ms of a 2250ms budget are gone, so less than the minimum is left.
    // The plan is built locally and needs no budget; the research it would
    // have fed cannot start.
    assert.equal(stage('market_query').status, 'ok');
    assert.equal(stage('market_research').status, 'skipped');
    assert.match(stage('market_research').detail, /deadline exhausted/);
    assert.equal(stage('condition').status, 'failed');
    assert.equal(r.valuation_candidate.mid, null, 'an exhausted deadline invents nothing');
    assert.equal(r.model_metadata.calls.attempts, 1, 'a stage that could not finish is not started');
    // With the provider's planner, the query stage is the one that cannot start.
    const viaModel = await run(NINJA, {}, { fetchImpl: slow(300), deadlineMs: MIN_STAGE_BUDGET_MS + 250, queryPlanner: 'model' });
    const q = viaModel.stages.find((s) => s.stage === 'market_query');
    assert.equal(q.status, 'skipped');
    assert.match(q.detail, /deadline exhausted/);
    assert.equal(viaModel.model_metadata.calls.attempts, 1);
  });

  test('WS-5f with no container, the ceilings alone apply', async () => {
    const r = await run(NINJA);
    assert.equal(r.status, PHASE_B_STATUS.COMPLETE);
  });
});
