import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── 1. Extract and validate Authorization header ──────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // ── 2. Verify caller JWT — use anon client with caller's token ────────────
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: 'Invalid or expired token' }, 401);

  // ── 3. Service-role client for all subsequent privileged operations ────────
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── 4. Confirm caller is_admin from DB — never trust JWT claims ───────────
  const { data: callerProfile, error: profileErr } = await adminClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (profileErr || !callerProfile?.is_admin) {
    return json({ error: 'Forbidden' }, 403);
  }

  // ── 5. Parse and validate request body ───────────────────────────────────
  let userId: string;
  try {
    const body = await req.json();
    userId = body?.userId;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    return json({ error: 'Invalid userId' }, 400);
  }

  // ── 6. Fetch target user's verification_photo_path from DB ────────────────
  const { data: target, error: targetErr } = await adminClient
    .from('profiles')
    .select('verification_photo_path, verification_status')
    .eq('id', userId)
    .single();

  if (targetErr || !target?.verification_photo_path) {
    return json({ error: 'No verification photo found for this user' }, 404);
  }

  // ── 7. Generate signed URL via service role — bypasses storage RLS ────────
  const { data: signed, error: signErr } = await adminClient.storage
    .from('verification-photos')
    .createSignedUrl(target.verification_photo_path, 300); // 5-minute TTL

  if (signErr || !signed?.signedUrl) {
    console.error('[admin-get-verification-url] signed URL error:', signErr);
    return json({ error: 'Failed to generate signed URL' }, 500);
  }

  return json({ signedUrl: signed.signedUrl });
});
