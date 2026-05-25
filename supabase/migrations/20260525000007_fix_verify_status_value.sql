-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix admin_verify_user: 'approved' → 'verified'
-- Migration: 20260525000007
-- Generated: 2026-05-25
--
-- Root cause (error 23514 — check constraint violation):
--
--   admin_verify_user wrote verification_status = 'approved' on approval.
--   The profiles table check constraint profiles_verification_status_check
--   does NOT include 'approved' as an allowed value.
--   Allowed values are: 'pending', 'verified', 'rejected' (and NULL / 'unverified').
--
-- Fix:
--   Approve path writes verification_status = 'verified' (the correct DB value).
--
-- No frontend changes needed:
--   AuthProfileView already accepts both 'verified' and 'approved':
--     isVerified = ['verified', 'approved'].includes(vStatus) || profile?.is_verified
--     {(vStatus === 'verified' || vStatus === 'approved') && ...}
--   AdminPanel checks is_verified boolean, not the status string.
--
-- This migration patches only admin_verify_user.
-- admin_list_pending_verifications from 20260525000006 is correct as-is.
--
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════

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
    WHERE p.id                      = p_user_id
      AND p.verification_status     = 'pending'
      AND p.verification_photo_path IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No pending verification found for user %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ④ Approve or reject
  --    Approve writes 'verified' — the value allowed by profiles_verification_status_check.
  --    Do NOT use 'approved'; that value is not in the DB constraint.
  IF p_approve THEN
    UPDATE public.profiles AS p
    SET
      verification_status = 'verified',
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


-- ── Sanity check ─────────────────────────────────────────────────────────────
SELECT proname, pronargs
FROM pg_proc
WHERE proname = 'admin_verify_user'
ORDER BY pronargs;
-- Expected: 1 row — admin_verify_user, 3 args
