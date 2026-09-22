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
  ENRICHMENT_FLAG, ENRICHMENT_KEY_ENV, isEnrichmentPermitted,
} from './_lib/phaseb/config.js';
import { runPhaseB, PHASE_B_STATUS } from './_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from './_lib/phaseb/market-research.js';

// ── THE RUNTIME, WHICH THIS FILE WAS SILENTLY MISSING ──────────────────────
//
// This endpoint was written against the Web shape — `req.headers.get()`,
// `await req.text()`, `return new Response(...)` — exactly like
// api/confirm-identity.js and api/submit-candidate.js. Those two declare
// `runtime: 'edge'`. This one declared nothing, so Vercel gave it the DEFAULT
// Node runtime, which invokes `handler(req, res)` with a Node IncomingMessage.
// `req.headers.get` is not a function on that object, so the first line of the
// handler threw and every request would have been a 500. Phase B has never
// been called over HTTP, which is why nothing caught it.
//
// THE FIX IS NODE, NOT EDGE, and the reason is latency. Edge is wall-capped at
// 25s (api/analyze.js records this, which is why IT moved off Edge), and Phase
// B's market_research stage alone is allowed 90s. Declaring `runtime: 'edge'`
// here would have replaced a 500 with a truncation at 25s — a worse failure,
// because it looks like a slow product rather than a misconfiguration.
//
// So: Node runtime, an explicit maxDuration, and the SAME dual-mode adapter
// api/analyze.js already uses at the bottom of this file. The handler body is
// untouched and still reads a Web Request; the adapter builds one.
export const config = { maxDuration: 60 };

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

async function handleRequest(req) {
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

  // ── THE OPTIONAL ALLOWLIST ──────────────────────────────────────────────
  //
  // Checked AFTER the flag and, like it, before any adapter exists — so a user
  // who is not enrolled costs exactly nothing. The response is the same
  // DISABLED shape with its own reason rather than a 403: not being in a test
  // cohort is not an authorisation failure, and a 403 here would tell a
  // caller that the feature exists and that they were singled out.
  if (!isEnrichmentPermitted(user.id, process.env)) {
    return json({
      scan_uuid: scanUuid,
      phase_b: {
        status: 'DISABLED',
        reason: 'not_in_enrichment_allowlist',
        required: `${ENRICHMENT_FLAG}=true and this user in the server allowlist`,
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

  // ── STRUCTURAL SANITY, BEFORE FOUR PROVIDER CALLS ───────────────────────
  //
  // The pixel check lives on the client, where the pixels are: deciding
  // "is this frame black" server-side would mean decoding a JPEG here, and a
  // server-side brightness heuristic that refuses a user's genuinely dark
  // photograph is a worse bug than the one it prevents.
  //
  // What CAN be answered from the bytes is whether this is an image at all.
  // An installed PWA can serve a cached build for days, so a client that
  // predates the pixel check will still send whatever it captured — and a
  // truncated, empty or non-image payload must not cost four calls to
  // discover. A 1×1 pixel is ~120 bytes; a photograph at any usable resolution
  // is tens of thousands. 512 is comfortably below any real capture and
  // comfortably above a stub.
  const MIN_IMAGE_BYTES = 512;
  const IMAGE_MAGIC = [
    [0xFF, 0xD8, 0xFF],                                     // JPEG
    [0x89, 0x50, 0x4E, 0x47],                               // PNG
    [0x52, 0x49, 0x46, 0x46],                               // RIFF (WEBP)
    [0x47, 0x49, 0x46, 0x38],                               // GIF8
  ];
  for (const [i, raw] of images.entries()) {
    const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    if (Math.round(b64.length * 0.75) < MIN_IMAGE_BYTES) {
      return json({ error: 'bad_request', detail: `image ${i + 1} is too small to be a photograph` }, 400, corsHeaders);
    }
    let head;
    try {
      head = Uint8Array.from(atob(b64.slice(0, 32)), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: 'bad_request', detail: `image ${i + 1} is not valid base64` }, 400, corsHeaders);
    }
    if (!IMAGE_MAGIC.some((sig) => sig.every((byte, k) => head[k] === byte))) {
      return json({ error: 'bad_request', detail: `image ${i + 1} is not a recognised image format` }, 400, corsHeaders);
    }
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

// ══════════════════════════════════════════════════════════════════════════════
// NODE SERVERLESS ADAPTER
//
// Deliberately the SAME shape as the adapter at the bottom of api/analyze.js,
// rather than a cleverer one. Two adapters that differ by accident is the
// "two implementations of one predicate" defect this repository has recorded
// four times; two that are visibly identical can be compared by eye.
//
// It is dual-mode on purpose. `handler(req)` with a real Web Request still
// works — that is how the existing endpoint tests call it, and how an Edge
// deployment would — while `handler(req, res)` adapts the Node pair. Neither
// path changes `handleRequest`, which keeps reading a Web Request and keeps
// returning a Response.
// ══════════════════════════════════════════════════════════════════════════════

/** The body ceiling, enforced while reading rather than after. */
const ADAPTER_BODY_MAX_BYTES = MAX_BODY_BYTES;

function toWebRequest(nodeReq) {
  let bodyPromise;
  const readAll = async () => {
    // Vercel's Node runtime may have parsed the body already.
    if (nodeReq.body !== undefined && nodeReq.body !== null && nodeReq.body !== '') {
      return typeof nodeReq.body === 'string' ? nodeReq.body : JSON.stringify(nodeReq.body);
    }
    // BOUNDED. Stop consuming the moment the ceiling is crossed, so an
    // oversized or unterminated chunked body is never fully buffered — the
    // handler's own `raw.length > MAX_BODY_BYTES` check runs after the fact and
    // cannot protect memory on its own.
    let total = 0;
    const chunks = [];
    for await (const chunk of nodeReq) {
      total += chunk.length;
      if (total > ADAPTER_BODY_MAX_BYTES) {
        throw Object.assign(new Error('body too large'), { bodyTooLarge: true });
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  return {
    method: nodeReq.method,
    headers: {
      get: (name) => {
        const v = nodeReq.headers[String(name).toLowerCase()];
        return Array.isArray(v) ? v.join(', ') : (v ?? null);
      },
    },
    text: () => {
      if (!bodyPromise) bodyPromise = readAll();   // memoize — read once
      return bodyPromise;
    },
  };
}

async function writeWebResponse(nodeRes, webRes) {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value));
  const text = await webRes.text();
  nodeRes.end(text);
}

export default async function handler(req, res) {
  // Web path (single Request arg, no res): return the Response directly.
  if (!res || typeof req?.headers?.get === 'function') {
    return handleRequest(req);
  }
  try {
    const webRes = await handleRequest(toWebRequest(req));
    await writeWebResponse(res, webRes);
  } catch (err) {
    // A size failure is not an internal error, and saying so lets a client
    // shrink its images instead of retrying the same payload forever.
    const tooLarge = err?.bodyTooLarge === true;
    console.error('[Enrich] adapter fatal:', tooLarge ? 'payload_too_large' : err?.message);
    res.statusCode = tooLarge ? 413 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: tooLarge ? 'payload_too_large' : 'internal_error' }));
  }
}
