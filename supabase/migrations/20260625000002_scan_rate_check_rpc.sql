-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Single-round-trip scan rate check (performance fix)
-- Generated: 2026-06-25
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`).
-- ══════════════════════════════════════════════════════════════════════════════
--
-- checkRateLimit() in api/analyze.js made THREE sequential Edge→Supabase round
-- trips (IP count, user count, daily increment) — measured at ~6.3s in
-- production, which consumed the Stage 1 (Claude Vision) time budget and forced
-- the 8s floor → Stage 1 timeout.
--
-- This RPC performs all three checks atomically inside Postgres in ONE round
-- trip. Same semantics as the old JS: IP burst guard, user burst guard, atomic
-- daily increment (anti-probe), and the per-minute attempt log — abuse
-- protection unchanged. SECURITY DEFINER so it works with the anon key
-- (scan_daily_usage has RLS enabled with no policies).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Ensure the indexes the counts rely on exist in production (idempotent) ──
CREATE INDEX IF NOT EXISTS idx_scan_rate_log_ip_created_at
  ON scan_rate_log (ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_rate_log_user_id_created_at
  ON scan_rate_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ── Combined check + increment + log, all in one call ──
CREATE OR REPLACE FUNCTION check_and_increment_scan_rate(
  p_ip          text,
  p_user_id     uuid,
  p_date        date,
  p_ip_limit    int,
  p_user_limit  int,
  p_daily_limit int
)
RETURNS TABLE (allowed boolean, limit_type text, daily_count int, charged boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_one_min_ago timestamptz := now() - interval '60 seconds';
  v_ip_count    int;
  v_user_count  int;
  v_daily       int := 0;
BEGIN
  -- IP per-minute burst guard
  SELECT count(*) INTO v_ip_count
  FROM scan_rate_log
  WHERE ip = p_ip AND created_at >= v_one_min_ago;
  IF v_ip_count >= p_ip_limit THEN
    RETURN QUERY SELECT false, 'ip_rate'::text, 0, false; RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    -- User per-minute burst guard
    SELECT count(*) INTO v_user_count
    FROM scan_rate_log
    WHERE user_id = p_user_id AND created_at >= v_one_min_ago;
    IF v_user_count >= p_user_limit THEN
      RETURN QUERY SELECT false, 'user_rate'::text, 0, false; RETURN;
    END IF;

    -- Atomic daily increment (anti-probe: over-limit requests still count).
    INSERT INTO scan_daily_usage (user_id, date, count)
    VALUES (p_user_id, p_date, 1)
    ON CONFLICT (user_id, date) DO UPDATE SET count = scan_daily_usage.count + 1
    RETURNING count INTO v_daily;

    IF v_daily > p_daily_limit THEN
      RETURN QUERY SELECT false, 'user_daily'::text, v_daily, false; RETURN;
    END IF;
  END IF;

  -- Record this attempt for the per-minute window (was a non-blocking JS insert;
  -- now part of the same round trip).
  INSERT INTO scan_rate_log (ip, user_id, created_at)
  VALUES (p_ip, p_user_id, now());

  RETURN QUERY SELECT true, NULL::text, v_daily, (p_user_id IS NOT NULL);
END;
$$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'check_and_increment_scan_rate';
-- SELECT indexname FROM pg_indexes WHERE tablename = 'scan_rate_log';
