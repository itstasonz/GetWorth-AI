// PS — THE PERPLEXITY SEARCH API (perplexity-search.js, 2026-11-18): POST /search, no model. Off unless switched on with
// a key; prices read off snippets are claims that pass every check OpenAI's do; the cases that fooled the replay
// (another product, another capacity, an Eilat page, one ad with two prices, a guide page, a mixed shop page) stay out.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePerplexitySearch, perplexitySearchQueries, perplexitySearchRequests, claimsOf, parsePerplexitySearch, searchApiKeep,
  researchPerplexitySearch, publishedNote, modelWords, PPLX_SEARCH_URL, BOARD_DOMAINS, PPLX_MAX_QUERIES,
} from '../api/_lib/scan/perplexity-search.js';
import { isBound } from '../api/_lib/scan/binding.js';
import { runPrice, resetMarketCache } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY, NOW, fakeProvider } from './helpers/core-scan-fakes.mjs';

const identity = normalizeIdentity(RAW_IDENTITY);
const DAY = '2026-10-01';
const HL = (n) => `https://www.homeless.co.il/yad2/viewad,8000${n}.aspx`;
beforeEach(() => { resetMarketCache(); resetFxCache(); });

const phone = normalizeIdentity({ ...RAW_IDENTITY, brand: 'Samsung', product_family: 'Galaxy S', model: 'Galaxy S23', size_or_capacity: '128 GB', display_name: 'Samsung Galaxy S23 128GB', canonical_name: 'samsung galaxy s23', search: { hebrew_name: 'גלקסי S23', aliases: [], model_numbers: ['SM-S911B'] } });
const chair = normalizeIdentity({ ...RAW_IDENTITY, category: 'Furniture', item_type: 'armchair', brand: 'IKEA', product_family: 'POÄNG', model: 'POÄNG armchair', model_number: null, display_name: 'IKEA POÄNG armchair', canonical_name: 'ikea poang armchair', market_class: 'furniture', identity_precision: 'descriptive', search: { hebrew_name: 'כורסת פואנג איקאה', aliases: [], model_numbers: [] } });

describe('PS-1 configuration and requests', () => {
  test('PS-1a off unless CORE_SCAN_PERPLEXITY_SEARCH is exactly "true" AND a key is set; Fast by default', () => {
    assert.equal(resolvePerplexitySearch({}), null);
    assert.equal(resolvePerplexitySearch({ PERPLEXITY_API_KEY: 'x' }), null);
    assert.equal(resolvePerplexitySearch({ CORE_SCAN_PERPLEXITY_SEARCH: 'true' }), null);
    assert.equal(resolvePerplexitySearch({ CORE_SCAN_PERPLEXITY: 'true', PERPLEXITY_API_KEY: 'x' }), null, 'the Agent API flag does not switch the Search API on');
    assert.deepEqual(resolvePerplexitySearch({ CORE_SCAN_PERPLEXITY_SEARCH: 'true', PERPLEXITY_API_KEY: 'x' }), { key: 'x', searchType: 'fast' });
    assert.equal(resolvePerplexitySearch({ CORE_SCAN_PERPLEXITY_SEARCH: 'true', PERPLEXITY_API_KEY: 'x', PERPLEXITY_SEARCH_TYPE: 'web' }).searchType, 'web');
    assert.equal(resolvePerplexitySearch({ CORE_SCAN_PERPLEXITY_SEARCH: 'true', PERPLEXITY_API_KEY: 'x', PERPLEXITY_SEARCH_TYPE: 'people' }).searchType, 'fast');
  });
  test('PS-1b two requests, documented parameters only: Israel, ≤5 plain queries, open (forbidden sources denied) and boards (permitted boards only)', () => {
    const [open, boards] = perplexitySearchRequests({ identity: phone, searchType: 'fast' });
    for (const r of [open, boards]) {
      assert.deepEqual(Object.keys(r.body).sort(), ['country', 'max_results', 'query', 'search_domain_filter', 'search_type']);
      assert.equal(r.body.country, 'IL');
      assert.ok(r.body.query.length >= 1 && r.body.query.length <= PPLX_MAX_QUERIES);
      assert.ok(r.body.max_results <= 20);
      for (const q of r.body.query) assert.doesNotMatch(q, /site:|\bOR\b/);
    }
    assert.ok(open.body.search_domain_filter.every((d) => d.startsWith('-')), 'denylist only (modes cannot mix)');
    assert.ok(open.body.search_domain_filter.includes('-yad2.co.il') && open.body.search_domain_filter.includes('-facebook.com'));
    assert.ok(boards.body.search_domain_filter.every((d) => !d.startsWith('-')));
    assert.ok(BOARD_DOMAINS.includes('homeless.co.il') && !BOARD_DOMAINS.includes('yad2.co.il') && !BOARD_DOMAINS.includes('facebook.com'));
    assert.ok(open.body.query.some((q) => /Galaxy S23 128 GB/.test(q)) && open.body.query.some((q) => /SM-S911B/.test(q)));
  });
  test('PS-1c no owner free text reaches a query (no personal data to the search service)', () => {
    const q = perplexitySearchQueries(phone, { question: 'Anything else?', text: 'My name is Dana Cohen, call 050-1234567' });
    assert.doesNotMatch(JSON.stringify(q), /Dana|050-1234567/);
    assert.match(JSON.stringify(perplexitySearchQueries(phone, { question: 'Storage?', text: '256 GB' })), /256 GB/, 'a configuration answer still narrows the search');
    assert.doesNotMatch(JSON.stringify(perplexitySearchQueries(phone, { question: 'Storage?', text: '0501234567' })), /0501234567/);
  });
  test('PS-1d the result date becomes a publication note verifyEvidence reads; future and unreadable dates give none', () => {
    assert.equal(publishedNote('2026-11-08', '2026-11-18'), 'published: 10 days ago; ');
    assert.equal(publishedNote('2026-11-18', '2026-11-18'), 'published: today; ');
    assert.equal(publishedNote('2026-12-01', '2026-11-18'), '');
    assert.equal(publishedNote(null, '2026-11-18'), '');
  });
});

describe('PS-2 from snippet to claim', () => {
  const zap = 'https://www.zap.co.il/model.aspx?modelid=1183951';
  test('PS-2a a classifieds ad: one claim per price, kind used_listing, page from its address', () => {
    const c = claimsOf({ url: HL(1), title: 'Logitech G Pro X Superlight', snippet: 'עכבר כמו חדש ₪250' }, identity);
    assert.equal(c.length, 1);
    assert.equal(c[0].kind, 'used_listing'); assert.equal(c[0].page, 'listing'); assert.equal(c[0].price, 250); assert.equal(c[0].currency, 'ILS');
  });
  test('PS-2b an unknown address is claimed as a list page (row-level binding only), and is not a private ad', () => {
    const c = claimsOf({ url: 'https://example.co.il/x', title: 'Logitech G Pro X Superlight יד שנייה', snippet: '₪250' }, identity);
    assert.equal(c[0].page, 'search_or_category'); assert.equal(c[0].kind, 'other');
  });
  test('PS-2c refused: a wanted ad, an Eilat (no VAT) page, another storage capacity in the title', () => {
    assert.equal(claimsOf({ url: HL(2), title: 'קונה Logitech G Pro X Superlight', snippet: '₪200' }, identity).length, 0);
    assert.equal(claimsOf({ url: `${zap}&iseilat=true`, title: 'Samsung Galaxy S23 128GB', snippet: '₪2,045' }, phone).length, 0);
    assert.equal(claimsOf({ url: zap, title: 'Samsung Galaxy S23 128GB באילת', snippet: '₪2,045' }, phone).length, 0);
    assert.equal(claimsOf({ url: zap, title: 'Samsung Galaxy S23 SM-S911B/DS 256GB 8GB RAM', snippet: 'Galaxy S23 ₪1,575' }, phone).length, 0);
    assert.equal(claimsOf({ url: zap, title: 'Samsung Galaxy S23 SM-S911B/DS 128GB 8GB RAM', snippet: 'Galaxy S23 ₪2,575' }, phone).length, 1, 'RAM beside the right storage is fine');
  });
  test('PS-2d a board\'s guide page is not an ad; a shop page that mixes used offers gives no new price', () => {
    assert.equal(claimsOf({ url: 'https://shukshuk.co.il/en/guides/sell-old-phone', title: 'How to sell an old iPhone', snippet: 'iPhone 13 ₪759' }, phone)[0]?.kind ?? 'none', 'other');
    assert.equal(claimsOf({ url: 'https://www.zap.co.il/model.aspx?modelid=1', title: 'Samsung Galaxy S23 128GB', snippet: 'מחודש ₪1,149 · חדש ₪2,300' }, phone).length, 0);
    assert.equal(claimsOf({ url: 'https://www.zap.co.il/model.aspx?modelid=1', title: 'Samsung Galaxy S23 128GB', snippet: '₪2,300' }, phone)[0].kind, 'new_retail');
  });
  test('PS-2e bundles and parts are claimed as such', () => {
    assert.equal(claimsOf({ url: HL(3), title: 'Logitech G Pro X Superlight + 2 משחקים', snippet: '₪300' }, identity)[0].match, 'bundle');
    assert.equal(claimsOf({ url: HL(3), title: 'Logitech G Pro X Superlight לחלקים', snippet: '₪50' }, identity)[0].match, 'part');
  });
  test('PS-2f a thing sold by description needs its model word, in either alphabet: an IKEA crib is not a POÄNG', () => {
    assert.deepEqual(modelWords(chair), ['poang']);
    assert.equal(claimsOf({ url: 'https://www.ad.co.il/ad/13275073', title: 'מיטת מעבר של איקאה', snippet: '290 ₪' }, chair).length, 0);
    assert.equal(claimsOf({ url: 'https://www.ad.co.il/ad/15750375', title: 'ויטרינה יפהפיה של איקאה', snippet: '450 ₪' }, chair).length, 0);
    assert.equal(claimsOf({ url: HL(4), title: 'כורסאת IKEA דגם POANG', snippet: '450 ₪' }, chair).length, 1);
    assert.equal(claimsOf({ url: HL(5), title: 'כורסת פואנג', snippet: '450 ₪' }, chair).length, 1);
    assert.equal(claimsOf({ url: HL(6), title: 'כורסה', snippet: '450 ₪' }, normalizeIdentity({ ...chair, model: 'armchair', product_family: null })).length, 0, 'no model word: nothing claimed');
  });
  test('PS-2g one page that is not a known list, two bound prices: neither is kept; a list page keeps its rows', () => {
    const e = (url, price) => ({ url, price, binding: 'strong' });
    assert.deepEqual(searchApiKeep([e('https://doskatv.co.il/a/1', 450), e('https://doskatv.co.il/a/1', 400)], isBound), []);
    const list = 'https://www.homeless.co.il/yad2/board';
    assert.equal(searchApiKeep([e(list, 450), e(list, 400), { url: HL(7), price: 1, binding: 'weak' }], isBound).length, 2);
  });
  test('PS-2h multi-query answers are one flat list; a result without a URL is skipped', () => {
    const p = parsePerplexitySearch([{ results: [{ url: HL(1), title: 't', snippet: 's', date: '2026-11-08' }, { title: 'no url' }] }, { results: [{ url: HL(2), title: 't2', snippet: null }] }], { today: '2026-11-18', queries: ['a', 'a', 'b'] });
    assert.deepEqual(p.provenance.sources, [HL(1), HL(2)]);
    assert.deepEqual(p.provenance.queries, ['a', 'b']);
    assert.equal(p.provenance.results[0].text, 'published: 10 days ago; s');
    assert.equal(p.provenance.results[1].text, null);
  });
});

// ── THE HTTP CALL ─────────────────────────────────────────────────────────────
const searchBody = (results) => ({ id: 'x', results: results.map(([url, title, snippet, date = DAY]) => ({ url, title, snippet, date, last_updated: date })) });
function router({ openai, search, status = 200, statuses = null }) {
  const calls = { search: 0, bodies: [], auth: [] };
  const f = async (url, init = {}) => {
    if (String(url) === PPLX_SEARCH_URL) {
      calls.search += 1; calls.bodies.push(JSON.parse(init.body)); calls.auth.push(init.headers?.authorization);
      const st = statuses ? (statuses.shift() ?? 200) : status;
      return new Response(JSON.stringify(st === 200 ? search : { error: { message: 'echo Bearer ps-secret' } }), { status: st, headers: { 'content-type': 'application/json' } });
    }
    return openai(url, init);
  };
  f.calls = calls;
  return f;
}

describe('PS-3 the HTTP call', () => {
  test('PS-3a both requests sent at once with the bearer key; cost is the published price of the successful requests', async () => {
    const f = router({ search: searchBody([[HL(1), 'Logitech G Pro X Superlight', '₪250']]) });
    const r = await researchPerplexitySearch({ identity, key: 'ps-secret', searchType: 'fast', fetchImpl: f, today: '2026-11-18' });
    assert.equal(f.calls.search, 2);
    assert.ok(f.calls.auth.every((a) => a === 'Bearer ps-secret'));
    assert.equal(r.meta.cost_usd, 0.002);
    assert.equal(r.meta.succeeded, 2);
  });
  test('PS-3b 401 is not retried and its message never carries the key or the response body', async () => {
    const f = router({ search: null, status: 401 });
    await assert.rejects(researchPerplexitySearch({ identity, key: 'ps-secret', fetchImpl: f, today: '2026-11-18' }), (err) => {
      assert.match(err.message, /HTTP 401 \(key rejected\)/);
      assert.doesNotMatch(err.message, /ps-secret|echo/);
      return true;
    });
    assert.equal(f.calls.search, 2, 'one call per request, no retry');
  });
  test('PS-3c 429 is retried once; one request failing leaves the other\'s answer, costed alone', async () => {
    const f = router({ search: searchBody([[HL(1), 'Logitech G Pro X Superlight', '₪250']]), statuses: [429, 429, 200, 503, 503] });
    const r = await researchPerplexitySearch({ identity, key: 'k', searchType: 'web', fetchImpl: f, today: '2026-11-18', timeoutMs: 5000 });
    assert.equal(r.meta.succeeded, 1);
    assert.equal(r.meta.cost_usd, 0.005);
    assert.equal(f.calls.search, 4);
  });
  test('PS-3d a timeout aborts and throws, it does not hang', async () => {
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    await assert.rejects(researchPerplexitySearch({ identity, key: 'k', fetchImpl: hang, today: '2026-11-18', timeoutMs: 50 }), /timeout/);
  });
});

const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, r) => { m.set(k, r); } }; };
const price = (fetchImpl, perplexitySearch = { key: 'pk', searchType: 'fast' }) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl, now: () => NOW, parallel: false, store: memStore(), marketplace: async () => [], marketplaceListings: async () => [], perplexity: null, perplexitySearch, background: () => {} });
const ev = (url, price, over = {}) => ({ url, title: 'Logitech G Pro X Superlight', price, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: DAY, stock: 'unknown', shipping: null, ...over });

describe('PS-4 in the price step', () => {
  const OPENAI_ONE = { markets: [{ evidence: [ev(HL(1), 260)] }], reached: [HL(1)] };
  test('PS-4a a second independent ad the snippet ties to the product: two ads, a worth; the call records the provider', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), search: searchBody([[HL(2), 'Logitech G Pro X Superlight', 'למכירה ₪250']]) });
    const r = await price(f);
    assert.equal(r.status, 'priced');
    assert.ok(r.valuation.searched.stages.includes('perplexity_search'));
    assert.equal(r.call.search_provider.name, 'perplexity_search');
    assert.equal(r.call.search_provider.cost_usd, 0.002);
  });
  test('PS-4b the same ad from both providers is one ad', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), search: searchBody([[HL(1).replace('viewad,', 'viewad%2C'), 'Logitech G Pro X Superlight', '₪260']]) });
    const r = await price(f);
    assert.equal(r.status, 'insufficient_evidence');
    assert.equal(r.valuation.withdrawn, 'single_israeli_listing');
  });
  test('PS-4c a hundred untied prices do not push OpenAI\'s ad out of the pool', async () => {
    const noise = Array.from({ length: 40 }, (_, k) => [`https://www.ad.co.il/c/22?p=${k}`, 'עכברים יד שנייה', `₪${100 + k} · ₪${200 + k} · ₪${300 + k}`]);
    const f = router({ openai: fakeProvider(OPENAI_ONE), search: searchBody(noise) });
    const r = await price(f);
    assert.ok(r.valuation.evidence.some((e) => e.url === HL(1)), 'OpenAI\'s ad is still in the pool');
    assert.equal(r.valuation.evidence.some((e) => /ad\.co\.il\/c\/22/.test(e.url)), false, 'untied list-page prices never joined it');
  });
  test('PS-4d a Yad2 result is never used, even if a request returns one', async () => {
    const y = 'https://www.yad2.co.il/market/item/1';
    const f = router({ openai: fakeProvider(OPENAI_ONE), search: searchBody([[y, 'Logitech G Pro X Superlight', '₪250']]) });
    const r = await price(f);
    assert.equal(r.valuation.evidence.some((e) => e.url === y), false);
    assert.equal(r.status, 'insufficient_evidence');
  });
  test('PS-4e the Search API failing leaves the OpenAI answer exactly as it was', async () => {
    const without = await price(router({ openai: fakeProvider(OPENAI_ONE), search: {} }), null);
    resetMarketCache();
    const failed = await price(router({ openai: fakeProvider(OPENAI_ONE), search: null, status: 500 }));
    assert.equal(failed.status, without.status);
    assert.deepEqual(failed.valuation.comparative, without.valuation.comparative);
    assert.match(failed.call.search_provider.failed[0], /HTTP 500/);
  });
  test('PS-4f off: no Search API request is made', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), search: searchBody([]) });
    await price(f, null);
    assert.equal(f.calls.search, 0);
  });
});
