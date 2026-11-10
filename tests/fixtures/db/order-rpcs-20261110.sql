-- get_user_orders / get_order_by_id exactly as captured from Production (pg_get_functiondef) on 2026-11-10.
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
      -- Embedded listing (non-null when listing exists and is readable)
      'listing', CASE WHEN l.id IS NOT NULL THEN
        jsonb_build_object(
          'id',            l.id,
          'title',         l.title,
          'title_hebrew',  l.title_hebrew,
          'price',         l.price,
          'images',        l.images,
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
          'images',        l.images,
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
