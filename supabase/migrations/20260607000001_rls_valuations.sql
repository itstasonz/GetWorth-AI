-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: RLS for the valuations table
--
-- The valuations table stores per-user AI scan history (photos, price estimates,
-- item data). Without RLS any authenticated caller could read or write any row
-- via the Supabase REST API — bypassing the client-side user_id filters in
-- AppContext.jsx.
--
-- Policies:
--   SELECT — own rows only
--   INSERT — own rows only (user_id must match the calling JWT)
--   UPDATE — own rows only (user_id is immutable via WITH CHECK)
--   DELETE — own rows only
--
-- No policy is needed for the anon role because valuations are always tied to
-- an authenticated user; the anon key has no business touching this table.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE valuations ENABLE ROW LEVEL SECURITY;

-- ── SELECT ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "valuations_select_own" ON valuations;

CREATE POLICY "valuations_select_own"
  ON valuations
  FOR SELECT
  USING (user_id = auth.uid());

-- ── INSERT ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "valuations_insert_own" ON valuations;

CREATE POLICY "valuations_insert_own"
  ON valuations
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── UPDATE ────────────────────────────────────────────────────────────────────
-- USING  — caller must own the existing row
-- WITH CHECK — user_id cannot be changed to another user's id
DROP POLICY IF EXISTS "valuations_update_own" ON valuations;

CREATE POLICY "valuations_update_own"
  ON valuations
  FOR UPDATE
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── DELETE ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "valuations_delete_own" ON valuations;

CREATE POLICY "valuations_delete_own"
  ON valuations
  FOR DELETE
  USING (user_id = auth.uid());


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Expected: 4 rows (select_own, insert_own, update_own, delete_own)
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'valuations'
ORDER BY cmd;
