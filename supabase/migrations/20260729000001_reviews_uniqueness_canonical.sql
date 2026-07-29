-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-002 follow-up — reviews uniqueness: converge the repository on the
-- canonical business rule that production already enforces.
-- Idempotent. Forward-only. No-op on a database that is already correct.
--
-- ── THE RULE ──────────────────────────────────────────────────────────────────
--   An order has exactly one buyer and exactly one seller. Each may leave
--   exactly one review. Therefore:
--
--       UNIQUE (order_id, reviewer_role)
--
--   and NOT UNIQUE (order_id, reviewer_id, reviewer_role). Adding reviewer_id
--   WEAKENS the rule rather than tightening it: (order, alice, 'buyer') and
--   (order, bob, 'buyer') are distinct keys, so a second identity reviewing in
--   the same role would be admitted. Role alone already identifies the party
--   uniquely within an order, which is exactly why it is the right key.
--
-- ── WHY THIS MIGRATION EXISTS ─────────────────────────────────────────────────
--   20260718000002 (FRONTEND-008B, shipped 2026-07-17, applied to production)
--   declares the three-column form. Production nevertheless has the correct
--   two-column index, and the reason is worth recording because it is a trap
--   that will recur:
--
--       CREATE UNIQUE INDEX IF NOT EXISTS one_review_per_order_role
--         ON reviews (order_id, reviewer_id, reviewer_role);
--
--   `IF NOT EXISTS` matches on the index NAME ONLY — it does not compare the
--   column list. A two-column index of that name already existed on production
--   from the pre-migration dashboard era, so Postgres emitted
--   `relation "one_review_per_order_role" already exists, skipping` and the
--   statement did nothing. Reproduced verbatim on a scratch database. The
--   migration reported success, production kept the two-column rule, and the
--   divergence went unnoticed because the old verification only matched the
--   index by name.
--
--   Consequence: production is correct, a database rebuilt from this repository
--   is NOT. This migration closes that gap in the direction of production, which
--   the SECURITY-002 audit established as the source of truth.
--
--   20260718000002 is left byte-identical in its executable content. It has
--   already shipped; rewriting applied history would make the file disagree with
--   what every existing database actually ran. Only its comments were annotated
--   to point here.
--
-- ── SAFETY ────────────────────────────────────────────────────────────────────
--   Fails LOUDLY. The original wrapped index creation in
--   `EXCEPTION WHEN others THEN RAISE WARNING`, which is precisely how a missing
--   duplicate-guard ships silently to production. Nothing here is swallowed: if
--   the data cannot satisfy the rule, this migration aborts and tells you what to
--   fix, and — critically — it verifies that BEFORE dropping any existing index,
--   so a failed run never leaves the table less protected than it found it.
--
--   No psql meta-commands, no BEGIN/COMMIT, no CREATE INDEX CONCURRENTLY: this
--   file is pasted whole into the Supabase SQL Editor, which runs it as a single
--   transaction.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. Preflight ─────────────────────────────────────────────────────────────
--    Both invariants are checked before anything is dropped or created.
DO $$
DECLARE
  v_dupes int;
  v_roles text;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (SELECT 1 FROM public.reviews
        GROUP BY order_id, reviewer_role
        HAVING count(*) > 1) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce UNIQUE(order_id, reviewer_role): % (order_id, reviewer_role) group(s) already hold more than one review. Dedupe first — keep the earliest row per group: DELETE FROM reviews r USING reviews k WHERE r.order_id = k.order_id AND r.reviewer_role = k.reviewer_role AND r.created_at > k.created_at;',
      v_dupes;
  END IF;

  SELECT string_agg(DISTINCT quote_literal(reviewer_role), ', ') INTO v_roles
  FROM public.reviews
  WHERE reviewer_role IS NULL OR reviewer_role NOT IN ('buyer', 'seller');

  IF v_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'reviews.reviewer_role holds value(s) outside (buyer, seller): %. The two-review-per-order guarantee depends on that domain being closed; reconcile these rows before applying.',
      v_roles;
  END IF;
END $$;


-- ── 2. Retire any superseded uniqueness index ────────────────────────────────
--    Dropped only if it is NOT already the canonical shape, and only if it is
--    either the three-column form or an index squatting on the canonical name
--    with the wrong definition. On production both conditions are false and this
--    loop does nothing at all.
--
--    Matched on SHAPE, not name, so a differently-named three-column index is
--    caught too. Constraint-backed indexes are dropped via ALTER TABLE, since
--    DROP INDEX refuses to touch an index that a constraint owns.
DO $$
DECLARE v_rec record;
BEGIN
  FOR v_rec IN
    SELECT * FROM (
      SELECT ic.relname::text  AS idxname,
             con.conname::text AS conname,
             i.indpred IS NULL AS unconditional,
             i.indnkeyatts     AS nkeys,
             (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, pos)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              WHERE k.pos <= i.indnkeyatts) AS keycols
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
      WHERE i.indrelid = 'public.reviews'::regclass
        AND i.indisunique
        AND ic.relname <> 'reviews_pkey'
    ) x
    WHERE NOT (x.unconditional
               AND x.nkeys = 2
               AND x.keycols = ARRAY['order_id', 'reviewer_role'])
      AND (x.idxname = 'one_review_per_order_role'
           OR x.keycols = ARRAY['order_id', 'reviewer_id', 'reviewer_role'])
  LOOP
    IF v_rec.conname IS NOT NULL THEN
      RAISE NOTICE 'dropping superseded constraint %', v_rec.conname;
      EXECUTE format('ALTER TABLE public.reviews DROP CONSTRAINT %I', v_rec.conname);
    ELSE
      RAISE NOTICE 'dropping superseded index %', v_rec.idxname;
      EXECUTE format('DROP INDEX public.%I', v_rec.idxname);
    END IF;
  END LOOP;
END $$;


-- ── 3. The canonical guard ───────────────────────────────────────────────────
--    Unconditional (no WHERE) and exactly two key columns. Not wrapped in an
--    exception handler: if this cannot be created, the migration must fail.
--    `IF NOT EXISTS` is safe here only because section 2 guarantees that any
--    index bearing this name already has the canonical definition.
CREATE UNIQUE INDEX IF NOT EXISTS one_review_per_order_role
  ON public.reviews (order_id, reviewer_role);


-- ── 4. Close the role domain ─────────────────────────────────────────────────
--    UNIQUE(order_id, reviewer_role) caps reviews per order at the number of
--    distinct legal roles. That is "at most two" ONLY while reviewer_role cannot
--    hold a third value — and it is bare `text` with no constraint, so today a
--    single extra role string admits a third review per order (verified: an
--    insert with reviewer_role = 'moderator' succeeds against the unique index).
--    This constraint is what actually delivers the stated guarantee.
--
--    The INSERT policy already restricts callers to 'buyer'/'seller'; this closes
--    the same door for service-role writes, backfills and any future policy edit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND contype = 'c'
      AND conname = 'reviews_reviewer_role_valid'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_reviewer_role_valid
      CHECK (reviewer_role IN ('buyer', 'seller'));
  END IF;
END $$;


-- ── Verification ─────────────────────────────────────────────────────────────
-- Canonical index present, unconditional, exactly two key columns:
--   SELECT indexdef FROM pg_indexes
--   WHERE tablename = 'reviews' AND indexname = 'one_review_per_order_role';
--     → CREATE UNIQUE INDEX ... ON public.reviews USING btree (order_id, reviewer_role)
--
-- No three-column form survives anywhere on the table:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'reviews';
--     → reviews_pkey (id) and one_review_per_order_role (order_id, reviewer_role) only
--
-- Role domain closed:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'reviews_reviewer_role_valid';
--     → CHECK (reviewer_role = ANY (ARRAY['buyer'::text, 'seller'::text]))
--
-- End-to-end: S002.17 in tests/security_001_002_production_verification.sql
-- reports PASS, and the suite's SUMMARY names no reviews/integrity failure.
