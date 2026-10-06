-- ══════════════════════════════════════════════════════════════════════════════
-- GW-SCAN-LAB-001 — SCAN LAB STORAGE — PRODUCTION VERIFICATION (READ-ONLY)
--
-- Run in the Supabase SQL editor. Every statement here is a SELECT; the two
-- parts that act as a signed-in user do so inside a transaction that ends in
-- ROLLBACK. Nothing is inserted, updated or deleted.
--
--   Part 0   BEFORE the migration: what is on storage.objects today (for the record)
--   Part 1   AFTER the migration: the structure is what the plan says
--   Part 2   AFTER the migration: a signed-in user is refused the table
--   Part 3   AFTER the first capture: the server sees the objects, a signed-in user sees none
--
-- The migration itself is docs/audits/GW-SCAN-LAB-001.md §5. It is not applied
-- by this file.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── PART 0 — BEFORE: every policy on storage.objects, as it stands ───────────
-- Informational. The migration does not depend on what this returns: its
-- restrictive policy holds against any permissive policy listed here.
select policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;


-- ── PART 1 — AFTER: structure ───────────────────────────────────────────────
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'scan-lab';
-- EXPECTED: one row · public = false · 26214400 · {image/jpeg,image/png,image/webp}

select tablename, policyname, permissive, cmd, roles, qual, with_check
  from pg_policies
 where policyname in ('scan_lab_objects_server_only', 'scan_lab_items_server_only')
 order by tablename;
-- EXPECTED: two rows · permissive = RESTRICTIVE · cmd = ALL · roles = {public}
--           objects:        qual and with_check = (bucket_id IS DISTINCT FROM 'scan-lab'::text)
--           scan_lab_items: qual and with_check = false

select
  (select relrowsecurity from pg_class where oid = 'public.scan_lab_items'::regclass)      as items_rls_on,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'scan_lab_items' and permissive = 'PERMISSIVE') as items_permissive_policies,
  has_table_privilege('anon',          'public.scan_lab_items', 'select')                  as anon_can_read,
  has_table_privilege('authenticated', 'public.scan_lab_items', 'select')                  as user_can_read,
  has_table_privilege('authenticated', 'public.scan_lab_items', 'insert')                  as user_can_insert,
  has_table_privilege('authenticated', 'public.scan_lab_items', 'update')                  as user_can_update,
  has_table_privilege('authenticated', 'public.scan_lab_items', 'delete')                  as user_can_delete,
  (has_table_privilege('service_role', 'public.scan_lab_items', 'select') and has_table_privilege('service_role', 'public.scan_lab_items', 'insert') and has_table_privilege('service_role', 'public.scan_lab_items', 'update') and has_table_privilege('service_role', 'public.scan_lab_items', 'delete')) as server_can,
  (select rolbypassrls from pg_roles where rolname = 'service_role')                       as server_bypasses_rls,
  (select rolbypassrls from pg_roles where rolname = 'authenticated')                      as user_bypasses_rls;
-- EXPECTED: true · 0 · false · false · false · false · false · true · true · false

select count(*) as scan_lab_in_realtime
  from pg_publication_tables where schemaname = 'public' and tablename = 'scan_lab_items';
-- EXPECTED: 0


-- ── PART 2 — AFTER: a signed-in user is refused the table ───────────────────
-- Acts as `authenticated` for one statement. The statement must FAIL with
-- "permission denied for table scan_lab_items". The transaction is rolled back.
begin;
  set local role authenticated;
  select count(*) as must_fail_with_permission_denied from public.scan_lab_items;
rollback;


-- ── PART 3 — AFTER THE FIRST CAPTURE: the bucket is invisible to a signed-in user ──
-- As the SQL editor's own role (not subject to row security):
select count(*) as objects_the_server_holds
  from storage.objects where bucket_id = 'scan-lab';
-- EXPECTED: 2 after one captured item (the original and its prepared copy)

-- As a signed-in user, claiming to be the very account that owns them.
-- Paste the founder's user id in place of the zeros:
begin;
  select set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}', true);
  set local role authenticated;
  select count(*) as objects_a_signed_in_user_sees
    from storage.objects where bucket_id = 'scan-lab';
rollback;
-- EXPECTED: 0, although the server holds objects — including for the owning account itself.
