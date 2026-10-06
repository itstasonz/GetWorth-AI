// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — TEST FAKES
//
// A streaming OpenAI Responses endpoint and the Bank of Israel feed, as a
// `fetch` the scan's own code can be handed. Nothing here reaches a network,
// and no test that uses it spends a credit.
// ══════════════════════════════════════════════════════════════════════════════

/** A JPEG-shaped buffer large enough to pass as a photograph. */
export const IMG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(2000, 7)]).toString('base64')}`;

export const RAW_IDENTITY = Object.freeze({
  is_sellable_item: true,
  visible_text: ['LOGITECH', 'G PRO'],
  category: 'Electronics',
  item_type: 'gaming mouse',
  brand: 'Logitech',
  product_family: 'G Pro',
  model: 'G Pro X Superlight',
  model_number: null,
  variant: null,
  color: 'Black',
  size_or_capacity: null,
  configuration: 'complete_item',
  included_items: [],
  exact_model_established: true,
  alternatives: [],
  identity_confidence: 'high',
  display_name: 'Logitech G Pro X Superlight',
  canonical_name: 'logitech g pro x superlight',
  uncertainty_note: null,
  visible_condition: 'good',
  condition_notes: [],
  listing_description: 'Wireless gaming mouse in black.',
  search: { hebrew_name: 'עכבר גיימינג', aliases: [], model_numbers: [] },
  followup: { kind: 'none', affects: 'none', question: null, options: [] },
});

export const SOURCES = Object.freeze({
  IL_USED_1: 'https://www.secondhand.example.co.il/item/111',
  IL_USED_2: 'https://market.example.co.il/ads/222',
  IL_RETAIL: 'https://www.shop.example.co.il/p/superlight',
  INTL_USED: 'https://www.used.example.com/itm/333',
});

/** What the market step's model returns: prices it found and what each is. No valuation. */
export const RAW_MARKET = Object.freeze({
  evidence: [
    { url: SOURCES.IL_USED_1, title: 'Logitech G Pro X Superlight יד שנייה', price: 260, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good' },
    { url: SOURCES.IL_USED_2, title: 'G Pro X Superlight משומש', price: 250, currency: '₪', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'unknown' },
    { url: SOURCES.IL_RETAIL, title: 'Logitech G Pro X Superlight חדש', price: 549, currency: 'ILS', kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed' },
    { url: SOURCES.INTL_USED, title: 'Logitech G Pro X Superlight used', price: 70, currency: 'USD', kind: 'sold', match: 'exact', market: 'INTL', condition: 'unknown' },
  ],
});

/** What the server computes from RAW_MARKET at 3.5 ILS/USD: worked out by hand in the valuation suite. */
export const GOOD_BAND = Object.freeze({ list: 260, low: 190, high: 260 });

const band = (list, low, high, basis = 'adjusted') => ({ list, low, high, basis });
/** A priced valuation's bands as the client receives them. */
export const PRICES = Object.freeze({
  new_sealed: band(420, 360, 400), like_new: band(340, 290, 320), good: band(290, 240, 270, 'listings'), fair: band(230, 180, 210), poor: band(150, 100, 130),
});

/** The search tool's own record: one completed search that reached these pages. */
export function searchItems(urls, { text = {} } = {}) {
  return [{
    type: 'web_search_call', id: 'ws_1', status: 'completed',
    action: { type: 'search', query: 'Logitech G Pro X Superlight יד שנייה', sources: urls.map((url) => ({ type: 'url', url })) },
    results: urls.map((url) => ({ url, title: 'result', text: text[url] ?? '' })),
  }];
}

const message = (obj) => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(obj), annotations: [] }] });

function sse(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
}

function completed(items, model) {
  return [
    ...items.map((item) => ({ type: 'response.output_item.done', item })),
    { type: 'response.completed', response: { status: 'completed', model, output: items, usage: { input_tokens: 1000, output_tokens: 200 } } },
  ];
}

export const BOI_JSON = { exchangeRates: [
  { key: 'USD', currentExchangeRate: 3.5, unit: 1, lastUpdate: '2026-10-05T00:00:00Z' },
  { key: 'EUR', currentExchangeRate: 4.0, unit: 1, lastUpdate: '2026-10-05T00:00:00Z' },
] };

/**
 * A `fetch` that plays OpenAI (identity, then market) and the exchange-rate feed.
 * `identities` and `markets` are answered in order; `calls` records every request.
 */
export function fakeProvider({ identities = [RAW_IDENTITY], markets = [RAW_MARKET], reached = Object.values(SOURCES), pageText = {}, status = null, searched = true, fx = BOI_JSON } = {}) {
  const calls = [];
  let i = 0;
  let m = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href.includes('boi.org.il')) {
      calls.push({ kind: 'fx', url: href });
      return fx ? new Response(JSON.stringify(fx), { status: 200 }) : new Response('down', { status: 503 });
    }
    const body = JSON.parse(init.body);
    const kind = Array.isArray(body.tools) ? 'market' : 'identity';
    calls.push({ kind, url: href, body, headers: init.headers });
    if (status) return new Response(JSON.stringify({ error: { message: 'upstream said no' } }), { status });
    const items = kind === 'identity'
      ? [message(identities[Math.min(i++, identities.length - 1)])]
      : [...(searched ? searchItems(reached, { text: pageText }) : []), message(markets[Math.min(m++, markets.length - 1)])];
    return new Response(sse(completed(items, body.model)), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  fetchImpl.calls = calls;
  fetchImpl.of = (kind) => calls.filter((c) => c.kind === kind);
  return fetchImpl;
}

/** The identity as step 1 normalises it, for tests that start at step 2. */
export async function identityOf(raw = RAW_IDENTITY, opts = {}) {
  const { normalizeIdentity } = await import('../../api/_lib/scan/identify.js');
  return normalizeIdentity(raw, opts);
}
