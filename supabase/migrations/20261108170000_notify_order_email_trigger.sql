-- ══════════════════════════════════════════════════════════════════════════════
-- ORDER EMAILS (founder-approved 2026-11-08). Replaces ONLY the body of public.notify_order_email_webhook()
-- (same name, signature, owner, SECURITY DEFINER; the trigger trg_notify_order_email on notifications is unchanged).
--
-- Before: it returned early (app.webhook_secret / app.supabase_url unset) and, if not, called extensions.http_post,
-- which does not exist. Now it reads the shared secret and the project URL from Supabase Vault
-- (notify_order_email_webhook_secret, project_url) and queues ONE pg_net request carrying only {order_id}; the
-- hardened edge function notify-order-email reads the recipient (the order's seller), title and price from the
-- database. pg_net sends after commit: a rolled-back order sends nothing. Any failure is a warning; the order
-- always proceeds.
-- Rollback: supabase/manual/20261108170000_rollback_notify_order_email_trigger.sql
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
