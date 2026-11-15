-- ══════════════════════════════════════════════════════════════════════════════
-- FIRST-PARTY EVIDENCE CLASSES (2026-11-15). ADDITIVE: two nullable columns on listings/orders, one new RPC, three
-- functions replaced with the same signatures (grants kept). No existing row is written: legacy rows stay NULL =
-- unknown origin, and nothing is inferred for them.
-- Rollback: supabase/manual/20261115120000_rollback_first_party_evidence_classes.sql
--
-- PART 1  listings.price_origin — WHERE A LISTING PRICE CAME FROM, not only how close it is to GetWorth's number:
--           'independent'         no GetWorth used-market price had been shown for this product to this seller: the
--                                 linked valuation priced nothing and none of the seller's earlier core scans of the
--                                 same product did either;
--           'after_suggestion'    the seller typed a price after a GetWorth price was shown (influenced, whatever the
--                                 amount);
--           'getworth_prefilled'  GetWorth's number, left as filled (or within 2% / ₪5 of a number shown);
--           NULL                  before this migration, or no valuation linked: unknown.
--         Set by the trigger from the database's own record; the client's stated origin can only make it STRICTER.
--         The seller's freedom is untouched: any price may be listed; the origin decides only whether it is evidence.
-- PART 2  orders.seller_final_price — the seller's own statement of the final price, recorded once, after completion,
--         through record_sale_price(). The buyer may also record theirs there if they skipped it at completion.
--         Both statements equal = 'mutually_reported': two parties' word, NOT a verified payment (no payment rail).
-- PART 3  the evidence functions: an asking price counts only when 'independent'; a sale only when mutually reported,
--         one per buyer–seller pair per product.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PART 1 ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS price_origin text;
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_price_origin_valid;
ALTER TABLE public.listings ADD CONSTRAINT listings_price_origin_valid
  CHECK (price_origin IS NULL OR price_origin IN ('independent', 'after_suggestion', 'getworth_prefilled'));
COMMENT ON COLUMN public.listings.price_origin IS 'independent: no GetWorth used price had been shown for the product to the seller; after_suggestion: typed after one was shown; getworth_prefilled: GetWorth''s number. Set by trigger (client may only make it stricter). NULL = unknown (before 2026-11-15 or no valuation).';

CREATE OR REPLACE FUNCTION public.listings_set_price_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_low      numeric;
  v_mid      numeric;
  v_high     numeric;
  v_prices   jsonb;
  v_user     uuid;
  v_name     text;
  v_suggest  numeric;
  v_matched  boolean := false;
  v_shown    boolean := false;
  v_floor    int;
  -- The seller's own word, which can only make things stricter (independence is never taken on a client's say-so).
  v_claimed  text := NEW.price_source;
  v_claim_o  int := CASE NEW.price_origin WHEN 'independent' THEN 0 WHEN 'after_suggestion' THEN 1 WHEN 'getworth_prefilled' THEN 2 END;
BEGIN
  NEW.price_source    := 'seller_entered';
  NEW.suggested_price := NULL;
  IF NEW.valuation_id IS NULL THEN
    IF v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
    -- No valuation: nothing in the database says what the seller saw. Origin unknown unless the client says stricter.
    NEW.price_origin := CASE WHEN v_claim_o >= 1 THEN NEW.price_origin END;
    RETURN NEW;
  END IF;

  SELECT price_low, price_mid, price_high, ai_raw_response->'valuation'->'prices', user_id,
         coalesce(ai_raw_response->'identity'->>'canonical_name', ai_raw_response->'identity'->>'display_name')
    INTO v_low, v_mid, v_high, v_prices, v_user, v_name
  FROM valuations WHERE id = NEW.valuation_id;
  IF NOT FOUND THEN
    IF v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
    NEW.price_origin := CASE WHEN v_claim_o >= 1 THEN NEW.price_origin END;
    RETURN NEW;
  END IF;

  -- Every number the valuation could have shown: its stored range, and each condition's list / worth / quick / low / high.
  SELECT bool_or(abs(NEW.price - c) <= greatest(5, 0.02 * c)), bool_or(true) INTO v_matched, v_shown
  FROM (
    SELECT unnest(ARRAY[v_low, v_mid, v_high]) AS c
    UNION ALL
    SELECT (b.value->>k)::numeric
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_prices) = 'object' THEN v_prices ELSE '{}'::jsonb END) b
    CROSS JOIN unnest(ARRAY['list', 'worth', 'quick', 'low', 'high']) k
    WHERE jsonb_typeof(b.value) = 'object' AND (b.value->>k) ~ '^[0-9]+(\.[0-9]+)?$'
  ) s
  WHERE c IS NOT NULL AND c > 0;
  v_shown := coalesce(v_shown, false);

  -- The same seller's EARLIER core scans of the same product: a price shown there was seen too.
  IF NOT v_shown AND v_name IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM valuations o
      WHERE o.user_id = coalesce(NEW.seller_id, v_user) AND o.id <> NEW.valuation_id AND o.valuation_version = 3
        AND o.price_mid > 0 AND o.created_at <= now()
        AND coalesce(o.ai_raw_response->'identity'->>'canonical_name', o.ai_raw_response->'identity'->>'display_name') = v_name
    ) INTO v_shown;
  END IF;

  IF (v_prices->'good'->>'list') ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_suggest := (v_prices->'good'->>'list')::numeric;
  ELSE
    v_suggest := v_mid;
  END IF;

  IF v_matched IS TRUE OR v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
  NEW.suggested_price := CASE WHEN v_suggest > 0 THEN round(v_suggest)::integer ELSE NULL END;

  v_floor := CASE WHEN NEW.price_source = 'getworth_valuation' THEN 2 WHEN v_shown THEN 1 ELSE 0 END;
  NEW.price_origin := (ARRAY['independent', 'after_suggestion', 'getworth_prefilled'])[greatest(v_floor, coalesce(v_claim_o, 0)) + 1];
  RETURN NEW;
END;
$function$;

-- Any write that touches the price or its provenance recomputes it — a client cannot relabel a row directly.
DROP TRIGGER IF EXISTS trg_listings_price_provenance ON public.listings;
CREATE TRIGGER trg_listings_price_provenance
  BEFORE INSERT OR UPDATE OF price, valuation_id, price_source, price_origin, suggested_price ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.listings_set_price_provenance();

-- ── PART 2 ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_final_price integer;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS seller_final_price_at timestamptz;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_seller_final_price_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_seller_final_price_valid
  CHECK ((seller_final_price IS NULL) = (seller_final_price_at IS NULL)
     AND (seller_final_price IS NULL OR (seller_final_price > 0 AND seller_final_price <= 100000000)));
COMMENT ON COLUMN public.orders.seller_final_price IS 'Final price the SELLER stated after completion (record_sale_price). Equal to final_price = mutually reported; still not a verified payment.';

-- record_sale_price: the caller states the final price of a COMPLETED order they are a party to, once per side.
CREATE OR REPLACE FUNCTION public.record_sale_price(p_order_id uuid, p_price integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_order orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_price IS NULL OR p_price < 1 OR p_price > 100000000 THEN
    RAISE EXCEPTION 'price must be a whole number of shekels between 1 and 100000000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR (v_order.buyer_id <> v_uid AND v_order.seller_id <> v_uid) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed order has a final price' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_order.buyer_id = v_order.seller_id THEN
    RAISE EXCEPTION 'A party cannot confirm its own purchase' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_uid = v_order.seller_id THEN
    IF v_order.seller_final_price IS NOT NULL THEN
      RAISE EXCEPTION 'The seller''s final price is already recorded' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE orders SET seller_final_price = p_price, seller_final_price_at = now(), updated_at = now() WHERE id = p_order_id;
  ELSE
    IF v_order.final_price IS NOT NULL THEN
      RAISE EXCEPTION 'The buyer''s final price is already recorded' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE orders SET final_price = p_price, final_price_source = 'buyer_confirmed', final_price_confirmed_at = now(), updated_at = now()
    WHERE id = p_order_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_sale_price(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_sale_price(uuid, integer) TO authenticated;

-- ── PART 3 ─────────────────────────────────────────────────────────────────────
-- Asking prices: as 20261113190000, plus price_origin = 'independent'.
CREATE OR REPLACE FUNCTION public.marketplace_listing_evidence(p_since timestamptz DEFAULT now() - interval '120 days')
 RETURNS TABLE (listing_ref text, seller_ref text, price integer, created_at timestamptz, updated_at timestamptz, condition text, category text, identity jsonb)
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH salt AS MATERIALIZED (SELECT gen_random_uuid()::text AS s)
  SELECT DISTINCT ON (l.seller_id, coalesce(v.ai_raw_response -> 'identity' ->> 'canonical_name', v.ai_raw_response -> 'identity' ->> 'display_name'))
         left(md5('getworth-listing:' || l.id::text), 16), left(md5(salt.s || ':' || l.seller_id::text), 16),
         l.price::integer, l.created_at, l.updated_at, l.condition, l.category,
         jsonb_strip_nulls(jsonb_build_object(
           'canonical_name',   v.ai_raw_response -> 'identity' -> 'canonical_name',
           'display_name',     v.ai_raw_response -> 'identity' -> 'display_name',
           'brand',            v.ai_raw_response -> 'identity' -> 'brand',
           'model',            v.ai_raw_response -> 'identity' -> 'model',
           'product_family',   v.ai_raw_response -> 'identity' -> 'product_family',
           'item_type',        v.ai_raw_response -> 'identity' -> 'item_type',
           'variant',          v.ai_raw_response -> 'identity' -> 'variant',
           'size_or_capacity', v.ai_raw_response -> 'identity' -> 'size_or_capacity',
           'configuration',    v.ai_raw_response -> 'identity' -> 'configuration',
           'model_number',     v.ai_raw_response -> 'identity' -> 'model_number',
           'confirmed',        v.ai_raw_response -> 'identity' -> 'confirmed'))
  FROM listings l
  JOIN valuations v ON v.id = l.valuation_id
  CROSS JOIN salt
  WHERE l.status = 'active'
    AND l.price IS NOT NULL AND l.price > 0
    AND l.price_source = 'seller_entered'
    AND l.price_origin = 'independent'
    AND l.created_at >= p_since
    AND v.valuation_version = 3
    AND v.user_id = l.seller_id
    AND jsonb_typeof(v.ai_raw_response -> 'identity') = 'object'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = l.seller_id AND NOT p.is_admin AND NOT p.is_test)
  ORDER BY l.seller_id, coalesce(v.ai_raw_response -> 'identity' ->> 'canonical_name', v.ai_raw_response -> 'identity' ->> 'display_name'), l.created_at DESC
  LIMIT 1000
$function$;
REVOKE ALL ON FUNCTION public.marketplace_listing_evidence(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_listing_evidence(timestamptz) TO service_role;

-- Sales: both parties stated the same final price (mutually_reported), two genuine accounts, a seller-priced listing,
-- a core-scan identity; one sale per buyer–seller pair per product (a pair repeating a sale is one data point).
CREATE OR REPLACE FUNCTION public.marketplace_sale_evidence(p_since timestamptz DEFAULT now() - interval '365 days')
 RETURNS TABLE (sale_ref text, final_price integer, completed_at timestamptz, condition text, category text, verification text, identity jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sale_ref, final_price, completed_at, condition, category, verification, identity FROM (
    SELECT DISTINCT ON (o.buyer_id, o.seller_id, coalesce(v.ai_raw_response -> 'identity' ->> 'canonical_name', v.ai_raw_response -> 'identity' ->> 'display_name'))
           left(md5('getworth-sale:' || o.id::text), 16) AS sale_ref, o.final_price, o.completed_at, l.condition, l.category,
           'mutually_reported'::text AS verification,
           jsonb_strip_nulls(jsonb_build_object(
             'canonical_name',   v.ai_raw_response -> 'identity' -> 'canonical_name',
             'display_name',     v.ai_raw_response -> 'identity' -> 'display_name',
             'brand',            v.ai_raw_response -> 'identity' -> 'brand',
             'model',            v.ai_raw_response -> 'identity' -> 'model',
             'product_family',   v.ai_raw_response -> 'identity' -> 'product_family',
             'item_type',        v.ai_raw_response -> 'identity' -> 'item_type',
             'variant',          v.ai_raw_response -> 'identity' -> 'variant',
             'size_or_capacity', v.ai_raw_response -> 'identity' -> 'size_or_capacity',
             'configuration',    v.ai_raw_response -> 'identity' -> 'configuration',
             'model_number',     v.ai_raw_response -> 'identity' -> 'model_number',
             'confirmed',        v.ai_raw_response -> 'identity' -> 'confirmed')) AS identity
    FROM orders o
    JOIN listings l   ON l.id = o.listing_id
    JOIN valuations v ON v.id = l.valuation_id
    WHERE o.status = 'completed'
      AND o.final_price IS NOT NULL AND o.final_price > 0
      AND o.final_price_source = 'buyer_confirmed'
      AND o.seller_final_price = o.final_price
      AND o.buyer_id <> o.seller_id
      AND o.completed_at >= p_since
      AND l.price_source = 'seller_entered'
      AND v.valuation_version = 3
      AND jsonb_typeof(v.ai_raw_response -> 'identity') = 'object'
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = o.buyer_id  AND NOT p.is_admin AND NOT p.is_test)
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = o.seller_id AND NOT p.is_admin AND NOT p.is_test)
    ORDER BY o.buyer_id, o.seller_id, coalesce(v.ai_raw_response -> 'identity' ->> 'canonical_name', v.ai_raw_response -> 'identity' ->> 'display_name'), o.completed_at DESC
  ) s
  ORDER BY completed_at DESC
  LIMIT 500
$function$;
REVOKE ALL ON FUNCTION public.marketplace_sale_evidence(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_sale_evidence(timestamptz) TO service_role;
