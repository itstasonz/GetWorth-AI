// ══════════════════════════════════════════════════════════════
// §  submit-candidate  — save a user-confirmed product candidate
// ══════════════════════════════════════════════════════════════
// Called when the user confirms a scan result that returned 0 DB
// candidates.  Inserts into product_candidates (staging table).
// Deduplicates by brand + model + category (case-insensitive).
// Never touches the products table.
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

const VALID_SOURCES = ['ocr_label', 'visual', 'manual_correction'];

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = cors(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);

  // ── Parse body ──
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400, corsHeaders); }

  const { candidate, valuation_id, correction_text, image_url } = body || {};
  if (!candidate || typeof candidate !== 'object') {
    return json({ error: 'Missing candidate object' }, 400, corsHeaders);
  }

  const { brand, model, name, category, subcategory, product_type, ocr_text, confidence, source } = candidate;

  // At least one identifying field is required
  if (!brand && !model && !name) {
    return json({ error: 'Candidate must include at least brand, model, or name' }, 400, corsHeaders);
  }

  // ── Resolve user from JWT (optional — anonymous scans allowed) ──
  let userId = null;
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const anonClient = createClient(
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
        process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
      );
      const { data: { user } } = await anonClient.auth.getUser(token);
      userId = user?.id || null;
    } catch { /* anonymous ok */ }
  }

  // ── Service client for duplicate check + insert ──
  const supa = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  );

  // ── Duplicate check: existing pending/approved with same brand+model+category ──
  const normBrand    = (brand    || '').toLowerCase().trim();
  const normModel    = (model    || '').toLowerCase().trim();
  const normCategory = (category || '').toLowerCase().trim();

  let existingId = null;
  try {
    let q = supa
      .from('product_candidates')
      .select('id, occurrence_count')
      .in('status', ['pending', 'approved']);

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

  // ── Insert new candidate ──
  const row = {
    created_by:      userId,
    source_scan_id:  valuation_id  || null,
    brand:           brand         || null,
    model:           model         || null,
    name:            name          || null,
    category:        category      || null,
    subcategory:     subcategory   || null,
    product_type:    product_type  || null,
    ocr_text:        ocr_text      || null,
    confidence:      typeof confidence === 'number' ? confidence : null,
    source:          VALID_SOURCES.includes(source) ? source : 'ocr_label',
    image_url:       image_url     || null,
    correction_text: correction_text || null,
    status:          'pending',
    occurrence_count: 1,
    metadata:        {},
  };

  const { data, error } = await supa
    .from('product_candidates')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.error('[SubmitCandidate] Insert failed:', error.message);
    return json({ error: error.message }, 500, corsHeaders);
  }

  return json({ status: 'created', candidate_id: data.id }, 201, corsHeaders);
}
