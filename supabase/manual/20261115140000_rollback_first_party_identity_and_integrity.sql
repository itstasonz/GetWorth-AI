-- Rollback of 20261115140000_first_party_identity_and_integrity. Restores the 20261115120000 function bodies (copied
-- verbatim) and drops the identity helpers. DATA-SAFE: no row is touched; the widened price_origin CHECK is KEPT so a
-- listing already marked 'after_reference' stays valid (the restored code never writes that value).
--   npx supabase db query --remote=xbwxbdxuklrbnkpgonjc --yes -f supabase/manual/20261115140000_rollback_first_party_identity_and_integrity.sql
BEGIN;
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

DROP FUNCTION IF EXISTS public.gw_same_product(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.gw_product_capacity(jsonb);
DROP FUNCTION IF EXISTS public.gw_product_base(jsonb);
DROP FUNCTION IF EXISTS public.gw_identity_text(jsonb);
COMMIT;
