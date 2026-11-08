-- ══════════════════════════════════════════════════════════════════════════════
-- HISTORICAL TEST-SALE CLEANUP (founder-approved 2026-11-08) — reversible, audited, nothing deleted.
--
-- The read-only audit found that create_comp_from_sale (before 20261108120000) turned every completed order into a
-- comp at its ASKING price, and that six legacy valuations received a "sold price" the same way. All eight completed
-- orders involve the admin account (internal test transactions); none involves two genuine accounts.
--
--   comps        the eight 'getworth' comps whose ONE matching completed order (title, price, completion date) has an
--                admin or test party → is_outlier = true (recalc_product_prices already ignores outliers).
--   valuations   the six with actual_sold_price whose linked listing has exactly one completed order, internal, at that
--                price, and no genuine completed order → actual_sold_price and price_accuracy set to NULL.
--
-- Every old value is written to public.data_correction_log FIRST (append-only; RLS on with no policy, no client
-- grants). A record whose origin is not exactly that is left alone. The batch asserts its own counts and aborts
-- otherwise. Rollback: supabase/manual/20261108140000_rollback_marketplace_test_data_cleanup.sql
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.data_correction_log (
  id           bigserial   PRIMARY KEY,
  batch        text        NOT NULL,
  table_name   text        NOT NULL,
  row_id       uuid        NOT NULL,
  column_name  text        NOT NULL,
  old_value    jsonb,
  new_value    jsonb,
  reason       text        NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_correction_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_correction_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.data_correction_log_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.data_correction_log IS 'Append-only record of data corrections: every value changed, before and after, and why. Server roles only.';

DO $cleanup$
DECLARE
  v_batch  constant text := 'gw-test-sales-2026-11-08';
  v_comps  integer;
  v_vals   integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.data_correction_log WHERE batch = v_batch) THEN
    RAISE NOTICE 'batch % already applied — nothing to do', v_batch;
    RETURN;
  END IF;

  -- ── comps: exactly one matching completed order, and it is internal ──
  CREATE TEMP TABLE _test_comps ON COMMIT DROP AS
  SELECT c.id
  FROM public.comps c
  WHERE c.source = 'getworth' AND c.is_outlier IS DISTINCT FROM true
    AND (SELECT count(*) FROM public.orders o JOIN public.listings l ON l.id = o.listing_id
         WHERE o.status = 'completed' AND l.title = c.title AND o.price = c.price AND o.completed_at::date = c.sold_at::date) = 1
    AND EXISTS (SELECT 1 FROM public.orders o JOIN public.listings l ON l.id = o.listing_id
         WHERE o.status = 'completed' AND l.title = c.title AND o.price = c.price AND o.completed_at::date = c.sold_at::date
           AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (o.buyer_id, o.seller_id) AND (p.is_admin OR p.is_test)));

  -- ── valuations: one completed order on the linked listing, internal, at that price; no genuine completed order ──
  CREATE TEMP TABLE _test_vals ON COMMIT DROP AS
  SELECT v.id
  FROM public.valuations v
  WHERE v.actual_sold_price IS NOT NULL AND v.listing_id IS NOT NULL
    AND (SELECT count(*) FROM public.orders o WHERE o.listing_id = v.listing_id AND o.status = 'completed') = 1
    AND EXISTS (SELECT 1 FROM public.orders o WHERE o.listing_id = v.listing_id AND o.status = 'completed' AND o.price = v.actual_sold_price
                AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (o.buyer_id, o.seller_id) AND (p.is_admin OR p.is_test)))
    AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.listing_id = v.listing_id AND o.status = 'completed'
                    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (o.buyer_id, o.seller_id) AND (p.is_admin OR p.is_test)));

  SELECT count(*) INTO v_comps FROM _test_comps;
  SELECT count(*) INTO v_vals FROM _test_vals;
  IF v_comps <> 8 OR v_vals <> 6 THEN
    RAISE EXCEPTION 'cleanup scope changed since the audit: % comps, % valuations (expected 8 and 6) — nothing modified', v_comps, v_vals;
  END IF;

  -- The snapshot, before any change.
  INSERT INTO public.data_correction_log (batch, table_name, row_id, column_name, old_value, new_value, reason)
  SELECT v_batch, 'comps', c.id, 'is_outlier', to_jsonb(c.is_outlier), 'true'::jsonb,
         'comp created at the asking price of an internal (admin/test) test order'
  FROM public.comps c JOIN _test_comps t ON t.id = c.id;
  INSERT INTO public.data_correction_log (batch, table_name, row_id, column_name, old_value, new_value, reason)
  SELECT v_batch, 'valuations', v.id, col.name, col.val, 'null'::jsonb,
         'sold price recorded from the asking price of an internal (admin/test) test order'
  FROM public.valuations v JOIN _test_vals t ON t.id = v.id
  CROSS JOIN LATERAL (VALUES ('actual_sold_price', to_jsonb(v.actual_sold_price)), ('price_accuracy', to_jsonb(v.price_accuracy))) AS col(name, val);

  UPDATE public.comps SET is_outlier = true WHERE id IN (SELECT id FROM _test_comps);
  UPDATE public.valuations SET actual_sold_price = NULL, price_accuracy = NULL WHERE id IN (SELECT id FROM _test_vals);

  IF (SELECT count(*) FROM public.data_correction_log WHERE batch = v_batch) <> 8 + 6 * 2 THEN
    RAISE EXCEPTION 'snapshot incomplete — aborting';
  END IF;
END
$cleanup$;
