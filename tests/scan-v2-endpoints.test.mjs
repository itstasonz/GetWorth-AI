// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — /api/v2/identify AND /api/v2/price: AUTH, FLAG, STATE, ISOLATION
//
// The properties that make V2 safe to ship BESIDE V1:
//
//   - off by default, and off for everyone not allowlisted in production;
//   - a refused request costs nothing (no provider call);
//   - /api/v2/price researches only an identity this server signed;
//   - V2 writes to no database; and
//   - V1 does not import V2, so V2 cannot change a V1 scan.
//
// The handlers are driven through their real exports with `globalThis.fetch`
// replaced. No test here spends a credit.
//
//   node --test tests/scan-v2-endpoints.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve as resolvePath, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintJWT } from './helpers/analyze-harness.mjs';
import { signScanState, verifyScanState, STATE_ERROR } from '../api/_lib/v2/state.js';
import { V2_FUNCTION_MAX_DURATION_S, V2_STATE_TTL_MS } from '../api/_lib/v2/config.js';
import { IMG, RAW, RESULTS_PS5_VERIFIED, mockV2Provider } from './fixtures/scan-v2/fixtures.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '99999999-2222-3333-4444-555555555555';
const USER = '11111111-2222-3333-4444-555555555555';
const SECRET = 'v2-state-secret-for-tests-0123456789abcdef';
const KEY = 'sk-test-not-a-real-key-000000';
const ON = { SCAN_ENGINE_V2_ENABLED: 'true', OPENAI_API_KEY: KEY, SCAN_ENGINE_V2_STATE_SECRET: SECRET };
const ENV_KEYS = ['SCAN_ENGINE_V2_ENABLED', 'SCAN_ENGINE_V2_USER_IDS', 'SCAN_ENGINE_V2_STATE_SECRET', 'SCAN_ENGINE_V2_MODEL',
  'OPENAI_API_KEY', 'VERCEL_ENV', 'SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];

/** Call a V2 handler with a controlled environment and a controlled provider. */
async function call(path, body, { env = ON, provider = mockV2Provider({}), headers = {}, method = 'POST', user = USER, onLog = null } = {}) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.SUPABASE_JWT_SECRET = 'test-secret';
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const realFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (url, init) => { outbound.push(String(url)); return provider(url, init); };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => { if (onLog) onLog(a.map(String).join(' ')); }; console.warn = () => {}; console.error = () => {};
  try {
    const mod = await import(`../api/v2/${path}.js`);
    const res = await mod.default(new Request(`https://getworth.ai/api/v2/${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'https://get-worth-ai.vercel.app', authorization: `Bearer ${mintJWT(user)}`, ...headers },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }));
    const raw = await res.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { /* not json */ }
    return { status: res.status, payload, raw, outbound, provider };
  } finally {
    Object.assign(console, orig);
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const identify = (body, opts) => call('identify', { scan_uuid: UUID, image: IMG, ...body }, opts);
const price = (body, opts) => call('price', { scan_uuid: UUID, ...body }, opts);

describe('V2-14 a refused request costs nothing', () => {
  for (const path of ['identify', 'price']) {
    test(`V2-14a ${path}: no session is 401 before anything else`, async () => {
      const r = await call(path, { scan_uuid: UUID, image: IMG }, { headers: { authorization: '' } });
      assert.equal(r.status, 401);
      assert.deepEqual(r.outbound, []);
    });
    test(`V2-14b ${path}: the flag is OFF by default, and says so without calling a provider`, async () => {
      const r = await call(path, { scan_uuid: UUID, image: IMG, state: 'x.y' }, { env: {} });
      assert.equal(r.status, 200);
      assert.equal(r.payload.status, 'DISABLED');
      assert.equal(r.payload.openai_called, false);
      assert.deepEqual(r.outbound, []);
    });
    test(`V2-14c ${path}: no request field turns V2 on`, async () => {
      const forged = { scan_uuid: UUID, image: IMG, SCAN_ENGINE_V2_ENABLED: 'true', enabled: true, v2: true, allowlist: [USER] };
      const r = await call(path, forged, { env: {}, headers: { 'x-scan-engine-v2-enabled': 'true' } });
      assert.equal(r.payload.status, 'DISABLED');
      assert.deepEqual(r.outbound, []);
    });
    test(`V2-14d ${path}: in production a user who is not allowlisted is DISABLED, and a listed one is not`, async () => {
      const prod = { ...ON, VERCEL_ENV: 'production' };
      const out = await call(path, { scan_uuid: UUID, image: IMG }, { env: prod });
      assert.equal(out.payload.status, 'DISABLED');
      assert.equal(out.payload.reason, 'not_in_v2_allowlist');
      assert.deepEqual(out.outbound, []);
      const other = await call(path, { scan_uuid: UUID, image: IMG }, { env: { ...prod, SCAN_ENGINE_V2_USER_IDS: 'someone-else' } });
      assert.equal(other.payload.status, 'DISABLED');
      const listed = await call(path, { scan_uuid: UUID, image: IMG }, { env: { ...prod, SCAN_ENGINE_V2_USER_IDS: `x, ${USER}` }, provider: mockV2Provider({ identities: [RAW.NINJA] }) });
      assert.notEqual(listed.payload?.status, 'DISABLED');
    });
    test(`V2-14e ${path}: a flag with no state secret is DISABLED — there is no unsigned mode`, async () => {
      const r = await call(path, { scan_uuid: UUID, image: IMG }, { env: { ...ON, SCAN_ENGINE_V2_STATE_SECRET: undefined } });
      assert.equal(r.payload.status, 'DISABLED');
      assert.deepEqual(r.outbound, []);
    });
    test(`V2-14f ${path}: GET is 405, a malformed body or scan id is 400`, async () => {
      assert.equal((await call(path, null, { method: 'GET' })).status, 405);
      assert.equal((await call(path, { scan_uuid: 'scan-123', image: IMG })).status, 400);
    });
  }
  test('V2-14g identify: something that is not a photograph is refused before the provider is called', async () => {
    for (const image of ['', 'AAAA', Buffer.alloc(2048, 0x41).toString('base64'), '!!!not-base64!!!'.repeat(80)]) {
      const r = await identify({ image });
      assert.equal(r.status, 400, image.slice(0, 12));
      assert.deepEqual(r.outbound, []);
    }
  });
});

describe('V2-15 identify', () => {
  test('V2-15a one provider call, to OpenAI, and the answer carries a decision and a signed state', async () => {
    const r = await identify({}, { provider: mockV2Provider({ identities: [RAW.NINJA] }) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.outbound, ['https://api.openai.com/v1/responses']);
    assert.equal(r.payload.engine, 'v2');
    assert.equal(r.payload.status, 'OK');
    assert.equal(r.payload.sufficiency.decision, 'SEARCH_NOW');
    assert.equal(r.payload.identity.brand.value, 'Ninja');
    const verified = await verifyScanState(r.payload.state, { userId: USER, scanUuid: UUID }, { env: ON });
    assert.equal(verified.ok, true);
    assert.equal(verified.state.identity.model.value, 'Power Blender Duo Pro');
  });
  test('V2-15f the availability probe answers READY or DISABLED and never calls a provider', async () => {
    const ready = await call('identify', { scan_uuid: UUID, probe: true });
    assert.equal(ready.payload.status, 'READY');
    assert.deepEqual(ready.outbound, []);
    const off = await call('identify', { scan_uuid: UUID, probe: true }, { env: { ...ON, VERCEL_ENV: 'production' } });
    assert.equal(off.payload.status, 'DISABLED');
    const anon = await call('identify', { scan_uuid: UUID, probe: true }, { headers: { authorization: '' } });
    assert.equal(anon.status, 401);
  });
  test('V2-15b the ambiguous mouse returns ONE instruction in the user’s language, and no price field anywhere', async () => {
    const r = await identify({ language: 'he' }, { provider: mockV2Provider({ identities: [RAW.LOGITECH] }) });
    assert.equal(r.payload.sufficiency.decision, 'NEED_FOLLOWUP');
    assert.equal(r.payload.sufficiency.followup.type, 'UNDERSIDE_MODEL_LABEL');
    assert.match(r.payload.sufficiency.followup.instruction, /מספר הדגם/);
    assert.ok(!/"(price|low|high|recommended|valuation)"/.test(r.raw));
    assert.equal(r.outbound.length, 1);
  });
  test('V2-15c the follow-up photograph is accepted only with the state this server signed for this scan', async () => {
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.LOGITECH] }) });
    const second = await identify({ state: first.payload.state }, { provider: mockV2Provider({ identities: [RAW.LOGITECH_LABEL] }) });
    assert.equal(second.payload.sufficiency.decision, 'SEARCH_NOW');
    assert.equal(second.payload.followups_used, 1);
    assert.equal(second.payload.identity.model.value, 'G Pro X Superlight');
    assert.equal(second.payload.identity.object_class, 'gaming mouse');
    for (const bad of ['garbage', `${first.payload.state}x`, first.payload.state.replace(/^./, 'A')]) {
      const r = await identify({ state: bad });
      assert.equal(r.status, 400);
      assert.equal(r.payload.error, 'invalid_state');
      assert.deepEqual(r.outbound, []);
    }
  });
  test('V2-15d a follow-up is refused when none was asked for, and a second one is refused', async () => {
    const searchable = await identify({}, { provider: mockV2Provider({ identities: [RAW.NINJA] }) });
    const notAsked = await identify({ state: searchable.payload.state });
    assert.equal(notAsked.status, 409);
    assert.deepEqual(notAsked.outbound, []);
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.LOGITECH] }) });
    const second = await identify({ state: first.payload.state }, { provider: mockV2Provider({ identities: [RAW.LOGITECH_STILL_UNKNOWN] }) });
    assert.equal(second.payload.sufficiency.decision, 'INSUFFICIENT');
    const third = await identify({ state: second.payload.state });
    assert.equal(third.status, 409);
    assert.deepEqual(third.outbound, []);
  });
  test('V2-15e a provider failure is a FAILED status with a classified reason and no state', async () => {
    const r = await identify({}, { provider: mockV2Provider({ identityStatus: 500 }) });
    assert.equal(r.status, 200);
    assert.equal(r.payload.status, 'FAILED');
    assert.equal(r.payload.failure, 'upstream_5xx');
    assert.equal(r.payload.state, undefined);
    assert.equal(r.payload.identity, undefined);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// V2-24 · WHAT THE SERVER RECEIVED, STATED ON EVERY ANSWER
// ════════════════════════════════════════════════════════════════════════════
describe('V2-24 identify reports what arrived and where the request stopped', () => {
  const jpeg = (bytes) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]), Buffer.alloc(bytes, 0x37)]).toString('base64');

  test('V2-24a a photograph the size a phone sends reaches the provider call with its bytes intact', async () => {
    const image = jpeg(350_000);
    const provider = mockV2Provider({ identities: [RAW.NINJA] });
    const r = await identify({ image }, { provider });
    assert.equal(r.payload.status, 'OK');
    assert.deepEqual(r.payload.diagnostics, {
      request_received: true, content_type: 'application/json', image_field_present: true, image_field_type: 'string',
      image_mime: 'image/jpeg', image_bytes: Math.round(image.length * 0.75), parse_success: true,
      provider_request_started: true, provider_request_succeeded: true, failure_stage: null, failure_code: null,
    });
    const sent = provider.calls[0].body.input[0].content.find((c) => c.type === 'input_image').image_url;
    assert.equal(sent, `data:image/jpeg;base64,${image}`, 'the provider is handed exactly the bytes that arrived');
  });
  test('V2-24b the image travels in the field named `image`, bare or as a data URL', async () => {
    const asDataUrl = await identify({ image: `data:image/jpeg;base64,${IMG}` }, { provider: mockV2Provider({ identities: [RAW.NINJA] }) });
    assert.equal(asDataUrl.payload.status, 'OK');
    assert.equal(asDataUrl.payload.diagnostics.image_bytes, Math.round(IMG.length * 0.75));
    for (const wrong of [{ image: undefined, imageData: IMG }, { image: undefined, images: [IMG] }, { image: undefined, file: IMG }]) {
      const r = await identify(wrong);
      assert.equal(r.status, 400);
      assert.equal(r.payload.code, 'SERVER_PARSE_FAILED');
      assert.equal(r.payload.diagnostics.image_field_present, false);
      assert.equal(r.payload.diagnostics.image_field_type, 'absent');
      assert.deepEqual(r.outbound, []);
    }
  });
  test('V2-24c missing, zero-byte, stub and unsupported images are SERVER_PARSE_FAILED with the reason, and no provider call', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), Buffer.alloc(4096, 1)]).toString('base64');
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(4096, 1)]).toString('base64');
    const cases = [[null, /required/], ['', /required/], ['AAAA', /too small/], [heic, /not a recognised image format/], [pdf, /not a recognised image format/], [42, /required/]];
    for (const [image, why] of cases) {
      const r = await identify({ image });
      assert.equal(r.status, 400, String(image).slice(0, 12));
      assert.equal(r.payload.code, 'SERVER_PARSE_FAILED');
      assert.match(r.payload.detail, why);
      assert.equal(r.payload.diagnostics.parse_success, false);
      assert.equal(r.payload.diagnostics.provider_request_started, false);
      assert.equal(r.payload.diagnostics.failure_stage, 'parse');
      assert.deepEqual(r.outbound, []);
    }
  });
  test('V2-24d a provider 4xx is PROVIDER_IMAGE_REJECTED; a provider 5xx is PROVIDER_FAILED; both say the call started', async () => {
    const rejected = await identify({}, { provider: mockV2Provider({ identityStatus: 400 }) });
    assert.equal(rejected.payload.diagnostics.failure_code, 'PROVIDER_IMAGE_REJECTED');
    assert.equal(rejected.payload.diagnostics.provider_request_started, true);
    assert.equal(rejected.payload.diagnostics.provider_request_succeeded, false);
    const down = await identify({}, { provider: mockV2Provider({ identityStatus: 503 }) });
    assert.equal(down.payload.diagnostics.failure_code, 'PROVIDER_FAILED');
    assert.equal(down.payload.diagnostics.failure_stage, 'provider');
  });
  test('V2-24e the diagnostics and the log line carry no image content, token or state', async () => {
    const image = jpeg(20_000);
    const logs = [];
    const r = await identify({ image }, { provider: mockV2Provider({ identities: [RAW.NINJA] }), onLog: (line) => logs.push(line) });
    const text = JSON.stringify(r.payload.diagnostics);
    assert.ok(!text.includes(image.slice(0, 40)));
    assert.ok(!text.includes('Bearer') && !text.includes(r.payload.state));
    const line = logs.find((l) => l.startsWith('[V2Identify]'));
    assert.ok(line, 'one log line per request');
    assert.ok(!line.includes(image.slice(0, 40)) && !line.includes(r.payload.state) && !line.includes(USER));
    assert.match(line, /"image_bytes":\d+/);
  });
});

describe('V2-16 price researches only what this server established', () => {
  const stateFor = (raw, sufficiency, extra = {}) => signScanState(
    { userId: USER, scanUuid: UUID, identity: raw, sufficiency, followupsUsed: 0, ...extra }, { env: ON });

  test('V2-16a end to end: identify, then price — two provider calls, a verified value, diagnostics in the response', async () => {
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.PS5] }) });
    const r = await price({ state: first.payload.state }, { provider: mockV2Provider({ results: RESULTS_PS5_VERIFIED }) });
    assert.equal(r.status, 200);
    assert.deepEqual(r.outbound, ['https://api.openai.com/v1/responses']);
    assert.equal(r.payload.valuation.state, 'VERIFIED_MARKET_VALUE');
    assert.equal(r.payload.evidence.counts.admitted, 3);
    assert.equal(r.payload.evidence.admitted.length, 3);
    assert.equal(r.payload.search.results, 3);
    assert.equal(r.payload.search.stopped_at_results, true);
    assert.ok(r.payload.search.executed_queries.length >= 3, 'the queries the provider recorded, not only the plan');
    assert.deepEqual(r.payload.evidence.rejection_reasons, {}, 'three admitted, nothing rejected');
    assert.ok(r.payload.search.planned_queries.length >= 3);
    assert.deepEqual(r.payload.search.domains, ['boardone.co.il', 'boardthree.co.il', 'boardtwo.co.il']);
    assert.equal(r.payload.calls.search, 1);
    assert.equal(typeof r.payload.timings.total_ms, 'number');
  });
  test('V2-16b the request cannot name a product, a query or a price: only the signed state is read', async () => {
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.PS5] }) });
    const provider = mockV2Provider({ results: RESULTS_PS5_VERIFIED });
    const r = await price({
      state: first.payload.state,
      identity: RAW.NINJA, queries: ['Rolex Submariner'], subject: { brand: 'Rolex', model: 'Submariner' },
      valuation: { state: 'VERIFIED_MARKET_VALUE', recommended: 99999 }, marketRegion: 'US',
    }, { provider });
    const prompt = provider.calls[0].body.input[0].content[0].text;
    assert.ok(!/Rolex|Ninja/.test(prompt));
    assert.match(prompt, /PlayStation 5/);
    assert.equal(provider.calls[0].body.tools[0].user_location.country, 'IL');
    assert.notEqual(r.payload.valuation.recommended, 99999);
  });
  test('V2-16c no state, a forged state, another user’s state, another scan’s state: refused, with no provider call', async () => {
    const good = (await identify({}, { provider: mockV2Provider({ identities: [RAW.PS5] }) })).payload.state;
    const [payload] = good.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), identity: RAW.NINJA })).toString('base64url');
    const cases = [
      [undefined, USER, UUID, STATE_ERROR.MISSING],
      ['not-a-token', USER, UUID, STATE_ERROR.MALFORMED],
      [`${forgedPayload}.${good.split('.')[1]}`, USER, UUID, STATE_ERROR.BAD_SIGNATURE],
      [await signScanState({ userId: USER, scanUuid: UUID, identity: RAW.PS5, sufficiency: { decision: 'SEARCH_NOW', level: 'product' } }, { env: { SCAN_ENGINE_V2_STATE_SECRET: 'a-different-secret-of-sufficient-length-xx' } }), USER, UUID, STATE_ERROR.BAD_SIGNATURE],
      [good, '22222222-2222-3333-4444-555555555555', UUID, STATE_ERROR.WRONG_USER],
      [good, USER, OTHER_UUID, STATE_ERROR.WRONG_SCAN],
    ];
    for (const [state, user, scan, error] of cases) {
      const r = await call('price', { scan_uuid: scan, state }, { user, provider: mockV2Provider({ results: RESULTS_PS5_VERIFIED }) });
      assert.equal(r.status, 400, error);
      assert.equal(r.payload.detail, error);
      assert.deepEqual(r.outbound, [], error);
    }
  });
  test('V2-16d an expired state is refused', async () => {
    const old = await signScanState({ userId: USER, scanUuid: UUID, identity: RAW.PS5, sufficiency: {} }, { env: ON, now: Date.now() - V2_STATE_TTL_MS - 1000 });
    assert.equal((await verifyScanState(old, { userId: USER, scanUuid: UUID }, { env: ON })).error, STATE_ERROR.EXPIRED);
    const future = await signScanState({ userId: USER, scanUuid: UUID, identity: RAW.PS5, sufficiency: {} }, { env: ON, now: Date.now() + 3_600_000 });
    assert.equal((await verifyScanState(future, { userId: USER, scanUuid: UUID }, { env: ON })).error, STATE_ERROR.EXPIRED);
    await assert.rejects(() => signScanState({ userId: USER, scanUuid: UUID, identity: {}, sufficiency: {} }, { env: {} }), /state_secret_not_configured/);
  });
  test('V2-16e a state the gate did not approve is answered NEED_MORE_INFORMATION with NO search', async () => {
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.LOGITECH] }) });
    const r = await price({ state: first.payload.state }, { provider: mockV2Provider({ results: RESULTS_PS5_VERIFIED }) });
    assert.equal(r.payload.valuation.state, 'NEED_MORE_INFORMATION');
    assert.equal(r.payload.valuation.recommended, null);
    assert.deepEqual(r.outbound, [], 'no valuation research for an insufficient identity');
  });
  test('V2-16f a failed search is a 200 with NO_PRICE_EVIDENCE, not a 5xx and not a number', async () => {
    const state = await stateFor(RAW.PS5, { decision: 'SEARCH_NOW', level: 'product' });
    const r = await price({ state }, { provider: mockV2Provider({ searchStatus: 503 }) });
    assert.equal(r.status, 200);
    assert.equal(r.payload.valuation.state, 'NO_PRICE_EVIDENCE');
    assert.equal(r.payload.search.outcome, 'FAILED');
  });
});

describe('V2-17 no secret leaves the server', () => {
  test('V2-17a neither response contains the provider key, the state secret or the JWT secret', async () => {
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.PS5] }) });
    const second = await price({ state: first.payload.state }, { provider: mockV2Provider({ results: RESULTS_PS5_VERIFIED }) });
    const failed = await identify({}, { provider: async () => new Response(`echo Bearer ${KEY}`, { status: 400 }) });
    for (const r of [first, second, failed]) {
      for (const secret of [KEY, SECRET, 'test-secret']) assert.ok(!r.raw.includes(secret));
    }
  });
  test('V2-17b the state token is signed, not encrypted: it holds an identity and no secret', async () => {
    const first = await identify({}, { provider: mockV2Provider({ identities: [RAW.PS5] }) });
    const decoded = Buffer.from(first.payload.state.split('.')[0], 'base64url').toString();
    assert.ok(!decoded.includes(KEY) && !decoded.includes(SECRET));
    assert.deepEqual(Object.keys(JSON.parse(decoded)).sort(), ['followups_used', 'iat', 'identity', 'scan', 'sufficiency', 'uid', 'v']);
  });
});

describe('V2-18 isolation: V2 beside V1, not inside it', () => {
  const RE = /(?:^|[^\w$])(?:import|export)[\s\S]{0,400}?from\s*['"](\.[^'"\n]*)['"]/g;
  const closure = (entry) => {
    const seen = new Set();
    const out = [];
    const queue = [resolvePath(REPO, entry)];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      out.push({ path: relative(REPO, file).split(String.fromCharCode(92)).join('/'), src });
      for (const m of src.matchAll(RE)) {
        for (const cand of [m[1], `${m[1]}.js`, `${m[1]}.mjs`]) {
          const abs = resolvePath(dirname(file), cand);
          if (existsSync(abs)) { queue.push(abs); break; }
        }
      }
    }
    return out;
  };

  test('V2-18a no V1 entry point can reach a V2 module', () => {
    for (const entry of ['api/analyze.js', 'api/enrich.js', 'api/confirm-identity.js', 'api/submit-candidate.js']) {
      const reached = closure(entry).map((m) => m.path).filter((p) => p.includes('/v2/'));
      assert.deepEqual(reached, [], `${entry} reaches V2`);
    }
  });
  // Every module of the V2 tree, including the market data layer under market/.
  const v2Modules = () => {
    const walk = (dir) => readdirSync(resolvePath(REPO, dir), { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : (d.name.endsWith('.js') ? [`${dir}/${d.name}`] : [])));
    return walk('api/_lib/v2').concat(['api/v2/identify.js', 'api/v2/price.js']);
  };
  test('V2-18b V2 takes exactly one symbol from the V1 scan handler: the JWT verifier', () => {
    const v2 = v2Modules();
    const importers = v2.filter((f) => /from\s*'[^']*\/analyze\.js'/.test(readFileSync(resolvePath(REPO, f), 'utf8')));
    assert.deepEqual(importers, ['api/_lib/v2/http.js']);
    const m = /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/analyze\.js'/.exec(readFileSync(resolvePath(REPO, 'api/_lib/v2/http.js'), 'utf8'));
    assert.deepEqual(m[1].split(',').map((s) => s.trim()).filter(Boolean), ['verifyJWT']);
  });
  test('V2-18c V2 writes to no database: no mutating call anywhere in either endpoint’s closure', () => {
    const MUTATIONS = ['.insert(', '.upsert(', '.update(', '.delete(', '.rpc('];
    for (const entry of ['api/v2/identify.js', 'api/v2/price.js']) {
      const offenders = [];
      for (const { path, src } of closure(entry)) {
        // Reached only for the JWT verifier (V2-18b). It is the V1 scan path.
        if (path === 'api/analyze.js') continue;
        for (const verb of MUTATIONS) if (src.includes(verb)) offenders.push(`${path} -> ${verb}`);
      }
      assert.deepEqual(offenders, [], entry);
    }
  });
  test('V2-18d both handlers declare the function budget the config states, as a literal', () => {
    for (const f of ['api/v2/identify.js', 'api/v2/price.js']) {
      const m = /export const config = \{ maxDuration: (\d+) \};/.exec(readFileSync(resolvePath(REPO, f), 'utf8'));
      assert.ok(m, `${f} must declare maxDuration as a literal`);
      assert.equal(Number(m[1]), V2_FUNCTION_MAX_DURATION_S);
    }
  });
  test('V2-18e every host V2 can reach lives in exactly one module, and each module names only its own', () => {
    // The three hosts of the engine: the model and search provider, the
    // international used-market API, and the central bank's rate feed. A
    // fourth host is a new provider, and it needs a line here on purpose.
    const HOSTS = {
      'api/_lib/v2/openai-stream.js': ['api.openai.com'],
      'api/_lib/v2/market/ebay-provider.js': ['api.ebay.com'],
      'api/_lib/v2/market/fx.js': ['www.boi.org.il'],
    };
    const hostsIn = (f) => [...new Set([...readFileSync(resolvePath(REPO, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
      .matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()).filter((h) => !/^(localhost|get-worth-ai)/.test(h)))];
    const withHost = v2Modules().filter((f) => hostsIn(f).length > 0).sort();
    assert.deepEqual(withHost, Object.keys(HOSTS).sort());
    for (const [f, hosts] of Object.entries(HOSTS)) assert.deepEqual(hostsIn(f), hosts, f);
  });
});
