-- Rollback of 20261113150000: removes the listings bucket ONLY if it holds no objects (published listings reference them).
DELETE FROM storage.buckets b WHERE b.id = 'listings' AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'listings');
