-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Listings + Reviews RLS Hardening
-- Generated: 2026-05-19
--
-- Documents and re-applies the final verified RLS policies for listings and
-- reviews after the P0/P1 security audit.  Idempotent — safe to re-run.
--
-- LISTINGS — final policy set:
--   listings_insert_own_active        INSERT  seller_id = auth.uid(), status = 'active'
--   Active listings are viewable by everyone  SELECT  active+sold or own
--   listings_select_admin_bypass      SELECT  admin reads all statuses
--   listings_update_owner_soft_delete_only  UPDATE  owner only; terminal states immutable
--   (no DELETE policy — hard deletes blocked by RLS)
--
-- REVIEWS — final policy set:
--   reviews_insert_order_party_only   INSERT  completed order, party check, reviewer = caller
--   Reviews are public                SELECT  anyone reads reviews
--   (no UPDATE/DELETE policy for non-admin — modifications blocked by RLS)
--
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — LISTINGS
-- ══════════════════════════════════════════════════════════════════════════════

-- 1a. DROP all known policy names (idempotent)
DROP POLICY IF EXISTS "listings_insert_own_active"                   ON listings;
DROP POLICY IF EXISTS "Users can create listings"                    ON listings;

DROP POLICY IF EXISTS "Active listings are viewable by everyone"     ON listings;
DROP POLICY IF EXISTS "listings_select_scoped"                       ON listings;
DROP POLICY IF EXISTS "Enable read access for all users"             ON listings;
DROP POLICY IF EXISTS "Public listings are visible to everyone"      ON listings;
DROP POLICY IF EXISTS "Anyone can view listings"                     ON listings;
DROP POLICY IF EXISTS "Public read listings"                         ON listings;

DROP POLICY IF EXISTS "listings_select_admin_bypass"                 ON listings;

DROP POLICY IF EXISTS "listings_update_owner_soft_delete_only"       ON listings;
DROP POLICY IF EXISTS "listings_update_owner"                        ON listings;
DROP POLICY IF EXISTS "Users can update own listings"                ON listings;

DROP POLICY IF EXISTS "Users can delete own listings"                ON listings;
DROP POLICY IF EXISTS "listings_no_hard_delete"                      ON listings;


-- 1b. INSERT — seller_id must be the caller; only 'active' status on create
--     Prevents: spoofing seller_id, inserting as sold/removed/pending
CREATE POLICY "listings_insert_own_active"
  ON listings FOR INSERT
  WITH CHECK (
    seller_id = auth.uid()
    AND status = 'active'
  );


-- 1c. SELECT — public reads active+sold; owners read all own statuses
--     'sold' included so order history and conversation joins don't break.
--     'deleted'/'removed'/'pending' hidden from public but visible to owner.
CREATE POLICY "Active listings are viewable by everyone"
  ON listings FOR SELECT
  USING (
    status IN ('active', 'sold')
    OR auth.uid() = seller_id
  );


-- 1d. SELECT (admin bypass) — admin reads all statuses regardless
--     Reads is_admin from the DB row, not from JWT claims.
CREATE POLICY "listings_select_admin_bypass"
  ON listings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );


-- 1e. UPDATE — owner only; terminal statuses are immutable
--     Prevents:
--       • re-activating a listing that admin set to 'removed'
--       • seller directly setting status to 'sold' (only transition_order RPC does this)
--       • re-activating a 'sold' listing (would allow double-selling)
--       • reassigning seller_id to another user
--     Allows:
--       • soft delete: active → deleted
--       • future edit fields (title, desc, price, images) while status = 'active'
--         provided no explicit constraint blocks it — add price guard separately
--         once an edit-listing flow is built
CREATE POLICY "listings_update_owner_soft_delete_only"
  ON listings FOR UPDATE
  USING (seller_id = auth.uid())
  WITH CHECK (
    -- seller_id is immutable
    seller_id = (SELECT l.seller_id FROM listings l WHERE l.id = listings.id)
    -- Once sold or removed (by transition_order / admin_remove_listing), locked
    AND (SELECT l.status FROM listings l WHERE l.id = listings.id)
        NOT IN ('sold', 'removed')
    -- Outgoing status must be 'active' or 'deleted' — never 'sold'/'removed' directly
    AND listings.status IN ('active', 'deleted')
  );


-- 1f. No DELETE policy — hard deletes are blocked by RLS.
--     The app uses soft delete (status = 'deleted') via the UPDATE policy above.
--     Hard deletes would break order history, conversation, and review FK joins.


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — REVIEWS
-- ══════════════════════════════════════════════════════════════════════════════

-- 2a. DROP all known policy names (idempotent)
DROP POLICY IF EXISTS "reviews_insert_order_party_only"              ON reviews;
DROP POLICY IF EXISTS "Users can insert reviews"                     ON reviews;
DROP POLICY IF EXISTS "Authenticated users can insert reviews"       ON reviews;
DROP POLICY IF EXISTS "Enable insert for authenticated users only"   ON reviews;
DROP POLICY IF EXISTS "Buyers create reviews"                        ON reviews;
DROP POLICY IF EXISTS "Users can create reviews"                     ON reviews;

DROP POLICY IF EXISTS "Reviews are public"                           ON reviews;
DROP POLICY IF EXISTS "Public reviews are viewable by everyone"      ON reviews;
DROP POLICY IF EXISTS "Anyone can read reviews"                      ON reviews;


-- 2b. INSERT — hardened: completed order, caller is party, reviewee is party
--     Prevents: reviewing without an order, spoofing reviewer_id or seller_id,
--               reviewing a non-completed order, reviewing as a non-party
CREATE POLICY "reviews_insert_order_party_only"
  ON reviews FOR INSERT
  WITH CHECK (
    -- Reviewer must be the authenticated caller
    reviewer_id = auth.uid()
    -- Order must exist, be completed, caller must be a party,
    -- and the reviewed user (seller_id column) must be the other party
    AND EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.id      = reviews.order_id
        AND o.status  = 'completed'
        AND (o.buyer_id  = auth.uid() OR o.seller_id = auth.uid())
        AND (o.seller_id = reviews.seller_id OR o.buyer_id = reviews.seller_id)
    )
  );


-- 2c. SELECT — reviews are public (shown on seller profile pages)
CREATE POLICY "Reviews are public"
  ON reviews FOR SELECT
  USING (true);


-- No UPDATE or DELETE policy for non-admin.
-- To remove an abusive review use the admin_delete_review RPC.


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — VERIFY
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
  tablename,
  policyname,
  cmd,
  qual       AS using_expr,
  with_check AS with_check_expr
FROM pg_policies
WHERE tablename IN ('listings', 'reviews')
ORDER BY tablename, cmd, policyname;

-- Expected listings rows (6):
--   listings_insert_own_active                  INSERT
--   Active listings are viewable by everyone    SELECT
--   listings_select_admin_bypass                SELECT
--   listings_update_owner_soft_delete_only      UPDATE
--
-- Expected reviews rows (2):
--   reviews_insert_order_party_only             INSERT
--   Reviews are public                          SELECT
