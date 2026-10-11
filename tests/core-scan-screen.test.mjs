// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE SCREEN, RENDERED
//
// The real ScanView, bundled and mounted in jsdom against a fake /api/scan and
// a stand-in app context. What a person sees and can press at each point of a
// scan: the name before the price, the optional question with its one-tap answers, the
// condition that re-prices on the spot, the honest "not enough evidence", the
// two sheets, Sell — and that a Hebrew screen keeps a brand name in its own
// order and five condition choices in one row.
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
  basis: 'this_item', dispersed: false, reference_range: { low: 245, high: 260 },
  counts: { resale: 3, il_used_exact: 2, il_used_close: 0, intl_used_exact: 1, intl_used_close: 0, retail_il: 1, not_comparable: 1, set_aside: 1, abroad_unused: 0 },
  searched: { date: '2026-10-06', queries: 3, pages: 9 },
  evidence: [
    { url: SOURCES.IL_USED_1, domain: 'secondhand.example.co.il', title: 'G Pro X Superlight used', price: 260, currency: 'ILS', price_ils: 260, kind: 'used_listing', match: 'exact', market: 'IL', page: 'listing', listed: '2026-10-01', freshness: 'current', used: true, set_aside: null },
    { url: SOURCES.INTL_USED, domain: 'used.example.com', title: 'Superlight sold', price: 70, currency: 'USD', price_ils: 245, kind: 'sold', match: 'exact', market: 'INTL', page: 'listing', listed: null, freshness: 'unknown', used: true, set_aside: null },
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
// `server` is what the server adds after normalising: a required question, what the identity still lacks.
const identified = (over = {}, server = {}) => ({ payload: { status: 'identified', identity: { ...normalizeIdentity({ ...RAW_IDENTITY, ...over }), ...server }, default_condition: 'good', token: 'tok' } });
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
    const chips = ['New', 'Like new', 'Good', 'Fair', 'Poor'].map(button);
    assert.ok(chips.every(Boolean));
    assert.deepEqual(chips.map((b) => b.getAttribute('aria-label')), ['New / Sealed', 'Like new', 'Good', 'Fair', 'Poor'], 'the short label is for the eye; the full name is the control\'s name');
    assert.equal(button('Good').getAttribute('aria-pressed'), 'true');
    assert.match(text(), /Visible condition appears Good\./);
    assert.doesNotMatch(text(), /adjusted for the condition/, 'Good is what every listing is brought to');
    const before = requests.length;
    await click(button('Like new'));
    assert.match(text(), /Recommended listing price₪340/);
    assert.match(text(), /The price was adjusted for the condition you chose\./);
    assert.doesNotMatch(text(), /not taken from listings|adjustment from the listings/, 'said simply');
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
  test('CV-1e the five conditions are ONE row of five equal columns, in both languages: none wraps onto a line of its own', async () => {
    for (const lang of ['he', 'en']) {
      await settle(await open({ identify: [identified()], price: [pricedAnswer()] }, { lang }));
      const group = container.querySelector('[role="group"]');
      const chips = [...group.children];
      assert.equal(chips.length, 5);
      assert.ok(chips.every((b) => b.tagName === 'BUTTON' && b.parentElement === group), 'all five are direct children of one grid');
      assert.match(group.className, /\bgrid\b/);
      assert.match(group.className, /\bgrid-cols-5\b/);
      assert.doesNotMatch(group.className, /flex-wrap/);
      assert.ok(chips.every((b) => /\bmin-h-tap\b/.test(b.className)), 'each is a full-height tap target');
      // A fifth of a 320px phone, less the gutters and gaps, is about 52px: room for two short words, not a phrase.
      for (const b of chips) assert.ok(b.textContent.length <= 8 && b.textContent.split(' ').every((w) => w.length <= 5), `"${b.textContent}" fits a fifth of a phone`);
      assert.equal(chips.filter((b) => b.getAttribute('aria-pressed') === 'true').length, 1);
      await act(async () => { root.unmount(); }); root = null; container.remove(); container = null;
      await act(async () => { scan.scanStore.reset(); });
    }
  });
});

describe('CV-6 a Hebrew screen with an English name in it', () => {
  const bdis = (el) => [...el.querySelectorAll('bdi[dir="ltr"]')].map((b) => b.textContent);
  test('CV-6a the product name keeps its own left-to-right order and does not turn the heading around', async () => {
    await settle(await open({ identify: [identified({ display_name: 'Logitech G Pro Wireless', color: 'Black' })], price: [pricedAnswer()] }, { lang: 'he' }));
    const h1 = container.querySelector('h1');
    assert.equal(h1.getAttribute('dir'), null, 'the heading follows the screen: right-to-left');
    assert.deepEqual(bdis(h1), ['Logitech G Pro Wireless'], 'the whole name is one isolated left-to-right run');
    assert.match(h1.nextElementSibling.textContent, /^שחור$/, 'a colour is a description: it is shown in Hebrew');
    assert.doesNotMatch(text(), /Black/);
  });
  test('CV-6b a name that mixes Hebrew and English isolates only the English, in the order it was written', async () => {
    await settle(await open({ identify: [identified({ display_name: 'עכבר גיימינג Logitech G Pro אלחוטי', color: 'Graphite', size_or_capacity: '256 GB', uncertainty_note: 'ייתכן שזה דגם G Pro X' })], price: [pricedAnswer()] }, { lang: 'he' }));
    const h1 = container.querySelector('h1');
    assert.equal(h1.textContent, 'עכבר גיימינג Logitech G Pro אלחוטי');
    assert.deepEqual(bdis(h1), ['Logitech G Pro']);
    const details = h1.nextElementSibling;
    assert.deepEqual(bdis(details), ['Graphite', '256 GB'], 'a colour with no Hebrew name is left as it is, and isolated');
    assert.deepEqual(bdis(details.nextElementSibling), ['G Pro X']);
  });
  test('CV-6c in English nothing is translated', async () => {
    await settle(await open({ identify: [identified({ color: 'Black' })], price: [pricedAnswer()] }));
    assert.match(container.querySelector('h1').nextElementSibling.textContent, /^Black$/);
  });
  test('CV-6d "למה המחיר הזה?" reads as Hebrew, with every source\'s name, kind, place and age in their own order', async () => {
    const he = { ...VALUATION, evidence: VALUATION.evidence.map((e, k) => (k === 0 ? { ...e, title: 'Logitech G Pro X Superlight יד שנייה' } : e)) };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(he)] }, { lang: 'he' }));
    await click(button('למה המחיר הזה?'));
    const dialog = container.querySelector('[role="dialog"]');
    const said = dialog.textContent;
    assert.match(said, /3 מודעות יד שנייה נמצאו/);
    assert.match(said, /ישראל: 2 · חו״ל: 1/);
    assert.match(said, /טווח המחירים במודעות: ⁦₪245–260⁩/);
    assert.match(said, /מחיר חדש בישראל: ₪550/);
    assert.match(said, /רמת ביטחון: בינוני/);
    const [first, second] = [...dialog.querySelectorAll('a')];
    assert.deepEqual(bdis(first).slice(0, 2), ['Logitech G Pro X Superlight', 'secondhand.example.co.il']);
    assert.match(first.textContent, /משומש · מדויק · ישראל · עדכני/);
    assert.match(second.textContent, /נמכר · מדויק · חו״ל/);
    assert.doesNotMatch(second.textContent, /עדכני|ישן/, 'a listing with no date says nothing about its age');
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
  test('CV-2d the one exception: a photograph the SERVER requires comes before the price, with no "not sure", no price, no "What I found" — and the owner can still sell or correct', async () => {
    const LABEL = { kind: 'photo', affects: 'identity', question: 'Take a clear photo of the label or the sticker on the bottom of the bottle, so the fragrance name and size can be read.', options: [], required: true };
    await settle(await open({ identify: [identified({ display_name: 'BDK Parfums perfume', brand: 'BDK Parfums', model: null, product_family: null, item_type: 'perfume', category: 'Beauty', identity_confidence: 'medium' }, { followup: LABEL, incomplete: 'fragrance_name_or_size' })] }));
    assert.deepEqual(requests.map((r) => r.action), ['identify']);
    assert.match(text(), /I can see this is BDK Parfums perfume, but not the exact product\. A market price needs that first, so the market was not searched yet\./);
    assert.match(text(), /One thing before the price/);
    assert.match(text(), /label or the sticker on the bottom of the bottle/);
    assert.doesNotMatch(text(), /₪|Recommended|Checking today's market prices|For a more exact price|Not sure/);
    assert.ok(button('Take the photo') && button('Upload a photo') && button('Sell at your own price') && button('Wrong item?') && button('Scan another item'));
    assert.equal(button('What I found'), undefined);
  });
  test('CV-2e a choice the server requires (how much perfume is left) is asked before the price; "Not sure" sends the search off with that', async () => {
    const LEFT = { kind: 'choice', affects: 'price', question: 'How much perfume is left in the bottle?', options: ['Full or sealed', 'About 75%', 'About half', 'Under 25%'], required: true };
    await settle(await open({ identify: [identified({}, { followup: LEFT })], price: [pricedAnswer({ ...VALUATION, approximate: true, price_confidence: 'low' })] }));
    assert.match(text(), /One thing before the price/);
    assert.match(text(), /How much perfume is left in the bottle\?/);
    assert.doesNotMatch(text(), /₪/);
    assert.ok(button('About half') && button('Not sure'));
    await click(button('Not sure'));
    assert.deepEqual(requests.map((r) => [r.action, r.answer]), [['identify', undefined], ['price', 'unsure']]);
    assert.match(text(), /Approximate selling range/);
  });
  test('CV-2f the same, in Hebrew', async () => {
    const LABEL = { kind: 'photo', affects: 'identity', question: 'צלמו בבירור את התווית או את המדבקה בתחתית הבקבוק, כדי שאפשר יהיה לקרוא את שם הבושם ואת הנפח.', options: [], required: true };
    await settle(await open({ identify: [identified({ display_name: 'בושם BDK Parfums' }, { followup: LABEL, incomplete: 'fragrance_name_or_size' })] }, { lang: 'he' }));
    assert.match(text(), /זיהיתי שזה בושם BDK Parfums, אבל לא את המוצר המדויק\./);
    assert.match(text(), /דבר אחד לפני המחיר/);
    assert.match(text(), /שם הבושם ואת הנפח/);
    assert.ok(button('לצלם') && button('למכור במחיר שלי') && button('פריט שגוי?'));
    assert.equal(button('לא בטוח/ה'), undefined);
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
  test('CV-3d the live shape of 2026-10-11: a sealed ad above the new price and a shop\'s refurbished unit alone — "What I found" says why each was not used, and no used price is shown', async () => {
    const live = {
      ...UNPRICED, withdrawn: 'no_verified_israeli_second_hand_reference', no_price_reason: 'no_verified_israeli_second_hand_reference',
      retail_new_ils: 400, retail_new_in_stock: false, retail_new_range: { low: 400, high: 660, dispersed: true },
      counts: { ...UNPRICED.counts, retail_il: 2, retail_refurbished: 1, set_aside: 3, not_comparable: 0 },
      evidence: [
        { url: 'https://m.homeless.co.il/yad2/viewad%2C994310.aspx', domain: 'm.homeless.co.il', title: 'g pro wireless', price: 430, currency: 'ILS', price_ils: 430, kind: 'used_listing', kind_claimed: 'other', match: 'exact', market: 'IL', page: 'listing', listed: '2025-04-11', freshness: 'older', used: false, set_aside: 'above_new_price' },
        { url: 'https://www.ivory.co.il/catalog.php?id=121262', domain: 'ivory.co.il', title: 'refurbished', price: 389, currency: 'ILS', price_ils: 389, kind: 'refurbished', match: 'exact', market: 'IL', page: 'shop_product', stock: 'out_of_stock', freshness: 'unknown', used: false, set_aside: 'retail_refurbished_without_private_resale' },
        { url: 'https://www.reddit.com/r/hardwareswap/comments/x', domain: 'reddit.com', title: '[USA-IL] [H] Logitech G Pro Wireless', price: 62, currency: 'USD', price_ils: 189, kind: 'used_listing', match: 'exact', market: 'INTL', page: 'other', freshness: 'unknown', used: false, set_aside: 'abroad_without_israeli_reference' },
        { url: 'https://www.zap.co.il/model.aspx?modelid=1005972', domain: 'zap.co.il', title: 'zap', price: 659, currency: 'ILS', price_ils: 659, kind: 'new_retail', match: 'exact', market: 'IL', page: 'shop_product', stock: 'in_stock', used: false, set_aside: null },
        { url: 'https://www.bug.co.il/brand/logitech/gprowireless/', domain: 'bug.co.il', title: 'new', price: 399, currency: 'ILS', price_ils: 399, kind: 'new_retail', match: 'exact', market: 'IL', page: 'shop_product', stock: 'out_of_stock', used: false, set_aside: null },
      ],
    };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(live)] }));
    assert.doesNotMatch(text(), /Recommended listing price|Sell for|₪430|₪389|₪190/, 'no used price, invented or borrowed, and no "Sell for ₪X"');
    assert.match(text(), /New, it was listed at about ₪400 in Israel; that shop is currently out of stock\./);
    assert.ok(button('Sell at your own price'));
    await click(button('What I found'));
    const said = container.querySelector('[role="dialog"]').textContent;
    assert.match(said, /No second-hand listings were found/);
    assert.match(said, /No current second-hand listing for a used unit of this item was verified in Israel\./);
    assert.match(said, /New in Israel: ₪400 \(out of stock\)/);
    assert.match(said, /Shops disagree on the new price: from ₪400 to ₪660\./);
    assert.match(said, /1 price was higher than the item's new price, so it is not a second-hand price and was not used\./);
    assert.match(said, /1 refurbished offer from a shop was found\. Without a private second-hand listing to support it, it was not used as a used price\./);
    assert.match(said, /1 listing from abroad was found\. Without an Israeli second-hand listing to compare it with, it is context only/);
    assert.doesNotMatch(said, /Confidence|set aside/);
    // Every verified price is shown, each labelled for what it is, each a link — in its group: context first (the
    // refurbished unit, the listing abroad, the two new prices), then, behind one tap, what was not usable (the ad
    // above the new price). Nothing is "used".
    const dialog = container.querySelector('[role="dialog"]');
    assert.doesNotMatch(said, /Used for the price/);
    assert.match(said, /Context only, not used for the price · 4/);
    assert.match(said, /Not this product, or not usable · 1/);
    const links = [...dialog.querySelectorAll('a')];
    assert.deepEqual(links.map((a) => a.getAttribute('href')), [live.evidence[1], live.evidence[2], live.evidence[3], live.evidence[4], live.evidence[0]].map((e) => e.url));
    assert.match(links[0].textContent, /Refurbished · exact · Israel/);
    assert.match(links[0].textContent, /a shop's refurbished unit, no private listing beside it/, 'each unused source says in one line why');
    assert.match(links[1].textContent, /Used · exact · abroad/);
    assert.match(links[1].textContent, /62 USD/);
    assert.match(links[1].textContent, /abroad, no Israeli listing to compare with/);
    assert.match(links[2].textContent, /New · exact · Israel/);
    assert.match(links[4].textContent, /Used · exact · Israel · older/);
    assert.match(links[4].textContent, /above the new price/);
    assert.ok(links[4].closest('details'), 'the rejected result sits behind one tap');
    assert.equal(links[0].closest('details'), null, 'the context does not');
    // Titles wrap instead of being clipped, and the price column keeps its width.
    assert.ok(links.every((a) => a.querySelector('.line-clamp-2') && !a.querySelector('.truncate')));
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
    assert.match(text(), /Rough estimate: based on one second-hand listing\./);
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
    assert.match(text(), /The exact model is not confirmed\. This range is based on comparable models of the same family, not on the exact product\./);
    assert.doesNotMatch(text(), /Recommended listing price/);
    assert.ok(button('Sell for about ₪290'));
    assert.equal(button('Sell for ₪290'), undefined);
    await click(button('2nd generation'));
    assert.equal(requests[2].answer, 1);
    assert.match(text(), /Recommended listing price₪290/, 'answered, the price is exact');
    assert.doesNotMatch(text(), /Approximate selling range/);
  });
  test('CV-5g an unconfirmed model with NO open question is still a range from comparable models, never an exact-looking listing price — in both languages', async () => {
    const family = { ...VALUATION, approximate: true, family_level: true, basis: 'product_family', price_confidence: 'low' };
    const quiet = { display_name: 'Apple AirPods Pro', model: null, exact_model_established: false, alternatives: [{ name: 'Apple AirPods Pro (1st generation)', distinguishing: null }, { name: 'Apple AirPods Pro (2nd generation)', distinguishing: null }], identity_confidence: 'medium' };
    await settle(await open({ identify: [identified(quiet)], price: [pricedAnswer(family)] }));
    assert.match(text(), /Approximate selling range⁦₪240–270⁩/);
    assert.match(text(), /based on comparable models of the same family, not on the exact product/);
    assert.match(text(), /Price confidence: Low/);
    assert.doesNotMatch(text(), /Recommended listing price|Expected selling range/);
    assert.ok(button('Sell for about ₪290') && !button('Sell for ₪290'));
    await click(button('Why this price?'));
    assert.match(container.querySelector('[role="dialog"]').textContent, /listings are for comparable models of the same family, not for the exact product/);
    await act(async () => { root.unmount(); }); root = null; container.remove(); container = null;
    await act(async () => { scan.scanStore.reset(); });
    await settle(await open({ identify: [identified(quiet)], price: [pricedAnswer(family)] }, { lang: 'he' }));
    assert.match(text(), /טווח מכירה משוער/);
    assert.match(text(), /הטווח מבוסס על דגמים דומים מאותה משפחה, ולא על המוצר המדויק\./);
    assert.doesNotMatch(text(), /מחיר מומלץ לפרסום/);
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
  test('CV-5f prices that are far apart are shown as a range, not as one confident number', async () => {
    const dispersed = { ...VALUATION, dispersed: true, price_confidence: 'low' };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(dispersed)] }));
    assert.match(text(), /Approximate selling range\u2066₪240–270\u2069/);
    assert.match(text(), /The prices found are far apart, so the range is wide\./);
    assert.match(text(), /Price confidence: Low/);
    assert.doesNotMatch(text(), /Recommended listing price|not confirmed|similar models/);
    assert.ok(button('Sell for about ₪290'));
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
  test('CV-4b "Why this price?" says how the price was calculated and shows what it rests on, as links; what was set aside is counted and kept behind one tap', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }));
    await click(button('Why this price?'));
    const dialog = container.querySelector('[role="dialog"]');
    const said = dialog.textContent;
    assert.match(said, /calculated from these listings, not chosen/);
    assert.match(said, /Listings from Israel count most/);
    assert.match(said, /Asking prices are lowered by an assumed 10% for negotiation\./);
    assert.match(said, /3 second-hand listings found/);
    assert.match(said, /Israel: 2 · Abroad: 1/);
    assert.match(said, /Price range of these listings: ⁦₪245–260⁩/);
    assert.match(said, /New in Israel: ₪550/);
    assert.match(said, /Confidence: Medium/);
    assert.match(said, /Prices from abroad were converted to shekels but could not be adjusted to Israeli price level, so they count for little\./);
    assert.match(said, /Prices for other conditions are a standard adjustment from Good condition, not separate market findings\./);
    // Each set-aside price says why it was not used, instead of one count for all of them.
    assert.match(said, /1 price was higher than the item's new price, so it is not a second-hand price and was not used\./);
    assert.match(said, /1 result was a different product or variant, an accessory or a part, so it was not used\./);
    assert.doesNotMatch(said, /set aside/);
    assert.match(said, /Market searched on 2026-10-06/);
    // Three groups: what the price rests on, the new price as context, and — behind one tap — what was not usable.
    assert.match(said, /Used for the price · 2/);
    assert.match(said, /Context only, not used for the price · 1/);
    assert.match(said, /Not this product, or not usable · 2/);
    const links = [...dialog.querySelectorAll('a')];
    assert.deepEqual(links.map((a) => a.getAttribute('href')), [SOURCES.IL_USED_1, SOURCES.INTL_USED, SOURCES.IL_RETAIL, 'https://shop.example.co.il/p/pricey', 'https://shop.example.co.il/p/skates']);
    assert.ok(links.slice(0, 3).every((a) => !a.closest('details')) && links.slice(3).every((a) => a.closest('details')));
    assert.match(links[3].textContent, /above the new price/);
    assert.match(links[4].textContent, /a different product, accessory or part/);
    // How it was worked out is there, behind one tap.
    assert.ok([...dialog.querySelectorAll('details summary')].some((s) => /How this was worked out/.test(s.textContent)));
    assert.ok(links.every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel') === 'noopener noreferrer'));
    assert.match(links[0].textContent, /Used · exact · Israel · current/, 'what it is, how exact, where from, how fresh');
    assert.match(links[1].textContent, /Sold · exact · abroad$|Sold · exact · abroad[^·]/);
    assert.doesNotMatch(links[1].textContent, /current|recent|older/, 'no date on the page, so no age is claimed');
    assert.match(links[2].textContent, /New · exact · Israel/);
    assert.match(links[1].textContent, /70 USD/);
    assert.match(links[1].textContent, /≈ ₪245/);
  });
  test('CV-4g a shop\'s refurbished offer that was used is counted as support, not as a second-hand listing', async () => {
    const v = {
      ...VALUATION, counts: { ...VALUATION.counts, resale: 4, il_used_exact: 3, refurbished_used: 1 },
      evidence: [...VALUATION.evidence, { url: 'https://www.ivory.co.il/catalog.php?id=121262', domain: 'ivory.co.il', title: 'refurbished', price: 389, currency: 'ILS', price_ils: 389, kind: 'refurbished', match: 'exact', market: 'IL', page: 'shop_product', stock: 'out_of_stock', freshness: 'unknown', used: true, weight: 0.22, set_aside: null }],
    };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(v)] }));
    await click(button('Why this price?'));
    const said = container.querySelector('[role="dialog"]').textContent;
    assert.match(said, /3 second-hand listings found/);
    assert.match(said, /Israel: 2 · Abroad: 1/);
    assert.match(said, /Also used, with a smaller weight: 1 refurbished offer from a shop, as supporting evidence\./);
    assert.match([...container.querySelectorAll('[role="dialog"] a')].find((a) => a.getAttribute('href').includes('ivory')).textContent, /Refurbished · exact · Israel/);
  });
  test('CV-4c when foreign prices were scaled to Israeli price level, the sheet says by how much', async () => {
    await settle(await open({ identify: [identified()], price: [pricedAnswer({ ...VALUATION, intl_adjusted: true, intl_scale: 1.22 })] }));
    await click(button('Why this price?'));
    assert.match(container.querySelector('[role="dialog"]').textContent, /scaled to Israeli price level \(×1\.22\)/);
  });
  test('CV-4d when Israeli listings were enough, prices from abroad are said to be unused, not rejected', async () => {
    const local = { ...VALUATION, intl_adjusted: null, counts: { ...VALUATION.counts, resale: 2, intl_used_exact: 0, abroad_unused: 1, set_aside: 0, not_comparable: 0 } };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(local)] }));
    await click(button('Why this price?'));
    const said = container.querySelector('[role="dialog"]').textContent;
    assert.match(said, /Israel: 2 · Abroad: 0/);
    assert.match(said, /The Israeli listings were enough to price this, so 1 price from abroad was not used\./);
    assert.doesNotMatch(said, /set aside|could not be adjusted/);
  });
  test('CV-4e prices that could not be tied to the item are said to be unused; an out-of-stock new price says so; shipping sits beside its price', async () => {
    const v = {
      ...VALUATION, retail_new_in_stock: false, counts: { ...VALUATION.counts, unbound: 2 },
      evidence: VALUATION.evidence.map((e, k) => (k === 1 ? { ...e, shipping: 26, shipping_ils: 91 } : e)),
    };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(v)] }));
    await click(button('Why this price?'));
    const dialog = container.querySelector('[role="dialog"]');
    const said = dialog.textContent;
    assert.match(said, /2 prices were found on pages where they could not be tied to this item for certain, so they were not used\./);
    assert.match(said, /New in Israel: ₪550 \(out of stock\)/);
    assert.match(said, /Prices from abroad do not include shipping to Israel\./);
    const links = [...dialog.querySelectorAll('a')];
    assert.match(links[1].textContent, /70 USD/);
    assert.match(links[1].textContent, /\+ 26 USD shipping/, 'shown beside the price, never added to it');
    assert.doesNotMatch(links[0].textContent, /shipping/);
  });
  test('CV-4f the same in Hebrew, and nothing of it when there is nothing to say', async () => {
    const v = { ...VALUATION, retail_new_in_stock: false, counts: { ...VALUATION.counts, unbound: 1 } };
    await settle(await open({ identify: [identified()], price: [pricedAnswer(v)] }, { lang: 'he' }));
    await click(button('למה המחיר הזה?'));
    const said = container.querySelector('[role="dialog"]').textContent;
    assert.match(said, /נמצא מחיר אחד שלא ניתן היה לשייך בוודאות לפריט הזה, ולכן לא נכלל\./);
    assert.match(said, /מחיר חדש בישראל: ₪550 \(אזל מהמלאי\)/);
    await act(async () => { root.unmount(); }); root = null; container.remove(); container = null;
    await act(async () => { scan.scanStore.reset(); });
    await settle(await open({ identify: [identified()], price: [pricedAnswer()] }));
    await click(button('Why this price?'));
    assert.doesNotMatch(container.querySelector('[role="dialog"]').textContent, /could not be tied|out of stock|\+ .* shipping/);
  });
});
