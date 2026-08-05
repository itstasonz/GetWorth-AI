-- ══════════════════════════════════════════════════════════════════════════════
-- VAL-001 — PRODUCTION VERIFICATION SUITE
--
-- Proves that the Valuation Safety Foundation lockdowns are actually in force on
-- a running database. Run it after applying, in this order:
--
--   supabase/migrations/20260730000001_val001_scan_quota_lockdown.sql
--   supabase/migrations/20260730000002_val001_valuations_column_freeze.sql
--   supabase/migrations/20260730000003_val001_products_trgm_indexes.sql
--   supabase/migrations/20260730000004_val001_valuation_constraints.sql
--
-- ── HOW TO RUN ────────────────────────────────────────────────────────────────
--   Supabase dashboard → SQL Editor → paste this whole file → Run.
--   Or:  psql "$DB_URL" -f tests/val_001_production_verification.sql
--
--   Read the SUMMARY row at the bottom first. If it says ALL CHECKS PASSED you
--   are done. Otherwise it names every failing check_id; find those rows above.
--   Every row's `status` is either the literal 'PASS' or 'FAIL: <reason>', and
--   `detail` always carries the observed value — on pass and on fail alike.
--
--   RUN IT AS THE TABLE OWNER / `postgres`, which is what the SQL Editor already
--   does. Same warning as the SECURITY-001/002 suite: a partially privileged
--   role can produce a full board of green rows without having checked anything,
--   because information_schema views only expose objects the caller holds some
--   privilege on. Every check here that scans a catalog view therefore fails
--   closed on an empty scan rather than reporting "0 rows disagree — PASS".
--
--   READ-ONLY. No DDL, no writes, no transaction control. Safe on production.
--
-- ── WHAT THIS SUITE DOES NOT PROVE ───────────────────────────────────────────
--   It verifies PRIVILEGES and SCHEMA STATE, which is what a forgery-resistance
--   argument actually rests on. It does not exercise the RPCs as a hostile role
--   — that requires SET ROLE and is destructive-adjacent, so it lives in
--   tests/val_001_quota_lockdown.test.sql and
--   tests/val_001_valuations_freeze.test.sql, which are for a DISPOSABLE
--   database only. Never run those two against production.
--
--   It also does not verify the JS-side guard (api/_lib/valuation-guard.js);
--   that is tests/valuation-guard.test.mjs.
-- ══════════════════════════════════════════════════════════════════════════════

WITH
-- ── Fixtures ────────────────────────────────────────────────────────────────
quota_fns(fname) AS (
  VALUES ('increment_user_daily_scan'), ('decrement_user_daily_scan'), ('check_and_increment_scan_rate')
),
-- Hard-coded expectation list. This is the empty-set trap: LEFT JOIN from the
-- expected names, so a DROPPED function yields a row saying which one is gone
-- rather than silently contributing nothing to a count.
quota_resolved AS (
  SELECT q.fname,
         p.oid,
         p.prosecdef,
         p.proconfig,
         pg_get_userbyid(p.proowner) AS owner,
         p.prosrc
  FROM quota_fns q
  LEFT JOIN pg_proc p ON p.proname = q.fname
                     AND p.pronamespace = 'public'::regnamespace
),
val_allowed(colname) AS (
  VALUES ('user_confirmed'), ('user_correction'), ('identified_by'), ('listing_id')
),
owner_anchor AS (
  SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.profiles'::regclass
),

checks AS (

-- ══ A. QUOTA RPCs ═══════════════════════════════════════════════════════════

-- V001.1 — anon holds no EXECUTE on any quota RPC.
-- MUTATION: GRANT EXECUTE ON FUNCTION public.decrement_user_daily_scan(uuid,date) TO anon;
SELECT 'V001.1' AS check_id,
       'anon has no EXECUTE on the 3 quota RPCs' AS what,
       CASE
         WHEN count(*) FILTER (WHERE oid IS NULL) > 0
           THEN 'FAIL: missing function(s): ' || coalesce(string_agg(fname, ', ') FILTER (WHERE oid IS NULL), '')
         WHEN count(*) FILTER (WHERE oid IS NOT NULL AND has_function_privilege('anon', oid, 'EXECUTE')) > 0
           THEN 'FAIL: anon can execute: ' || string_agg(fname, ', ') FILTER (WHERE oid IS NOT NULL AND has_function_privilege('anon', oid, 'EXECUTE'))
         ELSE 'PASS'
       END AS status,
       'resolved=' || count(*) FILTER (WHERE oid IS NOT NULL) || '/3' AS detail
FROM quota_resolved

UNION ALL
-- V001.2 — authenticated holds no EXECUTE either. No client-side caller of these
-- RPCs exists anywhere in src/; the only callers are in api/analyze.js.
-- MUTATION: GRANT EXECUTE ON FUNCTION public.increment_user_daily_scan(uuid,date) TO authenticated;
SELECT 'V001.2',
       'authenticated has no EXECUTE on the 3 quota RPCs',
       CASE
         WHEN count(*) FILTER (WHERE oid IS NULL) > 0
           THEN 'FAIL: missing function(s): ' || coalesce(string_agg(fname, ', ') FILTER (WHERE oid IS NULL), '')
         WHEN count(*) FILTER (WHERE oid IS NOT NULL AND has_function_privilege('authenticated', oid, 'EXECUTE')) > 0
           THEN 'FAIL: authenticated can execute: ' || string_agg(fname, ', ') FILTER (WHERE oid IS NOT NULL AND has_function_privilege('authenticated', oid, 'EXECUTE'))
         ELSE 'PASS'
       END,
       'resolved=' || count(*) FILTER (WHERE oid IS NOT NULL) || '/3'
FROM quota_resolved

UNION ALL
-- V001.3 — service_role DOES hold EXECUTE on all three. This is the check that
-- catches an over-zealous revoke: the pipeline calls these with the service key
-- and checkRateLimit is fail-closed, so losing this grant denies EVERY scan.
-- MUTATION: REVOKE EXECUTE ON FUNCTION public.decrement_user_daily_scan(uuid,date) FROM service_role;
SELECT 'V001.3',
       'service_role HAS EXECUTE on all 3 quota RPCs',
       CASE
         WHEN count(*) FILTER (WHERE oid IS NULL) > 0
           THEN 'FAIL: missing function(s): ' || coalesce(string_agg(fname, ', ') FILTER (WHERE oid IS NULL), '')
         WHEN count(*) FILTER (WHERE oid IS NOT NULL AND NOT has_function_privilege('service_role', oid, 'EXECUTE')) > 0
           THEN 'FAIL: service_role CANNOT execute: ' || string_agg(fname, ', ') FILTER (WHERE oid IS NOT NULL AND NOT has_function_privilege('service_role', oid, 'EXECUTE'))
         ELSE 'PASS'
       END,
       'resolved=' || count(*) FILTER (WHERE oid IS NOT NULL) || '/3'
FROM quota_resolved

UNION ALL
-- V001.4 — all three are SECURITY DEFINER, owned by the profiles owner, and have
-- search_path pinned to recognised schemas only.
-- SECURITY DEFINER runs AS THE OWNER: a reassigned owner keeps prosecdef=true
-- while losing the privileges that made the function authoritative. And a pin
-- naming an unknown schema (SET search_path = evil, public) is pinned AND
-- strictly worse than unpinned, so "has a pin" is not sufficient.
-- MUTATION: ALTER FUNCTION public.increment_user_daily_scan(uuid,date) SET search_path = evil, public;
SELECT 'V001.4',
       'quota RPCs: SECDEF + owner matches profiles owner + safe search_path pin',
       CASE
         WHEN count(*) FILTER (WHERE oid IS NULL) > 0
           THEN 'FAIL: missing function(s)'
         WHEN count(*) FILTER (WHERE oid IS NOT NULL AND NOT prosecdef) > 0
           THEN 'FAIL: not SECURITY DEFINER: ' || string_agg(fname, ', ') FILTER (WHERE oid IS NOT NULL AND NOT prosecdef)
         WHEN count(*) FILTER (WHERE oid IS NOT NULL AND owner IS DISTINCT FROM (SELECT owner FROM owner_anchor)) > 0
           THEN 'FAIL: owner drift: ' || string_agg(fname || '=' || owner, ', ') FILTER (WHERE oid IS NOT NULL AND owner IS DISTINCT FROM (SELECT owner FROM owner_anchor))
         WHEN count(*) FILTER (WHERE oid IS NOT NULL AND proconfig IS NULL) > 0
           THEN 'FAIL: search_path not pinned: ' || string_agg(fname, ', ') FILTER (WHERE oid IS NOT NULL AND proconfig IS NULL)
         WHEN count(*) FILTER (
                WHERE oid IS NOT NULL AND EXISTS (
                  SELECT 1 FROM unnest(proconfig) cfg
                  WHERE cfg LIKE 'search\_path=%'
                    AND EXISTS (
                      SELECT 1 FROM unnest(string_to_array(split_part(cfg, '=', 2), ',')) s
                      WHERE btrim(s) NOT IN ('public', 'pg_catalog', 'pg_temp', '"$user"', '$user')
                    ))) > 0
           THEN 'FAIL: search_path names an unrecognised schema'
         ELSE 'PASS'
       END,
       'owner_anchor=' || (SELECT owner FROM owner_anchor)
FROM quota_resolved

UNION ALL
-- V001.5 — the caller can no longer widen its own limits. The migration keeps
-- the three limit parameters in the signature (dropping them would change the
-- identity args and force a coordinated deploy) but clamps them server-side
-- with LEAST(), so a caller can only ever be MORE restrictive, never less.
-- MUTATION: recreate check_and_increment_scan_rate without the LEAST() clamps.
SELECT 'V001.5',
       'check_and_increment_scan_rate clamps caller-supplied limits with LEAST()',
       CASE
         WHEN prosrc IS NULL THEN 'FAIL: function missing'
         WHEN prosrc ~* 'least\s*\(\s*(coalesce\s*\(\s*)?p_daily_limit'
          AND prosrc ~* 'least\s*\(\s*(coalesce\s*\(\s*)?p_ip_limit'
          AND prosrc ~* 'least\s*\(\s*(coalesce\s*\(\s*)?p_user_limit'
           THEN 'PASS'
         ELSE 'FAIL: at least one limit parameter is used unclamped'
       END,
       'body_len=' || coalesce(length(prosrc)::text, 'n/a')
FROM quota_resolved WHERE fname = 'check_and_increment_scan_rate'

UNION ALL
-- V001.6 — scan_daily_usage keeps RLS on with ZERO policies. The RPCs are the
-- only intended way in; any policy here re-opens direct PostgREST access.
-- MUTATION: CREATE POLICY sdu_all ON public.scan_daily_usage FOR ALL USING (true);
SELECT 'V001.6',
       'scan_daily_usage: RLS enabled, zero policies',
       CASE
         WHEN to_regclass('public.scan_daily_usage') IS NULL THEN 'FAIL: table missing'
         WHEN NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scan_daily_usage'::regclass)
           THEN 'FAIL: RLS disabled'
         WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='scan_daily_usage') > 0
           THEN 'FAIL: ' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='scan_daily_usage')::text || ' policy/policies present'
         ELSE 'PASS'
       END,
       'policies=' || coalesce((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='scan_daily_usage')::text, 'n/a')

-- ══ B. VALUATIONS COLUMN FREEZE ═════════════════════════════════════════════

UNION ALL
-- V001.7 — authenticated holds UPDATE on EXACTLY the four annotation columns.
-- Set equality, so an EXTRA grant fails as loudly as a missing one. This is the
-- check that stops a future column from quietly becoming client-writable.
-- MUTATION: GRANT UPDATE (ai_raw_response) ON public.valuations TO authenticated;
SELECT 'V001.7',
       'valuations: authenticated UPDATE grants == {user_confirmed, user_correction, identified_by, listing_id}',
       CASE
         WHEN to_regclass('public.valuations') IS NULL THEN 'FAIL: table missing'
         WHEN (SELECT count(*) FROM val_allowed) <> 4 THEN 'FAIL: fixture corrupt'
         WHEN EXISTS (
                SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema='public' AND table_name='valuations'
                  AND grantee='authenticated' AND privilege_type='UPDATE'
                  AND column_name NOT IN (SELECT colname FROM val_allowed))
           THEN 'FAIL: extra UPDATE column(s): ' || (
                SELECT string_agg(column_name, ', ') FROM information_schema.column_privileges
                WHERE table_schema='public' AND table_name='valuations'
                  AND grantee='authenticated' AND privilege_type='UPDATE'
                  AND column_name NOT IN (SELECT colname FROM val_allowed))
         WHEN EXISTS (
                SELECT 1 FROM val_allowed a
                WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.column_privileges
                  WHERE table_schema='public' AND table_name='valuations'
                    AND grantee='authenticated' AND privilege_type='UPDATE'
                    AND column_name = a.colname))
           THEN 'FAIL: missing UPDATE column(s): ' || (
                SELECT string_agg(a.colname, ', ') FROM val_allowed a
                WHERE NOT EXISTS (
                  SELECT 1 FROM information_schema.column_privileges
                  WHERE table_schema='public' AND table_name='valuations'
                    AND grantee='authenticated' AND privilege_type='UPDATE'
                    AND column_name = a.colname))
         ELSE 'PASS'
       END,
       'granted=' || coalesce((
         SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
         WHERE table_schema='public' AND table_name='valuations'
           AND grantee='authenticated' AND privilege_type='UPDATE'), '(none)')

UNION ALL
-- V001.8 — anon holds no UPDATE and no INSERT on valuations at all.
-- MUTATION: GRANT UPDATE ON public.valuations TO anon;
SELECT 'V001.8',
       'valuations: anon holds no UPDATE and no INSERT',
       CASE
         WHEN to_regclass('public.valuations') IS NULL THEN 'FAIL: table missing'
         WHEN EXISTS (
                SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema='public' AND table_name='valuations'
                  AND grantee='anon' AND privilege_type IN ('UPDATE','INSERT'))
           THEN 'FAIL: anon holds ' || (
                SELECT string_agg(DISTINCT privilege_type, ',') FROM information_schema.column_privileges
                WHERE table_schema='public' AND table_name='valuations'
                  AND grantee='anon' AND privilege_type IN ('UPDATE','INSERT'))
         WHEN EXISTS (
                SELECT 1 FROM information_schema.table_privileges
                WHERE table_schema='public' AND table_name='valuations'
                  AND grantee='anon' AND privilege_type IN ('UPDATE','INSERT'))
           THEN 'FAIL: anon holds table-level UPDATE/INSERT'
         ELSE 'PASS'
       END,
       'anon_privs=' || coalesce((
         SELECT string_agg(DISTINCT privilege_type, ',') FROM information_schema.table_privileges
         WHERE table_schema='public' AND table_name='valuations' AND grantee='anon'), '(none)')

UNION ALL
-- V001.9 — the freeze trigger is installed, ENABLED, and row-level BEFORE UPDATE
-- with NO column scope. tgattr must be empty: a column-scoped trigger
-- (BEFORE UPDATE OF user_correction) walks straight past an UPDATE that touches
-- only a frozen column, which is the exact bypass the SECURITY-001/002 suite
-- documents. tgenabled='O' means enabled in origin/local mode.
-- MUTATION: re-create the trigger as BEFORE UPDATE OF user_correction.
SELECT 'V001.9',
       'valuations freeze trigger: enabled, BEFORE UPDATE, row-level, no column scope',
       CASE
         WHEN to_regclass('public.valuations') IS NULL THEN 'FAIL: table missing'
         WHEN NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.valuations'::regclass AND tgname='trg_valuations_freeze_authoritative_update')
           THEN 'FAIL: trigger missing'
         ELSE COALESCE((
           SELECT CASE
             WHEN t.tgenabled <> 'O' THEN 'FAIL: trigger disabled (tgenabled=' || t.tgenabled::text || ')'
             WHEN (t.tgtype & 1) = 0 THEN 'FAIL: not FOR EACH ROW'
             WHEN (t.tgtype & 2) = 0 THEN 'FAIL: not BEFORE'
             WHEN (t.tgtype & 16) = 0 THEN 'FAIL: not an UPDATE trigger'
             WHEN t.tgattr IS NOT NULL AND array_length(t.tgattr, 1) > 0
               THEN 'FAIL: column-scoped trigger — frozen-only updates bypass it'
             ELSE 'PASS'
           END
           FROM pg_trigger t
           WHERE t.tgrelid='public.valuations'::regclass
             AND t.tgname='trg_valuations_freeze_authoritative_update'), 'FAIL: unresolved')
       END,
       coalesce((SELECT 'tgtype=' || t.tgtype::text || ' tgenabled=' || t.tgenabled::text || ' cols=' || coalesce(array_length(t.tgattr,1),0)::text
                 FROM pg_trigger t WHERE t.tgrelid='public.valuations'::regclass
                   AND t.tgname='trg_valuations_freeze_authoritative_update'), 'n/a')

UNION ALL
-- V001.10 — the trigger body still allowlists exactly the four annotation
-- columns. A privilege grant and a trigger allowlist can drift apart; this
-- catches someone widening the trigger without touching the GRANTs.
-- MUTATION: add 'ai_raw_response' to the allowlist array in the function body.
SELECT 'V001.10',
       'freeze trigger body allowlists exactly the 4 annotation columns',
       CASE
         WHEN p.prosrc IS NULL THEN 'FAIL: function missing'
         WHEN p.prosrc ~ 'ai_raw_response|price_mid|price_low|price_high|ai_name|ai_category|scan_uuid'
           THEN 'FAIL: an authoritative column name appears in the allowlist body'
         WHEN p.prosrc LIKE '%user_confirmed%' AND p.prosrc LIKE '%user_correction%'
          AND p.prosrc LIKE '%identified_by%'  AND p.prosrc LIKE '%listing_id%'
           THEN 'PASS'
         ELSE 'FAIL: allowlist does not name all 4 annotation columns'
       END,
       'body_len=' || coalesce(length(p.prosrc)::text, 'n/a')
FROM (SELECT prosrc FROM pg_proc WHERE proname='valuations_freeze_authoritative_update' AND pronamespace='public'::regnamespace LIMIT 1) p
RIGHT JOIN (SELECT 1) dummy ON true

UNION ALL
-- V001.11 — the origin stamp exists, defaults to 'server', and its BEFORE INSERT
-- trigger is installed. This is what keeps a client-inserted valuation from
-- seeding shared cross-user recognition memory.
-- MUTATION: ALTER TABLE public.valuations ALTER COLUMN origin SET DEFAULT 'client_backup';
SELECT 'V001.11',
       'valuations.origin exists, defaults to server, stamp trigger installed',
       CASE
         WHEN to_regclass('public.valuations') IS NULL THEN 'FAIL: table missing'
         WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='valuations' AND column_name='origin')
           THEN 'FAIL: origin column missing'
         WHEN coalesce((SELECT column_default FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='valuations' AND column_name='origin'), '')
              NOT LIKE '%server%'
           THEN 'FAIL: origin default is not ''server'''
         WHEN NOT EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgrelid='public.valuations'::regclass
                            AND tgname='trg_valuations_stamp_origin_insert'
                            AND tgenabled='O')
           THEN 'FAIL: origin stamp trigger missing or disabled'
         ELSE 'PASS'
       END,
       'default=' || coalesce((SELECT column_default FROM information_schema.columns
                               WHERE table_schema='public' AND table_name='valuations' AND column_name='origin'), 'n/a')

UNION ALL
-- V001.12 — RLS still on for valuations, and every policy is ownership-scoped.
-- The column freeze is layered ON TOP of ownership RLS; losing RLS would make
-- the column grants the only defence and expose other users' rows entirely.
--
-- WHY THIS TESTS THE PREDICATE, NOT THE ROLE LIST: the four policies from
-- 20260607000001 were created with no TO clause, so pg_policies.roles reads
-- {public} for all of them. That is NOT a hole — their predicate is
-- `user_id = auth.uid()`, and auth.uid() is NULL for anon, so `user_id = NULL`
-- evaluates to NULL and matches no row. An earlier version of this check
-- flagged the role list alone and failed on the repo's own correct design.
-- What actually matters is whether a policy is BOTH broadly bound AND
-- permissive, which is what `USING (true)` — the real mutation — looks like.
-- MUTATION: CREATE POLICY v_all ON public.valuations FOR ALL USING (true);
SELECT 'V001.12',
       'valuations: RLS enabled, every policy ownership-scoped (no permissive public policy)',
       CASE
         WHEN to_regclass('public.valuations') IS NULL THEN 'FAIL: table missing'
         WHEN NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.valuations'::regclass)
           THEN 'FAIL: RLS disabled'
         WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='valuations') = 0
           THEN 'FAIL: RLS on but zero policies — valuations unreadable, likely a misapply'
         WHEN EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname='public' AND tablename='valuations'
                  AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%auth.uid()%')
           THEN 'FAIL: policy not ownership-scoped: ' || (
                SELECT string_agg(policyname, ', ') FROM pg_policies
                WHERE schemaname='public' AND tablename='valuations'
                  AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%auth.uid()%')
         ELSE 'PASS'
       END,
       'policies=' || (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='valuations')::text

-- ══ C. VALUATION INVARIANT CONSTRAINTS + RETRIEVAL INDEXES ══════════════════

UNION ALL
-- V001.13 — the price sanity constraints exist. `convalidated` is reported in
-- detail rather than asserted: the migration deliberately adds them NOT VALID
-- and only VALIDATEs when no existing row violates, so a pre-existing bad row
-- legitimately leaves a constraint unvalidated. It still constrains NEW rows.
-- MUTATION: ALTER TABLE public.valuations DROP CONSTRAINT valuations_price_ordered;
SELECT 'V001.13',
       'valuations price sanity constraints present (nonneg, ordered, ceiling)',
       CASE
         WHEN to_regclass('public.valuations') IS NULL THEN 'FAIL: table missing'
         WHEN (SELECT count(*) FROM pg_constraint
               WHERE conrelid='public.valuations'::regclass AND contype='c'
                 AND conname IN ('valuations_price_nonneg','valuations_price_ordered','valuations_price_ceiling')) = 3
           THEN 'PASS'
         ELSE 'FAIL: missing ' || (
              SELECT string_agg(x, ', ') FROM unnest(ARRAY['valuations_price_nonneg','valuations_price_ordered','valuations_price_ceiling']) x
              WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
                                WHERE conrelid='public.valuations'::regclass AND conname=x))
       END,
       coalesce((SELECT string_agg(conname || '(valid=' || convalidated || ')', ' ') FROM pg_constraint
                 WHERE conrelid='public.valuations'::regclass AND contype='c'
                   AND conname LIKE 'valuations_price_%'), '(none)')

UNION ALL
-- V001.14 — the pg_trgm retrieval indexes exist on products.
-- NOTE ON EXPECTATIONS: at the current catalog size (~1,850 rows) the planner
-- will correctly prefer a Seq Scan and these indexes will not be selected. They
-- are shipped for future scale at near-zero write cost, NOT for a present-day
-- win — see the migration header. This check asserts EXISTENCE only; plan
-- selection is evidenced separately in the VAL-001 completion report.
-- MUTATION: DROP INDEX public.idx_products_model_trgm;
SELECT 'V001.14',
       'products pg_trgm indexes present (brand, model, name, category)',
       CASE
         WHEN to_regclass('public.products') IS NULL THEN 'FAIL: products table missing'
         WHEN (SELECT count(*) FROM pg_indexes
               WHERE schemaname='public' AND tablename='products'
                 AND indexname IN ('idx_products_brand_trgm','idx_products_model_trgm',
                                   'idx_products_name_trgm','idx_products_category_trgm')) = 4
           THEN 'PASS'
         ELSE 'FAIL: missing ' || coalesce((
              SELECT string_agg(x, ', ') FROM unnest(ARRAY['idx_products_brand_trgm','idx_products_model_trgm',
                                                           'idx_products_name_trgm','idx_products_category_trgm']) x
              WHERE NOT EXISTS (SELECT 1 FROM pg_indexes
                                WHERE schemaname='public' AND tablename='products' AND indexname=x)), '?')
       END,
       'pg_trgm=' || coalesce((SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='pg_trgm'), 'NOT INSTALLED')

-- ══ D. INFORMATIONAL — not pass/fail gates ══════════════════════════════════

UNION ALL
-- V001.15 — INFORMATIONAL ONLY. `misidentifications` and `upsert_correction`
-- exist in NO migration in this repo, so their live definition and ACL are
-- unknown to version control. VAL-001 fixed this injection channel on the JS
-- side (api/analyze.js fetchCorrections is now scoped to the calling user); the
-- DB-side lockdown is a tracked follow-up that needs a production schema dump
-- first. This row REPORTS the state so the follow-up can be scoped. It never
-- fails the suite.
SELECT 'V001.15',
       'INFO: misidentifications / upsert_correction ACL state (not a gate)',
       'INFO',
       'table=' || coalesce(to_regclass('public.misidentifications')::text, 'absent')
       || ' rls=' || coalesce((SELECT relrowsecurity::text FROM pg_class WHERE oid=to_regclass('public.misidentifications')), 'n/a')
       || ' policies=' || coalesce((SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='misidentifications'), 'n/a')
       || ' | fn=' || coalesce((SELECT 'present' FROM pg_proc WHERE proname='upsert_correction' AND pronamespace='public'::regnamespace LIMIT 1), 'absent')
       || ' anon_exec=' || coalesce((SELECT has_function_privilege('anon', oid, 'EXECUTE')::text FROM pg_proc
                                     WHERE proname='upsert_correction' AND pronamespace='public'::regnamespace LIMIT 1), 'n/a')
)

-- ══ RESULTS ════════════════════════════════════════════════════════════════
SELECT check_id, what, status, detail FROM checks
UNION ALL
SELECT 'SUMMARY',
       'VAL-001 verification result',
       CASE WHEN count(*) FILTER (WHERE status LIKE 'FAIL%') = 0
            THEN 'ALL CHECKS PASSED'
            ELSE 'FAILED: ' || string_agg(check_id, ', ') FILTER (WHERE status LIKE 'FAIL%')
       END,
       (count(*) FILTER (WHERE status = 'PASS'))::text || ' passed, ' ||
       (count(*) FILTER (WHERE status LIKE 'FAIL%'))::text || ' failed, ' ||
       (count(*) FILTER (WHERE status = 'INFO'))::text || ' informational'
FROM checks
ORDER BY 1;
