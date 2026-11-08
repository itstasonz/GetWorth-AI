-- GENERATED from a read-only catalog capture of Production (2026-11-08). Do not edit by hand.
-- The marketplace tables as Production has them: columns, constraints, RLS policies, triggers and the exact
-- function bodies. No data. Supabase's auth.uid(), roles and default grants are reproduced minimally.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Tables the functions touch, reduced to the columns they use.
CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.valuations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, price_low numeric, price_mid numeric, price_high numeric,
  ai_raw_response jsonb, listing_id uuid, actual_sold_price numeric, price_accuracy real, created_at timestamptz DEFAULT now());
CREATE TABLE public.comps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid, source text, source_url text, source_id text, price numeric,
  condition text, is_sold boolean, sold_at timestamptz, title text, description text, category text, brand text, model text,
  is_outlier boolean DEFAULT false, confidence real, scraped_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text, data jsonb,
  read boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.jobs_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_type text, payload jsonb, priority integer, status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now());

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text,
  phone text,
  full_name text,
  avatar_url text,
  location text,
  reputation_points integer DEFAULT 0,
  badge text DEFAULT 'newSeller'::text,
  total_sales integer DEFAULT 0,
  rating numeric DEFAULT 5.0,
  is_verified boolean DEFAULT false,
  is_phone_verified boolean DEFAULT false,
  response_rate integer DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_admin boolean DEFAULT false,
  verification_status text DEFAULT 'unverified'::text,
  verification_photo_url text,
  verified_at timestamptz,
  review_count integer DEFAULT 0,
  verification_photo_path text
);
CREATE TABLE public.listings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  title text NOT NULL,
  title_hebrew text,
  description text,
  category text NOT NULL,
  condition text NOT NULL,
  price integer NOT NULL,
  original_price integer,
  images text[] DEFAULT '{}'::text[],
  location text,
  status text DEFAULT 'active'::text,
  views integer DEFAULT 0,
  saves integer DEFAULT 0,
  is_featured boolean DEFAULT false,
  is_boosted boolean DEFAULT false,
  boost_expires_at timestamptz,
  condition_details jsonb DEFAULT '{}'::jsonb,
  contact_method text DEFAULT 'phone'::text,
  contact_phone text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + '30 days'::interval),
  quality_score integer DEFAULT 0,
  sold_to uuid,
  sold_at timestamptz,
  attributes jsonb DEFAULT '{}'::jsonb,
  product_id uuid,
  valuation_id uuid,
  subcategory text,
  ai_confidence real,
  actual_sold_price integer,
  serial_submitted boolean NOT NULL DEFAULT false,
  serial_verified boolean NOT NULL DEFAULT false,
  serial_masked text,
  serial_type text
);
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  price integer NOT NULL,
  delivery_method text NOT NULL,
  shipping_address text,
  buyer_note text,
  status text NOT NULL DEFAULT 'pending'::text,
  cancelled_by uuid,
  cancel_reason text,
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  declined_at timestamptz,
  ready_pickup_at timestamptz,
  buyer_confirmed_at timestamptz,
  seller_handed_off_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.listings ADD CONSTRAINT listings_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_verification_status_check CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text])));
ALTER TABLE public.listings ADD CONSTRAINT listings_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.listings ADD CONSTRAINT listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.listings ADD CONSTRAINT listings_sold_to_fkey FOREIGN KEY (sold_to) REFERENCES auth.users(id);
ALTER TABLE public.listings ADD CONSTRAINT listings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'sold'::text, 'expired'::text, 'deleted'::text])));
ALTER TABLE public.listings ADD CONSTRAINT listings_valuation_id_fkey FOREIGN KEY (valuation_id) REFERENCES valuations(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_buyer_profile_fkey FOREIGN KEY (buyer_id) REFERENCES profiles(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES auth.users(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['pickup'::text, 'shipping'::text])));
ALTER TABLE public.orders ADD CONSTRAINT orders_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_no_self_buy CHECK ((buyer_id <> seller_id));
ALTER TABLE public.orders ADD CONSTRAINT orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_seller_profile_fkey FOREIGN KEY (seller_id) REFERENCES profiles(id);
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'shipped'::text, 'ready_pickup'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'disputed'::text])));
ALTER TABLE public.orders ADD CONSTRAINT orders_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'shipped'::text, 'ready_pickup'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'disputed'::text])));

-- Supabase's default table grants, then Production's own narrowing for orders and profiles (captured per column).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
REVOKE SELECT ON public.orders FROM anon;
GRANT SELECT ON public.orders TO anon;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, full_name, avatar_url, location, reputation_points, badge, total_sales, rating, is_verified, response_rate, created_at, updated_at, review_count) ON public.profiles TO anon;
REVOKE SELECT ON public.listings FROM anon;
GRANT SELECT ON public.listings TO anon;
REVOKE SELECT ON public.orders FROM authenticated;
GRANT SELECT ON public.orders TO authenticated;
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, full_name, avatar_url, location, reputation_points, badge, total_sales, rating, is_verified, response_rate, created_at, updated_at, review_count) ON public.profiles TO authenticated;
REVOKE SELECT ON public.listings FROM authenticated;
GRANT SELECT ON public.listings TO authenticated;
REVOKE INSERT ON public.orders FROM anon;
REVOKE INSERT ON public.profiles FROM anon;
GRANT INSERT ON public.profiles TO anon;
REVOKE INSERT ON public.listings FROM anon;
GRANT INSERT ON public.listings TO anon;
REVOKE INSERT ON public.orders FROM authenticated;
REVOKE INSERT ON public.profiles FROM authenticated;
GRANT INSERT ON public.profiles TO authenticated;
REVOKE INSERT ON public.listings FROM authenticated;
GRANT INSERT ON public.listings TO authenticated;
REVOKE UPDATE ON public.orders FROM anon;
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE UPDATE ON public.listings FROM anon;
GRANT UPDATE ON public.listings TO anon;
REVOKE UPDATE ON public.orders FROM authenticated;
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (phone, full_name, avatar_url, location, updated_at) ON public.profiles TO authenticated;
REVOKE UPDATE ON public.listings FROM authenticated;
GRANT UPDATE ON public.listings TO authenticated;
REVOKE DELETE ON public.orders FROM anon;
REVOKE DELETE ON public.profiles FROM anon;
GRANT DELETE ON public.profiles TO anon;
REVOKE DELETE ON public.listings FROM anon;
GRANT DELETE ON public.listings TO anon;
REVOKE DELETE ON public.orders FROM authenticated;
REVOKE DELETE ON public.profiles FROM authenticated;
GRANT DELETE ON public.profiles TO authenticated;
REVOKE DELETE ON public.listings FROM authenticated;
GRANT DELETE ON public.listings TO authenticated;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public.profiles_prevent_privilege_escalation_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     uuid;
  v_is_admin   boolean;
  v_allowed    text[] := ARRAY['avatar_url','full_name','location','phone','updated_at'];
  v_patch      jsonb;
  v_reverted   text;
BEGIN
  -- (a) Service role / internal (no JWT) → full trust (migrations, admin ops, Edge Fn).
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- (b) Trusted server recompute path (rating/review_count/total_sales). Only our
  --     SECURITY DEFINER functions set this transaction-local flag; PostgREST
  --     cannot set app.* GUCs, so a client can never reach this branch.
  IF current_setting('app.reputation_trusted_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- (c) Admins (read from the DB row, never the JWT claim) → full trust.
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- (d) Normal user: rebuild NEW = OLD overlaid with ONLY allowlisted keys of NEW.
  --     Any change to any other column (present or future) is reverted.
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    INTO v_patch
  FROM jsonb_each(to_jsonb(NEW))
  WHERE key = ANY(v_allowed);

  -- Observability: warn if the client attempted a protected change (best-effort).
  SELECT string_agg(key, ',') INTO v_reverted
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE NOT (key = ANY(v_allowed))
    AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> key);
  IF v_reverted IS NOT NULL THEN
    RAISE WARNING 'profiles: reverting protected column change(s) [%] attempted by uid=%',
      v_reverted, v_caller;
  END IF;

  NEW := jsonb_populate_record(OLD, v_patch);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.profiles_enforce_safe_defaults_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / trigger-seeded rows (no JWT) may set anything.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Any authenticated self-insert starts with zero, unearned reputation.
  NEW.is_admin            := false;
  NEW.is_verified         := false;
  NEW.is_phone_verified   := false;
  NEW.rating              := 0;
  NEW.review_count        := 0;
  NEW.total_sales         := 0;
  NEW.badge               := NULL;
  NEW.reputation_points   := 0;
  NEW.response_rate       := NULL;
  NEW.verification_status := NULL;
  NEW.verified_at         := NULL;
  NEW.created_at          := now();   -- cannot backdate account age
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.orders_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Client roles only. SECURITY DEFINER RPCs execute as their owner
  -- (postgres) and service_role is operational — both pass through.
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' AND NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'orders must be created via create_order() (status % rejected)', NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'orders.status can only be changed via transition_order()'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_seller_on_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_listing_title TEXT;
BEGIN
  SELECT COALESCE(title, '') INTO v_listing_title
  FROM public.listings WHERE id = NEW.listing_id;

  BEGIN
    INSERT INTO public.order_events (order_id, actor_id, event_type, from_status, to_status)
    VALUES (NEW.id, NEW.buyer_id, 'REQUESTED', NULL, 'pending');
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.seller_id,
    'ORDER_REQUESTED',
    'New Purchase Request!',
    'Someone wants to buy "' || v_listing_title || '".',
    jsonb_build_object(
      'order_id', NEW.id,
      'listing_id', NEW.listing_id,
      'counterpart_id', NEW.buyer_id,
      'listing_title', v_listing_title,
      'new_status', 'pending'
    )
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_profile_total_sales()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_seller uuid;
BEGIN
  v_seller := COALESCE(NEW.seller_id, OLD.seller_id);
  PERFORM set_config('app.reputation_trusted_write', '1', true);
  UPDATE profiles p
  SET total_sales = (SELECT count(*)::int
                     FROM orders o
                     WHERE o.seller_id = v_seller AND o.status = 'completed')
  WHERE p.id = v_seller;
  PERFORM set_config('app.reputation_trusted_write', '', true);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_comp_from_sale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    INSERT INTO comps (product_id, source, price, condition, is_sold, sold_at, title, category, brand, model, confidence)
    SELECT
      l.product_id,
      'getworth',
      NEW.price,
      l.condition,
      true,
      now(),
      l.title,
      l.category,
      (l.attributes->>'brand'),
      (l.attributes->>'model'),
      COALESCE(l.ai_confidence, 0.8)
    FROM listings l
    WHERE l.id = NEW.listing_id;

    -- Update valuation with actual sold price
    UPDATE valuations
    SET
      actual_sold_price = NEW.price,
      price_accuracy = CASE WHEN price_mid > 0 THEN NEW.price::REAL / price_mid ELSE NULL END
    WHERE listing_id = NEW.listing_id;

    -- Queue price recalculation
    INSERT INTO jobs_queue (job_type, payload, priority)
    SELECT 'recalc_prices', jsonb_build_object('product_id', l.product_id), 3
    FROM listings l
    WHERE l.id = NEW.listing_id AND l.product_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_order(p_listing_id uuid, p_seller_id uuid, p_price numeric, p_delivery_method text, p_shipping_address text DEFAULT NULL::text, p_buyer_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id  uuid;
  v_listing    listings%ROWTYPE;
  v_order_id   uuid;
  v_now        timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Lock and load listing ─────────────────────────────────────────────
  -- FOR UPDATE serialises concurrent order attempts on the same listing.
  SELECT * INTO v_listing FROM listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Listing must be active ────────────────────────────────────────────
  IF v_listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not available (status: %)', v_listing.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 4. Self-buy prevention ───────────────────────────────────────────────
  IF v_listing.seller_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot buy your own listing'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 5. Verify seller_id matches DB (client cannot forge) ─────────────────
  IF v_listing.seller_id <> p_seller_id THEN
    RAISE EXCEPTION 'seller_id does not match listing'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 6. Verify price matches DB (client cannot forge) ─────────────────────
  IF v_listing.price <> p_price THEN
    RAISE EXCEPTION 'price does not match listing (expected %, got %)',
      v_listing.price, p_price
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 7. Duplicate active order check ──────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM orders
    WHERE listing_id = p_listing_id
      AND buyer_id   = v_caller_id
      AND status NOT IN ('cancelled', 'completed', 'declined')
  ) THEN
    RAISE EXCEPTION 'You already have an active order for this listing'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ── 8. Insert order ───────────────────────────────────────────────────────
  INSERT INTO orders (
    listing_id, buyer_id, seller_id, price,
    delivery_method, shipping_address, buyer_note,
    status, created_at, updated_at
  )
  VALUES (
    p_listing_id, v_caller_id, v_listing.seller_id, v_listing.price,
    p_delivery_method, p_shipping_address, p_buyer_note,
    'pending', v_now, v_now
  )
  RETURNING id INTO v_order_id;

  -- ── 9. Notify seller of new pending order ─────────────────────────────────
  INSERT INTO notifications (user_id, type, title, body, data, created_at)
  VALUES (
    v_listing.seller_id,
    'ORDER_PENDING',
    'New order request',
    COALESCE(v_listing.title, ''),
    jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id),
    v_now
  );

  RETURN jsonb_build_object(
    'id',              v_order_id,
    'listing_id',      p_listing_id,
    'buyer_id',        v_caller_id,
    'seller_id',       v_listing.seller_id,
    'price',           v_listing.price,
    'delivery_method', p_delivery_method,
    'status',          'pending',
    'created_at',      v_now
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_new_status text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id     uuid;
  v_order         orders%ROWTYPE;
  v_current       text;
  v_required_role text;   -- 'seller' | 'buyer' | 'either'
  v_notif_target  uuid;
  v_now           timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Load and lock order ───────────────────────────────────────────────
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Caller must be a party ─────────────────────────────────────────────
  IF v_order.buyer_id <> v_caller_id AND v_order.seller_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not a party to this order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_current := v_order.status;

  -- ── 4. Reject terminal-state transitions ──────────────────────────────────
  IF v_current IN ('completed', 'cancelled', 'declined', 'disputed') THEN
    RAISE EXCEPTION 'Order is already in terminal state: %', v_current
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 5. Validate transition + derive required role ─────────────────────────
  v_required_role := CASE
    WHEN v_current = 'pending'      AND p_new_status = 'accepted'      THEN 'seller'
    WHEN v_current = 'pending'      AND p_new_status = 'declined'      THEN 'seller'
    WHEN v_current = 'pending'      AND p_new_status = 'cancelled'     THEN 'either'
    WHEN v_current = 'accepted'     AND p_new_status = 'shipped'       THEN 'seller'
    WHEN v_current = 'accepted'     AND p_new_status = 'ready_pickup'  THEN 'seller'
    WHEN v_current = 'accepted'     AND p_new_status = 'cancelled'     THEN 'either'
    WHEN v_current = 'shipped'      AND p_new_status = 'delivered'     THEN 'buyer'
    WHEN v_current = 'ready_pickup' AND p_new_status = 'delivered'     THEN 'buyer'
    WHEN v_current = 'ready_pickup' AND p_new_status = 'completed'     THEN 'buyer'
    WHEN v_current = 'delivered'    AND p_new_status = 'completed'     THEN 'buyer'
    ELSE NULL
  END;

  IF v_required_role IS NULL THEN
    RAISE EXCEPTION 'Invalid transition: % → %', v_current, p_new_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 6. Enforce role ───────────────────────────────────────────────────────
  IF v_required_role = 'seller' AND v_order.seller_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the seller can perform this action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_required_role = 'buyer' AND v_order.buyer_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the buyer can perform this action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 7. Apply transition ───────────────────────────────────────────────────
  IF p_new_status = 'accepted' THEN
    UPDATE orders SET status = 'accepted',     accepted_at = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'declined' THEN
    UPDATE orders SET status = 'declined',     declined_at = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'shipped' THEN
    UPDATE orders SET status = 'shipped',      shipped_at  = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'ready_pickup' THEN
    UPDATE orders SET status = 'ready_pickup', shipped_at  = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'delivered' THEN
    UPDATE orders
    SET status = 'delivered', delivered_at = v_now, buyer_confirmed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

  ELSIF p_new_status = 'cancelled' THEN
    UPDATE orders
    SET status        = 'cancelled',
        cancelled_at  = v_now,
        cancelled_by  = v_caller_id,
        cancel_reason = COALESCE(p_meta->>'cancel_reason', 'User cancellation'),
        updated_at    = v_now
    WHERE id = p_order_id;

  ELSIF p_new_status = 'completed' THEN
    UPDATE orders
    SET status = 'completed', completed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

    -- Atomically mark the listing sold
    UPDATE listings
    SET status  = 'sold',
        sold_to = v_order.buyer_id,
        sold_at = v_now
    WHERE id = v_order.listing_id;
  END IF;

  -- ── 8. Notify the opposite party ─────────────────────────────────────────
  -- v_order is the pre-update snapshot — buyer_id / seller_id are stable.
  v_notif_target := CASE p_new_status
    WHEN 'accepted'     THEN v_order.buyer_id
    WHEN 'declined'     THEN v_order.buyer_id
    WHEN 'shipped'      THEN v_order.buyer_id
    WHEN 'ready_pickup' THEN v_order.buyer_id
    WHEN 'delivered'    THEN v_order.seller_id
    WHEN 'completed'    THEN v_order.seller_id
    WHEN 'cancelled'    THEN
      CASE WHEN v_caller_id = v_order.buyer_id
           THEN v_order.seller_id
           ELSE v_order.buyer_id END
    ELSE NULL
  END;

  IF v_notif_target IS NOT NULL AND v_notif_target <> v_caller_id THEN
    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    VALUES (
      v_notif_target,
      'ORDER_' || upper(p_new_status),
      CASE p_new_status
        WHEN 'accepted'     THEN 'Order accepted'
        WHEN 'declined'     THEN 'Order declined'
        WHEN 'shipped'      THEN 'Item shipped'
        WHEN 'ready_pickup' THEN 'Ready for pickup'
        WHEN 'delivered'    THEN 'Item received'
        WHEN 'completed'    THEN 'Transaction complete'
        WHEN 'cancelled'    THEN 'Order cancelled'
      END,
      '',
      jsonb_build_object('order_id', p_order_id, 'new_status', p_new_status),
      v_now
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_new_status);
END;
$function$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active listings are viewable by everyone" ON public.listings AS PERMISSIVE FOR SELECT TO public USING (((status = 'active'::text) OR (seller_id = auth.uid())));
CREATE POLICY "listings_insert_own_active" ON public.listings AS PERMISSIVE FOR INSERT TO public WITH CHECK (((seller_id = auth.uid()) AND (status = 'active'::text)));
CREATE POLICY "listings_select_admin_bypass" ON public.listings AS PERMISSIVE FOR SELECT TO public USING (auth_is_admin());
CREATE POLICY "listings_update_owner_soft_delete_only" ON public.listings AS PERMISSIVE FOR UPDATE TO public USING (((seller_id = auth.uid()) AND (status = 'active'::text))) WITH CHECK (((seller_id = auth.uid()) AND (status = 'deleted'::text)));
CREATE POLICY "orders_select_admin_bypass" ON public.orders AS PERMISSIVE FOR SELECT TO public USING (auth_is_admin());
CREATE POLICY "orders_select_parties" ON public.orders AS PERMISSIVE FOR SELECT TO public USING (((buyer_id = auth.uid()) OR (seller_id = auth.uid())));
CREATE POLICY "Admin update any profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.is_admin = true)))));
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id));
CREATE POLICY "Users update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "profiles_select_public" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING (true);

-- Production's execute grants on the order functions.
REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, numeric, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_order(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_order(uuid, text, jsonb) TO authenticated, service_role;

CREATE TRIGGER trg_profiles_enforce_safe_defaults_insert BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_enforce_safe_defaults_insert();
CREATE TRIGGER trg_profiles_prevent_privilege_escalation_update BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_prevent_privilege_escalation_update();
CREATE TRIGGER trg_notify_seller_on_order AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION notify_seller_on_order();
CREATE TRIGGER trg_order_completed_comp AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION create_comp_from_sale();
CREATE TRIGGER trg_orders_recompute_total_sales AFTER INSERT OR DELETE OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION recompute_profile_total_sales();
CREATE TRIGGER trg_orders_status_guard BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_status_guard();

-- The valuations guard Production runs: it reverts protected columns for a non-admin caller unless the write is trusted.
ALTER TABLE public.valuations ADD COLUMN IF NOT EXISTS user_confirmed boolean, ADD COLUMN IF NOT EXISTS user_correction text, ADD COLUMN IF NOT EXISTS identified_by text;
CREATE OR REPLACE FUNCTION public.valuations_freeze_authoritative_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   uuid;
  v_is_admin boolean;
  v_allowed  text[] := ARRAY['user_confirmed', 'user_correction', 'identified_by', 'listing_id'];
  v_patch    jsonb;
  v_reverted text;
BEGIN
  -- (a) Service role / internal (no JWT) → full trust.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- (b) Trusted server write path. PostgREST never sets app.* GUCs.
  IF current_setting('app.valuation_trusted_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- (c) Admins — read is_admin from the row, never from the JWT claim.
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- (d) Normal user: NEW = OLD overlaid with ONLY the allowlisted keys of NEW.
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    INTO v_patch
  FROM jsonb_each(to_jsonb(NEW))
  WHERE key = ANY(v_allowed);

  -- identified_by is the one column that is BOTH a pipeline output
  -- (api/analyze.js:3253) and a client write. The only client write that exists
  -- sets it to the literal 'user_confirmed' (src/contexts/AppContext.jsx:2490),
  -- so that is the only transition a non-trusted caller may make. Anything else
  -- keeps the pipeline's value.
  IF (v_patch ->> 'identified_by') IS DISTINCT FROM (to_jsonb(OLD) ->> 'identified_by')
     AND coalesce(v_patch ->> 'identified_by', '') <> 'user_confirmed' THEN
    RAISE WARNING 'valuations: refusing identified_by -> % (only ''user_confirmed'' is client-settable), uid=%',
      coalesce(v_patch ->> 'identified_by', 'NULL'), v_caller;
    v_patch := v_patch - 'identified_by';
  END IF;

  -- Observability: name every protected column the client tried to change.
  SELECT string_agg(key, ',') INTO v_reverted
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE NOT (key = ANY(v_allowed))
    AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> key);
  IF v_reverted IS NOT NULL THEN
    RAISE WARNING 'valuations: reverting protected column change(s) [%] attempted by uid=%',
      v_reverted, v_caller;
  END IF;

  NEW := jsonb_populate_record(OLD, v_patch);
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_valuations_freeze_authoritative_update BEFORE UPDATE ON public.valuations FOR EACH ROW EXECUTE FUNCTION public.valuations_freeze_authoritative_update();
