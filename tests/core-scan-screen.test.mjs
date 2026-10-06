// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE SCREEN, RENDERED
//
// The real ScanView, bundled and mounted in jsdom against a fake /api/scan and
// a stand-in app context. What a person sees and can press at each point of a
// scan: the name before the price, the optional question with its one-tap answers, the
// condition that re-prices on the spot, the honest "not enough evidence", the
// two sheets, and Sell.
//
//   node --test tests/core-scan-screen.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMG, RAW_IDENTITY, PRICES, SOURCES } from './helpers/core-scan-fakes.mjs';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'node_modules/.cache', `core-scan-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
const src = (p) => join(ROOT, p).replace(/\\/g, '/');

let React, createRoot, act, ScanView, scan, dom, container, root, realFetch, requests;
const app = { lang: 'en', rtl: false, calls: [] };

before(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const { build } = await import('rolldown');
  await build({
    input: 'virtual:entry',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    plugins: [{
      name: 'core-scan-screen-harness',
      resolveId(id) {
        if (id === 'virtual:entry') return id;
        // The screen reads the app through useApp(); here that is a stand-in the tests control.
        if (/contexts\/AppContext$/.test(id)) return 'virtual:app';
        return null;
      },
      load(id) {
        if (id === 'virtual:entry') return `export { default as ScanView } from '${src('src/views/ScanView.jsx')}';\nexport * as scan from '${src('src/lib/coreScan.js')}';`;
        if (id === 'virtual:app') return 'export const useApp = () => globalThis.__SCAN_TEST_APP__;';
        return null;
      },
    }],
    output: { dir: OUT_DIR, format: 'esm', entryFileNames: 'scan-view.mjs' },
    logLevel: 'silent',
  });

  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MessageChannel', 'Element']) globalThis[k] = dom.window[k];
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = (await import('react')).default;
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  ({ ScanView, scan } = await import(pathToFileURL(join(OUT_DIR, 'scan-view.mjs')).href));
  realFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  try { rmSync(OUT_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});

afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  await act(async () => { scan.scanStore.reset(); });
});

const VALUATION = {
  status: 'priced', prices: PRICES, price_confidence: 'medium', retail_new_ils: 550, approximate: false, intl_adjusted: false, intl_scale: null,
  counts: { resale: 3, il_used_exact: 2, il_used_close: 0, intl_used_exact: 1, intl_used_close: 0, retail_il: 1, not_comparable: 1, set_aside: 1 },
  searched: { date: '2026-10-06', queries: 3, pages: 9 },
  evidence: [
    { url: SOURCES.IL_USED_1, domain: 'secondhand.example.co.il', title: 'G Pro X Superlight used', price: 260, currency: 'ILS', price_ils: 260, kind: 'used_listing', match: 'exact', market: 'IL', used: true, set_aside: null },
    { url: SOURCES.INTL_USED, domain: 'used.example.com', title: 'Superlight sold', price: 70, currency: 'USD', price_ils: 245, kind: 'sold', match: 'exact', market: 'INTL', used: true, set_aside: null },
    { url: SOURCES.IL_RETAIL, domain: 'shop.example.co.il', title: 'Superlight new', price: 549, currency: 'ILS', price_ils: 549, kind: 'new_retail', match: 'exact', market: 'IL', used: false, set_aside: null },
    { url: 'https://shop.example.co.il/p/pricey', domain: 'shop.example.co.il', title: 'Superlight overpriced', price: 900, currency: 'ILS', price_ils: 900, kind: 'used_listing', match: 'exact', market: 'IL', used: false, set_aside: 'above_new_price' },
    { url: 'https://shop.example.co.il/p/skates', domain: 'shop.example.co.il', title: 'Mouse skates', price: 40, currency: 'ILS', price_ils: 40, kind: 'new_retail', match: 'accessory', market: 'IL', used: false, set_aside: 'not_comparable' },
  ],
};
const UNPRICED = { ...VALUATION, status: 'insufficient_evidence', prices: null, price_confidence: null, counts: { ...VALUATION.counts, resale: 0, il_used_exact: 0, intl_used_exact: 0 }, evidence: [VALUATION.evidence[2]] };

function server(script) {
  requests = [];
  const queue = { identify: [...(script.identify ?? [])], price: [...(script.price ?? [])] };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const next = queue[body.action].shift();
    if (next?.hold) await next.hold;
    return new Response(JSON.stringify(next?.payload ?? { error: 'unscripted' }), { status: next?.status ?? (next ? 200 : 500) });
  };
}
const identified = (over = {}) => ({ payload: { status: 'identified', identity: normalizeIdentity({ ...RAW_IDENTITY, ...over }), default_condition: 'good', token: 'tok' } });
const pricedAnswer = (valuation = VALUATION) => ({ payload: { status: valuation.status === 'priced' ? 'priced' : 'insufficient_evidence', valuation, valuation_id: 'val-1' } });

async function open(script, { lang = 'en' } = {}) {
  Object.assign(app, { lang, rtl: lang === 'he', calls: [] });
  for (const name of ['addPhoto', 'cancelPipeline', 'handleAdditionalFile', 'sellFromScan']) app[name] = (...args) => app.calls.push([name, ...args]);
  globalThis.__SCAN_TEST_APP__ = app;
  server(script);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(ScanView)); });
  let run;
  await act(async () => {
    run = scan.startScan({ dataUrl: IMG, scanUuid: '11111111-2222-3333-4444-555555555555', lang, getToken: async () => 'session', compress: async (d) => d, assess: async () => null });
    await new Promise((r) => setTimeout(r, 15));
  });
  // Wrapped, so awaiting open() does not wait for the scan itself to finish.
  return { run };
}
const settle = async ({ run }) => { await act(async () => { await run; }); };
const text = () => container.textContent;
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const click = async (el) => { assert.ok(el, 'the control exists'); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 15)); }); };

describe('CV-1 the answer arrives in the order a person needs it', () => {
  test('CV-1a the item\'s name is on screen while the market is still being checked, and no price is shown yet', async () => {
    let release;
    const hold = new Promise((r) => { release = r; });
    const opened = await open({ identify: [identified()], price: [{ ...pricedAnswer(), hold }] });
    assert.match(text(), /Logitech G Pro X Superlight/);
    assert.match(text(), /Identity confidence: High/);
    assert.match(text(), /Checking today's market prices/);
    assert.doesNotMatch(text(), /₪/);
    assert.equal(button('Sell for ₪290'), undefined);
    release();
    await settle(opened);
    assert.match(text(), /Recommended listing price₪290/);
    assert.match(text(), /Expected selling range: ⁦₪240–270⁩/);
    assert.match(text(), /Price confidence: Medium/);
    assert.doesNotMatch(text(), /Checking today's market prices/);
  });
  test('CV-1b the condition is five choices on the result, and choosing one re-prices without a request', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }));
    const chips = ['New / Sealed', 'Like new', 'Good', 'Fair', 'Poor'].map(button);
    assert.ok(chips.every(Boolean));
    assert.equal(button('Good').getAttribute('aria-pressed'), 'true');
    assert.match(text(), /Visible condition appears Good\./);
    assert.doesNotMatch(text(), /adjustment from the listings found/, 'Good is what the listings showed');
    const before = requests.length;
    await click(button('Like new'));
    assert.match(text(), /Recommended listing price₪340/);
    assert.match(text(), /The price for this condition is an adjustment from the listings found, not taken from listings in this condition\./);
    assert.ok(button('Sell for ₪340'));
    await click(button('Poor'));
    assert.match(text(), /Expected selling range: ⁦₪100–130⁩/);
    assert.equal(requests.length, before);
  });
  test('CV-1c Sell hands the scan to the listing', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }));
    await click(button('Sell for ₪290'));
    assert.deepEqual(app.calls.map((c) => c[0]), ['sellFromScan']);
  });
  test('CV-1d in Hebrew the screen is right-to-left and says it in Hebrew', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }, { lang: 'he' }));
    assert.equal(container.firstChild.getAttribute('dir'), 'rtl');
    assert.match(text(), /מחיר מומלץ לפרסום/);
    assert.match(text(), /ביטחון בזיהוי: גבוה/);
    assert.ok(button('למכור ב־⁦₪290⁩'));
  });
});

describe('CV-2 the one question sits beside the price, never in front of it', () => {
  const CHOICE = { kind: 'choice', affects: 'price', question: 'What storage size is it?', options: ['128 GB', '256 GB'] };
  test('CV-2a the price is already there; the options are one tap each and an answer re-prices', async () => {
    await settle(await open({ identify: [identified({ followup: CHOICE })], price: [pricedAnswer(), pricedAnswer()] }));
    assert.match(text(), /Recommended listing price₪290/);
    assert.match(text(), /For a more exact price/);
    assert.match(text(), /What storage size is it\?/);
    assert.ok(button('128 GB') && button('256 GB') && button('Not sure'));
    assert.equal(requests.length, 2);
    await click(button('256 GB'));
    assert.equal(requests[2].answer, 1);
    assert.match(text(), /Recommended listing price₪290/);
    assert.doesNotMatch(text(), /What storage size is it\?/, 'answered, the question is gone');
  });
  test('CV-2b "Not sure" puts the question away and asks the server nothing', async () => {
    await settle(await open({ identify: [identified({ followup: CHOICE })], price: [pricedAnswer()] }));
    await click(button('Not sure'));
    assert.doesNotMatch(text(), /What storage size is it\?/);
    assert.match(text(), /Recommended listing price₪290/);
    assert.equal(requests.length, 2);
  });
  test('CV-2c a photograph request offers the camera and an upload, beside a price that is already shown', async () => {
    const PHOTO = { kind: 'photo', affects: 'identity', question: 'Take one photo of the underside label', options: [] };
    await settle(await open({ identify: [identified({ followup: PHOTO, uncertainty_note: 'Exact generation uncertain', identity_confidence: 'medium' })], price: [pricedAnswer()] }));
    assert.match(text(), /Exact generation uncertain/);
    assert.match(text(), /Identity confidence: Medium/);
    assert.match(text(), /Recommended listing price₪290/);
    assert.ok(button('Upload a photo'));
    await click(button('Take the photo'));
    assert.deepEqual(app.calls.at(-1), ['addPhoto', 'camera']);
  });
});

describe('CV-3 honest when it cannot price', () => {
  test('CV-3a identified but unpriced says so, shows the new price as context only, and still lets the owner sell', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer(UNPRICED)] }));
    assert.match(text(), /I identified this as Logitech G Pro X Superlight, but I don't have enough reliable current second-hand evidence/);
    assert.match(text(), /New, it currently sells for about ₪550 in Israel\./);
    assert.doesNotMatch(text(), /Recommended listing price/);
    assert.ok(button('Sell at your own price'));
    assert.ok(button('What I found'));
  });
  test('CV-3b a failure keeps the item on screen and offers the step again', async () => {
    await settle(await open({ identify: [identified()], price: [{ payload: { status: 'failed', failure: 'timeout' } }, pricedAnswer()] }));
    assert.match(text(), /Logitech G Pro X Superlight/);
    assert.match(container.querySelector('[role="alert"]').textContent, /Something went wrong/);
    await click(button('Try again'));
    assert.deepEqual(requests.map((r) => r.action), ['identify', 'price', 'price']);
    assert.match(text(), /Recommended listing price₪290/);
  });
  test('CV-3c nothing to sell in the photograph', async () => {
    await settle(await open({ identify: [{ payload: { status: 'no_item', identity: normalizeIdentity({ ...RAW_IDENTITY, is_sellable_item: false }), token: 't' } }] }));
    assert.match(text(), /couldn't find an item to sell/);
    assert.doesNotMatch(text(), /Identity confidence/);
  });
});

describe('CV-5 a price never claims more than its evidence', () => {
  const GENERATION = { kind: 'choice', affects: 'price', question: 'Which generation are these?', options: ['1st generation', '2nd generation'] };
  test('CV-5a thin evidence is said beside the price it weakens', async () => {
    const thin = { ...VALUATION, price_confidence: 'low', counts: { ...VALUATION.counts, resale: 1, il_used_exact: 0, il_used_close: 0, intl_used_exact: 1 } };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(thin)] }));
    assert.match(text(), /Price confidence: Low/);
    assert.match(text(), /Rough estimate: based on one second-hand reference\./);
    assert.match(text(), /No Israeli second-hand prices were found; this rests on prices abroad\./);
  });
  test('CV-5b three references from Israel carry neither warning', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }));
    assert.doesNotMatch(text(), /Rough estimate|prices abroad/);
  });
  test('CV-5c while the exact model is an open question, the screen shows a range for the family, not one confident price', async () => {
    const approx = { ...VALUATION, approximate: true, price_confidence: 'low' };
    await settle(await open({ identify: [identified({ followup: GENERATION, display_name: 'Apple AirPods Pro', uncertainty_note: 'Generation not established', identity_confidence: 'medium' })], price: [pricedAnswer(approx), pricedAnswer()] }));
    assert.match(text(), /Approximate selling range\u2066₪240–270\u2069/);
    assert.match(text(), /The exact model is not confirmed, so this is a range for the product family\./);
    assert.doesNotMatch(text(), /Recommended listing price/);
    assert.ok(button('Sell for about ₪290'));
    assert.equal(button('Sell for ₪290'), undefined);
    await click(button('2nd generation'));
    assert.equal(requests[2].answer, 1);
    assert.match(text(), /Recommended listing price₪290/, 'answered, the price is exact');
    assert.doesNotMatch(text(), /Approximate selling range/);
  });
  test('CV-5d "Not sure" keeps the approximate range honest: it stays approximate', async () => {
    const approx = { ...VALUATION, approximate: true, price_confidence: 'low' };
    await settle(await open({ identify: [identified({ followup: GENERATION })], price: [pricedAnswer(approx)] }));
    await click(button('Not sure'));
    assert.doesNotMatch(text(), /Which generation are these\?/);
    assert.match(text(), /Approximate selling range/, 'not knowing does not make the price exact');
    assert.match(text(), /Price confidence: Low/);
    assert.equal(requests.length, 2);
  });
});

describe('CV-4 the two sheets', () => {
  test('CV-4a "Wrong item?" takes one line of the owner\'s words and the scan looks again', async () => {
    await settle(await open({ identify: [identified(), identified({ display_name: 'Logitech G Pro Wireless' })], price: [pricedAnswer(), pricedAnswer()] }));
    await click(button('Wrong item?'));
    const dialog = container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    const field = dialog.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, 'Actually this is a Logitech G Pro Wireless');
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await act(async () => { dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 30)); });
    assert.equal(requests[2].correction, 'Actually this is a Logitech G Pro Wireless');
    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.match(text(), /Logitech G Pro Wireless/);
  });
  test('CV-4b "Why this price?" says how the price was calculated and shows what it rests on, as links; what was set aside is counted, not listed', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }));
    await click(button('Why this price?'));
    const dialog = container.querySelector('[role="dialog"]');
    const said = dialog.textContent;
    assert.match(said, /calculated from these references, not chosen/);
    assert.match(said, /asking prices reduced by 10% for negotiation/);
    assert.match(said, /3 second-hand references/);
    assert.match(said, /2 from Israel · 1 from abroad/);
    assert.match(said, /New in Israel: about ₪550/);
    assert.match(said, /Prices from abroad are converted to shekels but not adjusted to Israeli price level\./);
    assert.match(said, /Prices for other conditions are a standard adjustment from Good condition, not separate market findings\./);
    assert.match(said, /2 other results were set aside/);
    assert.match(said, /Market searched on 2026-10-06/);
    const links = [...dialog.querySelectorAll('a')];
    assert.deepEqual(links.map((a) => a.getAttribute('href')), [SOURCES.IL_USED_1, SOURCES.INTL_USED, SOURCES.IL_RETAIL]);
    assert.ok(links.every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel') === 'noopener noreferrer'));
    assert.match(links[1].textContent, /70 USD/);
    assert.match(links[1].textContent, /≈ ₪245/);
    assert.doesNotMatch(said, /Mouse skates|overpriced/);
  });
  test('CV-4c when foreign prices were scaled to Israeli price level, the sheet says by how much', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer({ ...VALUATION, intl_adjusted: true, intl_scale: 1.22 })] }));
    await click(button('Why this price?'));
    assert.match(container.querySelector('[role="dialog"]').textContent, /scaled to Israeli price level \(×1\.22\)/);
  });
});
