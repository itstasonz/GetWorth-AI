-- ══════════════════════════════════════════════════════════════════════════════
-- SCAN LAB — DATABASE CLEANUP (PREPARED, NOT APPLIED)
--
-- Scan Lab was removed from the application. Nothing in the code reads or
-- writes these objects any more:
--
--   storage bucket   scan-lab                        (private)
--   storage policy   scan_lab_objects_server_only    (RESTRICTIVE, on storage.objects)
--   table            public.scan_lab_items
--   table policy     scan_lab_items_server_only
--
-- This file lives OUTSIDE supabase/migrations on purpose: it is destructive,
-- and nothing may apply it automatically. Run it by hand in the Supabase SQL
-- editor, one step at a time, when you have decided the captured data is not
-- wanted.
--
-- Leaving these objects in place is harmless: the bucket is private, the table
-- refuses every browser role, and the restrictive policy only ever REMOVED
-- access to the 'scan-lab' bucket.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── STEP 1 — LOOK FIRST (read-only) ──────────────────────────────────────────
select count(*) as scan_lab_rows from public.scan_lab_items;
select count(*) as scan_lab_objects, coalesce(sum((metadata->>'size')::bigint), 0) as bytes
  from storage.objects where bucket_id = 'scan-lab';
-- If either number is not 0 and the photographs matter, export them before going on.


-- ── STEP 2 — EMPTY AND DELETE THE BUCKET (dashboard, not SQL) ────────────────
-- Supabase refuses direct deletes from storage tables. In the dashboard:
--   Storage → scan-lab → select all → Delete, then Storage → scan-lab → Delete bucket.


-- ── STEP 3 — DROP THE TABLE AND THE TWO POLICIES ─────────────────────────────
-- Only after step 2. Touches no other table, bucket or policy.
begin;
  drop policy if exists "scan_lab_objects_server_only" on storage.objects;
  drop table if exists public.scan_lab_items;   -- its own policy goes with it
commit;


-- ── STEP 4 — CONFIRM (read-only) ─────────────────────────────────────────────
select
  (select count(*) from storage.buckets where id = 'scan-lab')                           as bucket_left,
  (select count(*) from pg_policies where policyname like 'scan_lab_%')                   as policies_left,
  (select count(*) from pg_class where oid = to_regclass('public.scan_lab_items'))       as table_left;
-- EXPECTED: 0 · 0 · 0
