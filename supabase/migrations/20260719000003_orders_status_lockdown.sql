-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-001 — orders: eliminate direct status manipulation.
-- Idempotent — safe to re-run.
--
-- Vulnerability (confirmed by audit, two independent paths):
--   1. UPDATE — orders_update_parties WITH CHECK (20260519000004) pins
--      buyer_id / seller_id / price / listing_id but NOT status. Any order
--      party could PATCH /rest/v1/orders and jump their order to any status
--      (e.g. pending → completed), bypassing transition_order()'s role checks
--      and legal-transition matrix. A fake 'completed' unlocks review
--      creation (reviews_integrity requires status='completed'), fires the
--      total_sales recompute, and skips the mark-listing-sold side effect.
--   2. INSERT — orders_insert_buyer WITH CHECK only requires
--      buyer_id = auth.uid(); orders_status_valid allows all 9 statuses.
--      Any user could INSERT a fabricated already-'completed' order naming an
--      arbitrary seller — instant review eligibility against any victim, no
--      real order needed.
--
-- Authorized mutation paths after this migration (complete inventory):
--   • create_order()              SECURITY DEFINER — sole INSERT path
--   • transition_order()          SECURITY DEFINER — sole status-change path
--                                 (THE authoritative transition matrix)
--   • admin_update_order_status() SECURITY DEFINER — admin escape hatch,
--                                 server-verifies profiles.is_admin
--   • service_role / postgres     operational access, by design
--   Frontend verified: all 5 .from('orders') call sites are SELECTs; every
--   write goes through the three RPCs. Nothing loses functionality.
--
-- Defense in depth, three layers (each alone closes the hole):
--   L1 privileges — REVOKE INSERT/UPDATE/DELETE on orders from client roles.
--      Direct writes now fail 42501 before RLS is even consulted.
--   L2 RLS        — drop ALL write policies on orders (including any unknown
--      dashboard-era leftovers, logged for rollback). RLS stays enabled, so
--      if a write privilege is ever accidentally re-granted, the absence of
--      a write policy still fails closed (default-deny).
--   L3 trigger    — BEFORE INSERT OR UPDATE guard: client roles can never
--      insert a non-'pending' status or change status. Backstop in case a
--      future migration reintroduces both a grant and a policy.
--      current_user inside a SECURITY DEFINER function is the function owner
--      (postgres), so the three RPCs and service_role pass untouched.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_orders_status_guard ON public.orders;
--   DROP FUNCTION IF EXISTS public.orders_status_guard();
--   GRANT INSERT, UPDATE ON public.orders TO authenticated;
--   CREATE POLICY "orders_insert_buyer" ON public.orders FOR INSERT
--     WITH CHECK (buyer_id = auth.uid());
--   CREATE POLICY "orders_update_parties" ON public.orders FOR UPDATE
--     USING (buyer_id = auth.uid() OR seller_id = auth.uid())
--     WITH CHECK (
--       buyer_id   = (SELECT o2.buyer_id   FROM orders o2 WHERE o2.id = orders.id) AND
--       seller_id  = (SELECT o2.seller_id  FROM orders o2 WHERE o2.id = orders.id) AND
--       price      = (SELECT o2.price      FROM orders o2 WHERE o2.id = orders.id) AND
--       listing_id = (SELECT o2.listing_id FROM orders o2 WHERE o2.id = orders.id)
--     );
--   (plus any dashboard policies captured in the pg_policies log below)
-- ══════════════════════════════════════════════════════════════════════════════


-- ── L1: revoke client write privileges ────────────────────────────────────────
-- SELECT is retained: order visibility stays governed by the SELECT policies
-- (parties + admin bypass), and the reviews INSERT policy's EXISTS-on-orders
-- subquery needs it.
--   TRUNCATE is revoked too — it is NOT gated by RLS or by BEFORE ROW triggers,
--   so a leftover TRUNCATE grant would let a client wipe the table around L2/L3.
--   Revoke from PUBLIC as well so a grant made to PUBLIC (not the role directly)
--   cannot leave residual access after the role-scoped revoke.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM PUBLIC;


-- ── L2: drop every write policy on orders ─────────────────────────────────────
-- Dynamic so dashboard-era policies not present in migration history are also
-- removed. Each dropped policy is logged (name/cmd/qual/with_check) as the
-- rollback evidence trail — same pattern as 20260719000002.

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    RAISE LOG 'orders write policy dropped by 20260719000003: name=% cmd=% qual=% with_check=%',
      pol.policyname, pol.cmd, pol.qual, pol.with_check;
    EXECUTE format('DROP POLICY %I ON public.orders', pol.policyname);
  END LOOP;
END $$;


-- ── L3: status guard trigger ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.orders_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Client roles only. SECURITY DEFINER RPCs execute as their owner
  -- (postgres) and service_role is operational — both pass through.
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'orders must be created via create_order() (status % rejected)', NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'orders.status can only be changed via transition_order()'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_status_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_orders_status_guard ON public.orders;

CREATE TRIGGER trg_orders_status_guard
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_status_guard();


-- ── Verify ────────────────────────────────────────────────────────────────────

-- 1. No client write privileges remain on orders:
--    SELECT grantee, privilege_type
--    FROM   information_schema.role_table_grants
--    WHERE  table_schema = 'public' AND table_name = 'orders'
--      AND  grantee IN ('anon', 'authenticated');
--    Expected: SELECT only.

-- 2. No write policies remain:
--    SELECT policyname, cmd FROM pg_policies
--    WHERE  schemaname = 'public' AND tablename = 'orders';
--    Expected: only SELECT policies (orders_select_parties,
--    orders_select_admin_bypass).

-- 3. Guard trigger attached:
--    SELECT tgname, tgenabled FROM pg_trigger
--    WHERE  tgrelid = 'public.orders'::regclass
--      AND  tgname = 'trg_orders_status_guard';
--    Expected: 1 row, tgenabled = 'O'.

-- 4. Runtime (as an authenticated order party):
--    PATCH /rest/v1/orders?id=eq.<own order> {"status":"completed"}
--      → 42501 permission denied for table orders
--    POST  /rest/v1/orders {..., "status":"completed"}
--      → 42501 permission denied for table orders
--    transition_order(<own order>, valid next status) → succeeds unchanged.
