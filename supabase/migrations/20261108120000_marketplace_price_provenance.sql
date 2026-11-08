-- ══════════════════════════════════════════════════════════════════════════════
-- MARKETPLACE PRICE PROVENANCE (founder-approved 2026-11-08)
--
-- Three additive, backward-compatible changes, and one fix to an existing
-- circular-pricing path. Rollback: supabase/manual/20261108120000_rollback_marketplace_price_provenance.sql
--
--   PART 1  orders.final_price — the amount the BUYER confirms was paid, recorded
--           at completion, separately from orders.price (the listing's asking
--           price at order time, forced equal by create_order). Optional: a
--           completion without it records NULL, never a guess. Its source is
--           'buyer_confirmed' — the buyer's word, NOT a verified payment (the
--           app processes no payments). History stays NULL: nothing is invented.
--   PART 2  listings.price_source / suggested_price — whether the listing's
--           price is GetWorth's own suggestion (the linked valuation's numbers,
--           within 2% / ₪5) or the seller's own. Set by a trigger, never by the
--           client. History stays NULL (unknown).
--   PART 3  profiles.is_test — internal/test accounts. Users cannot set it (the
--           existing update guard's allow-list excludes it; the insert guard
--           forces false); admins set it through admin_set_test_account().
--   PART 4  create_comp_from_sale — completed orders no longer become comps at
--           their ASKING price. A comp is written only for a buyer-confirmed
--           final price, between two accounts that are neither admin nor test,
--           for a listing whose price the seller set. valuations.actual_sold_price
--           is recorded only from a buyer-confirmed final price between genuine
--           accounts. (Found by the read-only audit: all 8 existing comps are
--           the admin's test sales, at asking price.)
--
-- Nothing here deletes or rewrites an existing row, changes an RLS policy or
-- revokes a privilege. Every function replaced keeps its signature, so its
-- grants are kept.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PART 1 — orders.final_price ─────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS final_price integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS final_price_source text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS final_price_confirmed_at timestamptz;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_final_price_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_final_price_valid
  CHECK (final_price IS NULL OR (final_price > 0 AND final_price <= 100000000));
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_final_price_source_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_final_price_source_valid
  CHECK (final_price_source IS NULL OR final_price_source = 'buyer_confirmed');
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_final_price_complete;
ALTER TABLE public.orders ADD CONSTRAINT orders_final_price_complete
  CHECK ((final_price IS NULL) = (final_price_source IS NULL) AND (final_price IS NULL) = (final_price_confirmed_at IS NULL));
COMMENT ON COLUMN public.orders.price IS 'The listing''s asking price when the order was created (create_order forces it). NOT the amount paid.';
COMMENT ON COLUMN public.orders.final_price IS 'Amount the buyer confirmed was paid, entered at completion. Buyer-confirmed, not payment-verified. NULL = not recorded.';

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
  v_final_raw     text;
  v_final         integer;
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

  -- ── 6b. The buyer's confirmed final price (completion only, optional) ─────
  -- A whole number of shekels, 1 .. 100,000,000. Absent → NULL: never guessed from the asking price.
  IF p_new_status = 'completed' THEN
    v_final_raw := NULLIF(btrim(COALESCE(p_meta->>'final_price', '')), '');
    IF v_final_raw IS NOT NULL THEN
      IF v_final_raw !~ '^[0-9]{1,9}$' OR v_final_raw::bigint < 1 OR v_final_raw::bigint > 100000000 THEN
        RAISE EXCEPTION 'final_price must be a whole number of shekels between 1 and 100000000'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_final := v_final_raw::integer;
    END IF;
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
    SET status = 'completed', completed_at = v_now, updated_at = v_now,
        final_price              = v_final,
        final_price_source       = CASE WHEN v_final IS NULL THEN NULL ELSE 'buyer_confirmed' END,
        final_price_confirmed_at = CASE WHEN v_final IS NULL THEN NULL ELSE v_now END
    WHERE id = p_order_id;

    -- Atomically mark the listing sold; its sold price is the buyer's confirmed figure, or nothing.
    UPDATE listings
    SET status  = 'sold',
        sold_to = v_order.buyer_id,
        sold_at = v_now,
        actual_sold_price = v_final
    WHERE id = v_order.listing_id;
  END IF;

  -- ── 8. Notify the opposite party ─────────────────────────────────────────
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

  RETURN jsonb_build_object('ok', true, 'status', p_new_status, 'final_price', v_final);
END;
$function$;

-- ── PART 2 — listings.price_source / suggested_price ─────────────────────────
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS price_source text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS suggested_price integer;
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_price_source_valid;
ALTER TABLE public.listings ADD CONSTRAINT listings_price_source_valid
  CHECK (price_source IS NULL OR price_source IN ('getworth_valuation', 'seller_entered'));
COMMENT ON COLUMN public.listings.price_source IS 'getworth_valuation: the price equals (2% / ₪5) a number the linked valuation showed; seller_entered: it does not, or no valuation is linked. Set by trigger. NULL = before 2026-11-08, unknown.';

CREATE OR REPLACE FUNCTION public.listings_set_price_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_low      numeric;
  v_mid      numeric;
  v_high     numeric;
  v_prices   jsonb;
  v_suggest  numeric;
  v_matched  boolean := false;
BEGIN
  -- Whatever the client sent, the server decides.
  NEW.price_source    := 'seller_entered';
  NEW.suggested_price := NULL;
  IF NEW.valuation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT price_low, price_mid, price_high, ai_raw_response->'valuation'->'prices'
    INTO v_low, v_mid, v_high, v_prices
  FROM valuations WHERE id = NEW.valuation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Every number the valuation could have shown: its stored range, and each condition's list / worth / quick / low / high.
  SELECT bool_or(abs(NEW.price - c) <= greatest(5, 0.02 * c)) INTO v_matched
  FROM (
    SELECT unnest(ARRAY[v_low, v_mid, v_high]) AS c
    UNION ALL
    SELECT (b.value->>k)::numeric
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_prices) = 'object' THEN v_prices ELSE '{}'::jsonb END) b
    CROSS JOIN unnest(ARRAY['list', 'worth', 'quick', 'low', 'high']) k
    WHERE jsonb_typeof(b.value) = 'object' AND (b.value->>k) ~ '^[0-9]+(\.[0-9]+)?$'
  ) s
  WHERE c IS NOT NULL AND c > 0;

  IF (v_prices->'good'->>'list') ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_suggest := (v_prices->'good'->>'list')::numeric;
  ELSE
    v_suggest := v_mid;
  END IF;

  IF v_matched IS TRUE THEN NEW.price_source := 'getworth_valuation'; END IF;
  NEW.suggested_price := CASE WHEN v_suggest > 0 THEN round(v_suggest)::integer ELSE NULL END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_listings_price_provenance ON public.listings;
CREATE TRIGGER trg_listings_price_provenance
  BEFORE INSERT OR UPDATE OF price, valuation_id ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.listings_set_price_provenance();

-- ── PART 3 — profiles.is_test ───────────────────────────────────────────────
-- Written into every existing row, not left as a column default: the existing update guard rebuilds a row with
-- jsonb_populate_record(OLD, …), and a "fast default" (a value only in the catalog, never written to the row) comes
-- back from it as NULL — every profile edit by a user then failed NOT NULL (caught by tests/marketplace-provenance).
-- The value written is the column's own default, false: no existing fact about any account changes.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test boolean;
UPDATE public.profiles SET is_test = false WHERE is_test IS NULL;
ALTER TABLE public.profiles ALTER COLUMN is_test SET DEFAULT false;
ALTER TABLE public.profiles ALTER COLUMN is_test SET NOT NULL;
COMMENT ON COLUMN public.profiles.is_test IS 'Internal/test account: its transactions are never market evidence. Set by admins only (admin_set_test_account).';

-- The existing insert guard, plus one line: a new profile is never a test account by its own say-so.
CREATE OR REPLACE FUNCTION public.profiles_enforce_safe_defaults_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.is_admin            := false;
  NEW.is_test             := false;
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
-- (profiles_prevent_privilege_escalation_update reverts any non-admin change outside its allow-list of
--  avatar_url, full_name, location, phone, updated_at: is_test is protected without changing it.)

CREATE OR REPLACE FUNCTION public.admin_set_test_account(p_user_id uuid, p_is_test boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_is_test IS NULL THEN
    RAISE EXCEPTION 'p_is_test is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE profiles SET is_test = p_is_test, updated_at = now() WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'is_test', p_is_test);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_test_account(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_test_account(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_test_account_ids()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT id FROM profiles WHERE is_test;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_test_account_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_account_ids() TO authenticated;

-- ── PART 4 — no comp from an asking price, a test account or GetWorth's own suggestion ─────────────────
CREATE OR REPLACE FUNCTION public.create_comp_from_sale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_genuine boolean;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    -- Only a price the buyer confirmed, between two accounts that are neither admin nor test.
    v_genuine := NEW.final_price IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id IN (NEW.buyer_id, NEW.seller_id) AND (p.is_admin OR p.is_test));
    IF NOT v_genuine THEN
      RETURN NEW;
    END IF;

    -- A comp only where the seller set the listing price: GetWorth's own number is not independent evidence.
    INSERT INTO comps (product_id, source, price, condition, is_sold, sold_at, title, category, brand, model, confidence)
    SELECT
      l.product_id,
      'getworth',
      NEW.final_price,
      l.condition,
      true,
      now(),
      l.title,
      l.category,
      (l.attributes->>'brand'),
      (l.attributes->>'model'),
      COALESCE(l.ai_confidence, 0.8)
    FROM listings l
    WHERE l.id = NEW.listing_id AND l.price_source = 'seller_entered';

    -- What the linked valuation said against what was paid: recorded for accuracy measurement either way.
    UPDATE valuations
    SET
      actual_sold_price = NEW.final_price,
      price_accuracy = CASE WHEN price_mid > 0 THEN NEW.final_price::REAL / price_mid ELSE NULL END
    WHERE listing_id = NEW.listing_id;

    INSERT INTO jobs_queue (job_type, payload, priority)
    SELECT 'recalc_prices', jsonb_build_object('product_id', l.product_id), 3
    FROM listings l
    WHERE l.id = NEW.listing_id AND l.product_id IS NOT NULL AND l.price_source = 'seller_entered';
  END IF;
  RETURN NEW;
END;
$function$;
