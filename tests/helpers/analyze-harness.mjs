// ══════════════════════════════════════════════════════════════════════════════
// REAL handleRequest HARNESS — GW-PROMPT-INJECTION-001 round 6.
//
// WHY THIS EXISTS
// Three consecutive rounds shipped a refund defect past a fully green suite,
// because every refund assertion was indirect: it checked that a statement
// existed, or that a helper returned, or called `isRefundEligible` directly
// with hand-built arguments. None of those observe what actually matters.
//
// THE ONLY ORACLE THAT COUNTS:
//   did the REAL request handler call `decrement_user_daily_scan`?
//
// So this drives the real exported handler with `globalThis.fetch` replaced,
// routing by URL to controllable Anthropic / OpenAI / Supabase responders, and
// counts refunds as observed RPC calls. Originating design by the round-5
// independent security reviewer, who used it to reproduce two HIGH findings
// that the unit suites could not see.
//
// USAGE
//   import { harness, IMG } from './helpers/analyze-harness.mjs';
//   const h = await harness();
//   h.anthropic(() => ({ status: 200, body: { content: [{ type: 'text', text: '{...}' }] } }));
//   const r = await h.run({ imageData: IMG, lang: 'en' });
//   assert.equal(r.refunds, 0);
// ══════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JWT_SECRET = 'test-secret';
const NL = String.fromCharCode(10);

// Env must be set BEFORE api/analyze.js is imported — it reads these at module
// scope. `harness()` imports lazily for exactly this reason.
function setEnv() {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.ALLOWED_ORIGINS = 'https://getworth.ai';
  // SEC-9: these two were absent, so `generateQueryEmbedding` and
  // `fallbackVision` both returned null at their key check and NEVER reached
  // fetch. Two of the four providers in the inventory were unreachable in every
  // test, which is the other half of why the missing voyage bucket went unseen.
  process.env.VOYAGE_API_KEY = 'voyage-test-key';
  process.env.GOOGLE_VISION_API_KEY = 'vision-test-key';
}

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }

export function mintJWT(sub = '11111111-2222-3333-4444-555555555555') {
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url({ sub, email: 'a@b.c', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function jsonRes(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
}

// A minimal valid JPEG header so validateImages' magic-byte check passes.
export const IMG = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]),
  Buffer.alloc(64, 0x20),
]).toString('base64');

// A Stage-1 recognition payload that satisfies the pipeline's expectations.
export const VALID_RECOGNITION = {
  category: 'Electronics', category_hebrew: 'אלקטרוניקה', category_confidence: 0.9,
  subcategory: 'gaming mouse', product_type: 'mouse',
  brand_candidates: [{ brand: 'Logitech', confidence: 0.9, evidence: 'readable_text' }],
  model_candidates: [{ model: 'G502', confidence: 0.9, evidence: 'ocr' }],
  ocr_text: { raw_texts: ['Logitech G502'], logos_detected: ['Logitech'], has_readable_text: true },
  visual_features: { condition: 'Good', materials: ['plastic'], colors: ['black'] },
};

// Wrap a recognition object the way the Anthropic messages API returns it.
export const anthropicText = (obj) => ({
  status: 200,
  body: { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
          stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 400 } },
});

// ── H-7. THE PATCH IS INSTALLED BEFORE THE HANDLER IS IMPORTED ──────────────
//
// `harness()` used to import api/analyze.js and THEN replace globalThis.fetch.
// Anything evaluated at MODULE SCOPE therefore captured the REAL fetch:
//
//   const F = globalThis.fetch;        // module scope -> the real one
//   export const send = (u) => F(u);   // never observed by this harness
//
// A security reviewer planted five such adapters into api/ and the release gate
// stayed green on all five while a plain-`fetch` control was caught. The call
// reached the network; `state.unknownHosts` stayed empty. That is the SEC-9
// class again — coverage asserted, not delivered.
//
// The dispatcher is installed ONCE, at module load, and reads `active` at call
// time. So a module-scope capture captures the dispatcher, and every later
// `harness()` still gets its own responder table.
const realFetch = globalThis.fetch;
let active = null;

globalThis.fetch = async (input, init = {}) => {
  if (!active) return realFetch(input, init);
  return active(input, init);
};

// ── S-2. RUNTIME OBSERVATION IS NOT A PROPERTY OF ONE FILE ──────────────────
//
// This harness drove api/analyze.js and nothing else, so api/submit-candidate.js
// and api/confirm-identity.js had ZERO runtime observation. A security reviewer
// appended a literal-free adapter to submit-candidate.js — a destructured
// `globalThis.fetch`, an env-var destination — and the whole gate stayed at
// 876 pass / 0 fail. Any static-silent shape in those files was both-blind by
// construction, and the static layer is explicitly incomplete by design.
//
// Endpoints are DISCOVERED from the filesystem rather than listed, so a sixth
// one added tomorrow is covered without anyone editing this file. `driveEndpoint`
// invokes a handler's default export under the same dispatcher, so the
// out-of-band unknown-host record applies to it exactly as it does to analyze.
//
// A handler that throws or 4xx's is FINE: the point is not that the request
// succeeds, it is that any host it touches on the way is observed.
export function discoverEndpoints() {
  const dir = fileURLToPath(new URL('../../api/', import.meta.url));
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!/\.(js|mjs|cjs|ts)$/.test(name)) continue;
    const src = readFileSync(join(dir, name), 'utf8');
    if (/export\s+default\s/.test(src)) out.push(name);
  }
  return out.sort();
}

/**
 * Invoke one endpoint's default export under the active dispatcher.
 *
 * Returns { status, unknownHosts, err } — `unknownHosts` read OUT OF BAND after
 * the handler returns, so a try/catch inside it cannot hide an attempt.
 */
export async function driveEndpoint(name, { method = 'POST', body = {}, headers = {} } = {}) {
  setEnv();
  const mod = await import(`../../api/${name}`);
  const handler = mod.default;
  if (typeof handler !== 'function') throw new Error(`${name} has no default export`);
  endpointHosts.length = 0;
  const prev = active;
  active = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    if (url.includes('fake.supabase.co')) return jsonRes([], 200);
    // Same doctrine as run(): an unmodelled host is recorded OUT OF BAND first,
    // then refused. A harness that invents a success launders an unknown into a pass.
    endpointHosts.push(url);
    throw new Error(`[harness] UNSTUBBED EXTERNAL HOST: ${url}`);
  };
  let status = null; let err = null;
  try {
    const req = new Request(`https://getworth.ai/api/${name.replace(/\.[^.]+$/, '')}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'https://getworth.ai', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    const res = await handler(req, { status: () => ({ json: () => {} }) });
    status = res?.status ?? null;
  } catch (e) { err = e; }
  active = prev;
  return { status, err, unknownHosts: [...endpointHosts] };
}

const endpointHosts = [];

export async function harness() {
  setEnv();
  // Imported AFTER the dispatcher above is in place, so module-scope reads of
  // globalThis.fetch inside api/ capture something this harness can observe.
  const mod = await import('../../api/analyze.js');
  const handler = mod.default;

  const state = {
    refunds: 0, charged: true,
    anthropic: null, openai: null, vision: null,
    voyage: null,
    rpcLog: [], otherLog: [], providerCalls: { anthropic: 0, openai: 0, vision: 0, voyage: 0 },
    unknownHosts: [],
  };

  active = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* non-json body */ }

    if (url.includes('api.anthropic.com')) {
      state.providerCalls.anthropic++;
      const r = state.anthropic ? await state.anthropic(body, url, init) : null;
      if (r instanceof Response) return r;
      if (r && r.throw) throw r.throw;
      if (r && r.rawBody !== undefined) {
        return new Response(r.rawBody, { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
      }
      return jsonRes(r?.body ?? {}, r?.status ?? 200, r?.headers ?? {});
    }
    if (url.includes('api.openai.com')) {
      state.providerCalls.openai++;
      const r = state.openai ? await state.openai(body, url, init) : null;
      if (r instanceof Response) return r;
      if (r && r.throw) throw r.throw;
      if (r && r.rawBody !== undefined) {
        return new Response(r.rawBody, { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
      }
      return jsonRes(r?.body ?? {}, r?.status ?? 200);
    }
    if (url.includes('vision.googleapis.com')) {
      state.providerCalls.vision++;
      const r = state.vision ? await state.vision(body, url, init) : null;
      if (r instanceof Response) return r;
      if (r && r.throw) throw r.throw;
      return jsonRes(r?.body ?? { responses: [{}] }, r?.status ?? 200);
    }
    // SEC-9. Voyage was in the round-9 provider INVENTORY as DOWNSTREAM and had
    // NO bucket here, so `generateQueryEmbedding` fell through to the catch-all
    // below and was answered 200 with `[]` — a successful-looking empty
    // embedding, counted in no `providerCalls` bucket, across all 50 passing
    // refund tests. The inventory said it was covered; nothing modelled it.
    if (url.includes('api.voyageai.com')) {
      state.providerCalls.voyage++;
      const r = state.voyage ? await state.voyage(body, url, init) : null;
      if (r instanceof Response) return r;
      if (r && r.throw) throw r.throw;
      return jsonRes(r?.body ?? { data: [{ embedding: new Array(8).fill(0) }] }, r?.status ?? 200);
    }

    // ── Supabase ──
    if (url.includes('/rpc/check_and_increment_scan_rate')) {
      state.rpcLog.push('ratelimit');
      return jsonRes([{ allowed: true, limit_type: null, daily_count: 1, charged: state.charged }]);
    }
    if (url.includes('/rpc/decrement_user_daily_scan')) {
      state.refunds++;
      state.rpcLog.push('REFUND');
      return jsonRes(0);
    }
    // ── Anything else ──
    // Supabase REST/RPC is ours and is answered as an empty result set. ANY
    // OTHER EXTERNAL HOST IS A FAILURE, LOUDLY.
    //
    // SEC-9: this used to be a single catch-all returning 200 `[]` for every
    // unmatched URL, which meant a provider nobody had modelled was
    // indistinguishable from a provider that answered successfully. A new
    // market-data or search host would have inherited that silence and every
    // refund test would have stayed green against a call the harness never saw.
    // A test harness that invents a success is worse than one that has no
    // opinion: it launders an unknown into a pass.
    if (url.includes('fake.supabase.co')) {
      state.otherLog.push(url.replace('https://fake.supabase.co', ''));
      return jsonRes([], 200);
    }
    // HIGH-1 — OUT-OF-BAND OBSERVATION.
    // The throw below is necessary and NOT sufficient. It is raised inside
    // production's own call stack, so any `try/catch` on the path swallows it
    // and the test still goes green — which is precisely the shape this project
    // keeps shipping. The record here is read AFTER the handler has returned,
    // by `run()`, where production has no reach. Swallow the exception all you
    // like; the fact of the attempt has already left the building.
    state.unknownHosts.push(url);
    throw new Error(
      `[harness] UNSTUBBED EXTERNAL HOST: ${url}
` +
      'Add an explicit responder and a providerCalls bucket for it in ' +
      'tests/helpers/analyze-harness.mjs, and add it to the provider INVENTORY ' +
      'in tests/refund-crossproduct.test.mjs. An unmodelled provider must never ' +
      'be answered 200 by default.');
  };

  return {
    state,
    anthropic: (fn) => { state.anthropic = fn; },
    openai: (fn) => { state.openai = fn; },
    vision: (fn) => { state.vision = fn; },
    voyage: (fn) => { state.voyage = fn; },
    charged: (v) => { state.charged = v; },
    // Clears the responder, leaving the module-scope dispatcher in place so a
    // module-scope capture taken by an ALREADY-IMPORTED module stays observable.
    restore: () => { active = null; },

    // HIGH-1. Reads the out-of-band record and FAILS THE TEST. Deliberately
    // separate from run() so a test can also assert the property at a point of
    // its own choosing.
    assertNoUnknownHosts(where = 'this request') {
      if (state.unknownHosts.length === 0) return;
      const seen = [...new Set(state.unknownHosts)];
      const e = new Error(
        '[harness] UNMODELLED EXTERNAL HOST ATTEMPTED during ' + where + ':' + NL +
        seen.map((u) => '  - ' + u).join(NL) + NL +
        'Observed OUT OF BAND, after the handler returned, so a try/catch in ' +
        'production cannot hide it. Add an explicit responder and a providerCalls ' +
        'bucket in tests/helpers/analyze-harness.mjs, and an INVENTORY entry in ' +
        'tests/refund-crossproduct.test.mjs.');
      e.unknownHosts = seen;
      throw e;
    },

    async run(bodyObj, { headers = {}, quiet = true, allowUnknownHosts = false } = {}) {
      state.refunds = 0; state.rpcLog = []; state.otherLog = [];
      state.providerCalls = { anthropic: 0, openai: 0, vision: 0, voyage: 0 };
      state.unknownHosts = [];
      const logs = [];
      const orig = { log: console.log, warn: console.warn, error: console.error };
      if (quiet) {
        console.log = (...a) => logs.push(a.map(String).join(' '));
        console.warn = (...a) => logs.push(a.map(String).join(' '));
        console.error = (...a) => logs.push(a.map(String).join(' '));
      }
      let res, err;
      try {
        res = await handler(new Request('https://x/api/analyze', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${mintJWT()}`,
            origin: 'https://getworth.ai',
            ...headers,
          },
          body: JSON.stringify(bodyObj),
        }));
      } catch (e) { err = e; } finally { Object.assign(console, orig); }

      // THE ENFORCEMENT POINT. After the handler has returned and before any
      // result reaches the caller. Production has already had its chance to
      // catch the throw from fetch; this is not in its call stack at all.
      //
      // `allowUnknownHosts` exists for ONE purpose: the negative control that
      // proves this mechanism works. It is not a way to quiet a real finding,
      // and an audit test asserts it appears in exactly one test file.
      if (!allowUnknownHosts && state.unknownHosts.length > 0) {
        const seen = [...new Set(state.unknownHosts)];
        const e = new Error(
          '[harness] UNMODELLED EXTERNAL HOST ATTEMPTED during the request:' + NL +
          seen.map((u) => '  - ' + u).join(NL) + NL +
          'The fetch stub threw, and production SWALLOWED it — which is why this ' +
          'check is out of band. Add an explicit responder and a providerCalls ' +
          'bucket in tests/helpers/analyze-harness.mjs, and an INVENTORY entry in ' +
          'tests/refund-crossproduct.test.mjs.');
        e.unknownHosts = seen;
        throw e;
      }

      let payload = null;
      try { payload = res ? await res.clone().json() : null; } catch { /* non-json response */ }
      return {
        status: res?.status, payload, err,
        refunds: state.refunds,
        rpcLog: [...state.rpcLog],
        providerCalls: { ...state.providerCalls },
        unknownHosts: [...state.unknownHosts],
        logs,
        log: logs.join('\n'),
      };
    },
  };
}
