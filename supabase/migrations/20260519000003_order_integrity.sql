-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Order Integrity Hardening  (Phase 1A)
-- Generated: 2026-05-19
--
-- PART 1 — transition_order   SECURITY DEFINER RPC
-- PART 2 — create_order        SECURITY DEFINER RPC
-- PART 3 — DB constraints      (NOT VALID — safe on existing data)
-- PART 4 — reviews RLS patch   (require order.status = 'completed')
-- PART 5 — verify queries
--
-- Phase 1A is safe to apply before the frontend is updated.
-- Orders RLS (INSERT / UPDATE lockdown) is intentionally deferred to
-- migration 20260519000004_orders_rls_lockdown.sql (Phase 3), which must
-- only be applied AFTER the frontend has been switched to the create_order
-- and transition_order RPCs.
--
-- All RPCs are SECURITY DEFINER (bypass RLS) and verify auth.uid() + caller
-- role from the DB row — never from the JWT or client payload.
-- Constraints use NOT VALID so they enforce new rows without scanning existing
-- data. Run VALIDATE CONSTRAINT separately once bad rows are confirmed absent.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — transition_order
--
-- Valid transitions:
--   SELLER : pending  → accepted | declined
--            accepted → shipped  | ready_pickup
--   EITHER : pending  → cancelled
--            accepted → cancelled
--   BUYER  : shipped      → delivered
--            ready_pickup → delivered
--            ready_pickup → completed  (pickup shortcut)
--            delivered   → completed
--
-- Terminal states (no further transitions allowed):
--   completed | cancelled | declined | disputed
--
-- Side effects on completed:
--   listings.status = 'sold', sold_to = buyer_id, sold_at = now()
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS transition_order(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION transition_order(
  p_order_id  uuid,
  p_new_status text,
  p_meta       jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_order         orders%ROWTYPE;
  v_current       text;
  v_required_role text;  -- 'seller' | 'buyer' | 'either'
  v_now           timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Load order ────────────────────────────────────────────────────────
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
    UPDATE orders SET status = 'accepted',   accepted_at   = v_now, updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'declined' THEN
    UPDATE orders SET status = 'declined',   declined_at   = v_now, updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'shipped' THEN
    UPDATE orders SET status = 'shipped',    shipped_at    = v_now, updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'ready_pickup' THEN
    UPDATE orders SET status = 'ready_pickup', shipped_at  = v_now, updated_at = v_now WHERE id = p_order_id;

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
    -- Atomically complete the order AND mark the listing sold
    UPDATE orders
    SET status = 'completed', completed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

    UPDATE listings
    SET status   = 'sold',
        sold_to  = v_order.buyer_id,
        sold_at  = v_now
    WHERE id = v_order.listing_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_new_status);
END;
$$;

REVOKE ALL ON FUNCTION transition_order(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_order(uuid, text, jsonb) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — create_order
--
-- Atomic server-side order creation. Validates:
--   • caller is authenticated
--   • listing exists and is active  (FOR UPDATE lock prevents races)
--   • caller is not the seller      (no self-buy)
--   • p_seller_id matches listing.seller_id  (client can't forge seller)
--   • p_price    matches listing.price       (client can't forge price)
--   • no existing active order for same (listing_id, buyer_id)
-- Returns: jsonb with the created order's id and core fields.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS create_order(uuid, uuid, numeric, text, text, text);

CREATE OR REPLACE FUNCTION create_order(
  p_listing_id       uuid,
  p_seller_id        uuid,
  p_price            numeric,
  p_delivery_method  text,
  p_shipping_address text DEFAULT NULL,
  p_buyer_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id  uuid;
  v_listing    listings%ROWTYPE;
  v_order_id   uuid;
  v_now        timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Lock and load listing ─────────────────────────────────────────────
  -- FOR UPDATE serialises concurrent order attempts on the same listing.
  SELECT * INTO v_listing FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Listing must be active ────────────────────────────────────────────
  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available (status: %)', v_listing.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 4. Self-buy prevention ───────────────────────────────────────────────
  IF v_listing.seller_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot buy your own listing'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 5. Verify seller_id matches DB (client cannot forge) ─────────────────
  IF v_listing.seller_id <> p_seller_id THEN
    RAISE EXCEPTION 'seller_id does not match listing'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 6. Verify price matches DB (client cannot forge) ─────────────────────
  IF v_listing.price <> p_price THEN
    RAISE EXCEPTION 'price does not match listing (expected %, got %)',
      v_listing.price, p_price
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 7. Duplicate active order check ──────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM orders
    WHERE listing_id = p_listing_id
      AND buyer_id   = v_caller_id
      AND status NOT IN ('cancelled', 'completed', 'declined')
  ) THEN
    RAISE EXCEPTION 'You already have an active order for this listing'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ── 8. Insert order ───────────────────────────────────────────────────────
  INSERT INTO orders (
    listing_id, buyer_id, seller_id, price,
    delivery_method, shipping_address, buyer_note,
    status, created_at, updated_at
  )
  VALUES (
    p_listing_id, v_caller_id, v_listing.seller_id, v_listing.price,
    p_delivery_method, p_shipping_address, p_buyer_note,
    'pending', v_now, v_now
  )
  RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'id',              v_order_id,
    'listing_id',      p_listing_id,
    'buyer_id',        v_caller_id,
    'seller_id',       v_listing.seller_id,
    'price',           v_listing.price,
    'delivery_method', p_delivery_method,
    'status',          'pending',
    'created_at',      v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION create_order(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_order(uuid, uuid, numeric, text, text, text) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — DB constraints
--
-- Both constraints use NOT VALID so they enforce new rows immediately but
-- do not scan existing data. This prevents the migration from failing if
-- historical bad rows exist. After confirming clean data, run:
--   ALTER TABLE orders VALIDATE CONSTRAINT orders_no_self_buy;
--   ALTER TABLE orders VALIDATE CONSTRAINT orders_status_valid;
-- ══════════════════════════════════════════════════════════════════════════════

-- 3a. Self-buy prevention
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'orders'::regclass AND conname = 'orders_no_self_buy'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_no_self_buy CHECK (buyer_id <> seller_id) NOT VALID;
    RAISE NOTICE 'Added constraint: orders_no_self_buy';
  ELSE
    RAISE NOTICE 'Constraint orders_no_self_buy already exists — skipping';
  END IF;
END $$;

-- 3b. Status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'orders'::regclass AND conname = 'orders_status_valid'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_status_valid CHECK (
        status IN (
          'pending', 'accepted', 'declined', 'shipped',
          'ready_pickup', 'delivered', 'completed', 'cancelled', 'disputed'
        )
      ) NOT VALID;
    RAISE NOTICE 'Added constraint: orders_status_valid';
  ELSE
    RAISE NOTICE 'Constraint orders_status_valid already exists — skipping';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — reviews_insert_order_party_only patch
--
-- Adds AND o.status = 'completed' to the existing INSERT policy.
-- Drops and recreates (idempotent).
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "reviews_insert_order_party_only" ON reviews;

CREATE POLICY "reviews_insert_order_party_only"
  ON reviews
  FOR INSERT
  WITH CHECK (
    -- Reviewer must be the authenticated user
    reviewer_id = auth.uid()
    -- Order must exist, be completed, caller must be a party,
    -- and the reviewee must be the other party
    AND EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.id = reviews.order_id
        AND o.status = 'completed'
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
        AND (o.seller_id = reviews.seller_id OR o.buyer_id = reviews.seller_id)
    )
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5 — Verify (Phase 1A scope)
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a. Confirm both RPCs exist
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN ('transition_order', 'create_order')
ORDER BY proname;
-- Expected: 2 rows

-- 5b. Confirm constraints exist (NOT VALID is expected until VALIDATE runs)
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
  AND conname IN ('orders_no_self_buy', 'orders_status_valid');
-- Expected: 2 rows, convalidated = false

-- 5c. Confirm reviews policy was updated
SELECT policyname, with_check
FROM pg_policies
WHERE tablename = 'reviews' AND policyname = 'reviews_insert_order_party_only';
-- Expected: 1 row; with_check must contain 'completed'

-- 5d. Data risk check — run BEFORE VALIDATE:
SELECT COUNT(*) FROM orders WHERE buyer_id = seller_id;
--   Expected: 0. Non-zero = investigate before VALIDATE.

SELECT DISTINCT status FROM orders
WHERE status NOT IN (
  'pending','accepted','declined','shipped',
  'ready_pickup','delivered','completed','cancelled','disputed'
);
--   Expected: no rows. Non-empty = fix data before VALIDATE.

-- 5e. After confirming clean data (both checks pass), harden constraints:
--   ALTER TABLE orders VALIDATE CONSTRAINT orders_no_self_buy;
--   ALTER TABLE orders VALIDATE CONSTRAINT orders_status_valid;

-- ── Next step ─────────────────────────────────────────────────────────────────
-- Orders INSERT/UPDATE RLS is in 20260519000004_orders_rls_lockdown.sql.
-- Apply that migration ONLY after the frontend has been switched to
-- create_order and transition_order RPCs and tested in production.
