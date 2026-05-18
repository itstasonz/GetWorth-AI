-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Verification Photos Privacy
-- Generated: 2026-05-18
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Adds verification_photo_path to profiles so clients store a storage path
-- rather than a public URL. verification_photo_url is kept as a nullable
-- legacy column — do not drop it until all existing rows are migrated.
--
-- After applying this SQL you MUST also make the storage bucket private:
--   Supabase Dashboard → Storage → verification-photos → Settings → Public = OFF
-- ══════════════════════════════════════════════════════════════════════════════


-- 1. Add the path column (idempotent via IF NOT EXISTS).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verification_photo_path text;


-- 2. Backfill: for any existing row that already has verification_photo_url
--    but no path, extract the path from the URL so those requests remain
--    visible in AdminPanel without re-submission.
--
--    Expected URL shape:
--      https://<project>.supabase.co/storage/v1/object/public/verification-photos/<user-id>/selfie.jpg
--
--    We extract everything after '/verification-photos/' as the path.
--    Safe to run multiple times — only updates rows where path is still NULL
--    and url is set.
UPDATE profiles
SET verification_photo_path = substring(
      verification_photo_url
      FROM '/verification-photos/(.+)$'
    )
WHERE verification_photo_path IS NULL
  AND verification_photo_url IS NOT NULL
  AND verification_photo_url LIKE '%/verification-photos/%';


-- 3. Verify result.
SELECT
  id,
  verification_status,
  verification_photo_path IS NOT NULL AS has_path,
  verification_photo_url  IS NOT NULL AS has_legacy_url
FROM profiles
WHERE verification_status IS NOT NULL
ORDER BY updated_at DESC
LIMIT 20;
