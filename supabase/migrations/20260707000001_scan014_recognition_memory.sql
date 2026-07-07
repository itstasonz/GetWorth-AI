-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — SCAN-014 Phase 1: Recognition Memory Layer (SHADOW MODE)
-- Generated: 2026-07-07
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`) BEFORE
-- deploying the matching api/analyze.js + api/submit-candidate.js changes.
-- Idempotent — safe to re-run.
--
-- What this migration does:
--   PART 1 — recognition_memory: one aggregate row per canonical product key
--   PART 2 — recognition_memory_samples: append-only signal ledger (the truth;
--            the aggregate row is fully recomputable from it)
--   PART 3 — memory_recompute(): internal aggregate recompute (never exposed)
--   PART 4 — RPCs: memory_lookup / memory_record_confirmation /
--            memory_append_sample — SECURITY DEFINER, service-role-only
--   PART 5 — RLS + grants (writes: service role only; reads: admin only)
--
-- Invariants (SCAN-014 design §7/§8 — enforced HERE, not in app code):
--   • SOURCE OF TRUTH: recognition_memory_samples is the permanent record.
--     recognition_memory is a CACHE — every aggregate column is derivable by
--     memory_recompute() and may be rebuilt at any time. Future consumers
--     (Phase 2/3+) must treat stored percentiles as a convenience snapshot,
--     never as authoritative state: any logic that needs a different window,
--     weighting, or statistic recomputes FROM SAMPLES rather than deriving
--     from price_p25/p50/p75. Nothing may write aggregate columns except
--     memory_recompute().
--   • Memory rows are CREATED only by human signals: the single creating path
--     is memory_record_confirmation(). memory_append_sample() NEVER creates.
--     → AI-only scans can never seed memory (no self-reinforcing loop).
--   • provenance='memory_stabilized' samples carry ZERO aggregate weight:
--     memory_recompute() excludes them from every price statistic. (Nothing
--     writes that provenance in Phase 1; the exclusion is in place for Phase 3.)
--   • Price aggregates use medians/percentiles over a bounded recency window
--     (last 20 eligible samples within 180 days) — outlier-resistant by shape.
--   • correction_count >= confirmation_count (with at least one correction)
--     auto-quarantines the row; recompute flips it back if confirmations
--     later outweigh.
--
-- Phase 1 is SHADOW ONLY: the app reads memory into _debug.memory and writes
-- samples, but nothing in pricing, retrieval, confidence, or UI consumes it.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — recognition_memory (aggregate state, one row per canonical key)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.recognition_memory (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Versioned canonical identity. v1 format: 'v1|<category>|<brand>|<model>'
  -- built ONLY by api/_lib/recognition-memory.js (frozen v1 normalization).
  canonical_key         text        NOT NULL UNIQUE,
  key_version           integer     NOT NULL DEFAULT 1,

  brand                 text        NOT NULL,
  model                 text        NOT NULL,
  display_name          text,
  display_name_hebrew   text,
  category              text        NOT NULL,
  subcategory           text,
  aliases               text[]      NOT NULL DEFAULT '{}',

  -- Reserved for future key versions (color / size / edition / variant /
  -- storage / condition / authenticity / market context). v1 keys never carry
  -- attributes; a future v2 key builder folds selected attrs in here.
  key_attrs             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  status                text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'quarantined')),

  -- Aggregates — derived from recognition_memory_samples by memory_recompute().
  confirmation_count    integer     NOT NULL DEFAULT 0,
  distinct_user_count   integer     NOT NULL DEFAULT 0,
  correction_count      integer     NOT NULL DEFAULT 0,
  price_sample_count    integer     NOT NULL DEFAULT 0,
  manual_price_count    integer     NOT NULL DEFAULT 0,
  price_p25             integer,
  price_p50             integer,
  price_p75             integer,
  last_price_mid        integer,
  -- When the most recent HUMAN-verified price signal arrived (a price-bearing
  -- sample with provenance 'seller' or 'user' — Phase 1: manual listing
  -- prices). NULL until one exists. Freshness anchor for Phase-3 staleness
  -- decisions, so pricing logic never has to infer it from percentiles.
  last_verified_price_at timestamptz,
  confidence_avg        numeric,
  confidence_max        numeric,

  -- Phase 1 heuristic, internal/debug only (see memory_recompute for formula).
  recognition_reputation_score numeric NOT NULL DEFAULT 0,

  first_seen            timestamptz NOT NULL DEFAULT now(),
  last_seen             timestamptz NOT NULL DEFAULT now(),

  -- Bridges to the existing catalog workflow (memory never bypasses it).
  candidate_id          uuid        NULL REFERENCES public.product_candidates(id) ON DELETE SET NULL,
  promoted_product_id   uuid        NULL REFERENCES public.products(id)           ON DELETE SET NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recognition_memory_status    ON public.recognition_memory (status);
CREATE INDEX IF NOT EXISTS idx_recognition_memory_candidate ON public.recognition_memory (candidate_id) WHERE candidate_id IS NOT NULL;

-- updated_at trigger — reuses set_updated_at() from 20260527000001 if present,
-- creating it defensively so this migration is standalone-safe.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_recognition_memory_updated_at ON public.recognition_memory;
CREATE TRIGGER set_recognition_memory_updated_at
  BEFORE UPDATE ON public.recognition_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — recognition_memory_samples (append-only ledger)
-- ══════════════════════════════════════════════════════════════════════════════
-- user_id is a plain uuid (no FK to auth.users) — same pattern as observations:
-- right-to-erasure nulls it via the service role without breaking the signal.

CREATE TABLE IF NOT EXISTS public.recognition_memory_samples (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id          uuid        NOT NULL REFERENCES public.recognition_memory(id) ON DELETE CASCADE,

  sample_type        text        NOT NULL
                       CHECK (sample_type IN (
                         'confirmation',
                         'valuation_price',
                         'manual_listing_price',
                         'correction'
                       )),

  price              integer     CHECK (price IS NULL OR price >= 0),
  condition          text,
  source_confidence  numeric     CHECK (source_confidence IS NULL
                                        OR (source_confidence >= 0 AND source_confidence <= 1)),

  provenance         text        NOT NULL
                       CHECK (provenance IN (
                         'stage2_ai',
                         'stage2_comp',
                         'pre_haiku',
                         'memory_stabilized',
                         'seller',
                         'user'
                       )),

  user_id            uuid,
  scan_uuid          uuid,
  valuation_id       uuid,
  -- clock_timestamp(), not now(): now() is transaction-frozen, which makes
  -- "latest sample" ordering arbitrary for rows inserted in one transaction.
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_rm_samples_memory     ON public.recognition_memory_samples (memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rm_samples_type       ON public.recognition_memory_samples (sample_type);
CREATE INDEX IF NOT EXISTS idx_rm_samples_user       ON public.recognition_memory_samples (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rm_samples_valuation  ON public.recognition_memory_samples (valuation_id) WHERE valuation_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — memory_recompute(): derive the aggregate row from the ledger
-- ══════════════════════════════════════════════════════════════════════════════
-- Called by the write RPCs after every sample insert. Deterministic and total:
-- re-running it against the same ledger always yields the same aggregate row.

CREATE OR REPLACE FUNCTION public.memory_recompute(p_memory_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirmations   integer;
  v_distinct_users  integer;
  v_corrections     integer;
  v_price_count     integer;
  v_manual_count    integer;
  v_p25             integer;
  v_p50             integer;
  v_p75             integer;
  v_last_price      integer;
  v_last_verified   timestamptz;
  v_conf_avg        numeric;
  v_conf_max        numeric;
  v_score           numeric;
  v_status          text;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE sample_type = 'confirmation'),
    COUNT(DISTINCT user_id) FILTER (WHERE sample_type = 'confirmation' AND user_id IS NOT NULL),
    COUNT(*) FILTER (WHERE sample_type = 'correction')
  INTO v_confirmations, v_distinct_users, v_corrections
  FROM recognition_memory_samples
  WHERE memory_id = p_memory_id;

  -- Price aggregates: medians/percentiles over the last 20 ELIGIBLE price
  -- samples within 180 days. Eligible = price-bearing sample types with
  -- provenance != 'memory_stabilized' (zero aggregate weight, SCAN-014 §8).
  WITH eligible AS (
    SELECT price, created_at
    FROM recognition_memory_samples
    WHERE memory_id = p_memory_id
      AND sample_type IN ('valuation_price', 'manual_listing_price')
      AND provenance <> 'memory_stabilized'
      AND price IS NOT NULL AND price > 0
      AND created_at > now() - interval '180 days'
    ORDER BY created_at DESC
    LIMIT 20
  )
  SELECT
    COUNT(*),
    ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY price))::integer,
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY price))::integer,
    ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY price))::integer,
    (ARRAY_AGG(price ORDER BY created_at DESC))[1]
  INTO v_price_count, v_p25, v_p50, v_p75, v_last_price
  FROM eligible;

  SELECT COUNT(*)
  INTO v_manual_count
  FROM recognition_memory_samples
  WHERE memory_id = p_memory_id
    AND sample_type = 'manual_listing_price'
    AND provenance <> 'memory_stabilized';

  -- Freshness of the newest HUMAN-verified price signal (no window/limit —
  -- staleness policy is the consumer's decision, this is just the raw fact).
  SELECT MAX(created_at)
  INTO v_last_verified
  FROM recognition_memory_samples
  WHERE memory_id = p_memory_id
    AND price IS NOT NULL AND price > 0
    AND provenance IN ('seller', 'user');

  SELECT AVG(source_confidence), MAX(source_confidence)
  INTO v_conf_avg, v_conf_max
  FROM recognition_memory_samples
  WHERE memory_id = p_memory_id AND source_confidence IS NOT NULL;

  -- Quarantine rule: corrections at least match confirmations (and exist).
  v_status := CASE
    WHEN v_corrections > 0 AND v_corrections >= v_confirmations THEN 'quarantined'
    ELSE 'active'
  END;

  -- Phase-1 reputation heuristic (internal/debug only, documented in SCAN-014):
  --   0.35 · confirmations (saturates at 5)
  -- + 0.25 · distinct confirming users (saturates at 3)
  -- + 0.25 · trust ratio confirmations/(confirmations+corrections)
  -- + 0.15 · average source confidence
  v_score := ROUND(
      0.35 * (LEAST(v_confirmations, 5)::numeric / 5)
    + 0.25 * (LEAST(v_distinct_users, 3)::numeric / 3)
    + 0.25 * (v_confirmations::numeric / GREATEST(v_confirmations + v_corrections, 1))
    + 0.15 * COALESCE(v_conf_avg, 0)
  , 3);

  UPDATE recognition_memory
  SET confirmation_count  = v_confirmations,
      distinct_user_count = v_distinct_users,
      correction_count    = v_corrections,
      price_sample_count  = COALESCE(v_price_count, 0),
      manual_price_count  = COALESCE(v_manual_count, 0),
      price_p25           = v_p25,
      price_p50           = v_p50,
      price_p75           = v_p75,
      last_price_mid      = v_last_price,
      last_verified_price_at = v_last_verified,
      confidence_avg      = v_conf_avg,
      confidence_max      = v_conf_max,
      recognition_reputation_score = COALESCE(v_score, 0),
      status              = v_status,
      last_seen           = now()
  WHERE id = p_memory_id;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — RPCs (the ONLY access paths; all SECURITY DEFINER, service-role only)
-- ══════════════════════════════════════════════════════════════════════════════

-- memory_lookup: exact canonical-key equality — no ILIKE, no fuzzy matching.
-- Returns 0 or 1 rows.
CREATE OR REPLACE FUNCTION public.memory_lookup(p_canonical_key text)
RETURNS SETOF public.recognition_memory
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT * FROM recognition_memory WHERE canonical_key = p_canonical_key LIMIT 1;
$$;

-- memory_record_confirmation: THE single row-creating path (human signal only).
-- Upserts the aggregate row, appends one 'confirmation' sample, recomputes.
-- Returns the memory row id.
CREATE OR REPLACE FUNCTION public.memory_record_confirmation(
  p_canonical_key        text,
  p_key_version          integer,
  p_brand                text,
  p_model                text,
  p_display_name         text    DEFAULT NULL,
  p_display_name_hebrew  text    DEFAULT NULL,
  p_category             text    DEFAULT NULL,
  p_subcategory          text    DEFAULT NULL,
  p_user_id              uuid    DEFAULT NULL,
  p_scan_uuid            uuid    DEFAULT NULL,
  p_valuation_id         uuid    DEFAULT NULL,
  p_confidence           numeric DEFAULT NULL,
  p_candidate_id         uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_canonical_key IS NULL OR length(trim(p_canonical_key)) = 0 THEN
    RAISE EXCEPTION 'memory_record_confirmation: canonical_key is required';
  END IF;

  INSERT INTO recognition_memory (
    canonical_key, key_version, brand, model,
    display_name, display_name_hebrew, category, subcategory, candidate_id
  )
  VALUES (
    p_canonical_key, COALESCE(p_key_version, 1),
    COALESCE(p_brand, ''), COALESCE(p_model, ''),
    p_display_name, p_display_name_hebrew,
    COALESCE(p_category, ''), p_subcategory, p_candidate_id
  )
  ON CONFLICT (canonical_key) DO UPDATE
    SET display_name        = COALESCE(recognition_memory.display_name,        EXCLUDED.display_name),
        display_name_hebrew = COALESCE(recognition_memory.display_name_hebrew, EXCLUDED.display_name_hebrew),
        subcategory         = COALESCE(recognition_memory.subcategory,         EXCLUDED.subcategory),
        candidate_id        = COALESCE(recognition_memory.candidate_id,        EXCLUDED.candidate_id),
        last_seen           = now()
  RETURNING id INTO v_id;

  INSERT INTO recognition_memory_samples (
    memory_id, sample_type, source_confidence, provenance,
    user_id, scan_uuid, valuation_id
  )
  VALUES (v_id, 'confirmation', p_confidence, 'user', p_user_id, p_scan_uuid, p_valuation_id);

  PERFORM memory_recompute(v_id);
  RETURN v_id;
END;
$$;

-- memory_append_sample: appends to an EXISTING row only — returns NULL (and
-- writes nothing) when the key has no row. This is the DB-level enforcement of
-- "AI-only scans never create memory". 'confirmation' samples are rejected
-- here so row creation stays a single audited path.
CREATE OR REPLACE FUNCTION public.memory_append_sample(
  p_canonical_key      text,
  p_sample_type        text,
  p_price              integer DEFAULT NULL,
  p_condition          text    DEFAULT NULL,
  p_source_confidence  numeric DEFAULT NULL,
  p_provenance         text    DEFAULT 'stage2_ai',
  p_user_id            uuid    DEFAULT NULL,
  p_scan_uuid          uuid    DEFAULT NULL,
  p_valuation_id       uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sample_type = 'confirmation' THEN
    RAISE EXCEPTION 'memory_append_sample: confirmations must go through memory_record_confirmation';
  END IF;

  SELECT id INTO v_id FROM recognition_memory WHERE canonical_key = p_canonical_key;
  IF v_id IS NULL THEN
    RETURN NULL;  -- no human-created row → append refused by design
  END IF;

  INSERT INTO recognition_memory_samples (
    memory_id, sample_type, price, condition, source_confidence, provenance,
    user_id, scan_uuid, valuation_id
  )
  VALUES (v_id, p_sample_type, p_price, p_condition, p_source_confidence,
          p_provenance, p_user_id, p_scan_uuid, p_valuation_id);

  PERFORM memory_recompute(v_id);
  RETURN v_id;
END;
$$;


-- Pin the source-of-truth contract in the catalog itself, where every future
-- reader of the schema will see it.
COMMENT ON TABLE public.recognition_memory IS
  'SCAN-014: CACHE of per-product aggregates. Source of truth is recognition_memory_samples; every aggregate column is derivable via memory_recompute() and may be rebuilt at any time. Only memory_recompute() writes aggregate columns. Consumers needing a different window/weighting/statistic must recompute from samples, not derive from stored percentiles.';
COMMENT ON TABLE public.recognition_memory_samples IS
  'SCAN-014: append-only permanent ledger of human + valuation signals. THE source of truth for the recognition memory layer. Never updated or deleted except service-role GDPR user_id nulling.';
COMMENT ON COLUMN public.recognition_memory.last_verified_price_at IS
  'MAX(created_at) of price-bearing samples with provenance seller/user — freshness of the newest human-verified price. Maintained by memory_recompute().';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5 — RLS + grants
-- ══════════════════════════════════════════════════════════════════════════════
-- Writes: service role only (bypasses RLS; clients have NO insert/update path —
-- both write RPCs are revoked from anon/authenticated below).
-- Reads: admin only (future dashboard), same pattern as scan_events/observations.

ALTER TABLE public.recognition_memory         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_memory_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recognition_memory_admin_select ON public.recognition_memory;
CREATE POLICY recognition_memory_admin_select
  ON public.recognition_memory FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

DROP POLICY IF EXISTS rm_samples_admin_select ON public.recognition_memory_samples;
CREATE POLICY rm_samples_admin_select
  ON public.recognition_memory_samples FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- Supabase auto-grants EXECUTE on public functions to anon + authenticated via
-- default privileges, and REVOKE FROM PUBLIC does not remove explicit role
-- grants — revoke explicitly (same hardening as record_scan, GW-000).
REVOKE ALL ON FUNCTION public.memory_recompute(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.memory_lookup(text)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.memory_record_confirmation(text, integer, text, text, text, text, text, text, uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.memory_append_sample(text, text, integer, text, numeric, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.memory_lookup(text)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.memory_record_confirmation(text, integer, text, text, text, text, text, text, uuid, uuid, uuid, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.memory_append_sample(text, text, integer, text, numeric, text, uuid, uuid, uuid) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 6 — Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT to_regclass('public.recognition_memory');
-- SELECT to_regclass('public.recognition_memory_samples');
-- SELECT proname FROM pg_proc
--   WHERE proname IN ('memory_lookup','memory_record_confirmation','memory_append_sample','memory_recompute');
