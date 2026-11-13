-- Rollback of 20261113170000: restores the original public SELECT policy (anyone may list the bucket's object names).
DROP POLICY IF EXISTS "listings_storage_select_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "listings_storage_select_public" ON storage.objects;
CREATE POLICY "listings_storage_select_public" ON storage.objects FOR SELECT TO public USING (bucket_id = 'listings');
