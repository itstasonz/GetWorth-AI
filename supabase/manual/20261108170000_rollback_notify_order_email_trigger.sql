-- ROLLBACK for 20261108170000_notify_order_email_trigger.sql — restores the function body exactly as it was in
-- Production before (captured with pg_get_functiondef on 2026-11-08). Emails stop again. Vault secrets are left in place
-- (remove with: delete from vault.secrets where name in ('notify_order_email_webhook_secret', 'project_url');).
BEGIN;
CREATE OR REPLACE FUNCTION public.notify_order_email_webhook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret text;
  v_url    text;
BEGIN
  -- Only act on ORDER_PENDING — ignore all other notification types
  IF NEW.type <> 'ORDER_PENDING' THEN
    RETURN NEW;
  END IF;

  -- Read settings; `true` = return NULL instead of raising if not set
  v_secret := current_setting('app.webhook_secret', true);
  v_url    := current_setting('app.supabase_url',   true) || '/functions/v1/notify-order-email';

  -- Skip gracefully if database settings are not yet configured
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING '[notify_order_email_webhook] app.webhook_secret not set — email skipped for order %',
      NEW.data->>'order_id';
    RETURN NEW;
  END IF;

  IF current_setting('app.supabase_url', true) IS NULL
     OR current_setting('app.supabase_url', true) = '' THEN
    RAISE WARNING '[notify_order_email_webhook] app.supabase_url not set — email skipped for order %',
      NEW.data->>'order_id';
    RETURN NEW;
  END IF;

  -- Fire async HTTP POST via pg_net.
  -- Returns a request_id immediately; the actual HTTP call is sent after COMMIT.
  -- If pg_net is not enabled or the call fails, the EXCEPTION block catches it.
  PERFORM extensions.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', v_secret
    ),
    body    := jsonb_build_object(
      'notification_id', NEW.id,
      'order_id',        NEW.data->>'order_id',
      'listing_id',      NEW.data->>'listing_id',
      'seller_id',       NEW.user_id,
      'listing_title',   NEW.body
    )
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Log the error but never let it reach the caller — order creation must succeed.
  RAISE WARNING '[notify_order_email_webhook] error (order proceeds unaffected): % — %',
    SQLSTATE, SQLERRM;
  RETURN NEW;
END;
$function$;
COMMIT;
