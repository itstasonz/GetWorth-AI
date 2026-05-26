-- ══════════════════════════════════════════════════════════════════
-- GetWorth: Product search RPCs used by api/analyze.js
--
-- match_products_by_ocr — keyword-based product lookup from OCR text
-- match_products        — vector similarity search (requires pgvector)
--
-- Run this migration to restore DB-backed retrieval in the scan pipeline.
-- Without it, both Strategy 1 (vector) and Strategy 3 (OCR keyword) silently
-- return empty results on every scan.
-- ══════════════════════════════════════════════════════════════════

-- ── Drop all known existing signatures first ──────────────────────
-- Required because CREATE OR REPLACE cannot change the return type or
-- parameter defaults of an already-existing function in Postgres.
-- Using exact signatures confirmed from pg_proc inspection.

DROP FUNCTION IF EXISTS public.match_products_by_ocr(text[], integer);
DROP FUNCTION IF EXISTS public.match_products(vector, double precision, integer);
DROP FUNCTION IF EXISTS public.match_products(vector, integer);

-- ── Diagnostic: list remaining signatures (run output visible in psql / SQL editor) ──
SELECT
  p.proname                                            AS function_name,
  pg_get_function_identity_arguments(p.oid)            AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('match_products', 'match_products_by_ocr')
ORDER BY p.proname, p.oid;


-- ── match_products_by_ocr ─────────────────────────────────────────
-- Called by retrieveCandidates() with OCR-extracted keyword tokens.
-- Matches products by: model number, name, brand, or keyword array.
-- Returns ranked results: model_number > ocr_keyword > keyword > brand.

CREATE OR REPLACE FUNCTION public.match_products_by_ocr(
  p_keywords TEXT[],
  p_limit    INT DEFAULT 6
)
RETURNS TABLE (
  id                  UUID,
  brand               TEXT,
  model               TEXT,
  name                TEXT,
  name_hebrew         TEXT,
  category            TEXT,
  subcategory         TEXT,
  retail_price_ils    NUMERIC,
  avg_used_price_ils  NUMERIC,
  price_low_ils       NUMERIC,
  price_high_ils      NUMERIC,
  popularity_score    INT,
  scan_count          INT,
  confidence_weight   NUMERIC,
  keywords            TEXT[],
  aliases             TEXT[],
  match_type          TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT DISTINCT ON (p.id)
    p.id,
    p.brand,
    p.model,
    p.name,
    p.name_hebrew,
    p.category,
    p.subcategory,
    p.retail_price_ils,
    p.avg_used_price_ils,
    p.price_low_ils,
    p.price_high_ils,
    p.popularity_score,
    p.scan_count,
    p.confidence_weight,
    p.keywords,
    p.aliases,
    CASE
      -- Model field match — highest priority (model number confirmed by OCR)
      WHEN EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE p.model ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'model_number'
      -- Name field match
      WHEN EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE p.name ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'ocr_keyword'
      -- Keywords array match
      WHEN EXISTS (
        SELECT 1 FROM unnest(p.keywords) pk, unnest(p_keywords) kw
        WHERE pk ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'keyword'
      -- Aliases array match
      WHEN EXISTS (
        SELECT 1 FROM unnest(p.aliases) pa, unnest(p_keywords) kw
        WHERE pa ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'alias'
      -- Brand match — lowest priority (too broad on its own)
      WHEN EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE p.brand ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'brand'
      ELSE NULL
    END AS match_type
  FROM products p
  WHERE
    (
      EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE p.model ILIKE '%' || kw || '%' AND length(kw) >= 3)
      OR EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE p.name  ILIKE '%' || kw || '%' AND length(kw) >= 3)
      OR EXISTS (SELECT 1 FROM unnest(p.keywords) pk, unnest(p_keywords) kw WHERE pk ILIKE '%' || kw || '%' AND length(kw) >= 3)
      OR EXISTS (SELECT 1 FROM unnest(p.aliases)  pa, unnest(p_keywords) kw WHERE pa ILIKE '%' || kw || '%' AND length(kw) >= 3)
      OR EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE p.brand ILIKE '%' || kw || '%' AND length(kw) >= 4)
    )
  ORDER BY
    p.id,
    CASE
      WHEN EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE p.model ILIKE '%' || kw || '%' AND length(kw) >= 3) THEN 1
      WHEN EXISTS (SELECT 1 FROM unnest(p_keywords) kw WHERE p.name  ILIKE '%' || kw || '%' AND length(kw) >= 3) THEN 2
      WHEN EXISTS (SELECT 1 FROM unnest(p.keywords) pk, unnest(p_keywords) kw WHERE pk ILIKE '%' || kw || '%' AND length(kw) >= 3) THEN 3
      ELSE 4
    END
  LIMIT p_limit;
$$;


-- ── match_products (vector similarity) ────────────────────────────
-- Called by retrieveCandidates() Strategy 1 when a query embedding is available.
-- Requires the pgvector extension and a vector text_embedding column on products.
-- The DO block skips creation if pgvector is absent — api/analyze.js handles
-- the resulting RPC error gracefully via its OCR/text fallback strategies.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.match_products(
        query_embedding      vector,
        similarity_threshold double precision DEFAULT 0.60,
        match_limit          integer          DEFAULT 10
      )
      RETURNS TABLE (
        id                  UUID,
        brand               TEXT,
        model               TEXT,
        name                TEXT,
        name_hebrew         TEXT,
        category            TEXT,
        subcategory         TEXT,
        retail_price_ils    NUMERIC,
        avg_used_price_ils  NUMERIC,
        price_low_ils       NUMERIC,
        price_high_ils      NUMERIC,
        popularity_score    INT,
        scan_count          INT,
        confidence_weight   NUMERIC,
        keywords            TEXT[],
        aliases             TEXT[],
        similarity          double precision
      )
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      AS $inner$
        SELECT
          p.id, p.brand, p.model, p.name, p.name_hebrew,
          p.category, p.subcategory,
          p.retail_price_ils, p.avg_used_price_ils,
          p.price_low_ils, p.price_high_ils,
          p.popularity_score, p.scan_count, p.confidence_weight,
          p.keywords, p.aliases,
          (1 - (p.text_embedding <=> query_embedding))::double precision AS similarity
        FROM products p
        WHERE p.text_embedding IS NOT NULL
          AND (1 - (p.text_embedding <=> query_embedding)) > similarity_threshold
        ORDER BY p.text_embedding <=> query_embedding
        LIMIT match_limit;
      $inner$;
    $func$;
    RAISE NOTICE 'match_products (vector) created successfully';
  ELSE
    RAISE NOTICE 'pgvector extension not found — match_products skipped. Vector search falls back gracefully in api/analyze.js.';
  END IF;
END;
$$;


-- ── Grants ────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.match_products_by_ocr(TEXT[], INT)
  TO anon, authenticated, service_role;

-- Conditionally grant match_products only if it was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'match_products'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.match_products(vector, double precision, integer) TO anon, authenticated, service_role';
    RAISE NOTICE 'Granted execute on match_products';
  END IF;
END;
$$;


-- ── Final diagnostic: confirm what exists after migration ─────────
SELECT
  p.proname                                            AS function_name,
  pg_get_function_identity_arguments(p.oid)            AS args,
  l.lanname                                            AS language,
  p.prosecdef                                          AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language  l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.proname IN ('match_products', 'match_products_by_ocr')
ORDER BY p.proname, p.oid;
