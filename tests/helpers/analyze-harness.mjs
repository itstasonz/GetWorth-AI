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

const JWT_SECRET = 'test-secret';

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

export async function harness() {
  setEnv();
  const mod = await import('../../api/analyze.js');
  const handler = mod.default;

  const state = {
    refunds: 0, charged: true,
    anthropic: null, openai: null, vision: null,
    voyage: null,
    rpcLog: [], otherLog: [], providerCalls: { anthropic: 0, openai: 0, vision: 0, voyage: 0 },
    unknownHosts: [],
  };

  const realFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
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
    restore: () => { globalThis.fetch = realFetch; },

    async run(bodyObj, { headers = {}, quiet = true } = {}) {
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
