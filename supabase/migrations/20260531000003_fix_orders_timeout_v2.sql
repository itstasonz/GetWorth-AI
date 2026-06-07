-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix Orders 57014 Timeout (v2)
-- Migration: 20260531000003
--
-- Root cause of 57014 in the existing get_user_orders():
--
--   A. WHERE buyer_id = auth.uid() OR seller_id = auth.uid()
--      OR conditions over two columns prevent Postgres from using two
--      separate index range scans + early LIMIT termination.  The planner
--      may choose a bitmap heap scan that reads far more rows than needed
--      before applying LIMIT 50.
--
--   B. to_jsonb(o)
--      Serialises every column on the full orders row (including any wide
--      JSONB / TEXT columns) for every row scanned, not just the 50 returned.
--      With the wrong plan this amplifies the cost significantly.
--
-- Fix:
--   Replace OR with UNION (two separate index scans, each <= 50 rows,
--   then join only those rows for the column projection).  Explicit
--   jsonb_build_object with the columns the frontend actually uses replaces
--   to_jsonb(o).
--
--   Indexes from 20260526000002 are re-created idempotently so this
--   migration is safe to apply even if the previous one was never run.
--
-- Security model unchanged:
--   Both RPCs remain SECURITY DEFINER; auth.uid() enforces caller scope;
--   RLS on orders stays enabled for direct table access.
--
-- Safe to re-run — all DDL is CREATE OR REPLACE / CREATE IF NOT EXISTS.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── PART 1 — Indexes (idempotent) ────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orders_buyer_id_created_at
  ON public.orders (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_seller_id_created_at
  ON public.orders (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_listing_id
  ON public.orders (listing_id);

-- Covering index for status-based realtime queries / order detail lookups
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON public.orders (status)
  WHERE status NOT IN ('completed', 'cancelled', 'declined');


-- ── PART 2 — get_user_orders() — UNION rewrite ───────────────────────────────
--
-- Pattern:
--   Step 1: UNION of two narrow index scans → at most 50 distinct (id, created_at)
--           pairs with zero heap access.
--   Step 2: JOIN those 50 rows back to orders for the column projection.
--   Step 3: LEFT JOIN listings, buyer profile, seller profile.
--
-- No OR condition in the outer query → planner always uses the two
-- composite indexes (buyer_id, created_at DESC) and (seller_id, created_at DESC).
--
-- auth.uid() is captured once into v_uid (stable within the function call).
-- Early-exit when unauthenticated — avoids a full-table scan on NULL uid.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_orders()
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    jsonb_build_object(
      -- Core identity
      'id',                 o.id,
      'listing_id',         o.listing_id,
      'buyer_id',           o.buyer_id,
      'seller_id',          o.seller_id,
      -- Transaction
      'price',              o.price,
      'delivery_method',    o.delivery_method,
      'shipping_address',   o.shipping_address,
      'buyer_note',         o.buyer_note,
      -- State machine
      'status',             o.status,
      'created_at',         o.created_at,
      'updated_at',         o.updated_at,
      'accepted_at',        o.accepted_at,
      'declined_at',        o.declined_at,
      'shipped_at',         o.shipped_at,
      'delivered_at',       o.delivered_at,
      'completed_at',       o.completed_at,
      'cancelled_at',       o.cancelled_at,
      'cancelled_by',       o.cancelled_by,
      'cancel_reason',      o.cancel_reason,
      'buyer_confirmed_at', o.buyer_confirmed_at,
      -- Embedded listing (non-null when listing exists and is readable)
      'listing', CASE WHEN l.id IS NOT NULL THEN
        jsonb_build_object(
          'id',            l.id,
          'title',         l.title,
          'title_hebrew',  l.title_hebrew,
          'price',         l.price,
          'images',        l.images,
          'location',      l.location,
          'contact_phone', l.contact_phone,
          'seller_id',     l.seller_id
        )
      ELSE NULL END,
      -- Embedded buyer profile
      'buyer', CASE WHEN bp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          bp.id,
          'full_name',   bp.full_name,
          'avatar_url',  bp.avatar_url,
          'is_verified', bp.is_verified
        )
      ELSE NULL END,
      -- Embedded seller profile
      'seller', CASE WHEN sp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          sp.id,
          'full_name',   sp.full_name,
          'avatar_url',  sp.avatar_url,
          'is_verified', sp.is_verified
        )
      ELSE NULL END
    )
  FROM (
    -- Two narrow index-only scans.  UNION deduplicates the (impossible in
    -- this app, but theoretically possible) case where buyer_id = seller_id.
    -- Each subquery is bounded to 50 rows by the outer LIMIT.
    SELECT id, created_at FROM public.orders WHERE buyer_id  = v_uid
    UNION
    SELECT id, created_at FROM public.orders WHERE seller_id = v_uid
    ORDER BY created_at DESC
    LIMIT 50
  ) top
  JOIN   public.orders   o  ON o.id  = top.id
  LEFT JOIN public.listings l  ON l.id  = o.listing_id
  LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
  LEFT JOIN public.profiles sp ON sp.id = o.seller_id
  ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_user_orders()   FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_user_orders()   TO authenticated;


-- ── PART 3 — get_order_by_id() — explicit columns ────────────────────────────
--
-- Single-row lookup by PK: no OR performance issue here (PK scan is O(1)).
-- Rewritten with explicit jsonb_build_object to match get_user_orders shape
-- and avoid to_jsonb(o) serialising unneeded columns.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_order_by_id(p_order_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    jsonb_build_object(
      'id',                 o.id,
      'listing_id',         o.listing_id,
      'buyer_id',           o.buyer_id,
      'seller_id',          o.seller_id,
      'price',              o.price,
      'delivery_method',    o.delivery_method,
      'shipping_address',   o.shipping_address,
      'buyer_note',         o.buyer_note,
      'status',             o.status,
      'created_at',         o.created_at,
      'updated_at',         o.updated_at,
      'accepted_at',        o.accepted_at,
      'declined_at',        o.declined_at,
      'shipped_at',         o.shipped_at,
      'delivered_at',       o.delivered_at,
      'completed_at',       o.completed_at,
      'cancelled_at',       o.cancelled_at,
      'cancelled_by',       o.cancelled_by,
      'cancel_reason',      o.cancel_reason,
      'buyer_confirmed_at', o.buyer_confirmed_at,
      'listing', CASE WHEN l.id IS NOT NULL THEN
        jsonb_build_object(
          'id',            l.id,
          'title',         l.title,
          'title_hebrew',  l.title_hebrew,
          'price',         l.price,
          'images',        l.images,
          'location',      l.location,
          'contact_phone', l.contact_phone,
          'seller_id',     l.seller_id
        )
      ELSE NULL END,
      'buyer', CASE WHEN bp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          bp.id,
          'full_name',   bp.full_name,
          'avatar_url',  bp.avatar_url,
          'is_verified', bp.is_verified
        )
      ELSE NULL END,
      'seller', CASE WHEN sp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          sp.id,
          'full_name',   sp.full_name,
          'avatar_url',  sp.avatar_url,
          'is_verified', sp.is_verified
        )
      ELSE NULL END
    )
  FROM   public.orders   o
  LEFT JOIN public.listings l  ON l.id  = o.listing_id
  LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
  LEFT JOIN public.profiles sp ON sp.id = o.seller_id
  WHERE  o.id        = p_order_id
    AND (o.buyer_id  = v_uid OR o.seller_id = v_uid)
  LIMIT 1;
END;
$$;

REVOKE ALL     ON FUNCTION public.get_order_by_id(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_order_by_id(uuid) TO authenticated;


-- ── PART 4 — Verify ──────────────────────────────────────────────────────────

-- 4a. Indexes
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  tablename = 'orders'
  AND  indexname IN (
    'idx_orders_buyer_id_created_at',
    'idx_orders_seller_id_created_at',
    'idx_orders_listing_id',
    'idx_orders_status'
  )
ORDER BY indexname;
-- Expected: 4 rows

-- 4b. RPCs with correct signatures
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM   pg_proc
WHERE  proname IN ('get_user_orders', 'get_order_by_id')
  AND  pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname;
-- Expected:
--   get_order_by_id  | p_order_id uuid
--   get_user_orders  | (empty string)

-- 4c. Smoke test — run as an authenticated user in the SQL editor:
--   select get_user_orders();
--   Expected: rows with id, status, listing, buyer, seller nested objects.
--             Should complete in < 100ms even with thousands of orders.
--
--   explain (analyze, buffers) select * from get_user_orders();
--   Look for: "Index Scan using idx_orders_buyer_id_created_at"
--             "Index Scan using idx_orders_seller_id_created_at"
--   NOT: "Seq Scan on orders"
