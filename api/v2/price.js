// ══════════════════════════════════════════════════════════════════════════════
// POST /api/v2/price — SCAN ENGINE V2, STEP TWO
//
// Takes the signed state /api/v2/identify returned and answers "what can I sell
// this for?" with one of five truthful states.
//
// IT SEARCHES ONLY FOR AN IDENTITY THIS SERVER ESTABLISHED. The request carries
// no product name, no query and no price: the state is verified, the plan is
// built here from the identity inside it, and an identity the sufficiency gate
// did not approve is answered NEED_MORE_INFORMATION without a provider call.
//
// ONE search call, stopped when the results arrive. No model writes a query, an
// observation or a number. No database write.
// ══════════════════════════════════════════════════════════════════════════════
import { admit, json, nodeHandler } from '../_lib/v2/http.js';
import { resolveV2Model, V2_KEY_ENV } from '../_lib/v2/config.js';
import { runV2Price } from '../_lib/v2/scan.js';
import { verifyScanState } from '../_lib/v2/state.js';
import { describeSearch, describeEvidence } from '../_lib/v2/report.js';
import { resolveMarketRegion } from '../_lib/phaseb/config.js';

// Must stay a literal: Vercel reads it statically.
export const config = { maxDuration: 30 };

const MAX_BODY_BYTES = 64 * 1024;

async function handleRequest(req) {
  const admitted = await admit(req, { maxBodyBytes: MAX_BODY_BYTES });
  if (admitted.response) return admitted.response;
  const { user, body, scanUuid, headers } = admitted;

  const verified = await verifyScanState(body?.state, { userId: user.id, scanUuid });
  if (!verified.ok) return json({ error: 'invalid_state', detail: verified.error }, 400, headers);

  const result = await runV2Price({
    state: verified.state,
    model: resolveV2Model(process.env),
    apiKey: process.env[V2_KEY_ENV],
    // The market is a server decision, never a request field.
    marketRegion: resolveMarketRegion(),
    safetyIdentifier: `gw-${scanUuid}`,
  });

  return json({
    scan_uuid: scanUuid,
    engine: 'v2',
    status: 'OK',
    valuation: result.valuation,
    search: describeSearch(result.plan, result.search),
    evidence: describeEvidence(result.evidence),
    timings: result.timings,
    calls: result.calls,
  }, 200, headers);
}

export default nodeHandler(handleRequest, { maxBodyBytes: MAX_BODY_BYTES, tag: 'V2Price' });
