-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Storage Bucket Policies + Legacy URL Cleanup
-- Generated: 2026-05-19
--
-- Documents and re-applies the final verified storage RLS policies for all
-- three storage buckets.  Idempotent — safe to re-run.
--
-- BUCKET OVERVIEW:
--   listings           — PUBLIC  bucket; folder-scoped write, public read
--   avatars            — PUBLIC  bucket; folder-scoped write, public read
--   verification-photos— PRIVATE bucket; folder-scoped write only; no direct
--                        read (signed URLs generated server-side via Edge Fn)
--
-- Note: PUBLIC/PRIVATE setting cannot be changed via SQL.
--   Set via Supabase Dashboard → Storage → <bucket> → Settings.
--
-- LEGACY COLUMN CLEANUP:
--   profiles.verification_photo_url — superseded by verification_photo_path.
--   Any remaining non-NULL values are nulled here as a safety net.
--   (Production count confirmed = 0 before this migration.)
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — listings bucket
-- ══════════════════════════════════════════════════════════════════════════════

-- 1a. Drop all known policy names
DROP POLICY IF EXISTS "listings_storage_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "listings_storage_update_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "listings_storage_delete_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "listings_storage_select_public"     ON storage.objects;
DROP POLICY IF EXISTS "Listing image upload"               ON storage.objects;
DROP POLICY IF EXISTS "Listing image read"                 ON storage.objects;
DROP POLICY IF EXISTS "Listing image update"               ON storage.objects;
DROP POLICY IF EXISTS "Listing image delete"               ON storage.objects;

-- 1b. INSERT — authenticated users may upload only to their own folder
CREATE POLICY "listings_storage_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 1c. UPDATE — users may overwrite only files in their own folder
CREATE POLICY "listings_storage_update_own_folder"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 1d. DELETE — users may delete only files in their own folder
CREATE POLICY "listings_storage_delete_own_folder"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 1e. SELECT — public read (bucket is PUBLIC)
CREATE POLICY "listings_storage_select_public"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'listings');


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — avatars bucket
-- ══════════════════════════════════════════════════════════════════════════════

-- 2a. Drop all known policy names (includes old generic names)
DROP POLICY IF EXISTS "avatars_storage_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "avatars_storage_update_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "avatars_storage_delete_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "avatars_storage_select_public"     ON storage.objects;
DROP POLICY IF EXISTS "Avatar upload own"                 ON storage.objects;
DROP POLICY IF EXISTS "Avatar read public"                ON storage.objects;
DROP POLICY IF EXISTS "Avatar update own"                 ON storage.objects;
DROP POLICY IF EXISTS "Avatar delete own"                 ON storage.objects;

-- 2b. INSERT — authenticated users may upload only to their own folder
CREATE POLICY "avatars_storage_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2c. UPDATE — users may overwrite only files in their own folder
CREATE POLICY "avatars_storage_update_own_folder"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2d. DELETE — users may delete only files in their own folder
CREATE POLICY "avatars_storage_delete_own_folder"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2e. SELECT — public read (bucket is PUBLIC)
CREATE POLICY "avatars_storage_select_public"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — verification-photos bucket
--
-- Originally applied in 20260518000003_verification_photos_bucket_policy.sql.
-- Re-stated here for completeness; DROP IF EXISTS makes it idempotent.
-- ══════════════════════════════════════════════════════════════════════════════

-- 3a. Drop all known policy names
DROP POLICY IF EXISTS "verification_photos_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_update_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own verification photo"   ON storage.objects;
DROP POLICY IF EXISTS "Admins can read verification photos"  ON storage.objects;
DROP POLICY IF EXISTS "Public read verification photos"      ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_select_admin"     ON storage.objects;

-- 3b. INSERT — authenticated users may upload only to their own folder
CREATE POLICY "verification_photos_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3c. UPDATE — users may replace only their own file
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

-- 3d. NO SELECT POLICY.
--     Signed URLs are generated server-side via the admin-get-verification-url
--     Edge Function using the service role key, which bypasses storage RLS.


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — Legacy URL column cleanup
--
-- profiles.verification_photo_url is superseded by verification_photo_path.
-- NULL out any surviving non-NULL values as a safety net.
-- (Production row count was confirmed = 0 before this migration.)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'verification_photo_url'
  ) THEN
    UPDATE profiles
    SET verification_photo_url = NULL
    WHERE verification_photo_url IS NOT NULL;

    RAISE NOTICE 'Nulled out % verification_photo_url rows',
      (SELECT COUNT(*) FROM profiles WHERE verification_photo_url IS NOT NULL);
  ELSE
    RAISE NOTICE 'profiles.verification_photo_url does not exist — skipping cleanup';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5 — Verify
-- ══════════════════════════════════════════════════════════════════════════════

SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename  = 'objects'
  AND schemaname = 'storage'
  AND policyname LIKE ANY (ARRAY[
    'listings_storage_%',
    'avatars_storage_%',
    'verification_photos_%'
  ])
ORDER BY policyname, cmd;

-- Expected 10 rows:
--   avatars_storage_delete_own_folder         (DELETE)
--   avatars_storage_insert_own_folder         (INSERT)
--   avatars_storage_select_public             (SELECT)
--   avatars_storage_update_own_folder         (UPDATE)
--   listings_storage_delete_own_folder        (DELETE)
--   listings_storage_insert_own_folder        (INSERT)
--   listings_storage_select_public            (SELECT)
--   listings_storage_update_own_folder        (UPDATE)
--   verification_photos_insert_own_folder     (INSERT)
--   verification_photos_update_own_folder     (UPDATE)
