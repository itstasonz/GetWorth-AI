-- ══════════════════════════════════════════════════════════════════════════════
-- PROPOSED — NOT APPLIED. Requires the founder's approval (it activates a credential and replaces a
-- SECURITY DEFINER trigger function). Kept outside supabase/migrations so nothing can push it by accident.
--
-- WHY ORDER EMAILS ARE NEVER SENT TODAY
--   notify_order_email_webhook() returns early because app.webhook_secret and app.supabase_url are unset; were they
--   set, it would fail on extensions.http_post, which does not exist (pg_net provides net.http_post). The edge
--   function notify-order-email is deployed with RESEND_API_KEY, RESEND_FROM_EMAIL and WEBHOOK_SECRET configured.
--
-- THE FIX, IN ORDER (each step separately approved):
--   1. Deploy the hardened edge function (supabase/functions/notify-order-email/index.ts): recipient and title from
--      the database, HTML escaped, constant-time secret check, no email addresses in logs.
--   2. Generate ONE new random secret and store it in both places — never in chat, never in the repository:
--        supabase secrets set WEBHOOK_SECRET=<new>                         (edge function)
--        select vault.create_secret('<new>', 'notify_order_email_webhook_secret');   (database)
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   3. Apply the function below (same name, same trigger; only its body changes).
--   4. Verify with one rolled-back order rehearsal that net.http_request_queue receives exactly one request with only
--      {order_id} in its body, then one real order by the founder's own test accounts.
-- Rollback: re-apply the previous body (captured in the session scratch fn2-pretty.json / pg_get_functiondef).
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_order_email_webhook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
  v_base   text;
BEGIN
  IF NEW.type <> 'ORDER_PENDING' THEN
    RETURN NEW;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'notify_order_email_webhook_secret' LIMIT 1;
  SELECT decrypted_secret INTO v_base   FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  IF coalesce(v_secret, '') = '' OR coalesce(v_base, '') = '' THEN
    RAISE WARNING '[notify_order_email_webhook] vault secret or project_url missing — email skipped for order %', NEW.data->>'order_id';
    RETURN NEW;
  END IF;
  -- Queued by pg_net and sent after the transaction commits; a rolled-back order sends nothing.
  -- The body names the order only: the edge function reads everything else from the database.
  PERFORM net.http_post(
    url     := v_base || '/functions/v1/notify-order-email',
    body    := jsonb_build_object('order_id', NEW.data->>'order_id'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_order_email_webhook] error (order proceeds unaffected): % — %', SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;
