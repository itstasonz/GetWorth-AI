-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — admin_list_pending_verifications: final definition
-- Generated: 2026-05-25
--
-- Supersedes 20260525000003 and 20260525000004.
--
-- Columns returned (matches profiles schema; both created_at and updated_at exist):
--   id, full_name, email, avatar_url, is_verified,
--   verification_status, verification_photo_path, created_at, updated_at
--
-- ORDER BY updated_at DESC — newest submission first.
--
-- PostgreSQL requires DROP + CREATE when RETURNS TABLE signature changes.
-- ══════════════════════════════════════════════════════════════════════════════

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
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM profiles
  WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

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
    FROM profiles p
    WHERE p.verification_status   = 'pending'
      AND p.verification_photo_path IS NOT NULL
    ORDER BY p.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_pending_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_pending_verifications() TO authenticated;

-- Verify
SELECT proname, pronargs FROM pg_proc WHERE proname = 'admin_list_pending_verifications';
-- Expected: 1 row, pronargs = 0
