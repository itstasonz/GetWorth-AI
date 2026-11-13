-- ══════════════════════════════════════════════════════════════════════════════
-- MARKET INDEX: NORMALISED OBSERVATIONS WITH PRICE HISTORY (2026-11-13)
--
-- ADDITIVE ONLY. Two new tables and two new functions; no existing table, policy or function changes.
-- Rollback: supabase/manual/20261113120000_rollback_market_observations.sql
--
--   market_observations         one row per listing (fingerprint) per product (product_key): what it is, where, under
--                               which source permission, its segment (private asking / completed sale / refurbished /
--                               new retail / price guide — never mixed), first and last sighting, and how long it may be
--                               kept (retain_until, set by the source's permission: history only for permitted sources,
--                               the scan's 7-day research window otherwise).
--   market_observation_prices   every price a listing was seen at, appended — never overwritten.
--   record_market_observations  service_role only: upsert a research's observations; a sighting is added when the price
--                               changed or on first sight.
--   purge_market_observations   service_role only: delete what is past its retention (prices cascade).
--
-- No person, photograph or account is stored. Only the scan server (service_role) can read or write: RLS on, no policy.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_observations (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_key    text NOT NULL CHECK (length(product_key) BETWEEN 8 AND 64),
  product_label  text CHECK (product_label IS NULL OR length(product_label) <= 200),
  fingerprint    text NOT NULL CHECK (length(fingerprint) BETWEEN 8 AND 64),
  source_id      text NOT NULL CHECK (length(source_id) <= 80),
  permission     text NOT NULL CHECK (permission IN ('authorized','authorized_restricted','public_research_only','unknown')),
  segment        text NOT NULL CHECK (segment IN ('private_asking','completed_sale','refurbished','new_retail','price_guide')),
  market         text NOT NULL CHECK (market IN ('IL','INTL')),
  url            text NOT NULL CHECK (length(url) <= 500),
  title          text CHECK (title IS NULL OR length(title) <= 200),
  condition      text,
  match          text NOT NULL CHECK (match IN ('exact','close_comparable')),
  price          numeric NOT NULL CHECK (price > 0),
  currency       char(3) NOT NULL,
  price_ils      numeric CHECK (price_ils IS NULL OR price_ils > 0),
  listed_on      date,
  archived       boolean NOT NULL DEFAULT false,
  verification   text,
  rules_version  integer NOT NULL,
  reference      jsonb NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  retain_until   timestamptz NOT NULL,
  sightings      integer NOT NULL DEFAULT 1,
  UNIQUE (product_key, fingerprint)
);
CREATE INDEX IF NOT EXISTS market_observations_product_recent ON public.market_observations (product_key, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS market_observations_retain ON public.market_observations (retain_until);

CREATE TABLE IF NOT EXISTS public.market_observation_prices (
  observation_id bigint NOT NULL REFERENCES public.market_observations(id) ON DELETE CASCADE,
  seen_at        timestamptz NOT NULL DEFAULT now(),
  price          numeric NOT NULL CHECK (price > 0),
  currency       char(3) NOT NULL,
  price_ils      numeric,
  PRIMARY KEY (observation_id, seen_at)
);

ALTER TABLE public.market_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_observation_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_observations, public.market_observation_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_observations, public.market_observation_prices TO service_role;

CREATE OR REPLACE FUNCTION public.record_market_observations(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb;
  v_id bigint;
  v_old numeric;
  v_n integer := 0;
  v_seen timestamptz;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'p_rows must be an array of at most 100 observations' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_seen := coalesce((r->>'seen_at')::timestamptz, now());
    SELECT id, price INTO v_id, v_old FROM market_observations
     WHERE product_key = r->>'product_key' AND fingerprint = r->>'fingerprint' FOR UPDATE;
    IF v_id IS NULL THEN
      INSERT INTO market_observations (product_key, product_label, fingerprint, source_id, permission, segment, market, url, title,
        condition, match, price, currency, price_ils, listed_on, archived, verification, rules_version, reference,
        first_seen_at, last_seen_at, retain_until)
      VALUES (r->>'product_key', r->>'product_label', r->>'fingerprint', r->>'source_id', r->>'permission', r->>'segment', r->>'market',
        r->>'url', r->>'title', r->>'condition', r->>'match', (r->>'price')::numeric, r->>'currency', (r->>'price_ils')::numeric,
        (r->>'listed_on')::date, coalesce((r->>'archived')::boolean, false), r->>'verification', (r->>'rules_version')::integer,
        r->'reference', v_seen, v_seen, (r->>'retain_until')::timestamptz)
      RETURNING id INTO v_id;
      INSERT INTO market_observation_prices (observation_id, seen_at, price, currency, price_ils)
      VALUES (v_id, v_seen, (r->>'price')::numeric, r->>'currency', (r->>'price_ils')::numeric) ON CONFLICT DO NOTHING;
    ELSE
      UPDATE market_observations SET
        last_seen_at = greatest(last_seen_at, v_seen),
        retain_until = greatest(retain_until, (r->>'retain_until')::timestamptz),
        price = (r->>'price')::numeric, price_ils = (r->>'price_ils')::numeric, currency = r->>'currency',
        archived = coalesce((r->>'archived')::boolean, archived), condition = r->>'condition', segment = r->>'segment',
        match = r->>'match', permission = r->>'permission', rules_version = (r->>'rules_version')::integer,
        reference = r->'reference', sightings = sightings + 1
      WHERE id = v_id;
      IF v_old IS DISTINCT FROM (r->>'price')::numeric THEN
        INSERT INTO market_observation_prices (observation_id, seen_at, price, currency, price_ils)
        VALUES (v_id, v_seen, (r->>'price')::numeric, r->>'currency', (r->>'price_ils')::numeric) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    v_id := NULL;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_market_observations(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_market_observations(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_market_observations()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH gone AS (DELETE FROM market_observations WHERE retain_until < now() RETURNING 1)
  SELECT count(*)::integer FROM gone
$function$;
REVOKE ALL ON FUNCTION public.purge_market_observations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_market_observations() TO service_role;
