// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE CLIENT FLOW
//
// The scan as the phone runs it, against a fake /api/scan: the identity is on
// screen before the price, a question never holds the price back, the condition
// re-prices without a request, a correction goes round
// again, and Sell gets a listing that is already filled in.
//
//   node --test tests/core-scan-client.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  scanStore, STAGE, CONDITIONS, LISTING_CONDITION, startScan, addScanPhoto, answerQuestion, dismissQuestion, openQuestion, correctItem, retryScan,
  setScanCondition, scanActive, bandFor, buildListingDraft,
} from '../src/lib/coreScan.js';
import { IMG, RAW_IDENTITY, PRICES } from './helpers/core-scan-fakes.mjs';
import { normalizeIdentity } from '../api/_lib/scan/identify.js';

const UUID = '11111111-2222-3333-4444-555555555555';
const VALUATION = {
  status: 'priced', prices: PRICES, price_confidence: 'medium', approximate: false, counts: { resale: 3, il_used_exact: 2 },
};
const identityOf = (over = {}) => normalizeIdentity({ ...RAW_IDENTITY, ...over });
const CHOICE = { kind: 'choice', affects: 'price', question: 'What storage size is it?', options: ['128 GB', '256 GB', '512 GB'] };
const PHOTO = { kind: 'photo', affects: 'identity', question: 'Take one photo of the underside label', options: [] };

let requests;
let realFetch;
/** A fake /api/scan. `script` maps an action to the responses it gives, in order. */
function server(script) {
  requests = [];
  const queue = { identify: [...(script.identify ?? [])], price: [...(script.price ?? [])] };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body, auth: init.headers.Authorization });
    const next = queue[body.action].shift() ?? { status: 500, payload: { error: 'unscripted' } };
    if (next.hold) await next.hold;
    if (next.throws) throw next.throws;
    return new Response(JSON.stringify(next.payload), { status: next.status ?? 200 });
  };
}
const identified = (over = {}, n = 1) => ({ payload: { status: 'identified', identity: identityOf(over), default_condition: 'good', token: `tok-${n}`, timings: { total_ms: 3000 } } });
const pricedAnswer = (valuation = VALUATION) => ({ payload: { status: valuation.status === 'priced' ? 'priced' : 'insufficient_evidence', valuation, valuation_id: 'val-1', timings: { total_ms: 6000 } } });
const deps = (over = {}) => ({
  dataUrl: IMG, scanUuid: UUID, lang: 'he', getToken: async () => 'session', compress: async (d) => d, assess: async () => ({ ok: true }), ...over,
});
const snap = () => scanStore.getSnapshot();

beforeEach(() => { realFetch = globalThis.fetch; scanStore.reset(); });
afterEach(() => { globalThis.fetch = realFetch; scanStore.reset(); });

describe('CC-1 photograph in, answer out', () => {
  test('CC-1a two requests, and the identity is on screen while the price is still being looked up', async () => {
    let release;
    const hold = new Promise((r) => { release = r; });
    server({ identify: [identified()], price: [{ ...pricedAnswer(), hold }] });
    const seen = [];
    const run = startScan(deps({ onIdentified: () => seen.push({ stage: snap().stage, name: snap().identity?.display_name, priced: !!snap().valuation }) }));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, [{ stage: STAGE.PRICING, name: 'Logitech G Pro X Superlight', priced: false }]);
    release();
    assert.equal(await run, 'ok');
    assert.equal(snap().stage, STAGE.PRICED);
    assert.deepEqual(requests.map((r) => r.body.action), ['identify', 'price']);
    assert.equal(requests[0].url, '/api/scan');
    assert.equal(requests[0].auth, 'Bearer session');
    assert.deepEqual([requests[0].body.scan_uuid, requests[0].body.lang, requests[0].body.images.length], [UUID, 'he', 1]);
    assert.equal(requests[1].body.token, 'tok-1');
    assert.equal(requests[1].body.answer, undefined);
    assert.equal(typeof requests[1].body.client_elapsed_ms, 'number');
    assert.equal(snap().valuationId, 'val-1');
    assert.ok(snap().timings.identity_shown_ms <= snap().timings.price_shown_ms);
    assert.equal(snap().condition, 'good');
  });
  test('CC-1b the condition is chosen after the answer and re-prices without a request', async () => {
    server({ identify: [identified()], price: [pricedAnswer()] });
    await startScan(deps());
    const before = requests.length;
    assert.equal(bandFor(snap().valuation, snap().condition).list, 290);
    setScanCondition('like_new');
    assert.equal(bandFor(snap().valuation, snap().condition).list, 340);
    setScanCondition('poor');
    assert.equal(bandFor(snap().valuation, snap().condition).list, 150);
    setScanCondition('mint');
    assert.equal(snap().condition, 'poor', 'an unknown condition is ignored');
    assert.equal(requests.length, before, 'no request was made');
  });
  test('CC-1c a blank or broken photograph stops the scan before any request', async () => {
    server({});
    await startScan(deps({ assess: async () => ({ ok: false, reason: 'black_frame' }) }));
    assert.equal(snap().stage, STAGE.ERROR);
    assert.equal(snap().error.retryable, false);
    await startScan(deps({ dataUrl: 'data:,' }));
    assert.equal(snap().stage, STAGE.ERROR);
    await startScan(deps({ compress: async () => { throw new Error('canvas'); } }));
    assert.equal(snap().stage, STAGE.ERROR);
    assert.equal(requests.length, 0);
    // An image that cannot be inspected is not a rejection.
    server({ identify: [identified()], price: [pricedAnswer()] });
    await startScan(deps({ assess: async () => null }));
    assert.equal(snap().stage, STAGE.PRICED);
  });
  test('CC-1d a deployment with the scan switched off says so, and leaves nothing behind', async () => {
    server({ identify: [{ status: 503, payload: { status: 'unavailable' } }] });
    assert.equal(await startScan(deps()), 'unavailable');
    assert.equal(scanActive(), false);
    assert.equal(snap().stage, STAGE.IDLE);
    assert.equal(snap().unavailable, true);
    // It is remembered: the next scan goes straight to the older path without asking again.
    assert.equal(await startScan(deps()), 'unavailable');
    assert.equal(requests.length, 1);
    scanStore.forgetAvailability();
    assert.equal(snap().unavailable, false);
  });
  test('CC-1e identified but unpriced is its own state, with no number anywhere', async () => {
    server({ identify: [identified()], price: [pricedAnswer({ status: 'insufficient_evidence', prices: null, retail_new_ils: 550, withdrawn: 'no_verified_second_hand_reference' })] });
    await startScan(deps());
    assert.equal(snap().stage, STAGE.INSUFFICIENT);
    assert.equal(bandFor(snap().valuation, 'good'), null);
    assert.equal(buildListingDraft().price, '', 'an empty box the owner fills in, never a 0');
  });
  test('CC-1f nothing to sell in the photograph is not priced', async () => {
    server({ identify: [{ payload: { status: 'no_item', identity: identityOf({ is_sellable_item: false }), default_condition: 'good', token: 't' } }] });
    assert.equal(await startScan(deps()), 'no_item');
    assert.equal(snap().stage, STAGE.NO_ITEM);
    assert.deepEqual(requests.map((r) => r.body.action), ['identify']);
  });
});

describe('CC-2 the one question never stands in front of the answer', () => {
  test('CC-2a the price arrives first; the question waits beside it, and an answer re-prices for that answer', async () => {
    server({ identify: [identified({ followup: CHOICE })], price: [pricedAnswer(), pricedAnswer()] });
    assert.equal(await startScan(deps()), 'ok');
    assert.equal(snap().stage, STAGE.PRICED, 'photograph in, answer out');
    assert.deepEqual(requests.map((r) => r.body.action), ['identify', 'price']);
    assert.equal(requests[1].body.answer, undefined);
    assert.equal(openQuestion().question, 'What storage size is it?');
    await answerQuestion(1, 'he');
    assert.equal(requests[2].body.answer, 1, 'the answer is sent as the index of an offered option');
    assert.equal(snap().stage, STAGE.PRICED);
    assert.equal(openQuestion(), null, 'answered once, it is not asked again');
    await answerQuestion(0, 'he');
    assert.equal(requests.length, 3);
  });
  test('CC-2b "not sure" keeps the price already shown and makes no request', async () => {
    server({ identify: [identified({ followup: CHOICE })], price: [pricedAnswer()] });
    await startScan(deps());
    dismissQuestion();
    assert.equal(openQuestion(), null);
    assert.equal(snap().stage, STAGE.PRICED);
    assert.equal(requests.length, 2);
    await answerQuestion('512 GB', 'he');
    assert.equal(requests.length, 2, 'only an offered option can be sent');
  });
  test('CC-2c a photograph the scan asked for is added to the same scan, looked at again and re-priced', async () => {
    server({ identify: [identified({ followup: PHOTO }, 1), identified({}, 2)], price: [pricedAnswer(), pricedAnswer()] });
    await startScan(deps());
    assert.equal(openQuestion().kind, 'photo');
    assert.equal(snap().stage, STAGE.PRICED);
    let shown = 0;
    await addScanPhoto({ dataUrl: IMG, lang: 'he', onIdentified: () => { shown += 1; } });
    assert.deepEqual([requests[2].body.action, requests[2].body.images.length, requests[2].body.token], ['identify', 2, 'tok-1']);
    assert.equal(requests[3].body.token, 'tok-2', 'the price step carries the newest token');
    assert.equal(snap().stage, STAGE.PRICED);
    assert.equal(openQuestion(), null);
    assert.equal(shown, 1);
  });
});

describe('CC-3 wrong item', () => {
  test('CC-3a the owner\'s words go round again with the same photograph, then the price is redone', async () => {
    server({ identify: [identified({}, 1), identified({ display_name: 'Logitech G Pro Wireless', model: 'G Pro Wireless' }, 2)], price: [pricedAnswer(), pricedAnswer()] });
    await startScan(deps());
    await correctItem('  Actually this is a   Logitech G Pro Wireless ', 'he');
    assert.deepEqual(requests.map((r) => r.body.action), ['identify', 'price', 'identify', 'price']);
    assert.equal(requests[2].body.correction, 'Actually this is a Logitech G Pro Wireless');
    assert.equal(requests[2].body.token, 'tok-1');
    assert.equal(requests[2].body.images.length, 1);
    assert.equal(snap().identity.display_name, 'Logitech G Pro Wireless');
    assert.equal(snap().stage, STAGE.PRICED);
  });
  test('CC-3b an empty correction does nothing', async () => {
    server({ identify: [identified()], price: [pricedAnswer()] });
    await startScan(deps());
    await correctItem('   ', 'he');
    assert.equal(requests.length, 2);
  });
});

describe('CC-4 when something goes wrong', () => {
  test('CC-4a a failed price step is retried on its own: the item is not identified again', async () => {
    server({ identify: [identified()], price: [{ payload: { status: 'failed', failure: 'timeout', retryable: true } }, pricedAnswer()] });
    await startScan(deps());
    assert.deepEqual([snap().stage, snap().error.step, snap().error.retryable], [STAGE.ERROR, 'price', true]);
    assert.equal(snap().identity.display_name, 'Logitech G Pro X Superlight', 'the identity stays on screen');
    await retryScan('he');
    assert.deepEqual(requests.map((r) => r.body.action), ['identify', 'price', 'price']);
    assert.equal(snap().stage, STAGE.PRICED);
  });
  test('CC-4b the daily limit, an expired session and a lost connection each say what happened', async () => {
    server({ identify: [{ status: 429, payload: { limitType: 'user_daily' } }] });
    await startScan(deps());
    assert.deepEqual([snap().error.code, snap().error.retryable], ['rate_limited', false]);
    server({ identify: [{ status: 401, payload: {} }] });
    await startScan(deps());
    assert.equal(snap().error.code, 'session');
    server({ identify: [{ throws: new TypeError('Failed to fetch') }] });
    await startScan(deps({ lang: 'en' }));
    assert.deepEqual([snap().error.code, snap().error.retryable], ['network', true]);
    assert.match(snap().error.message, /connection/i);
    await startScan(deps({ getToken: async () => null }));
    assert.equal(snap().error.code, 'session');
  });
  test('CC-4c leaving the scan drops it: a late answer changes nothing', async () => {
    let release;
    const hold = new Promise((r) => { release = r; });
    server({ identify: [{ ...identified(), hold }] });
    const run = startScan(deps());
    await new Promise((r) => setTimeout(r, 10));
    scanStore.reset();
    release();
    await run;
    assert.equal(snap().stage, STAGE.IDLE);
    assert.equal(snap().identity, null);
  });
});

describe('CC-5 Sell gets a listing that is already filled in', () => {
  test('CC-5a title, description, price for the chosen condition, and the listing\'s own condition', async () => {
    server({ identify: [identified()], price: [pricedAnswer()] });
    await startScan(deps());
    setScanCondition('like_new');
    const d = buildListingDraft();
    assert.equal(d.title, 'Logitech G Pro X Superlight', 'the title is the item\'s own name');
    assert.equal(d.desc, 'Wireless gaming mouse in black.', 'the description was written from the photograph, in step 1');
    assert.equal(d.price, 340);
    assert.equal(d.condition, 'likeNew');
    assert.deepEqual([d.result.name, d.result.category, d.result.valuation_id, d.result.coreScan], ['Logitech G Pro X Superlight', 'Electronics', 'val-1', true]);
    assert.ok(d.result.marketValue.low <= d.result.marketValue.mid && d.result.marketValue.mid <= d.result.marketValue.high);
  });
  test('CC-5b every scan condition maps to a condition the marketplace already knows', () => {
    const known = /const EDIT_CONDITIONS = \[([^\]]+)\]/.exec(readFileSync(new URL('../src/views/SellViews.jsx', import.meta.url), 'utf8'))[1];
    for (const c of CONDITIONS) assert.ok(known.includes(`'${LISTING_CONDITION[c]}'`), `${c} -> ${LISTING_CONDITION[c]}`);
  });
  test('CC-5c a listing needs nothing from the market step: an unpriced scan still has its title and description', () => {
    const d = buildListingDraft({ identity: identityOf(), valuation: null, condition: 'good', valuationId: null });
    assert.deepEqual([d.title, d.desc, d.price, d.condition], ['Logitech G Pro X Superlight', 'Wireless gaming mouse in black.', '', 'used']);
    assert.equal(buildListingDraft({ identity: identityOf({ listing_description: null }), valuation: null, condition: 'good' }).desc, '');
    assert.equal(d.result.marketValue, null);
  });
  test('CC-5d a condition the search gave no band for takes the nearest one that has', () => {
    const v = { status: 'priced', prices: { ...PRICES, new_sealed: null } };
    assert.equal(bandFor(v, 'new_sealed').list, 340);
    assert.equal(bandFor({ status: 'insufficient_evidence', prices: PRICES }, 'good'), null);
  });
});

describe('CC-6 the screen', () => {
  const view = readFileSync(new URL('../src/views/ScanView.jsx', import.meta.url), 'utf8');
  const sheets = readFileSync(new URL('../src/components/ScanSheets.jsx', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../src/lib/scanCopy.js', import.meta.url), 'utf8');
  test('CC-6a what a person needs is on it: both confidences, the range, the condition, Sell, and the two questions', () => {
    for (const key of ['identityConfidence', 'priceConfidence', 'recommended', 'expected', 'sellFor', 'wrongItem', 'whyPrice', 'pricing', 'analyzing']) {
      assert.match(view, new RegExp(`copy\\.${key}\\b`), key);
      assert.equal((copy.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 2, `${key} is written in both languages`);
    }
    assert.match(view, /<ConditionPicker/);
    assert.match(view, /sellFromScan/);
  });
  test('CC-6b no engineering detail reaches a normal user', () => {
    for (const src of [view, sheets]) {
      assert.doesNotMatch(src, /timings|tool_calls|usage|provider|binding|withdrawn|scan_uuid|token\b/i);
    }
  });
  test('CC-6c sources are real links that open safely', () => {
    assert.match(sheets, /href=\{e\.url\} target="_blank" rel="noopener noreferrer"/);
  });
});
