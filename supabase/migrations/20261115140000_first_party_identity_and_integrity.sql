-- ══════════════════════════════════════════════════════════════════════════════
-- FIRST-PARTY EVIDENCE: PRODUCT IDENTITY ACROSS SCANS, NEW-PRICE EXPOSURE, DUPLICATES AND COLLUSION (2026-11-15).
-- ADDITIVE: one CHECK widened, three internal helper functions, three functions replaced with the same signatures
-- (grants kept and restated). No existing row is written; legacy listings keep NULL (unknown origin).
-- Rollback: supabase/manual/20261115140000_rollback_first_party_identity_and_integrity.sql
--
-- PART 1  price_origin gains 'after_reference': the seller had been shown an Israeli NEW retail price for the product
--         (valuations.new_retail) and no GetWorth used price. Not independent; not evidence. Order of strictness:
--         independent < after_reference < after_suggestion < getworth_prefilled.
-- PART 2  THE SAME PRODUCT ACROSS SCANS, not the same name. gw_product_base(identity) is a language-stable token key:
--         brand, model, canonical name and material variant, lower-cased, with Hebrew product words mapped to their
--         English names, ordinal generations normalised ("2nd generation" = "gen 2" = gen2), colour and generic words
--         ("controller", "edition", the phrase "wireless controller") dropped. Capacity and the model code are compared separately and act as
--         WILDCARDS when one side does not know them (an iPhone 12 of unknown storage may be the 128 GB one; 128 GB and
--         256 GB are different products). "Edge", "Pro", "Disc", "Digital", generations stay: distinct variants are never
--         merged. The "was a GetWorth price shown?" check uses it in the trigger, so a seller cannot appear independent
--         because their earlier scan named the product differently.
-- PART 3  EVIDENCE INTEGRITY, proportionate (no transaction invented, no seller blocked; only what counts as evidence):
--         asks: one per seller per product (this key); the same product at the same price from two accounts on the
--         same day is one ask (cross-account duplicate). Sales: one per buyer–seller pair in total; a pair that has
--         sold to each other in both directions contributes nothing (wash trading). Price outliers are left to the
--         valuation's own outlier rules, which treat a GetWorth reference like any other.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PART 1 ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_price_origin_valid;
ALTER TABLE public.listings ADD CONSTRAINT listings_price_origin_valid
  CHECK (price_origin IS NULL OR price_origin IN ('independent', 'after_reference', 'after_suggestion', 'getworth_prefilled'));
COMMENT ON COLUMN public.listings.price_origin IS 'independent: no GetWorth price of any kind shown for the product to the seller; after_reference: an Israeli new retail price was shown; after_suggestion: a GetWorth used price was shown; getworth_prefilled: GetWorth''s number. Set by trigger (client may only make it stricter). NULL = unknown.';

-- ── PART 2 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gw_identity_text(p_identity jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Brand, model, canonical name and variant (never the free Hebrew name), normalised: Hebrew final letters and
  -- geresh, capacity units glued to their number, ordinal generations. "Wireless controller" is a description and goes as
  -- a phrase; "wireless" alone stays: Logitech G Pro and G Pro Wireless are different products (found in the rehearsal).
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           translate(lower(concat_ws(' ', p_identity->>'brand', p_identity->>'model', p_identity->>'canonical_name', p_identity->>'variant')),
                     'ךםןףץ׳״''"`', 'כמנפצ'),
           '\mwireless\s+controller\M', ' ', 'g'),
           '(\d+(?:\.\d+)?)\s*(גב|גיגה|גיגהבייט)(\s|$)', '\1gb\3', 'g'),
           '(\d+(?:\.\d+)?)\s*(gb|tb|mb)\M', '\1\2', 'g'),
           '(\d+)\s*(st|nd|rd|th)\s+(generation|gen)\M', 'gen\1', 'g'),
           '\m(generation|gen|דור)\s*(\d+)\M', 'gen\2', 'g'),
           '\m(\d+)(st|nd|rd|th)\s*gen\M', 'gen\1', 'g'),
           '[^[:alnum:]א-ת.]+', ' ', 'g')
$function$;

CREATE OR REPLACE FUNCTION public.gw_product_base(p_identity jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH alias(he, en) AS (VALUES
    ('אפל','apple'),('אייפון','iphone'),('איפון','iphone'),('אייפד','ipad'),('איירפודס','airpods'),('מקבוק','macbook'),('ווטש','watch'),
    ('סמסונג','samsung'),('גלקסי','galaxy'),('סוני','sony'),('פלייסטיישן','playstation'),('דואלסנס','dualsense'),('אדג','edge'),
    ('נינטנדו','nintendo'),('סוויץ','switch'),('סוויצ','switch'),('אולד','oled'),('קנון','canon'),('ניקון','nikon'),('לוגיטק','logitech'),
    ('לוגיטך','logitech'),('שיאומי','xiaomi'),('דייסון','dyson'),('וואווי','huawei'),('הואווי','huawei'),('גוגל','google'),('פיקסל','pixel'),
    ('פרו','pro'),('מקס','max'),('מיני','mini'),('פלוס','plus'),('אולטרה','ultra'),('לייט','lite'),('דיגיטל','digital'),('דיסק','disc'),
    ('אקס','x'),('אייר','air')),
  drop(w) AS (VALUES
    ('controller'),('edition'),('standard'),('gaming'),('version'),('model'),('the'),('for'),('with'),('and'),('of'),('new'),('used'),
    ('black'),('white'),('blue'),('red'),('green'),('silver'),('gold'),('gray'),('grey'),('pink'),('purple'),('yellow'),('orange'),
    ('midnight'),('starlight'),('graphite'),('space'),('rose'),('cosmic'),('phantom'),('titanium'),('natural'),('color'),('colour'),
    ('שלט'),('אלחוטי'),('שחור'),('לבן'),('כחול'),('אדום'),('ירוק'),('כסוף'),('זהב'),('אפור'),('ורוד'),('סגול'),('צבע'),('חדש'),('משומש'))
  SELECT nullif(string_agg(DISTINCT coalesce(a.en, t.tok), ' ' ORDER BY coalesce(a.en, t.tok)), '')
  FROM regexp_split_to_table(public.gw_identity_text(p_identity), '\s+') AS t(tok)
  LEFT JOIN alias a ON translate(a.he, 'ךםןףץ', 'כמנפצ') = t.tok
  WHERE t.tok <> '' AND t.tok !~ '^\d+(\.\d+)?(gb|tb|mb)$'
    AND NOT EXISTS (SELECT 1 FROM drop d WHERE translate(d.w, 'ךםןףץ', 'כמנפצ') = coalesce(a.en, t.tok))
$function$;

-- Capacity: the stated size_or_capacity, else a capacity written in the name. NULL = unknown (a wildcard).
CREATE OR REPLACE FUNCTION public.gw_product_capacity(p_identity jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(
    nullif(regexp_replace(regexp_replace(lower(coalesce(p_identity->>'size_or_capacity', '')), '(\d+(?:\.\d+)?)\s*(gb|tb|mb)', '\1\2', 'g'), '[^[:alnum:].]+', '', 'g'), ''),
    (SELECT m[1] FROM regexp_matches(public.gw_identity_text(p_identity), '\m(\d+(?:\.\d+)?(?:gb|tb|mb))\M') AS m LIMIT 1))
$function$;

-- The same product? Equal base key (never an empty one), capacity and model code equal or unknown on either side.
CREATE OR REPLACE FUNCTION public.gw_same_product(a jsonb, b jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.gw_product_base(a) IS NOT NULL
     AND public.gw_product_base(a) = public.gw_product_base(b)
     AND coalesce(a->>'configuration', 'complete_item') = coalesce(b->>'configuration', 'complete_item')
     AND (public.gw_product_capacity(a) IS NULL OR public.gw_product_capacity(b) IS NULL OR public.gw_product_capacity(a) = public.gw_product_capacity(b))
     AND (nullif(regexp_replace(lower(coalesce(a->>'model_number', '')), '[^[:alnum:]]', '', 'g'), '') IS NULL
       OR nullif(regexp_replace(lower(coalesce(b->>'model_number', '')), '[^[:alnum:]]', '', 'g'), '') IS NULL
       OR regexp_replace(lower(a->>'model_number'), '[^[:alnum:]]', '', 'g') = regexp_replace(lower(b->>'model_number'), '[^[:alnum:]]', '', 'g'))
$function$;
REVOKE ALL ON FUNCTION public.gw_identity_text(jsonb), public.gw_product_base(jsonb), public.gw_product_capacity(jsonb), public.gw_same_product(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gw_identity_text(jsonb), public.gw_product_base(jsonb), public.gw_product_capacity(jsonb), public.gw_same_product(jsonb, jsonb) TO service_role;

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

-- ── PART 3 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marketplace_listing_evidence(p_since timestamptz DEFAULT now() - interval '120 days')
 RETURNS TABLE (listing_ref text, seller_ref text, price integer, created_at timestamptz, updated_at timestamptz, condition text, category text, identity jsonb)
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH salt AS MATERIALIZED (SELECT gen_random_uuid()::text AS s),
  eligible AS (
    SELECT l.*, v.ai_raw_response -> 'identity' AS ident,
           public.gw_product_base(v.ai_raw_response -> 'identity') AS pbase,
           coalesce(public.gw_product_capacity(v.ai_raw_response -> 'identity'), '') AS pcap
    FROM listings l
    JOIN valuations v ON v.id = l.valuation_id
    WHERE l.status = 'active'
      AND l.price IS NOT NULL AND l.price > 0
      AND l.price_source = 'seller_entered'
      AND l.price_origin = 'independent'
      AND l.created_at >= p_since
      AND v.valuation_version = 3
      AND v.user_id = l.seller_id
      AND jsonb_typeof(v.ai_raw_response -> 'identity') = 'object'
      AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = l.seller_id AND NOT p.is_admin AND NOT p.is_test)
  ),
  -- One ask per seller per product (the newest): relisting, or the same product named differently.
  per_seller AS (
    SELECT DISTINCT ON (seller_id, coalesce(pbase, id::text), pcap) *
    FROM eligible
    ORDER BY seller_id, coalesce(pbase, id::text), pcap, created_at DESC
  ),
  -- The same product at the same price from two accounts on the same day is one ask (a cross-posted duplicate).
  deduped AS (
    SELECT DISTINCT ON (coalesce(pbase, id::text), pcap, price, date_trunc('day', created_at)) *
    FROM per_seller
    ORDER BY coalesce(pbase, id::text), pcap, price, date_trunc('day', created_at), created_at
  )
  SELECT left(md5('getworth-listing:' || d.id::text), 16), left(md5(salt.s || ':' || d.seller_id::text), 16),
         d.price::integer, d.created_at, d.updated_at, d.condition, d.category,
         jsonb_strip_nulls(jsonb_build_object(
           'canonical_name',   d.ident -> 'canonical_name',
           'display_name',     d.ident -> 'display_name',
           'brand',            d.ident -> 'brand',
           'model',            d.ident -> 'model',
           'product_family',   d.ident -> 'product_family',
           'item_type',        d.ident -> 'item_type',
           'variant',          d.ident -> 'variant',
           'size_or_capacity', d.ident -> 'size_or_capacity',
           'configuration',    d.ident -> 'configuration',
           'model_number',     d.ident -> 'model_number',
           'confirmed',        d.ident -> 'confirmed'))
  FROM deduped d CROSS JOIN salt
  ORDER BY d.created_at DESC
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
  SELECT sale_ref, final_price, completed_at, condition, category, verification, identity FROM (
    -- One sale per buyer–seller pair in total (the newest): a pair repeating sales is one data point.
    SELECT DISTINCT ON (o.buyer_id, o.seller_id)
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
      -- A pair that has also completed a sale the other way round: wash trading, contributes nothing.
      AND NOT EXISTS (SELECT 1 FROM orders r WHERE r.status = 'completed' AND r.buyer_id = o.seller_id AND r.seller_id = o.buyer_id)
    ORDER BY o.buyer_id, o.seller_id, o.completed_at DESC
  ) s
  ORDER BY completed_at DESC
  LIMIT 500
$function$;
REVOKE ALL ON FUNCTION public.marketplace_sale_evidence(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_sale_evidence(timestamptz) TO service_role;
