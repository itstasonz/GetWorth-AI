// ══════════════════════════════════════════════════════════════
// §  submit-candidate  — save a user-confirmed product candidate
// ══════════════════════════════════════════════════════════════
// Called when the user confirms a scan result that returned 0 DB
// candidates.  Calls the submit_product_candidate RPC which:
//   • requires authentication (JWT verified server-side)
//   • deduplicates by name OR brand+model
//   • inserts into product_candidates (staging table, never products)
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
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const VALID_SOURCES = ['ocr_label', 'visual', 'manual_correction', 'db_missing'];

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = cors(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405, corsHeaders);

  // ── 1. Require Authorization header ───────────────────────────
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Authentication required' }, 401, corsHeaders);
  }
  const token = authHeader.slice(7);

  // ── 2. Parse body ──────────────────────────────────────────────
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }

  const { candidate, valuation_id, correction_text, image_path } = body || {};
  if (!candidate || typeof candidate !== 'object') {
    return json({ error: 'Missing candidate object' }, 400, corsHeaders);
  }

  const {
    brand, model, name, category, subcategory, product_type,
    ocr_text, confidence, source,
    image_path: candidateImagePath,
    image_url,  // legacy field — fall through to image_path
  } = candidate;

  // At least one identifying field is required
  if (!brand && !model && !name) {
    return json({ error: 'Candidate must include at least brand, model, or name' }, 400, corsHeaders);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey     = process.env.SUPABASE_KEY  || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY || anonKey;

  if (!supabaseUrl || !anonKey) {
    console.error('[SubmitCandidate] Missing SUPABASE_URL or anon key env vars');
    return json({ error: 'Server configuration error' }, 500, corsHeaders);
  }

  // ── 3. Verify JWT server-side — never trust client-supplied userId ──
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false },
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user?.id) {
    return json({ error: 'Invalid or expired token' }, 401, corsHeaders);
  }
  const userId = user.id;

  // ── 4. Build metadata — store valuation_id and correction_text here ──
  const metadata = {};
  if (valuation_id)    metadata.valuation_id    = valuation_id;
  if (correction_text) metadata.correction_text = correction_text;

  // Resolve image_path from multiple possible field names
  const resolvedImagePath = image_path || candidateImagePath || image_url || null;

  // ── 5. Call RPC with service client ───────────────────────────
  const supa = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: rpcResult, error: rpcErr } = await supa.rpc('submit_product_candidate', {
    p_caller_id:    userId,
    p_name:         name          || null,
    p_brand:        brand         || null,
    p_model:        model         || null,
    p_category:     category      || null,
    p_subcategory:  subcategory   || null,
    p_product_type: product_type  || null,
    p_ocr_text:     ocr_text      || null,
    p_confidence:   typeof confidence === 'number' ? confidence : null,
    p_source:       VALID_SOURCES.includes(source) ? source : 'ocr_label',
    p_image_path:   resolvedImagePath,
    p_metadata:     Object.keys(metadata).length ? metadata : {},
  });

  // ── 6. Propagate real errors — never fake success ──────────────
  if (rpcErr) {
    console.error('[SubmitCandidate] RPC failed:', rpcErr.message, rpcErr.code);
    const status = rpcErr.code === '28000' ? 401 : 500;
    return json({ error: rpcErr.message }, status, corsHeaders);
  }

  // rpcResult is the jsonb returned by the function
  const httpStatus = rpcResult?.status === 'created' ? 201 : 200;
  return json(rpcResult, httpStatus, corsHeaders);
}
