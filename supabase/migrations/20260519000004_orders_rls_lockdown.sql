-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Orders RLS Lockdown  (Phase 3)
-- Generated: 2026-05-19
--
-- PREREQUISITE: Apply ONLY after all of these are true:
--   1. Migration 20260519000003_order_integrity.sql is applied and verified.
--   2. Frontend createOrder calls create_order RPC (no direct orders.insert).
--   3. Frontend updateOrderStatus calls transition_order RPC (no direct update).
--   4. Frontend cancelOrder passes cancel_reason via transition_order p_meta.
--   5. Code deployed and tested in production.
--
-- What this migration adds:
--   PART 1 — ALTER TABLE orders ENABLE ROW LEVEL SECURITY
--   PART 2 — orders_select_parties  (buyer or seller reads own orders)
--   PART 3 — orders_insert_buyer    (INSERT blocked unless buyer_id = auth.uid())
--   PART 4 — orders_update_parties  (UPDATE restricted; immutable core fields)
--   PART 5 — verify queries
--
-- The admin bypass SELECT policy (orders_select_admin_bypass) was added in
-- migration 20260519000001 and becomes active once RLS is enabled here.
--
-- SECURITY DEFINER RPCs (transition_order, create_order) run as the postgres
-- role and bypass RLS entirely, so these policies do not affect them.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — Enable RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — SELECT: parties read their own orders
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "orders_select_parties" ON orders;

CREATE POLICY "orders_select_parties"
  ON orders FOR SELECT
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — INSERT: buyer_id must equal the authenticated caller
--
-- After this is applied, direct orders.insert() from the client will fail
-- unless buyer_id = auth.uid(). create_order RPC (SECURITY DEFINER) bypasses
-- this and remains the canonical insertion path.
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "orders_insert_buyer" ON orders;

CREATE POLICY "orders_insert_buyer"
  ON orders FOR INSERT
  WITH CHECK (buyer_id = auth.uid());


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — UPDATE: parties only; core fields are immutable
--
-- Subqueries re-read the DB row (MVCC OLD snapshot) to verify that
-- buyer_id, seller_id, price, and listing_id have not been altered.
-- transition_order (SECURITY DEFINER) runs as postgres and bypasses this.
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "orders_update_parties" ON orders;

CREATE POLICY "orders_update_parties"
  ON orders FOR UPDATE
  USING (buyer_id = auth.uid() OR seller_id = auth.uid())
  WITH CHECK (
    buyer_id   = (SELECT o2.buyer_id   FROM orders o2 WHERE o2.id = orders.id) AND
    seller_id  = (SELECT o2.seller_id  FROM orders o2 WHERE o2.id = orders.id) AND
    price      = (SELECT o2.price      FROM orders o2 WHERE o2.id = orders.id) AND
    listing_id = (SELECT o2.listing_id FROM orders o2 WHERE o2.id = orders.id)
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5 — Verify
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a. Confirm RLS is enabled on orders
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'orders';
-- Expected: relrowsecurity = true

-- 5b. Confirm all 4 orders policies exist
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'orders'
ORDER BY cmd, policyname;
-- Expected 4 rows:
--   orders_insert_buyer          (INSERT)
--   orders_select_admin_bypass   (SELECT) ← from migration 20260519000001
--   orders_select_parties        (SELECT)
--   orders_update_parties        (UPDATE)

-- 5c. Smoke test — direct insert as non-admin user should be rejected
--     (buyer_id forged to a different user's uuid)
--     supabase.from('orders').insert({ buyer_id: '<other-user-id>', ... })
--     Expected: error 42501 (new row violates row-level security policy)

-- 5d. Smoke test — direct update of price as buyer should be rejected
--     supabase.from('orders').update({ price: 0 }).eq('id', '<order-id>')
--     Expected: error 42501 (new row violates WITH CHECK for orders_update_parties)
