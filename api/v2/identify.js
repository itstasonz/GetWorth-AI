// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v2/identify — SCAN ENGINE V2, STEP ONE
//
// One photograph in, one identity and one decision out:
//
//   SEARCH_NOW      the client may call /api/v2/price with the returned state
//   NEED_FOLLOWUP   the client shows ONE specific instruction and calls this
//                   endpoint again with the new photograph and the state
//   INSUFFICIENT    the follow-up was used and the identity still cannot carry
//                   a price; nothing will be searched
//
// ONE provider call per request. No search, no valuation, no database write.
//
// V1 (/api/analyze, /api/enrich) is untouched and does not import this file.
// V2 is off unless SCAN_ENGINE_V2_ENABLED is exactly 'true', and in production
// it is off for every user not named in SCAN_ENGINE_V2_USER_IDS.
// ══════════════════════════════════════════════════════════════════════════════
import { admit, json, readImage, nodeHandler } from '../_lib/v2/http.js';
import { resolveV2Model, V2_KEY_ENV, V2_MAX_FOLLOWUPS } from '../_lib/v2/config.js';
import { runV2Identify } from '../_lib/v2/scan.js';
import { signScanState, verifyScanState } from '../_lib/v2/state.js';
import { DECISION } from '../_lib/v2/sufficiency.js';
import { detectImageMime } from '../_lib/openai-recognition.js';

// Must stay a literal: Vercel reads it statically. Held equal to
// V2_FUNCTION_MAX_DURATION_S by tests/scan-v2-endpoints.test.mjs.
export const config = { maxDuration: 30 };

// One photograph at the PWA's 1280px is a few hundred KB of base64. Vercel
// refuses a request body over 4.5MB before this code runs.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function handleRequest(req) {
  const admitted = await admit(req, { maxBodyBytes: MAX_BODY_BYTES });
  if (admitted.response) return admitted.response;
  const { user, body, scanUuid, headers } = admitted;

  // "Is V2 on for me?" — asked once per session by a client built with the V2
  // flag, so that an account the server has not enrolled never uploads a
  // photograph here only to be told no. No image, no provider call.
  if (body?.probe === true) {
    return json({ scan_uuid: scanUuid, engine: 'v2', status: 'READY', openai_called: false }, 200, headers);
  }

  // ── WHAT ARRIVED, STATED ON EVERY ANSWER ─────────────────────────────────
  //
  // Facts about the request and never its contents: whether an image field was
  // present, what kind of image its first bytes say it is, how large it is, and
  // the stage at which this request stopped. It travels back in the response
  // and is logged as one line, so a scan that fails on a phone can be read from
  // the phone and from the server log alike.
  const field = body?.image;
  const diagnostics = {
    request_received: true,
    content_type: String(req.headers.get('content-type') ?? '').slice(0, 60) || null,
    image_field_present: typeof field === 'string' && field.length > 0,
    image_field_type: field === undefined ? 'absent' : (field === null ? 'null' : typeof field),
    image_mime: null,
    image_bytes: typeof field === 'string' ? Math.round((field.includes(',') ? field.length - field.indexOf(',') - 1 : field.length) * 0.75) : 0,
    parse_success: false,
    provider_request_started: false,
    provider_request_succeeded: false,
    failure_stage: null,
    failure_code: null,
  };
  const answer = (payload, status) => {
    console.log(`[V2Identify] scan=${scanUuid.slice(0, 8)} http=${status} ${JSON.stringify(diagnostics)}`);
    return json({ ...payload, diagnostics }, status, headers);
  };
  const stop = (stage, code) => { diagnostics.failure_stage = stage; diagnostics.failure_code = code; };

  const image = readImage(field);
  if (image.error) {
    stop('parse', 'SERVER_PARSE_FAILED');
    return answer({ error: 'bad_request', code: 'SERVER_PARSE_FAILED', detail: image.error }, 400);
  }
  diagnostics.image_mime = detectImageMime(image.b64, null);
  diagnostics.parse_success = true;
  const language = String(body?.language ?? 'en').slice(0, 8);

  // ── A FOLLOW-UP PHOTOGRAPH AUGMENTS A SCAN THIS SERVER STARTED ───────────
  let priorState = null;
  if (body?.state !== undefined && body?.state !== null) {
    const verified = await verifyScanState(body.state, { userId: user.id, scanUuid });
    if (!verified.ok) {
      stop('state', 'INVALID_STATE');
      return answer({ error: 'invalid_state', detail: verified.error }, 400);
    }
    const s = verified.state;
    if (s.sufficiency?.decision !== DECISION.NEED_FOLLOWUP || (s.followups_used ?? 0) >= V2_MAX_FOLLOWUPS) {
      stop('state', 'FOLLOWUP_NOT_EXPECTED');
      return answer({ error: 'followup_not_expected' }, 409);
    }
    priorState = s;
  }

  diagnostics.provider_request_started = true;
  const result = await runV2Identify({
    image: image.b64,
    priorState,
    language,
    model: resolveV2Model(process.env),
    apiKey: process.env[V2_KEY_ENV],
    // Pseudonymous and per-scan, never the user id.
    safetyIdentifier: `gw-${scanUuid}`,
  });

  if (!result.ok) {
    // An upstream 4xx on a request whose only variable part is the image is
    // the provider refusing the image; anything else is the provider failing.
    stop('provider', /^http_4/.test(String(result.failure)) ? 'PROVIDER_IMAGE_REJECTED' : 'PROVIDER_FAILED');
    return answer({
      scan_uuid: scanUuid, engine: 'v2', status: 'FAILED', failure: result.failure, retryable: true,
      timings: result.timings, calls: result.calls, openai_called: true,
    }, 200);
  }
  diagnostics.provider_request_succeeded = true;

  return answer({
    scan_uuid: scanUuid,
    engine: 'v2',
    status: 'OK',
    identity: result.identity,
    sufficiency: result.sufficiency,
    followups_used: result.followups_used,
    // Opaque to the client. It is what /api/v2/price and a follow-up accept.
    state: await signScanState({
      userId: user.id, scanUuid, identity: result.identity,
      sufficiency: result.sufficiency, followupsUsed: result.followups_used,
    }),
    timings: result.timings,
    calls: result.calls,
  }, 200);
}

export default nodeHandler(handleRequest, { maxBodyBytes: MAX_BODY_BYTES, tag: 'V2Identify' });
