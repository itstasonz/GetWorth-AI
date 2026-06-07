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

-- ── match_products_by_ocr ─────────────────────────────────────────
-- Called by retrieveCandidates() with OCR-extracted keyword tokens.
-- Matches products by: model number, name, brand, or keyword array.
-- Returns ranked results: model_number > ocr_keyword > keyword > brand.

CREATE OR REPLACE FUNCTION match_products_by_ocr(
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
      -- Model field matches (highest priority — model number confirmed by OCR)
      WHEN EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE p.model ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'model_number'
      -- Name field matches
      WHEN EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE p.name ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'ocr_keyword'
      -- Keywords array matches
      WHEN EXISTS (
        SELECT 1 FROM unnest(p.keywords) pk, unnest(p_keywords) kw
        WHERE pk ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'keyword'
      -- Aliases array matches
      WHEN EXISTS (
        SELECT 1 FROM unnest(p.aliases) pa, unnest(p_keywords) kw
        WHERE pa ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'alias'
      -- Brand matches (lowest priority — too broad on its own)
      WHEN EXISTS (
        SELECT 1 FROM unnest(p_keywords) kw
        WHERE p.brand ILIKE '%' || kw || '%' AND length(kw) >= 3
      ) THEN 'brand'
      ELSE NULL
    END AS match_type
  FROM products p
  WHERE
    -- At least one keyword must match something
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
-- Called by retrieveCandidates() Strategy 1 when an embedding is available.
-- Requires the pgvector extension and a text_embedding column on products.
-- SKIP THIS if pgvector is not enabled in your Supabase project — the
-- api/analyze.js code already handles the RPC error gracefully.

DO $$
BEGIN
  -- Only create if pgvector extension is loaded (avoids migration failure when absent)
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION match_products(
        query_embedding   vector,
        similarity_threshold FLOAT DEFAULT 0.60,
        match_limit       INT    DEFAULT 10
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
        similarity          FLOAT
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
          1 - (p.text_embedding <=> query_embedding) AS similarity
        FROM products p
        WHERE p.text_embedding IS NOT NULL
          AND 1 - (p.text_embedding <=> query_embedding) > similarity_threshold
        ORDER BY p.text_embedding <=> query_embedding
        LIMIT match_limit;
      $inner$;
    $func$;
    RAISE NOTICE 'match_products (vector) created';
  ELSE
    RAISE NOTICE 'pgvector not available — match_products (vector) skipped. Vector search will fall back gracefully.';
  END IF;
END;
$$;

-- Grant execute to the anon and authenticated roles used by Supabase clients
GRANT EXECUTE ON FUNCTION match_products_by_ocr(TEXT[], INT) TO anon, authenticated, service_role;
