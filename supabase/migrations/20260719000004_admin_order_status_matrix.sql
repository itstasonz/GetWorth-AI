-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-001 (cont.) — admin_update_order_status: close the second,
-- unvalidated status-mutation path.
-- Idempotent — safe to re-run.
--
-- Finding (surfaced while auditing every orders.status mutation path for
-- 20260719000003): admin_update_order_status() (20260519000001) is
-- SECURITY DEFINER owned by postgres. Inside it, current_user = 'postgres',
-- so it is NOT caught by trg_orders_status_guard (20260719000003), which
-- only blocks 'anon'/'authenticated'. That's correct in principle — admin
-- needs a legitimate escape hatch — but the function itself had:
--   1. No transition-matrix validation at all: any admin could jump an
--      order from ANY status to ANY status, including reversing terminal
--      states (completed → pending, cancelled → completed) or replaying
--      the same completion twice.
--   2. No side-effect parity with transition_order(): its 'completed'
--      branch never marked the listing sold, so an admin-completed order
--      left orders.status='completed' while listings.status stayed
--      'active' — the listing remained purchasable after already being
--      "sold", and never created the completion notification the buyer
--      flow creates.
-- This is a second, undocumented transition engine — exactly what the
-- "one authoritative transition matrix" requirement forbids. A compromised
-- or malicious admin account (or an admin fat-fingering a status) could
-- fabricate/reverse completions, corrupting listing and order state.
--
-- Fix: keep the admin override (it can still force any NON-terminal state
-- forward, e.g. rescue a stuck 'accepted' order into 'cancelled', without
-- the buyer/seller role checks transition_order enforces), but:
--   • terminal states become immutable — even for admin — matching
--     transition_order()'s own rule. Closes: un-completing, un-cancelling,
--     completing an already-cancelled/declined/disputed order, replaying
--     completion.
--   • replaying the current status is rejected (no-op guard).
--   • the 'completed' branch gets the same listings-sold side effect as
--     transition_order(), guarded idempotent (status <> 'sold').
--   • completion/cancellation now insert the same notification rows
--     transition_order() creates, to both parties (admin acts on behalf
--     of neither).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_update_order_status(p_order_id uuid, p_new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
  v_order     orders%ROWTYPE;
  v_now       timestamptz := now();
BEGIN
  -- ── 1. Authentication ────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 2. Admin check — reads profiles.is_admin from the DB, never the JWT ───
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 3. Status must be a real state ─────────────────────────────────────────
  IF p_new_status NOT IN ('pending','accepted','shipped','ready_pickup','delivered','completed','cancelled','disputed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 4. Load and lock order ──────────────────────────────────────────────────
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 5. Terminal states are immutable — even for admin ───────────────────────
  -- Mirrors transition_order()'s own terminal-state rule. Without this, the
  -- admin RPC was a second transition engine with no matrix at all.
  IF v_order.status IN ('completed', 'cancelled', 'declined', 'disputed') THEN
    RAISE EXCEPTION 'Order is already in terminal state: % — cannot be changed further', v_order.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 6. Reject no-op replay ───────────────────────────────────────────────────
  IF p_new_status = v_order.status THEN
    RAISE EXCEPTION 'Order is already in status %', p_new_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 7. Apply ──────────────────────────────────────────────────────────────
  IF p_new_status = 'completed' THEN
    UPDATE orders
    SET status       = 'completed',
        completed_at = v_now,
        updated_at   = v_now
    WHERE id = p_order_id;

    -- Side-effect parity with transition_order(): mark the listing sold.
    -- Guarded so a listing already sold by the real buyer flow is untouched.
    UPDATE listings
    SET status  = 'sold',
        sold_to = v_order.buyer_id,
        sold_at = v_now
    WHERE id = v_order.listing_id
      AND status <> 'sold';

    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    SELECT uid, 'ORDER_COMPLETED', 'Transaction complete', '',
           jsonb_build_object('order_id', p_order_id, 'new_status', 'completed'), v_now
    FROM unnest(ARRAY[v_order.buyer_id, v_order.seller_id]) AS uid;

  ELSIF p_new_status = 'cancelled' THEN
    UPDATE orders
    SET status        = 'cancelled',
        cancelled_at  = v_now,
        cancelled_by  = v_caller_id,
        cancel_reason = 'Admin action',
        updated_at    = v_now
    WHERE id = p_order_id;

    INSERT INTO notifications (user_id, type, title, body, data, created_at)
    SELECT uid, 'ORDER_CANCELLED', 'Order cancelled', '',
           jsonb_build_object('order_id', p_order_id, 'new_status', 'cancelled'), v_now
    FROM unnest(ARRAY[v_order.buyer_id, v_order.seller_id]) AS uid;

  ELSE
    UPDATE orders SET status = p_new_status, updated_at = v_now WHERE id = p_order_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_update_order_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_order_status(uuid, text) TO authenticated;


-- ── Verify ────────────────────────────────────────────────────────────────────

-- 1. Function still exists, SECURITY DEFINER:
--    SELECT proname, prosecdef FROM pg_proc WHERE proname = 'admin_update_order_status';
--    Expected: 1 row, prosecdef = true

-- 2. As admin, on a 'pending' order: admin_update_order_status(id, 'cancelled')
--    → succeeds, order.status = 'cancelled', both parties notified.

-- 3. As admin, on a 'delivered' order: admin_update_order_status(id, 'completed')
--    → succeeds, order.status = 'completed', listings.status = 'sold',
--      both parties notified with ORDER_COMPLETED.

-- 4. As admin, immediately replay step 3 on the same order:
--    admin_update_order_status(id, 'completed') again
--    → fails: 'Order is already in terminal state: completed'

-- 5. As admin, on an already-'completed' order: admin_update_order_status(id, 'pending')
--    → fails: 'Order is already in terminal state: completed'
--    (previously this silently succeeded and reverted the order)

-- 6. As admin, on a 'cancelled' order: admin_update_order_status(id, 'completed')
--    → fails: 'Order is already in terminal state: cancelled'
--    (previously this silently succeeded, fabricating a completion on a
--    dead order — review/reputation fraud vector)
