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
const IMAGE_PREFIX = 'image/';

// Magic-byte signatures for accepted image formats.
// MIME type from the client is not trusted — we validate the actual file bytes.
function validateImageBytes(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 12) return 'File too small to be a valid image';
  const b = new Uint8Array(buf, 0, 12);

  // JPEG: FF D8 FF
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return null;
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return null;
  // WebP: RIFF????WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return null;
  // HEIC/HEIF: 'ftyp' box starts at byte 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return null;

  return 'File is not a supported image format (jpeg, png, webp, or heic)';
}

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

    // ── 6. Validate magic bytes — MIME type is client-controlled and not trusted ──
    const magicErr = validateImageBytes(imageArrayBuf);
    if (magicErr) {
      return json({ error: magicErr }, 415);
    }
  } catch (e) {
    console.error('[submit-verification-selfie] form parse error:', e);
    return json({ error: 'Failed to parse request body', detail: String(e) }, 400);
  }

  // ── 7. Service-role client — bypasses Storage RLS entirely ────────────────
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── 8. Upload selfie to private bucket ────────────────────────────────────
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

  // ── 9. Update profile — service role bypasses column-level RLS ───────────
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

  // ── 10. Success ───────────────────────────────────────────────────────────
  return json({
    ok:                      true,
    verification_status:     'pending',
    verification_photo_path: filePath,
  });
});
