-- Rollback of 20261115160000: restores the 20261115140000 provenance function (copied verbatim). No row is touched.
--   npx supabase db query --remote=xbwxbdxuklrbnkpgonjc --yes -f supabase/manual/20261115160000_rollback_comparative_is_reference.sql
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
  v_ident    jsonb;
  v_retail   numeric;
  v_suggest  numeric;
  v_matched  boolean := false;
  v_shown    boolean := false;
  v_ref      boolean := false;
  v_floor    int;
  -- The seller's own word, which can only make things stricter (independence is never taken on a client's say-so).
  v_claimed  text := NEW.price_source;
  v_claim_o  int := CASE NEW.price_origin WHEN 'independent' THEN 0 WHEN 'after_reference' THEN 1 WHEN 'after_suggestion' THEN 2 WHEN 'getworth_prefilled' THEN 3 END;
BEGIN
  NEW.price_source    := 'seller_entered';
  NEW.suggested_price := NULL;
  IF NEW.valuation_id IS NULL THEN
    IF v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
    NEW.price_origin := CASE WHEN v_claim_o >= 1 THEN NEW.price_origin END;
    RETURN NEW;
  END IF;

  SELECT price_low, price_mid, price_high, ai_raw_response->'valuation'->'prices', user_id, ai_raw_response->'identity', new_retail
    INTO v_low, v_mid, v_high, v_prices, v_user, v_ident, v_retail
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
  v_ref := coalesce(v_retail > 0, false);

  -- The same seller's EARLIER core scans of the same PRODUCT (gw_same_product: not the same wording): what they showed
  -- was seen too — a used price, or a new retail price.
  IF jsonb_typeof(v_ident) = 'object' AND (NOT v_shown OR NOT v_ref) THEN
    SELECT v_shown OR coalesce(bool_or(o.price_mid > 0), false), v_ref OR coalesce(bool_or(o.new_retail > 0), false)
      INTO v_shown, v_ref
    FROM valuations o
    WHERE o.user_id = coalesce(NEW.seller_id, v_user) AND o.id <> NEW.valuation_id AND o.valuation_version = 3
      AND o.created_at <= now() AND (o.price_mid > 0 OR o.new_retail > 0)
      AND jsonb_typeof(o.ai_raw_response->'identity') = 'object'
      AND public.gw_same_product(o.ai_raw_response->'identity', v_ident);
  END IF;

  IF (v_prices->'good'->>'list') ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_suggest := (v_prices->'good'->>'list')::numeric;
  ELSE
    v_suggest := v_mid;
  END IF;

  IF v_matched IS TRUE OR v_claimed = 'getworth_valuation' THEN NEW.price_source := 'getworth_valuation'; END IF;
  NEW.suggested_price := CASE WHEN v_suggest > 0 THEN round(v_suggest)::integer ELSE NULL END;

  v_floor := CASE WHEN NEW.price_source = 'getworth_valuation' THEN 3 WHEN v_shown THEN 2 WHEN v_ref THEN 1 ELSE 0 END;
  NEW.price_origin := (ARRAY['independent', 'after_reference', 'after_suggestion', 'getworth_prefilled'])[greatest(v_floor, coalesce(v_claim_o, 0)) + 1];
  RETURN NEW;
END;
$function$;
