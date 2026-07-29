-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-001/002 — close the four production-verification failures
-- Generated: 2026-07-29   Forward-only. Idempotent. Safe to re-run.
--
-- The production run of tests/security_001_002_production_verification.sql
-- failed 4 of 29 checks: S001.7, S001.8, S001.9 and S002.5. Both root causes
-- were confirmed by direct catalog inspection of production (2026-07-29).
--
-- ROOT CAUSE 1 — anon holds EXECUTE on the three order RPCs (S001.7–S001.9).
--   Supabase ships ALTER DEFAULT PRIVILEGES (for postgres/supabase_admin in
--   schema public) that grant EXECUTE on every NEWLY CREATED function DIRECTLY
--   to anon, authenticated and service_role. Observed on production:
--     pg_default_acl (objtype 'f', schema public):
--       postgres=X;anon=X;authenticated=X;service_role=X
--     proacl on all three RPCs:
--       postgres=X/postgres;anon=X/postgres;authenticated=X/postgres;service_role=X/postgres
--   The defining migrations (20260519000003, 20260607000003, 20260719000004)
--   ran `REVOKE ALL ... FROM PUBLIC` — which removes only the implicit PUBLIC
--   grant, NOT the direct anon grant the default ACL had already written at
--   CREATE time. So anon has held EXECUTE on transition_order / create_order /
--   admin_update_order_status since each was (re)created.
--
--   Severity: not remotely exploitable today — all three bodies reject
--   auth.uid() IS NULL before doing anything — but it is unreviewed surface
--   (anon reaches the function body at all) and violates the stated contract
--   of all three defining migrations. The verification suite is correct.
--
--   NOTE on "unsafe search_path": the S001.7/S001.8 failure string is a
--   combined disjunction ("not SECDEF, owner reassigned, search_path unpinned
--   or unsafe, or EXECUTE misgranted"). The observed detail shows all three
--   functions pinned to {search_path=public}, which the suite classifies as
--   safe. The ONLY live defect behind all three failures is the anon grant.
--
--   MAINTENANCE RULE this migration establishes: `REVOKE ... FROM PUBLIC` is
--   NOT sufficient on Supabase. Any future migration that CREATEs (or DROPs
--   and recreates — CREATE OR REPLACE on an existing function keeps its ACL,
--   but DROP + CREATE re-applies the default ACL) a client-callable function
--   must also REVOKE from anon explicitly, then grant the intended roles.
--
-- ROOT CAUSE 2 — dashboard-era INSERT policy on profiles binds role public
--   (S002.5). Observed on production and created by no migration:
--     "Users can insert own profile"  INSERT  roles={public}
--       WITH CHECK (auth.uid() = id)
--   This is the stock Supabase dashboard policy template: it omits `TO`, and a
--   policy without `TO` binds to role `public` — every role, anon included.
--   anon cannot actually satisfy the expression (auth.uid() is NULL for anon,
--   and NULL = id is never true), so this is NOT an exploitable hole. But its
--   entire safety rests on one expression with no role scoping behind it; any
--   future edit to that expression silently re-opens the question for anon.
--   Recreating the policy `TO authenticated` preserves the exact effective
--   behaviour (authenticated may insert only their own row; anon never could
--   insert anyway) and removes anon/public from the policy's role set — which
--   is what S002.5 asserts. The BEFORE INSERT trigger
--   (trg_profiles_enforce_safe_defaults_insert, 20260723000001) continues to
--   zero all reputation/identity fields on any client self-insert.
--
-- The verification suite is NOT modified: both findings are real deviations
-- from the intended design, and both fixes are behaviour-preserving for every
-- legitimate caller.
--
-- Rollback: see foot of file.
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Order RPCs — strip the direct anon EXECUTE grant (and PUBLIC, for
--    completeness), re-assert the intended grants. Resolved by proname via
--    pg_proc so this works whatever the argument signatures are, and covers
--    any overloads. Aborts loudly if any of the three is missing — that would
--    mean the wrong database, not a clean slate.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r record;
  v_found text[] := '{}';
  v_missing text;
BEGIN
  FOR r IN
    SELECT p.proname,
           format('public.%I(%s)', p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN ('transition_order', 'create_order',
                        'admin_update_order_status')
  LOOP
    v_found := v_found || r.proname;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    -- authenticated is the intended caller of all three (admin_* gates on
    -- profiles.is_admin inside its body); service_role stays for server-side use.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
    RAISE NOTICE 'hardened EXECUTE grants on %', r.sig;
  END LOOP;

  SELECT string_agg(fn, ', ') INTO v_missing
  FROM unnest(ARRAY['transition_order','create_order','admin_update_order_status']) fn
  WHERE fn <> ALL (v_found);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY-001 abort: missing expected RPC(s): % — wrong database?', v_missing;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. profiles INSERT policy — same name, same expression, scoped TO
--    authenticated instead of the implicit role public.
-- ══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Postconditions — fail the whole migration (single transaction in the SQL
--    Editor) rather than ship a partial fix.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('transition_order', 'create_order',
                      'admin_update_order_status')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: EXECUTE still misgranted on: %', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND cmd IN ('INSERT', 'DELETE', 'ALL')
      AND roles::text[] && ARRAY['anon', 'public']
  ) THEN
    RAISE EXCEPTION 'postcondition failed: an INSERT/DELETE policy on profiles still binds anon/public';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — restores the pre-migration state, NOT a recommended state):
--   GRANT EXECUTE ON FUNCTION public.transition_order(uuid, text, jsonb)      TO anon;
--   GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, numeric, text, text, text) TO anon;
--   GRANT EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text)    TO anon;
--   DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
--   CREATE POLICY "Users can insert own profile" ON public.profiles
--     FOR INSERT WITH CHECK (auth.uid() = id);   -- no TO clause = role public
-- ══════════════════════════════════════════════════════════════════════════════
