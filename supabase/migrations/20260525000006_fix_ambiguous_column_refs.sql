-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix ambiguous column references in admin RPCs
-- Migration: 20260525000006
-- Generated: 2026-05-25
--
-- Root cause (error 42702 — "column reference is ambiguous"):
--
--   RETURNS TABLE defines output columns as implicit PL/pgSQL variables.
--   Any unqualified bare column reference inside the function body is
--   ambiguous between the output variable and the actual table column.
--
--   Concretely, in admin_list_pending_verifications():
--     RETURNS TABLE (id uuid, ...)
--     ...
--     SELECT is_admin INTO v_is_admin
--     FROM profiles
--     WHERE id = v_caller_id;   ← "id" == output variable OR profiles.id?
--     PostgreSQL raises 42702 at call time.
--
-- Fix: fully qualify every column reference with the table alias "p."
--
-- This migration supersedes 20260525000005.
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. admin_list_pending_verifications ──────────────────────────────────────

DROP FUNCTION IF EXISTS admin_list_pending_verifications();

CREATE FUNCTION admin_list_pending_verifications()
RETURNS TABLE (
  id                      uuid,
  full_name               text,
  email                   text,
  avatar_url              text,
  is_verified             boolean,
  verification_status     text,
  verification_photo_path text,
  created_at              timestamptz,
  updated_at              timestamptz
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

  -- ② Verify is_admin from the DB row — never trust JWT claims.
  --    Use explicit alias "p" so "p.id" is unambiguous against the
  --    RETURNS TABLE output variable also named "id".
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles AS p
  WHERE p.id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ③ Return pending-verification rows, newest submission first.
  --    Every column reference uses the "p." alias — no bare names.
  RETURN QUERY
    SELECT
      p.id,
      p.full_name,
      p.email,
      p.avatar_url,
      p.is_verified,
      p.verification_status,
      p.verification_photo_path,
      p.created_at,
      p.updated_at
    FROM public.profiles AS p
    WHERE p.verification_status    = 'pending'
      AND p.verification_photo_path IS NOT NULL
    ORDER BY p.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_pending_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_pending_verifications() TO authenticated;


-- ── 2. admin_verify_user ─────────────────────────────────────────────────────
-- Returns void so there are no output-column variables, but qualify everything
-- anyway to prevent the same class of bug from ever surfacing here.

DROP FUNCTION IF EXISTS admin_verify_user(uuid, boolean);
DROP FUNCTION IF EXISTS admin_verify_user(uuid, boolean, text);

CREATE FUNCTION admin_verify_user(
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

  -- ② Verify is_admin from the DB row — fully qualified, no bare column refs
  SELECT p.is_admin INTO v_is_admin
  FROM public.profiles AS p
  WHERE p.id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ③ Guard: target must have a pending verification with a photo
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id                     = p_user_id
      AND p.verification_status    = 'pending'
      AND p.verification_photo_path IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No pending verification found for user %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ④ Approve or reject
  IF p_approve THEN
    UPDATE public.profiles AS p
    SET
      verification_status = 'approved',
      is_verified         = true,
      verified_at         = now()
    WHERE p.id = p_user_id;

  ELSE
    UPDATE public.profiles AS p
    SET
      verification_status = 'rejected',
      is_verified         = false,
      verified_at         = NULL
    WHERE p.id = p_user_id;

    -- Log reason for audit trail (no rejection_reason column yet)
    IF p_rejection_reason IS NOT NULL THEN
      RAISE NOTICE 'Verification rejected for user % — reason: %',
                   p_user_id, p_rejection_reason;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_verify_user(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_verify_user(uuid, boolean, text) TO authenticated;


-- ── 3. Sanity check ──────────────────────────────────────────────────────────
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN (
  'admin_list_pending_verifications',
  'admin_verify_user'
)
ORDER BY proname, pronargs;
-- Expected:
--   admin_list_pending_verifications  |  0
--   admin_verify_user                 |  3
