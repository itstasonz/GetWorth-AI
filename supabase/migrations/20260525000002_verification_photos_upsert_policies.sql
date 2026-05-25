-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — verification-photos: fix upsert by adding DELETE policy
-- Generated: 2026-05-25
--
-- Root cause:
--   Supabase Storage with upsert:true re-uploads an existing object via an
--   internal DELETE → INSERT sequence (not SQL ON CONFLICT).  Without a DELETE
--   policy the DELETE step fails with 403 ("new row violates row-level security
--   policy" surfaces on the subsequent INSERT attempt).
--
-- Previously present (migration 20260519000007):
--   verification_photos_insert_own_folder  INSERT
--   verification_photos_update_own_folder  UPDATE (USING + WITH CHECK)
--
-- Missing until this migration:
--   verification_photos_delete_own_folder  DELETE (USING)
--
-- No SELECT policy is added — signed URLs are generated server-side via the
-- admin-get-verification-url Edge Function using the service role key, which
-- bypasses storage RLS entirely.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. Drop all known verification-photos policy names (idempotent) ──────────
DROP POLICY IF EXISTS "verification_photos_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_update_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_delete_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own verification photo"   ON storage.objects;
DROP POLICY IF EXISTS "Admins can read verification photos"   ON storage.objects;
DROP POLICY IF EXISTS "Public read verification photos"       ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_select_admin"      ON storage.objects;


-- ── 2. INSERT — first-time upload into own folder ────────────────────────────
CREATE POLICY "verification_photos_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ── 3. UPDATE — overwrite own file (ON CONFLICT path, if used) ───────────────
CREATE POLICY "verification_photos_update_own_folder"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'verification-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'verification-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ── 4. DELETE — required for upsert re-uploads (Storage DELETE → INSERT) ─────
--   Storage upsert (x-upsert: true) deletes the existing object then inserts
--   the new one.  Without this policy the DELETE step fails with 403.
CREATE POLICY "verification_photos_delete_own_folder"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'verification-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ── 5. NO SELECT POLICY ───────────────────────────────────────────────────────
--   Signed URLs are generated server-side via the admin-get-verification-url
--   Edge Function using the service role key, which bypasses storage RLS.
--   No SELECT policy means no client can read any file in this bucket directly.


-- ── 6. Verify ─────────────────────────────────────────────────────────────────
SELECT policyname, cmd
FROM pg_policies
WHERE tablename  = 'objects'
  AND schemaname = 'storage'
  AND policyname LIKE 'verification_photos_%'
ORDER BY cmd, policyname;

-- Expected 3 rows (no SELECT row):
--   verification_photos_delete_own_folder  DELETE
--   verification_photos_insert_own_folder  INSERT
--   verification_photos_update_own_folder  UPDATE
