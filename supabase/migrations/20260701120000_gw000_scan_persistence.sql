-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — GW-000 Reliable Scan Persistence + Lifecycle Identity
-- Generated: 2026-07-01
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`) BEFORE deploying
-- the matching api/analyze.js + client changes. Idempotent — safe to re-run.
--
-- What this migration does:
--   PART 1 — valuations: add scan_uuid (lifecycle id) + valuation_version
--   PART 2 — scan_events: minimal, generic, append-only lifecycle event log
--   PART 3 — record_scan(): the ONLY critical persistence transaction
--            (writes the valuation row; derived data is handled separately by
--             the app AFTER this commits, so derived writes can never block or
--             roll back valuation persistence — GW-000 requirement #3)
--
-- Identifier model:
--   scan_uuid      — generated client-side at scan start; one per scan LIFECYCLE
--                    (reused across append / refine of the same item). Every
--                    future event (OCR, recognition, correction, feedback,
--                    listing, sale) references this.
--   valuation_id   — PK of a single valuations row. One scan_uuid → 1..N rows.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — valuations: lifecycle id + engine version
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE valuations ADD COLUMN IF NOT EXISTS scan_uuid uuid;
ALTER TABLE valuations ADD COLUMN IF NOT EXISTS valuation_version integer NOT NULL DEFAULT 1;

-- Reconstruct a whole scan lifecycle by scan_uuid (GW-000 acceptance #6).
CREATE INDEX IF NOT EXISTS idx_valuations_scan_uuid ON valuations (scan_uuid);


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — scan_events: minimal generic lifecycle log (exactly 6 columns)
--
-- Intentionally minimal — no speculative columns. Everything variable goes in
-- payload (jsonb). This single table powers the Internal Intelligence Dashboard
-- (GW-009) and lets any scan_uuid be reconstructed for debugging.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scan_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_uuid   uuid        NOT NULL,
  event_type  text        NOT NULL,
  stage       text,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_events_scan_uuid  ON scan_events (scan_uuid);
CREATE INDEX IF NOT EXISTS idx_scan_events_type       ON scan_events (event_type);
CREATE INDEX IF NOT EXISTS idx_scan_events_created_at ON scan_events (created_at DESC);

-- RLS: writes happen only via the service role (which bypasses RLS); reads are
-- admin-only so GW-009 can query without exposing user telemetry to clients.
ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scan_events_admin_select ON scan_events;
CREATE POLICY scan_events_admin_select
  ON scan_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — record_scan(): the single critical persistence transaction
--
-- Writes ONLY the valuation row. Idempotent on id (ON CONFLICT DO NOTHING) so a
-- server retry and/or the client backup path can safely target the same
-- server-decided valuation_id without ever producing a duplicate.
--
-- SECURITY DEFINER + service-role-only execute: the caller (server) passes a
-- JWT-verified user_id; clients never call this (their backup path uses the
-- RLS-scoped valuations insert, which enforces user_id = auth.uid()).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_scan(p_valuation jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := COALESCE((p_valuation->>'id')::uuid, gen_random_uuid());
BEGIN
  INSERT INTO valuations (
    id, user_id, scan_uuid, valuation_version, product_id,
    ai_name, ai_name_hebrew, ai_category, ai_confidence, ai_raw_response,
    ocr_text, model_number, identified_by, alternatives,
    price_low, price_mid, price_high, new_retail, price_method, comp_count, lang
  )
  VALUES (
    v_id,
    (p_valuation->>'user_id')::uuid,
    (p_valuation->>'scan_uuid')::uuid,
    COALESCE((p_valuation->>'valuation_version')::int, 1),
    (p_valuation->>'product_id')::uuid,
    p_valuation->>'ai_name',
    p_valuation->>'ai_name_hebrew',
    p_valuation->>'ai_category',
    (p_valuation->>'ai_confidence')::real,
    COALESCE(p_valuation->'ai_raw_response', '{}'::jsonb),
    p_valuation->>'ocr_text',
    p_valuation->>'model_number',
    p_valuation->>'identified_by',
    COALESCE(p_valuation->'alternatives', '[]'::jsonb),
    (p_valuation->>'price_low')::int,
    (p_valuation->>'price_mid')::int,
    (p_valuation->>'price_high')::int,
    (p_valuation->>'new_retail')::int,
    p_valuation->>'price_method',
    (p_valuation->>'comp_count')::int,
    p_valuation->>'lang'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION record_scan(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION record_scan(jsonb) TO service_role;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='valuations' AND column_name IN ('scan_uuid','valuation_version');
-- SELECT to_regclass('public.scan_events');
-- SELECT proname FROM pg_proc WHERE proname='record_scan';
