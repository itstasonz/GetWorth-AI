// PX — THE SECOND SEARCH PROVIDER (perplexity.js, 2026-11-15): off unless switched on with a key; its prices pass every
// check OpenAI's do, now against the result SNIPPET; one ad seen by both providers is one ad; a failure changes nothing.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePerplexity, perplexityRequest, parsePerplexity, PERPLEXITY_URL } from '../api/_lib/scan/perplexity.js';
import { runPrice, resetMarketCache } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';
import { RAW_IDENTITY, NOW, fakeProvider } from './helpers/core-scan-fakes.mjs';

const identity = normalizeIdentity(RAW_IDENTITY);
const DAY = '2026-10-01';
const ev = (url, price, over = {}) => ({ url, title: 'Logitech G Pro X Superlight', price, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: DAY, stock: 'unknown', shipping: null, ...over });
const HL = (n) => `https://www.homeless.co.il/yad2/viewad,8000${n}.aspx`;
const LIST = 'https://www.ad.co.il/c/22?pageindex=2';
beforeEach(() => { resetMarketCache(); resetFxCache(); });

/** A Perplexity Agent API answer: search results with snippets, and the evidence the model reported. */
const pplxBody = (evidence, results) => ({
  model: 'openai/gpt-5.6-sol',
  output: [
    { type: 'search_results', queries: ['Logitech G Pro X Superlight יד שנייה'], results: results.map(([url, snippet, date = null]) => ({ id: url, title: 'result', url, snippet, date, last_updated: null, source: 'web' })) },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ evidence }), annotations: [] }] },
  ],
  usage: { input_tokens: 4000, output_tokens: 300, cost: { currency: 'USD', total_cost: 0.0123 } },
});
function router({ openai, pplx, pplxStatus = 200 }) {
  const calls = { pplx: 0 };
  const f = async (url, init = {}) => {
    if (String(url) === PERPLEXITY_URL) { calls.pplx += 1; return new Response(JSON.stringify(pplx), { status: pplxStatus, headers: { 'content-type': 'application/json' } }); }
    return openai(url, init);
  };
  f.calls = calls;
  return f;
}
const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, r) => { m.set(k, r); } }; };
const price = (fetchImpl, perplexity = { key: 'pk-test', model: 'm' }) => runPrice({ identity, model: 'm', apiKey: 'k', fetchImpl, now: () => NOW, parallel: false, store: memStore(), marketplace: async () => [], marketplaceListings: async () => [], perplexity, background: () => {} });

describe('PX-1 configuration', () => {
  test('PX-1a off unless CORE_SCAN_PERPLEXITY is exactly "true" AND a key is set', () => {
    assert.equal(resolvePerplexity({}), null);
    assert.equal(resolvePerplexity({ PERPLEXITY_API_KEY: 'x' }), null);
    assert.equal(resolvePerplexity({ CORE_SCAN_PERPLEXITY: 'true' }), null);
    assert.deepEqual(resolvePerplexity({ CORE_SCAN_PERPLEXITY: 'true', PERPLEXITY_API_KEY: 'x' }).key, 'x');
  });
  test('PX-1b the request: searched from Israel, the same researcher prompt and the same evidence schema as OpenAI', () => {
    const r = perplexityRequest({ identity, model: 'm', now: NOW });
    assert.equal(r.tools[0].type, 'web_search');
    assert.equal(r.tools[0].user_location.country, 'IL');
    assert.match(r.input, /SEARCH — ISRAEL FIRST/);
    assert.equal(r.response_format.json_schema.name, 'getworth_market_evidence');
  });
  test('PX-1c the answer read: each result keeps its snippet (and date) as page text; nothing is invented for a result without one', () => {
    const p = parsePerplexity(pplxBody([], [[HL(1), 'Logitech G Pro X Superlight ₪250', '2026-10-01'], [HL(2), null]]));
    assert.equal(p.provenance.results[0].text, 'Logitech G Pro X Superlight ₪250\nDate: 2026-10-01');
    assert.equal(p.provenance.results[1].text, null);
    assert.equal(p.meta.cost_usd, 0.0123);
  });
});

describe('PX-2 in the price step', () => {
  const OPENAI_ONE = { markets: [{ evidence: [ev(HL(1), 260)] }], reached: [HL(1)] };
  test('PX-2a a second independent ad, its price tied to it by the snippet: two ads, a worth — from both providers', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), pplx: pplxBody([ev(HL(2), 250)], [[HL(2), 'Logitech G Pro X Superlight למכירה ₪250 פורסם 01/10/2026']]) });
    const r = await price(f);
    assert.equal(f.calls.pplx, 1);
    assert.equal(r.status, 'priced');
    assert.ok(r.valuation.searched.stages.includes('perplexity'));
    assert.equal(r.call.second_provider.cost_usd, 0.0123);
  });
  test('PX-2b the same ad from both providers is one ad: still no worth', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), pplx: pplxBody([ev(HL(1).replace('viewad,', 'viewad%2C'), 260)], [[HL(1).replace('viewad,', 'viewad%2C'), 'Logitech G Pro X Superlight ₪260']]) });
    const r = await price(f);
    assert.equal(r.status, 'insufficient_evidence');
    assert.equal(r.valuation.withdrawn, 'single_israeli_listing');
  });
  test('PX-2c a list-page price the snippet does not tie to the product is set aside, as OpenAI\'s are', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), pplx: pplxBody([ev(LIST, 240, { page: 'search_or_category' })], [[LIST, 'עכברים יד שנייה — 120 מודעות · ₪240 · ₪90 · ₪310']]) });
    const r = await price(f);
    assert.equal(r.status, 'insufficient_evidence');
    assert.equal(r.valuation.evidence.find((e) => e.url === LIST)?.used ?? false, false);
  });
  test('PX-2d a price at an address the search never returned is not evidence', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), pplx: pplxBody([ev(HL(9), 250)], [[HL(2), 'something else']]) });
    const r = await price(f);
    assert.equal(r.valuation.evidence.some((e) => e.url === HL(9)), false);
  });
  test('PX-2e Perplexity failing (HTTP 500) leaves the OpenAI answer exactly as it was', async () => {
    const without = await price(router({ openai: fakeProvider(OPENAI_ONE), pplx: {} }), null);
    resetMarketCache();
    const failed = await price(router({ openai: fakeProvider(OPENAI_ONE), pplx: { error: { message: 'down' } }, pplxStatus: 500 }));
    assert.equal(failed.status, without.status);
    assert.deepEqual(failed.valuation.comparative, without.valuation.comparative);
  });
  test('PX-2f off: no Perplexity request is made', async () => {
    const f = router({ openai: fakeProvider(OPENAI_ONE), pplx: pplxBody([], []) });
    await price(f, null);
    assert.equal(f.calls.pplx, 0);
  });
});
