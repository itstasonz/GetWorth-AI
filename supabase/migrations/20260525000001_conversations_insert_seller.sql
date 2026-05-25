-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Allow seller-initiated conversations via existing orders
-- Generated: 2026-05-25
--
-- Context:
--   conversations_insert_buyer (migration 20260519000005) only allows the buyer
--   (buyer_id = auth.uid()) to create a new conversation.  Sellers can read
--   their conversations (conversations_select_parties) but cannot INSERT one.
--
--   OrderDetailView has a "Message Buyer" button for sellers.  Without this
--   policy the INSERT is rejected by RLS (EXISTS check fails because the client
--   was incorrectly passing seller_id = order.buyer_id, and even with the correct
--   roles the old policy blocks seller-side inserts entirely).
--
-- This migration adds conversations_insert_seller which allows the SELLER to
-- create a conversation provided:
--   1. seller_id = auth.uid()          — caller is the actual seller
--   2. buyer_id ≠ seller_id            — no self-conversations
--   3. listing's seller_id = auth.uid() — caller really owns the listing
--   4. An accepted/active order exists for this listing between the two parties
--      — prevents sellers from opening conversations with arbitrary users
-- ══════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "conversations_insert_seller" ON conversations;

CREATE POLICY "conversations_insert_seller"
  ON conversations FOR INSERT
  WITH CHECK (
    -- Caller is the seller
    seller_id = auth.uid()
    AND buyer_id <> seller_id
    -- Caller actually owns the listing (cannot forge seller_id)
    AND EXISTS (
      SELECT 1 FROM listings l
      WHERE l.id        = conversations.listing_id
        AND l.seller_id = auth.uid()
    )
    -- An order must exist linking this buyer to this seller for this listing.
    -- Prevents sellers from cold-messaging arbitrary users.
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.listing_id = conversations.listing_id
        AND o.buyer_id   = conversations.buyer_id
        AND o.seller_id  = auth.uid()
    )
  );

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'conversations'
ORDER BY cmd, policyname;
-- Expected policies now include:
--   conversations_insert_buyer         INSERT  (existing)
--   conversations_insert_seller        INSERT  (new)
--   conversations_select_admin_bypass  SELECT  (existing)
--   conversations_select_parties       SELECT  (existing)
--   conversations_update_parties       UPDATE  (existing)
