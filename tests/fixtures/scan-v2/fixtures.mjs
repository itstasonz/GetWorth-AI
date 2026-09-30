// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — FIXTURES
//
// No test spends a credit: every provider call is answered by `mockV2Provider`,
// which speaks the Responses API's SERVER-SENT EVENT stream, because V2 reads
// the stream and stops it part-way.
//
// The search results are SYNTHETIC. Their shapes are the ones real responses
// have — a page title carrying a price, a snippet with a provider preamble, a
// results table flattened to text, a shop's price line — and every seller,
// listing and URL in them is invented.
// ══════════════════════════════════════════════════════════════════════════════

/** A JPEG header followed by padding: large enough to be accepted as a photograph. */
export const IMG = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]),
  Buffer.alloc(1024, 0x20),
]).toString('base64');

const f = (value, confidence = 0, evidence = 'NONE') => ({ value, confidence, evidence });
const answer = (o) => ({
  category: 'Other', object_class: null, local_name: null, visible_text: [],
  brand: f(null), model: f(null), variant: f(null), ranked_candidates: [],
  condition: { grade: 'Good', observations: [] }, identity_evidence: [], missing_evidence: 'NONE',
  ...o,
});

// ── WHAT THE MODEL ANSWERS, PER PHOTOGRAPH ──────────────────────────────────
export const RAW = Object.freeze({
  // The name is printed on the front panel. No SKU is known, and none is needed.
  NINJA: answer({
    category: 'Home', object_class: 'blender', local_name: 'בלנדר',
    visible_text: ['Ninja', 'POWER BLENDER DUO PRO', 'BLENDSENSE'],
    brand: f('Ninja', 0.98, 'TEXT_READ'), model: f('Power Blender Duo Pro', 0.93, 'TEXT_READ'),
    identity_evidence: ['BRAND_TEXT_READ', 'MODEL_TEXT_READ'], missing_evidence: 'RATING_PLATE',
  }),
  // The production witness: a logo, a shape, and four products it could be.
  LOGITECH: answer({
    category: 'Electronics', object_class: 'gaming mouse', local_name: 'עכבר גיימינג',
    visible_text: ['G'],
    brand: f('Logitech G', 0.9, 'LOGO'), model: f(null),
    ranked_candidates: [
      { brand: 'Logitech', model: 'G Pro X Superlight', variant: null, confidence: 0.4, distinguishing_evidence: 'no side grip texture' },
      { brand: 'Logitech', model: 'G Pro Wireless', variant: null, confidence: 0.4, distinguishing_evidence: 'side buttons both sides' },
      { brand: 'Logitech', model: 'G305', variant: null, confidence: 0.3, distinguishing_evidence: 'shorter, AA battery door' },
      { brand: 'Logitech', model: 'G703', variant: null, confidence: 0.25, distinguishing_evidence: 'rubber side grips' },
    ],
    identity_evidence: ['LOGO', 'SHAPE_ONLY'], missing_evidence: 'UNDERSIDE_MODEL_LABEL',
  }),
  // The follow-up photograph of that mouse: a label, and nothing else in frame.
  LOGITECH_LABEL: answer({
    category: 'Electronics', object_class: 'label', local_name: null,
    visible_text: ['Logitech', 'G PRO X SUPERLIGHT', 'M/N: MR0089'],
    brand: f('Logitech', 0.97, 'LABEL_READ'), model: f('G Pro X Superlight', 0.97, 'LABEL_READ'),
    condition: { grade: 'Unknown', observations: [] },
    identity_evidence: ['LABEL_READ'], missing_evidence: 'NONE',
  }),
  // A follow-up that shows nothing new.
  LOGITECH_STILL_UNKNOWN: answer({
    category: 'Electronics', object_class: 'gaming mouse', local_name: 'עכבר גיימינג',
    visible_text: [], brand: f('Logitech', 0.8, 'LOGO'), model: f(null),
    ranked_candidates: [
      { brand: 'Logitech', model: 'G Pro X Superlight', variant: null, confidence: 0.4, distinguishing_evidence: null },
      { brand: 'Logitech', model: 'G305', variant: null, confidence: 0.35, distinguishing_evidence: null },
    ],
    condition: { grade: 'Unknown', observations: [] }, missing_evidence: 'UNDERSIDE_MODEL_LABEL',
  }),
  // Recognised by shape and logo. The only open question is the edition.
  PS5: answer({
    category: 'Electronics', object_class: 'game console', local_name: 'קונסולת משחקים',
    visible_text: ['SONY'],
    brand: f('Sony', 0.97, 'TEXT_READ'), model: f('PlayStation 5', 0.95, 'SHAPE'),
    ranked_candidates: [
      { brand: 'Sony', model: 'PlayStation 5 Slim', variant: null, confidence: 0.3, distinguishing_evidence: 'smaller body' },
    ],
    identity_evidence: ['BRAND_TEXT_READ', 'LOGO'], missing_evidence: 'BOTTOM_MODEL_LABEL',
  }),
  SOFA: answer({
    category: 'Furniture', object_class: 'corner sofa', local_name: 'ספה פינתית',
    identity_evidence: ['SHAPE_ONLY'], missing_evidence: 'NONE',
  }),
  DARK: answer({ category: 'Other', object_class: null, condition: { grade: 'Unknown', observations: [] }, missing_evidence: 'BETTER_LIGHT' }),
  // The model CLAIMS it read a model that is nowhere in the text it read.
  CLAIMED_READ: answer({
    category: 'Electronics', object_class: 'gaming mouse', local_name: 'עכבר גיימינג',
    visible_text: ['G'], brand: f('Logitech', 0.9, 'LOGO'), model: f('G Pro X Superlight', 0.7, 'TEXT_READ'),
    ranked_candidates: [{ brand: 'Logitech', model: 'G Pro Wireless', variant: null, confidence: 0.6, distinguishing_evidence: null }],
  }),
  ZARA: answer({
    category: 'Clothing', object_class: 'jacket', local_name: 'מעיל',
    visible_text: ['ZARA'], brand: f('Zara', 0.95, 'TEXT_READ'), missing_evidence: 'INNER_BRAND_TAG',
  }),
});

// ── SEARCH RESULTS, IN THE PROVIDER'S SHAPE ─────────────────────────────────
const result = (url, title, snippet) => ({ type: 'text_result', url, title, snippet: `citeturn0search0 [wordlim: 200] Crawled: today; ${snippet}` });

/** Three independent sites, each selling a used PlayStation 5: enough to verify. */
export const RESULTS_PS5_VERIFIED = [
  result('https://www.boardone.co.il/ad/1001', 'Sony PlayStation 5 למכירה בתל אביב 1,800 ש"ח | קונסולות | לוח יד שניה',
    'תמונות של Sony PlayStation 5 למכירה בתל אביב'),
  result('https://www.boardtwo.co.il/item/2002', 'Sony PlayStation 5 למכירה בחיפה 1700 שח | לוח יד שנייה',
    'מצב מצוין, כולל שלט'),
  result('https://www.boardthree.co.il/listing/3003', 'Sony PlayStation 5 Disc למכירה בירושלים 2,000 ₪ | יד 2',
    'נמכר עקב מעבר דירה'),
];

/** One of everything that must NOT become valuation evidence, and one listing that may. */
export const RESULTS_MIXED = [
  // A real listing.
  result('https://www.boardone.co.il/ad/1001', 'Sony PlayStation 5 למכירה בתל אביב 1,800 ש"ח | קונסולות | לוח יד שניה', 'כולל שלט'),
  // A shop: price line, delivery fees, and a naked price under a heading.
  result('https://www.shopzone.co.il/p/ps5', 'Sony PlayStation 5 - השוואת מחירים | שופזון',
    '## ₪2,299 ... 2,299 ₪ משלוח חינם עד 7 ימי עסקים ... * משלוח רגיל לבית בעלות של ₪29 ... * איסוף מנקודת איסוף בעלות של ₪15'),
  // A bundle: two prices in one listing.
  result('https://www.boardtwo.co.il/item/2002', 'קונסולות יד שנייה למכירה | לוח יד שנייה',
    'Sony PlayStation 5 למכירה 1,700 ש"ח בנוסף שלט שני ב-150 ש"ח'),
  // What the seller once paid.
  result('https://www.boardtwo.co.il/item/2003', 'קונסולות יד שנייה למכירה | לוח יד שנייה',
    'Sony PlayStation 5 למכירה, נקנה ב 2,400 ₪ לפני שנה'),
  // A results table, as a table and flattened to text. The category cell names the product.
  result('https://www.boardthree.co.il/c/ps5', 'פלייסטיישן 5 למכירה - לוח יד שניה',
    'קטגוריה | פריט | איזור | מחיר ... משחקים וקונסולות - Sony PlayStation 5 | שלט DualSense | חיפה | 200 ₪ | 01/09/2026'),
  result('https://m.boardthree.co.il/c/ps5', 'קונסולות יד שניה',
    '250 ₪ דני     Sony PlayStation 5 למכירה  משחקים וקונסולות יד שניה כבל טעינה מקורי'),
  // A forum comment with no sale intent.
  result('https://www.forumsite.com/r/gaming/1', 'כמה עולה היום קונסולה?', 'Sony PlayStation 5 עולה בערך 2,100 ₪ בחנויות, אולי שווה לחכות'),
  // A foreign listing.
  result('https://www.abroad.com/listing/9', 'Sony PlayStation 5 for sale - 300 USD | Used consoles', 'Used, works'),
  // An accessory for the product.
  result('https://www.boardone.co.il/ad/1009', 'כיסוי ל Sony PlayStation 5 למכירה 80 ש"ח | לוח יד שניה', 'כיסוי סיליקון'),
];

/** A shop page for the exact product, and no second-hand listing at all. */
export const RESULTS_RETAIL_ONLY = [
  result('https://www.shopzone.co.il/p/ninja', 'Ninja Power Blender Duo Pro - השוואת מחירים | שופזון', '1,000 ₪ משלוח חינם עד 5 ימי עסקים'),
];

/** Second-hand jackets of one brand: a kind of object with a brand and no model. */
export const RESULTS_ZARA = [
  result('https://www.boardone.co.il/ad/501', 'מעיל Zara למכירה בתל אביב 120 ש"ח | לוח יד שניה', 'מידה M'),
  result('https://www.boardtwo.co.il/item/502', 'מעיל Zara למכירה בחיפה 150 שח | לוח יד שנייה', 'כמעט לא נלבש'),
  result('https://www.boardthree.co.il/listing/503', 'מעיל Zara למכירה 200 ₪ | יד 2', 'מצב טוב'),
];

// ── THE PROVIDER, AS A STREAM ───────────────────────────────────────────────
const sse = (event) => `data: ${JSON.stringify(event)}\n\n`;

function streamOf(events, record) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= events.length) { controller.close(); return; }
      record.events_sent += 1;
      controller.enqueue(encoder.encode(sse(events[i++])));
    },
    cancel() { record.cancelled = true; },
  });
}

const usage = (output) => ({ input_tokens: 1500, output_tokens: output, output_tokens_details: { reasoning_tokens: 0 } });

function identityEvents(raw) {
  const text = JSON.stringify(raw);
  const response = {
    status: 'completed', model: 'test-model', usage: usage(180),
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  };
  return [
    { type: 'response.created' },
    { type: 'response.output_text.delta', delta: text.slice(0, 20) },
    { type: 'response.completed', response },
  ];
}

function searchEvents(results, queries) {
  const call = {
    id: 'ws_1', type: 'web_search_call', status: 'completed',
    action: { type: 'search', queries, sources: results.map((r) => ({ type: 'url', url: r.url })) },
    results,
  };
  const message = { type: 'message', content: [{ type: 'output_text', text: 'done' }] };
  return [
    { type: 'response.created' },
    { type: 'response.output_item.added', item: { id: 'ws_1', type: 'web_search_call' } },
    { type: 'response.output_item.done', item: call },
    { type: 'response.output_item.added', item: { type: 'message' } },
    // Everything below is the model writing. V2 must not wait for it.
    { type: 'response.output_text.delta', delta: 'do' },
    { type: 'response.output_text.delta', delta: 'ne' },
    { type: 'response.output_item.done', item: message },
    { type: 'response.completed', response: { status: 'completed', model: 'test-model', usage: usage(40), output: [call, message] } },
  ];
}

/**
 * A `fetch` that answers the Responses API.
 *
 * `identities` are consumed in order, one per identity call. `results` answers
 * every search call; `searchStatus` makes the search call fail with that HTTP
 * status instead, and `hangSearch` makes it never answer. Returns the fetch with a `calls` record beside it.
 */
export function mockV2Provider({
  identities = [], results = [], searchStatus = null, identityStatus = null, hangSearch = false,
} = {}) {
  const calls = [];
  let next = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const isSearch = Array.isArray(body.tools);
    const record = { kind: isSearch ? 'search' : 'identity', url: String(url), body, events_sent: 0, cancelled: false };
    calls.push(record);
    const status = isSearch ? searchStatus : identityStatus;
    if (status) return new Response(JSON.stringify({ error: { message: 'upstream said no' } }), { status });
    if (isSearch && hangSearch) {
      // Headers arrive, and then nothing does, until the caller gives up.
      return new Response(new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            record.aborted = true;
            controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        },
      }), { status: 200 });
    }
    const text = body.input?.[0]?.content?.find((c) => c.type === 'input_text')?.text ?? '';
    const events = isSearch
      ? searchEvents(results, text.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, '')))
      : identityEvents(identities[next++] ?? RAW.DARK);
    const stream = streamOf(events, record);
    init.signal?.addEventListener('abort', () => { record.aborted = true; });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
