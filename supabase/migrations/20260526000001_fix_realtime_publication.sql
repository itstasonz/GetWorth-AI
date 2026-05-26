-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Fix Realtime CHANNEL_ERROR
-- Migration: 20260526000001
-- Generated: 2026-05-26
--
-- Root cause:
--   No migration has ever added messages, notifications, orders, or
--   conversations to the supabase_realtime publication.  When a table is
--   absent from the publication the Realtime server immediately returns
--   CHANNEL_ERROR with err=undefined — the subscription is rejected before
--   any row-level filtering occurs.
--
-- This is NOT an RLS problem.  The existing RLS policies are correct.
--
-- What this migration does:
--   PART 1 — Add four tables to the supabase_realtime publication
--             (conditional; idempotent; never errors if already a member)
--   PART 2 — Set REPLICA IDENTITY FULL on notifications and orders
--             Ensures column-level filter (user_id=eq.X on notifications)
--             and client-side buyer_id/seller_id checks on orders work
--             correctly for UPDATE/DELETE WAL events, not just INSERT.
--   PART 3 — Add missing performance indexes that also help Realtime
--             RLS checks (messages_select_participants does an EXISTS
--             on conversations — needs conversation_id index)
--   PART 4 — Verify
--
-- Apply in: Supabase Dashboard → SQL Editor
-- Safe to re-run: all operations are conditional or idempotent.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — Add tables to supabase_realtime publication
--
-- pg_publication_tables is checked first; ALTER PUBLICATION ADD TABLE errors
-- if the table is already a member, so the conditional guard is required.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tables text[] := ARRAY['messages', 'notifications', 'orders', 'conversations'];
  v_tbl    text;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname   = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = v_tbl
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        v_tbl
      );
      RAISE NOTICE '[realtime] Added % to supabase_realtime publication', v_tbl;
    ELSE
      RAISE NOTICE '[realtime] % already in supabase_realtime — skipping', v_tbl;
    END IF;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — REPLICA IDENTITY FULL
--
-- Default REPLICA IDENTITY (primary key only) means UPDATE/DELETE WAL events
-- only carry the old primary key.  FULL includes all old column values.
--
-- notifications: AppContext subscribes with filter user_id=eq.${user.id}.
--   INSERT always includes full row (no change needed for INSERT), but
--   setting FULL ensures UPDATE events include user_id in the OLD tuple
--   so filter evaluation is reliable on all event types.
--
-- orders: AppContext filters UPDATE/INSERT client-side by buyer_id/seller_id.
--   payload.new always contains all columns, but FULL also records old
--   column values — useful for debugging status transitions.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.orders        REPLICA IDENTITY FULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — Performance indexes for Realtime RLS paths
--
-- messages_select_participants RLS policy:
--   USING ( EXISTS (
--     SELECT 1 FROM conversations c
--     WHERE c.id = messages.conversation_id
--       AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
--   ))
--
-- Without idx_messages_conversation_id, every realtime event check on
-- messages triggers a sequential scan of conversations.
--
-- notifications: Realtime delivery filters rows by user_id; index on
-- (user_id, created_at DESC) also speeds up loadNotifications().
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON public.messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_buyer_id
  ON public.conversations (buyer_id);

CREATE INDEX IF NOT EXISTS idx_conversations_seller_id
  ON public.conversations (seller_id);


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — Verify
-- ══════════════════════════════════════════════════════════════════════════════

-- 4a. Publication membership (expected: 4 rows)
SELECT schemaname, tablename
FROM   pg_publication_tables
WHERE  pubname   = 'supabase_realtime'
  AND  tablename IN ('messages', 'notifications', 'orders', 'conversations')
ORDER  BY tablename;

-- 4b. REPLICA IDENTITY (expected: 'f' for FULL on notifications and orders)
SELECT relname, relreplident
FROM   pg_class
WHERE  relname IN ('notifications', 'orders')
ORDER  BY relname;
-- relreplident values: 'd'=default, 'f'=FULL, 'i'=index, 'n'=nothing
-- Expected: notifications → f, orders → f

-- 4c. Indexes
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  tablename IN ('messages', 'notifications', 'conversations')
  AND  indexname IN (
    'idx_messages_conversation_id',
    'idx_notifications_user_id_created_at',
    'idx_conversations_buyer_id',
    'idx_conversations_seller_id'
  )
ORDER  BY indexname;
-- Expected: 4 rows
