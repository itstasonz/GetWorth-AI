-- Rollback of 20261115120000_first_party_evidence_classes. Restores the previous function bodies (copied verbatim from
-- 20261108120000, 20261113190000 and 20261108150000) and drops record_sale_price. DATA-SAFE: the new columns
-- listings.price_origin and orders.seller_final_price(_at) are KEPT (nullable, unused by the restored code) so no
-- recorded statement is lost. Run in one transaction:
--   npx supabase db query --remote=xbwxbdxuklrbnkpgonjc --yes -f supabase/manual/20261115120000_rollback_first_party_evidence_classes.sql
BEGIN;
DROP FUNCTION IF EXISTS public.record_sale_price(uuid, integer);

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
  v_suggest  numeric;
  v_matched  boolean := false;
  -- THE SELLER'S OWN WORD, WHERE IT CAN ONLY MAKE THINGS STRICTER. The listing form says whether the price is the
  -- suggestion it pre-filled ('getworth_valuation') or one the seller typed ('seller_entered'). The first is kept
  -- even when the numbers do not match (a suggestion an older formula adjusted); the second never overrides a match:
  -- independence is not taken on a client's say-so.
  v_claimed  text := NEW.price_source;
BEGIN
  NEW.price_source    := 'seller_entered';
  NEW.suggested_price := NULL;
  IF NEW.valuation_id IS NULL THEN
    IF v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
    RETURN NEW;
  END IF;

  SELECT price_low, price_mid, price_high, ai_raw_response->'valuation'->'prices'
    INTO v_low, v_mid, v_high, v_prices
  FROM valuations WHERE id = NEW.valuation_id;
  IF NOT FOUND THEN
    IF v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
    RETURN NEW;
  END IF;

  -- Every number the valuation could have shown: its stored range, and each condition's list / worth / quick / low / high.
  SELECT bool_or(abs(NEW.price - c) <= greatest(5, 0.02 * c)) INTO v_matched
  FROM (
    SELECT unnest(ARRAY[v_low, v_mid, v_high]) AS c
    UNION ALL
    SELECT (b.value->>k)::numeric
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_prices) = 'object' THEN v_prices ELSE '{}'::jsonb END) b
    CROSS JOIN unnest(ARRAY['list', 'worth', 'quick', 'low', 'high']) k
    WHERE jsonb_typeof(b.value) = 'object' AND (b.value->>k) ~ '^[0-9]+(\.[0-9]+)?$'
  ) s
  WHERE c IS NOT NULL AND c > 0;

  IF (v_prices->'good'->>'list') ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_suggest := (v_prices->'good'->>'list')::numeric;
  ELSE
    v_suggest := v_mid;
  END IF;

  IF v_matched IS TRUE OR v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
  NEW.suggested_price := CASE WHEN v_suggest > 0 THEN round(v_suggest)::integer ELSE NULL END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_listings_price_provenance ON public.listings;
CREATE TRIGGER trg_listings_price_provenance
  BEFORE INSERT OR UPDATE OF price, valuation_id ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.listings_set_price_provenance();

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

CREATE OR REPLACE FUNCTION public.marketplace_sale_evidence(p_since timestamptz DEFAULT now() - interval '365 days')
 RETURNS TABLE (sale_ref text, final_price integer, completed_at timestamptz, condition text, category text, verification text, identity jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Only the product fields the engine's market identity is built from (strategy.js marketKey), and its display name:
  -- never the photograph's visible text, the listing's text, or anything about a person.
  SELECT left(md5('getworth-sale:' || o.id::text), 16), o.final_price, o.completed_at, l.condition, l.category,
         o.final_price_source,
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
COMMIT;
