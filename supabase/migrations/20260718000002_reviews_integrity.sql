-- ══════════════════════════════════════════════════════════════════════════════
-- FRONTEND-008B — Reviews integrity: authoritative ratings, direction
-- enforcement, race-proof duplicate guard.
-- Idempotent — safe to re-run.
--
-- Why (2026-07-17 audit):
--   • The previous INSERT policy (20260519000006) only required the reviewed
--     party (reviews.seller_id) to be "a party of the order" — the CALLER is
--     a party, so a buyer could name themself as the reviewee and boost
--     their own rating. Direction (reviewer_role) was also never validated.
--   • The frontend has handled a `one_review_per_order_role` unique
--     violation since FRONTEND-005, but no such constraint exists in the
--     migration history — the only duplicate guard was a racy client-side
--     pre-check SELECT.
--   • profiles.rating / review_count — the denormalized fields every star
--     display reads — have NO maintainer anywhere in the migration history.
--     Ratings could be stale or never written at all.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. INSERT policy v2 — self-review block + authoritative direction ────────
--    (a) reviews.seller_id (the reviewed party) can never be the caller;
--    (b) reviewer_role must match the caller's actual side of the completed
--        order, and the reviewee must be the OTHER side. Direction is now
--        enforced by the database, not trusted from the client.
DROP POLICY IF EXISTS "reviews_insert_order_party_only" ON reviews;

CREATE POLICY "reviews_insert_order_party_only"
  ON reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND seller_id <> auth.uid()
    AND EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.id     = reviews.order_id
        AND o.status = 'completed'
        AND (
          (reviews.reviewer_role = 'buyer'
             AND o.buyer_id  = auth.uid()
             AND reviews.seller_id = o.seller_id)
          OR
          (reviews.reviewer_role = 'seller'
             AND o.seller_id = auth.uid()
             AND reviews.seller_id = o.buyer_id)
        )
    )
  );


-- ── 2. Race-proof duplicate guard ────────────────────────────────────────────
--    The exact constraint name the frontend's error handler has expected
--    since FRONTEND-005. Wrapped so pre-existing duplicate rows fail loudly
--    with operator guidance instead of aborting the whole migration.
--
--    ⚠ SUPERSEDED — HISTORICAL. Kept verbatim because this migration shipped
--    (267e9b2) and was applied to production on 2026-07-17; rewriting applied
--    history would make this file disagree with what every existing database
--    actually ran. It is corrected forward by
--    20260729000001_reviews_uniqueness_canonical.sql. Two defects, both fixed
--    there — do not copy this block as a pattern:
--
--    (a) WRONG KEY. The canonical rule is UNIQUE(order_id, reviewer_role). An
--        order has exactly one buyer and one seller, so role alone identifies
--        the party; including reviewer_id WEAKENS the rule, because
--        (order, alice, 'buyer') and (order, bob, 'buyer') become distinct keys.
--
--    (b) SILENT NO-OP ON PRODUCTION. `CREATE UNIQUE INDEX IF NOT EXISTS <name>`
--        matches on NAME ONLY and never compares the column list. A two-column
--        index of this name already existed on production from the dashboard
--        era, so this statement logged `relation ... already exists, skipping`
--        and changed nothing. That is why production is correct while a rebuild
--        from these migrations was not — and why the `EXCEPTION WHEN others
--        THEN RAISE WARNING` wrapper is the wrong instinct: it converts "the
--        duplicate guard was never created" into a successful migration.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS one_review_per_order_role
    ON reviews (order_id, reviewer_id, reviewer_role);
EXCEPTION WHEN others THEN
  RAISE WARNING
    'one_review_per_order_role index NOT created (%) — duplicate review rows exist. Dedupe reviews (keep earliest per order_id/reviewer_id/reviewer_role) and re-run.',
    SQLERRM;
END $$;


-- ── 3. Authoritative rating maintenance ──────────────────────────────────────
--    Recompute-from-source on every review INSERT/DELETE: idempotent, correct
--    even if a legacy pre-migration trigger also fires, and DELETE support
--    means admin moderation (ADMIN-001 admin_delete_review) heals the
--    reviewed user's aggregate automatically.
--    SECURITY DEFINER: the writer is the reviewer, who has no RLS right to
--    update the reviewee's profile row. rating/review_count are NOT among the
--    privilege-escalation-protected columns (20260518000001), so the
--    profiles BEFORE UPDATE guard passes this through untouched.
CREATE OR REPLACE FUNCTION recompute_profile_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject uuid;
BEGIN
  v_subject := COALESCE(NEW.seller_id, OLD.seller_id);
  UPDATE profiles p
  SET rating       = COALESCE((SELECT round(avg(r.rating)::numeric, 1)
                               FROM reviews r WHERE r.seller_id = v_subject), 0),
      review_count = (SELECT count(*)::int
                      FROM reviews r WHERE r.seller_id = v_subject)
  WHERE p.id = v_subject;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_recompute_rating ON reviews;

CREATE TRIGGER trg_reviews_recompute_rating
  AFTER INSERT OR DELETE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION recompute_profile_rating();


-- ── 4. One-time backfill ─────────────────────────────────────────────────────
--    4a. Profiles WITH reviews: write the true aggregate.
UPDATE profiles p
SET rating       = agg.avg_rating,
    review_count = agg.cnt
FROM (
  SELECT seller_id,
         round(avg(rating)::numeric, 1) AS avg_rating,
         count(*)::int                  AS cnt
  FROM reviews
  GROUP BY seller_id
) agg
WHERE p.id = agg.seller_id
  AND (p.rating       IS DISTINCT FROM agg.avg_rating
    OR p.review_count IS DISTINCT FROM agg.cnt);

--    4b. Profiles WITHOUT reviews but showing non-zero stars: reset to honest
--        zero (stale or hand-written values with no backing reviews).
UPDATE profiles p
SET rating = 0, review_count = 0
WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.seller_id = p.id)
  AND (COALESCE(p.rating, 0) <> 0 OR COALESCE(p.review_count, 0) <> 0);


-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT policyname FROM pg_policies WHERE tablename = 'reviews';
--   → reviews_insert_order_party_only, "Reviews are public"
-- SELECT indexdef FROM pg_indexes WHERE tablename = 'reviews'
--   AND indexname = 'one_review_per_order_role';                → 1 row
--   Check the DEFINITION, not just the row count: the canonical key is
--   (order_id, reviewer_role). Matching this index by name alone is exactly what
--   let the repo and production diverge — see the SUPERSEDED note in section 2
--   and 20260729000001_reviews_uniqueness_canonical.sql.
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_reviews_recompute_rating';
--   → 1 row
-- Spot check: profiles.rating/review_count match
--   SELECT seller_id, round(avg(rating),1), count(*) FROM reviews GROUP BY 1;
