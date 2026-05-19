-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Messaging Authorization Hardening
-- Generated: 2026-05-19
--
-- PART 1 — notifications UPDATE ownership policy
-- PART 2 — conversations RLS  (ENABLE + SELECT / INSERT / UPDATE)
-- PART 3 — messages RLS       (ENABLE + SELECT / INSERT / UPDATE)
-- PART 4 — transition_order   RPC patch (server-side order notifications)
-- PART 5 — verify queries
--
-- Prerequisites:
--   migration 20260519000001 — conversations_select_admin_bypass exists
--     (dormant until now — enabling RLS in PART 2 activates it automatically)
--   migration 20260519000003 — transition_order RPC exists
--     (PART 4 drops and recreates it with notification logic)
--
-- All ENABLE ROW LEVEL SECURITY calls are idempotent.
-- All DROP POLICY IF EXISTS calls are idempotent.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — notifications UPDATE ownership policy
--
-- markNotifRead (AppContext) does .update().eq('id', notifId) with no user_id
-- filter. Without this policy, any user can mark any notification as read by
-- knowing its UUID. SELECT/INSERT policies already exist from migration
-- 20260504000001; this closes the UPDATE gap.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — conversations RLS hardening
--
-- Enables RLS, which simultaneously activates the dormant
-- conversations_select_admin_bypass policy from migration 20260519000001.
-- No additional admin work is needed.
--
-- INSERT policy verifies seller_id against the DB listing row so the client
-- cannot forge who the seller is.
-- UPDATE policy keeps listing_id / buyer_id / seller_id immutable; only
-- updated_at is expected to change (sendMessage touches this column).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- 2a. SELECT — participants only
DROP POLICY IF EXISTS "conversations_select_parties" ON conversations;

CREATE POLICY "conversations_select_parties"
  ON conversations FOR SELECT
  USING (buyer_id = auth.uid() OR seller_id = auth.uid());

-- 2b. INSERT — buyer_id must be caller; no self-conversation; seller_id must
--     match the listing's actual seller in the DB (cannot be forged by client).
DROP POLICY IF EXISTS "conversations_insert_buyer" ON conversations;

CREATE POLICY "conversations_insert_buyer"
  ON conversations FOR INSERT
  WITH CHECK (
    buyer_id = auth.uid()
    AND buyer_id <> seller_id
    AND EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id    = conversations.listing_id
        AND l.seller_id = conversations.seller_id
    )
  );

-- 2c. UPDATE — parties only; listing_id / buyer_id / seller_id immutable.
DROP POLICY IF EXISTS "conversations_update_parties" ON conversations;

CREATE POLICY "conversations_update_parties"
  ON conversations FOR UPDATE
  USING (buyer_id = auth.uid() OR seller_id = auth.uid())
  WITH CHECK (
    buyer_id   = (SELECT c2.buyer_id   FROM conversations c2 WHERE c2.id = conversations.id) AND
    seller_id  = (SELECT c2.seller_id  FROM conversations c2 WHERE c2.id = conversations.id) AND
    listing_id = (SELECT c2.listing_id FROM conversations c2 WHERE c2.id = conversations.id)
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — messages RLS hardening
--
-- All three policies use an EXISTS subquery into conversations to verify the
-- caller is a participant. This subquery respects the conversations SELECT
-- policy applied in PART 2 — defense-in-depth at no extra cost.
--
-- INSERT enforces sender_id = auth.uid() server-side (client cannot spoof).
-- UPDATE locks content / sender_id / conversation_id / is_offer / offer_amount
-- as immutable. Only is_read can change. Nullable columns use
-- IS NOT DISTINCT FROM so NULL = NULL comparisons work correctly.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 3a. SELECT — conversation participants only
DROP POLICY IF EXISTS "messages_select_participants" ON messages;

CREATE POLICY "messages_select_participants"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
    )
  );

-- 3b. INSERT — sender_id = caller AND caller is in the conversation
DROP POLICY IF EXISTS "messages_insert_participant" ON messages;

CREATE POLICY "messages_insert_participant"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
    )
  );

-- 3c. UPDATE — participants only; ONLY is_read is mutable.
DROP POLICY IF EXISTS "messages_update_participant" ON messages;

CREATE POLICY "messages_update_participant"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.buyer_id = auth.uid() OR c.seller_id = auth.uid())
    )
  )
  WITH CHECK (
    -- Non-nullable columns: strict equality
    sender_id       = (SELECT m2.sender_id       FROM messages m2 WHERE m2.id = messages.id) AND
    conversation_id = (SELECT m2.conversation_id FROM messages m2 WHERE m2.id = messages.id) AND
    -- Nullable columns: NULL-safe comparison
    content         IS NOT DISTINCT FROM (SELECT m2.content      FROM messages m2 WHERE m2.id = messages.id) AND
    is_offer        IS NOT DISTINCT FROM (SELECT m2.is_offer     FROM messages m2 WHERE m2.id = messages.id) AND
    offer_amount    IS NOT DISTINCT FROM (SELECT m2.offer_amount FROM messages m2 WHERE m2.id = messages.id)
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — transition_order RPC patch
--
-- Adds server-side notification inserts for all 7 status transitions.
-- Running as SECURITY DEFINER (postgres owner) bypasses RLS on notifications —
-- no INSERT policy check needed. Notification is always sent to the party
-- who did NOT perform the action.
--
-- Notification target by transition:
--   accepted / declined / shipped / ready_pickup → buyer  (seller acted)
--   delivered / completed                        → seller (buyer acted)
--   cancelled → opposite of v_caller_id          (either party may cancel)
--
-- Notification types match the frontend format:
--   'ORDER_' || upper(p_new_status)
--   e.g. ORDER_ACCEPTED, ORDER_READY_PICKUP, ORDER_CANCELLED
--
-- v_order is captured before any UPDATE (FOR UPDATE snapshot), so
-- buyer_id / seller_id / listing_id remain stable for notification routing
-- even after the status columns change.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS transition_order(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION transition_order(
  p_order_id   uuid,
  p_new_status text,
  p_meta       jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id     uuid;
  v_order         orders%ROWTYPE;
  v_current       text;
  v_required_role text;   -- 'seller' | 'buyer' | 'either'
  v_notif_target  uuid;
  v_now           timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Load and lock order ───────────────────────────────────────────────
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Caller must be a party ─────────────────────────────────────────────
  IF v_order.buyer_id <> v_caller_id AND v_order.seller_id <> v_caller_id THEN
    RAISE EXCEPTION 'Not a party to this order' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_current := v_order.status;

  -- ── 4. Reject terminal-state transitions ──────────────────────────────────
  IF v_current IN ('completed', 'cancelled', 'declined', 'disputed') THEN
    RAISE EXCEPTION 'Order is already in terminal state: %', v_current
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 5. Validate transition + derive required role ─────────────────────────
  v_required_role := CASE
    WHEN v_current = 'pending'      AND p_new_status = 'accepted'      THEN 'seller'
    WHEN v_current = 'pending'      AND p_new_status = 'declined'      THEN 'seller'
    WHEN v_current = 'pending'      AND p_new_status = 'cancelled'     THEN 'either'
    WHEN v_current = 'accepted'     AND p_new_status = 'shipped'       THEN 'seller'
    WHEN v_current = 'accepted'     AND p_new_status = 'ready_pickup'  THEN 'seller'
    WHEN v_current = 'accepted'     AND p_new_status = 'cancelled'     THEN 'either'
    WHEN v_current = 'shipped'      AND p_new_status = 'delivered'     THEN 'buyer'
    WHEN v_current = 'ready_pickup' AND p_new_status = 'delivered'     THEN 'buyer'
    WHEN v_current = 'ready_pickup' AND p_new_status = 'completed'     THEN 'buyer'
    WHEN v_current = 'delivered'    AND p_new_status = 'completed'     THEN 'buyer'
    ELSE NULL
  END;

  IF v_required_role IS NULL THEN
    RAISE EXCEPTION 'Invalid transition: % → %', v_current, p_new_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 6. Enforce role ───────────────────────────────────────────────────────
  IF v_required_role = 'seller' AND v_order.seller_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the seller can perform this action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_required_role = 'buyer' AND v_order.buyer_id <> v_caller_id THEN
    RAISE EXCEPTION 'Only the buyer can perform this action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 7. Apply transition ───────────────────────────────────────────────────
  IF p_new_status = 'accepted' THEN
    UPDATE orders SET status = 'accepted',     accepted_at = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'declined' THEN
    UPDATE orders SET status = 'declined',     declined_at = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'shipped' THEN
    UPDATE orders SET status = 'shipped',      shipped_at  = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'ready_pickup' THEN
    UPDATE orders SET status = 'ready_pickup', shipped_at  = v_now,           updated_at = v_now WHERE id = p_order_id;

  ELSIF p_new_status = 'delivered' THEN
    UPDATE orders
    SET status = 'delivered', delivered_at = v_now, buyer_confirmed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

  ELSIF p_new_status = 'cancelled' THEN
    UPDATE orders
    SET status        = 'cancelled',
        cancelled_at  = v_now,
        cancelled_by  = v_caller_id,
        cancel_reason = COALESCE(p_meta->>'cancel_reason', 'User cancellation'),
        updated_at    = v_now
    WHERE id = p_order_id;

  ELSIF p_new_status = 'completed' THEN
    UPDATE orders
    SET status = 'completed', completed_at = v_now, updated_at = v_now
    WHERE id = p_order_id;

    -- Atomically mark the listing sold
    UPDATE listings
    SET status  = 'sold',
        sold_to = v_order.buyer_id,
        sold_at = v_now
    WHERE id = v_order.listing_id;
  END IF;

  -- ── 8. Notify the opposite party ─────────────────────────────────────────
  -- v_order is the pre-update snapshot — buyer_id / seller_id are stable.
  v_notif_target := CASE p_new_status
    WHEN 'accepted'     THEN v_order.buyer_id
    WHEN 'declined'     THEN v_order.buyer_id
    WHEN 'shipped'      THEN v_order.buyer_id
    WHEN 'ready_pickup' THEN v_order.buyer_id
    WHEN 'delivered'    THEN v_order.seller_id
    WHEN 'completed'    THEN v_order.seller_id
    WHEN 'cancelled'    THEN
      CASE WHEN v_caller_id = v_order.buyer_id
           THEN v_order.seller_id
           ELSE v_order.buyer_id END
    ELSE NULL
  END;

  IF v_notif_target IS NOT NULL AND v_notif_target <> v_caller_id THEN
    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    VALUES (
      v_notif_target,
      'ORDER_' || upper(p_new_status),
      CASE p_new_status
        WHEN 'accepted'     THEN 'Order accepted'
        WHEN 'declined'     THEN 'Order declined'
        WHEN 'shipped'      THEN 'Item shipped'
        WHEN 'ready_pickup' THEN 'Ready for pickup'
        WHEN 'delivered'    THEN 'Item received'
        WHEN 'completed'    THEN 'Transaction complete'
        WHEN 'cancelled'    THEN 'Order cancelled'
      END,
      '',
      jsonb_build_object('order_id', p_order_id, 'new_status', p_new_status),
      v_now
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_new_status);
END;
$$;

REVOKE ALL ON FUNCTION transition_order(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_order(uuid, text, jsonb) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 5 — Verify
-- ══════════════════════════════════════════════════════════════════════════════

-- 5a. notifications UPDATE policy
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'notifications' AND policyname = 'notifications_update_own';
-- Expected: 1 row (UPDATE)

-- 5b. conversations RLS enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'conversations';
-- Expected: relrowsecurity = true

-- 5c. conversations policies (4 rows — 3 new + admin bypass activated from 000001)
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'conversations'
ORDER BY cmd, policyname;
-- Expected:
--   conversations_insert_buyer        INSERT
--   conversations_select_admin_bypass SELECT  ← from migration 000001 (now active)
--   conversations_select_parties      SELECT
--   conversations_update_parties      UPDATE

-- 5d. messages RLS enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'messages';
-- Expected: relrowsecurity = true

-- 5e. messages policies (3 rows)
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'messages'
ORDER BY cmd, policyname;
-- Expected:
--   messages_insert_participant  INSERT
--   messages_select_participants SELECT
--   messages_update_participant  UPDATE

-- 5f. transition_order still exists with notification logic
SELECT proname, pronargs
FROM pg_proc
WHERE proname = 'transition_order';
-- Expected: 1 row (pronargs = 3)

-- 5g. Smoke tests (run as authenticated user in SQL editor or client):
--
--   Conversations — own conversations visible:
--     supabase.from('conversations').select('id').limit(5)
--     Expected: returns only rows where caller is buyer or seller
--
--   Messages — own conversation messages visible:
--     supabase.from('messages').select('id').eq('conversation_id', '<own-conv-id>').limit(1)
--     Expected: returns rows
--
--   Messages — other user's conversation blocked:
--     supabase.from('messages').select('id').eq('conversation_id', '<other-conv-id>').limit(1)
--     Expected: 0 rows (RLS filters it out, no error)
--
--   Messages — sender_id spoof blocked:
--     supabase.from('messages').insert({ conversation_id: '<own-conv-id>', sender_id: '<other-user-uuid>', content: 'test' })
--     Expected: error 42501 (messages_insert_participant WITH CHECK fails)
--
--   Notifications — mark other user's notification read blocked:
--     supabase.from('notifications').update({ read_at: new Date() }).eq('id', '<other-users-notif-id>')
--     Expected: 0 rows updated (RLS USING filters out the row silently)
