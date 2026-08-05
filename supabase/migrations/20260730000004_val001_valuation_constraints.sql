-- ══════════════════════════════════════════════════════════════════════════════
-- VAL-001 — arithmetic sanity constraints on valuations + price_observations
-- Generated: 2026-07-30   Forward-only. Idempotent. Safe to re-run.
--
-- Declarative floor under every price the system stores, enforced by the
-- database rather than by whichever code path happens to be writing:
--
--   valuations_price_nonneg    every price is a real, non-negative number
--   valuations_price_ordered   low <= mid <= high (and low <= high)
--   valuations_price_ceiling   no price exceeds an absolute sanity ceiling
--   price_observations_price_sane   same floor+ceiling for observed prices
--
-- ── WHAT THIS DOES AND DOES NOT PROTECT ───────────────────────────────────────
-- These are ARITHMETIC constraints. They make a stored price a coherent number;
-- they do NOT make it an honest one. A price_mid of 99,000,000 satisfies every
-- rule below.
--
-- Authorship control is a SEPARATE, complementary layer and lives in
-- 20260730000002_val001_valuations_column_freeze.sql, which revokes blanket
-- UPDATE on valuations from `authenticated` and re-grants it only on the
-- columns the client legitimately writes. Read the two files together: this one
-- bounds the VALUE, that one bounds the WRITER. Neither is sufficient alone —
-- 20260607000001_rls_valuations.sql grants ownership-scoped UPDATE with no
-- column restriction, so without the freeze a user can PATCH their own
-- price_mid to any value that passes the CHECKs here.
--
-- ── WHY CHECK CONSTRAINTS AND NOT TRIGGERS ────────────────────────────────────
-- Declarative, visible to the planner, cheap, and — the deciding reason — they
-- are enforced against SECURITY DEFINER writers too. record_scan() (20260701120000)
-- is the only server-side write path for valuations; a trigger gated on a
-- session flag is exactly the thing such a path would bypass. A CHECK cannot be
-- bypassed. There is no cross-row or cross-table invariant here that would
-- justify a trigger.
--
-- ── NaN: WHY THE EXPRESSIONS ARE BUILT AT RUNTIME ─────────────────────────────
-- record_scan() casts these columns with ::int, which is strong but NOT
-- conclusive evidence of the stored type — a narrowing cast onto a numeric
-- column looks identical. The distinction matters, because the correct
-- not-a-number test differs by type and the wrong one is a hard type error:
--
--   integer / bigint / smallint  NaN is unrepresentable — no test needed
--   numeric / decimal            'NaN'::numeric IS storable, and compares as
--                                GREATER than everything, so `COALESCE(x,0) >= 0`
--                                returns TRUE for NaN. Test: x <> 'NaN'::numeric
--   real / double precision      NaN storable; float NaN <> NaN, so the test is
--                                the self-comparison x = x
--
-- So the column type is introspected from information_schema and the finiteness
-- test is emitted to match, rather than assumed. It is folded INTO
-- valuations_price_nonneg (not shipped as a fifth constraint) because for
-- numeric a NaN silently DEFEATS the >= 0 test — "is a real, non-negative
-- number" is one guarantee, not two. ±Infinity needs no dedicated test:
-- -Infinity fails the nonneg rule and +Infinity fails the ceiling rule.
--
-- ── DELIBERATELY NOT CONSTRAINED ──────────────────────────────────────────────
--   price_observations.condition / .source — NOT constrained to enum sets.
--   condition is written as `verification.condition || 'unknown'` and source is
--   a free-text provenance tag (api/analyze.js:2111-2116). Pinning either would
--   make a future price feed fail an insert on a table whose entire purpose is
--   append-only history.
--   valuations.ai_confidence — a real column that accepts NaN/Infinity and
--   should be bounded to [0,1]. Outside the constraint set authorized for this
--   migration; recorded as a follow-up.
--
-- ── SAFETY / APPLY PATH ───────────────────────────────────────────────────────
-- No psql meta-commands, no BEGIN/COMMIT: pasted whole into the Supabase SQL
-- Editor, which runs it as a single transaction.
--
-- Every constraint is added NOT VALID, then validated ONLY if the table
-- currently holds zero violating rows. If any row violates, the VALIDATE is
-- skipped with a RAISE WARNING (per the pattern established in
-- 20260607000002_validate_orders_constraints.sql) — the constraint still binds
-- all FUTURE writes, CI is not broken, and the audit trail names the count to
-- fix. Re-run this file after cleaning the data to promote it.
--
-- valuations and price_observations are created by NO migration in this repo —
-- they exist only in production. The preflight fails LOUDLY on a fresh database
-- rather than half-applying.
--
-- Rollback: see foot of file.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Preconditions — both tables and every constrained column must exist.
--    Nothing is added or altered before this passes.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.valuations') IS NULL THEN
    RAISE EXCEPTION
      'VAL-001 abort: public.valuations does not exist. This table is created by no '
      'migration in this repo (it exists only in production) — wrong database?';
  END IF;

  IF to_regclass('public.price_observations') IS NULL THEN
    RAISE EXCEPTION
      'VAL-001 abort: public.price_observations does not exist. This table is created '
      'by no migration in this repo — it is written only by api/analyze.js:2111 — '
      'wrong database?';
  END IF;

  SELECT string_agg(c, ', ' ORDER BY c) INTO v_missing
  FROM unnest(ARRAY['price_low', 'price_mid', 'price_high', 'new_retail']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'valuations' AND column_name = c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: public.valuations is missing column(s): % — wrong database?', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'price_observations' AND column_name = 'price'
  ) THEN
    RAISE EXCEPTION 'VAL-001 abort: public.price_observations is missing column: price — wrong database?';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Build the CHECK expressions from the ACTUAL column types, add each
--    constraint NOT VALID, then validate it only if the data already complies.
--
--    The violator count is taken from the constraint definition READ BACK OUT
--    of pg_constraint, not from the expression built above — so the count
--    always reflects what Postgres will actually enforce, including the case
--    where a constraint of that name already existed from an earlier run.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  -- Absolute sanity ceiling, in ILS. A policy number, kept in its own
  -- constraint so it can be relaxed without touching the ordering invariant.
  c_ceiling   constant text := '100000000';

  v_cols      text[] := ARRAY['price_low', 'price_mid', 'price_high', 'new_retail'];
  v_col       text;
  v_type      text;
  v_nonneg    text := '';
  v_ceiling   text := '';
  v_ordered   text;
  v_obs       text;
  v_obs_type  text;

  r           record;
  v_def       text;
  v_effective text;
  v_validated boolean;
  v_violators bigint;
BEGIN
  -- ── 2a. valuations: per-column non-negativity (+ type-correct NaN test) and
  --        the ceiling. Both accumulate one conjunct per column.
  FOREACH v_col IN ARRAY v_cols LOOP
    SELECT data_type INTO v_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'valuations' AND column_name = v_col;

    v_nonneg  := v_nonneg  || format('COALESCE(%I, 0) >= 0 AND ', v_col);
    v_ceiling := v_ceiling || format('COALESCE(%I, 0) <= %s AND ', v_col, c_ceiling);

    IF v_type IN ('numeric', 'decimal') THEN
      -- numeric NaN compares greater than everything, so it passes >= 0.
      v_nonneg := v_nonneg || format('(%I IS NULL OR %I <> ''NaN''::numeric) AND ', v_col, v_col);
    ELSIF v_type IN ('real', 'double precision') THEN
      -- float NaN <> NaN, so self-comparison is the NaN test.
      v_nonneg := v_nonneg || format('(%I IS NULL OR %I = %I) AND ', v_col, v_col, v_col);
    ELSE
      RAISE NOTICE 'valuations.% is % — NaN is unrepresentable, no finiteness test emitted', v_col, v_type;
    END IF;
  END LOOP;

  v_nonneg  := regexp_replace(v_nonneg,  '\s+AND\s+$', '');
  v_ceiling := regexp_replace(v_ceiling, '\s+AND\s+$', '');

  -- ── 2b. Ordering. Each pair is guarded independently on NULL so a partially
  --        populated band is allowed. The low<=high conjunct is NOT redundant:
  --        it is the only rule binding the band when price_mid is NULL, which
  --        the client backup path can produce (AppContext.jsx:2036-2038 writes
  --        `?? null` for each of the three independently).
  v_ordered :=
    '(price_low  IS NULL OR price_mid  IS NULL OR price_low <= price_mid) AND '
    '(price_mid  IS NULL OR price_high IS NULL OR price_mid <= price_high) AND '
    '(price_low  IS NULL OR price_high IS NULL OR price_low <= price_high)';

  -- ── 2c. price_observations.price — floor and ceiling, same NaN treatment.
  SELECT data_type INTO v_obs_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'price_observations' AND column_name = 'price';

  v_obs := format('price IS NULL OR (price >= 0 AND price <= %s', c_ceiling);
  IF v_obs_type IN ('numeric', 'decimal') THEN
    v_obs := v_obs || ' AND price <> ''NaN''::numeric';
  ELSIF v_obs_type IN ('real', 'double precision') THEN
    v_obs := v_obs || ' AND price = price';
  ELSE
    RAISE NOTICE 'price_observations.price is % — NaN is unrepresentable, no finiteness test emitted', v_obs_type;
  END IF;
  v_obs := v_obs || ')';

  -- ── 2d. Add (NOT VALID) then conditionally validate each constraint.
  FOR r IN
    SELECT * FROM (VALUES
      ('public.valuations',         'valuations_price_nonneg',        v_nonneg),
      ('public.valuations',         'valuations_price_ordered',       v_ordered),
      ('public.valuations',         'valuations_price_ceiling',       v_ceiling),
      ('public.price_observations', 'price_observations_price_sane',  v_obs)
    ) AS t(tbl, cname, expr)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = r.tbl::regclass AND conname = r.cname
    ) THEN
      RAISE NOTICE 'constraint % already exists — skipping ADD (its existing definition is used below)', r.cname;
    ELSE
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s) NOT VALID', r.tbl, r.cname, r.expr);
      RAISE NOTICE 'added constraint % (NOT VALID): CHECK (%)', r.cname, r.expr;
    END IF;

    SELECT con.convalidated, pg_get_constraintdef(con.oid)
      INTO v_validated, v_def
    FROM pg_constraint con
    WHERE con.conrelid = r.tbl::regclass AND con.conname = r.cname;

    IF v_validated THEN
      RAISE NOTICE '% is already validated — nothing to do', r.cname;
      CONTINUE;
    END IF;

    -- Strip the CHECK wrapper / NOT VALID suffix to get a usable boolean expr.
    v_effective := regexp_replace(
                     regexp_replace(v_def, '^CHECK\s*', ''),
                     '\s*NOT VALID\s*$', '');

    -- NULL expression = constraint satisfied (standard SQL CHECK semantics),
    -- and `NOT NULL` is NULL, so NULL rows are correctly not counted here.
    EXECUTE format('SELECT count(*) FROM %s WHERE NOT (%s)', r.tbl, v_effective)
      INTO v_violators;

    IF v_violators > 0 THEN
      RAISE WARNING
        '[%] % row(s) violate the constraint — skipping VALIDATE. The constraint '
        'still binds all FUTURE writes. Fix those rows and re-run this migration '
        'to promote it. Definition: %',
        r.cname, v_violators, v_def;
    ELSE
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.tbl, r.cname);
      RAISE NOTICE '% validated (convalidated = true)', r.cname;
    END IF;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Postconditions — all four constraints must EXIST. Validation status is
--    reported but not required: skipping VALIDATE on dirty data is a sanctioned
--    outcome (see the header), whereas a missing constraint is not.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_missing   text;
  v_unvalidated text;
BEGIN
  SELECT string_agg(e.cname, ', ' ORDER BY e.cname) INTO v_missing
  FROM (VALUES
    ('public.valuations',         'valuations_price_nonneg'),
    ('public.valuations',         'valuations_price_ordered'),
    ('public.valuations',         'valuations_price_ceiling'),
    ('public.price_observations', 'price_observations_price_sane')
  ) AS e(tbl, cname)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = e.tbl::regclass AND conname = e.cname AND contype = 'c'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'postcondition failed: CHECK constraint(s) missing after apply: %', v_missing;
  END IF;

  SELECT string_agg(con.conname, ', ' ORDER BY con.conname) INTO v_unvalidated
  FROM pg_constraint con
  WHERE con.conname IN ('valuations_price_nonneg', 'valuations_price_ordered',
                        'valuations_price_ceiling', 'price_observations_price_sane')
    AND NOT con.convalidated;

  IF v_unvalidated IS NULL THEN
    RAISE NOTICE 'VAL-001: all 4 price constraints present and VALIDATED against existing rows';
  ELSE
    RAISE WARNING
      'VAL-001: all 4 price constraints present, but NOT VALID (future writes are '
      'bound, existing rows are not): %. See the WARNINGs above for violator counts.',
      v_unvalidated;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expected: 4 rows. convalidated = true on a clean database; false means the
-- VALIDATE was skipped and the WARNING above names the violator count.
-- SELECT rel.relname AS table_name, con.conname, con.convalidated,
--        pg_get_constraintdef(con.oid) AS definition
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- WHERE con.conname IN ('valuations_price_nonneg', 'valuations_price_ordered',
--                       'valuations_price_ceiling', 'price_observations_price_sane')
-- ORDER BY rel.relname, con.conname;
--
-- The types the expressions were built from — confirms which NaN test shipped:
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND ((table_name = 'valuations'
--         AND column_name IN ('price_low','price_mid','price_high','new_retail'))
--     OR (table_name = 'price_observations' AND column_name = 'price'))
-- ORDER BY table_name, column_name;
--
-- Negative test — each of these MUST fail once the constraints are in place:
-- INSERT INTO public.valuations (id, user_id, price_low, price_mid, price_high)
--   VALUES (gen_random_uuid(), '<some-uuid>', 500, 100, 900);   -- price_ordered
-- INSERT INTO public.valuations (id, user_id, price_mid)
--   VALUES (gen_random_uuid(), '<some-uuid>', -1);              -- price_nonneg
-- INSERT INTO public.valuations (id, user_id, price_mid)
--   VALUES (gen_random_uuid(), '<some-uuid>', 100000001);       -- price_ceiling


-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — restores the pre-migration state, NOT a recommended state;
-- no data is modified by this migration, so dropping is fully reversible):
--   ALTER TABLE public.valuations         DROP CONSTRAINT IF EXISTS valuations_price_nonneg;
--   ALTER TABLE public.valuations         DROP CONSTRAINT IF EXISTS valuations_price_ordered;
--   ALTER TABLE public.valuations         DROP CONSTRAINT IF EXISTS valuations_price_ceiling;
--   ALTER TABLE public.price_observations DROP CONSTRAINT IF EXISTS price_observations_price_sane;
-- ══════════════════════════════════════════════════════════════════════════════
