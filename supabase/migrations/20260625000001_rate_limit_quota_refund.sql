-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Daily-scan quota REFUND (C1 fix)
-- Generated: 2026-06-25
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`).
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Pairs with increment_user_daily_scan() from 20260518000004.
-- api/analyze.js charges the daily quota up-front (atomic, anti-probe) and calls
-- this RPC to REFUND the charge when a scan fails (e.g. Stage 1 Vision timeout),
-- so failed scans never permanently consume a user's daily allowance.
--
-- SECURITY DEFINER so the Edge Function works with the anon key (scan_daily_usage
-- has RLS enabled with no policies — all access goes through these RPCs).
-- GREATEST(count - 1, 0) floors at zero: concurrent refunds can never go negative.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION decrement_user_daily_scan(p_user_id uuid, p_date date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE scan_daily_usage
     SET count = GREATEST(count - 1, 0)
   WHERE user_id = p_user_id AND date = p_date
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname = 'decrement_user_daily_scan';
-- Expected: one row
