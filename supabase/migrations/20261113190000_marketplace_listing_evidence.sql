-- ══════════════════════════════════════════════════════════════════════════════
-- FIRST-PARTY ASKING PRICES AS ISRAELI EVIDENCE (2026-11-13). ADDITIVE: one read-only function, no table/policy change.
-- Rollback: supabase/manual/20261113190000_rollback_marketplace_listing_evidence.sql
--
-- marketplace_listing_evidence(p_since) — service_role ONLY (the scan server). The GetWorth listings whose price may stand
-- as an Israeli private ASKING price — never as a sale:
--   • active listing, price > 0, created within p_since (default 120 days);
--   • price_source = 'seller_entered' (the 20261108120000 trigger: the price is NOT within 2% / ₪5 of any number the linked
--     valuation showed — a copied GetWorth price is 'getworth_valuation' and never evidence);
--   • seller neither admin nor test;
--   • linked to the SELLER'S OWN core-scan valuation (valuation_version 3, valuations.user_id = seller) whose identity says
--     what is offered;
--   • one listing per seller per product (the latest): a seller relisting is one ask. The engine repeats this per market
--     key (marketplace.js), since one product may be named two ways: seller_ref is a per-CALL salted hash — it groups one
--     seller's rows within this answer and links to no account (a new random salt every call; nothing to look it up by).
-- Returns no person: an opaque reference, the price, dates, condition, category and the product identity fields the engine's
-- market key is built from.
-- VOLATILE (not STABLE): the salt is random per call.
-- ══════════════════════════════════════════════════════════════════════════════
-- Never applied before this version; the DROP only makes a re-run with the wider row shape possible.
DROP FUNCTION IF EXISTS public.marketplace_listing_evidence(timestamptz);
CREATE FUNCTION public.marketplace_listing_evidence(p_since timestamptz DEFAULT now() - interval '120 days')
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
