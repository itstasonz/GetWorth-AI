-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix Listings Schema Drift (serial columns)
-- Generated: 2026-05-18
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Confirmed already present in Supabase (no action needed):
--   ai_confidence   real
--   attributes      jsonb
--   quality_score   integer
--   sold_at         timestamptz
--   sold_to         uuid
--   valuation_id    uuid
--
-- Missing — added below:
--   serial_submitted  boolean  NOT NULL DEFAULT false
--   serial_verified   boolean  NOT NULL DEFAULT false
--   serial_masked     text     nullable
--   serial_type       text     nullable
--
-- All statements use ADD COLUMN IF NOT EXISTS — idempotent, safe to re-run.
-- No existing columns are modified, dropped, or constrained.
-- Existing rows receive DEFAULT false for the boolean columns automatically.
-- ══════════════════════════════════════════════════════════════════════════════


ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS serial_submitted boolean NOT NULL DEFAULT false;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS serial_verified boolean NOT NULL DEFAULT false;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS serial_masked text;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS serial_type text;


-- ── Verify ─────────────────────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'listings'
  AND column_name IN (
    'serial_submitted', 'serial_verified', 'serial_masked', 'serial_type'
  )
ORDER BY column_name;
-- Expected: 4 rows
-- serial_masked:    text,    YES (nullable),  no default
-- serial_submitted: boolean, NO  (not null),  false
-- serial_type:      text,    YES (nullable),  no default
-- serial_verified:  boolean, NO  (not null),  false
