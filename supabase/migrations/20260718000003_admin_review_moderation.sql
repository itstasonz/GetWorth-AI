-- ══════════════════════════════════════════════════════════════════════════════
-- ADMIN-001 — admin review moderation RPC.
-- Idempotent — safe to re-run. Apply AFTER 20260718000002_reviews_integrity
-- (its trg_reviews_recompute_rating DELETE trigger heals the reviewed user's
-- rating/review_count automatically when a review is removed).
--
-- Why: the reviews RLS hardening (20260519000006) removed all UPDATE/DELETE
-- paths and documented "use the admin_delete_review RPC" — but that RPC was
-- never created. Admins had no way to remove an abusive review.
--
-- Product policy note: hard delete matches the documented intent above. The
-- RAISE LOG line preserves a structured evidence trail (admin, review,
-- reviewed user, rating, comment, reason) in the Postgres logs until a
-- dedicated admin_actions audit table exists (see ADMIN-001 C8 decision).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_delete_review(p_review_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
  v_review    reviews%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_review FROM reviews WHERE id = p_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found' USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM reviews WHERE id = p_review_id;
  -- trg_reviews_recompute_rating (AFTER DELETE) recomputes the reviewed
  -- user's profiles.rating / review_count from the remaining rows.

  RAISE LOG 'admin_delete_review: admin=% review=% reviewed_user=% reviewer=% rating=% reason=% comment=%',
    v_caller_id, p_review_id, v_review.seller_id, v_review.reviewer_id,
    v_review.rating, COALESCE(p_reason, '(none)'), COALESCE(v_review.comment, '');

  RETURN jsonb_build_object(
    'ok', true,
    'id', p_review_id,
    'reviewed_user', v_review.seller_id
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_delete_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_delete_review(uuid, text) TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'admin_delete_review';  → 1 row
-- Non-admin call must raise 'Admin access required'.
