-- ══════════════════════════════════════════════════════════════════════════════
-- VAL-001 — pg_trgm GIN indexes on public.products (Tier A)
-- Generated: 2026-07-30   Forward-only. Idempotent. Safe to re-run.
--
-- ── READ THIS BEFORE ASSUMING THIS MIGRATION MAKES ANYTHING FASTER ────────────
--
-- IT DOES NOT — NOT TODAY. At the current catalog size the PostgreSQL planner
-- will very probably keep choosing a sequential scan over every index created
-- here, and the measured scan time will not change. That is the expected
-- outcome, not a defect, and this migration must not be cited as a performance
-- improvement.
--
--   Catalog size, from repo evidence (db-expansion-summary.md):
--     "Products before: 224 … New products added: 1630 … Final total: 1854"
--
--   ~1,854 rows fit in a handful of heap pages. A seq scan reads all of them in
--   roughly a millisecond, which is cheaper than a bitmap index scan plus heap
--   recheck. A trigram index built from a 3-character pattern ('%abc%' yields
--   exactly one trigram) is weakly selective on top of that, so the planner's
--   choice is correct.
--
-- ── SO WHY SHIP IT ────────────────────────────────────────────────────────────
--
-- Because the cost is as close to zero as a schema change gets, and the
-- predicates are already trigram-shaped, so the plan flips on its own the day
-- the catalog grows — with no code change and no migration scramble.
--
--   COST — verified, not assumed:
--     • Size: ~150-500 KB per index, under ~2 MB total. Next to the
--       text_embedding column (~1,854 × 1536 × 4 B ≈ 11 MB) this is noise.
--     • Writes: the ONLY production write to products is the best-effort
--       write-back at api/analyze.js:2101, which updates popularity_score,
--       scan_count and last_scanned_at. NONE of those columns is indexed here,
--       so HOT updates are preserved and no GIN index is touched on the hot
--       path. This is also exactly why popularity_score is deliberately NOT
--       indexed (see below).
--     • Build: milliseconds at this row count (see the CONCURRENTLY note).
--
--   BENEFIT — future only. These indexes serve the ILIKE predicates already in
--   the retrieval path (api/analyze.js): strategies 1, 2-fallback, 3a, 3b, 4, 5,
--   8 and the write-back lookup at :2068, all of the form
--   `brand/model/name/category ILIKE '%token%'`. gin_trgm_ops indexes both
--   `~~` (LIKE) and `~~*` (ILIKE), and the pattern may be a runtime value — it
--   does not have to be a plan-time constant.
--
-- ── EVIDENCE GATE ─────────────────────────────────────────────────────────────
--   VAL-001 Wave 3 captures EXPLAIN (ANALYZE, BUFFERS) for these predicates at
--   BOTH ~1.8k rows and ~200k rows. Any index here whose plan does not flip to
--   an index scan at scale gets DROPPED. No index survives on the strength of
--   this comment alone.
--
-- ── DELIBERATELY NOT DONE HERE ────────────────────────────────────────────────
--   • popularity_score btree — REJECTED. Three retrieval paths sort by it
--     (analyze.js:1685, :1724, :1761), but they sort at most a few hundred
--     already-filtered rows. Indexing it would break HOT on the per-scan
--     write-back UPDATE (which increments that exact column) and bloat the
--     index continuously, buying a sort that is already free.
--   • match_products_by_ocr rewrite — DEFERRED (VAL-001 decision D5). As
--     written, that function's only WHERE clause is `r.match_rank IS NOT NULL`,
--     a predicate on the output of a CROSS JOIN LATERAL with `products` as the
--     OUTER relation. Nothing is pushable, so it seq-scans every row and runs
--     up to six correlated EXISTS per row REGARDLESS of the indexes below. It
--     needs an inside-out rewrite (keywords drive, products on the inner
--     index-scanned side) — a semantic change to tier/ranking logic that
--     requires a production keyword corpus to prove equivalent. Follow-up.
--   • FTS index — DEFERRED (D6). api/analyze.js:1737 calls
--     .textSearch('name', …) with no config, which emits the one-argument
--     to_tsvector(name): STABLE, not IMMUTABLE, therefore unindexable by ANY
--     expression index. Meanwhile products already carries an `fts` tsvector
--     column that no query touches. Fixing this is a paired code+DDL change and
--     first needs prod introspection of how `fts` is generated. Follow-up.
--   • Tier B array indexes (keywords / ocr_keywords / aliases / model_numbers)
--     and a pgvector index on text_embedding — DEFERRED (D6), gated on
--     measurement. Both are only reachable after the D5 rewrite anyway.
--   • `SET search_path` and the SECURITY INVOKER question on match_products /
--     match_products_by_ocr — DEFERRED with the RPC work. Both are SECURITY
--     DEFINER with an unpinned search_path (the Supabase linter's
--     function_search_path_mutable). Not touched here. Follow-up.
--
-- ── SAFETY / APPLY PATH ───────────────────────────────────────────────────────
--   No psql meta-commands, no BEGIN/COMMIT, no CREATE INDEX CONCURRENTLY: this
--   file is pasted whole into the Supabase SQL Editor, which runs it as a single
--   transaction (same rule stated in 20260729000001). CONCURRENTLY cannot run
--   inside a transaction block at all, and a failed concurrent build leaves an
--   INVALID index behind. Plain CREATE INDEX takes a SHARE lock — blocks writes,
--   ALLOWS READS — for single-digit milliseconds at 1,854 rows, and the only
--   writer is the write-back at analyze.js:2101, which is already wrapped in
--   try/catch and documented as non-blocking for the valuation.
--
--   public.products is created by NO migration in this repo — it exists only in
--   production. The preflight below therefore fails LOUDLY on a fresh database
--   rather than half-applying.
--
--   The pg_trgm opclass is resolved from the catalog and schema-qualified. A
--   bare `gin_trgm_ops` fails to resolve whenever the extension's schema (on
--   Supabase, `extensions`) is not on the session search_path.
--
-- Rollback: see foot of file.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Preconditions — target table and every indexed column must already exist.
--    Aborts before anything is created; a fresh-DB rebuild fails here by design.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION
      'VAL-001 abort: public.products does not exist. This table is created by no '
      'migration in this repo (it exists only in production) — wrong database?';
  END IF;

  SELECT string_agg(c, ', ' ORDER BY c) INTO v_missing
  FROM unnest(ARRAY['brand', 'model', 'name', 'category']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = c
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: public.products is missing column(s): % — wrong database?', v_missing;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. pg_trgm — install if absent, preferring the Supabase `extensions` schema
--    (same convention as 20260607000004, which installs pg_net there).
--    CREATE EXTENSION IF NOT EXISTS ignores the SCHEMA clause when the extension
--    is already installed, so the schema is never assumed — it is resolved in
--    step 3 from the catalog.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE NOTICE 'pg_trgm already installed — leaving its schema untouched';
  ELSIF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    EXECUTE 'CREATE EXTENSION pg_trgm SCHEMA extensions';
    RAISE NOTICE 'pg_trgm installed into schema extensions';
  ELSE
    EXECUTE 'CREATE EXTENSION pg_trgm';
    RAISE NOTICE 'pg_trgm installed into the default schema (no extensions schema present)';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. The four Tier A indexes.
--
--    The opclass schema is read from pg_opclass and injected with format('%I'),
--    so this works whether pg_trgm landed in `extensions`, `public`, or
--    anywhere else. Index names are stable and idempotent.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_opc_schema text;
  r             record;
BEGIN
  SELECT n.nspname INTO v_opc_schema
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am        am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gin_trgm_ops' AND am.amname = 'gin';

  IF v_opc_schema IS NULL THEN
    RAISE EXCEPTION
      'VAL-001 abort: gin_trgm_ops not found after ensuring pg_trgm — the extension '
      'is present but its GIN opclass is not visible in any schema.';
  END IF;
  RAISE NOTICE 'resolved gin_trgm_ops in schema %', v_opc_schema;

  FOR r IN
    SELECT * FROM (VALUES
      ('idx_products_brand_trgm',    'brand'),
      ('idx_products_model_trgm',    'model'),
      ('idx_products_name_trgm',     'name'),
      ('idx_products_category_trgm', 'category')
    ) AS t(idx_name, col_name)
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.products USING gin (%I %I.gin_trgm_ops)',
      r.idx_name, r.col_name, v_opc_schema
    );
    RAISE NOTICE 'ensured % on public.products(%)', r.idx_name, r.col_name;
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Postconditions — fail the whole migration (single transaction in the SQL
--    Editor) rather than ship a partial or wrong-shaped index set.
--
--    CREATE INDEX IF NOT EXISTS matches on NAME ONLY: a pre-existing index with
--    one of these names but the wrong access method, column or opclass would be
--    silently accepted. This block reads the catalog and proves the actual
--    shape of each index instead of trusting the name.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s(expected %s)', e.idx_name, e.col_name), ', ' ORDER BY e.idx_name)
    INTO v_bad
  FROM (VALUES
    ('idx_products_brand_trgm',    'brand'),
    ('idx_products_model_trgm',    'model'),
    ('idx_products_name_trgm',     'name'),
    ('idx_products_category_trgm', 'category')
  ) AS e(idx_name, col_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index      i
    JOIN pg_class      c  ON c.oid  = i.indexrelid
    JOIN pg_am         am ON am.oid = c.relam
    JOIN pg_attribute  a  ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    JOIN pg_opclass    oc ON oc.oid = i.indclass[0]
    WHERE i.indrelid = 'public.products'::regclass
      AND c.relname  = e.idx_name
      AND am.amname  = 'gin'
      AND a.attname  = e.col_name
      AND oc.opcname = 'gin_trgm_ops'
      AND i.indnatts = 1
      AND i.indisvalid
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'postcondition failed: missing or wrong-shaped trigram index(es): %. '
      'Each must be a single-column VALID GIN index using gin_trgm_ops.', v_bad;
  END IF;

  RAISE NOTICE 'VAL-001 Tier A: all 4 trigram GIN indexes present and correctly shaped';
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- Expected: 4 rows, all amname='gin', all opcname='gin_trgm_ops'.
-- SELECT c.relname AS index_name, a.attname AS column_name,
--        am.amname AS access_method, oc.opcname AS opclass,
--        pg_size_pretty(pg_relation_size(c.oid)) AS size
-- FROM pg_index i
-- JOIN pg_class     c  ON c.oid = i.indexrelid
-- JOIN pg_am        am ON am.oid = c.relam
-- JOIN pg_attribute a  ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
-- JOIN pg_opclass   oc ON oc.oid = i.indclass[0]
-- WHERE i.indrelid = 'public.products'::regclass
-- ORDER BY c.relname;
--
-- Total index footprint — expected well under 2 MB:
-- SELECT pg_size_pretty(SUM(pg_relation_size(indexrelid))) AS total_index_size,
--        (SELECT count(*) FROM public.products) AS product_rows
-- FROM pg_index WHERE indrelid = 'public.products'::regclass;
--
-- Plan evidence for Wave 3 — at ~1,854 rows a Seq Scan here is the EXPECTED and
-- CORRECT plan. The same statement must flip to a Bitmap Index Scan at ~200k
-- rows, or the index gets dropped:
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM public.products
--   WHERE brand ILIKE '%logitech%' AND model ILIKE '%g900%' LIMIT 5;


-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — fully reversible, no data is touched by this migration):
--   DROP INDEX IF EXISTS public.idx_products_brand_trgm;
--   DROP INDEX IF EXISTS public.idx_products_model_trgm;
--   DROP INDEX IF EXISTS public.idx_products_name_trgm;
--   DROP INDEX IF EXISTS public.idx_products_category_trgm;
--   -- pg_trgm is intentionally NOT dropped: other objects may come to depend
--   -- on it, and an unused extension costs nothing.
-- ══════════════════════════════════════════════════════════════════════════════
