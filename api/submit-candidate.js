// ══════════════════════════════════════════════════════════════
// §  submit-candidate  — save a user-confirmed product candidate
// ══════════════════════════════════════════════════════════════
// Called when the user confirms a scan result that returned 0 DB
// candidates. Inserts into product_candidates (staging table for
// admin review). Never touches the products table.
//
// SCAN-014 Phase 1.1A: this endpoint is CATALOG-ONLY. Recognition
// Memory confirmations moved to api/confirm-identity.js (called
// unconditionally on every confirm) — this file must never call
// memory_record_confirmation again.
//
// ALPHA-003 hardening (endpoint security only — no redesign):
//   • Auth REQUIRED — anonymous requests rejected (401).
//   • user id is derived from the server-verified JWT and written to
//     created_by; the client cannot forge it (no user id is accepted
//     from the body).
//   • Per-user rate limiting (burst + daily) via the existing
//     product_candidates table — fail-closed on check error.
//   • Strict validation: allow-listed fields only, type + length caps,
//     UUID check, oversized-body rejection, control-char stripping.
//   • Injection review: parameterized queries only; LIKE wildcards
//     stripped from dedup inputs; image_url no longer accepted
//     (removes the arbitrary-URL / SSRF-in-admin-panel vector).
//   • Safe errors — never returns stack traces or DB internals.
//   • Rejections logged with a reason + IP only (no payload, no token).
// ══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

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

// ── Validation / hardening constants ──────────────────────────────────────
const VALID_SOURCES = ['ocr_label', 'visual', 'manual_correction'];
const MAX_BODY_BYTES = 16 * 1024;                 // candidates are small text
const ALLOWED_TOP_KEYS = new Set(['candidate', 'valuation_id', 'correction_text']);
const ALLOWED_CANDIDATE_KEYS = new Set([
  'brand', 'model', 'name', 'category', 'subcategory', 'product_type', 'ocr_text', 'confidence', 'source',
]);
const STR_MAX = {
  brand: 120, model: 120, name: 200, category: 80, subcategory: 80, product_type: 80, ocr_text: 2000,
};
const CORRECTION_MAX = 2000;
const RATE_WINDOW_SEC = 60;   // burst window
const RATE_MAX_WINDOW = 6;    // max new candidates per user per minute
const RATE_MAX_DAY    = 60;   // max new candidates per user per rolling 24h
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Strip C0 control chars (except tab 0x09 / newline 0x0A) and DEL (0x7F); trim.
// Implemented as a code-point filter to avoid control-char literals in source.
function sanitizeStr(v) {
  let out = '';
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 && c !== 0x09 && c !== 0x0A) continue;
    if (c === 0x7F) continue;
    out += ch;
  }
  return out.trim();
}

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
    console.warn(`[SubmitCandidate] rejected reason=${reason} status=${status} ip=${ip}`);
    return json({ error: clientMsg }, status, { ...corsHeaders, ...extraHeaders });
  };

  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== 'POST') return reject('method_not_allowed', 405, 'Method not allowed');

    // ── Oversized body guard (pre-parse) ──
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

    // ── PARSE + shape checks ──
    let body;
    try { body = await req.json(); }
    catch { return reject('invalid_json', 400, 'Invalid JSON body'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reject('invalid_body', 400, 'Invalid request body');
    }
    for (const k of Object.keys(body)) {
      if (!ALLOWED_TOP_KEYS.has(k)) return reject('unexpected_top_field', 400, `Unexpected field: ${k}`);
    }

    const { candidate, valuation_id, correction_text } = body;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return reject('missing_candidate', 400, 'Missing candidate object');
    }
    for (const k of Object.keys(candidate)) {
      if (!ALLOWED_CANDIDATE_KEYS.has(k)) return reject('unexpected_candidate_field', 400, `Unexpected candidate field: ${k}`);
    }

    // ── Field validation (type + length + sanitize) ──
    const badFields = [];
    const str = (val, key, max) => {
      if (val === undefined || val === null) return null;
      if (typeof val !== 'string') { badFields.push(key); return null; }
      const cleaned = sanitizeStr(val);
      if (cleaned.length > max) { badFields.push(key); return null; }
      return cleaned || null;
    };

    const brand        = str(candidate.brand,        'brand',        STR_MAX.brand);
    const model        = str(candidate.model,        'model',        STR_MAX.model);
    const name         = str(candidate.name,         'name',         STR_MAX.name);
    const category     = str(candidate.category,     'category',     STR_MAX.category);
    const subcategory  = str(candidate.subcategory,  'subcategory',  STR_MAX.subcategory);
    const product_type = str(candidate.product_type, 'product_type', STR_MAX.product_type);
    const ocr_text     = str(candidate.ocr_text,     'ocr_text',     STR_MAX.ocr_text);
    const correction   = str(correction_text,        'correction_text', CORRECTION_MAX);
    if (badFields.length) return reject('invalid_field', 400, 'Invalid or oversized field');

    // confidence — optional number in [0,1]
    let confidence = null;
    if (candidate.confidence !== undefined && candidate.confidence !== null) {
      const n = candidate.confidence;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) {
        return reject('invalid_confidence', 400, 'Invalid confidence');
      }
      confidence = n;
    }

    // source — default unknown values (never reject; matches prior behaviour + table CHECK)
    const source = VALID_SOURCES.includes(candidate.source) ? candidate.source : 'ocr_label';

    // valuation_id — optional, must be a UUID when present
    let valuationId = null;
    if (valuation_id !== undefined && valuation_id !== null) {
      if (typeof valuation_id !== 'string' || !UUID_RE.test(valuation_id)) {
        return reject('invalid_valuation_id', 400, 'Invalid valuation_id');
      }
      valuationId = valuation_id;
    }

    // At least one identifying field
    if (!brand && !model && !name) {
      return reject('no_identifier', 400, 'Candidate must include at least brand, model, or name');
    }

    // ── Service-role client (bypasses RLS; created_by is set server-side) ──
    const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ── RATE LIMIT — per verified user, fail-closed on error ──
    const nowMs    = Date.now();
    const winStart = new Date(nowMs - RATE_WINDOW_SEC * 1000).toISOString();
    const dayStart = new Date(nowMs - 24 * 3600 * 1000).toISOString();
    try {
      const [winRes, dayRes] = await Promise.all([
        supa.from('product_candidates').select('id', { count: 'exact', head: true })
          .eq('created_by', userId).gte('created_at', winStart),
        supa.from('product_candidates').select('id', { count: 'exact', head: true })
          .eq('created_by', userId).gte('created_at', dayStart),
      ]);
      if (winRes.error || dayRes.error) return reject('rate_check_failed', 503, 'Service temporarily unavailable');
      if ((winRes.count ?? 0) >= RATE_MAX_WINDOW) {
        return reject('rate_limited_burst', 429, 'Too many submissions. Please wait a moment.', { 'Retry-After': String(RATE_WINDOW_SEC) });
      }
      if ((dayRes.count ?? 0) >= RATE_MAX_DAY) {
        return reject('rate_limited_daily', 429, 'Daily submission limit reached.', { 'Retry-After': '3600' });
      }
    } catch {
      return reject('rate_check_exception', 503, 'Service temporarily unavailable');
    }

    // ── Duplicate check (parameterized; LIKE wildcards stripped from inputs) ──
    const stripWild = (v) => (v || '').toLowerCase().replace(/[%_\\]/g, '').trim();
    const normBrand    = stripWild(brand);
    const normModel    = stripWild(model);
    const normCategory = stripWild(category);

    let existingId = null;
    try {
      let q = supa.from('product_candidates').select('id').in('status', ['pending', 'approved']);
      if (normBrand)    q = q.ilike('brand',    `%${normBrand}%`);
      if (normModel)    q = q.ilike('model',    `%${normModel}%`);
      if (normCategory) q = q.ilike('category', `%${normCategory}%`);
      const { data: existing } = await q.limit(1);
      if (existing?.length) existingId = existing[0].id;
    } catch { /* non-fatal — proceed to insert */ }

    // ── Deduplicate: increment existing ──
    if (existingId) {
      const { data: cur } = await supa
        .from('product_candidates')
        .select('occurrence_count')
        .eq('id', existingId)
        .single();

      await supa
        .from('product_candidates')
        .update({
          occurrence_count: (cur?.occurrence_count || 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId);

      return json({ status: 'deduplicated', candidate_id: existingId }, 200, corsHeaders);
    }

    // ── Insert new candidate (only real columns; extras kept in metadata jsonb) ──
    const row = {
      created_by:   userId,
      brand,
      model,
      name:         name || brand || model,   // name is NOT NULL in the table
      category,
      subcategory,
      product_type,
      ocr_text,
      confidence,
      source,
      status:       'pending',
      occurrence_count: 1,
      metadata: {
        ...(valuationId ? { valuation_id: valuationId } : {}),
        ...(correction  ? { correction_text: correction } : {}),
      },
    };

    const { data, error } = await supa
      .from('product_candidates')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      // Log a stable, non-sensitive marker; never return DB internals to the client.
      console.error(`[SubmitCandidate] insert failed code=${error.code || 'unknown'} ip=${ip}`);
      return json({ error: 'Could not save candidate' }, 500, corsHeaders);
    }

    return json({ status: 'created', candidate_id: data.id }, 201, corsHeaders);
  } catch (err) {
    console.error(`[SubmitCandidate] unhandled ${err?.name || 'Error'} ip=${ip}`);
    return json({ error: 'Internal server error' }, 500, corsHeaders);
  }
}
