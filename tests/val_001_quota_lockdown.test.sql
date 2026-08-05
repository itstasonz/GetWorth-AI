-- ══════════════════════════════════════════════════════════════════════════════
-- VAL-001 — SCAN-QUOTA LOCKDOWN — ADVERSARIAL TEST
--
-- ⚠ DISPOSABLE DATABASE ONLY. This file uses SET ROLE and WRITES rows. Never run
--   it against production. The read-only production check is
--   tests/val_001_production_verification.sql.
--
-- Proves the three scan-quota RPCs are unreachable by anon and authenticated
-- after 20260730000001_val001_scan_quota_lockdown.sql, and that the legitimate
-- service_role path still works.
--
-- ── WHY THIS MATTERS ─────────────────────────────────────────────────────────
-- Before the migration all three were SECURITY DEFINER with no GRANT/REVOKE and
-- no auth.uid() check, taking a caller-supplied user id AND caller-supplied
-- limits. Supabase's default ACLs grant EXECUTE to anon at CREATE time, so any
-- holder of the publishable anon key could:
--   1. call decrement_user_daily_scan(<own id>) in a loop to hold their daily
--      counter at zero — making USER_DAILY_LIMIT unenforceable and removing the
--      only cost ceiling on the Anthropic spend path;
--   2. call increment_user_daily_scan(<victim id>) 50x to lock a named user out;
--   3. call check_and_increment_scan_rate with an arbitrary p_ip to poison the
--      per-IP burst window for everyone behind that address.
--
-- ── HOW TO RUN ───────────────────────────────────────────────────────────────
--   docker run -d --name pgtest -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=gw postgres:16-alpine
--   ... load a Supabase-shaped fixture (roles anon/authenticated/service_role,
--       auth.uid(), scan_daily_usage, scan_rate_log) and the three RPCs ...
--   psql -f supabase/migrations/20260730000001_val001_scan_quota_lockdown.sql
--   psql -f tests/val_001_quota_lockdown.test.sql
--
--   Every assertion RAISEs on failure, so a clean run means every case passed.
-- ══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_uid    uuid := '11111111-1111-1111-1111-111111111111';
  v_victim uuid := '22222222-2222-2222-2222-222222222222';
  v_sqlstate text;
  v_count  int;
  v_allowed boolean;
BEGIN
  -- ── T1-T3: anon is refused by all three RPCs ──────────────────────────────
  SET LOCAL ROLE anon;

  BEGIN
    PERFORM public.increment_user_daily_scan(v_victim, current_date);
    RAISE EXCEPTION 'T1 FAILED: anon executed increment_user_daily_scan (cross-user quota burn is live)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T1 PASS: anon refused increment_user_daily_scan';
  END;

  BEGIN
    PERFORM public.decrement_user_daily_scan(v_uid, current_date);
    RAISE EXCEPTION 'T2 FAILED: anon executed decrement_user_daily_scan (unlimited free scans are live)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T2 PASS: anon refused decrement_user_daily_scan';
  END;

  BEGIN
    PERFORM * FROM public.check_and_increment_scan_rate('1.2.3.4', v_victim, current_date, 999999, 999999, 999999);
    RAISE EXCEPTION 'T3 FAILED: anon executed check_and_increment_scan_rate (IP poisoning is live)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T3 PASS: anon refused check_and_increment_scan_rate';
  END;

  RESET ROLE;

  -- ── T4-T6: authenticated is refused too ───────────────────────────────────
  -- No client-side caller of these RPCs exists anywhere in src/; the only
  -- callers are in api/analyze.js, which uses the service key. So revoking
  -- `authenticated` costs nothing and closes the logged-in attack path.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  BEGIN
    PERFORM public.increment_user_daily_scan(v_victim, current_date);
    RAISE EXCEPTION 'T4 FAILED: authenticated executed increment_user_daily_scan';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T4 PASS: authenticated refused increment_user_daily_scan';
  END;

  BEGIN
    PERFORM public.decrement_user_daily_scan(v_uid, current_date);
    RAISE EXCEPTION 'T5 FAILED: authenticated executed decrement_user_daily_scan';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T5 PASS: authenticated refused decrement_user_daily_scan';
  END;

  BEGIN
    PERFORM * FROM public.check_and_increment_scan_rate('1.2.3.4', v_uid, current_date, 5, 5, 50);
    RAISE EXCEPTION 'T6 FAILED: authenticated executed check_and_increment_scan_rate';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'T6 PASS: authenticated refused check_and_increment_scan_rate';
  END;

  RESET ROLE;

  -- ── T7-T9: the legitimate service_role path still works ───────────────────
  -- This half matters as much as the refusals. checkRateLimit() in
  -- api/analyze.js is FAIL-CLOSED: any RPC error returns allowed:false. An
  -- over-zealous revoke therefore denies every scan in production rather than
  -- failing visibly, so "service_role still works" is a release gate.
  --
  -- CLEARING THE JWT IS LOAD-BEARING, not tidiness. The RPC's secondary runtime
  -- guard is `IF auth.uid() IS NOT NULL THEN RAISE` — it rejects any caller
  -- carrying a user JWT, because the server's Supabase client carries none. The
  -- claims GUC set for T4-T6 is transaction-local and this whole DO block is one
  -- transaction, so leaving it set makes auth.uid() non-null and the legitimate
  -- service_role path fails with a misleading "server-only" error.
  -- Reset to an empty JSON OBJECT, not an empty string: auth.uid() casts this
  -- GUC with ::json, so '' raises "invalid input syntax for type json" and the
  -- reset itself becomes the failure.
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE service_role;

  DELETE FROM public.scan_daily_usage WHERE user_id = v_uid;

  v_count := public.increment_user_daily_scan(v_uid, current_date);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T7 FAILED: service_role increment returned % (expected 1)', v_count;
  END IF;
  RAISE NOTICE 'T7 PASS: service_role increment works (count=%)', v_count;

  v_count := public.decrement_user_daily_scan(v_uid, current_date);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'T8 FAILED: service_role refund returned % (expected 0)', v_count;
  END IF;
  RAISE NOTICE 'T8 PASS: service_role refund works (count=%)', v_count;

  -- Floors at zero: concurrent refunds must never drive the counter negative.
  v_count := public.decrement_user_daily_scan(v_uid, current_date);
  IF v_count < 0 THEN
    RAISE EXCEPTION 'T9 FAILED: refund drove the counter negative (%)', v_count;
  END IF;
  RAISE NOTICE 'T9 PASS: refund floors at zero (count=%)', v_count;

  -- ── T10: caller-supplied limits cannot widen policy ───────────────────────
  -- The migration keeps the three limit parameters in the signature (dropping
  -- them would change the identity args and force a coordinated deploy) but
  -- clamps them with LEAST() against the server-side authoritative values, so a
  -- caller can only ever be MORE restrictive than policy, never less.
  DELETE FROM public.scan_daily_usage WHERE user_id = v_uid;
  INSERT INTO public.scan_daily_usage(user_id, date, count) VALUES (v_uid, current_date, 100000);

  SELECT allowed INTO v_allowed
  FROM public.check_and_increment_scan_rate('9.9.9.9', v_uid, current_date, 999999, 999999, 999999);

  IF v_allowed THEN
    RAISE EXCEPTION 'T10 FAILED: a caller-supplied daily limit of 999999 overrode the server limit — quota is caller-controlled';
  END IF;
  RAISE NOTICE 'T10 PASS: caller-supplied limits are clamped server-side (allowed=false at 100000 used)';

  DELETE FROM public.scan_daily_usage WHERE user_id = v_uid;
  RESET ROLE;

  RAISE NOTICE '── VAL-001 quota lockdown: ALL 10 ASSERTIONS PASSED ──';
END
$test$;
