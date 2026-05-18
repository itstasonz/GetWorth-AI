-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Verification Photos Storage Policies
-- Generated: 2026-05-18
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Target architecture:
--   • verification-photos bucket is PRIVATE (set via Dashboard, not SQL)
--   • Users can upload ONLY into their own folder (<user-id>/selfie.jpg)
--   • NO SELECT policy — signed URLs are generated server-side via Edge Function
--     using the service role key, which bypasses storage RLS entirely
--   • No direct client read access to any file in this bucket
--
-- NOTE: Making the bucket private must be done in the Supabase Dashboard:
--   Storage → verification-photos → Settings → toggle Public OFF
--   SQL cannot change bucket public/private status.
-- ══════════════════════════════════════════════════════════════════════════════


-- 1. Drop any existing policies on this bucket (idempotent).
DROP POLICY IF EXISTS "Users upload own verification photo"     ON storage.objects;
DROP POLICY IF EXISTS "Admins can read verification photos"    ON storage.objects;
DROP POLICY IF EXISTS "Public read verification photos"        ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_insert_own_folder"  ON storage.objects;
DROP POLICY IF EXISTS "verification_photos_select_admin"       ON storage.objects;


-- 2. INSERT — authenticated users may upload only to their own folder.
--    Path must be: <auth.uid()>/selfie.jpg
--    storage.foldername(name) returns an array of path segments;
--    element [1] is the first folder (the user-id prefix).
CREATE POLICY "verification_photos_insert_own_folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- 3. UPDATE — users may replace their own file (upsert: true in the client).
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


-- 4. NO SELECT POLICY.
--    Signed URLs generated via the service role key bypass storage RLS.
--    No SELECT policy means no direct client can read files in this bucket,
--    even with a valid JWT. This is the intended state.


-- 5. Verify: confirm the two policies exist and no SELECT policy is present.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
  AND policyname LIKE 'verification_photos_%'
ORDER BY cmd;
-- Expected: two rows — INSERT and UPDATE — no SELECT row.
