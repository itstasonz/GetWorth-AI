// ══════════════════════════════════════════════════════════════════════════════
// POST /api/scan-lab — THE PRIVATE BENCHMARK CAPTURE ENDPOINT
//
// One endpoint, one JSON body: { action, set, ... }. Every action — every read,
// write, upload token and download link — passes the same gate, in the order
// that makes a refused request cost nothing and learn nothing:
//
//   method -> session -> body (bounded) -> flag -> allowlist -> storage
//
// A signed-in account that is not on SCAN_LAB_USER_IDS is answered 403 with no
// reason: it is not told whether the lab is on, configured or populated. Hiding
// the navigation entry is a courtesy; this gate is the control.
//
// NO PAID CALL IS REACHABLE FROM HERE. The lab's own modules name one host, the
// project's own storage, and there is no action that runs recognition, search
// or pricing. The V1 scan and Scan Engine V2 do not import this file, and this
// file takes from them only the session verifier and the HTTP adapter.
//
// No photograph passes through this function: a body is a few KB of JSON.
// ══════════════════════════════════════════════════════════════════════════════
import { verifyJWT } from './analyze.js';
import { json, nodeHandler } from './_lib/v2/http.js';
import { resolveLabMode, isLabPermitted, resolveLabStorage, LAB_MODE, LAB_MAX_BODY_BYTES } from './_lib/scan-lab/config.js';
import { createLabStore } from './_lib/scan-lab/store.js';
import { createLabService } from './_lib/scan-lab/service.js';
import { LabError } from './_lib/scan-lab/truth.js';

// Must stay a literal: Vercel reads it statically.
export const config = { maxDuration: 30 };

const HEADERS = Object.freeze({ 'Cache-Control': 'no-store' });
export const LAB_ACTIONS = Object.freeze(['probe', 'state', 'begin', 'commit', 'truth', 'photo_url', 'remove', 'remove_set']);

/** Where the function was built from, for the diagnostics panel. Never a secret. */
const deployment = (env) => ({
  sha: String(env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local',
  environment: String(env.VERCEL_ENV ?? '') || 'local',
});

/**
 * The handler over an injectable store, so the suites drive the real gate and
 * the real service without a network.
 */
export function createLabHandler({ storeFor = (storage) => createLabStore(storage) } = {}) {
  return async function handleRequest(req) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, HEADERS);

    let user = null;
    try { user = await verifyJWT(req.headers.get('authorization')); } catch { user = null; }
    if (!user || user._expired || !user.id) return json({ error: 'unauthorized' }, 401, HEADERS);

    let raw;
    try { raw = await req.text(); } catch (err) {
      return json({ error: err?.bodyTooLarge ? 'payload_too_large' : 'bad_request' }, err?.bodyTooLarge ? 413 : 400, HEADERS);
    }
    if (raw.length > LAB_MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, HEADERS);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request', detail: 'invalid JSON' }, 400, HEADERS); }

    const mode = resolveLabMode(process.env);
    // One answer for "the lab is off" and "you are not on the list".
    if (mode === LAB_MODE.DISABLED_FLAG || !isLabPermitted(user.id, process.env)) {
      return json({ lab: 'scan-lab', status: 'DISABLED' }, 403, HEADERS);
    }
    const base = { lab: 'scan-lab', deployment: deployment(process.env) };
    // Said only to an allowlisted account: it is the person who has to fix it.
    if (mode !== LAB_MODE.ENABLED) return json({ ...base, status: 'UNAVAILABLE', reason: 'storage_not_configured' }, 200, HEADERS);

    const action = body?.action;
    if (!LAB_ACTIONS.includes(action)) return json({ ...base, error: 'bad_request', detail: 'unknown action' }, 400, HEADERS);
    if (action === 'probe') return json({ ...base, status: 'READY' }, 200, HEADERS);

    try {
      const service = createLabService({ store: storeFor(resolveLabStorage(process.env)) });
      // The owner is the verified session subject. A body cannot name another.
      const { action: _a, owner_id: _o, ownerId: _i, ...args } = body;
      const result = await service[action]({ ...args, ownerId: user.id });
      console.log(`[ScanLab] action=${action} http=200`);
      return json({ ...base, status: 'OK', ...result }, 200, HEADERS);
    } catch (err) {
      const known = err instanceof LabError;
      const status = known ? err.status : 500;
      console.warn(`[ScanLab] action=${action} http=${status} code=${known ? err.code : 'internal_error'}`);
      return json({ ...base, error: known ? err.code : 'internal_error', detail: known ? err.detail : null }, status, HEADERS);
    }
  };
}

export default nodeHandler(createLabHandler(), { maxBodyBytes: LAB_MAX_BODY_BYTES, tag: 'ScanLab' });
