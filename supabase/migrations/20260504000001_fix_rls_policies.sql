-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Targeted RLS Policy Fixes
-- Generated: 2026-05-04
-- DO NOT run blindly. Read every WARNING comment before executing.
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Run this first to see your CURRENT policies before changing anything:
--
--   SELECT schemaname, tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename IN ('listings','profiles','reviews','notifications')
--   ORDER BY tablename, cmd, policyname;
--
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. LISTINGS TABLE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- BEFORE (broken):
--   Policy name: "Enable read access for all users"  (or similar)
--   USING: true
--   Problem: exposes pending, deleted, and draft listings to anyone.
--
-- AFTER:
--   USING: status IN ('active', 'sold') OR auth.uid() = seller_id
--
-- WHY 'sold' is included (not just 'active'):
--   The app joins listings inside conversations, orders, and reviews queries:
--     conversations → listing:listings(id, title, images)
--     orders        → listing:listings(id, title, images, price)
--     reviews       → listing:listings(id, title, images)
--   If a listing is 'sold', the buyer can no longer read it and those joins
--   silently return null — breaking order history and chat listing previews.
--   Including 'sold' preserves these legitimate read paths.
--   'deleted' and 'pending' remain hidden from non-owners.
--
-- WHAT COULD BREAK:
--   • AdminPanel reads ALL listings (active + sold + pending + removed).
--     This policy restricts non-owners to active+sold only.
--     Admin queries will silently return a subset until a separate admin
--     policy is added (see note at end of this file).
--   • If you have any other status values beyond active/sold/pending/deleted/
--     removed, audit them and add them to the IN list if buyers need to see them.
-- ══════════════════════════════════════════════════════════════════════════════

-- Step 1a: drop all known permissive SELECT policies (actual names from pg_policies).
DROP POLICY IF EXISTS "Enable read access for all users" ON listings;
DROP POLICY IF EXISTS "Public listings are visible to everyone" ON listings;
DROP POLICY IF EXISTS "Anyone can view listings" ON listings;
DROP POLICY IF EXISTS "Public read listings" ON listings;

-- Step 1b: idempotency — drop new policy name so re-running this file never fails.
DROP POLICY IF EXISTS "listings_select_scoped" ON listings;

-- Step 1c: create the scoped SELECT policy.
CREATE POLICY "listings_select_scoped"
  ON listings
  FOR SELECT
  USING (
    status IN ('active', 'sold')
    OR auth.uid() = seller_id
  );

-- Verify: the remaining policies on listings should only be:
--   listings_select_scoped  (SELECT)
--   <insert policy>         (INSERT — owner only, should already exist)
--   <update policy>         (UPDATE — owner only, should already exist)


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. PROFILES TABLE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- BEFORE (broken):
--   Multiple conflicting SELECT policies, e.g.:
--     "Public profiles are viewable by everyone"  USING: true
--     "Users can view their own profile"          USING: auth.uid() = id
--   Having two policies is fine (Supabase ORs them), but if one is "true"
--   it makes the second redundant and confusing. Clean to a single policy.
--
-- AFTER:
--   ONE policy: USING: true
--   (Profiles are a public marketplace entity — full_name, avatar, rating,
--    badge, is_verified are all intentionally public. The app reads other
--    users' profiles for seller cards, chat headers, and order details.)
--
-- WHY keep USING: true for profiles SELECT:
--   The app does:
--     profiles.select('id, full_name, avatar_url').eq('id', userId)  — any user
--     profiles.select('*').eq('id', user.id)                         — own profile
--     listings join → seller:profiles(id, full_name, avatar_url)     — any seller
--     conversations join → buyer/seller:profiles(...)                — any party
--   Restricting to "own profile only" breaks seller cards and all FK joins.
--   The safe approach is one clean public read policy (not two).
--
-- WHAT COULD BREAK:
--   • Nothing, if you currently have a "true" policy in place — this just
--     removes the duplicate. Verify with pg_policies first.
--   • If both policies are removed and only a restrictive one remains,
--     seller profile pages and chat user names will break.
-- ══════════════════════════════════════════════════════════════════════════════

-- Step 2a: drop all known duplicate SELECT policies (actual names from pg_policies).
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Profiles are publicly readable" ON profiles;
DROP POLICY IF EXISTS "Anyone can read profiles" ON profiles;

-- Step 2b: idempotency — drop new policy name so re-running this file never fails.
DROP POLICY IF EXISTS "profiles_select_public" ON profiles;

-- Step 2c: create ONE clean public read policy.
CREATE POLICY "profiles_select_public"
  ON profiles
  FOR SELECT
  USING (true);

-- Note: UPDATE and INSERT policies for profiles should already be scoped to
-- auth.uid() = id. Do NOT touch them here.


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. REVIEWS TABLE — INSERT POLICY (anti-spoofing)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- BEFORE (broken):
--   INSERT policy likely: reviewer_id = auth.uid()
--   Problem: the client also sends seller_id in the payload. A malicious
--   user could craft an INSERT with seller_id = arbitrary_user_id and post
--   a fake review about someone they were never in an order with.
--
-- AFTER:
--   WITH CHECK verifies ALL of:
--     1. reviewer_id = auth.uid()            — can't spoof who you are
--     2. The order exists                    — can't invent an order
--     3. auth.uid() is in that order          — you were a party
--     4. seller_id matches a real order party — can't spoof the reviewee
--
-- HOW it works with the app:
--   The app fetches the order first (client-side), derives reviewedUserId from
--   orderData.seller_id or orderData.buyer_id, then inserts. The RLS WITH CHECK
--   independently re-derives the same constraint server-side — so even if a
--   client tampers with the payload, the DB rejects it.
--
-- WHAT COULD BREAK:
--   • Nothing if the app is working correctly — legitimate inserts already
--     satisfy all four conditions.
--   • If reviews.seller_id is used for something other than "the reviewed party"
--     (e.g. always the listing's seller regardless of reviewer_role), the
--     subquery condition may be too strict. Verify by checking a real review row.
--   • The unique constraint "one_review_per_order_role" (referenced in app code)
--     should remain — this policy does not replace it.
-- ══════════════════════════════════════════════════════════════════════════════

-- Step 3a: drop all known INSERT policies (actual names from pg_policies).
DROP POLICY IF EXISTS "Users can insert reviews" ON reviews;
DROP POLICY IF EXISTS "Authenticated users can insert reviews" ON reviews;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON reviews;
DROP POLICY IF EXISTS "Buyers create reviews" ON reviews;
DROP POLICY IF EXISTS "Users can create reviews" ON reviews;

-- Step 3b: idempotency — drop new policy name so re-running this file never fails.
DROP POLICY IF EXISTS "reviews_insert_order_party_only" ON reviews;

-- Step 3c: create hardened INSERT policy.
CREATE POLICY "reviews_insert_order_party_only"
  ON reviews
  FOR INSERT
  WITH CHECK (
    -- 1. Reviewer must be the authenticated user
    reviewer_id = auth.uid()
    -- 2 + 3 + 4. Order must exist, caller must be a party, reviewee must be a party
    AND EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.id = reviews.order_id
        AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())  -- caller is in the order
        AND (o.seller_id = reviews.seller_id OR o.buyer_id = reviews.seller_id)  -- reviewee is in the order
    )
  );

-- Keep existing SELECT policy on reviews (public read is fine — reviews are shown on seller profiles).
-- Keep existing UPDATE/DELETE policies if any.


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. NOTIFICATIONS TABLE — INSERT POLICY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- BEFORE (broken):
--   INSERT policy likely: auth.uid() IS NOT NULL  (any logged-in user)
--   Problem: any user can insert a notification targeted at any other user_id,
--   enabling notification spam to arbitrary accounts.
--
-- AFTER:
--   Two allowed cases:
--     A. user_id = auth.uid()  — creating a notification for yourself (self)
--     B. A shared order exists between auth.uid() and the target user_id
--        — the only legitimate reason to notify someone else in this app
--
-- HOW it works with the app:
--   The app creates cross-user notifications in updateOrderStatus:
--     supabase.from('notifications').insert({ user_id: notifTargetId, ... })
--   notifTargetId is the OTHER party in the order. The EXISTS subquery verifies
--   they share an active (non-cancelled) order — so this insert still works.
--
-- WHAT COULD BREAK:
--   • If there are other places in the codebase that insert notifications for
--     arbitrary users (e.g. admin triggers, Edge Functions using the anon key),
--     those will be blocked. Server-side triggers using the service role bypass
--     RLS entirely, so they are unaffected.
--   • If pg triggers or Edge Functions use the anon key to fire notifications,
--     switch them to the service role key instead.
-- ══════════════════════════════════════════════════════════════════════════════

-- Step 4a: drop all known INSERT policies (actual names from pg_policies).
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON notifications;
DROP POLICY IF EXISTS "Users can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON notifications;
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;

-- Step 4b: idempotency — drop new policy name so re-running this file never fails.
DROP POLICY IF EXISTS "notifications_insert_self_or_order_party" ON notifications;

-- Step 4c: create scoped INSERT policy.
CREATE POLICY "notifications_insert_self_or_order_party"
  ON notifications
  FOR INSERT
  WITH CHECK (
    -- Case A: inserting a notification for yourself
    user_id = auth.uid()
    OR
    -- Case B: inserting for the other party in a shared order
    EXISTS (
      SELECT 1
      FROM orders o
      WHERE (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
        AND (o.buyer_id = notifications.user_id OR o.seller_id = notifications.user_id)
        AND o.status <> 'cancelled'
    )
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. VERIFY — run after applying all changes
-- ══════════════════════════════════════════════════════════════════════════════

SELECT
  tablename,
  policyname,
  cmd,
  qual       AS using_expr,
  with_check AS with_check_expr
FROM pg_policies
WHERE tablename IN ('listings', 'profiles', 'reviews', 'notifications')
ORDER BY tablename, cmd, policyname;


-- ══════════════════════════════════════════════════════════════════════════════
-- FUTURE WORK (not in this migration — requires separate admin bypass policy)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- AdminPanel reads ALL listings regardless of status. To restore that without
-- weakening the scoped SELECT policy, add a separate admin bypass:
--
--   CREATE POLICY "listings_select_admin_bypass"
--     ON listings FOR SELECT
--     USING (
--       EXISTS (
--         SELECT 1 FROM profiles
--         WHERE profiles.id = auth.uid() AND profiles.is_admin = true
--       )
--     );
--
-- Apply this only after verifying that is_admin is properly protected in
-- the profiles table UPDATE policy (so users can't grant themselves is_admin).
-- ══════════════════════════════════════════════════════════════════════════════
