// ══════════════════════════════════════════════════════════════════════════════
// GetWorth — notify-order-email Edge Function
//
// HARDENED 2026-11-08 (security review of the deployed v1, source previously absent from the repository):
//   • the recipient is the ORDER's seller, read from the database — never the seller_id a request names;
//   • the listing title is read from the database — never the request's listing_title;
//   • every value placed in the email HTML is escaped (a buyer chooses their own display name);
//   • the shared secret is compared in constant time;
//   • no email address is written to the logs.
// The request body is reduced to one fact the function trusts the trigger for: which order.
//
// Triggered by a Postgres pg_net trigger on notifications INSERT
// (type = 'ORDER_PENDING'). Never called from the frontend.
//
// Request (POST, internal only):
//   Header:  x-webhook-secret  — must match WEBHOOK_SECRET env var
//   Body:    { order_id, seller_id, listing_title, notification_id, listing_id }
//
// Behaviour:
//   • Validates webhook secret — 403 if mismatch (order already committed)
//   • Confirms order exists and is still 'pending' via service role
//   • Fetches seller email via auth.admin.getUserById (bypasses column revoke)
//   • Fetches buyer display name from profiles
//   • Sends transactional email via Resend
//   • Logs result; always returns 200 — email failure must not surface to DB
//
// Required secrets (set via `supabase secrets set`):
//   RESEND_API_KEY     — Resend API key (re_…)
//   RESEND_FROM_EMAIL  — Verified sender address, e.g. "GetWorth <noreply@getworth.app>"
//   WEBHOOK_SECRET     — Shared secret matching app.webhook_secret Postgres setting
//
// Auto-injected by Supabase runtime (no manual set needed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ══════════════════════════════════════════════════════════════════════════════

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── 1. Verify webhook secret ───────────────────────────────────────────────
  // This endpoint is never exposed to the public — it is only called from the
  // Postgres pg_net trigger inside create_order. The shared secret prevents
  // accidental external invocations.
  const incomingSecret = req.headers.get('x-webhook-secret') ?? '';
  const expectedSecret = Deno.env.get('WEBHOOK_SECRET') ?? '';

  if (!expectedSecret || !(await sameSecret(incomingSecret, expectedSecret))) {
    console.error('[notify-order-email] rejected: invalid webhook secret');
    return json({ error: 'Forbidden' }, 403);
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let orderId: string;

  try {
    const body = await req.json();
    orderId    = body?.order_id;
    if (!orderId || typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId)) throw new Error('missing order_id');
  } catch (e) {
    console.error('[notify-order-email] invalid payload:', e);
    return json({ error: 'Invalid payload' }, 400);
  }

  // ── 3. Service-role client ─────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey   = Deno.env.get('RESEND_API_KEY');
  const fromEmail   = Deno.env.get('RESEND_FROM_EMAIL');

  if (!resendKey || !fromEmail) {
    console.error('[notify-order-email] RESEND_API_KEY or RESEND_FROM_EMAIL not set — skipping');
    return json({ ok: true, email_sent: false, reason: 'resend_not_configured' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── 4. Confirm order exists and is still pending ───────────────────────────
  // Guards against duplicate trigger fires or race conditions where the order
  // was cancelled before this function ran.
  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, price, delivery_method, buyer_id, seller_id, listing_id')
    .eq('id', orderId)
    .eq('status', 'pending')
    .single();

  if (orderErr || !order) {
    console.warn('[notify-order-email] order not found or not pending — skipping:', orderId);
    return json({ ok: true, email_sent: false, reason: 'order_not_pending' });
  }

  // ── 5. Fetch buyer display name ────────────────────────────────────────────
  const { data: buyer } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', order.buyer_id)
    .single();

  const buyerName = buyer?.full_name?.trim() || 'A buyer';

  // The listing's own title, from the database.
  const { data: listing } = await admin
    .from('listings')
    .select('title')
    .eq('id', order.listing_id)
    .single();
  const listingTitle = listing?.title?.trim() || '';
  const sellerId = order.seller_id as string;

  // ── 6. Fetch seller email via auth admin ───────────────────────────────────
  // profiles.email is column-level revoked from all non-service roles.
  // auth.admin.getUserById is the correct server-side path.
  const { data: { user: sellerUser }, error: sellerErr } =
    await admin.auth.admin.getUserById(sellerId);

  if (sellerErr || !sellerUser?.email) {
    console.error(
      '[notify-order-email] could not resolve seller email — sellerId:', sellerId,
      '— error:', sellerErr?.message ?? 'no email on user record',
    );
    return json({ ok: true, email_sent: false, reason: 'seller_email_unavailable' });
  }

  const sellerEmail = sellerUser.email;

  // ── 7. Build and send email via Resend ────────────────────────────────────
  const deliveryLabel = order.delivery_method === 'pickup' ? 'Pickup' : 'Shipping';
  const subject       = `New order request: ${(listingTitle || 'your listing').replace(/[\r\n]+/g, ' ').slice(0, 120)}`;
  const html          = buildEmailHtml({ buyerName, listingTitle, price: order.price, deliveryLabel, orderId });

  let resendOk = false;
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [sellerEmail],
        subject,
        html,
      }),
    });

    if (resendRes.ok) {
      resendOk = true;
      console.log('[notify-order-email] sent | order:', orderId);
    } else {
      const errText = await resendRes.text();
      console.error('[notify-order-email] Resend HTTP', resendRes.status, '| order:', orderId, '|', errText);
    }
  } catch (e) {
    console.error('[notify-order-email] Resend fetch threw | order:', orderId, '|', e);
  }

  // Always 200 — order was already committed, email result must not surface as an error
  return json({ ok: true, email_sent: resendOk });
});

// ── Email template ────────────────────────────────────────────────────────────
// Inline styles only — email clients strip <style> blocks.
// Palette mirrors GetWorth design tokens.
function buildEmailHtml({ buyerName, listingTitle, price, deliveryLabel, orderId }: {
  buyerName:     string;
  listingTitle:  string;
  price:         number;
  deliveryLabel: string;
  orderId:       string;
}): string {
  const formattedPrice = typeof price === 'number'
    ? `₪${price.toLocaleString('he-IL')}`
    : String(price);

  buyerName = escapeHtml(buyerName);
  listingTitle = escapeHtml(listingTitle);
  deliveryLabel = escapeHtml(deliveryLabel);
  orderId = escapeHtml(orderId);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#131313;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#131313;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background-color:#1C1B1B;border-radius:16px;border:1px solid #3C4947;overflow:hidden;">

        <!-- Header -->
        <tr><td style="padding:24px 28px 20px;border-bottom:1px solid #2A2A2A;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#6FEEE1;letter-spacing:-0.3px;">GetWorth</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 28px 8px;">
          <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#F8FAFC;line-height:1.3;">New order request</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#BBC9C7;line-height:1.5;">
            <strong style="color:#F8FAFC;">${buyerName}</strong> wants to buy your listing.
            Open the app to accept or decline.
          </p>

          <!-- Order details table -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1px solid #2A2A2A;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <tr>
              <td style="padding:12px 16px;font-size:13px;color:#64748B;width:50%;">Listing</td>
              <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#F8FAFC;text-align:right;">${listingTitle || '—'}</td>
            </tr>
            <tr style="border-top:1px solid #2A2A2A;">
              <td style="padding:12px 16px;font-size:13px;color:#64748B;">Price</td>
              <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#6FEEE1;text-align:right;">${formattedPrice}</td>
            </tr>
            <tr style="border-top:1px solid #2A2A2A;">
              <td style="padding:12px 16px;font-size:13px;color:#64748B;">Delivery</td>
              <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#F8FAFC;text-align:right;">${deliveryLabel}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #2A2A2A;">
          <p style="margin:0 0 4px;font-size:12px;color:#64748B;">
            This is an automated notification from GetWorth. Do not reply to this email.
          </p>
          <p style="margin:0;font-size:11px;color:#3C4947;">Order: ${orderId}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Constant-time comparison of two secrets (by their SHA-256 digests, so lengths do not leak either). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x); const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i += 1) diff |= ax[i] ^ by[i];
  return diff === 0;
}
