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
  awaitingFollowup, isScanV2Available, V2_STAGE,
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
const deps = (over = {}) => ({
  dataUrl: 'data:image/jpeg;base64,RAW', scanUuid: UUID, lang: 'en',
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
    assert.equal(requests[0].body.image, 'COMPRESSED', 'the compressed photograph, without its data-URL prefix');
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
    const requests = script([identifyOk('SEARCH_NOW', { followups_used: 1, state: 'signed.second' }), priceOk('MARKET_INFORMED_ESTIMATE')]);
    await followupScanV2(deps({ dataUrl: 'data:image/jpeg;base64,RAW2' }));
    assert.equal(requests[0].body.state, 'signed.token');
    assert.equal(requests[0].body.image, 'COMPRESSED2');
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
  test('V2-19g a blank frame is refused before any request', async () => {
    const requests = script([]);
    await startScanV2(deps({ assess: async () => ({ ok: false, reason: 'blank' }) }));
    assert.equal(requests.length, 0);
    assert.equal(snap().stage, V2_STAGE.ERROR);
  });
  test('V2-19h a failed identify or price is an ERROR stage, never a made-up result; price can be retried alone', async () => {
    script([ok({ engine: 'v2', status: 'FAILED', failure: 'timeout' })]);
    await startScanV2(deps());
    assert.equal(snap().stage, V2_STAGE.ERROR);
    assert.equal(snap().identity, null);
    script([identifyOk('SEARCH_NOW'), new Response('{}', { status: 500 })]);
    await startScanV2(deps());
    assert.equal(snap().stage, V2_STAGE.ERROR);
    assert.equal(snap().valuation, null);
    assert.equal(snap().identity.brand.value, 'Sony', 'the identity already earned is kept');
    const retry = script([priceOk()]);
    await retryPriceV2({ lang: 'en', getToken: async () => 'user-session-token' });
    assert.deepEqual(retry.map((r) => r.path), ['/api/v2/price']);
    assert.equal(snap().stage, V2_STAGE.DONE);
  });
  test('V2-19i a network failure is an ERROR stage', async () => {
    script([new TypeError('Failed to fetch')]);
    await startScanV2(deps());
    assert.equal(snap().stage, V2_STAGE.ERROR);
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
  test('V2-21a every price state has a headline in both languages', () => {
    for (const state of ['VERIFIED_MARKET_VALUE', 'MARKET_INFORMED_ESTIMATE', 'ESTIMATED_WORTH', 'NEED_MORE_INFORMATION', 'NO_PRICE_EVIDENCE']) {
      assert.equal((view.match(new RegExp(`${state}: '`, 'g')) || []).length, 2, state);
    }
  });
  test('V2-21b every priced basis the server can return has a sentence in both languages', () => {
    const pricing = read('api/_lib/v2/pricing.js');
    const kinds = [...pricing.matchAll(/^\s+[A-Z_]+: '([a-z_]+)',$/gm)].map((m) => m[1]).filter((k) => k !== 'none');
    assert.ok(kinds.length >= 5);
    for (const kind of kinds) assert.equal((view.match(new RegExp(`${kind}: \\(b\\) =>`, 'g')) || []).length, 2, kind);
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
    for (const needle of ['SCAN ENGINE: V2', 'build {BUILD}', 'title="Identity"', 'title="Search"', 'title="Evidence"', 'title="Valuation"', 'title="Total"',
      'label="server time"', 'label="round-trip time"', 'label="executed queries"', 'label="results"', 'label="domains"', 'label="admitted"', 'label="rejected"', 'label="used listings"', 'label="retail listings"',
      'label="currency failures"', 'label="identity failures"', 'label="rejection reasons"', 'label="evidence basis"', 'label="photo accepted → result / follow-up"', 'label="decision"', 'label="candidates"', 'label="visible text"']) {
      assert.ok(view.includes(needle), needle);
    }
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
