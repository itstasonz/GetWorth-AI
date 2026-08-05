-- ══════════════════════════════════════════════════════════════════════════════
-- VAL-001 — Scan-quota RPC lockdown
-- Generated: 2026-07-30   Forward-only. Idempotent. Safe to re-run.
--
-- THREAT (confirmed by reading the defining migrations; no exploit was run):
--   Three SECURITY DEFINER functions govern the per-user scan quota:
--     increment_user_daily_scan(uuid, date)          20260518000004:62-79
--     decrement_user_daily_scan(uuid, date)          20260625000001:17-33
--     check_and_increment_scan_rate(text, uuid, date, int, int, int)
--                                                    20260625000002:26-88
--   NONE of the three defining migrations contains a single GRANT or REVOKE.
--   Per the rule this repo established in 20260729000002:8-40, Supabase's
--   ALTER DEFAULT PRIVILEGES writes a DIRECT EXECUTE grant to anon,
--   authenticated and service_role at CREATE time — so all three are callable
--   through PostgREST /rest/v1/rpc/… by anon and by every logged-in user.
--
--   This is worse than the SECURITY-001 order-RPC case that 20260729000002
--   closed. There, the finding was unreviewed surface: every body rejected
--   auth.uid() IS NULL before doing anything. These bodies check nothing. They
--   take the user id AND the limits from the caller.
--
--   Live consequences:
--     1. UNLIMITED FREE SCANS (cost). decrement_user_daily_scan(<own uuid>,
--        current_date) refunds a charge. Called in a loop it pins
--        scan_daily_usage.count at 0 forever, so USER_DAILY_LIMIT = 50
--        (api/analyze.js:295) is unenforceable. Every bypassed scan is a
--        Stage 1 + Stage 2 Anthropic call and possibly a Google Vision call.
--        The daily quota is the ONLY cost ceiling on the most expensive path
--        in the product.
--     2. QUOTA EXHAUSTION AGAINST ANOTHER USER. increment_user_daily_scan(
--        <victim uuid>, current_date) called 50x locks that user out for the
--        rest of the UTC day. profiles.id IS the auth uuid, so victim ids are
--        obtainable.
--     3. IP-WINDOW POISONING. Calling check_and_increment_scan_rate directly
--        with a chosen p_ip inserts rows into scan_rate_log (20260625000002:
--        83-84). Five calls with a victim's IP trip the per-IP burst guard
--        (VISION_RATE_PER_MIN = 5, api/analyze.js:290) for everyone behind
--        that IP for 60s, renewably.
--     4. CALLER-SUPPLIED POLICY. p_ip_limit / p_user_limit / p_daily_limit are
--        parameters. Today api/analyze.js:875-882 passes its own constants so
--        this is surface rather than exploit — but the quota policy lives in
--        the caller's hands, and any future caller that forwards a client
--        value silently disables the quota.
--
-- FIX — three fail-closed layers, in the 20260723000001 / 20260729000002 style:
--   L1  Bodies refuse any JWT-bearing caller outright. These RPCs are
--       server-only; auth.uid() is NULL for the service role by construction,
--       so this can never reject the legitimate caller. It is what keeps them
--       safe even if the grants are ever restored by a later migration or by
--       a hand-edit in the dashboard.
--   L2  Server-authoritative limits. The three limit parameters are kept in
--       the signature (removing them would change the identity args and force
--       a coordinated code+DB deploy) but are now passed through
--       LEAST(caller, server) — a caller can only ever be MORE restrictive,
--       never less. A caller asking for more is clamped and warned.
--   L3  EXECUTE stripped from PUBLIC, anon AND authenticated explicitly, then
--       granted to service_role only. `REVOKE … FROM PUBLIC` alone does NOT
--       remove the direct anon/authenticated grants the default ACL wrote —
--       that is the whole finding of 20260729000002.
--
--   Precedent for L3 in this repo: record_scan(jsonb) is already locked exactly
--   this way (20260701120000:128-129), and so is memory_record_confirmation
--   (20260707000001:440-444). This migration brings the quota RPCs in line with
--   functions that were locked down correctly on day one.
--
-- Out of scope, deliberately:
--   • scan_daily_usage has no purge job — the pg_cron schedule sketched at
--     20260518000004:82-96 was never applied. Unbounded growth is an
--     availability question, not a security one. Separate ticket.
--   • increment_user_daily_scan has no live JS caller (checkRateLimit uses
--     check_and_increment_scan_rate; the only mention is the comment at
--     api/analyze.js:862). It is hardened here rather than dropped: dropping a
--     function whose absence we cannot test against production is a larger
--     change than locking it.
--
-- Rollback: see the ROLLBACK block at the foot of this file.
-- ══════════════════════════════════════════════════════════════════════════════

-- Apply via the Supabase SQL Editor or `supabase db push` (both run this as a
-- single transaction, so any error aborts the whole migration). With raw psql,
-- pass -v ON_ERROR_STOP=1 on the command line. Do not reintroduce an in-file
-- ON_ERROR_STOP directive: that is a psql meta-command, not SQL, and is a
-- syntax error over a plain Postgres connection (Supabase SQL Editor included).


-- ══════════════════════════════════════════════════════════════════════════════
-- ⚠  MANDATORY PRE-FLIGHT — RUN THIS AND READ THE RESULT BEFORE YOU APPLY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- WHY: after this migration only `service_role` may execute the quota RPCs. The
-- Edge Function builds its Supabase client from
--
--     process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
--       || process.env.VITE_SUPABASE_ANON_KEY            (api/analyze.js:1323)
--
-- — a chain that falls back to the ANON key without complaining. If production
-- is somehow running on that fallback, this migration breaks every scan.
--
-- WHAT BREAKS, IN PLAIN WORDS: checkRateLimit is fail-closed. An RPC error
-- returns { allowed: false, limitType: 'quota_error' } (api/analyze.js:883-886),
-- and the handler turns that into HTTP 429 "Too many scans. Please wait a moment
-- and try again." (api/analyze.js:2685-2689) with no AI call. So the failure is
-- not partial and not subtle: 100% of scans fail immediately, for every user,
-- with a message that says the opposite of what is wrong. Nothing in the logs
-- says "permission denied" at the top level — you would see a wall of
-- `[RateLimit] denied source=db reason=rpc_failed`.
--
-- RECOVERY if that happens: the ROLLBACK block at the foot of this file. It is
-- pure GRANT statements, takes effect on the next request, and needs no deploy.
--
-- RUN THIS FIRST. Do not apply the migration unless EVERY column matches the
-- expected value in the comment beneath it:
--
--   SELECT
--     (SELECT count(*) FROM public.scan_events
--        WHERE created_at > now() - interval '7 days')          AS scan_events_last_7d,
--     (SELECT relrowsecurity FROM pg_catalog.pg_class
--        WHERE oid = 'public.scan_events'::regclass)            AS scan_events_rls_on,
--     (SELECT count(*) FROM pg_policies
--        WHERE schemaname = 'public' AND tablename = 'scan_events'
--          AND cmd IN ('INSERT', 'ALL'))                        AS scan_events_insert_policies,
--     pg_catalog.has_function_privilege('anon',
--       'public.record_scan(jsonb)', 'EXECUTE')                 AS record_scan_anon_execute,
--     pg_catalog.has_function_privilege('service_role',
--       'public.record_scan(jsonb)', 'EXECUTE')                 AS record_scan_service_execute;
--
--   REQUIRED:  scan_events_last_7d          > 0
--              scan_events_rls_on           = true
--              scan_events_insert_policies  = 0
--              record_scan_anon_execute     = false
--              record_scan_service_execute  = true
--
-- WHY THAT PROVES IT: scan_events has RLS enabled and only an admin SELECT
-- policy — no INSERT policy at all (20260701120000:43-64). Under RLS,
-- default-deny means NO client role can insert a row. The service role is the
-- only principal that bypasses RLS. logScanEvent writes scan_events with the
-- SAME client object that calls the quota RPCs (api/analyze.js:1320-1327 is the
-- single client factory). So a single scan_events row written in the last seven
-- days is proof that that client is service_role, not anon. The record_scan
-- columns are the corroborating half: record_scan is service_role-only and is
-- how valuations get persisted at all (api/analyze.js:2149).
--
-- If scan_events_last_7d is 0 because the site is simply quiet, do not guess.
-- Run one real scan through production, then re-run the query.
--
-- SECOND, INDEPENDENT CHECK (do this too — it is five seconds): in the Vercel
-- project settings, confirm SUPABASE_SERVICE_KEY is set, or that SUPABASE_KEY
-- holds the service-role key. The SQL above infers the answer; the dashboard
-- states it.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 0. PRECONDITIONS — abort loudly rather than half-apply.
--
--    Everything this migration touches must already exist with the exact
--    signature we are about to replace. A missing object means the wrong
--    database or a fresh rebuild that never ran the earlier migrations, not a
--    clean slate to improvise on. Note that scan_rate_log and scan_daily_usage
--    are guarded with to_regclass: scan_rate_log's CREATE TABLE lives in no
--    migration in this repo (20260504000000 only cleans it up), so on a fresh
--    database it may genuinely be absent.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_missing_tbl text;
  v_expected    text[] := ARRAY[
    'increment_user_daily_scan|p_user_id uuid, p_date date',
    'decrement_user_daily_scan|p_user_id uuid, p_date date',
    'check_and_increment_scan_rate|p_ip text, p_user_id uuid, p_date date, '
      || 'p_ip_limit integer, p_user_limit integer, p_daily_limit integer'
  ];
  v_spec        text;
  v_name        text;
  v_args        text;
  v_actual      text;
BEGIN
  -- Tables the RPC bodies read and write.
  SELECT string_agg(t, ', ') INTO v_missing_tbl
  FROM unnest(ARRAY['public.scan_daily_usage', 'public.scan_rate_log']) t
  WHERE to_regclass(t) IS NULL;
  IF v_missing_tbl IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: missing table(s): % — wrong database, or 20260518000004 was never applied',
      v_missing_tbl;
  END IF;

  -- Functions, matched on identity arguments. CREATE OR REPLACE cannot rename
  -- an input parameter, and PostgREST calls these by NAMED argument
  -- (api/analyze.js:876-881), so a signature that has drifted must abort here
  -- rather than fail obscurely three statements later.
  FOREACH v_spec IN ARRAY v_expected LOOP
    v_name := split_part(v_spec, '|', 1);
    v_args := split_part(v_spec, '|', 2);

    SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' ## ')
      INTO v_actual
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_name;

    IF v_actual IS NULL THEN
      RAISE EXCEPTION 'VAL-001 abort: function public.%() not found — wrong database?', v_name;
    END IF;
    IF v_actual <> v_args THEN
      RAISE EXCEPTION 'VAL-001 abort: public.%() signature drift. expected (%) got (%)',
        v_name, v_args, v_actual;
    END IF;
  END LOOP;

  -- scan_daily_usage must stay RLS-on with zero policies: the RPCs are the only
  -- sanctioned door, and this migration's whole value rests on that being true.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scan_daily_usage'::regclass) THEN
    RAISE EXCEPTION 'VAL-001 abort: RLS is not enabled on scan_daily_usage';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'scan_daily_usage') THEN
    RAISE EXCEPTION 'VAL-001 abort: scan_daily_usage has RLS policies — direct client access was opened by something';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. L1 + L2 — rewrite the three bodies.
--
--    L1: refuse any caller that carries a user JWT. auth.uid() reads the `sub`
--        claim of request.jwt.claims. The service-role key's JWT has role=
--        service_role and NO sub, so auth.uid() is NULL for the server and
--        NON-NULL for every PostgREST client call. This is the same predicate
--        the live SECURITY-002 trigger already depends on
--        (20260723000001:100-103), which is why it is safe to rely on here.
--
--        Note this is deliberately a flat refusal, not `p_user_id = auth.uid()`.
--        For decrement_user_daily_scan, "the caller is refunding their OWN
--        quota" IS the exploit — an ownership check would authorise it.
--
--    L2: limits come from the server. Kept as parameters for signature
--        stability; LEAST() means a caller can only tighten. LEAST ignores
--        NULLs, so a NULL parameter yields the server value.
--
--    Semantics for the legitimate caller are otherwise byte-for-byte those of
--    20260518000004 / 20260625000001 / 20260625000002.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1a. increment_user_daily_scan ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_user_daily_scan(p_user_id uuid, p_date date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- VAL-001 L1: server-only. See section 1 header.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'increment_user_daily_scan is server-only (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO scan_daily_usage (user_id, date, count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET count = scan_daily_usage.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- ── 1b. decrement_user_daily_scan ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_user_daily_scan(p_user_id uuid, p_date date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- VAL-001 L1: server-only. This is the unlimited-free-scans function — a
  -- self-refund by the quota's own owner is the attack, so ownership is not a
  -- defence here and is deliberately not checked.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'decrement_user_daily_scan is server-only (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE scan_daily_usage
     SET count = GREATEST(count - 1, 0)
   WHERE user_id = p_user_id AND date = p_date
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- ── 1c. check_and_increment_scan_rate ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_and_increment_scan_rate(
  p_ip          text,
  p_user_id     uuid,
  p_date        date,
  p_ip_limit    int,
  p_user_limit  int,
  p_daily_limit int
)
RETURNS TABLE (allowed boolean, limit_type text, daily_count int, charged boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- VAL-001 L2: server-authoritative limits. These mirror the Edge Function
  -- constants (api/analyze.js:290 VISION_RATE_PER_MIN, :294 USER_RATE_PER_MIN,
  -- :295 USER_DAILY_LIMIT). If the product changes a limit, change it in BOTH
  -- places — they are asserted equal by nothing, and the tighter of the two
  -- wins, so a mismatch shows up as a quota that is stricter than intended.
  c_ip_limit    constant int := 5;
  c_user_limit  constant int := 5;
  c_daily_limit constant int := 50;

  v_ip_limit    int;
  v_user_limit  int;
  v_daily_limit int;
  v_one_min_ago timestamptz := now() - interval '60 seconds';
  v_ip_count    int;
  v_user_count  int;
  v_daily       int := 0;
BEGIN
  -- VAL-001 L1: server-only. See section 1 header.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'check_and_increment_scan_rate is server-only (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- VAL-001 L2: a caller may tighten a limit, never loosen one. LEAST() ignores
  -- NULLs, so an omitted parameter resolves to the server value.
  v_ip_limit    := LEAST(p_ip_limit,    c_ip_limit);
  v_user_limit  := LEAST(p_user_limit,  c_user_limit);
  v_daily_limit := LEAST(p_daily_limit, c_daily_limit);

  IF coalesce(p_ip_limit,    0) > c_ip_limit
  OR coalesce(p_user_limit,  0) > c_user_limit
  OR coalesce(p_daily_limit, 0) > c_daily_limit THEN
    RAISE WARNING 'check_and_increment_scan_rate: caller asked for limits (ip=%, user=%, daily=%) exceeding server limits (%, %, %); clamped',
      p_ip_limit, p_user_limit, p_daily_limit, c_ip_limit, c_user_limit, c_daily_limit;
  END IF;

  -- IP per-minute burst guard
  SELECT count(*) INTO v_ip_count
  FROM scan_rate_log
  WHERE ip = p_ip AND created_at >= v_one_min_ago;
  IF v_ip_count >= v_ip_limit THEN
    RETURN QUERY SELECT false, 'ip_rate'::text, 0, false; RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    -- User per-minute burst guard
    SELECT count(*) INTO v_user_count
    FROM scan_rate_log
    WHERE user_id = p_user_id AND created_at >= v_one_min_ago;
    IF v_user_count >= v_user_limit THEN
      RETURN QUERY SELECT false, 'user_rate'::text, 0, false; RETURN;
    END IF;

    -- Atomic daily increment (anti-probe: over-limit requests still count).
    INSERT INTO scan_daily_usage (user_id, date, count)
    VALUES (p_user_id, p_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = scan_daily_usage.count + 1
    RETURNING count INTO v_daily;

    IF v_daily > v_daily_limit THEN
      RETURN QUERY SELECT false, 'user_daily'::text, v_daily, false; RETURN;
    END IF;
  END IF;

  -- Record this attempt for the per-minute window.
  INSERT INTO scan_rate_log (ip, user_id, created_at)
  VALUES (p_ip, p_user_id, now());

  RETURN QUERY SELECT true, NULL::text, v_daily, (p_user_id IS NOT NULL);
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. L3 — EXECUTE lockdown.
--
--    CREATE OR REPLACE above PRESERVED the existing ACL, including the direct
--    anon/authenticated grants written by the default ACL at original CREATE
--    time. That is why this section runs AFTER the bodies: the ACL work must be
--    the last word.
--
--    Resolved by proname through pg_proc so every overload is covered whatever
--    its signature — the same loop as 20260729000002:70-102. The preconditions
--    already proved all three exist, so a missing one here would mean something
--    dropped a function mid-transaction.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r         record;
  v_found   text[] := '{}';
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
      AND p.proname IN ('increment_user_daily_scan',
                        'decrement_user_daily_scan',
                        'check_and_increment_scan_rate')
  LOOP
    v_found := v_found || r.proname;
    -- PUBLIC removes the implicit grant; anon and authenticated remove the
    -- DIRECT grants the Supabase default ACL wrote. Revoking only PUBLIC is the
    -- exact mistake 20260729000002 was written to correct.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    -- No client role is an intended caller: no code in src/ calls these RPCs.
    -- The only caller is the Edge Function's server-side client
    -- (api/analyze.js:875, :912).
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    -- SECURITY DEFINER runs AS THE OWNER, so an unpinned or attacker-preferring
    -- search_path is a live privilege problem, not hygiene. Re-assert the pin.
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
    RAISE NOTICE 'VAL-001 hardened %', r.sig;
  END LOOP;

  SELECT string_agg(fn, ', ') INTO v_missing
  FROM unnest(ARRAY['increment_user_daily_scan',
                    'decrement_user_daily_scan',
                    'check_and_increment_scan_rate']) fn
  WHERE fn <> ALL (v_found);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: missing expected RPC(s): % — wrong database?', v_missing;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. POSTCONDITIONS — fail the whole migration (single transaction) rather than
--    ship a partial fix.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_bad  text;
  v_path text;
BEGIN
  -- 3a. EXECUTE: no anon, no authenticated, yes service_role — on every overload.
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('increment_user_daily_scan',
                      'decrement_user_daily_scan',
                      'check_and_increment_scan_rate')
    AND (has_function_privilege('anon',          p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: EXECUTE still misgranted on: %', v_bad;
  END IF;

  -- 3b. Still SECURITY DEFINER, and owned by the same principal that owns the
  --     application tables. A reassigned owner keeps prosecdef=true and every
  --     grant while losing the privileges that made the function authoritative.
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('increment_user_daily_scan',
                      'decrement_user_daily_scan',
                      'check_and_increment_scan_rate')
    AND (NOT p.prosecdef
      OR pg_catalog.pg_get_userbyid(p.proowner)
         <> pg_catalog.pg_get_userbyid((SELECT relowner FROM pg_class
                                        WHERE oid = 'public.scan_daily_usage'::regclass)));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: not SECURITY DEFINER, or owner differs from the table owner: %', v_bad;
  END IF;

  -- 3c. search_path pinned AND every schema in the pin recognised. A pin of
  --     `evil, public` IS pinned and is strictly worse than unpinned.
  SELECT string_agg(DISTINCT proname, ', ') INTO v_path
  FROM (
    SELECT p.proname, p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('increment_user_daily_scan',
                        'decrement_user_daily_scan',
                        'check_and_increment_scan_rate')
  ) f
  WHERE coalesce(f.proconfig::text, '') NOT LIKE '%search_path=%'
     OR EXISTS (
          SELECT 1
          FROM unnest(string_to_array(
                 right((SELECT c FROM unnest(f.proconfig) c WHERE c LIKE 'search_path=%'),
                       -length('search_path=')), ',')) s
          WHERE btrim(s, ' "') NOT IN ('public', 'pg_catalog', 'pg_temp', '$user')
        );
  IF v_path IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: search_path unpinned or unsafe on: %', v_path;
  END IF;

  -- 3d. The L1 refusal is present in all three deployed bodies. Text matching is
  --     a smoke test, not a proof of behaviour — but it catches the body being
  --     replaced wholesale, which is the realistic regression.
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('increment_user_daily_scan',
                      'decrement_user_daily_scan',
                      'check_and_increment_scan_rate')
    AND p.prosrc !~ 'auth\.uid\(\)\s+IS\s+NOT\s+NULL';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: L1 server-only guard missing from: %', v_bad;
  END IF;

  -- 3e. The L2 clamp is present.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_and_increment_scan_rate'
      AND p.prosrc ~ 'LEAST\s*\(\s*p_daily_limit'
      AND p.prosrc ~ 'LEAST\s*\(\s*p_user_limit'
      AND p.prosrc ~ 'LEAST\s*\(\s*p_ip_limit'
  ) THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: server-authoritative limit clamp missing from check_and_increment_scan_rate';
  END IF;

  -- 3f. scan_daily_usage is still RLS-on with no policies — the RPCs must stay
  --     the only door.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scan_daily_usage'::regclass) THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: RLS disabled on scan_daily_usage';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'scan_daily_usage') THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: scan_daily_usage gained an RLS policy';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. VERIFY (read-only, run after applying — or just run
--    tests/val_001_production_verification.sql, checks V001.1-V001.6)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT p.proname,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
--        has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service,
--        p.prosecdef, p.proconfig
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('increment_user_daily_scan', 'decrement_user_daily_scan',
--                     'check_and_increment_scan_rate');
-- Expected: anon=false, authed=false, service=true, prosecdef=true,
--           proconfig={search_path=public} for all three.


-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — restores the pre-migration state, which is NOT a state to
-- run in; it is here so an operator who has broken production at 3am can undo
-- this in one paste, with no deploy, and investigate afterwards):
--
--   GRANT EXECUTE ON FUNCTION public.increment_user_daily_scan(uuid, date)
--     TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.decrement_user_daily_scan(uuid, date)
--     TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.check_and_increment_scan_rate(
--     text, uuid, date, integer, integer, integer) TO anon, authenticated;
--
-- Note the grants alone are NOT a full rollback: the L1 refusal still lives in
-- the bodies, so a JWT-bearing caller is still rejected. That is intentional —
-- restoring the grants is enough to unbreak a service-role misconfiguration
-- (the server carries no JWT and so never trips L1), and nothing else should
-- ever have been calling these. To also restore the pre-VAL-001 bodies, re-run
-- 20260518000004, 20260625000001 and 20260625000002 in that order.
-- ══════════════════════════════════════════════════════════════════════════════
