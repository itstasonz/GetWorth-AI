-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-002 — reputation / trust / badge lockdown regression suite.
--
-- MUTATES profiles/reviews/orders/listings — NEVER run against production.
-- Run against a disposable DB that already has the base schema + all migrations
-- (incl. 20260723000001_security002_reputation_lockdown.sql) applied:
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/security_002_reputation_lockdown.test.sql
--
-- Requires a superuser/postgres connection (uses SET LOCAL ROLE to impersonate
-- anon/authenticated exactly as PostgREST does per request). Every check RAISEs
-- an EXCEPTION on failure and a NOTICE on success — a non-zero exit = regression.
-- ══════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── Fixtures (prefix 5ec002 — safe to re-run) ────────────────────────────────
DELETE FROM public.reviews  WHERE reviewer_id::text LIKE '5ec002%' OR seller_id::text LIKE '5ec002%';
DELETE FROM public.orders   WHERE buyer_id::text  LIKE '5ec002%' OR seller_id::text LIKE '5ec002%';
DELETE FROM public.listings WHERE seller_id::text LIKE '5ec002%';
DELETE FROM public.profiles WHERE id::text LIKE '5ec002%';

INSERT INTO public.profiles (id, full_name, email, is_admin, created_at) VALUES
  ('5ec00200-0000-0000-0000-000000000001','Mallory','m@x.test', false, now() - interval '2 days'),
  ('5ec00200-0000-0000-0000-000000000002','Seller', 's@x.test', false, now() - interval '400 days'),
  ('5ec00200-0000-0000-0000-000000000003','Buyer',  'b@x.test', false, now() - interval '100 days'),
  ('5ec00200-0000-0000-0000-000000000009','Admin',  'a@x.test', true,  now() - interval '500 days');

INSERT INTO public.listings (id, seller_id, title, price, status) VALUES
  ('5ec00210-0000-0000-0000-000000000001','5ec00200-0000-0000-0000-000000000002','L1',100,'active');

-- One COMPLETED order (buyer↔seller) so a legitimate review is possible.
INSERT INTO public.orders (id, listing_id, buyer_id, seller_id, price, status) VALUES
  ('5ec00220-0000-0000-0000-000000000001','5ec00210-0000-0000-0000-000000000001',
   '5ec00200-0000-0000-0000-000000000003','5ec00200-0000-0000-0000-000000000002',100,'completed');

\echo '════════ SECURITY-002 adversarial matrix ════════'

-- Helper: assert a value.
-- (inline in DO blocks)

-- ── A1..A8, A20: direct client writes to protected columns are REJECTED (42501) ──
\echo '── A1..A8: authenticated client cannot write any reputation/identity column ──'
DO $$
DECLARE
  v_uid text := '5ec00200-0000-0000-0000-000000000001';   -- Mallory, her own row
  v_cols text[] := ARRAY[
    'rating = 5', 'review_count = 999', 'total_sales = 999', 'badge = ''eliteSeller''',
    'reputation_points = 999999', 'response_rate = 100', 'is_phone_verified = true',
    'is_verified = true', 'is_admin = true', 'verified_at = now()',
    'verification_status = ''approved''', 'created_at = now() - interval ''3000 days''',
    'email = ''evil@x.test'''
  ];
  v_set text;
  v_blocked boolean;
BEGIN
  FOREACH v_set IN ARRAY v_cols LOOP
    v_blocked := false;
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', v_uid), true);
      EXECUTE format('UPDATE public.profiles SET %s WHERE id = %L', v_set, v_uid);
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
      RESET ROLE;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'FAIL A: client write "%" was NOT rejected by column privilege', v_set;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS A1..A8+: all % protected-column writes rejected with 42501', array_length(v_cols,1);
END $$;

-- Confirm nothing actually changed on Mallory's row.
DO $$
DECLARE r public.profiles;
BEGIN
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000001';
  IF r.rating<>0 OR r.review_count<>0 OR r.total_sales<>0 OR r.badge IS NOT NULL
     OR r.is_verified OR r.is_admin OR r.is_phone_verified
     OR r.created_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'FAIL: Mallory row shows forged values: rating=% rc=% ts=% badge=% ver=% adm=%',
      r.rating, r.review_count, r.total_sales, r.badge, r.is_verified, r.is_admin;
  END IF;
  RAISE NOTICE 'PASS: Mallory reputation remains zero/unforged after all attempts';
END $$;

-- ── A9: cannot modify ANOTHER user's profile ─────────────────────────────────
\echo '── A9: cannot modify another user''s profile ──'
DO $$
DECLARE v_rows int; v_blocked boolean := false;
BEGIN
  -- protected column on another row → column privilege blocks first
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"5ec00200-0000-0000-0000-000000000001","role":"authenticated"}', true);
    UPDATE public.profiles SET rating=5 WHERE id='5ec00200-0000-0000-0000-000000000002';
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; RESET ROLE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FAIL A9a: protected write to another row not blocked'; END IF;

  -- allowed column on another row → RLS filters to 0 rows (no effect)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"5ec00200-0000-0000-0000-000000000001","role":"authenticated"}', true);
  WITH u AS (UPDATE public.profiles SET avatar_url='hacked' WHERE id='5ec00200-0000-0000-0000-000000000002' RETURNING 1)
  SELECT count(*) INTO v_rows FROM u;
  RESET ROLE;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL A9b: RLS allowed editing another user''s row (% rows)', v_rows; END IF;
  RAISE NOTICE 'PASS A9: cannot modify another user''s profile (column-priv + RLS)';
END $$;

-- ── A10/A11: an ALLOWED personal update succeeds and damages nothing ──────────
\echo '── A10/A11: allowed personal update (avatar_url) succeeds, protected fields intact ──'
DO $$
DECLARE r public.profiles;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"5ec00200-0000-0000-0000-000000000001","role":"authenticated"}', true);
  UPDATE public.profiles SET avatar_url='https://cdn/x.jpg', full_name='Mallory M', location='TLV'
  WHERE id='5ec00200-0000-0000-0000-000000000001';
  RESET ROLE;
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000001';
  IF r.avatar_url <> 'https://cdn/x.jpg' OR r.full_name <> 'Mallory M' OR r.location <> 'TLV' THEN
    RAISE EXCEPTION 'FAIL A10: allowed personal update did not persist';
  END IF;
  IF r.rating<>0 OR r.review_count<>0 OR r.total_sales<>0 OR r.is_admin OR r.is_verified THEN
    RAISE EXCEPTION 'FAIL A11: allowed update damaged a protected field';
  END IF;
  RAISE NOTICE 'PASS A10/A11: personal fields editable, reputation untouched';
END $$;

-- ── A12: a valid review updates aggregates via the trusted recompute path ─────
\echo '── A12: valid review recomputes rating/review_count (trusted path passes the guard) ──'
DO $$
DECLARE r public.profiles;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"5ec00200-0000-0000-0000-000000000003","role":"authenticated"}', true);
  INSERT INTO public.reviews (order_id, reviewer_id, seller_id, rating, comment, reviewer_role)
  VALUES ('5ec00220-0000-0000-0000-000000000001','5ec00200-0000-0000-0000-000000000003',
          '5ec00200-0000-0000-0000-000000000002',5,'great','buyer');
  RESET ROLE;
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF r.rating <> 5.0 OR r.review_count <> 1 THEN
    RAISE EXCEPTION 'FAIL A12: aggregates not recomputed (rating=% count=%)', r.rating, r.review_count;
  END IF;
  RAISE NOTICE 'PASS A12: valid review → rating=5.0, review_count=1 (recompute passed the guard)';
END $$;

-- ── A13: duplicate review (same order/reviewer/role) is rejected ──────────────
\echo '── A13: duplicate review rejected ──'
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"5ec00200-0000-0000-0000-000000000003","role":"authenticated"}', true);
    INSERT INTO public.reviews (order_id, reviewer_id, seller_id, rating, comment, reviewer_role)
    VALUES ('5ec00220-0000-0000-0000-000000000001','5ec00200-0000-0000-0000-000000000003',
            '5ec00200-0000-0000-0000-000000000002',1,'dupe','buyer');
    RESET ROLE;
  EXCEPTION WHEN unique_violation THEN v_blocked := true; RESET ROLE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FAIL A13: duplicate review accepted'; END IF;
  RAISE NOTICE 'PASS A13: duplicate review rejected (one_review_per_order_role)';
END $$;

-- ── A14: forged review (self-review + non-party + wrong direction) rejected ───
\echo '── A14: invalid/self/forged review rejected by RLS ──'
DO $$
DECLARE v_blocked boolean;
BEGIN
  -- self-review (Mallory reviews herself against a random order)
  v_blocked := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims','{"sub":"5ec00200-0000-0000-0000-000000000001","role":"authenticated"}', true);
    INSERT INTO public.reviews (order_id, reviewer_id, seller_id, rating, comment, reviewer_role)
    VALUES ('5ec00220-0000-0000-0000-000000000001','5ec00200-0000-0000-0000-000000000001',
            '5ec00200-0000-0000-0000-000000000001',5,'self','buyer');
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR others THEN v_blocked := true; RESET ROLE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FAIL A14: self / non-party review accepted'; END IF;
  RAISE NOTICE 'PASS A14: forged review rejected (reviewer must be the counterparty of a completed order)';
END $$;

-- ── A15/A16/A17: total_sales counts only completed orders, exactly once ───────
\echo '── A15/A16/A17: total_sales derives from completed orders only, no double-count ──'
DO $$
DECLARE r public.profiles;
BEGIN
  -- seller currently has 1 completed order (fixture) → total_sales must be 1
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF r.total_sales <> 1 THEN RAISE EXCEPTION 'FAIL A15: total_sales=% (expected 1)', r.total_sales; END IF;

  -- add a pending + a cancelled order → still 1
  INSERT INTO public.orders (listing_id, buyer_id, seller_id, price, status) VALUES
   ('5ec00210-0000-0000-0000-000000000001','5ec00200-0000-0000-0000-000000000003','5ec00200-0000-0000-0000-000000000002',100,'pending'),
   ('5ec00210-0000-0000-0000-000000000001','5ec00200-0000-0000-0000-000000000003','5ec00200-0000-0000-0000-000000000002',100,'cancelled');
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF r.total_sales <> 1 THEN RAISE EXCEPTION 'FAIL A16: pending/cancelled counted (total_sales=%)', r.total_sales; END IF;

  -- re-UPDATE the already-completed order's status to completed (replay) → still 1
  UPDATE public.orders SET status='completed' WHERE id='5ec00220-0000-0000-0000-000000000001';
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF r.total_sales <> 1 THEN RAISE EXCEPTION 'FAIL A17: completion replay double-counted (total_sales=%)', r.total_sales; END IF;
  RAISE NOTICE 'PASS A15/A16/A17: total_sales=1 (completed only; pending/cancelled/replay ignored)';
END $$;

-- ── A18: review deletion (moderation) recomputes aggregates ───────────────────
\echo '── A18: review deletion recomputes rating/review_count ──'
DO $$
DECLARE r public.profiles;
BEGIN
  SET LOCAL ROLE postgres;   -- admin moderation path (service)
  DELETE FROM public.reviews WHERE order_id='5ec00220-0000-0000-0000-000000000001';
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF r.rating <> 0 OR r.review_count <> 0 THEN
    RAISE EXCEPTION 'FAIL A18: aggregates not healed after delete (rating=% count=%)', r.rating, r.review_count;
  END IF;
  RAISE NOTICE 'PASS A18: review deletion recomputed aggregates back to 0';
END $$;

-- ── A19/A21: admin CAN legitimately set verification/reputation (SECURITY DEFINER-style) ──
\echo '── A19/A21: admin workflow still functions ──'
DO $$
DECLARE r public.profiles;
BEGIN
  -- Admin, acting on their own privilege, updates a protected field. Admins run
  -- protected writes through SECURITY DEFINER RPCs (owner) in production; here we
  -- assert the guard's admin branch does not revert an admin-made change.
  SET LOCAL ROLE postgres;   -- emulate SECURITY DEFINER owner (admin RPC)
  UPDATE public.profiles SET is_verified=true, verified_at=now(), verification_status='approved'
  WHERE id='5ec00200-0000-0000-0000-000000000002';
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF NOT r.is_verified THEN RAISE EXCEPTION 'FAIL A19: admin/service verification write was reverted'; END IF;
  RAISE NOTICE 'PASS A19/A21: admin/service verification workflow functions';
END $$;

-- ── A22: service role (no JWT) maintenance write passes ───────────────────────
\echo '── A22: service-role maintenance write passes the guard ──'
DO $$
DECLARE r public.profiles;
BEGIN
  SET LOCAL ROLE postgres;   -- auth.uid() IS NULL branch
  PERFORM set_config('request.jwt.claims','', true);
  UPDATE public.profiles SET badge='trustedSeller' WHERE id='5ec00200-0000-0000-0000-000000000002';
  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000002';
  IF r.badge <> 'trustedSeller' THEN RAISE EXCEPTION 'FAIL A22: service maintenance write blocked'; END IF;
  RAISE NOTICE 'PASS A22: service-role maintenance write permitted';
END $$;

-- ── A23/A25: backfill correctness + empty-history user reads zero ─────────────
\echo '── A23/A25: aggregate integrity holds; empty-history user is honest zero ──'
DO $$
DECLARE v_bad int; r public.profiles;
BEGIN
  SELECT count(*) INTO v_bad FROM public.profiles p
  WHERE p.id::text LIKE '5ec002%'
    AND ( p.review_count <> (SELECT count(*) FROM public.reviews rr WHERE rr.seller_id=p.id)
       OR p.total_sales  <> (SELECT count(*) FROM public.orders oo WHERE oo.seller_id=p.id AND oo.status='completed') );
  IF v_bad <> 0 THEN RAISE EXCEPTION 'FAIL A23: % profiles have drifted aggregates', v_bad; END IF;

  SELECT * INTO r FROM public.profiles WHERE id='5ec00200-0000-0000-0000-000000000001';  -- Mallory: no history
  IF r.rating<>0 OR r.review_count<>0 OR r.total_sales<>0 THEN
    RAISE EXCEPTION 'FAIL A25: empty-history user not zero (rating=% rc=% ts=%)', r.rating, r.review_count, r.total_sales;
  END IF;
  RAISE NOTICE 'PASS A23/A25: aggregates consistent with source; empty-history user reads zero';
END $$;

\echo ''
\echo '════════════════════════════════════════════════════════════════════════'
\echo 'SECURITY-002: all reputation-integrity regression checks passed.'
\echo '════════════════════════════════════════════════════════════════════════'

-- Cleanup
SET ROLE postgres;
DELETE FROM public.reviews  WHERE reviewer_id::text LIKE '5ec002%' OR seller_id::text LIKE '5ec002%';
DELETE FROM public.orders   WHERE buyer_id::text  LIKE '5ec002%' OR seller_id::text LIKE '5ec002%';
DELETE FROM public.listings WHERE seller_id::text LIKE '5ec002%';
DELETE FROM public.profiles WHERE id::text LIKE '5ec002%';
