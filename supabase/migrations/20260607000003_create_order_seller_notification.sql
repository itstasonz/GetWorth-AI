-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — create_order: notify seller on new pending order
-- Generated: 2026-06-07
--
-- Gap: create_order inserted an order row but never wrote a notifications row
-- for the seller, so the seller received no toast, no badge, and no realtime
-- alert when a buyer placed an order. The realtime orders-INSERT subscription
-- in the frontend triggered a silent loadOrders() refresh only if the seller's
-- app was already open and subscribed.
--
-- Fix: add a notifications INSERT at the end of create_order, immediately after
-- the order row is committed. Pattern is identical to transition_order step 8.
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

  -- ── 9. Notify seller of new pending order ─────────────────────────────────
  INSERT INTO notifications (user_id, type, title, body, data, created_at)
  VALUES (
    v_listing.seller_id,
    'ORDER_PENDING',
    'New order request',
    COALESCE(v_listing.title, ''),
    jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id),
    v_now
  );

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


-- ── Verify ───────────────────────────────────────────────────────────────────
-- After applying, place a test order and confirm:
--   SELECT * FROM notifications WHERE type = 'ORDER_PENDING' ORDER BY created_at DESC LIMIT 5;
-- Expected: one row per new order, user_id = seller's UUID, body = listing title.
