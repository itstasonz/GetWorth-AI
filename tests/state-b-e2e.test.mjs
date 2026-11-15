// SB — STATE B, END TO END (2026-11-15). Each case starts as what the search model would answer, runs through the REAL
// /api/scan handler (identify → price: evidence checks, binding, valuation, serialisation), and the real response is what
// the real scan screen renders in jsdom. Then Sell: the listing draft carries the ads for reference only, and the database
// rule records a listing priced after them as after_reference. Fixture data, never Production data: every ad below is a
// test value on example hosts' paths, dated on the suite's fixed day.
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.CORE_SCAN_MARKET_PARALLEL = 'false';
import { JSDOM } from 'jsdom';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createScanHandler } from '../api/scan.js';
import { runIdentify, runPrice, resetMarketCache } from '../api/_lib/scan/service.js';
import { resetFxCache } from '../api/_lib/scan/fx.js';
import { buildValuationRow } from '../api/_lib/scan/persist.js';
import { IMG, RAW_IDENTITY, NOW, fakeProvider } from './helpers/core-scan-fakes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'node_modules/.cache', `state-b-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
const src = (p) => join(ROOT, p).replace(/\\/g, '/');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
process.env.SCAN_STATE_SECRET = 's'.repeat(48);
delete process.env.CORE_SCAN_ENABLED;

let React, createRoot, act, ScanView, scan, dom, container, root, realFetch;
const app = { lang: 'en', rtl: false, calls: [] };

before(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const { build } = await import('rolldown');
  await build({
    input: 'virtual:entry',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    plugins: [{
      name: 'state-b-harness',
      resolveId(id) { if (id === 'virtual:entry') return id; if (/contexts\/AppContext$/.test(id)) return 'virtual:app'; return null; },
      load(id) {
        if (id === 'virtual:entry') return `export { default as ScanView } from '${src('src/views/ScanView.jsx')}';\nexport * as scan from '${src('src/lib/coreScan.js')}';`;
        if (id === 'virtual:app') return 'export const useApp = () => globalThis.__SCAN_TEST_APP__;';
        return null;
      },
    }],
    output: { dir: OUT_DIR, format: 'esm', entryFileNames: 'state-b.mjs' },
    logLevel: 'silent',
  });
  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MessageChannel', 'Element']) globalThis[k] = dom.window[k];
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default;
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ ScanView, scan } = await import(pathToFileURL(join(OUT_DIR, 'state-b.mjs')).href));
  realFetch = globalThis.fetch;
});
after(() => { globalThis.fetch = realFetch; try { rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });
afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  await act(async () => { scan.scanStore.reset(); });
  resetMarketCache(); resetFxCache();
});

// ── the fixtures: what the search model reports, before any check ─────────────────────────────────────────────────────
const DAY = '2026-10-01'; // five days before the suite's fixed "today" (NOW)
const ad = (n, price, over = {}) => ({ url: `https://www.homeless.co.il/yad2/viewad,90000${n}.aspx`, title: over.title ?? 'IKEA POÄNG armchair', price, currency: 'ILS', kind: 'used_listing', match: 'exact', market: 'IL', condition: 'good', page: 'listing', listed: DAY, stock: 'unknown', shipping: null, ...over });
const shop = { url: 'https://www.ikea.co.il/p/poang-1', title: 'IKEA POÄNG armchair', price: 549, currency: 'ILS', kind: 'new_retail', match: 'exact', market: 'IL', condition: 'new_sealed', page: 'shop_product', listed: null, stock: 'in_stock', shipping: null };
const POANG = { ...RAW_IDENTITY, category: 'Home', item_type: 'armchair', brand: 'IKEA', product_family: 'POÄNG', model: 'POÄNG', display_name: 'IKEA POÄNG', canonical_name: 'ikea poang armchair', color: 'Brown', market_class: 'furniture', search: { hebrew_name: 'כורסת פואנג', aliases: [], model_numbers: [] } };
const MOUSE = RAW_IDENTITY; // an exact-model product: one ad prices it; ads that disagree do not

/** The real handler over a fake provider; `rows` collects what the scan would store. */
function realApi({ identity, market, expand = [{ evidence: [] }], pages = {} }) {
  const reached = [...market.evidence, ...expand.flatMap((e) => e.evidence)].map((e) => e.url);
  const provider = fakeProvider({ identities: [identity], markets: [market], expand, reached, pageText: pages });
  const store = new Map();
  const rows = [];
  const handler = createScanHandler({
    verify: async (h) => (h === 'Bearer session' ? { id: '00000000-0000-4000-8000-00000000000b' } : null),
    charge: async () => ({ allowed: true, charged: true, limitType: null, retryAfter: 0 }),
    refund: async () => {},
    identify: (args) => runIdentify({ ...args, fetchImpl: provider }),
    price: (args) => runPrice({ ...args, fetchImpl: provider, now: () => NOW, parallel: false, store: { load: async (k) => store.get(k) ?? null, save: async (k, r) => { store.set(k, r); } }, marketplace: async () => [], marketplaceListings: async () => [] }),
    record: async (args) => { rows.push(buildValuationRow({ id: `val-${rows.length + 1}`, ...args })); return `val-${rows.length}`; },
    logEvent: async () => {},
  });
  const responses = [];
  globalThis.fetch = async (url, init) => {
    const res = await handler(new Request('https://getworth.test/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', authorization: init.headers?.Authorization ?? init.headers?.authorization ?? '' }, body: init.body }));
    // A chained answer is two lines (identity, then price); every line is kept.
    const lines = (await res.clone().text()).split(String.fromCharCode(10)).filter((l) => l.trim());
    for (const l of lines) responses.push(JSON.parse(l));
    return res;
  };
  return { rows, responses, provider };
}

async function scanWith(fixture, { lang = 'en' } = {}) {
  Object.assign(app, { lang, rtl: lang === 'he', calls: [] });
  for (const name of ['addPhoto', 'cancelPipeline', 'handleAdditionalFile', 'sellFromScan']) app[name] = (...args) => app.calls.push([name, ...args]);
  globalThis.__SCAN_TEST_APP__ = app;
  const api = realApi(fixture);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(ScanView)); });
  await act(async () => {
    await scan.startScan({ dataUrl: IMG, scanUuid: '11111111-2222-3333-4444-555555555555', lang, getToken: async () => 'session', compress: async (d) => d, assess: async () => null });
    await new Promise((r) => setTimeout(r, 20));
  });
  const priced = api.responses.find((r) => r?.valuation);
  return { ...api, priced, card: container.querySelector('[data-testid="scan-comparative"]'), text: container.textContent };
}
const headline = (card) => card?.querySelector('[data-testid="scan-comparative-price"]')?.textContent ?? null;
const listed = (card) => [...(card?.querySelectorAll('li') ?? [])].map((li) => li.textContent);

describe('SB-1 one or more genuine Israeli ads, no valuation: the API carries them and the screen shows them as they are', () => {
  test('SB-1a exactly one qualifying ad: its own price, never a range, never a worth or three prices', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [ad(1, 450)] } });
    assert.equal(r.priced.status, 'insufficient_evidence');
    assert.equal(r.priced.valuation.prices ?? null, null);
    assert.deepEqual([r.priced.valuation.comparative.count, r.priced.valuation.comparative.low], [1, null]);
    assert.ok(r.card, 'the State B card is on screen');
    assert.equal(headline(r.card), '₪450');
    assert.match(r.card.textContent, /One Israeli second-hand ad/);
    assert.match(r.card.textContent, /not a sale price and not an estimated worth/);
    assert.doesNotMatch(r.text, /Recommended listing price|Estimated worth|Quick sale/);
    assert.equal(listed(r.card).length, 1);
    assert.match(listed(r.card)[0], /homeless\.co\.il.*same model · active ad, seen 2026-10-06/, 'no date on the page: the day it was seen live');
  });
  test('SB-1a2 the ad\'s own date, when its page shows it', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [ad(1, 450)] }, pages: { [ad(1, 0).url]: 'IKEA POÄNG armchair ₪450 · פורסם 01/10/2026' } });
    assert.match(listed(r.card)[0], /same model · listed 2026-10-01/);
  });
  test('SB-1b two ads from different sellers that disagree: the observed lowest–highest, both listed with source and date', async () => {
    const r = await scanWith({ identity: MOUSE, market: { evidence: [ad(1, 200, { title: 'Logitech G Pro X Superlight' }), ad(2, 520, { title: 'Logitech G Pro X Superlight' })] } });
    assert.equal(r.priced.status, 'insufficient_evidence');
    assert.equal(r.priced.valuation.withdrawn, 'references_disagree');
    assert.equal(headline(r.card), '₪200–₪520');
    assert.match(r.card.textContent, /Comparative price range/);
    assert.match(r.card.textContent, /2 ads in Israel · low confidence/);
    assert.equal(listed(r.card).length, 2);
    assert.doesNotMatch(r.text, /Recommended listing price/);
  });
  test('SB-1c the same ad reported twice is one ad', async () => {
    const sl = { title: 'Logitech G Pro X Superlight' };
    const r = await scanWith({ identity: MOUSE, market: { evidence: [ad(1, 200, sl), ad(2, 520, sl), ad(2, 520, sl)] } });
    const c = r.priced.valuation.comparative;
    assert.ok(c, JSON.stringify(r.priced.valuation.withdrawn));
    assert.equal(c.count, 2, 'the same ad twice is one ad');
    assert.equal(new Set(c.observations.map((o) => o.url)).size, c.observations.length);
    assert.equal(listed(r.card).length, 2);
  });
  test('SB-1d exact and comparable are told apart: the count says how many are this exact model, each ad says which it is', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [ad(1, 450), ad(3, 120, { match: 'close_comparable', title: 'IKEA armchair birch' })] } });
    const c = r.priced.valuation.comparative;
    assert.ok(c, JSON.stringify([r.priced.status, r.priced.valuation.withdrawn]));
    assert.deepEqual([c.count, c.exact_count], [2, 1]);
    assert.match(r.card.textContent, /2 ads in Israel · 1 of this exact model · low confidence/);
    assert.ok(listed(r.card).some((t) => /comparable model/.test(t)));
    assert.ok(listed(r.card).some((t) => /same model/.test(t)));
  });
  test('SB-1e in Hebrew the card says what it is, right to left, with the price kept whole', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [ad(1, 450)] } }, { lang: 'he' });
    assert.equal(container.firstChild.getAttribute('dir'), 'rtl');
    assert.match(r.card.textContent, /מודעת יד שנייה אחת בישראל/);
    assert.match(r.card.textContent, /לא מחיר מכירה ולא שווי משוער/);
    assert.equal(headline(r.card), '₪450');
  });
});

describe('SB-2 what never reaches the card', () => {
  test('SB-2a another model or generation, a bundle, a sealed unit and an archived ad: no card, their prices nowhere on it', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [
      ad(4, 999, { match: 'sibling_model', title: 'IKEA STRANDMON armchair' }),
      ad(5, 777, { match: 'bundle', title: 'IKEA POÄNG armchair + footstool' }),
      ad(6, 555, { condition: 'new_sealed' }),
      ad(7, 333, { listed: '2024-03-01' }),
    ] }, pages: { [ad(7, 0).url]: 'IKEA POÄNG armchair ₪333 · פורסם 01/03/2024' } });
    const c = r.priced.valuation.comparative ?? null;
    for (const p of [999, 777, 555, 333]) assert.ok(!c?.observations?.some((o) => o.price_ils === p), `₪${p} is not comparative evidence`);
    if (!c) assert.equal(r.card, null);
  });
  test('SB-2b a new-shop price alone: the State C reference, apart; no comparative card and no worth', async () => {
    const r = await scanWith({ identity: MOUSE, market: { evidence: [{ ...shop, url: 'https://www.ksp.co.il/web/item/1', title: 'Logitech G Pro X Superlight' }] } });
    assert.equal(r.priced.valuation.comparative, null);
    assert.equal(r.card, null);
    assert.equal(r.priced.valuation.retail_new_ils, 550, 'the verified new price, rounded as every new price is');
    assert.match(r.text, /₪550/, 'shown as a new price');
    assert.match(r.text, /the new price in Israel is the ceiling/);
    assert.doesNotMatch(r.text, /Comparative price range|One Israeli second-hand ad|Recommended listing price/);
  });
  test('SB-2b2 no new price on screen: the no-price sentence never points at one (2026-11-15)', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [shop] } });
    assert.equal(r.priced.valuation.retail_new_ils ?? null, null, 'a similar item\'s shop price is not this item\'s new price');
    assert.doesNotMatch(r.text, /ceiling/);
    assert.match(r.text, /You can list it at your own price\. New Israeli listings appear daily/);
  });
  test('SB-2c nothing usable: no card, no number', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [] } });
    assert.equal(r.priced.valuation.comparative, null);
    assert.equal(r.card, null);
    assert.doesNotMatch(r.text, /₪\d/);
  });
  test('SB-2d a supported valuation (State A) is unchanged and carries no State B card', async () => {
    const r = await scanWith({ identity: MOUSE, market: { evidence: [ad(1, 260, { title: 'Logitech G Pro X Superlight' }), ad(2, 250, { title: 'Logitech G Pro X Superlight' })] } });
    assert.equal(r.priced.status, 'priced');
    assert.equal(r.priced.valuation.comparative, null);
    assert.equal(r.card, null);
    assert.match(r.text, /Recommended listing price/);
  });
});

describe('SB-3 from State B to a listing', () => {
  test('SB-3a Sell: the draft carries the ads for reference only, the price is the owner\'s to enter', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [ad(1, 450), ad(2, 120, { match: 'close_comparable', title: 'IKEA armchair birch' })] } });
    assert.equal(r.priced.status, 'insufficient_evidence');
    const draft = scan.buildListingDraft();
    assert.equal(draft.price, '', 'the price field starts empty: the owner enters it');
    assert.equal(draft.result.marketValue, null);
    assert.equal(draft.result.comparative.count, 2);
    assert.deepEqual([draft.result.comparative.low, draft.result.comparative.high], [120, 450]);
  });
  test('SB-3b the listing form shows the observed range as a reference line, and never prefills the price from it', () => {
    const sell = read('src/views/SellViews.jsx');
    assert.match(sell, /data-testid="listing-comparative"/);
    assert.doesNotMatch(sell, /price:\s*result\?\.comparative/);
  });
  test('SB-3c the owner\'s price after seeing State B is recorded after_reference: the stored scan row → the listing rule', async () => {
    const r = await scanWith({ identity: POANG, market: { evidence: [ad(1, 450)] } });
    const row = r.rows.at(-1);
    assert.equal(row.ai_raw_response.valuation.comparative.count, 1, 'the stored row keeps what was shown');
    const S1 = '00000000-0000-4000-8000-00000000000b';
    const d = new PGlite();
    await d.exec(read('tests/fixtures/db/marketplace-baseline.sql'));
    await d.exec('ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS valuation_version integer DEFAULT 1; ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS new_retail integer;');
    await d.exec(`INSERT INTO auth.users (id) VALUES ('${S1}');`);
    for (const m of ['20261108120000_marketplace_price_provenance', '20261108150000_marketplace_sale_evidence', '20261113190000_marketplace_listing_evidence',
      '20261115120000_first_party_evidence_classes', '20261115140000_first_party_identity_and_integrity', '20261115160000_comparative_is_reference']) await d.exec(read(`supabase/migrations/${m}.sql`));
    await d.exec(`INSERT INTO profiles (id, full_name) VALUES ('${S1}', 's');`);
    const v = (await d.query('INSERT INTO valuations (user_id, valuation_version, ai_raw_response) VALUES ($1, 3, $2) RETURNING id', [S1, JSON.stringify(row.ai_raw_response)])).rows[0].id;
    const origin = (await d.query(`INSERT INTO listings (seller_id, title, category, condition, price, status, valuation_id) VALUES ($1, 'IKEA POÄNG', 'Home', 'used', 420, 'active', $2) RETURNING price_origin`, [S1, v])).rows[0].price_origin;
    assert.equal(origin, 'after_reference', 'never independent: it cannot become market evidence of its own');
  });
});

describe('SB-4 the chained scan: identity then price on one request (2026-11-15)', () => {
  test('SB-4a one request, one search: the identity line arrives first, the price second, and the phone sends no price request', async () => {
    const r = await scanWith({ identity: MOUSE, market: { evidence: [ad(1, 260, { title: 'Logitech G Pro X Superlight' }), ad(2, 250, { title: 'Logitech G Pro X Superlight' })] } });
    const kinds = r.responses.map((x) => x?.status);
    assert.deepEqual(kinds.slice(0, 2), ['identified', 'priced']);
    assert.equal(r.responses[0].chained, true);
    assert.equal(r.provider.of('market').filter((c) => c.stage === 'local').length, 1, 'one Israeli search');
    assert.equal(r.provider.of('identity').length, 1);
    assert.match(r.text, /Recommended listing price/);
  });
  test('SB-4b a required question first: no chain, no search until it is answered', async () => {
    const asking = { ...MOUSE, exact_model_established: false, clarifications: [{ attribute: 'model', kind: 'choice', impact: 'high', affects: 'identity', question: 'Which model?', options: ['G Pro X Superlight', 'G Pro X Superlight 2'], unit: null }] };
    const r = await scanWith({ identity: asking, market: { evidence: [] } });
    assert.equal(r.responses[0].identity.followup.required, true, 'the fixture asks first');
    assert.notEqual(r.responses[0].chained, true);
    assert.equal(r.responses.length, 1, 'one line, plain JSON');
    assert.equal(r.provider.of('market').length, 0, 'no search before the answer');
  });
  test('SB-4c the stream ends without the price: the phone asks for it itself and shows it', async () => {
    const real = { identity: MOUSE, market: { evidence: [ad(1, 260, { title: 'Logitech G Pro X Superlight' }), ad(2, 250, { title: 'Logitech G Pro X Superlight' })] } };
    Object.assign(app, { lang: 'en', rtl: false, calls: [] });
    for (const name of ['addPhoto', 'cancelPipeline', 'handleAdditionalFile', 'sellFromScan']) app[name] = (...args) => app.calls.push([name, ...args]);
    globalThis.__SCAN_TEST_APP__ = app;
    realApi(real);
    const inner = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push(body.action);
      const res = await inner(url, init);
      if (body.action !== 'identify') return res;
      const first = (await res.text()).split(String.fromCharCode(10))[0];
      return new Response(`${first}\n`, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(ScanView)); });
    await act(async () => {
      await scan.startScan({ dataUrl: IMG, scanUuid: '11111111-2222-3333-4444-555555555555', lang: 'en', getToken: async () => 'session', compress: async (d) => d, assess: async () => null });
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.deepEqual(sent.filter((a) => a !== 'report'), ['identify', 'price']);
    assert.match(container.textContent, /Recommended listing price/);
  });
  test('SB-4d the server: a chained identify streams NDJSON; without chain it answers JSON as before', () => {
    const api = read('api/scan.js');
    assert.match(api, /const chain = body\?\.chain === true && result\.status === SCAN_STATUS\.IDENTIFIED/);
    assert.match(api, /result\.identity\?\.followup\?\.required !== true/);
    assert.match(api, /if \(!chain\) return done\(idPayload, 200, result\.call, idExtra\);/);
    assert.match(read('api/_lib/v2/http.js'), /if \(webRes\.body && \/ndjson\/\.test/);
  });
});
