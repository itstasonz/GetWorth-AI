// ══════════════════════════════════════════════════════════════════════════════
// POST /api/enrich — PHASE B PRODUCT INTELLIGENCE (DEVELOPMENT ONLY)
//
// §2: this is a SEPARATE path. /api/analyze is untouched and keeps working; a
// normal production scan does not route here, and nothing in this file is
// reachable from that handler.
//
// §23: the response is a READ-ONLY CANDIDATE. This endpoint performs no
// database writes of any kind — no catalog insert, no recognition-memory
// promotion, no price observation, no correction, no valuation write. That is
// asserted by a test that greps this module's own import graph, not merely
// stated here, because "I did not write any writes" is exactly the kind of
// claim this repository has learned to distrust.
//
// ── ACTIVATION IS SERVER-OWNED ─────────────────────────────────────────────
//
// §4: the flag is read from the environment and from nowhere else. There is no
// body field, query parameter or header that can turn Phase B on. A paid
// provider call that a caller can trigger is a billing hole, and this endpoint
// is authenticated precisely so that even a disabled response is not free to
// enumerate.
//
// ── PRODUCTION ACTIVATION IS BLOCKED ───────────────────────────────────────
//
// See docs/PHASE_B_PRODUCTION_BLOCKERS.md. The foundation CRITICAL/HIGH
// findings from round 6 remain activation blockers; they do not block
// development, and this file does not pretend they are resolved.
// ══════════════════════════════════════════════════════════════════════════════
import { verifyJWT } from './analyze.js';
import {
  resolveEnrichmentMode, resolveEnrichmentModel, ENRICHMENT_MODE,
  ENRICHMENT_FLAG, ENRICHMENT_KEY_ENV,
} from './_lib/phaseb/config.js';
import { runPhaseB, PHASE_B_STATUS } from './_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from './_lib/phaseb/market-research.js';

const ALLOWED_ORIGINS = [
  'https://get-worth-ai.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Phase B sends photographs, so the body is far larger than submit-candidate's
// 16KB — but still bounded. Four 2MB images plus context, generously rounded.
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES = 4;

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = cors(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, corsHeaders);

  // ── AUTH, BEFORE ANYTHING ELSE ──────────────────────────────────────────
  // Reuses api/analyze.js's verifier rather than introducing a second scheme.
  let user = null;
  try {
    user = await verifyJWT(req.headers.get('authorization'));
  } catch {
    user = null;
  }
  if (!user || user._expired || !user.id) {
    return json({ error: 'unauthorized' }, 401, corsHeaders);
  }

  // ── BODY ────────────────────────────────────────────────────────────────
  let raw;
  try {
    raw = await req.text();
  } catch {
    return json({ error: 'bad_request', detail: 'unreadable body' }, 400, corsHeaders);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413, corsHeaders);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_request', detail: 'invalid JSON' }, 400, corsHeaders);
  }

  const scanUuid = typeof body?.scan_uuid === 'string' && UUID_RE.test(body.scan_uuid)
    ? body.scan_uuid : null;
  if (!scanUuid) {
    return json({ error: 'bad_request', detail: 'scan_uuid must be a UUID' }, 400, corsHeaders);
  }

  // ── THE FLAG. CHECKED BEFORE ANY ADAPTER IS CONSTRUCTED ─────────────────
  //
  // §29: OFF always means NO OpenAI call, and a missing key never crashes
  // anything. Both disabled states return 200 with an explicit status rather
  // than an error, because "the feature is off" is a normal answer to a
  // well-formed request, and a 5xx here would look like an outage.
  const mode = resolveEnrichmentMode(process.env);
  if (mode !== ENRICHMENT_MODE.ENABLED) {
    return json({
      scan_uuid: scanUuid,
      phase_b: {
        status: 'DISABLED',
        reason: mode,
        // Named so a developer can see WHAT to configure, without the endpoint
        // ever revealing whether a key is present in production.
        required: mode === ENRICHMENT_MODE.DISABLED_FLAG
          ? `${ENRICHMENT_FLAG}=true`
          : `${ENRICHMENT_KEY_ENV} (server environment)`,
        openai_called: false,
      },
    }, 200, corsHeaders);
  }

  // ── INPUT ───────────────────────────────────────────────────────────────
  //
  // §3: "Do not blindly trust client-supplied recognition/pricing context."
  // Nothing from the body is treated as authority. `existing_recognition` and
  // `existing_ocr` are HINTS that reach the model inside an untrusted fence
  // (see prompts.js) and are never read as evidence classes. Reconstructing
  // them server-side from `scan_uuid` is the better design and is recorded as
  // the next step in the blockers document — it needs a read path this phase
  // does not build.
  const images = Array.isArray(body?.images)
    ? body.images.filter((i) => typeof i === 'string' && i.length > 0).slice(0, MAX_IMAGES)
    : [];
  if (images.length === 0) {
    return json({ error: 'bad_request', detail: 'at least one image is required' }, 400, corsHeaders);
  }

  const language = String(body?.language ?? 'en').slice(0, 8);
  const existingRecognition = (body?.existing_recognition && typeof body.existing_recognition === 'object')
    ? body.existing_recognition : null;
  const existingOcr = Array.isArray(body?.existing_ocr) ? body.existing_ocr.slice(0, 40) : null;

  // ── RUN ─────────────────────────────────────────────────────────────────
  let result;
  try {
    result = await runPhaseB({
      images,
      language,
      existingRecognition,
      ocrText: existingOcr,
      catalogCandidates: [],
      model: resolveEnrichmentModel(process.env),
      apiKey: process.env[ENRICHMENT_KEY_ENV],
      // The research mechanism is a server decision, never a request field.
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
      // Pseudonymous and per-request: stable enough for abuse attribution,
      // and not an exported internal identifier.
      safetyIdentifier: `gw-${scanUuid}`,
    });
  } catch (err) {
    // §28: a Phase-B failure is a Phase-B status. It cannot corrupt a scan
    // because it never touches one.
    return json({
      scan_uuid: scanUuid,
      phase_b: {
        status: PHASE_B_STATUS.FAILED,
        failure_reason: String(err?.message ?? 'unknown').slice(0, 200),
        openai_called: true,
      },
    }, 200, corsHeaders);
  }

  // ── READ-ONLY CANDIDATE ─────────────────────────────────────────────────
  //
  // §23: the separation between CANDIDATE and TRUSTED is made obvious in the
  // payload itself rather than left to a reader's assumption.
  return json({
    scan_uuid: scanUuid,
    phase_b: {
      ...result,
      trust: {
        authority: 'none',
        is_candidate: true,
        promoted: false,
        note: 'Phase B output is evidence, not authority. Nothing here has been '
            + 'written to any trusted table, catalog, recognition memory or price observation.',
      },
    },
  }, 200, corsHeaders);
}
