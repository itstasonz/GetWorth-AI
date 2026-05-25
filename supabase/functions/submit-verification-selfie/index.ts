// ══════════════════════════════════════════════════════════════════════════════
// GetWorth — submit-verification-selfie Edge Function
//
// Accepts an authenticated multipart/form-data POST with a selfie image.
// Verifies the caller JWT server-side (never trusts client-supplied user ID),
// then uploads the image to the private verification-photos bucket and marks
// the profile as pending — all using the service role key.
//
// This bypasses Storage RLS entirely, which proved unreliable on iOS Safari PWA.
// The bucket remains PRIVATE; no SELECT policy is added.
//
// Request:
//   POST /functions/v1/submit-verification-selfie
//   Authorization: Bearer <user JWT>
//   Content-Type: multipart/form-data
//   Body field: file  (Blob/File — image/jpeg preferred, others accepted)
//
// Response 200:
//   { ok: true, verification_status: "pending", verification_photo_path: string }
// Response 4xx/5xx:
//   { error: string, detail?: string }
// ══════════════════════════════════════════════════════════════════════════════

import { serve }         from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient }  from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ─────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_BYTES    = 10 * 1024 * 1024; // 10 MB
const BUCKET       = 'verification-photos';
// Accept any image type the client sends; we'll store as-is.
// Client compresses to JPEG before sending, so this is normally image/jpeg.
const IMAGE_PREFIX = 'image/';

// ── Handler ───────────────────────────────────────────────────────────────────
serve(async (req) => {
  // Pre-flight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  // ── 1. Authorization header ────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing or malformed Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // ── 2. Verify JWT — use caller's token against auth API ───────────────────
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  });

  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return json({ error: 'Invalid or expired token' }, 401);
  }

  // user.id is derived from the server-verified JWT — client cannot forge it.
  const userId   = user.id;
  const filePath = `${userId}/selfie.jpg`;

  // ── 3. Parse multipart form data ──────────────────────────────────────────
  let imageArrayBuf: ArrayBuffer;
  let contentType = 'image/jpeg'; // default — client always compresses to JPEG

  try {
    const formData = await req.formData();
    const field    = formData.get('file');

    if (!field) {
      return json({ error: 'Missing "file" field in form data' }, 400);
    }

    // Accept File or Blob
    const blob = field instanceof File ? field as File : field as Blob;

    // ── 4. Validate image type ─────────────────────────────────────────────
    // iOS Safari may send type="" — fall back to JPEG in that case.
    if (blob.type && !blob.type.startsWith(IMAGE_PREFIX)) {
      return json({ error: `Rejected non-image content-type: ${blob.type}` }, 415);
    }
    if (blob.type && blob.type.startsWith(IMAGE_PREFIX)) {
      contentType = blob.type;
    }

    // ── 5. Validate size ──────────────────────────────────────────────────
    if (blob.size === 0) {
      return json({ error: 'Empty file' }, 400);
    }
    if (blob.size > MAX_BYTES) {
      return json({ error: `File too large: ${blob.size} bytes (max 10 MB)` }, 413);
    }

    imageArrayBuf = await blob.arrayBuffer();
  } catch (e) {
    console.error('[submit-verification-selfie] form parse error:', e);
    return json({ error: 'Failed to parse request body', detail: String(e) }, 400);
  }

  // ── 6. Service-role client — bypasses Storage RLS entirely ────────────────
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── 7. Upload selfie to private bucket ────────────────────────────────────
  // Path: <verified-user-id>/selfie.jpg
  // upsert:true handles both first upload and re-upload.
  // cacheControl:'0' prevents any CDN from serving stale identity photos.
  const { error: uploadErr } = await adminClient.storage
    .from(BUCKET)
    .upload(filePath, imageArrayBuf, {
      contentType,
      upsert:       true,
      cacheControl: '0',
    });

  if (uploadErr) {
    console.error('[submit-verification-selfie] storage upload failed:', uploadErr);
    return json({ error: 'Storage upload failed', detail: uploadErr.message }, 500);
  }

  // ── 8. Update profile — service role bypasses column-level RLS ───────────
  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({
      verification_photo_path: filePath,
      verification_status:     'pending',
      verified_at:             null,
    })
    .eq('id', userId);

  if (updateErr) {
    console.error('[submit-verification-selfie] profile update failed:', updateErr);
    // Storage file was uploaded — log prominently so it can be reconciled.
    console.error('[submit-verification-selfie] orphaned file:', filePath);
    return json({ error: 'Profile update failed', detail: updateErr.message }, 500);
  }

  // ── 9. Success ────────────────────────────────────────────────────────────
  return json({
    ok:                      true,
    verification_status:     'pending',
    verification_photo_path: filePath,
  });
});
