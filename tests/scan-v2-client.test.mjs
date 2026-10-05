// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE CLIENT: ORCHESTRATION, THE FLAG, AND WHAT THE SCREEN MAY SAY
//
// The store in src/lib/scanV2.js is plain JavaScript, so its behaviour is run
// for real against a mocked fetch. The screen and the AppContext branch are
// asserted from SOURCE, as tests/trust-copy.test.mjs does and for its reason:
// standing the whole provider up in jsdom would test the harness, and the
// properties that matter here are what the code can and cannot say.
//
//   node --test tests/scan-v2-client.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCAN_V2_ENABLED, scanV2Store, startScanV2, followupScanV2, declineFollowupV2, retryPriceV2,
  awaitingFollowup, isScanV2Available, describeCapture, V2_STAGE, V2_FAILURE,
} from '../src/lib/scanV2.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, '');
const UUID = '11111111-2222-3333-4444-555555555555';

const IDENTITY = { brand: { value: 'Sony' }, model: { value: 'PlayStation 5' }, ranked_candidates: [] };
const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
const identifyOk = (decision, extra = {}) => ok({
  engine: 'v2', status: 'OK', identity: IDENTITY, followups_used: 0, state: 'signed.token', timings: {},
  sufficiency: { decision, level: 'product', followup: decision === 'NEED_FOLLOWUP' ? { type: 'UNDERSIDE_MODEL_LABEL', instruction: 'Photograph the underside label with the model number.' } : null },
  ...extra,
});
const priceOk = (state = 'VERIFIED_MARKET_VALUE') => ok({
  engine: 'v2', status: 'OK', valuation: { state, low: 1700, recommended: 1800, high: 2000, basis: { kind: 'verified_used_listings', listings: 3, sources: 3 } },
  search: { outcome: 'COMPLETED' }, evidence: { counts: { admitted: 3 } }, timings: { total_ms: 7000 }, calls: { search: 1 },
});

/** Replace fetch with a scripted sequence and record what was requested. */
function script(responses) {
  const requests = [];
  globalThis.fetch = async (path, init) => {
    requests.push({ path, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return requests;
}
// A data URL the size of a real (small) photograph. The marker at its head is
// what the fake compressor rewrites, so a test can tell which image was sent.
const PAD = 'A'.repeat(4000);
const photo = (marker = 'RAW') => `data:image/jpeg;base64,${marker}${PAD}`;
const deps = (over = {}) => ({
  dataUrl: photo(), scanUuid: UUID, lang: 'en',
  getToken: async () => 'user-session-token',
  compress: async (d) => d.replace('RAW', 'COMPRESSED'),
  assess: async () => ({ ok: true }),
  ...over,
});
const snap = () => scanV2Store.getSnapshot();

beforeEach(() => scanV2Store.reset());

describe('V2-19 the client store', () => {
  test('V2-19a the fast path is two requests, in order, and ends DONE with the server’s valuation', async () => {
    const requests = script([identifyOk('SEARCH_NOW'), priceOk()]);
    await startScanV2(deps());
    assert.deepEqual(requests.map((r) => r.path), ['/api/v2/identify', '/api/v2/price']);
    assert.equal(requests[0].body.image, `COMPRESSED${PAD}`, 'the compressed photograph, without its data-URL prefix');
    assert.deepEqual(Object.keys(requests[0].body).sort(), ['image', 'language', 'scan_uuid'], 'the exact fields /api/v2/identify reads');
    assert.equal(requests[0].body.state, undefined);
    assert.deepEqual(Object.keys(requests[1].body).sort(), ['scan_uuid', 'state'], 'price sends the signed state and nothing else');
    assert.equal(requests[1].body.state, 'signed.token');
    assert.ok(requests.every((r) => r.auth === 'Bearer user-session-token'));
    assert.equal(snap().stage, V2_STAGE.DONE);
    assert.equal(snap().valuation.state, 'VERIFIED_MARKET_VALUE');
    assert.deepEqual(snap().calls, { identity: 1, search: 1 });
  });
  test('V2-19b every measured moment is an offset from "photo accepted", and none is invented', async () => {
    script([identifyOk('SEARCH_NOW'), priceOk()]);
    await startScanV2(deps());
    const t = snap().timings;
    const order = ['photo_accepted', 'compression_complete', 'identity_request_start', 'identity_complete',
      'sufficiency_decision', 'search_request_start', 'price_complete'];
    for (const k of order) assert.equal(typeof t[k], 'number', k);
    for (let i = 1; i < order.length; i++) assert.ok(t[order[i]] >= t[order[i - 1]], `${order[i]} after ${order[i - 1]}`);
    assert.equal(t.result_rendered, undefined, 'not stamped until the screen says it rendered');
    scanV2Store.mark('result_rendered');
    assert.equal(typeof snap().timings.result_rendered, 'number');
  });
  test('V2-19c NEED_FOLLOWUP stops: no price request is made until the photograph arrives', async () => {
    const requests = script([identifyOk('NEED_FOLLOWUP')]);
    await startScanV2(deps());
    assert.equal(requests.length, 1);
    assert.equal(snap().stage, V2_STAGE.NEED_FOLLOWUP);
    assert.equal(awaitingFollowup(), true);
    assert.equal(snap().valuation, null);
  });
  test('V2-19d the follow-up sends the NEW photograph with the signed state, then prices', async () => {
    script([identifyOk('NEED_FOLLOWUP')]);
    await startScanV2(deps());
    const requests = script([identifyOk('SEARCH_NOW', { followups_used: 1, state: 'signed.second' }), priceOk('USED_EVIDENCE_BELOW_QUORUM')]);
    await followupScanV2(deps({ dataUrl: photo('RAW2') }));
    assert.equal(requests[0].body.state, 'signed.token');
    assert.equal(requests[0].body.image, `COMPRESSED2${PAD}`);
    assert.equal(requests[1].body.state, 'signed.second');
    assert.equal(snap().followupsUsed, 1);
    assert.equal(snap().stage, V2_STAGE.DONE);
    assert.deepEqual(snap().calls, { identity: 2, search: 1 });
    assert.ok(snap().image.includes('COMPRESSED') && snap().followupImage.includes('COMPRESSED2'), 'the first photograph is kept');
  });
  test('V2-19e a follow-up with no scan waiting for one does nothing', async () => {
    const requests = script([]);
    await followupScanV2(deps());
    assert.equal(requests.length, 0);
  });
  test('V2-19f declining the follow-up, or an INSUFFICIENT identity, ends with no price and no search', async () => {
    script([identifyOk('NEED_FOLLOWUP')]);
    await startScanV2(deps());
    const requests = script([]);
    declineFollowupV2();
    assert.equal(snap().valuation.state, 'NEED_MORE_INFORMATION');
    assert.equal(snap().valuation.recommended, null);
    assert.equal(requests.length, 0);
    const again = script([identifyOk('INSUFFICIENT')]);
    await startScanV2(deps());
    assert.equal(again.length, 1);
    assert.equal(snap().valuation.state, 'NEED_MORE_INFORMATION');
  });
  test('V2-19g a failed identify or price is an ERROR stage, never a made-up result; price can be retried alone', async () => {
    script([ok({ engine: 'v2', status: 'FAILED', failure: 'timeout' })]);
    await startScanV2(deps());
    assert.equal(snap().stage, V2_STAGE.ERROR);
    assert.equal(snap().error.code, V2_FAILURE.PROVIDER_FAILED);
    assert.equal(snap().identity, null);
    script([identifyOk('SEARCH_NOW'), new Response('{}', { status: 500 })]);
    await startScanV2(deps());
    assert.equal(snap().stage, V2_STAGE.ERROR);
    assert.equal(snap().error.code, V2_FAILURE.PRICE_HTTP_ERROR);
    assert.equal(snap().valuation, null);
    assert.equal(snap().identity.brand.value, 'Sony', 'the identity already earned is kept');
    const retry = script([priceOk()]);
    await retryPriceV2({ lang: 'en', getToken: async () => 'user-session-token' });
    assert.deepEqual(retry.map((r) => r.path), ['/api/v2/price']);
    assert.equal(snap().stage, V2_STAGE.DONE);
  });
  test('V2-19i a network failure is NETWORK_ERROR at the request stage, with the preparation on record', async () => {
    script([new TypeError('Failed to fetch')]);
    await startScanV2(deps());
    assert.equal(snap().stage, V2_STAGE.ERROR);
    assert.equal(snap().error.code, V2_FAILURE.NETWORK_ERROR);
    assert.equal(snap().error.stage, 'request');
    assert.equal(snap().diag.client.compression_succeeded, true);
    assert.equal(snap().diag.client.request_started, true);
  });
  test('V2-19j a new scan starts clean: nothing of the previous scan survives', async () => {
    script([identifyOk('SEARCH_NOW'), priceOk()]);
    await startScanV2(deps());
    script([identifyOk('NEED_FOLLOWUP', { identity: { brand: { value: 'Logitech' } } })]);
    await startScanV2(deps({ scanUuid: '99999999-2222-3333-4444-555555555555' }));
    const s = snap();
    assert.equal(s.valuation, null);
    assert.equal(s.search, null);
    assert.equal(s.evidence, null);
    assert.deepEqual(s.calls, { identity: 1, search: 0 });
    assert.ok(!JSON.stringify(s).includes('PlayStation'));
  });
  test('V2-19k without a session nothing is sent', async () => {
    const requests = script([]);
    await startScanV2(deps({ getToken: async () => null }));
    assert.equal(requests.length, 0);
    assert.equal(snap().stage, V2_STAGE.ERROR);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// V2-23 · THE PHOTOGRAPH, FROM THE SHUTTER TO THE REQUEST
//
// THE PRODUCTION WITNESS (build 221686a). Three valid photographs, each visibly
// rendered on the V2 screen, each answered "Photo capture failed. Please retake
// the photo." The one predicate that produces that sentence in V2 is the pixel
// verdict on the CONVERTED image — a check two stages after capture — and the
// screen gave no code, no stage and no measurement.
// ════════════════════════════════════════════════════════════════════════════
describe('V2-23 every photo failure names its stage, its code and its measurement', () => {
  const blank = { ok: false, reason: 'black_frame', width: 256, height: 192, mean_luma: 0, std_dev: 0 };
  const fine = { ok: true, reason: null, width: 256, height: 192, mean_luma: 105, std_dev: 62 };

  test('V2-23a THE PRODUCTION FAILURE: a photo that is fine as captured and blank after conversion is reported as exactly that', async () => {
    const requests = script([]);
    const raw = photo();
    await startScanV2(deps({ assess: async (d) => (d === raw ? fine : blank) }));
    const st = snap();
    assert.equal(requests.length, 0, 'no provider call for an image that failed preparation');
    assert.equal(st.stage, V2_STAGE.ERROR);
    assert.equal(st.error.code, V2_FAILURE.PHOTO_BLANK_AFTER_CONVERSION);
    assert.equal(st.error.stage, 'pixel_check', 'not "capture": the capture is on screen');
    assert.match(st.error.detail, /converted: black_frame; captured: ok/);
    assert.ok(!/capture failed/i.test(st.error.message), 'a displayed photo is never called a capture failure');
    assert.equal(st.image, raw, 'the photograph the user sees is still there');
    assert.deepEqual(st.diag.client.pixel_check, blank, 'the measurement that said no');
    assert.deepEqual(st.diag.client.raw_pixel_check, fine, 'and the one that says the capture was fine');
    assert.equal(st.diag.client.failure_code, V2_FAILURE.PHOTO_BLANK_AFTER_CONVERSION);
  });
  test('V2-23b a photo that is blank as captured is PHOTO_BLANK_FRAME, and says so in those words', async () => {
    const requests = script([]);
    await startScanV2(deps({ assess: async () => blank }));
    assert.equal(requests.length, 0);
    assert.equal(snap().error.code, V2_FAILURE.PHOTO_BLANK_FRAME);
    assert.match(snap().error.message, /blank/i);
  });
  test('V2-23c a converted image the browser cannot decode is PHOTO_DECODE_FAILED', async () => {
    script([]);
    await startScanV2(deps({ assess: async () => ({ ok: false, reason: 'decode_failed' }) }));
    assert.equal(snap().error.code, V2_FAILURE.PHOTO_DECODE_FAILED);
    assert.equal(snap().error.stage, 'pixel_check');
  });
  test('V2-23d an image that cannot be INSPECTED is not a failure: the scan proceeds', async () => {
    const requests = script([identifyOk('SEARCH_NOW'), priceOk()]);
    await startScanV2(deps({ assess: async () => null }));
    assert.equal(requests.length, 2);
    assert.equal(snap().stage, V2_STAGE.DONE);
    assert.equal(snap().diag.client.pixel_check, 'not_inspectable');
  });
  test('V2-23e an image with no readable text and no brand is still a valid payload', async () => {
    const requests = script([identifyOk('SEARCH_NOW'), priceOk()]);
    await startScanV2(deps({ assess: async () => ({ ...fine, mean_luma: 40, std_dev: 9 }) }));
    assert.equal(requests.length, 2);
    assert.equal(snap().error, null);
  });
  test('V2-23f compression that throws is PHOTO_CONVERSION_FAILED with the reason, and nothing is sent', async () => {
    const requests = script([]);
    await startScanV2(deps({ compress: async () => { throw new Error('Failed to load image for compression'); } }));
    assert.equal(requests.length, 0);
    assert.equal(snap().error.code, V2_FAILURE.PHOTO_CONVERSION_FAILED);
    assert.equal(snap().error.stage, 'compression');
    assert.match(snap().error.detail, /Failed to load image/);
    assert.equal(snap().diag.client.compression_started, true);
    assert.equal(snap().diag.client.compression_succeeded, false);
  });
  test('V2-23g compression that returns an empty canvas ("data:,"), null, or a stub is PHOTO_EMPTY', async () => {
    for (const out of ['data:,', null, undefined, '', 'data:image/jpeg;base64,AAAA']) {
      const requests = script([]);
      await startScanV2(deps({ compress: async () => out }));
      assert.equal(requests.length, 0, String(out));
      assert.equal(snap().error.code, V2_FAILURE.PHOTO_EMPTY, String(out));
      assert.equal(snap().error.stage, 'compression', String(out));
    }
  });
  test('V2-23h a missing capture is PHOTO_MISSING; an object URL, a File or a non-image is PHOTO_NOT_AN_IMAGE; none reaches compression', async () => {
    const cases = [
      [null, V2_FAILURE.PHOTO_MISSING], [undefined, V2_FAILURE.PHOTO_MISSING], ['', V2_FAILURE.PHOTO_MISSING],
      ['blob:https://get-worth-ai.vercel.app/3f1c', V2_FAILURE.PHOTO_NOT_AN_IMAGE],
      [new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }), V2_FAILURE.PHOTO_NOT_AN_IMAGE],
      [`data:application/pdf;base64,${PAD}`, V2_FAILURE.PHOTO_NOT_AN_IMAGE],
      ['data:image/jpeg;base64,', V2_FAILURE.PHOTO_EMPTY],
    ];
    for (const [dataUrl, code] of cases) {
      let compressed = false;
      const requests = script([]);
      await startScanV2(deps({ dataUrl, compress: async (d) => { compressed = true; return d; } }));
      assert.equal(snap().error.code, code, String(dataUrl).slice(0, 30));
      assert.equal(snap().error.stage, 'capture');
      assert.equal(compressed, false);
      assert.equal(requests.length, 0);
    }
  });
  test('V2-23i describeCapture states type, MIME and size without reading the content', () => {
    assert.deepEqual(describeCapture(photo()), { present: true, type: 'data_url', mime: 'image/jpeg', bytes: Math.round(4003 * 0.75), base64_length: 4003 });
    assert.deepEqual(describeCapture('blob:x'), { present: true, type: 'object_url', mime: null, bytes: 0, base64_length: 0 });
    assert.equal(describeCapture(new Blob(['abc'], { type: 'image/heic' })).type, 'blob');
    assert.equal(describeCapture(null).present, false);
  });
  test('V2-23j the server\'s answers are told apart: 413, 400, 401, a provider failure and a provider image rejection', async () => {
    const cases = [
      [new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413 }), V2_FAILURE.PHOTO_TOO_LARGE, 'server'],
      [new Response(JSON.stringify({ error: 'bad_request', detail: 'image is not a recognised image format' }), { status: 400 }), V2_FAILURE.SERVER_PARSE_FAILED, 'server'],
      [new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }), V2_FAILURE.NO_SESSION, 'server'],
      [new Response('<html>gateway</html>', { status: 502 }), V2_FAILURE.IDENTIFY_HTTP_ERROR, 'server'],
      [ok({ engine: 'v2', status: 'FAILED', failure: 'http_400' }), V2_FAILURE.PROVIDER_IMAGE_REJECTED, 'provider'],
      [ok({ engine: 'v2', status: 'FAILED', failure: 'upstream_5xx' }), V2_FAILURE.PROVIDER_FAILED, 'provider'],
    ];
    for (const [response, code, stage] of cases) {
      script([response]);
      await startScanV2(deps());
      assert.equal(snap().error.code, code);
      assert.equal(snap().error.stage, stage, code);
      assert.equal(snap().diag.client.identify_http_status, response.status, code);
    }
    script([new Response(JSON.stringify({ error: 'bad_request', detail: 'image is not a recognised image format' }), { status: 400 })]);
    await startScanV2(deps());
    assert.match(snap().error.detail, /not a recognised image format/, 'the server’s own reason reaches the screen');
  });
  test('V2-23k a successful scan records the whole client half: capture, conversion, pixel verdict, request, response', async () => {
    script([identifyOk('SEARCH_NOW', { diagnostics: { request_received: true, image_bytes: 3000, parse_success: true } }), priceOk()]);
    await startScanV2(deps({ assess: async () => fine }));
    const c = snap().diag.client;
    assert.equal(c.capture_present, true);
    assert.equal(c.capture_type, 'data_url');
    assert.equal(c.capture_mime, 'image/jpeg');
    assert.ok(c.capture_bytes > 2000);
    assert.equal(c.preview_present, true);
    assert.equal(c.compression_started, true);
    assert.equal(c.compression_succeeded, true);
    assert.equal(c.compressed_mime, 'image/jpeg');
    assert.ok(c.compressed_bytes > 2000);
    assert.deepEqual(c.pixel_check, fine);
    assert.equal(c.request_started, true);
    assert.ok(c.request_payload_bytes > 4000, 'the serialised request, image included');
    assert.equal(c.identify_http_status, 200);
    assert.equal(typeof c.identify_roundtrip_ms, 'number');
    assert.equal(c.failure_code, null);
    assert.deepEqual(snap().diag.server, { request_received: true, image_bytes: 3000, parse_success: true });
  });
  test('V2-23l the diagnostics hold facts about the image and never the image, the token or the state', async () => {
    script([identifyOk('SEARCH_NOW'), priceOk()]);
    await startScanV2(deps({ assess: async () => fine }));
    const text = JSON.stringify(snap().diag);
    assert.ok(!text.includes(PAD.slice(0, 40)), 'no base64');
    assert.ok(!text.includes('user-session-token') && !text.includes('signed.token'));
    script([new TypeError('Failed to fetch eyJhbGciOiJIUzI1NiJ9abcdefgh')]);
    await startScanV2(deps());
    assert.ok(!JSON.stringify(snap().error).includes('eyJhbGciOiJIUzI1NiJ9'), 'a token-shaped string in an error is redacted');
  });
  test('V2-23m the preview survives every stage and every failure', async () => {
    const raw = photo();
    for (const over of [{ assess: async () => blank }, { compress: async () => { throw new Error('x'); } }, { compress: async () => 'data:,' }]) {
      script([]);
      await startScanV2(deps(over));
      assert.equal(snap().image, raw);
      assert.equal(snap().active, true, 'the V2 screen stays, with the photograph on it');
    }
    script([new Response('{}', { status: 500 })]);
    await startScanV2(deps());
    assert.ok(snap().image.startsWith('data:image/jpeg;base64,COMPRESSED'));
    script([identifyOk('NEED_FOLLOWUP')]);
    await startScanV2(deps());
    script([]);
    await followupScanV2(deps({ dataUrl: photo('RAW2'), assess: async () => blank }));
    assert.ok(snap().image.startsWith('data:image/jpeg;base64,COMPRESSED'), 'a failed follow-up keeps the first photograph');
    assert.equal(snap().error.code, V2_FAILURE.PHOTO_BLANK_FRAME);
  });
  test('V2-23o an assessment that THROWS is reported as its own failure, with what was thrown, and nothing is sent', async () => {
    const requests = script([]);
    await startScanV2(deps({ assess: async () => { throw new RangeError('Canvas area exceeds the maximum limit'); } }));
    const st = snap();
    assert.equal(requests.length, 0);
    assert.equal(st.error.code, V2_FAILURE.PHOTO_ASSESSMENT_THREW);
    assert.equal(st.error.stage, 'pixel_check');
    assert.match(st.diag.client.assessment_threw, /RangeError: Canvas area exceeds/);
    assert.equal(st.diag.client.assessment_started, true);
    assert.equal(st.diag.client.assessment_completed, true);
    assert.equal(st.diag.client.pixel_check, null, 'a throw is not a verdict');
    assert.equal(st.diag.client.request_started, false);
    // The SECOND assessment (of the captured image) throwing is recorded too, and does not mask the first verdict.
    const raw = photo();
    script([]);
    await startScanV2(deps({ assess: async (d) => { if (d === raw) throw new Error('decode exploded'); return blank; } }));
    assert.equal(snap().error.code, V2_FAILURE.PHOTO_BLANK_FRAME);
    assert.match(snap().diag.client.raw_assessment_threw, /decode exploded/);
    assert.equal(snap().diag.client.raw_pixel_check, 'not_inspectable');
  });
  test('V2-23p the pipeline flags say how far the photograph got, on success and at every stopping point', async () => {
    const flags = () => { const c = snap().diag.client; return [c.compression_started, c.compression_completed, c.assessment_started, c.assessment_completed, c.request_started]; };
    script([]);
    await startScanV2(deps({ dataUrl: null }));
    assert.deepEqual(flags(), [false, false, false, false, false]);
    script([]);
    await startScanV2(deps({ compress: async () => { throw new Error('x'); } }));
    assert.deepEqual(flags(), [true, true, false, false, false]);
    script([]);
    await startScanV2(deps({ compress: async () => 'data:,' }));
    assert.deepEqual(flags(), [true, true, false, false, false]);
    script([]);
    await startScanV2(deps({ assess: async () => blank }));
    assert.deepEqual(flags(), [true, true, true, true, false]);
    script([identifyOk('NEED_FOLLOWUP')]);
    await startScanV2(deps({ assess: async () => fine }));
    assert.deepEqual(flags(), [true, true, true, true, true]);
    const c = snap().diag.client;
    assert.equal(c.capture_base64_length, 4003);
    assert.equal(c.compressed_base64_length, 4010);
    assert.equal(c.compressed_type, 'data_url');
  });
  test('V2-23q the panel prints every field of a pixel verdict, the thresholds beside them, and the six pipeline answers', () => {
    const view = code('src/views/ScanV2View.jsx');
    for (const needle of ['· ok`}', '· reason`}', '· decoded w×h`}', '· canvas w×h`}', '· any opaque pixel`}', '· mean luma`}', '· std dev`}', '· max luma`}',
      'black frame if ≤10 and sd ≤4', 'uniform frame if ≤1.5', 'title="SENT"', 'title="CAPTURED"',
      'label="SOURCE type"', 'label="SOURCE base64 length"', 'label="SOURCE bytes (approx)"',
      'label="COMPRESSED type"', 'label="COMPRESSED base64 length"', 'label="COMPRESSED bytes (approx)"',
      'label="assessment threw"', 'label="PIPELINE compression started"', 'label="PIPELINE compression completed"',
      'label="PIPELINE assessment started"', 'label="PIPELINE assessment completed"', 'label="PIPELINE request started"',
      'label="PIPELINE /api/v2/identify called"']) {
      assert.ok(view.includes(needle), needle);
    }
    // The thresholds printed on the panel are the ones the check uses.
    const ctx = read('src/contexts/AppContext.jsx');
    assert.match(ctx, /const BLACK_MEAN_LUMA_MAX = 10;/);
    assert.match(ctx, /const BLACK_STDDEV_MAX = 4;/);
    assert.match(ctx, /const UNIFORM_STDDEV_MAX = 1\.5;/);
  });
  test('V2-23n "Photo capture failed" cannot be said by V2 at all', () => {
    for (const f of ['src/lib/scanV2.js', 'src/views/ScanV2View.jsx']) {
      assert.ok(!/capture failed|צילום התמונה נכשל/i.test(code(f)), f);
    }
  });
});

describe('V2-20 the flag: V1 is the path unless the build AND the server say otherwise', () => {
  test('V2-20a a build without the flag never asks the server and never uses V2', async () => {
    assert.equal(SCAN_V2_ENABLED, false, 'this test process has no VITE_SCAN_ENGINE_V2_ENABLED');
    const requests = script([]);
    assert.equal(await isScanV2Available({ userId: 'u', getToken: async () => 't', scanUuid: UUID }), false);
    assert.equal(requests.length, 0);
  });
  test('V2-20b the flag is an exact "true", read from a VITE_ variable', () => {
    assert.match(code('src/lib/scanV2.js'), /\.VITE_SCAN_ENGINE_V2_ENABLED === 'true'/);
  });
  test('V2-20c the V2 branch in runPipeline is inside the flag, after the auth pre-flight, and returns before V1 state is touched', () => {
    const ctx = read('src/contexts/AppContext.jsx');
    const start = ctx.indexOf('const runPipeline = useCallback(');
    const body = ctx.slice(start, ctx.indexOf('const retryPipeline = useCallback(', start));
    const flag = body.indexOf('if (SCAN_V2_ENABLED) {');
    const auth = body.indexOf('const preflightToken = await getFreshToken();');
    const v1 = body.indexOf('lastAttemptRef.current = {');
    assert.ok(auth > 0 && flag > auth, 'the V2 branch comes after the session check');
    assert.ok(flag < v1, 'and before the V1 pipeline takes its first snapshot');
    const branch = body.slice(flag, v1);
    assert.match(branch, /isScanV2Available\(/);
    assert.match(branch, /return;\s*\}\s*if \(scanV2Store\.getSnapshot\(\)\.active\) scanV2Store\.reset\(\);/);
    assert.ok(!/analyzeWithRetry|runPhaseBEnrichment|setResult\(/.test(branch), 'a V2 scan touches no V1 call or V1 result');
  });
  test('V2-20d the availability probe is asked once per user and a non-answer is a NO', () => {
    const src = code('src/lib/scanV2.js');
    assert.match(src, /availability\.has\(userId\)/);
    assert.match(src, /payload\?\.status === 'READY'/);
    assert.match(src, /probe: true/);
  });
  test('V2-20e the V2 client calls only the two V2 endpoints', () => {
    const paths = [...code('src/lib/scanV2.js').matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(paths)].sort(), ['/api/v2/identify', '/api/v2/price']);
  });
});

describe('V2-21 what the screen may say', () => {
  const view = code('src/views/ScanV2View.jsx');
  test('V2-21a every price state the server produces has a headline in both languages', () => {
    assert.ok(!view.includes('ESTIMATED_WORTH'), 'the removed state has no headline to show');
    const pricing = read('api/_lib/v2/pricing.js');
    const states = [...pricing.matchAll(/^\s+([A-Z_]+): '\1',/gm)].map((m) => m[1]);
    assert.deepEqual(states, ['VERIFIED_MARKET_VALUE', 'USED_EVIDENCE_ESTIMATE', 'USED_EVIDENCE_BELOW_QUORUM', 'COMPARABLE_MARKET_ESTIMATE', 'MARKET_INFORMED_ESTIMATE', 'NEED_MORE_INFORMATION', 'NO_PRICE_EVIDENCE']);
    const headlines = [...view.matchAll(/\n\s+states: \{([^}]*)\}/g)].map((m) => m[1]);
    assert.equal(headlines.length, 2, 'one headline table per language');
    for (const state of states) for (const table of headlines) assert.match(table, new RegExp(`${state}: '`), state);
    // Every reason an estimate can be withheld has a sentence in both languages.
    const limitations = /LIMITATION = Object\.freeze\(\{([^}]*)\}\)/.exec(pricing)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
    for (const code of limitations.filter((l) => l !== 'search_did_not_complete')) {
      assert.equal((view.match(new RegExp(`${code}: '`, 'g')) || []).length, 2, code);
    }
    assert.match(view, /limitationText && /, 'and it is shown only when there is no number');
  });
  test('V2-21b every priced basis the server can return has a sentence in both languages', () => {
    const pricing = read('api/_lib/v2/pricing.js');
    const kinds = [...pricing.matchAll(/^\s+[A-Z_]+: '([a-z_]+)',$/gm)].map((m) => m[1]).filter((k) => k !== 'none');
    assert.deepEqual(kinds.sort(), ['admitted_used_listings_below_quorum', 'retail_anchor_times_measured_resale_factor', 'verified_comparable_listings', 'verified_comparable_listings_range_adjusted', 'verified_used_listings', 'verified_used_listings_range_adjusted']);
    for (const kind of kinds) assert.equal((view.match(new RegExp(`${kind}: \\(b\\) =>`, 'g')) || []).length, 2, kind);
    assert.ok(!/new_retail_price|used_listings_for_brand_and_kind/.test(view), 'no sentence for a basis that no longer exists');
  });
  test('V2-21j the new price is its own card, says it is not a second-hand value, and is never the headline number', () => {
    assert.match(view, /v\?\.retail_anchor\?\.shops > 0/);
    assert.match(view, /This is not a second-hand value\./);
    assert.match(view, /זה אינו שווי יד שנייה\./);
    const headline = view.slice(view.indexOf('{priced ? ('), view.indexOf('v?.retail_anchor?.shops > 0'));
    assert.ok(headline.length > 0 && !/retail/i.test(headline), 'the price card never reads the anchor');
    assert.match(view, /const priced = v && typeof v\.recommended === 'number' && v\.recommended > 0;/);
  });
  test('V2-21k identification and price evidence are two lines, read from two fields', () => {
    assert.match(view, /c\.identityConfidence\}: \{c\.levels\[v\.confidence\.identity\.level\]/);
    assert.match(view, /c\.pricingConfidence\}: \{c\.levels\[v\.confidence\.pricing\.used_market\]/);
    for (const needle of ['label="identity confidence"', 'label="used-market evidence"', 'label="retail anchor"', 'label="search actions"', 'label="aliases proposed"', 'label="aliases corroborated"',
      'title="Market identity"', 'title="Extraction"', 'label="results inspected"', 'label="duplicates"', 'label="no price data"', 'label="price candidates"', 'label="counts reconcile"',
      'label="extraction reasons"', 'label="local used"', 'label="local retail"', 'label="international used"', 'label="international retail"', 'label="sibling"', 'label="family-level"', 'label="how it was calculated"']) {
      assert.ok(view.includes(needle), needle);
    }
  });
  test('V2-21c the screen cannot say "strong evidence" or claim a catalog reference', () => {
    assert.ok(!/strong|catalog|קטלוג|בסיס תמחור חזק/i.test(view));
    assert.ok(!/priceEvidStrong|basisMarketEstimate|resolvePricingPresentation/.test(view));
  });
  test('V2-21d the headline is chosen by the server’s state and by nothing else', () => {
    assert.match(view, /c\.states\[v\.state\] \?\? v\.state/);
    assert.ok(!/confidence\s*[<>]=?\s*0?\.\d/.test(view), 'no client-side confidence threshold re-labels a price');
  });
  test('V2-21e a state with no number shows no number', () => {
    assert.match(view, /const priced = v && typeof v\.recommended === 'number' && v\.recommended > 0;/);
    assert.match(view, /\{priced \? \(/);
  });
  test('V2-21f there is no percentage and no progress bar', () => {
    assert.ok(!/%|progress|width:\s*`/i.test(view.replace(/aria-live|w-full|max-w-md/g, '')));
  });
  test('V2-21g the diagnostic panel names the engine, the build and every section the measurement needs', () => {
    for (const needle of ['SCAN ENGINE: V2', 'build {BUILD}', 'title="Photo"', 'label="failure"', 'label="preview"', 'label="server received"', 'title="Identity"', 'title="Search"', 'title="Evidence"', 'title="Valuation"', 'title="Total"',
      'label="server time"', 'label="round-trip time"', 'label="executed queries"', 'label="results"', 'label="domains"', 'label="admitted"', 'label="rejected"', 'label="used listings"', 'label="retail listings"',
      'label="currency failures"', 'label="identity failures"', 'label="rejection reasons"', 'label="evidence basis"', 'label="photo accepted → result / follow-up"', 'label="decision"', 'label="candidates"', 'label="visible text"']) {
      assert.ok(view.includes(needle), needle);
    }
  });
  test('V2-21i the panel is shown for the whole scan, and the error card shows the failure code', () => {
    assert.match(view, /\{s\.active && <Diagnostics s=\{s\} \/>\}/);
    assert.match(view, /\{s\.error\.code\} @ \{s\.error\.stage\}/);
  });
  test('V2-21h the follow-up card shows the server’s instruction, never client-written copy', () => {
    assert.match(view, /s\.sufficiency\?\.followup\?\.instruction/);
    assert.ok(!/another photo|תמונה נוספת של/i.test(view));
  });
});

describe('V2-22 no server secret is in the client', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  test('V2-22a nothing under src/ names a server-side V2 variable, a provider key, or a server module', () => {
    const banned = ['SCAN_ENGINE_V2_STATE_SECRET', 'SCAN_ENGINE_V2_USER_IDS', 'OPENAI_API_KEY', 'SUPABASE_JWT_SECRET', 'api/_lib', 'api.openai.com'];
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.(js|jsx|mjs)$/.test(f))) {
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, '');
      for (const b of banned) assert.ok(!src.includes(b), `${file} mentions ${b}`);
    }
  });
  test('V2-22b the only V2 flag the client reads is the VITE_ one', () => {
    const names = new Set([...read('src/lib/scanV2.js').matchAll(/\b(VITE_[A-Z0-9_]+|SCAN_ENGINE_V2_[A-Z_]+)\b/g)].map((m) => m[1]));
    names.delete('SCAN_ENGINE_V2_ENABLED'); names.delete('SCAN_ENGINE_V2_USER_IDS'); // named in the header comment, as the server's
    assert.deepEqual([...names], ['VITE_SCAN_ENGINE_V2_ENABLED']);
  });
});
