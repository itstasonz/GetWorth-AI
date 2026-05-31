-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Add notifications SELECT RLS policy
-- Migration: 20260531000002
--
-- Root cause of rt-notifs CHANNEL_ERROR:
--   Supabase Realtime evaluates the subscription filter (user_id=eq.<uid>)
--   against RLS SELECT policies. Without a SELECT policy, Realtime cannot
--   confirm the caller is allowed to receive rows, so the channel join fails.
--   loadNotifications() also silently returns [] for the same reason.
--
-- Fix: Add a permissive SELECT policy so authenticated users can read their
--   own notifications. Existing INSERT/UPDATE policies are unchanged.
--
-- Safe to re-run — DROP IF EXISTS before CREATE.
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;

CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- ── Verify ────────────────────────────────────────────────────────────────────

SELECT policyname, cmd, qual
FROM   pg_policies
WHERE  tablename = 'notifications'
ORDER  BY policyname;
-- Expected rows include: notifications_select_own (SELECT, user_id = auth.uid())
