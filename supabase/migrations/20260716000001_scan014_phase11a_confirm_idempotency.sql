-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — SCAN-014 Phase 1.1A: Universal Confirmation — DB idempotency
-- Generated: 2026-07-16
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`) BEFORE
-- deploying api/confirm-identity.js + the api/submit-candidate.js change.
-- Idempotent — safe to re-run. Requires 20260707000001 (Phase 1).
--
-- What this migration does:
--   PART 1 — dedupe any pre-existing duplicate confirmation samples
--            (same memory_id + user_id + valuation_id; keeps the earliest)
--            and recompute the affected aggregate rows
--   PART 2 — unique partial index: ONE confirmation per
--            (memory_id, user_id, valuation_id) — enforced by the database
--   PART 3 — memory_record_confirmation becomes idempotent: a duplicate
--            confirmation is a silent no-op (no sample, no recompute; the
--            memory row id is still returned)
--
-- Why (Phase 1.1A design audit): memory confirmations decouple from
-- submit-candidate onto a universal /api/confirm-identity endpoint. During
-- rollout both paths may fire for the same confirmation, and clients may
-- retry on reconnect — the ledger must stay duplicate-free regardless of
-- which caller races. (user_id, valuation_id) is the natural event identity:
-- each scan/refine creates a fresh valuation, so re-confirming the same
-- product on a LATER scan remains a distinct, legitimate sample.
--
-- Invariants preserved (SCAN-014 §7/§8):
--   • recognition_memory_samples stays the append-only source of truth;
--     the one-time dedupe below removes only idempotency artifacts
--     (byte-identical event coordinates), never distinct signals.
--   • recognition_memory stays a recomputable cache (memory_recompute only).
--   • Rows are still CREATED only by memory_record_confirmation.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — one-time dedupe of pre-index duplicates (keep earliest), then
--          recompute every touched aggregate so counts match the ledger.
-- ══════════════════════════════════════════════════════════════════════════════

WITH ranked AS (
  SELECT id, memory_id,
         ROW_NUMBER() OVER (
           PARTITION BY memory_id, user_id, valuation_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.recognition_memory_samples
  WHERE sample_type = 'confirmation'
    AND user_id      IS NOT NULL
    AND valuation_id IS NOT NULL
),
doomed AS (
  DELETE FROM public.recognition_memory_samples s
  USING ranked r
  WHERE s.id = r.id AND r.rn > 1
  RETURNING r.memory_id
)
SELECT public.memory_recompute(memory_id)
FROM (SELECT DISTINCT memory_id FROM doomed) d;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — DB-enforced idempotency: one confirmation per
--          (memory_id, user_id, valuation_id)
-- ══════════════════════════════════════════════════════════════════════════════
-- Partial: legacy/edge samples with a NULL user or valuation are not (and
-- cannot meaningfully be) deduplicated — uniqueness needs both coordinates.

CREATE UNIQUE INDEX IF NOT EXISTS uq_rm_samples_confirmation_once
  ON public.recognition_memory_samples (memory_id, user_id, valuation_id)
  WHERE sample_type = 'confirmation'
    AND user_id      IS NOT NULL
    AND valuation_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — memory_record_confirmation: duplicate confirmations become no-ops
-- ══════════════════════════════════════════════════════════════════════════════
-- Same signature as Phase 1 (grants and callers unchanged). Behavior delta:
-- the sample insert is ON CONFLICT DO NOTHING against the index above, and
-- recompute runs only when a sample was actually inserted. The aggregate-row
-- upsert still refreshes last_seen / fills missing display fields either way.

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

  -- Idempotent append: a replayed (memory, user, valuation) confirmation hits
  -- uq_rm_samples_confirmation_once and inserts nothing. Confirmations with a
  -- NULL user or valuation (not covered by the partial index) insert as before.
  INSERT INTO recognition_memory_samples (
    memory_id, sample_type, source_confidence, provenance,
    user_id, scan_uuid, valuation_id
  )
  VALUES (v_id, 'confirmation', p_confidence, 'user', p_user_id, p_scan_uuid, p_valuation_id)
  ON CONFLICT (memory_id, user_id, valuation_id)
    WHERE sample_type = 'confirmation'
      AND user_id      IS NOT NULL
      AND valuation_id IS NOT NULL
    DO NOTHING;

  IF FOUND THEN
    PERFORM memory_recompute(v_id);
  END IF;

  RETURN v_id;
END;
$$;

-- CREATE OR REPLACE preserves existing grants; re-assert defensively anyway
-- (same hardening as Phase 1 — Supabase default privileges auto-grant EXECUTE).
REVOKE ALL ON FUNCTION public.memory_record_confirmation(text, integer, text, text, text, text, text, text, uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memory_record_confirmation(text, integer, text, text, text, text, text, text, uuid, uuid, uuid, numeric, uuid) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'recognition_memory_samples'
--     AND indexname = 'uq_rm_samples_confirmation_once';
-- -- Duplicate check must return 0 rows:
-- SELECT memory_id, user_id, valuation_id, COUNT(*)
--   FROM recognition_memory_samples
--   WHERE sample_type = 'confirmation' AND user_id IS NOT NULL AND valuation_id IS NOT NULL
--   GROUP BY 1,2,3 HAVING COUNT(*) > 1;
