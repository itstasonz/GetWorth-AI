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

  const image = readImage(body?.image);
  if (image.error) return json({ error: 'bad_request', detail: image.error }, 400, headers);
  const language = String(body?.language ?? 'en').slice(0, 8);

  // ── A FOLLOW-UP PHOTOGRAPH AUGMENTS A SCAN THIS SERVER STARTED ───────────
  let priorState = null;
  if (body?.state !== undefined && body?.state !== null) {
    const verified = await verifyScanState(body.state, { userId: user.id, scanUuid });
    if (!verified.ok) return json({ error: 'invalid_state', detail: verified.error }, 400, headers);
    const s = verified.state;
    if (s.sufficiency?.decision !== DECISION.NEED_FOLLOWUP || (s.followups_used ?? 0) >= V2_MAX_FOLLOWUPS) {
      return json({ error: 'followup_not_expected' }, 409, headers);
    }
    priorState = s;
  }

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
    return json({
      scan_uuid: scanUuid, engine: 'v2', status: 'FAILED', failure: result.failure, retryable: true,
      timings: result.timings, calls: result.calls, openai_called: true,
    }, 200, headers);
  }

  return json({
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
  }, 200, headers);
}

export default nodeHandler(handleRequest, { maxBodyBytes: MAX_BODY_BYTES, tag: 'V2Identify' });
