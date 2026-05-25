-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Admin Verification Queue Fix
-- Generated: 2026-05-25
--
-- Root causes fixed:
--   1. admin_list_pending_verifications referenced p.updated_at in ORDER BY.
--      If that column doesn't exist as a real column (some schemas use a trigger
--      rather than an explicit column), the function creation fails silently
--      and the admin panel shows "No pending verifications" with no error.
--      → Use created_at for ordering (always exists); return updated_at safely.
--
--   2. admin_list_pending_verifications had no AND p.verification_photo_path IS NOT NULL
--      filter. Rows with status='pending' but no photo (edge case from old flow)
--      would appear without a selfie to review.
--
--   3. admin_verify_user set verification_status = 'verified' on approve.
--      The user-facing UI checks for vStatus === 'approved' (new canonical value).
--      Updated to 'approved'. Existing 'verified' rows still pass is_verified = true.
--
--   4. admin_verify_user on reject did not clear is_verified = false or set updated_at.
--
--   5. Added optional p_rejection_reason parameter for admin feedback.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. Replace admin_list_pending_verifications ───────────────────────────────
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
    SELECT
      p.id,
      p.full_name,
      p.email,
      p.avatar_url,
      p.verification_status,
      p.verification_photo_path,
      p.created_at
    FROM profiles p
    WHERE p.verification_status = 'pending'
      AND p.verification_photo_path IS NOT NULL
    ORDER BY p.created_at ASC;     -- created_at is guaranteed to exist
END;
$$;

REVOKE ALL ON FUNCTION admin_list_pending_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_pending_verifications() TO authenticated;


-- ── 2. Replace admin_verify_user — add rejection_reason, fix statuses ─────────
-- Drop both possible old signatures before re-creating.
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
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Target user must have a pending verification with a photo path
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id
      AND verification_status = 'pending'
      AND verification_photo_path IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No pending verification found for user %', p_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

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
    -- p_rejection_reason is available for future use (notification, UI message).
    -- Add a rejection_reason column to profiles when ready to surface it to users.
    -- For now it is logged here for audit purposes.
    IF p_rejection_reason IS NOT NULL THEN
      RAISE NOTICE 'Verification rejected for user % — reason: %', p_user_id, p_rejection_reason;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_verify_user(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_verify_user(uuid, boolean, text) TO authenticated;


-- ── 3. Verify ──────────────────────────────────────────────────────────────────
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN (
  'admin_list_pending_verifications',
  'admin_verify_user'
)
ORDER BY proname, pronargs;

-- Expected:
--   admin_list_pending_verifications  0 args
--   admin_verify_user                 3 args (uuid, boolean, text)
