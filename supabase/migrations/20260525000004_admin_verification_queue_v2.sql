-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Admin Verification Queue Fix v2
-- Generated: 2026-05-25
--
-- Supersedes migration 20260525000003 (apply this one only, or apply both — idempotent).
--
-- Root causes addressed:
--
--   A. admin_list_pending_verifications — ORDER BY p.updated_at ASC
--      PL/pgSQL does not validate column names at CREATE time.
--      The column reference only resolves at call time. If profiles.updated_at
--      does not exist the function fails with:
--        "column profiles.updated_at does not exist"
--      → Safe fix: ORDER BY p.created_at ASC (always present).
--      → Also adds AND p.verification_photo_path IS NOT NULL filter.
--      → Returns is_verified so AdminPanel can show badge state.
--      → Does NOT include updated_at in RETURNS TABLE — that column is
--        optional on profiles; trigger-managed schemas set it automatically.
--        AdminPanel does not display it, so omitting it is safe.
--
--   B. admin_verify_user(uuid, boolean) — old 2-arg signature
--      Frontend now sends p_rejection_reason as a named arg.
--      Postgres matches by signature: calling with an unknown named param
--      raises "function does not exist".
--      → New 3-arg function (uuid, boolean, text DEFAULT NULL).
--      → p_rejection_reason is accepted but NOT written to profiles
--        (no rejection_reason column exists yet).
--      → Approve sets: verification_status='approved', is_verified=true,
--        verified_at=now().
--      → Reject sets:  verification_status='rejected', is_verified=false,
--        verified_at=NULL.
--      → updated_at is intentionally omitted from the SET clause.
--        If a moddatetime / trigger manages it, it fires automatically.
--        If the column does not exist, the UPDATE still succeeds.
--
--   C. Pending-check guard in admin_verify_user
--      Validates the target user actually has status='pending' + a photo path
--      before committing the approve/reject, preventing accidental double-
--      processing.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. admin_list_pending_verifications ──────────────────────────────────────
-- Drop ALL signatures (the old 0-arg and any variant from 20260525000003).
DROP FUNCTION IF EXISTS admin_list_pending_verifications();

CREATE OR REPLACE FUNCTION admin_list_pending_verifications()
RETURNS TABLE (
  id                      uuid,
  full_name               text,
  email                   text,
  avatar_url              text,
  is_verified             boolean,
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
  -- ① Require an authenticated caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ② Verify is_admin from the DB row — never trust JWT claims
  SELECT is_admin INTO v_is_admin
  FROM profiles
  WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ③ Return pending-verification rows
  --    ORDER BY created_at — always present; avoids the updated_at column-existence risk.
  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      p.email,
      p.avatar_url,
      p.is_verified,
      p.verification_status,
      p.verification_photo_path,
      p.created_at
    FROM profiles p
    WHERE p.verification_status   = 'pending'
      AND p.verification_photo_path IS NOT NULL
    ORDER BY p.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_pending_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_pending_verifications() TO authenticated;


-- ── 2. admin_verify_user ─────────────────────────────────────────────────────
-- Drop all previously known signatures before re-creating.
DROP FUNCTION IF EXISTS admin_verify_user(uuid, boolean);
DROP FUNCTION IF EXISTS admin_verify_user(uuid, boolean, text);

CREATE OR REPLACE FUNCTION admin_verify_user(
  p_user_id          uuid,
  p_approve          boolean,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
BEGIN
  -- ① Require an authenticated caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ② Verify is_admin from the DB row
  SELECT is_admin INTO v_is_admin
  FROM profiles
  WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ③ Guard: target user must have a pending verification with a photo
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id                    = p_user_id
      AND verification_status   = 'pending'
      AND verification_photo_path IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No pending verification found for user %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ④ Approve or reject
  IF p_approve THEN
    UPDATE profiles
    SET
      verification_status = 'approved',
      is_verified         = true,
      verified_at         = now()
    WHERE id = p_user_id;

  ELSE
    UPDATE profiles
    SET
      verification_status = 'rejected',
      is_verified         = false,
      verified_at         = NULL
    WHERE id = p_user_id;

    -- p_rejection_reason: logged for audit; no rejection_reason column exists yet.
    IF p_rejection_reason IS NOT NULL THEN
      RAISE NOTICE 'Verification rejected for user % — reason: %',
                   p_user_id, p_rejection_reason;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_verify_user(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_verify_user(uuid, boolean, text) TO authenticated;


-- ── 3. Verify ──────────────────────────────────────────────────────────────────
SELECT proname, pronargs, proargtypes::text
FROM pg_proc
WHERE proname IN (
  'admin_list_pending_verifications',
  'admin_verify_user'
)
ORDER BY proname, pronargs;

-- Expected:
--   admin_list_pending_verifications  0 args
--   admin_verify_user                 3 args (uuid, boolean, text)
