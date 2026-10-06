// ══════════════════════════════════════════════════════════════════════════════
// POST /api/scan — THE CORE SCAN
//
// Photograph in, answer out. One endpoint, two actions:
//
//   { action: 'identify', scan_uuid, lang, images: [...], token?, correction? }
//       A vision model looks at the photograph and says what the item is.
//       With `token`, the same scan goes round again: a correction the owner
//       typed, or one more photograph the scan asked for.
//
//   { action: 'price', scan_uuid, lang, token, answer? }
//       The live web is searched for what that item sells for second-hand in
//       Israel today, and the server prices it from the evidence. Research
//       for the same item is reused for an hour instead of searched again. `answer` is the INDEX of an option the identification
//       offered, or 'unsure' — never free text.
//
// Every request passes the same gate, in the order that makes a refused request
// cost nothing:  method → session → body (bounded) → configuration → rollout
// list → quota.
//
// THE ROLLOUT LIST. The core scan is open only to the accounts on the existing
// SCAN_ENGINE_V2_USER_IDS list, and in Production an empty or missing list
// admits nobody. An account that is not on it is answered exactly as a
// deployment with the scan switched off is — 503 `unavailable`, no reason — and
// the app already turns that answer into the scan it had before.
//
// The OpenAI key never leaves the server, and nothing a browser sends reaches a
// prompt except through the fenced, length-bounded fields the steps name.
// ══════════════════════════════════════════════════════════════════════════════
import { verifyJWT } from './analyze.js';
import { cors, json, readImage, nodeHandler, UUID_RE } from './_lib/v2/http.js';
import { isV2Permitted } from './_lib/v2/config.js';
import {
  resolveScanMode, resolveIdentityModel, resolveMarketModel, SCAN_MODE, SCAN_KEY_ENV,
  MAX_BODY_BYTES, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_USER_TEXT, MAX_REVISIONS,
} from './_lib/scan/config.js';
import { runIdentify, runPrice, SCAN_STATUS } from './_lib/scan/service.js';
import { signScanToken, verifyScanToken } from './_lib/scan/token.js';
import { chargeScan, refundScan } from './_lib/scan/quota.js';
import { recordValuation, logScanEvent } from './_lib/scan/persist.js';

// Must stay a literal: Vercel reads it statically.
export const config = { maxDuration: 60 };

const LANGS = ['he', 'en'];
const UNSURE = { he: 'הבעלים לא בטוחים', en: 'The owner is not sure' };

const clientIp = (req) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';

/** The images of a request as bare base64, or { error }. */
function readImages(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  if (list.length === 0) return { error: 'a photograph is required' };
  if (list.length > MAX_IMAGES) return { error: `at most ${MAX_IMAGES} photographs` };
  const out = [];
  for (const v of list) {
    const img = readImage(v);
    if (img.error) return { error: img.error };
    if (Math.round(img.b64.length * 0.75) > MAX_IMAGE_BYTES) return { error: 'photograph is too large' };
    out.push(img.b64);
  }
  return { images: out };
}

/** The handler over injectable dependencies, so the suites drive the real gate without a network. */
export function createScanHandler({
  identify = runIdentify, price = runPrice, charge = chargeScan, refund = refundScan, verify = verifyJWT,
  record = recordValuation, logEvent = logScanEvent,
} = {}) {
  return async function handleRequest(req) {
    const headers = cors(req.headers.get('origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

    let user = null;
    try { user = await verify(req.headers.get('authorization')); } catch { user = null; }
    if (!user || !user.id) return json({ error: 'unauthorized' }, 401, headers);
    if (user._expired) return json({ error: 'unauthorized', code: 'SESSION_EXPIRED' }, 401, headers);

    let raw;
    try { raw = await req.text(); } catch (err) {
      return json({ error: err?.bodyTooLarge ? 'payload_too_large' : 'bad_request' }, err?.bodyTooLarge ? 413 : 400, headers);
    }
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request', detail: 'invalid JSON' }, 400, headers); }

    const scanUuid = typeof body?.scan_uuid === 'string' && UUID_RE.test(body.scan_uuid) ? body.scan_uuid : null;
    if (!scanUuid) return json({ error: 'bad_request', detail: 'scan_uuid must be a UUID' }, 400, headers);
    const lang = LANGS.includes(body?.lang) ? body.lang : 'he';
    const action = body?.action;
    if (action !== 'identify' && action !== 'price') return json({ error: 'bad_request', detail: 'unknown action' }, 400, headers);

    const mode = resolveScanMode(process.env);
    if (mode !== SCAN_MODE.ENABLED) {
      console.warn(`[Scan] unavailable mode=${mode}`);
      return json({ scan_uuid: scanUuid, status: 'unavailable', error: 'scan_unavailable' }, 503, headers);
    }
    // Not on the rollout list: the same answer, so the app falls back to the scan this account already has.
    if (!isV2Permitted(user.id, process.env)) {
      return json({ scan_uuid: scanUuid, status: 'unavailable', error: 'scan_unavailable' }, 503, headers);
    }

    const t0 = Date.now();
    const base = { scan_uuid: scanUuid };
    const safetyIdentifier = `gw-${scanUuid}`;
    const apiKey = process.env[SCAN_KEY_ENV];
    const done = (payload, status, call) => {
      const total = Date.now() - t0;
      console.log(`[Scan] action=${action} scan=${scanUuid.slice(0, 8)} http=${status} status=${payload.status ?? payload.error} total_ms=${total}`
        + (call ? ` model=${call.model} provider_ms=${call.ms} in=${call.usage?.input_tokens ?? '-'} out=${call.usage?.output_tokens ?? '-'} tools=${call.tool_calls ?? '-'}` : ''));
      return json({ ...base, ...payload, timings: { total_ms: total, provider_ms: call?.ms ?? null, first_output_ms: call?.first_output_ms ?? null, first_search_ms: call?.first_search_ms ?? null } }, status, headers);
    };

    // A token, when one is presented, must be this account's and this scan's.
    let prior = null;
    if (body?.token !== undefined && body?.token !== null) {
      const verified = await verifyScanToken(body.token, { userId: user.id, scanUuid });
      if (!verified.ok) return done({ error: 'invalid_token', detail: verified.error }, 400);
      prior = verified.state;
    }

    // ── PRICE ────────────────────────────────────────────────────────────────
    if (action === 'price') {
      if (!prior) return done({ error: 'invalid_token', detail: 'token_missing' }, 400);
      const identity = prior.identity;
      if (!identity?.is_sellable_item) return done({ error: 'bad_request', detail: 'nothing to price' }, 400);
      let answer = null;
      if (body?.answer !== undefined && body?.answer !== null) {
        const options = identity.followup?.kind === 'choice' ? identity.followup.options : [];
        const text = body.answer === 'unsure' ? UNSURE[lang] : (Number.isInteger(body.answer) ? options[body.answer] : null);
        if (!text) return done({ error: 'bad_request', detail: 'answer is not one of the options offered' }, 400);
        answer = { question: identity.followup?.question ?? null, text };
      }
      const result = await price({ identity, answer, scanUuid, model: resolveMarketModel(process.env), apiKey, safetyIdentifier });
      if (result.status === SCAN_STATUS.FAILED) return done({ status: result.status, failure: result.failure, retryable: true }, 200, result.call);
      // What the scan leaves behind: the row a listing links to, and its own timings.
      const clientMs = Number.isFinite(body?.client_elapsed_ms) ? Math.max(0, Math.min(600_000, Math.round(body.client_elapsed_ms))) : null;
      const [valuationId] = await Promise.all([
        record({ userId: user.id, scanUuid, identity, valuation: result.valuation, lang }),
        logEvent(scanUuid, 'core_scan_priced', {
          status: result.status, withdrawn: result.valuation?.withdrawn ?? null, price_confidence: result.valuation?.price_confidence ?? null,
          identity_confidence: identity.identity_confidence, category: identity.category, counts: result.valuation?.counts ?? null,
          identify_ms: prior.identify_ms ?? null, market_ms: result.call?.ms ?? null, first_search_ms: result.call?.first_search_ms ?? null,
          tool_calls: result.call?.tool_calls ?? null, usage: result.call?.usage ?? null, model: result.call?.model ?? null,
          reused: result.reused === true, stale: result.stale === true, approximate: result.valuation?.approximate === true,
          revisions: prior.revisions ?? 0, answered: !!answer, client_elapsed_before_price_ms: clientMs,
        }),
      ]);
      return done({ status: result.status, valuation: result.valuation, valuation_id: valuationId ?? null, fx_date: result.fx_date ?? null, reused: result.reused === true }, 200, result.call);
    }

    // ── IDENTIFY ─────────────────────────────────────────────────────────────
    const read = readImages(body?.images ?? body?.image);
    if (read.error) return done({ error: 'bad_request', detail: read.error }, 400);
    const correction = typeof body?.correction === 'string' && body.correction.trim() ? body.correction.trim().slice(0, MAX_USER_TEXT) : null;
    if (prior && (prior.revisions ?? 0) >= MAX_REVISIONS) return done({ error: 'too_many_revisions' }, 409);
    if (correction && !prior) return done({ error: 'bad_request', detail: 'a correction needs the scan it corrects' }, 400);

    const quota = await charge({ ip: clientIp(req), userId: user.id });
    if (!quota.allowed) {
      return json({
        ...base, error: 'rate_limited', code: 'RATE_LIMITED', limitType: quota.limitType,
        retryAfterSeconds: quota.retryAfter, retryable: quota.limitType !== 'user_daily',
      }, 429, { ...headers, 'Retry-After': String(quota.retryAfter) });
    }

    const result = await identify({
      images: read.images, lang, correction,
      prior: prior ? { identity: prior.identity, followups: prior.followups ?? 0 } : null,
      model: resolveIdentityModel(process.env), apiKey, safetyIdentifier,
    });
    if (result.status === SCAN_STATUS.FAILED) {
      if (quota.charged && !result.billed) await refund({ userId: user.id });
      return done({ status: result.status, failure: result.failure, retryable: true }, 200, result.call);
    }
    const token = await signScanToken({
      userId: user.id, scanUuid, identity: result.identity, started: prior?.iat ?? null,
      counters: { revisions: prior ? (prior.revisions ?? 0) + 1 : 0, followups: result.followups, identify_ms: result.call?.ms ?? null },
    });
    return done({ status: result.status, identity: result.identity, default_condition: result.default_condition, token }, 200, result.call);
  };
}

export default nodeHandler(createScanHandler(), { maxBodyBytes: MAX_BODY_BYTES, tag: 'Scan' });
