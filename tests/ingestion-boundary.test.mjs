// ══════════════════════════════════════════════════════════════════════════════
// REQUEST INGESTION BOUNDARY — size and time, two invariants, one boundary.
//
// Everything before the boundary is REQUEST INGESTION, whose duration and byte
// count the CLIENT chooses. Everything after is AI PROCESSING. Two defects came
// from treating ingestion as free and unbounded:
//
//   INVARIANT A — SIZE.  A client cannot make GetWorth buffer more than the
//   configured ceiling by omitting Content-Length or using chunked transfer.
//   Measured before the fix: 157,286,400 bytes fully buffered AND JSON-parsed,
//   with no 413. The Content-Length check was the only gate and it is skipped
//   when the header is absent; the stream reader had no counter at all.
//
//   INVARIANT B — TIME.  Time spent delivering the body cannot reduce the
//   provider-processing budget. Before the fix a ~34s drip collapsed stage1Cap
//   to its 8s floor, so the provider aborted mid-generation, producing a
//   REFUNDABLE `stage1_timeout` on a call Anthropic had already billed —
//   unbounded, deterministic, client-triggered.
//
// These tests drive the REAL Node adapter (the path that ships) with a real
// stream, and count bytes the implementation actually accepted.
//
//   node --test tests/ingestion-boundary.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';

const CEILING = 26_214_400;          // REQUEST_BODY_MAX_BYTES
const CHUNK = 1024 * 1024;           // 1 MB — the overshoot unit

let handler;
const savedEnv = {};
before(async () => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY',
    'SUPABASE_JWT_SECRET', 'ANTHROPIC_API_KEY', 'ALLOWED_ORIGINS', 'RECOGNITION_ENGINE']) {
    savedEnv[k] = process.env[k];
  }
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_JWT_SECRET = 'test-secret';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ALLOWED_ORIGINS = 'https://getworth.ai';
  delete process.env.RECOGNITION_ENGINE;
  handler = (await import('../api/analyze.js')).default;
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt() {
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url({ sub: '11111111-2222-3333-4444-555555555555', email: 'a@b.c', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url')}`;
}

const JPEG = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]),
  Buffer.alloc(64, 0x20),
]).toString('base64');

// Drives the real handler. `counters.emitted` is what the TEST pushed into the
// stream; the implementation stops pulling once it rejects, so the gap between
// emitted and the ceiling is the observable memory property.
async function drive({ bodyChunks, headers = {}, stallMs = 0, anthropic = null, slowQuotaMs = 0 }) {
  const counters = { emitted: 0, providerCalls: 0, refunds: 0, quotaCharges: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (url.includes('api.anthropic.com')) {
      counters.providerCalls++;
      if (anthropic) return anthropic(init);
      return new Promise((_, rej) => init.signal?.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
      }));
    }
    if (url.includes('/rpc/check_and_increment_scan_rate')) {
      counters.quotaCharges++;
      if (slowQuotaMs) await new Promise((r) => setTimeout(r, slowQuotaMs));
      return new Response(JSON.stringify([{ allowed: true, limit_type: null, daily_count: 1, charged: true }]), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/rpc/decrement_user_daily_scan')) {
      counters.refunds++;
      return new Response('0', { headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  };

  const nodeReq = Object.assign(Readable.from((async function* () {
    let first = true;
    for (const c of bodyChunks()) {
      if (!first && stallMs) await new Promise((r) => setTimeout(r, stallMs));
      first = false;
      counters.emitted += Buffer.byteLength(c);
      yield c;
    }
  })()), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt()}`, origin: 'https://getworth.ai', ...headers },
  });

  let status = 0, body = null;
  const logs = [];
  const nodeRes = { statusCode: 0, setHeader() {}, end(c) { status = this.statusCode; body = c; } };
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => logs.push(a.map(String).join(' '));
  try { await handler(nodeReq, nodeRes); } finally { Object.assign(console, o); }
  return { status, body: body ? JSON.parse(body) : null, ...counters, log: logs.join('\n') };
}

const oversized = (mb) => function* () {
  yield '{"lang":"en","imageData":"';
  const filler = 'A'.repeat(CHUNK);
  for (let i = 0; i < mb; i++) yield filler;
  yield '"}';
};
const validBody = () => function* () { yield JSON.stringify({ imageData: JPEG, lang: 'en' }); };

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT A — SIZE
// ─────────────────────────────────────────────────────────────────────────────

test('IB-01 chunked + NO Content-Length cannot bypass the ceiling', async () => {
  // THE DEFECT. Before the fix this buffered 157 MB and answered 400 from
  // downstream image validation — the size gate never ran.
  const r = await drive({ bodyChunks: oversized(40) });
  assert.equal(r.status, 413, `oversized chunked body must be rejected with 413, got ${r.status}`);
  assert.deepEqual(r.body, { error: 'Request body too large' });
});

test('IB-02 MEMORY PROPERTY — ingestion stops at the ceiling, not after it', async () => {
  // A 413 alone is not sufficient: buffering 150 MB and then answering 413
  // still lets a client choose our memory footprint. Assert where ingestion
  // actually STOPPED.
  const r = await drive({ bodyChunks: oversized(150) });
  assert.equal(r.status, 413);
  assert.ok(r.emitted <= CEILING + 2 * CHUNK,
    `ingestion must stop at the ceiling (+ at most one in-flight chunk); ` +
    `ceiling=${CEILING}, accepted=${r.emitted}`);
  // And nowhere near what the client offered.
  assert.ok(r.emitted < 150 * CHUNK / 2,
    `the client offered 150 MB; only ${r.emitted} bytes may be consumed`);
});

test('IB-03 an oversized request reaches no provider and charges no quota', async () => {
  const r = await drive({ bodyChunks: oversized(40) });
  assert.equal(r.status, 413);
  assert.equal(r.providerCalls, 0, 'no paid provider call may be made');
  assert.equal(r.quotaCharges, 0, 'no quota may be charged');
  assert.equal(r.refunds, 0, 'nothing was taken, so nothing is refunded');
});

test('IB-04 oversized Content-Length is rejected early, same contract', async () => {
  const r = await drive({
    bodyChunks: validBody(),
    headers: { 'content-length': String(CEILING + 1) },
  });
  assert.equal(r.status, 413, 'an oversized Content-Length must still short-circuit');
  assert.deepEqual(r.body, { error: 'Request body too large' });
  assert.equal(r.providerCalls, 0);
});

test('IB-05 a Content-Length that LIES smaller does not defeat the counter', async () => {
  // Content-Length is an optimisation, not the boundary. A small advertised
  // length with a huge actual body must still be stopped by the stream counter.
  const r = await drive({
    bodyChunks: oversized(40),
    headers: { 'content-length': '1024' },
  });
  assert.equal(r.status, 413, 'the streaming counter is authoritative, not the header');
  assert.ok(r.emitted <= CEILING + 2 * CHUNK, `accepted=${r.emitted}`);
  assert.equal(r.providerCalls, 0);
});

test('IB-06 SIZE failure is not JSON failure — malformed body under the limit', async () => {
  const r = await drive({ bodyChunks: function* () { yield '{"lang":"en", NOT JSON'; } });
  assert.notEqual(r.status, 413, 'a malformed small body must not be reported as too large');
  assert.ok(r.status >= 400, `expected a client/server error, got ${r.status}`);
  assert.equal(r.providerCalls, 0);
});

test('IB-07 a normal body is unaffected', async () => {
  const r = await drive({
    bodyChunks: validBody(),
    anthropic: () => new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({
        category: 'Electronics', category_confidence: 0.9,
        brand_candidates: [{ brand: 'Logitech', confidence: 0.9, evidence: 'readable_text' }],
        model_candidates: [{ model: 'G502', confidence: 0.9, evidence: 'ocr' }],
        ocr_text: { raw_texts: ['Logitech'], logos_detected: [], has_readable_text: true },
        visual_features: { condition: 'Good', materials: [], colors: [] },
      }) }],
      stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 400 },
    }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(r.status, 200, `a normal scan must still succeed, got ${r.status}`);
  assert.equal(r.refunds, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT B — TIME
// ─────────────────────────────────────────────────────────────────────────────

const capFromLog = (log) => {
  const m = /Stage 1 start[^\n]*cap=(\d+)ms/.exec(log);
  return m ? Number(m[1]) : null;
};

test('IB-08 a fast upload gets the full intended provider budget', async () => {
  const r = await drive({ bodyChunks: validBody() });
  assert.equal(capFromLog(r.log), 28_000,
    `a fast upload must receive the full 28s Stage-1 budget, got ${capFromLog(r.log)}`);
  assert.equal(r.providerCalls, 1);
});

test('IB-09 THE WITNESS — a slow upload cannot shrink the provider budget', async () => {
  // Round-7 reproduction. Before the fix: stall 24s -> cap 13,984ms; stall 34s
  // -> cap 8,000ms (the floor), provider aborted at 7.5s mid-generation,
  // `stage1_timeout` classified refundable, ledger unconsumed, refund RPC fired.
  //
  // After: the budget is all-or-nothing. A partial budget IS the exploit — it
  // guarantees the abort — so the request is rejected at the ingestion boundary
  // instead, BEFORE the quota charge and BEFORE any provider call.
  for (const stallMs of [24_000, 34_000]) {
    const r = await drive({ bodyChunks: function* () {
      const b = JSON.stringify({ imageData: JPEG, lang: 'en' });
      yield b.slice(0, 10); yield b.slice(10);
    }, stallMs });

    assert.equal(r.providerCalls, 0, `stall ${stallMs}ms: no provider call may be made`);
    assert.equal(r.refunds, 0, `stall ${stallMs}ms: THE EXPLOIT — no refund may be issued`);
    assert.equal(r.quotaCharges, 0, `stall ${stallMs}ms: no quota may be charged`);
    assert.equal(r.status, 503);
    assert.equal(r.body?.code, 'INGESTION_TOO_SLOW',
      'the failure must be attributed to ingestion, not to an AI provider timeout');
    assert.match(r.log, /Ingestion\] REJECTED/);
  }
});

test('IB-10 a slow upload is never reported as a provider timeout', async () => {
  // An upload failure must not masquerade as an AI failure — different policy,
  // different telemetry, different refund treatment.
  const r = await drive({ bodyChunks: function* () {
    const b = JSON.stringify({ imageData: JPEG, lang: 'en' });
    yield b.slice(0, 10); yield b.slice(10);
  }, stallMs: 34_000 });
  assert.equal(/stage1_timeout/.test(r.log), false,
    'a slow upload must not be classified as stage1_timeout');
  assert.equal(r.body?.code, 'INGESTION_TOO_SLOW');
});

test('IB-11 slow + oversized is stopped by the byte ceiling, not the clock', async () => {
  // The two invariants are independent and must not mask one another.
  const r = await drive({ bodyChunks: oversized(40), stallMs: 0 });
  assert.equal(r.status, 413, 'size wins when both would apply');
  assert.equal(r.providerCalls, 0);
  assert.equal(r.quotaCharges, 0);
});

test('IB-12 the counter measures BYTES, not string length (multi-byte UTF-8)', async () => {
  // Counting `String(chunk).length` instead of `Buffer.byteLength` under-counts
  // any non-ASCII payload. A 4-byte emoji is 2 UTF-16 code units, so a
  // string-length counter would admit roughly TWICE the ceiling before firing —
  // and every fixture above is pure ASCII, where the two are identical, so none
  // of them can tell the difference. This one can.
  const EMOJI = '\u{1F600}';                       // 4 bytes UTF-8, length 2
  assert.equal(Buffer.byteLength(EMOJI), 4);
  assert.equal(EMOJI.length, 2);

  const chunkStr = EMOJI.repeat(CHUNK / 4);        // 1 MB of bytes, 0.5 MB of length
  assert.equal(Buffer.byteLength(chunkStr), CHUNK);

  const r = await drive({ bodyChunks: function* () {
    yield '{"lang":"en","imageData":"';
    for (let i = 0; i < 40; i++) yield chunkStr;   // 40 MB of BYTES
    yield '"}';
  } });

  assert.equal(r.status, 413, 'a multi-byte payload over the ceiling must be rejected');
  // The decisive assertion: with a string-length counter this would run to
  // ~2x the ceiling before tripping.
  assert.ok(r.emitted <= CEILING + 2 * CHUNK,
    `byte counting must not be fooled by multi-byte characters; ` +
    `ceiling=${CEILING}, accepted=${r.emitted}`);
  assert.equal(r.providerCalls, 0);
});

test('IB-13 the budget is re-asserted AT THE POINT OF USE, not only at the gate', async () => {
  // RECOVERED FROM THE ROUND-8 SECURITY REVIEW (witness T5). The ingestion gate
  // runs ~110 lines before stage1Cap is computed, with the rate-limit RPC — a
  // network call — in between, so the gate's guarantee is STALE by the time the
  // budget is spent. Measured before this fix: a 9.5s upload stall passed the
  // gate at rem=40,461ms, a 5.5s rate-limit RPC followed, cap came out
  // 22,952ms, the provider was called on a budget that could not fund it,
  // aborted, and the timeout was REFUNDED. providerCalls=1, refunds=1.
  //
  // Checking a budget in one place and spending it in another is the same
  // check-then-use gap as any other, just in time rather than in state.
  const r = await drive({
    bodyChunks: function* () {
      const b = JSON.stringify({ imageData: JPEG, lang: 'en' });
      yield b.slice(0, 10); yield b.slice(10);
    },
    stallMs: 9_500,              // passes the gate, but only just
    slowQuotaMs: 5_500,          // then latency eats the margin
  });

  assert.equal(r.providerCalls, 0,
    'the provider must not be called on a budget that cannot fund it');
  assert.equal(r.status, 503);
  assert.equal(r.body?.code, 'INGESTION_TOO_SLOW');
  assert.equal(/cap=(\d+)ms/.test(r.log) && Number(/cap=(\d+)ms/.exec(r.log)[1]) < 28_000, false,
    'no Stage-1 call may run with less than the full intended cap');
});
