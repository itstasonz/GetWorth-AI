// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — WHAT BOTH ENDPOINTS DO BEFORE THEY DO ANYTHING
//
// Auth, the flag, the allowlist and the body are handled once, here, in the
// order that makes a refused request cost nothing:
//
//   method -> auth -> body (bounded) -> flag -> allowlist
//
// A request that fails any of them has made no provider call and read no
// secret into a response. The two disabled states answer 200 with
// `status: 'DISABLED'`, as /api/enrich does: "this engine is not on for you"
// is a normal answer, and the client falls back to V1 on it.
//
// The Node adapter is the same shape as the one at the bottom of
// api/enrich.js and api/analyze.js, shared between the two V2 handlers rather
// than copied a third and fourth time.
// ══════════════════════════════════════════════════════════════════════════════
import { verifyJWT } from '../../analyze.js';
import { resolveV2Mode, isV2Permitted, V2_MODE, V2_FLAG } from './config.js';

const ALLOWED_ORIGINS = [
  'https://get-worth-ai.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/**
 * Everything that must hold before a V2 handler runs.
 *
 * Resolves to { response } when the request is already answered, or to
 * { user, body, scanUuid, headers } when the handler may proceed.
 */
export async function admit(req, { maxBodyBytes }) {
  const headers = cors(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return { response: new Response(null, { status: 204, headers }) };
  if (req.method !== 'POST') return { response: json({ error: 'method_not_allowed' }, 405, headers) };

  let user = null;
  try { user = await verifyJWT(req.headers.get('authorization')); } catch { user = null; }
  if (!user || user._expired || !user.id) return { response: json({ error: 'unauthorized' }, 401, headers) };

  let raw;
  try { raw = await req.text(); } catch (err) {
    return { response: json({ error: err?.bodyTooLarge ? 'payload_too_large' : 'bad_request' }, err?.bodyTooLarge ? 413 : 400, headers) };
  }
  if (raw.length > maxBodyBytes) return { response: json({ error: 'payload_too_large' }, 413, headers) };
  let body;
  try { body = JSON.parse(raw); } catch { return { response: json({ error: 'bad_request', detail: 'invalid JSON' }, 400, headers) }; }

  const scanUuid = typeof body?.scan_uuid === 'string' && UUID_RE.test(body.scan_uuid) ? body.scan_uuid : null;
  if (!scanUuid) return { response: json({ error: 'bad_request', detail: 'scan_uuid must be a UUID' }, 400, headers) };

  const disabled = (reason) => ({
    response: json({ scan_uuid: scanUuid, engine: 'v2', status: 'DISABLED', reason, openai_called: false }, 200, headers),
  });
  const mode = resolveV2Mode(process.env);
  if (mode !== V2_MODE.ENABLED) {
    // The reason names WHICH half of the configuration is missing, and never
    // whether a key or a secret is present in production beyond that.
    return disabled(mode === V2_MODE.DISABLED_FLAG ? `${V2_FLAG} is not 'true'` : mode);
  }
  if (!isV2Permitted(user.id, process.env)) return disabled('not_in_v2_allowlist');

  return { user, body, scanUuid, headers };
}

// ── IMAGE SANITY, BEFORE A PROVIDER CALL ────────────────────────────────────
const MIN_IMAGE_BYTES = 512;
const IMAGE_MAGIC = [
  [0xFF, 0xD8, 0xFF],            // JPEG
  [0x89, 0x50, 0x4E, 0x47],      // PNG
  [0x52, 0x49, 0x46, 0x46],      // RIFF (WEBP)
];

/** The bare base64 of a usable photograph, or { error }. */
export function readImage(value) {
  if (typeof value !== 'string' || !value) return { error: 'an image is required' };
  const b64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  if (Math.round(b64.length * 0.75) < MIN_IMAGE_BYTES) return { error: 'image is too small to be a photograph' };
  let head;
  try { head = Uint8Array.from(atob(b64.slice(0, 32)), (c) => c.charCodeAt(0)); } catch { return { error: 'image is not valid base64' }; }
  if (!IMAGE_MAGIC.some((sig) => sig.every((byte, k) => head[k] === byte))) return { error: 'image is not a recognised image format' };
  return { b64 };
}

// ── NODE SERVERLESS ADAPTER ─────────────────────────────────────────────────
function toWebRequest(nodeReq, maxBodyBytes) {
  let bodyPromise;
  const readAll = async () => {
    if (nodeReq.body !== undefined && nodeReq.body !== null && nodeReq.body !== '') {
      return typeof nodeReq.body === 'string' ? nodeReq.body : JSON.stringify(nodeReq.body);
    }
    // Bounded while reading, so an oversized body is never fully buffered.
    let total = 0;
    const chunks = [];
    for await (const chunk of nodeReq) {
      total += chunk.length;
      if (total > maxBodyBytes) throw Object.assign(new Error('body too large'), { bodyTooLarge: true });
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
    text: () => { if (!bodyPromise) bodyPromise = readAll(); return bodyPromise; },
  };
}

/** Wrap a Web-style `handleRequest(req)` as a dual-mode Vercel handler. */
export function nodeHandler(handleRequest, { maxBodyBytes, tag }) {
  return async function handler(req, res) {
    if (!res || typeof req?.headers?.get === 'function') return handleRequest(req);
    try {
      const webRes = await handleRequest(toWebRequest(req, maxBodyBytes));
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await webRes.text());
    } catch (err) {
      console.error(`[${tag}] adapter fatal:`, err?.bodyTooLarge ? 'payload_too_large' : err?.message);
      res.statusCode = err?.bodyTooLarge ? 413 : 500;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: err?.bodyTooLarge ? 'payload_too_large' : 'internal_error' }));
    }
  };
}
