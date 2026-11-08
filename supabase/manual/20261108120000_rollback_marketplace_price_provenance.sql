-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20261108120000_marketplace_price_provenance.sql — run by hand, in one transaction.
--
-- Restores the three replaced functions EXACTLY as they were in Production before the migration
-- (captured from pg_get_functiondef on 2026-11-08), then removes what the migration added.
-- WARNING: the DROP COLUMN statements discard any final prices, price provenance and test-account
-- flags recorded since the migration. Export them first if they are to be kept:
--   select id, final_price, final_price_source, final_price_confirmed_at from orders where final_price is not null;
--   select id, price_source, suggested_price from listings where price_source is not null;
--   select id from profiles where is_test;
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_new_status text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id     uuid;
  v_order         orders%ROWTYPE;
  v_current       text;
  v_required_role text;   -- 'seller' | 'buyer' | 'either'
  v_notif_target  uuid;
  v_now           timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Load and lock order ───────────────────────────────────────────────
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Caller must be a party ─────────────────────────────────────────────
  IF v_order.buyer_id <> v_caller_id AND v_order.seller_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not a party to this order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_current := v_order.status;

  -- ── 4. Reject terminal-state transitions ──────────────────────────────────
  IF v_current IN ('completed', 'cancelled', 'declined', 'disputed') THEN
    RAISE EXCEPTION 'Order is already in terminal state: %', v_current
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 5. Validate transition + derive required role ─────────────────────────
  v_required_role := CASE
    WHEN v_current = 'pending'      AND p_new_status = 'accepted'      THEN 'seller'
    WHEN v_current = 'pending'      AND p_new_status = 'declined'      THEN 'seller'
    WHEN v_current = 'pending'      AND p_new_status = 'cancelled'     THEN 'either'
    WHEN v_current = 'accepted'     AND p_new_status = 'shipped'       THEN 'seller'
    WHEN v_current = 'accepted'     AND p_new_status = 'ready_pickup'  THEN 'seller'
    WHEN v_current = 'accepted'     AND p_new_status = 'cancelled'     THEN 'either'
    WHEN v_current = 'shipped'      AND p_new_status = 'delivered'     THEN 'buyer'
    WHEN v_current = 'ready_pickup' AND p_new_status = 'delivered'     THEN 'buyer'
    WHEN v_current = 'ready_pickup' AND p_new_status = 'completed'     THEN 'buyer'
    WHEN v_current = 'delivered'    AND p_new_status = 'completed'     THEN 'buyer'
    ELSE NULL
  END;

  IF v_required_role IS NULL THEN
    RAISE EXCEPTION 'Invalid transition: % → %', v_current, p_new_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 6. Enforce role ───────────────────────────────────────────────────────
  IF v_required_role = 'seller' AND v_order.seller_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the seller can perform this action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_required_role = 'buyer' AND v_order.buyer_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the buyer can perform this action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 7. Apply transition ───────────────────────────────────────────────────
  IF p_new_status = 'accepted' THEN
    UPDATE orders SET status = 'accepted',     accepted_at = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'declined' THEN
    UPDATE orders SET status = 'declined',     declined_at = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'shipped' THEN
    UPDATE orders SET status = 'shipped',      shipped_at  = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'ready_pickup' THEN
    UPDATE orders SET status = 'ready_pickup', shipped_at  = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'delivered' THEN
    UPDATE orders
    SET status = 'delivered', delivered_at = v_now, buyer_confirmed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

  ELSIF p_new_status = 'cancelled' THEN
    UPDATE orders
    SET status        = 'cancelled',
        cancelled_at  = v_now,
        cancelled_by  = v_caller_id,
        cancel_reason = COALESCE(p_meta->>'cancel_reason', 'User cancellation'),
        updated_at    = v_now
    WHERE id = p_order_id;

  ELSIF p_new_status = 'completed' THEN
    UPDATE orders
    SET status = 'completed', completed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

    -- Atomically mark the listing sold
    UPDATE listings
    SET status  = 'sold',
        sold_to = v_order.buyer_id,
        sold_at = v_now
    WHERE id = v_order.listing_id;
  END IF;

  -- ── 8. Notify the opposite party ─────────────────────────────────────────
  -- v_order is the pre-update snapshot — buyer_id / seller_id are stable.
  v_notif_target := CASE p_new_status
    WHEN 'accepted'     THEN v_order.buyer_id
    WHEN 'declined'     THEN v_order.buyer_id
    WHEN 'shipped'      THEN v_order.buyer_id
    WHEN 'ready_pickup' THEN v_order.buyer_id
    WHEN 'delivered'    THEN v_order.seller_id
    WHEN 'completed'    THEN v_order.seller_id
    WHEN 'cancelled'    THEN
      CASE WHEN v_caller_id = v_order.buyer_id
           THEN v_order.seller_id
           ELSE v_order.buyer_id END
    ELSE NULL
  END;

  IF v_notif_target IS NOT NULL AND v_notif_target <> v_caller_id THEN
    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    VALUES (
      v_notif_target,
      'ORDER_' || upper(p_new_status),
      CASE p_new_status
        WHEN 'accepted'     THEN 'Order accepted'
        WHEN 'declined'     THEN 'Order declined'
        WHEN 'shipped'      THEN 'Item shipped'
        WHEN 'ready_pickup' THEN 'Ready for pickup'
        WHEN 'delivered'    THEN 'Item received'
        WHEN 'completed'    THEN 'Transaction complete'
        WHEN 'cancelled'    THEN 'Order cancelled'
      END,
      '',
      jsonb_build_object('order_id', p_order_id, 'new_status', p_new_status),
      v_now
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_new_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_comp_from_sale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    INSERT INTO comps (product_id, source, price, condition, is_sold, sold_at, title, category, brand, model, confidence)
    SELECT
      l.product_id,
      'getworth',
      NEW.price,
      l.condition,
      true,
      now(),
      l.title,
      l.category,
      (l.attributes->>'brand'),
      (l.attributes->>'model'),
      COALESCE(l.ai_confidence, 0.8)
    FROM listings l
    WHERE l.id = NEW.listing_id;

    -- Update valuation with actual sold price
    UPDATE valuations
    SET
      actual_sold_price = NEW.price,
      price_accuracy = CASE WHEN price_mid > 0 THEN NEW.price::REAL / price_mid ELSE NULL END
    WHERE listing_id = NEW.listing_id;

    -- Queue price recalculation
    INSERT INTO jobs_queue (job_type, payload, priority)
    SELECT 'recalc_prices', jsonb_build_object('product_id', l.product_id), 3
    FROM listings l
    WHERE l.id = NEW.listing_id AND l.product_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.profiles_enforce_safe_defaults_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / trigger-seeded rows (no JWT) may set anything.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Any authenticated self-insert starts with zero, unearned reputation.
  NEW.is_admin            := false;
  NEW.is_verified         := false;
  NEW.is_phone_verified   := false;
  NEW.rating              := 0;
  NEW.review_count        := 0;
  NEW.total_sales         := 0;
  NEW.badge               := NULL;
  NEW.reputation_points   := 0;
  NEW.response_rate       := NULL;
  NEW.verification_status := NULL;
  NEW.verified_at         := NULL;
  NEW.created_at          := now();   -- cannot backdate account age
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_listings_price_provenance ON public.listings;
DROP FUNCTION IF EXISTS public.listings_set_price_provenance();
DROP FUNCTION IF EXISTS public.admin_set_test_account(uuid, boolean);
DROP FUNCTION IF EXISTS public.admin_test_account_ids();

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_final_price_complete;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_final_price_source_valid;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_final_price_valid;
ALTER TABLE public.orders DROP COLUMN IF EXISTS final_price_confirmed_at;
ALTER TABLE public.orders DROP COLUMN IF EXISTS final_price_source;
ALTER TABLE public.orders DROP COLUMN IF EXISTS final_price;
COMMENT ON COLUMN public.orders.price IS NULL;
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_price_source_valid;
ALTER TABLE public.listings DROP COLUMN IF EXISTS suggested_price;
ALTER TABLE public.listings DROP COLUMN IF EXISTS price_source;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_test;

COMMIT;
