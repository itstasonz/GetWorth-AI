-- ──────────────────────────────────────────────────────────────────────
-- Fix: scan_rate_log unbounded growth + missing indexes
-- Root cause: rows are never deleted; rate-limit query scans full table
-- ──────────────────────────────────────────────────────────────────────

-- 1. Compound index so (ip, created_at) range queries are O(log n) not O(n)
CREATE INDEX IF NOT EXISTS idx_scan_rate_log_ip_created_at
  ON scan_rate_log (ip, created_at DESC);

-- 2. Vision cache lookup: image_hash + recency
CREATE INDEX IF NOT EXISTS idx_vision_cache_hash_created_at
  ON vision_cache (image_hash, created_at DESC);

-- 3. Cleanup old scan_rate_log rows (manual / one-time backfill)
--    Run this once to trim existing bloat, then rely on the scheduled job below.
DELETE FROM scan_rate_log WHERE created_at < NOW() - INTERVAL '10 minutes';

-- ──────────────────────────────────────────────────────────────────────
-- Scheduled cleanup via pg_cron (requires pg_cron extension enabled)
-- Enable in Supabase Dashboard → Database → Extensions → pg_cron
-- ──────────────────────────────────────────────────────────────────────

-- Schedule hourly deletion of rows older than 5 minutes (well past the 1-min window)
-- If pg_cron is not available, set up a Supabase Edge Function cron job instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'cleanup-scan-rate-log',          -- job name
      '0 * * * *',                      -- every hour
      $$DELETE FROM scan_rate_log WHERE created_at < NOW() - INTERVAL '5 minutes'$$
    );
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule cleanup manually or via Edge Function cron';
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- Manual fallback (if pg_cron is not available):
-- Create a Supabase Edge Function named "cleanup-rate-log" with:
--   supabase.from('scan_rate_log').delete().lt('created_at', fiveMinutesAgo)
-- And schedule it via Dashboard → Edge Functions → Schedule (every 1 hour).
-- ──────────────────────────────────────────────────────────────────────
