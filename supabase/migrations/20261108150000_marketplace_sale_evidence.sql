-- ══════════════════════════════════════════════════════════════════════════════
-- GENUINE GETWORTH SALES AS ISRAELI EVIDENCE, AND THEIR ACCURACY REPORT (founder-approved 2026-11-08)
--
-- Two read-only functions. No table, policy or existing function changes.
-- Rollback: supabase/manual/20261108150000_rollback_marketplace_sale_evidence.sql
--
--   marketplace_sale_evidence(p_since)  — service_role ONLY (the scan server). The completed sales that may stand as
--       Israeli second-hand evidence, and only those:
--         • order completed, with a final price the BUYER confirmed (never the asking price);
--         • buyer and seller different accounts, neither admin nor test;
--         • the listing's price set by the seller (price_source = 'seller_entered'): GetWorth's own number is not
--           independent evidence;
--         • the listing linked to a core-scan valuation (valuation_version 3), whose identity says what was sold;
--         • completed within p_since (default 365 days).
--       It returns no person: an opaque sale reference, the price, the date, the listing's condition and category, and
--       the product identity the scan engine matches on. Buyer-confirmed is not payment-verified, and says so.
--   admin_accuracy_report()  — admins only. Each valuation's prediction against the buyer-confirmed final price of the
--       same listing's sale — only seller-priced listings, genuine accounts, a core-scan price made BEFORE the sale,
--       and never a sale the valuation itself used as evidence. Per category: n, median and quartiles of the absolute
--       percentage error, median absolute error in ₪. With no such sale it returns nothing: accuracy unmeasured.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.marketplace_sale_evidence(p_since timestamptz DEFAULT now() - interval '365 days')
 RETURNS TABLE (sale_ref text, final_price integer, completed_at timestamptz, condition text, category text, verification text, identity jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT left(md5('getworth-sale:' || o.id::text), 16), o.final_price, o.completed_at, l.condition, l.category,
         o.final_price_source, v.ai_raw_response -> 'identity'
  FROM orders o
  JOIN listings l   ON l.id = o.listing_id
  JOIN valuations v ON v.id = l.valuation_id
  WHERE o.status = 'completed'
    AND o.final_price IS NOT NULL AND o.final_price > 0
    AND o.final_price_source = 'buyer_confirmed'
    AND o.buyer_id <> o.seller_id
    AND o.completed_at >= p_since
    AND l.price_source = 'seller_entered'
    AND v.valuation_version = 3
    AND jsonb_typeof(v.ai_raw_response -> 'identity') = 'object'
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id IN (o.buyer_id, o.seller_id) AND (p.is_admin OR p.is_test))
  ORDER BY o.completed_at DESC
  LIMIT 500
$function$;
REVOKE ALL ON FUNCTION public.marketplace_sale_evidence(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_sale_evidence(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_accuracy_report()
 RETURNS TABLE (category text, n integer, median_ape real, ape_p25 real, ape_p75 real, median_abs_error_ils real, anchored_excluded integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT auth_is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH sales AS (
    SELECT l.category, o.final_price::real AS actual, v.price_mid::real AS predicted, l.price_source,
           left(md5('getworth-sale:' || o.id::text), 16) AS sale_ref, v.ai_raw_response AS raw, v.created_at AS valued_at, o.completed_at
    FROM orders o
    JOIN listings l   ON l.id = o.listing_id
    JOIN valuations v ON v.id = l.valuation_id
    WHERE o.status = 'completed' AND o.final_price_source = 'buyer_confirmed' AND o.final_price > 0
      AND o.buyer_id <> o.seller_id
      AND v.valuation_version = 3 AND v.price_mid > 0
      AND v.created_at < o.completed_at
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id IN (o.buyer_id, o.seller_id) AND (p.is_admin OR p.is_test))
      -- Never score a valuation against a sale it used as evidence.
      AND NOT coalesce((v.ai_raw_response -> 'valuation' -> 'evidence_full') @> jsonb_build_array(jsonb_build_object('url', 'getworth:sale:' || left(md5('getworth-sale:' || o.id::text), 16))), false)
  )
  SELECT s.category,
         count(*)::integer,
         (percentile_cont(0.5)  WITHIN GROUP (ORDER BY abs(s.predicted - s.actual) / s.actual))::real,
         (percentile_cont(0.25) WITHIN GROUP (ORDER BY abs(s.predicted - s.actual) / s.actual))::real,
         (percentile_cont(0.75) WITHIN GROUP (ORDER BY abs(s.predicted - s.actual) / s.actual))::real,
         (percentile_cont(0.5)  WITHIN GROUP (ORDER BY abs(s.predicted - s.actual)))::real,
         (SELECT count(*)::integer FROM sales a WHERE a.category = s.category AND a.price_source IS DISTINCT FROM 'seller_entered')
  FROM sales s
  WHERE s.price_source = 'seller_entered'
  GROUP BY s.category
  ORDER BY count(*) DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_accuracy_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_accuracy_report() TO authenticated;
