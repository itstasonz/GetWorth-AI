-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-001 — order status transition regression suite.
--
-- Unlike tests/reputation.integration.mjs (read-only, runs against production),
-- this suite MUTATES orders/listings/reviews/notifications and must NEVER be
-- run against production. Run it against a disposable local/staging database:
--
--   supabase start
--   supabase db reset            -- replays supabase/migrations/ in full
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f tests/security_001_order_transitions.test.sql
--
-- Requires a superuser/postgres connection (it uses SET ROLE to impersonate
-- anon/authenticated the same way PostgREST does per-request, and needs
-- postgres privileges to seed/reset fixtures between assertions).
--
-- Every check is a DO block that RAISE EXCEPTIONs on failure and RAISE
-- NOTICEs on success — a non-zero psql exit code means a regression.
-- ══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ── Fixtures — dedicated, easy-to-spot UUID prefix, safe to re-run ────────────
DELETE FROM public.reviews      WHERE reviewer_id::text LIKE '5ec001%' OR seller_id::text LIKE '5ec001%';
DELETE FROM public.notifications WHERE user_id::text LIKE '5ec001%';
DELETE FROM public.orders       WHERE buyer_id::text LIKE '5ec001%' OR seller_id::text LIKE '5ec001%';
DELETE FROM public.listings     WHERE seller_id::text LIKE '5ec001%';
DELETE FROM public.profiles     WHERE id::text LIKE '5ec001%';

INSERT INTO public.profiles (id, full_name, is_admin) VALUES
  ('5ec00100-0000-0000-0000-000000000001', 'SEC001 Buyer',   false),
  ('5ec00100-0000-0000-0000-000000000002', 'SEC001 Seller',  false),
  ('5ec00100-0000-0000-0000-000000000003', 'SEC001 Mallory', false),
  ('5ec00100-0000-0000-0000-000000000009', 'SEC001 Admin',   true);

INSERT INTO public.listings (id, seller_id, title, price, status) VALUES
  ('5ec00200-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000002', 'SEC001 Listing 1', 100, 'active'),
  ('5ec00200-0000-0000-0000-000000000002', '5ec00100-0000-0000-0000-000000000002', 'SEC001 Listing 2', 200, 'active');

INSERT INTO public.orders (id, listing_id, buyer_id, seller_id, price, status) VALUES
  ('5ec00300-0000-0000-0000-000000000001', '5ec00200-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000002', 100, 'pending'),
  ('5ec00300-0000-0000-0000-000000000002', '5ec00200-0000-0000-0000-000000000002', '5ec00100-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000002', 200, 'pending');

\echo '── N1: direct client UPDATE of orders.status is rejected (REST PATCH / supabase.update() equivalent) ──'
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
    UPDATE public.orders SET status = 'completed' WHERE id = '5ec00300-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: N1 — direct UPDATE of orders.status succeeded, should have been rejected';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: N1 — direct client UPDATE rejected (%)', SQLERRM;
  END;
END $$;

\echo '── N2: direct client INSERT of a pre-completed order is rejected ──'
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000003","role":"authenticated"}', true);
    INSERT INTO public.orders (listing_id, buyer_id, seller_id, price, status)
    VALUES ('5ec00200-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000003', '5ec00100-0000-0000-0000-000000000002', 100, 'completed');
    RAISE EXCEPTION 'FAIL: N2 — direct INSERT of a completed order succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: N2 — direct client INSERT rejected (%)', SQLERRM;
  END;
END $$;

\echo '── P1..P3 / N3..N6: full legal lifecycle via transition_order(), wrong-role and invalid-jump rejection ──'
DO $$
DECLARE v_result jsonb;
BEGIN
  -- N3: buyer cannot accept their own order (seller-only)
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
    PERFORM transition_order('5ec00300-0000-0000-0000-000000000001', 'accepted');
    RAISE EXCEPTION 'FAIL: N3 — buyer performed a seller-only transition';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%seller%' THEN RAISE EXCEPTION 'FAIL: N3 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N3 — wrong-role transition rejected (%)', SQLERRM;
  END;

  -- P1: seller accepts
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000002","role":"authenticated"}', true);
  v_result := transition_order('5ec00300-0000-0000-0000-000000000001', 'accepted');
  IF v_result->>'status' <> 'accepted' THEN RAISE EXCEPTION 'FAIL: P1 — accept did not apply'; END IF;
  RAISE NOTICE 'PASS: P1 — seller accepted pending order';

  -- N4: invalid jump accepted -> completed
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
    PERFORM transition_order('5ec00300-0000-0000-0000-000000000001', 'completed');
    RAISE EXCEPTION 'FAIL: N4 — accepted -> completed should be an invalid transition';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Invalid transition%' THEN RAISE EXCEPTION 'FAIL: N4 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N4 — invalid transition (accepted -> completed) rejected';
  END;

  -- P2: seller ships
  PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000002","role":"authenticated"}', true);
  v_result := transition_order('5ec00300-0000-0000-0000-000000000001', 'shipped');
  IF v_result->>'status' <> 'shipped' THEN RAISE EXCEPTION 'FAIL: P2 — ship did not apply'; END IF;
  RAISE NOTICE 'PASS: P2 — seller shipped';

  -- N5: seller cannot mark delivered (buyer-only)
  BEGIN
    PERFORM transition_order('5ec00300-0000-0000-0000-000000000001', 'delivered');
    RAISE EXCEPTION 'FAIL: N5 — seller performed a buyer-only transition';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%buyer%' THEN RAISE EXCEPTION 'FAIL: N5 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N5 — wrong-role transition rejected (%)', SQLERRM;
  END;

  -- P3: buyer marks delivered then completes; side effects fire
  PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
  PERFORM transition_order('5ec00300-0000-0000-0000-000000000001', 'delivered');
  v_result := transition_order('5ec00300-0000-0000-0000-000000000001', 'completed');
  IF v_result->>'status' <> 'completed' THEN RAISE EXCEPTION 'FAIL: P3 — completion did not apply'; END IF;
  RAISE NOTICE 'PASS: P3 — buyer completed order';

  -- N6: replay — completed is terminal
  BEGIN
    PERFORM transition_order('5ec00300-0000-0000-0000-000000000001', 'completed');
    RAISE EXCEPTION 'FAIL: N6 — replaying completion on a terminal order succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Order is already in terminal state%' THEN RAISE EXCEPTION 'FAIL: N6 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N6 — duplicate/replay completion rejected';
  END;
END $$;

\echo '── P4: side-effect parity — listing sold, review unlocked, total_sales incremented, exactly one completion notification ──'
DO $$
DECLARE
  v_listing_status text;
  v_review_count   int;
  v_total_sales    int;
  v_notif_count    int;
BEGIN
  SET LOCAL ROLE postgres;
  SELECT status INTO v_listing_status FROM public.listings WHERE id = '5ec00200-0000-0000-0000-000000000001';
  IF v_listing_status <> 'sold' THEN RAISE EXCEPTION 'FAIL: P4 — listing not marked sold on completion (got %)', v_listing_status; END IF;

  SELECT count(*) INTO v_notif_count FROM public.notifications
  WHERE type = 'ORDER_COMPLETED' AND (data->>'order_id')::uuid = '5ec00300-0000-0000-0000-000000000001';
  IF v_notif_count <> 1 THEN RAISE EXCEPTION 'FAIL: P4 — expected exactly 1 completion notification, got %', v_notif_count; END IF;

  -- total_sales is a recompute-from-source trigger that already fired when
  -- the P1..P3 block committed the completion above — assert the resulting
  -- absolute value, not a before/after delta from this block's own actions.
  SELECT total_sales INTO v_total_sales FROM public.profiles WHERE id = '5ec00100-0000-0000-0000-000000000002';
  IF v_total_sales <> 1 THEN RAISE EXCEPTION 'FAIL: P4 — total_sales should be 1 after one completed order, got %', v_total_sales; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
  INSERT INTO public.reviews (order_id, reviewer_id, seller_id, rating, comment, reviewer_role)
  VALUES ('5ec00300-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000002', 5, '5ec001 test review', 'buyer');

  SET LOCAL ROLE postgres;
  SELECT count(*) INTO v_review_count FROM public.reviews WHERE order_id = '5ec00300-0000-0000-0000-000000000001';
  IF v_review_count <> 1 THEN RAISE EXCEPTION 'FAIL: P4 — review was not accepted for a completed order'; END IF;

  RAISE NOTICE 'PASS: P4 — listing sold, review unlocked, total_sales %, exactly 1 notification', v_total_sales;
END $$;

\echo '── N7: fabricated review against a still-pending order is rejected ──'
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
    INSERT INTO public.reviews (order_id, reviewer_id, seller_id, rating, comment, reviewer_role)
    VALUES ('5ec00300-0000-0000-0000-000000000002', '5ec00100-0000-0000-0000-000000000001', '5ec00100-0000-0000-0000-000000000002', 5, 'fraud', 'buyer');
    RAISE EXCEPTION 'FAIL: N7 — review accepted against a non-completed order';
  EXCEPTION
    WHEN insufficient_privilege OR others THEN
      RAISE NOTICE 'PASS: N7 — review against a pending order rejected';
  END;
END $$;

\echo '── N8/N9: not-a-party rejection, unauthenticated rejection ──'
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000003","role":"authenticated"}', true);
    PERFORM transition_order('5ec00300-0000-0000-0000-000000000002', 'accepted');
    RAISE EXCEPTION 'FAIL: N8 — non-party transitioned an order that is not theirs';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%party%' THEN RAISE EXCEPTION 'FAIL: N8 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N8 — non-party rejected';
  END;

  BEGIN
    SET LOCAL ROLE anon;
    PERFORM transition_order('5ec00300-0000-0000-0000-000000000002', 'accepted');
    RAISE EXCEPTION 'FAIL: N9 — anon role executed transition_order';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: N9 — unauthenticated/anon rejected (%)', SQLERRM;
  END;
END $$;

\echo '── N10/N11/P5: admin escape hatch — terminal states immutable, legitimate override has full side-effect parity ──'
DO $$
DECLARE v_listing_status text; v_notif_count int;
BEGIN
  SET LOCAL ROLE postgres;

  -- N10: admin cannot un-complete a terminal order
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000009","role":"authenticated"}', true);
    PERFORM admin_update_order_status('5ec00300-0000-0000-0000-000000000001', 'pending');
    RAISE EXCEPTION 'FAIL: N10 — admin reversed a terminal (completed) order';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Order is already in terminal state%' THEN RAISE EXCEPTION 'FAIL: N10 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N10 — admin cannot leave a terminal state';
  END;

  -- P5: admin legitimately force-completes a stuck order, full parity
  SET LOCAL ROLE postgres;
  UPDATE public.orders SET status = 'delivered' WHERE id = '5ec00300-0000-0000-0000-000000000002';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000009","role":"authenticated"}', true);
  PERFORM admin_update_order_status('5ec00300-0000-0000-0000-000000000002', 'completed');

  SET LOCAL ROLE postgres;
  SELECT status INTO v_listing_status FROM public.listings WHERE id = '5ec00200-0000-0000-0000-000000000002';
  IF v_listing_status <> 'sold' THEN RAISE EXCEPTION 'FAIL: P5 — admin completion did not mark listing sold'; END IF;

  SELECT count(*) INTO v_notif_count FROM public.notifications
  WHERE type = 'ORDER_COMPLETED' AND (data->>'order_id')::uuid = '5ec00300-0000-0000-0000-000000000002';
  IF v_notif_count < 1 THEN RAISE EXCEPTION 'FAIL: P5 — admin completion created no notification'; END IF;
  RAISE NOTICE 'PASS: P5 — admin override has full side-effect parity with transition_order()';

  -- N11: replay admin completion
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000009","role":"authenticated"}', true);
    PERFORM admin_update_order_status('5ec00300-0000-0000-0000-000000000002', 'completed');
    RAISE EXCEPTION 'FAIL: N11 — admin replayed completion on an already-completed order';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Order is already in terminal state%' THEN RAISE EXCEPTION 'FAIL: N11 — wrong error: %', SQLERRM; END IF;
      RAISE NOTICE 'PASS: N11 — admin replay/duplicate completion rejected';
  END;
END $$;

\echo '── N12: non-admin calling admin_update_order_status ──'
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', '{"sub":"5ec00100-0000-0000-0000-000000000001","role":"authenticated"}', true);
    PERFORM admin_update_order_status('5ec00300-0000-0000-0000-000000000001', 'pending');
    RAISE EXCEPTION 'FAIL: N12 — non-admin called admin_update_order_status successfully';
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: N12 — non-admin rejected (%)', SQLERRM;
  END;
END $$;

\echo ''
\echo '════════════════════════════════════════════════════════════════════════'
\echo 'SECURITY-001: all order-transition regression checks passed.'
\echo '════════════════════════════════════════════════════════════════════════'

-- Cleanup
SET ROLE postgres;
DELETE FROM public.reviews      WHERE reviewer_id::text LIKE '5ec001%' OR seller_id::text LIKE '5ec001%';
DELETE FROM public.notifications WHERE user_id::text LIKE '5ec001%';
DELETE FROM public.orders       WHERE buyer_id::text LIKE '5ec001%' OR seller_id::text LIKE '5ec001%';
DELETE FROM public.listings     WHERE seller_id::text LIKE '5ec001%';
DELETE FROM public.profiles     WHERE id::text LIKE '5ec001%';
