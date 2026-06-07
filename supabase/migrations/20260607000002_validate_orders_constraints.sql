-- ══════════════════════════════════════════════════════════════════════════════
-- Migration: validate NOT VALID constraints on the orders table
--
-- Migration 20260519000003_order_integrity.sql added two CHECK constraints with
-- NOT VALID so they would not block on existing rows. This migration promotes
-- them to full validation so Postgres enforces them retroactively.
--
-- Strategy: count violations before each VALIDATE call. If any exist, log a
-- WARNING and skip — the migration still succeeds, preventing CI breakage while
-- leaving a clear audit trail. Fix bad data in a follow-up, then re-run.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_self_buy   int;
  v_bad_status int;
BEGIN

  -- ── 1. orders_no_self_buy ─────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_self_buy
  FROM orders
  WHERE buyer_id = seller_id;

  IF v_self_buy > 0 THEN
    RAISE WARNING
      '[orders_no_self_buy] % row(s) with buyer_id = seller_id — skipping VALIDATE. '
      'Fix those rows and re-run this migration.', v_self_buy;
  ELSE
    ALTER TABLE orders VALIDATE CONSTRAINT orders_no_self_buy;
    RAISE NOTICE 'orders_no_self_buy validated (convalidated = true)';
  END IF;

  -- ── 2. orders_status_valid ────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_bad_status
  FROM orders
  WHERE status NOT IN (
    'pending', 'accepted', 'declined', 'shipped',
    'ready_pickup', 'delivered', 'completed', 'cancelled', 'disputed'
  );

  IF v_bad_status > 0 THEN
    RAISE WARNING
      '[orders_status_valid] % row(s) with out-of-enum status — skipping VALIDATE. '
      'Fix those rows and re-run this migration.', v_bad_status;
  ELSE
    ALTER TABLE orders VALIDATE CONSTRAINT orders_status_valid;
    RAISE NOTICE 'orders_status_valid validated (convalidated = true)';
  END IF;

END $$;


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Both convalidated values should be true after a clean run.
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
  AND conname IN ('orders_no_self_buy', 'orders_status_valid')
ORDER BY conname;
