-- ══════════════════════════════════════════════════════════════════════════════
-- FRONTEND-008C — profiles.total_sales maintenance.
-- Idempotent — safe to re-run.
--
-- Why (2026-07-17 production evidence): profile 750149a6… has 5 completed
-- orders as seller and 5 reviews, yet profiles.total_sales = 0 — the column
-- has NO maintainer anywhere in the migration history. total_sales is a
-- direct input to the trust score (computeTrustScore salesCount tier, up to
-- 25 pts) and therefore to the derived seller badge: a seller with 5
-- completed sales and a 5.0 rating rendered as "New Seller" while the same
-- screen showed 5 reviews. The badge/trust starvation is fixed at the
-- source: total_sales = count of the seller's COMPLETED orders, recomputed
-- from orders on every status change.
--
-- Same recompute-from-source pattern as recompute_profile_rating
-- (20260718000002). SECURITY DEFINER: the status-changing caller (buyer or
-- seller) has no RLS right to update the counterparty's profile row.
-- total_sales is NOT among the privilege-escalation-protected columns
-- (20260518000001), so the profiles BEFORE UPDATE guard passes it through.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_orders_recompute_total_sales ON orders;
--   DROP FUNCTION IF EXISTS recompute_profile_total_sales();
--   (total_sales values remain but stop updating — recomputable any time.)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION recompute_profile_total_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller uuid;
BEGIN
  v_seller := COALESCE(NEW.seller_id, OLD.seller_id);
  UPDATE profiles p
  SET total_sales = (SELECT count(*)::int
                     FROM orders o
                     WHERE o.seller_id = v_seller
                       AND o.status    = 'completed')
  WHERE p.id = v_seller;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_recompute_total_sales ON orders;

-- Fires only when status actually changes (or an order is created/removed) —
-- recompute-from-source makes double-fires harmless.
CREATE TRIGGER trg_orders_recompute_total_sales
  AFTER INSERT OR DELETE OR UPDATE OF status ON orders
  FOR EACH ROW
  EXECUTE FUNCTION recompute_profile_total_sales();

-- One-time backfill: write the true completed-order count for every profile
-- whose stored value drifted (covers both undercount and stale overcount).
UPDATE profiles p
SET total_sales = agg.cnt
FROM (
  SELECT pr.id, count(o.id) FILTER (WHERE o.status = 'completed')::int AS cnt
  FROM profiles pr
  LEFT JOIN orders o ON o.seller_id = pr.id
  GROUP BY pr.id
) agg
WHERE p.id = agg.id
  AND COALESCE(p.total_sales, 0) IS DISTINCT FROM agg.cnt;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_orders_recompute_total_sales'; → 1 row
-- Spot check: SELECT p.id, p.total_sales,
--   (SELECT count(*) FROM orders o WHERE o.seller_id = p.id AND o.status='completed')
--   FROM profiles p WHERE p.total_sales > 0 OR EXISTS
--   (SELECT 1 FROM orders o WHERE o.seller_id = p.id AND o.status='completed');
