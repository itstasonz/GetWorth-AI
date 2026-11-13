-- ══════════════════════════════════════════════════════════════════════════════
-- LISTING PHOTOS: VIEWABLE BY URL, NOT ENUMERABLE (2026-11-13)
--
-- The `listings` bucket is PUBLIC: a photo is served at /storage/v1/object/public/listings/<path> with no RLS check at all.
-- The SELECT policy "listings_storage_select_public" (role public) is therefore not what shows photos; what it does do is
-- let ANYONE call the list endpoint and enumerate every object name — each one under its owner's user-id folder.
--
-- Change: that policy is replaced by SELECT for an authenticated user on their OWN folder only. Owners still need SELECT
-- on their own objects for remove() and upsert (AppContext deleteListing / publish cleanup). Public URLs are unaffected.
-- INSERT / UPDATE / DELETE policies (own folder, authenticated) are unchanged. No object is changed or deleted.
-- Rollback: supabase/manual/20261113170000_rollback_listings_storage_no_enumeration.sql
-- ══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "listings_storage_select_public" ON storage.objects;
DROP POLICY IF EXISTS "listings_storage_select_own_folder" ON storage.objects;
CREATE POLICY "listings_storage_select_own_folder"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'listings' AND (storage.foldername(name))[1] = (auth.uid())::text);
