-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Per-User Scan Rate Limiting
-- Generated: 2026-05-18
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Adds two things:
--   1. user_id column to scan_rate_log for per-user per-minute checks
--      (rows are still purged after 5 min by the existing cron job — fine for
--      per-minute windows)
--   2. scan_daily_usage table for per-user daily quota
--      (not purged hourly — kept for at least 30 days then cleaned up)
--
-- Limits enforced in api/analyze.js:
--   USER_RATE_PER_MIN = 5   per authenticated user per minute
--   USER_DAILY_LIMIT  = 50  per authenticated user per day (beta)
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. Add user_id to scan_rate_log ────────────────────────────────────────

ALTER TABLE scan_rate_log
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- Compound index for user per-minute queries: user_id + recency.
-- Nullable-safe: only non-NULL user_id rows are indexed (partial index keeps it small).
CREATE INDEX IF NOT EXISTS idx_scan_rate_log_user_id_created_at
  ON scan_rate_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;


-- ── 2. Create scan_daily_usage ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_daily_usage (
  user_id  uuid NOT NULL,
  date     date NOT NULL DEFAULT CURRENT_DATE,
  count    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- Index for single-user lookups (pk already covers this, but explicit for clarity)
-- PK on (user_id, date) is sufficient — no extra index needed.


-- ── 3. RPC: atomic increment ───────────────────────────────────────────────
--
-- Called by incrementUserDailyUsage() in api/analyze.js.
-- Uses INSERT ... ON CONFLICT DO UPDATE to atomically increment the counter.
-- Falls back to select+upsert in JS if this function is unavailable.

CREATE OR REPLACE FUNCTION increment_user_daily_scan(p_user_id uuid, p_date date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO scan_daily_usage (user_id, date, count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET count = scan_daily_usage.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;


-- ── 4. RLS on scan_daily_usage ─────────────────────────────────────────────
--
-- Users should NOT be able to read or modify their own usage row directly —
-- the Edge Function and api/analyze.js use the service role / anon key with
-- no RLS bypass needed (scan_daily_usage is read by the service-key Supabase
-- client in analyze.js).
-- Enable RLS and grant no policies — all access goes through the backend.

ALTER TABLE scan_daily_usage ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS entirely — api/analyze.js can read/write freely.
-- No policies = no direct client access. This is the intended state.


-- ── 5. Scheduled cleanup for scan_daily_usage ──────────────────────────────
--
-- Keep 30 days of history (useful for quota dashboards), then purge.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-scan-daily-usage',
      '30 2 * * *',   -- 02:30 UTC daily
      $$DELETE FROM scan_daily_usage WHERE date < CURRENT_DATE - INTERVAL '30 days'$$
    );
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule scan_daily_usage cleanup manually';
  END IF;
END;
$$;


-- ── 6. Verify ──────────────────────────────────────────────────────────────

-- Confirm user_id column exists on scan_rate_log
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'scan_rate_log' AND column_name = 'user_id';
-- Expected: one row, data_type = uuid, is_nullable = YES

-- Confirm scan_daily_usage table and its columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'scan_daily_usage'
ORDER BY ordinal_position;
-- Expected: user_id (uuid), date (date), count (integer)

-- Confirm RPC exists
SELECT proname FROM pg_proc WHERE proname = 'increment_user_daily_scan';
-- Expected: one row

-- Confirm partial index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'scan_rate_log' AND indexname = 'idx_scan_rate_log_user_id_created_at';
-- Expected: one row
