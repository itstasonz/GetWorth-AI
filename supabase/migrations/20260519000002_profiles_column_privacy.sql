-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Profiles Column-Level Privacy
-- Generated: 2026-05-19
--
-- Revokes SELECT on up to 7 private columns from anon and authenticated roles.
-- Each column is checked for existence before revoking — missing columns are
-- skipped with NOTICE so the migration is safe to run on any schema state.
-- Public FK joins are unaffected (all use explicit safe column lists).
-- Own-user reads and admin reads use SECURITY DEFINER RPCs instead.
--
-- Columns revoked from anon + authenticated:
--   email, is_admin, trust_score,
--   verification_photo_path, verification_photo_url,
--   verified_at, verification_status
--
-- NOT revoked (intentional):
--   seller_badge — schema ambiguity with badge; revisit separately
--
-- VERIFY existing column grants before applying:
--   SELECT grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_name = 'profiles'
--   ORDER BY column_name, grantee;
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Column-level REVOKE — private fields
--    Guarded: each column is checked in information_schema.columns before
--    revoking. Columns that don't exist yet are skipped with a NOTICE so the
--    migration succeeds regardless of schema drift.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_cols text[] := ARRAY[
    'email',
    'is_admin',
    'trust_score',
    'verification_photo_path',
    'verification_photo_url',
    'verified_at',
    'verification_status'
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
      EXECUTE format('REVOKE SELECT (%I) ON profiles FROM anon, authenticated', v_col);
      RAISE NOTICE 'Revoked SELECT on profiles.%', v_col;
    ELSE
      RAISE NOTICE 'profiles.% does not exist — skipping revoke', v_col;
    END IF;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: get_own_profile
--    Returns all columns for the calling user's own row.
--    Replaces select('*').eq('id', user.id) in AppContext (3 call sites).
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_own_profile();

CREATE OR REPLACE FUNCTION get_own_profile()
RETURNS SETOF profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT * FROM profiles WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION get_own_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_own_profile() TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: admin_list_users
--    Returns full user list including private fields — for AdminPanel only.
--    Replaces direct profiles.select(...) in AdminPanel.loadAllUsers.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_list_users();

CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE (
  id            uuid,
  full_name     text,
  email         text,
  avatar_url    text,
  is_verified   boolean,
  is_admin      boolean,
  rating        numeric,
  review_count  integer,
  total_sales   integer,
  badge         text,
  created_at    timestamptz
)
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

  RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.avatar_url,
           p.is_verified, p.is_admin, p.rating,
           p.review_count, p.total_sales, p.badge, p.created_at
    FROM profiles p
    ORDER BY p.created_at DESC
    LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_users() TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RPC: admin_list_pending_verifications
--    Returns verification queue including photo paths and email — admin only.
--    Replaces direct profiles.select(...) in AdminPanel.loadVerifications.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_list_pending_verifications();

CREATE OR REPLACE FUNCTION admin_list_pending_verifications()
RETURNS TABLE (
  id                      uuid,
  full_name               text,
  email                   text,
  avatar_url              text,
  verification_status     text,
  verification_photo_path text,
  created_at              timestamptz
)
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

  RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.avatar_url,
           p.verification_status, p.verification_photo_path, p.created_at
    FROM profiles p
    WHERE p.verification_status = 'pending'
    ORDER BY p.updated_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_pending_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_pending_verifications() TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. VERIFY — run after applying
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a. Confirm revoked columns show no anon/authenticated grants
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_name = 'profiles'
  AND column_name IN (
    'email', 'is_admin', 'trust_score',
    'verification_photo_path', 'verification_photo_url',
    'verified_at', 'verification_status'
  )
ORDER BY column_name, grantee;
-- Expected: NO rows for anon or authenticated on these 7 columns.
-- seller_badge should still appear with SELECT grant for authenticated/anon.

-- 5b. Confirm 3 RPCs exist
SELECT proname FROM pg_proc
WHERE proname IN (
  'get_own_profile',
  'admin_list_users',
  'admin_list_pending_verifications'
);
-- Expected: 3 rows

-- 5c. Smoke test — confirm private column is blocked for normal user:
--   supabase.from('profiles').select('email')
-- Expected: error 42501 (permission denied for column email)

-- 5d. Confirm public columns still work:
--   supabase.from('profiles').select('id, full_name, avatar_url, is_verified, rating')
-- Expected: returns rows normally

-- 5e. Confirm FK joins still work (no change needed — they use explicit safe columns):
--   supabase.from('listings').select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified)')
-- Expected: returns listing rows with seller sub-object populated
