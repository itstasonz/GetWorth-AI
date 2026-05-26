-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix Orders 57014 Statement Timeout
-- Migration: 20260526000002
-- Generated: 2026-05-26
--
-- Root cause (two layers):
--
--   A. Missing indexes on orders(buyer_id) and orders(seller_id).
--      The AppContext loadOrders query filters:
--        WHERE buyer_id = $uid OR seller_id = $uid ORDER BY created_at DESC
--      Without indexes, Postgres performs a sequential scan of the entire
--      orders table, then evaluates RLS for every row, then sorts.
--      Even moderate table sizes cause this to exceed the Supabase
--      PostgREST statement timeout (57014: canceling statement due to
--      statement timeout).
--
--   B. RLS overhead on every orders SELECT.
--      Two policies are OR-combined per row:
--        1. orders_select_parties:    buyer_id = auth.uid() OR seller_id = auth.uid()
--        2. orders_select_admin_bypass: auth_is_admin()
--      auth_is_admin() is STABLE so Postgres CAN hoist it once per query,
--      but the planner may still evaluate it per-row depending on the
--      plan chosen (e.g. nested-loop join).
--
--      Combined with the listings join RLS (listings_select_admin_bypass
--      also calls auth_is_admin() for each joined listing row), the total
--      overhead compounds.
--
-- Fix:
--   PART 1 — Indexes: orders(buyer_id, created_at DESC)
--                     orders(seller_id, created_at DESC)
--                     orders(listing_id)               — for listing join
--             These eliminate the sequential scan and make the ORDER BY
--             index-accelerated.
--
--   PART 2 — get_user_orders() SECURITY DEFINER RPC
--             Runs as postgres (table owner) — bypasses all RLS policies.
--             Security is enforced within the function via WHERE clause.
--             Single-query JOIN — one round-trip instead of PostgREST's
--             multi-query embedded-resource pattern.
--
--   PART 3 — get_order_by_id(p_order_id uuid) SECURITY DEFINER RPC
--             Same approach for the single-order fetch in fetchOrderById.
--
-- Security model:
--   Both RPCs call auth.uid() to identify the caller and enforce the same
--   "buyer or seller" constraint that RLS would.  admin bypass is NOT
--   included here — admins use the admin panel (separate RPCs with their
--   own security definer logic).
--
-- DO NOT:
--   • disable RLS on orders (policies remain in place for direct table access)
--   • expose private profile columns (only id, full_name, avatar_url, is_verified)
--
-- Apply in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — Indexes
-- ══════════════════════════════════════════════════════════════════════════════

-- Composite: buyer_id + created_at DESC satisfies both the WHERE filter
-- and the ORDER BY in one index scan.
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id_created_at
  ON public.orders (buyer_id, created_at DESC);

-- Same for seller_id.
CREATE INDEX IF NOT EXISTS idx_orders_seller_id_created_at
  ON public.orders (seller_id, created_at DESC);

-- FK to listings — speeds up the listing LEFT JOIN.
CREATE INDEX IF NOT EXISTS idx_orders_listing_id
  ON public.orders (listing_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — get_user_orders() RPC
--
-- Returns all orders for auth.uid() (buyer or seller) with nested listing,
-- buyer, and seller objects embedded in each row as JSONB — matching the
-- shape AppContext expects from PostgREST embedded resources.
--
-- SECURITY DEFINER: runs as postgres.  auth.uid() still works because
-- auth schema is accessible inside security-definer functions.
-- STABLE: no side effects; result can be cached within a query.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_user_orders();

CREATE FUNCTION get_user_orders()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_jsonb(o) ||
    jsonb_build_object(
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
  FROM   orders   o
  LEFT JOIN listings l  ON l.id  = o.listing_id
  LEFT JOIN profiles bp ON bp.id = o.buyer_id
  LEFT JOIN profiles sp ON sp.id = o.seller_id
  WHERE  o.buyer_id  = auth.uid()
     OR  o.seller_id = auth.uid()
  ORDER BY o.created_at DESC
  LIMIT 50;
$$;

-- Only authenticated callers may execute.
REVOKE ALL    ON FUNCTION get_user_orders()             FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_user_orders()            TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — get_order_by_id(p_order_id uuid) RPC
--
-- Fetches a single order by ID, enforcing that the caller is a party.
-- Returns SETOF jsonb (0 or 1 rows) so the client does data?.[0] ?? null.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_order_by_id(uuid);

CREATE FUNCTION get_order_by_id(p_order_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_jsonb(o) ||
    jsonb_build_object(
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
  FROM   orders   o
  LEFT JOIN listings l  ON l.id  = o.listing_id
  LEFT JOIN profiles bp ON bp.id = o.buyer_id
  LEFT JOIN profiles sp ON sp.id = o.seller_id
  WHERE  o.id        = p_order_id
    AND (o.buyer_id  = auth.uid() OR o.seller_id = auth.uid())
  LIMIT 1;
$$;

REVOKE ALL    ON FUNCTION get_order_by_id(uuid)         FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_order_by_id(uuid)        TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — Verify
-- ══════════════════════════════════════════════════════════════════════════════

-- 4a. Indexes created
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  tablename = 'orders'
  AND  indexname IN (
    'idx_orders_buyer_id_created_at',
    'idx_orders_seller_id_created_at',
    'idx_orders_listing_id'
  )
ORDER  BY indexname;
-- Expected: 3 rows

-- 4b. RPCs exist
SELECT proname, pronargs
FROM   pg_proc
WHERE  proname IN ('get_user_orders', 'get_order_by_id')
ORDER  BY proname;
-- Expected: 2 rows (get_order_by_id pronargs=1, get_user_orders pronargs=0)

-- 4c. Smoke test (run as authenticated user in SQL editor):
--
--   select get_user_orders();
--   Expected: rows matching the logged-in user's orders, with nested
--             listing / buyer / seller objects.
--
--   select get_order_by_id('<valid-order-id-you-own>');
--   Expected: 1 row with full order data.
--
--   select get_order_by_id('<order-id-you-do-not-own>');
--   Expected: 0 rows (enforced by WHERE buyer_id = auth.uid() OR seller_id = auth.uid())
