-- ══════════════════════════════════════════════════════════════════════════════
-- THE LISTINGS PHOTO BUCKET (2026-11-13). ADDITIVE.
--
-- 20260519000007 wrote the policies for a PUBLIC `listings` bucket (folder-scoped writes, public reads), and the app
-- (AppContext publishListing, FRONTEND-008) uploads every listing photo there and refuses to publish without one — but
-- the bucket itself was never created in Production. Every publish since then failed with "image upload failed"
-- (Production E2E 2026-11-13); the 45 existing listings still carry base64 photos in their rows and are untouched.
-- Limits match the client's own check (≤5 MB, JPEG/PNG/WebP). Existing policies apply unchanged.
-- Rollback: supabase/manual/20261113150000_rollback_listings_storage_bucket.sql (only while the bucket is empty).
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listings', 'listings', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
