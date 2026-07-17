-- ══════════════════════════════════════════════════════════════════════════════
-- FRONTEND-009 — saved_items: fix 42501 "permission denied for table profiles".
-- Idempotent — safe to re-run. Requires auth_is_admin() from 20260525000008.
--
-- Production evidence (2026-07-17, live REST as a regular authenticated user):
--   INSERT saved_items → 201
--   SELECT saved_items → 403 permission denied for table profiles
--   DELETE saved_items → 403 permission denied for table profiles
-- Net effect for every user: hearting an item persists a row, but saved items
-- NEVER load back after a reload (Saved view shows a false empty state) and
-- un-hearting silently fails, leaving the row forever.
--
-- Root cause: same as the orders fix in 20260525000008 — saved_items was
-- created via the dashboard with RLS policies that inline
--   EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)
-- After 20260519000002 revoked SELECT (is_admin) from authenticated, that
-- sub-query throws 42501 and poisons the whole statement. 20260525000008
-- rebuilt the policies for orders/listings/conversations/reports but did not
-- know about saved_items (no migration history for the table).
--
-- Fix: drop every saved_items policy that references profiles and rebuild the
-- canonical own-rows policies, with admin bypass via auth_is_admin().
--
-- Rollback: re-create the previous dashboard policies (they are captured in
-- the pg_policies output logged by the DO block below at apply time).
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'saved_items'
  LOOP
    -- evidence trail for rollback
    RAISE LOG 'saved_items policy before rebuild: name=% cmd=% qual=% with_check=%',
      pol.policyname, pol.cmd, pol.qual, pol.with_check;
    IF pol.qual ILIKE '%profiles%' OR pol.with_check ILIKE '%profiles%' THEN
      EXECUTE format('DROP POLICY %I ON public.saved_items', pol.policyname);
    END IF;
  END LOOP;
END $$;

-- Canonical policies (drop-first for idempotency)
DROP POLICY IF EXISTS "saved_items_select_own" ON public.saved_items;
CREATE POLICY "saved_items_select_own"
  ON public.saved_items FOR SELECT
  USING (user_id = auth.uid() OR auth_is_admin());

DROP POLICY IF EXISTS "saved_items_insert_own" ON public.saved_items;
CREATE POLICY "saved_items_insert_own"
  ON public.saved_items FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "saved_items_delete_own" ON public.saved_items;
CREATE POLICY "saved_items_delete_own"
  ON public.saved_items FOR DELETE
  USING (user_id = auth.uid() OR auth_is_admin());

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'saved_items';
--   → saved_items_select_own / saved_items_insert_own / saved_items_delete_own
--     (+ any pre-existing non-profiles policies, logged above)
-- As a regular user: SELECT and DELETE own rows must return 200, not 403.
