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
//       offered, 'unsure', a number in a number question's own unit, or — for a choice whose options do not fit —
//       { other: "64 GB" }: the owner's own short words, bounded and cleaned at the boundary (identify.js recordAnswer).
//       Never free text to a model.
//
// Every request passes the same gate, in the order that makes a refused request
// cost nothing:  method → session → body (bounded) → configuration → quota.
//
// OPEN TO EVERY SIGNED-IN ACCOUNT (founder decision, 2026-11-08). The earlier
// founder-only rollout list (SCAN_ENGINE_V2_USER_IDS) is no longer consulted
// here. What still stands between a request and a paid call: a verified
// session, a bounded body, the deployment's own switch (CORE_SCAN_ENABLED), and
// the atomic quota (per-address and per-account bursts, a daily allowance) that
// refuses when it cannot be checked. A 503 now means only that this deployment
// has the scan switched off, and its reason is recorded.
//
// { action: 'report', scan_uuid, token, report: { identity_shown_ms, price_shown_ms, outcome } }
//     The phone's own clock: how long the person waited. Token-bound, numbers
//     only, no provider call, no quota.
//
// Every request leaves one telemetry row (_lib/scan/telemetry.js).
//
// The OpenAI key never leaves the server, and nothing a browser sends reaches a
// prompt except through the fenced, length-bounded fields the steps name.
// ══════════════════════════════════════════════════════════════════════════════
import { verifyJWT } from './analyze.js';
import { cors, json, readImage, nodeHandler, UUID_RE } from './_lib/v2/http.js';
import {
  resolveScanMode, resolveIdentityModel, resolveMarketModel, SCAN_MODE, SCAN_KEY_ENV,
  MAX_BODY_BYTES, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_USER_TEXT, MAX_REVISIONS, MAX_FOLLOWUPS,
} from './_lib/scan/config.js';
import { runIdentify, runPrice, startingCondition, SCAN_STATUS } from './_lib/scan/service.js';
import { recordAnswer, questionAfterResearch } from './_lib/scan/identify.js';
import { signScanToken, verifyScanToken } from './_lib/scan/token.js';
import { chargeScan, refundScan, warmQuota } from './_lib/scan/quota.js';
import { recordValuation, logScanEvent } from './_lib/scan/persist.js';
import { recordRequest, instanceInfo } from './_lib/scan/telemetry.js';

// Must stay a literal: Vercel reads it statically.
export const config = { maxDuration: 60 };

const LANGS = ['he', 'en'];
/** Provider failures that trying again now cannot fix: the account is out of credit, the key is refused, none is set. */
export const LASTING_FAILURE = /^(credit_exhausted|auth|not_configured)$/;

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

/**
 * What the research found and why each price was or was not used, as counts: the queries planned and run, the pages
 * reached, every reason a price was set aside, the hosts the prices came from. Enough to tell "nothing was found" from
 * "found and rejected" from "found and unverified" (scripts/scan-trace.mjs reads it); nothing a person could be read from.
 */
export function diagnosticsOf(valuation) {
  const evidence = Array.isArray(valuation?.evidence) ? valuation.evidence : [];
  const reasons = {};
  const hosts = {};
  for (const e of evidence) {
    const why = e.used ? 'used' : (e.set_aside ?? 'other');
    reasons[why] = (reasons[why] ?? 0) + 1;
    const h = String(e.domain ?? 'unknown').slice(0, 60);
    hosts[h] = (hosts[h] ?? 0) + 1;
  }
  return { searched: valuation?.searched ?? null, evidence: evidence.length, reasons, hosts, unverified: valuation?.counts?.unverified ?? null, unbound: valuation?.counts?.unbound ?? null };
}

/** The handler over injectable dependencies, so the suites drive the real gate without a network. */
export function createScanHandler({
  identify = runIdentify, price = runPrice, charge = chargeScan, refund = refundScan, verify = verifyJWT,
  record = recordValuation, logEvent = logScanEvent, warm = warmQuota,
} = {}) {
  return async function handleRequest(req) {
    const headers = cors(req.headers.get('origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

    // Where a request's time goes before any step runs: instance age (cold or warm), session check, the photograph's upload.
    const tIn = Date.now();
    const instance = instanceInfo(tIn);
    let user = null;
    try { user = await verify(req.headers.get('authorization')); } catch { user = null; }
    const authMs = Date.now() - tIn;
    if (!user || !user.id) return json({ error: 'unauthorized' }, 401, headers);
    if (user._expired) return json({ error: 'unauthorized', code: 'SESSION_EXPIRED' }, 401, headers);

    let raw;
    try { raw = await req.text(); } catch (err) {
      return json({ error: err?.bodyTooLarge ? 'payload_too_large' : 'bad_request' }, err?.bodyTooLarge ? 413 : 400, headers);
    }
    const bodyMs = Date.now() - tIn - authMs;
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request', detail: 'invalid JSON' }, 400, headers); }

    const scanUuid = typeof body?.scan_uuid === 'string' && UUID_RE.test(body.scan_uuid) ? body.scan_uuid : null;
    if (!scanUuid) return json({ error: 'bad_request', detail: 'scan_uuid must be a UUID' }, 400, headers);
    const lang = LANGS.includes(body?.lang) ? body.lang : 'he';
    const action = body?.action;
    if (action !== 'identify' && action !== 'price' && action !== 'report' && action !== 'warm') return json({ error: 'bad_request', detail: 'unknown action' }, 400, headers);

    const mode = resolveScanMode(process.env);
    if (mode !== SCAN_MODE.ENABLED) {
      console.warn(`[Scan] unavailable mode=${mode} scan=${scanUuid.slice(0, 8)}`);
      await recordRequest(logEvent, scanUuid, { action, http: 503, outcome: 'unavailable', reason: mode, userId: user.id, totalMs: 0 });
      return json({ scan_uuid: scanUuid, status: 'unavailable', error: 'scan_unavailable', reason: mode }, 503, headers);
    }

    const t0 = Date.now();
    const base = { scan_uuid: scanUuid };
    const safetyIdentifier = `gw-${scanUuid}`;
    const apiKey = process.env[SCAN_KEY_ENV];
    const done = async (payload, status, call, extra = {}) => {
      const total = Date.now() - t0;
      await recordRequest(logEvent, scanUuid, {
        action, http: status, outcome: payload.status ?? payload.error ?? 'unknown', reason: payload.failure ?? payload.detail ?? null,
        userId: user.id, totalMs: total, call, extra: { ...instance, auth_ms: authMs, body_ms: bodyMs, ...extra },
      });
      console.log(`[Scan] action=${action} scan=${scanUuid.slice(0, 8)} http=${status} status=${payload.status ?? payload.error} total_ms=${total}`
        + (call ? ` model=${call.model} provider_ms=${call.ms} in=${call.usage?.input_tokens ?? '-'} out=${call.usage?.output_tokens ?? '-'} tools=${call.tool_calls ?? '-'}` : ''));
      return json({ ...base, ...payload, timings: { total_ms: total, provider_ms: call?.ms ?? null, first_output_ms: call?.first_output_ms ?? null, first_search_ms: call?.first_search_ms ?? null } }, status, headers);
    };

    // ── WARM — the camera is opening (src/lib/coreScan.js warmScan) ─────────
    // A signed-in request with no photograph: this instance, its session check and its database connection are set up
    // now instead of while the person waits for an answer. No quota is charged and no provider is called; the one
    // database read is this account's own allowance row. At most once a minute per account on an instance.
    if (action === 'warm') {
      const tWarm = Date.now();
      const warmed = await warm({ userId: user.id });
      return done({ status: warmed ? 'warm' : 'skipped' }, 200, null, { warm_ms: Date.now() - tWarm });
    }

    // A token, when one is presented, must be this account's and this scan's.
    let prior = null;
    if (body?.token !== undefined && body?.token !== null) {
      const verified = await verifyScanToken(body.token, { userId: user.id, scanUuid });
      if (!verified.ok) return done({ error: 'invalid_token', detail: verified.error }, 400);
      prior = verified.state;
    }

    // ── REPORT — what the phone measured ────────────────────────────────────
    if (action === 'report') {
      if (!prior) return done({ error: 'invalid_token', detail: 'token_missing' }, 400);
      const r = body?.report && typeof body.report === 'object' ? body.report : {};
      const ms = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(600_000, Math.round(v)) : null);
      const outcome = typeof r.outcome === 'string' && /^[a-z_]{1,24}$/.test(r.outcome) ? r.outcome : null;
      return done({ status: 'reported' }, 200, null, { client: { identity_shown_ms: ms(r.identity_shown_ms), price_shown_ms: ms(r.price_shown_ms), outcome } });
    }

    // ── PRICE ────────────────────────────────────────────────────────────────
    if (action === 'price') {
      if (!prior) return done({ error: 'invalid_token', detail: 'token_missing' }, 400);
      if (!prior.identity?.is_sellable_item) return done({ error: 'bad_request', detail: 'nothing to price' }, 400);
      let answer = null;
      let identity = prior.identity;
      if (body?.answer !== undefined && body?.answer !== null) {
        // The answer is an option the scan offered (by index), "unsure", a number in the question's own unit, or the owner's
        // own short words when no option fits a choice ({ other }) — bounded and cleaned before it is anything. It becomes a
        // confirmed fact on the identity, and the server then chooses the next question, if any.
        const recorded = recordAnswer(identity, body.answer, { lang, followupsLeft: MAX_FOLLOWUPS - (prior.followups ?? 0) });
        if (recorded.error) return done({ error: 'bad_request', detail: recorded.error }, 400);
        ({ identity, answer } = recorded);
        const token = await signScanToken({
          userId: user.id, scanUuid, identity, started: prior.iat ?? null,
          counters: { revisions: prior.revisions ?? 0, followups: (prior.followups ?? 0) + (identity.followup.kind === 'none' ? 0 : 1), identify_ms: prior.identify_ms ?? null },
        });
        // Another REQUIRED question stands before the search: the identity goes back, with that question on it, and no
        // market request is made yet.
        if (identity.followup?.required === true) {
          return done({ status: SCAN_STATUS.IDENTIFIED, identity, default_condition: startingCondition(identity), token }, 200);
        }
        prior = { ...prior, identity };
        base.token = token;
      }
      const result = await price({ identity, answer, scanUuid, model: resolveMarketModel(process.env), apiKey, safetyIdentifier });
      if (result.status === SCAN_STATUS.FAILED) return done({ status: result.status, failure: result.failure, retryable: !LASTING_FAILURE.test(String(result.failure ?? '')) }, 200, result.call);
      // ONE MORE PHOTOGRAPH MAY CHANGE THE NEXT SEARCH (identify.js questionAfterResearch): when a technical item with no
      // model code found no second-hand reference, the model label is offered beside the result, in a re-signed token.
      const more = questionAfterResearch(identity, result.valuation, { lang, followupsLeft: MAX_FOLLOWUPS - (prior.followups ?? 0) });
      if (more) {
        identity = { ...identity, followup: more, asked_label: true };
        base.token = await signScanToken({
          userId: user.id, scanUuid, identity, started: prior.iat ?? null,
          counters: { revisions: prior.revisions ?? 0, followups: (prior.followups ?? 0) + 1, identify_ms: prior.identify_ms ?? null },
        });
      }
      // What the scan leaves behind: the row a listing links to, and its own timings.
      const clientMs = Number.isFinite(body?.client_elapsed_ms) ? Math.max(0, Math.min(600_000, Math.round(body.client_elapsed_ms))) : null;
      const [valuationId] = await Promise.all([
        record({ userId: user.id, scanUuid, identity, valuation: result.valuation, lang }),
        logEvent(scanUuid, 'core_scan_priced', {
          // Why the research priced or did not: hosts and reasons only — no page text, no photograph, no person.
          diagnostics: diagnosticsOf(result.valuation), asked_after: more ? more.attribute : null,
          status: result.status, withdrawn: result.valuation?.withdrawn ?? null, price_confidence: result.valuation?.price_confidence ?? null,
          identity_confidence: identity.identity_confidence, category: identity.category, counts: result.valuation?.counts ?? null,
          identify_ms: prior.identify_ms ?? null, market_ms: result.call?.ms ?? null, first_search_ms: result.call?.first_search_ms ?? null,
          tool_calls: result.call?.tool_calls ?? null, stages: result.call?.stages ?? null, usage: result.call?.usage ?? null, model: result.call?.model ?? null,
          basis: result.valuation?.basis ?? null, strategy: result.valuation?.strategy ?? null, local_strength: result.valuation?.local_strength ?? null, dispersion: result.valuation?.dispersion ?? null, unbound: result.valuation?.counts?.unbound ?? null,
          reused: result.reused === true, stale: result.stale === true, approximate: result.valuation?.approximate === true,
          market_class: identity.market_class ?? null, identity_precision: identity.identity_precision ?? null, confirmed: identity.confirmed?.length ?? 0,
          revisions: prior.revisions ?? 0, answered: !!answer, client_elapsed_before_price_ms: clientMs,
        }),
      ]);
      // With an answer recorded the token was re-signed: the client carries the newest one.
      const v = result.valuation;
      // What the research found and why it priced or did not — hosts, counts and reasons only — in the runtime log as well
      // as in scan_events, so a scan can be explained from either. No page text, no person.
      console.log(`[Scan] research scan=${scanUuid.slice(0, 8)} ${JSON.stringify({ ...diagnosticsOf(v), withdrawn: v?.withdrawn ?? null, estimate_basis: v?.estimate_basis ?? null, gap: v?.evidence_gap ?? null, retail_new_ils: v?.retail_new_ils ?? null, reused: result.reused === true }).slice(0, 3000)}`);
      // Every reference by its public page: what it was, what it cost in shekels, and whether it counted and why not.
      console.log(`[Scan] evidence scan=${scanUuid.slice(0, 8)} ${JSON.stringify((v?.evidence ?? []).slice(0, 16).map((e) => ({ u: String(e.url ?? '').slice(0, 140), k: e.kind, m: e.match, mk: e.market, ils: e.price_ils ?? null, c: e.condition ?? null, f: e.freshness ?? null, b: e.binding ?? null, used: e.used === true, why: e.set_aside ?? null })))}`);
      return done({ status: result.status, valuation: v, valuation_id: valuationId ?? null, fx_date: result.fx_date ?? null, reused: result.reused === true, stale: result.stale === true, refreshing: result.refreshing === true, ...(base.token ? { token: base.token, identity } : {}) }, 200, result.call, {
        stale: result.stale === true, refreshing: result.refreshing === true,
        item: String(identity.display_name ?? '').slice(0, 120) || null, category: identity.category ?? null,
        priced: result.status === 'priced', withdrawn: v?.withdrawn ?? null, price_confidence: v?.price_confidence ?? null,
        approximate: v?.approximate === true, basis: v?.basis ?? null, reused: result.reused === true,
        searches: Array.isArray(v?.searched?.queries) ? v.searched.queries.length : null, evidence: Array.isArray(v?.evidence) ? v.evidence.length : 0,
        evidence_used: Array.isArray(v?.evidence) ? v.evidence.filter((e) => e.used).length : 0, resale_refs: v?.counts?.resale ?? null,
        hosts: [...new Set((v?.evidence ?? []).map((e) => String(e.domain ?? '').slice(0, 60)).filter(Boolean))].slice(0, 12),
        client_elapsed_before_price_ms: clientMs,
      });
    }

    // ── IDENTIFY ─────────────────────────────────────────────────────────────
    const read = readImages(body?.images ?? body?.image);
    if (read.error) return done({ error: 'bad_request', detail: read.error }, 400);
    const correction = typeof body?.correction === 'string' && body.correction.trim() ? body.correction.trim().slice(0, MAX_USER_TEXT) : null;
    if (prior && (prior.revisions ?? 0) >= MAX_REVISIONS) return done({ error: 'too_many_revisions' }, 409);
    if (correction && !prior) return done({ error: 'bad_request', detail: 'a correction needs the scan it corrects' }, 400);

    // Where the time before the model goes (2026-11-08: 4 s unexplained on first identifications): measured, not guessed.
    const tQuota = Date.now();
    const quota = await charge({ ip: clientIp(req), userId: user.id });
    const quotaMs = Date.now() - tQuota;
    if (!quota.allowed) {
      await recordRequest(logEvent, scanUuid, { action, http: 429, outcome: 'rate_limited', reason: quota.limitType, userId: user.id, totalMs: Date.now() - t0, extra: { ...instance, auth_ms: authMs, body_ms: bodyMs, quota_ms: quotaMs } });
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
      // A failed scan never uses up the person's daily allowance (founder rule, 2026-11-10): it is given back whether or not
      // the provider billed the call. The per-minute limits are not given back, so a run of failures is still throttled.
      // An account or configuration problem (out of credit, a rejected key) does not go away by trying again now: the
      // client is told so, and the record says why.
      const refunded = !!quota.charged;
      if (refunded) await refund({ userId: user.id });
      return done({ status: result.status, failure: result.failure, retryable: !LASTING_FAILURE.test(String(result.failure ?? '')) }, 200, result.call, { quota_ms: quotaMs, refunded });
    }
    const tSign = Date.now();
    const token = await signScanToken({
      userId: user.id, scanUuid, identity: result.identity, started: prior?.iat ?? null,
      counters: { revisions: prior ? (prior.revisions ?? 0) + 1 : 0, followups: result.followups, identify_ms: result.call?.ms ?? null },
    });
    console.log(`[Scan] identity scan=${scanUuid.slice(0, 8)} ${JSON.stringify({ item: String(result.identity?.display_name ?? '').slice(0, 120), confidence: result.identity?.identity_confidence ?? null, precision: result.identity?.identity_precision ?? null, exact: result.identity?.exact_model_established === true, incomplete: result.identity?.incomplete ?? null, question: result.identity?.followup?.kind && result.identity.followup.kind !== 'none' ? `${result.identity.followup.kind}:${result.identity.followup.attribute ?? ''}` : null })}`);
    return done({ status: result.status, identity: result.identity, default_condition: result.default_condition, token }, 200, result.call, {
      item: String(result.identity?.display_name ?? '').slice(0, 120) || null, category: result.identity?.category ?? null,
      identity_confidence: result.identity?.identity_confidence ?? null, identity_precision: result.identity?.identity_precision ?? null,
      question: result.identity?.followup?.kind && result.identity.followup.kind !== 'none' ? String(result.identity.followup.attribute ?? result.identity.followup.kind).slice(0, 40) : null,
      incomplete: !!result.identity?.incomplete, images: read.images.length, image_bytes: read.images.reduce((n, b) => n + Math.round(b.length * 0.75), 0),
      revision: prior ? (prior.revisions ?? 0) + 1 : 0,
      quota_ms: quotaMs, sign_ms: Date.now() - tSign,
    });
  };
}

export default nodeHandler(createScanHandler(), { maxBodyBytes: MAX_BODY_BYTES, tag: 'Scan' });
