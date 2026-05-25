-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix orders page 42501: permission denied for table profiles
-- Migration: 20260525000008
-- Generated: 2026-05-25
--
-- Root cause (two-layer):
--
--   A. Primary orders query uses FK hints orders_buyer_profile_fkey /
--      orders_seller_profile_fkey.  These names do not match the actual DB
--      constraint names (Postgres auto-names them orders_buyer_id_fkey /
--      orders_seller_id_fkey).  PostgREST cannot resolve the embed → first
--      query fails → falls back to query without profiles join.
--      Fixed in AppContext.jsx (not in this migration).
--
--   B. The fallback orders query (.select('*, listing:listings(...)')) ALSO
--      fails with 42501 "permission denied for table profiles".
--
--      Why the listing join causes a profiles error:
--
--        Migration 20260519000002 revoked SELECT (is_admin) from authenticated.
--
--        The listings_select_admin_bypass RLS policy (and the same pattern on
--        orders, conversations, reports) evaluates:
--          USING ( EXISTS (
--            SELECT 1 FROM profiles
--            WHERE profiles.id = auth.uid() AND profiles.is_admin = true
--          ))
--
--        When authenticated cannot read profiles.is_admin, this sub-query
--        throws 42501 — and PostgreSQL propagates the exception through the
--        entire parent query, including the listing join.
--
--      Even for "safe" select policies (status IN ('active','sold')), both
--      policies are OR-combined; for rows where the first policy is FALSE
--      (e.g. listing linked to an order has status 'pending' or 'removed'),
--      the admin bypass policy IS evaluated and throws.
--
-- Fix:
--   1. auth_is_admin() — SECURITY DEFINER wrapper.
--      Runs as the table owner (postgres), always has full column access.
--      Called by all admin bypass RLS policies instead of inline sub-queries.
--      authenticated/anon get EXECUTE but never need SELECT (is_admin) directly.
--
--   2. Rebuild all four admin bypass policies to call auth_is_admin().
--
--   3. GRANT SELECT on the public-safe profile columns to authenticated + anon
--      so direct FK joins (buyer/seller names) work for any query path.
--      Private columns (email, is_admin, verification_photo_path, etc.) are
--      intentionally omitted — the column-level revoke from migration 000002
--      remains in effect for those.
--
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. auth_is_admin() ────────────────────────────────────────────────────────
-- SECURITY DEFINER: runs as postgres (owner), not as the calling authenticated
-- role.  This means the function can always read profiles.is_admin regardless
-- of column-level revokes on the authenticated role.
--
-- Stable (not volatile) so the planner can cache the result within a query.

DROP FUNCTION IF EXISTS auth_is_admin();

CREATE FUNCTION auth_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  )
$$;

-- anon needs EXECUTE so anonymous requests don't error when RLS policies fire
REVOKE ALL ON FUNCTION auth_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_is_admin() TO authenticated, anon;


-- ── 2. Rebuild admin bypass policies ─────────────────────────────────────────
-- All four policies previously used:
--   USING ( EXISTS ( SELECT 1 FROM profiles WHERE ... AND profiles.is_admin = true ) )
-- That sub-query runs as the authenticated role and fails when is_admin is revoked.
-- Replace with auth_is_admin() which runs as postgres.

-- 2a. listings
DROP POLICY IF EXISTS "listings_select_admin_bypass" ON listings;
CREATE POLICY "listings_select_admin_bypass"
  ON listings FOR SELECT
  USING (auth_is_admin());

-- 2b. orders
DROP POLICY IF EXISTS "orders_select_admin_bypass" ON orders;
CREATE POLICY "orders_select_admin_bypass"
  ON orders FOR SELECT
  USING (auth_is_admin());

-- 2c. reports (table may not exist — guard)
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
        USING (auth_is_admin())
    $pol$;
  END IF;
END $$;

-- 2d. conversations
DROP POLICY IF EXISTS "conversations_select_admin_bypass" ON conversations;
CREATE POLICY "conversations_select_admin_bypass"
  ON conversations FOR SELECT
  USING (auth_is_admin());


-- ── 3. Grant SELECT on public-safe profile columns ────────────────────────────
-- Ensures direct FK joins from orders (buyer_id → profiles, seller_id → profiles)
-- can read display fields without triggering a 42501 error.
--
-- Private columns (email, is_admin, trust_score, verification_photo_path,
-- verification_photo_url, verified_at, verification_status, phone, location)
-- are intentionally NOT listed — they remain protected by migration 000002.
--
-- Schema-safe: each column is checked in information_schema.columns before
-- granting.  Columns that do not exist are skipped with a NOTICE so this
-- migration succeeds regardless of schema drift.

DO $$
DECLARE
  v_cols text[] := ARRAY[
    'id',
    'full_name',
    'avatar_url',
    'is_verified',
    'rating',
    'review_count',
    'badge',
    'total_sales',
    'reputation_points',
    'response_rate',
    'created_at',
    'updated_at'
  ];
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY v_cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'profiles'
        AND column_name  = v_col
    ) THEN
      EXECUTE format(
        'GRANT SELECT (%I) ON public.profiles TO authenticated, anon',
        v_col
      );
      RAISE NOTICE 'Granted SELECT on profiles.%', v_col;
    ELSE
      RAISE NOTICE 'profiles.% does not exist — skipping grant', v_col;
    END IF;
  END LOOP;
END $$;


-- ── 4. Sanity check ────────────────────────────────────────────────────────────
SELECT proname FROM pg_proc WHERE proname = 'auth_is_admin';
-- Expected: 1 row

SELECT tablename, policyname
FROM pg_policies
WHERE policyname LIKE '%admin_bypass%'
ORDER BY tablename;
-- Expected rows:
--   conversations  conversations_select_admin_bypass
--   listings       listings_select_admin_bypass
--   orders         orders_select_admin_bypass
--   reports        reports_select_admin_bypass  (if reports table exists)
