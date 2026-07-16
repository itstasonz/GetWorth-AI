// ══════════════════════════════════════════════════════════════
// §  confirm-identity — universal Recognition Memory confirmation
// ══════════════════════════════════════════════════════════════
// SCAN-014 Phase 1.1A. Called on EVERY explicit "this identification
// is correct" action, independent of the catalog-candidate flow
// (submit-candidate is catalog-only as of this phase and never
// touches Recognition Memory).
//
// Anti-forgery by construction: the client sends ONLY a valuation_id.
// Brand / model / category / canonical key are derived server-side
// from the persisted valuation (which the pipeline wrote with the
// service role) — a user can only confirm what the pipeline actually
// told them, never a fabricated identity.
//
// Idempotency: (user, valuation) is the event identity. The endpoint
// derives everything from it, and the DB enforces one confirmation
// sample per (memory_id, user_id, valuation_id) — see migration
// 20260716000001. Double-taps, retries, and reconnects are no-ops.
//
// Hardening mirrors submit-candidate (ALPHA-003 pattern):
//   • Auth REQUIRED — user id from the server-verified JWT only.
//   • Ownership enforced — the valuation must belong to the caller.
//   • Per-user rate limiting (burst + daily), fail-closed.
//   • Strict validation: valuation_id must be a UUID; no other fields.
//   • Safe errors — never returns stack traces or DB internals.
//   • Shadow-safe: memory stays write-only here; nothing user-facing
//     changes based on the outcome (Phase 1 shadow contract).
// ══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { buildRecognitionMemoryKey } from './_lib/recognition-memory.js';

export const config = { runtime: 'edge' };

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
    'Vary': 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const MAX_BODY_BYTES = 1024;                       // { valuation_id } only
const ALLOWED_TOP_KEYS = new Set(['valuation_id']);
const RATE_WINDOW_SEC = 60;   // burst window
const RATE_MAX_WINDOW = 10;   // confirmations per user per minute
const RATE_MAX_DAY    = 120;  // per rolling 24h (scans are quota'd anyway)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = cors(origin);
  const ip = clientIp(req);

  // Log a rejection (reason + IP only — never the payload or token) and return a safe error.
  const reject = (reason, status, clientMsg, extraHeaders = {}) => {
    console.warn(`[ConfirmIdentity] rejected reason=${reason} status=${status} ip=${ip}`);
    return json({ error: clientMsg }, status, { ...corsHeaders, ...extraHeaders });
  };

  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== 'POST') return reject('method_not_allowed', 405, 'Method not allowed');

    const contentLen = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLen > MAX_BODY_BYTES) return reject('body_too_large', 413, 'Payload too large');

    // ── AUTH — mandatory; anonymous requests rejected ──
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return reject('missing_auth', 401, 'Authentication required');
    const token = authHeader.slice(7).trim();
    if (!token) return reject('empty_token', 401, 'Authentication required');

    const url        = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey || !serviceKey) return reject('server_misconfig', 503, 'Service temporarily unavailable');

    // Verify the token server-side. user.id is authoritative — the client never supplies it.
    let userId;
    try {
      const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
      const { data: { user }, error } = await authClient.auth.getUser(token);
      if (error || !user) return reject('invalid_token', 401, 'Invalid or expired session');
      userId = user.id;
    } catch {
      return reject('auth_exception', 401, 'Invalid or expired session');
    }

    // ── PARSE — { valuation_id } and nothing else ──
    let body;
    try { body = await req.json(); }
    catch { return reject('invalid_json', 400, 'Invalid JSON body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reject('invalid_body', 400, 'Invalid request body');
    }
    for (const k of Object.keys(body)) {
      if (!ALLOWED_TOP_KEYS.has(k)) return reject('unexpected_top_field', 400, `Unexpected field: ${k}`);
    }
    const { valuation_id } = body;
    if (typeof valuation_id !== 'string' || !UUID_RE.test(valuation_id)) {
      return reject('invalid_valuation_id', 400, 'Invalid valuation_id');
    }

    // ── Service-role client (bypasses RLS; every write is server-derived) ──
    const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ── RATE LIMIT — per verified user, fail-closed on error. Counts the
    //    user's confirmation samples; duplicates are DB no-ops that still
    //    inserted nothing, so retries of the same valuation don't burn quota
    //    beyond the rows they actually created. ──
    const nowMs    = Date.now();
    const winStart = new Date(nowMs - RATE_WINDOW_SEC * 1000).toISOString();
    const dayStart = new Date(nowMs - 24 * 3600 * 1000).toISOString();
    try {
      const [winRes, dayRes] = await Promise.all([
        supa.from('recognition_memory_samples').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('sample_type', 'confirmation').gte('created_at', winStart),
        supa.from('recognition_memory_samples').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('sample_type', 'confirmation').gte('created_at', dayStart),
      ]);
      if (winRes.error || dayRes.error) return reject('rate_check_failed', 503, 'Service temporarily unavailable');
      if ((winRes.count ?? 0) >= RATE_MAX_WINDOW) {
        return reject('rate_limited_burst', 429, 'Too many confirmations. Please wait a moment.', { 'Retry-After': String(RATE_WINDOW_SEC) });
      }
      if ((dayRes.count ?? 0) >= RATE_MAX_DAY) {
        return reject('rate_limited_daily', 429, 'Daily confirmation limit reached.', { 'Retry-After': '3600' });
      }
    } catch {
      return reject('rate_check_exception', 503, 'Service temporarily unavailable');
    }

    // ── OWNERSHIP + IDENTITY — load the caller's own valuation ──
    const { data: val, error: valErr } = await supa
      .from('valuations')
      .select('id, user_id, scan_uuid, ai_name, ai_name_hebrew, ai_category, ai_confidence, ai_raw_response')
      .eq('id', valuation_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (valErr) return reject('valuation_read_failed', 503, 'Service temporarily unavailable');
    if (!val) return reject('valuation_not_found', 404, 'Valuation not found');

    // Derive the confirmed identity from what the pipeline persisted. These
    // are the SAME fields analyze.js keys memory on (identification.brand /
    // identification.model = verification.final_*; category = final_category
    // || recognition.category). buildRecognitionMemoryKey fails closed on
    // 'unidentified' / missing parts — a skip, not an error.
    const raw = (val.ai_raw_response && typeof val.ai_raw_response === 'object') ? val.ai_raw_response : {};
    const identity = {
      brand:    raw.identification?.brand ?? raw.details?.brand ?? null,
      model:    raw.identification?.model ?? raw.details?.model ?? null,
      category: raw.category ?? val.ai_category ?? null,
    };
    const memKey = buildRecognitionMemoryKey(identity);
    if (!memKey.ok) {
      console.log(`[ConfirmIdentity] skip reason=${memKey.reason} valuation=${val.id}`);
      return json({ status: 'skipped', reason: memKey.reason }, 200, corsHeaders);
    }

    // ── RECORD — idempotent: DB unique index makes replays no-ops ──
    const confidence = (typeof val.ai_confidence === 'number'
      && val.ai_confidence >= 0 && val.ai_confidence <= 1) ? val.ai_confidence : null;
    const { data: memId, error: rpcErr } = await supa.rpc('memory_record_confirmation', {
      p_canonical_key: memKey.key,
      p_key_version: memKey.keyVersion,
      p_brand: identity.brand,
      p_model: identity.model,
      p_display_name: val.ai_name || null,
      p_display_name_hebrew: val.ai_name_hebrew || null,
      p_category: identity.category,
      p_subcategory: null,
      p_user_id: userId,
      p_scan_uuid: val.scan_uuid || null,
      p_valuation_id: val.id,
      p_confidence: confidence,
      p_candidate_id: null,
    });
    if (rpcErr) {
      console.error(`[ConfirmIdentity] rpc failed code=${rpcErr.code || 'unknown'} ip=${ip}`);
      return json({ error: 'Could not record confirmation' }, 500, corsHeaders);
    }

    console.log(`[ConfirmIdentity] recorded memory=${memId} valuation=${val.id} (shadow)`);
    return json({ status: 'recorded' }, 200, corsHeaders);
  } catch (err) {
    console.error(`[ConfirmIdentity] unhandled ${err?.name || 'Error'} ip=${ip}`);
    return json({ error: 'Internal server error' }, 500, corsHeaders);
  }
}
