-- ══════════════════════════════════════════════════════════════════════════════
-- LISTING THUMBNAILS — lists stop shipping full photographs (Production scan b4254487, 2026-11-10)
--
-- Every legacy listing keeps its photographs as base64 text in listings.images (45 rows, avg 412 KB, max 2.4 MB;
-- 18 MB of TOAST for 38 live rows). get_user_orders (mean 3.35 s), the conversations list (1.8 s), the feed, my
-- listings and saved items all carried that field although each screen only draws images[0] as a small square. They
-- ran on the same small database as the scan's quota check, which waited 3,556 ms behind them.
--
-- 1. listings.thumbnail (text) and listings.image_count (integer), kept by a trigger:
--      a Storage URL as first photograph → thumbnail is that URL (what new listings store, FRONTEND-008);
--      a base64 first photograph       → thumbnail is NULL until the maintenance backfill writes a small JPEG.
--    Only the maintenance roles may write thumbnail directly; for anyone else the trigger derives both columns from
--    images, so a client can never point a card at an image the listing does not have.
-- 2. get_user_orders / get_order_by_id embed the thumbnail instead of the photographs. Everything else in both
--    functions is unchanged (same columns, same party check, same SECURITY DEFINER, same grants).
--
-- No RLS policy, grant, quota or price rule changes. The photographs themselves are untouched (no Storage migration).
-- Rollback: supabase/manual/20261111120000_rollback_listing_thumbnails.sql
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS thumbnail text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS image_count integer;
ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS listings_thumbnail_size;
ALTER TABLE public.listings ADD CONSTRAINT listings_thumbnail_size CHECK (thumbnail IS NULL OR length(thumbnail) <= 100000);

-- Existing rows: written explicitly (not a catalog-only default), before the trigger exists.
UPDATE public.listings
   SET image_count = coalesce(cardinality(images), 0),
       thumbnail = CASE WHEN cardinality(images) > 0 AND left(images[1], 5) <> 'data:' THEN images[1] END;
ALTER TABLE public.listings ALTER COLUMN image_count SET DEFAULT 0;
ALTER TABLE public.listings ALTER COLUMN image_count SET NOT NULL;

CREATE OR REPLACE FUNCTION public.listings_sync_thumbnail()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_first text := CASE WHEN cardinality(NEW.images) > 0 THEN NEW.images[1] END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.images IS NOT DISTINCT FROM OLD.images THEN
    -- The photographs did not change. Only the maintenance roles may set a thumbnail (the backfill of legacy rows).
    NEW.image_count := OLD.image_count;
    IF current_user NOT IN ('postgres', 'supabase_admin') THEN
      NEW.thumbnail := OLD.thumbnail;
    END IF;
    RETURN NEW;
  END IF;
  NEW.image_count := coalesce(cardinality(NEW.images), 0);
  NEW.thumbnail := CASE WHEN v_first IS NULL OR left(v_first, 5) = 'data:' THEN NULL ELSE v_first END;
  RETURN NEW;
END;
$function$;

-- Fires only when a statement names images, thumbnail or image_count: price, title, status and view-count updates
-- never pay for comparing photographs.
DROP TRIGGER IF EXISTS trg_listings_sync_thumbnail ON public.listings;
CREATE TRIGGER trg_listings_sync_thumbnail
  BEFORE INSERT OR UPDATE OF images, thumbnail, image_count ON public.listings
  FOR EACH ROW EXECUTE FUNCTION public.listings_sync_thumbnail();

CREATE OR REPLACE FUNCTION public.get_user_orders()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    jsonb_build_object(
      -- Core identity
      'id',                 o.id,
      'listing_id',         o.listing_id,
      'buyer_id',           o.buyer_id,
      'seller_id',          o.seller_id,
      -- Transaction
      'price',              o.price,
      'delivery_method',    o.delivery_method,
      'shipping_address',   o.shipping_address,
      'buyer_note',         o.buyer_note,
      -- State machine
      'status',             o.status,
      'created_at',         o.created_at,
      'updated_at',         o.updated_at,
      'accepted_at',        o.accepted_at,
      'declined_at',        o.declined_at,
      'shipped_at',         o.shipped_at,
      'delivered_at',       o.delivered_at,
      'completed_at',       o.completed_at,
      'cancelled_at',       o.cancelled_at,
      'cancelled_by',       o.cancelled_by,
      'cancel_reason',      o.cancel_reason,
      'buyer_confirmed_at', o.buyer_confirmed_at,
      -- Embedded listing (non-null when listing exists and is readable). images = [thumbnail]: order screens draw
      -- one small square; the photographs stay in the listing (20261111120000).
      'listing', CASE WHEN l.id IS NOT NULL THEN
        jsonb_build_object(
          'id',            l.id,
          'title',         l.title,
          'title_hebrew',  l.title_hebrew,
          'price',         l.price,
          'images',        CASE WHEN l.thumbnail IS NULL THEN ARRAY[]::text[] ELSE ARRAY[l.thumbnail] END,
          'image_count',   l.image_count,
          'location',      l.location,
          'contact_phone', l.contact_phone,
          'seller_id',     l.seller_id
        )
      ELSE NULL END,
      -- Embedded buyer profile
      'buyer', CASE WHEN bp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          bp.id,
          'full_name',   bp.full_name,
          'avatar_url',  bp.avatar_url,
          'is_verified', bp.is_verified
        )
      ELSE NULL END,
      -- Embedded seller profile
      'seller', CASE WHEN sp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          sp.id,
          'full_name',   sp.full_name,
          'avatar_url',  sp.avatar_url,
          'is_verified', sp.is_verified
        )
      ELSE NULL END
    )
  FROM (
    -- Two narrow index-only scans.  UNION deduplicates the (impossible in
    -- this app, but theoretically possible) case where buyer_id = seller_id.
    -- Each subquery is bounded to 50 rows by the outer LIMIT.
    SELECT id, created_at FROM public.orders WHERE buyer_id  = v_uid
    UNION
    SELECT id, created_at FROM public.orders WHERE seller_id = v_uid
    ORDER BY created_at DESC
    LIMIT 50
  ) top
  JOIN   public.orders   o  ON o.id  = top.id
  LEFT JOIN public.listings l  ON l.id  = o.listing_id
  LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
  LEFT JOIN public.profiles sp ON sp.id = o.seller_id
  ORDER BY o.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_order_by_id(p_order_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    jsonb_build_object(
      'id',                 o.id,
      'listing_id',         o.listing_id,
      'buyer_id',           o.buyer_id,
      'seller_id',          o.seller_id,
      'price',              o.price,
      'delivery_method',    o.delivery_method,
      'shipping_address',   o.shipping_address,
      'buyer_note',         o.buyer_note,
      'status',             o.status,
      'created_at',         o.created_at,
      'updated_at',         o.updated_at,
      'accepted_at',        o.accepted_at,
      'declined_at',        o.declined_at,
      'shipped_at',         o.shipped_at,
      'delivered_at',       o.delivered_at,
      'completed_at',       o.completed_at,
      'cancelled_at',       o.cancelled_at,
      'cancelled_by',       o.cancelled_by,
      'cancel_reason',      o.cancel_reason,
      'buyer_confirmed_at', o.buyer_confirmed_at,
      'listing', CASE WHEN l.id IS NOT NULL THEN
        jsonb_build_object(
          'id',            l.id,
          'title',         l.title,
          'title_hebrew',  l.title_hebrew,
          'price',         l.price,
          'images',        CASE WHEN l.thumbnail IS NULL THEN ARRAY[]::text[] ELSE ARRAY[l.thumbnail] END,
          'image_count',   l.image_count,
          'location',      l.location,
          'contact_phone', l.contact_phone,
          'seller_id',     l.seller_id
        )
      ELSE NULL END,
      'buyer', CASE WHEN bp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          bp.id,
          'full_name',   bp.full_name,
          'avatar_url',  bp.avatar_url,
          'is_verified', bp.is_verified
        )
      ELSE NULL END,
      'seller', CASE WHEN sp.id IS NOT NULL THEN
        jsonb_build_object(
          'id',          sp.id,
          'full_name',   sp.full_name,
          'avatar_url',  sp.avatar_url,
          'is_verified', sp.is_verified
        )
      ELSE NULL END
    )
  FROM   public.orders   o
  LEFT JOIN public.listings l  ON l.id  = o.listing_id
  LEFT JOIN public.profiles bp ON bp.id = o.buyer_id
  LEFT JOIN public.profiles sp ON sp.id = o.seller_id
  WHERE  o.id        = p_order_id
    AND (o.buyer_id  = v_uid OR o.seller_id = v_uid)
  LIMIT 1;
END;
$function$;
