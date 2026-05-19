-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Admin Server-Side Authorization
-- Generated: 2026-05-19
--
-- All admin mutations are now server-side RPCs. Each RPC:
--   1. Requires a valid JWT (auth.uid() not null)
--   2. Reads profiles.is_admin from the DB — never trusts JWT claims
--   3. Returns insufficient_privilege (HTTP 403) if not admin
--   4. Uses SECURITY DEFINER to bypass RLS for the mutation itself
--
-- Also adds RLS admin-bypass SELECT policies so that admin reads (all orders,
-- all listings, all reports, stats counts) return correct results.
-- These policies EXTEND existing user-scoped policies (Supabase ORs them).
--
-- DO NOT run blindly. Verify existing RLS state first:
--   SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE tablename IN ('listings','orders','reports','conversations')
--   ORDER BY tablename, cmd;
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. RPC: admin_verify_user
--    Approve or reject a pending identity verification.
--    Replaces direct profiles.update() from AdminPanel.handleVerification.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_verify_user(uuid, boolean);

CREATE OR REPLACE FUNCTION admin_verify_user(p_user_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approve THEN
    UPDATE profiles
    SET
      verification_status = 'verified',
      is_verified         = true,
      verified_at         = now()
    WHERE id = p_user_id;
  ELSE
    UPDATE profiles
    SET verification_status = 'rejected'
    WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_verify_user(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_verify_user(uuid, boolean) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: admin_remove_listing
--    Set a listing status to 'removed' regardless of ownership.
--    Replaces direct listings.update() from AdminPanel.removeListing.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_remove_listing(uuid);

CREATE OR REPLACE FUNCTION admin_remove_listing(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE listings SET status = 'removed' WHERE id = p_listing_id;
END;
$$;

REVOKE ALL ON FUNCTION admin_remove_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_remove_listing(uuid) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: admin_dismiss_report
--    Delete a report record.
--    Replaces direct reports.delete() from AdminPanel.dismissReport.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_dismiss_report(uuid);

CREATE OR REPLACE FUNCTION admin_dismiss_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM reports WHERE id = p_report_id;
END;
$$;

REVOKE ALL ON FUNCTION admin_dismiss_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_dismiss_report(uuid) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RPC: admin_update_order_status
--    Override an order's status regardless of buyer/seller ownership.
--    Handles completed_at, cancelled_at, cancelled_by, cancel_reason server-side.
--    Replaces direct orders.update() from AdminPanel.adminUpdateOrder.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_update_order_status(uuid, text);

CREATE OR REPLACE FUNCTION admin_update_order_status(p_order_id uuid, p_new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_new_status NOT IN ('pending','accepted','shipped','ready_pickup','delivered','completed','cancelled','disputed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_new_status = 'completed' THEN
    UPDATE orders
    SET status       = 'completed',
        completed_at = now()
    WHERE id = p_order_id;

  ELSIF p_new_status = 'cancelled' THEN
    UPDATE orders
    SET status        = 'cancelled',
        cancelled_at  = now(),
        cancelled_by  = v_caller_id,
        cancel_reason = 'Admin action'
    WHERE id = p_order_id;

  ELSE
    UPDATE orders SET status = p_new_status WHERE id = p_order_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_update_order_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_order_status(uuid, text) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. RLS admin-bypass SELECT policies
--
-- These policies EXTEND existing user-scoped policies. Supabase ORs all
-- permissive policies, so adding one here does not remove existing user access.
-- Each policy reads is_admin from profiles (DB), not from JWT claims.
--
-- NOTE: These only take effect on tables that already have RLS enabled.
--       If a table has no RLS, adding a policy has no effect on its reads.
--       If enabling RLS on orders/reports/conversations for the first time,
--       you must also confirm existing user-access policies are in place first.
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a. listings — admin reads all statuses (pending, removed, etc.)
--     (Future-work item noted in migration 20260504000001.)
DROP POLICY IF EXISTS "listings_select_admin_bypass" ON listings;

CREATE POLICY "listings_select_admin_bypass"
  ON listings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 5b. orders — admin reads all orders
DROP POLICY IF EXISTS "orders_select_admin_bypass" ON orders;

CREATE POLICY "orders_select_admin_bypass"
  ON orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

-- 5c. reports — admin reads all reports
--     Guarded: reports table may not exist yet. The DO block checks pg_tables
--     before touching the table so the migration succeeds either way.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'reports'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "reports_select_admin_bypass" ON reports';
    EXECUTE $pol$
      CREATE POLICY "reports_select_admin_bypass"
        ON reports FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.is_admin = true
          )
        )
    $pol$;
  ELSE
    RAISE NOTICE 'reports table not found — skipping reports_select_admin_bypass policy';
  END IF;
END $$;

-- 5d. conversations — admin counts all conversations (used in Overview stats)
DROP POLICY IF EXISTS "conversations_select_admin_bypass" ON conversations;

CREATE POLICY "conversations_select_admin_bypass"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. VERIFY — run after applying
-- ══════════════════════════════════════════════════════════════════════════════

-- 6a. Confirm RPCs exist with correct signatures.
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN (
  'admin_verify_user',
  'admin_remove_listing',
  'admin_dismiss_report',
  'admin_update_order_status'
);
-- Expected: 4 rows

-- 6b. Confirm admin bypass policies exist.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE policyname LIKE '%admin_bypass%'
ORDER BY tablename;
-- Expected: 3 rows minimum (listings, orders, conversations)
--           4 rows if reports table exists

-- 6c. Smoke test (run as a non-admin authenticated user):
--     SELECT admin_verify_user('<any-uuid>', true);
--     Expected: ERROR — "Admin access required" (ERRCODE 42501)
