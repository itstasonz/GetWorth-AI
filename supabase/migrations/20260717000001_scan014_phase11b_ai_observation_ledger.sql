-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — SCAN-014 Phase 1.1B: AI Observation Ledger (SHADOW MODE, rev 2)
-- Generated: 2026-07-17
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`) BEFORE
-- deploying the matching api/analyze.js change.
-- Idempotent — safe to re-run. Requires 20260707000001 + 20260716000001.
--
-- What this migration does:
--   PART 1 — recognition_memory: `origin` column ('human' | 'ai_observed') —
--            a row-creation FACT, not a trust signal
--   PART 2 — recognition_memory_samples: `payload` jsonb + widen the
--            sample_type / provenance CHECKs ('ai_observation' / 'ai_scan')
--   PART 3 — idempotency: one AI observation per (memory_id, valuation_id)
--   PART 4 — memory_record_observation(): appends ai_observation samples and
--            MAY CREATE a zero-trust origin='ai_observed' row when the
--            canonical key is new. Never modifies existing rows. No recompute.
--   PART 5 — derive_memory_state(): DERIVED lifecycle state (never stored) —
--            observed → confirmed → community_confirmed
--            (+ quarantined / promoted; merged/deprecated/split/archived reserved)
--   PART 6 — memory_recompute(): explicit ai_observation exclusion from every
--            aggregate (defense in depth)
--   PART 7 — memory_append_sample(): rejects 'ai_observation'
--   PART 8 — grants
--
-- ARCHITECTURE SHIFT (approved trust-level design, Phase 1.1 rev):
--   ROW EXISTENCE IS NOT TRUST. Phase 1 used "row exists" as a proxy for
--   "a human confirmed this"; that proxy is retired. Any valid completed scan
--   may create an ai_observed row so repeated scans of never-confirmed
--   products leave an analyzable trace. Trust derives ONLY from ledger
--   samples, via aggregates recomputed from them:
--     • confirmation/correction/distinct-user counts count HUMAN samples only
--     • ai_observation samples carry ZERO weight in every aggregate: counts,
--       price percentiles, manual-price counts, human price freshness,
--       confidence, reputation, quarantine status. A hundred AI observations
--       leave confirmation_count=0, reputation=0, trust state 'observed'.
--     • memory_record_confirmation upserts by canonical_key, so a later human
--       confirmation REUSES the ai_observed row (no duplicate) and promotes
--       derived trust; `origin` keeps recording the creation fact.
--   Consumers (Phase 2 banner suppression, Phase 3 pricing) MUST gate on
--   the derived state (derive_memory_state / human counts), NEVER on row existence.
--
-- Shadow mode: nothing in the pipeline READS observation samples or trust
-- state. No pricing, confidence, retrieval, banner, or UI behavior changes.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — recognition_memory.origin (row-creation fact)
-- ══════════════════════════════════════════════════════════════════════════════
-- Existing rows default to 'human' — correct: before this migration the only
-- creating path was memory_record_confirmation.

ALTER TABLE public.recognition_memory
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'human'
  CHECK (origin IN ('human', 'ai_observed'));

COMMENT ON COLUMN public.recognition_memory.origin IS
  'SCAN-014 Phase 1.1B: which signal class CREATED this row (historical fact, immutable). NOT a trust signal and NOT the lifecycle state — the current state is derived from samples via derive_memory_state(). A row created by AI stays origin=ai_observed forever, even after human confirmations promote its derived trust.';

COMMENT ON TABLE public.recognition_memory IS
  'SCAN-014: CACHE of per-product aggregates. Source of truth is recognition_memory_samples; every aggregate column is derivable via memory_recompute() and may be rebuilt at any time. Only memory_recompute() writes aggregate columns. ROW EXISTENCE IS NOT TRUST (Phase 1.1B): rows may be created zero-trust by AI observations (origin=ai_observed); consumers must gate on the derived state (derive_memory_state / human sample counts), never on row existence.';


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — payload column + CHECK widening
-- ══════════════════════════════════════════════════════════════════════════════
-- payload: structured full-scan snapshot (confidences, pricing result +
-- provenance, authenticity, Stage-2 completion, Vision/OCE participation,
-- retrieval summary, identity, timing). Only ai_observation rows use it;
-- existing sample types keep it NULL. Versioned via payload->>'v'.

ALTER TABLE public.recognition_memory_samples
  ADD COLUMN IF NOT EXISTS payload jsonb;

COMMENT ON COLUMN public.recognition_memory_samples.payload IS
  'SCAN-014 Phase 1.1B: structured scan snapshot for sample_type=ai_observation (versioned, payload->>''v''). NULL for all other sample types. Observation confidences/prices live ONLY here — never in the scalar columns — so aggregates cannot ingest them.';

-- Inline CHECKs from 20260707000001 carry Postgres default names.
ALTER TABLE public.recognition_memory_samples
  DROP CONSTRAINT IF EXISTS recognition_memory_samples_sample_type_check;
ALTER TABLE public.recognition_memory_samples
  ADD CONSTRAINT recognition_memory_samples_sample_type_check
  CHECK (sample_type IN (
    'confirmation',
    'valuation_price',
    'manual_listing_price',
    'correction',
    'ai_observation'
  ));

ALTER TABLE public.recognition_memory_samples
  DROP CONSTRAINT IF EXISTS recognition_memory_samples_provenance_check;
ALTER TABLE public.recognition_memory_samples
  ADD CONSTRAINT recognition_memory_samples_provenance_check
  CHECK (provenance IN (
    'stage2_ai',
    'stage2_comp',
    'pre_haiku',
    'memory_stabilized',
    'seller',
    'user',
    'ai_scan'
  ));


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — idempotency: one observation per (memory_id, valuation_id)
-- ══════════════════════════════════════════════════════════════════════════════
-- Same pattern as uq_rm_samples_confirmation_once (Phase 1.1A). Each scan has
-- a fresh server-authoritative valuation_id (GW-000), so re-scans remain
-- distinct observations while retries/replays of the SAME scan are no-ops.

CREATE UNIQUE INDEX IF NOT EXISTS uq_rm_samples_ai_observation_once
  ON public.recognition_memory_samples (memory_id, valuation_id)
  WHERE sample_type = 'ai_observation'
    AND valuation_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — memory_record_observation(): create-or-append, zero trust
-- ══════════════════════════════════════════════════════════════════════════════
-- The ONLY path that writes ai_observation samples and the ONLY path that may
-- create origin='ai_observed' rows. Rules:
--   • New key  → creates the row with origin='ai_observed' and ALL aggregate
--     columns at their zero-trust defaults (counts 0, reputation 0,
--     status 'active', derived trust 'observed').
--   • Existing key → ON CONFLICT DO NOTHING: an AI observation NEVER modifies
--     an existing row's fields (no display-name fill, no last_seen bump —
--     the aggregate row stays bit-identical).
--   • Appends one idempotent ai_observation sample. No recompute — a fresh
--     ai_observed row's aggregates are already the recompute fixed point, and
--     existing rows must not be touched.
--   • Fails soft (NULL) on a missing/empty key: observation is best-effort.

-- Defensive: drop the pre-revision draft signature if it was ever applied.
DROP FUNCTION IF EXISTS public.memory_record_observation(text, jsonb, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.memory_record_observation(
  p_canonical_key  text,
  p_key_version    integer DEFAULT 1,
  p_brand          text    DEFAULT NULL,
  p_model          text    DEFAULT NULL,
  p_display_name   text    DEFAULT NULL,
  p_category       text    DEFAULT NULL,
  p_subcategory    text    DEFAULT NULL,
  p_payload        jsonb   DEFAULT '{}'::jsonb,
  p_user_id        uuid    DEFAULT NULL,
  p_scan_uuid      uuid    DEFAULT NULL,
  p_valuation_id   uuid    DEFAULT NULL
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
    RETURN NULL;
  END IF;
  IF p_payload IS NOT NULL AND jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'memory_record_observation: payload must be a JSON object';
  END IF;

  -- Create-if-missing, zero-trust. DO NOTHING (not DO UPDATE): AI must never
  -- modify an existing row, whatever its origin.
  INSERT INTO recognition_memory (
    canonical_key, key_version, brand, model,
    display_name, category, subcategory, origin
  )
  VALUES (
    p_canonical_key, COALESCE(p_key_version, 1),
    COALESCE(p_brand, ''), COALESCE(p_model, ''),
    p_display_name, COALESCE(p_category, ''), p_subcategory, 'ai_observed'
  )
  ON CONFLICT (canonical_key) DO NOTHING;

  SELECT id INTO v_id FROM recognition_memory WHERE canonical_key = p_canonical_key;
  IF v_id IS NULL THEN
    RETURN NULL;  -- unreachable in practice; fail soft regardless
  END IF;

  INSERT INTO recognition_memory_samples (
    memory_id, sample_type, provenance, payload,
    user_id, scan_uuid, valuation_id
  )
  VALUES (v_id, 'ai_observation', 'ai_scan', COALESCE(p_payload, '{}'::jsonb),
          p_user_id, p_scan_uuid, p_valuation_id)
  ON CONFLICT (memory_id, valuation_id)
    WHERE sample_type = 'ai_observation'
      AND valuation_id IS NOT NULL
    DO NOTHING;

  -- No recompute, no aggregate-row touch — observations have zero weight.
  RETURN v_id;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5 — derive_memory_state(): derived lifecycle state, never stored
-- ══════════════════════════════════════════════════════════════════════════════
-- ORIGIN vs STATE (approved refinement): `origin` is immutable historical
-- metadata — who CREATED the row (ai_observed / human; future: import,
-- migration, admin). The memory STATE is the row's current lifecycle stage and
-- evolves over time. Today every state is derivable from the aggregate row
-- (itself recomputable from samples), so the state is a pure function — the
-- single definition every future consumer must share. Internal/debug in
-- Phase 1.1B: nothing in the pipeline calls it.
--
--   promoted            → official catalog product exists (always outranks)
--   quarantined         → corrections >= confirmations (and exist)
--   community_confirmed → >= 3 distinct confirming users
--   confirmed           → >= 1 human confirmation
--   observed            → AI history only (zero behavioral rights)
--
-- RESERVED future lifecycle states (NOT derivable from samples — when needed
-- they arrive as a stored override column, e.g. lifecycle_override, which this
-- function will check FIRST): 'merged' (folded into another canonical
-- identity), 'deprecated', 'split', 'archived'. Do not repurpose these names.

DROP FUNCTION IF EXISTS public.memory_trust_state(public.recognition_memory);

CREATE OR REPLACE FUNCTION public.derive_memory_state(m public.recognition_memory)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN m.promoted_product_id IS NOT NULL                                    THEN 'promoted'
    WHEN m.correction_count > 0 AND m.correction_count >= m.confirmation_count THEN 'quarantined'
    WHEN m.distinct_user_count >= 3                                            THEN 'community_confirmed'
    WHEN m.confirmation_count >= 1                                             THEN 'confirmed'
    ELSE 'observed'
  END
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 6 — memory_recompute(): explicit ai_observation exclusion
-- ══════════════════════════════════════════════════════════════════════════════
-- Same signature/behavior as Phase 1 for all human/valuation samples. Delta:
-- every aggregate now explicitly excludes sample_type='ai_observation'. Most
-- queries already excluded it structurally (sample_type whitelists, provenance
-- filters); the confidence aggregate was the one unfiltered query and is the
-- reason this replace exists. The rest gain the filter as defense in depth.

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
  WHERE memory_id = p_memory_id
    AND sample_type <> 'ai_observation';

  -- Price aggregates: medians/percentiles over the last 20 ELIGIBLE price
  -- samples within 180 days. Eligible = price-bearing sample types with
  -- provenance != 'memory_stabilized' (zero aggregate weight, SCAN-014 §8).
  -- ai_observation is excluded by the sample_type whitelist (and its prices
  -- live only in payload anyway).
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

  -- Freshness of the newest HUMAN-verified price signal. 'ai_scan' provenance
  -- is excluded by the seller/user whitelist.
  SELECT MAX(created_at)
  INTO v_last_verified
  FROM recognition_memory_samples
  WHERE memory_id = p_memory_id
    AND price IS NOT NULL AND price > 0
    AND provenance IN ('seller', 'user');

  -- Confidence aggregate — THE Phase 1.1B fix: this was the only query with
  -- no sample_type filter. AI observation confidences must never enter the
  -- reputation formula (0.15 weight), even if a future caller writes them to
  -- the scalar column instead of payload.
  SELECT AVG(source_confidence), MAX(source_confidence)
  INTO v_conf_avg, v_conf_max
  FROM recognition_memory_samples
  WHERE memory_id = p_memory_id
    AND source_confidence IS NOT NULL
    AND sample_type <> 'ai_observation';

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
-- PART 7 — memory_append_sample(): reject ai_observation
-- ══════════════════════════════════════════════════════════════════════════════
-- Same signature as Phase 1 (grants preserved by CREATE OR REPLACE). Delta:
-- 'ai_observation' is rejected alongside 'confirmation' so each signal class
-- keeps exactly one audited write path (confirmation → record_confirmation,
-- observation → record_observation, everything else → here). Note: this RPC
-- still NEVER creates rows — with Phase 1.1B it may now append to
-- origin='ai_observed' rows, and callers that must not feed price aggregates
-- on zero-trust rows are responsible for gating on human trust (analyze.js
-- gates valuation_price on confirmation_count > 0).

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
  IF p_sample_type = 'ai_observation' THEN
    RAISE EXCEPTION 'memory_append_sample: observations must go through memory_record_observation';
  END IF;

  SELECT id INTO v_id FROM recognition_memory WHERE canonical_key = p_canonical_key;
  IF v_id IS NULL THEN
    RETURN NULL;  -- no memory row → append refused by design (never creates)
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


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 8 — grants (new/changed functions; replacements keep existing grants)
-- ══════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.memory_record_observation(text, integer, text, text, text, text, text, jsonb, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memory_record_observation(text, integer, text, text, text, text, text, jsonb, uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.derive_memory_state(public.recognition_memory) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derive_memory_state(public.recognition_memory) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 9 — Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'recognition_memory' AND column_name = 'origin';
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'recognition_memory_samples'
--     AND indexname = 'uq_rm_samples_ai_observation_once';
-- SELECT proname FROM pg_proc
--   WHERE proname IN ('memory_record_observation', 'derive_memory_state');
-- -- Derived trust snapshot:
-- SELECT canonical_key, origin, confirmation_count, distinct_user_count,
--        derive_memory_state(m.*) AS state FROM recognition_memory m LIMIT 20;
