-- ══════════════════════════════════════════════════════════════════
-- SCAN-005 (F2 + F3): match_products_by_ocr — rank before LIMIT, and
-- query the enriched identity columns.
--
-- FUNCTION-ONLY change: same name, same signature, same return columns
-- as 20260526000003. No tables or columns are created or altered.
--
-- F3 — ranking bug. The previous version used
--     SELECT DISTINCT ON (p.id) … ORDER BY p.id, <match-rank> LIMIT n
-- DISTINCT ON forces p.id to lead the ORDER BY, so LIMIT sliced the
-- result in UUID order, not match quality: a model_number match could
-- be cut off while uuid-earlier generic keyword matches filled the
-- result. DISTINCT ON was also unnecessary — products appear once in
-- FROM (all array probing happens inside EXISTS). The rank is now
-- computed once per row (LATERAL), and the final ORDER BY is
-- match_rank → popularity BEFORE the LIMIT.
--
-- F2 — unqueried identity columns. enrich-products.mjs populates
-- products.model_numbers (regulatory model numbers: A2251, MR0093,
-- WH-1000XM5 — exactly what OCR reads off labels) and
-- products.ocr_keywords, but the old function never touched either.
--   • model_numbers → tier 1 (alongside the model column), matched by
--     exact case-insensitive equality so short codes can't substring-
--     match into wrong products.
--   • ocr_keywords  → tier 4 (alongside the keywords array).
-- Aliases move above keywords (tier 3): they are curated full product
-- names (incl. Hebrew), more identity-specific than keyword tokens.
--
-- F7 (supporting rule) — brand tokens must not masquerade as name
-- evidence. Catalog names embed the brand ("Logitech G102 Lightsync"),
-- so the token "logitech" used to hit EVERY Logitech product at tier 2
-- (name match) and the brand tier never fired in practice. Tiers 1–4
-- therefore ignore tokens that are substrings of the row's own brand;
-- such tokens can only produce a tier-5 brand match, which the JS
-- weights at 0.55.
--
-- Tiers (match_rank → match_type → JS similarity in api/analyze.js):
--   1  model_number  model col substring OR model_numbers equality  0.92
--   2  ocr_keyword   product name contains token                    0.80
--   3  alias         curated alias contains token                   0.78
--   4  keyword       keywords / ocr_keywords array token            0.72
--   5  brand         brand-only (weakest — demoted by F7)           0.55
-- ══════════════════════════════════════════════════════════════════

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
  SELECT
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
    CASE r.match_rank
      WHEN 1 THEN 'model_number'
      WHEN 2 THEN 'ocr_keyword'
      WHEN 3 THEN 'alias'
      WHEN 4 THEN 'keyword'
      WHEN 5 THEN 'brand'
    END AS match_type
  FROM products p
  CROSS JOIN LATERAL (
    SELECT CASE
      -- Tier 1: model column substring, OR exact (case-insensitive) hit on the
      -- model_numbers array. Equality for model_numbers is deliberate: short
      -- regulatory codes must not substring-match into unrelated products.
      WHEN EXISTS (
             SELECT 1 FROM unnest(p_keywords) kw
             WHERE length(kw) >= 3 AND p.model ILIKE '%' || kw || '%'
               AND (p.brand IS NULL OR p.brand NOT ILIKE '%' || kw || '%')
           )
        OR EXISTS (
             SELECT 1 FROM unnest(p.model_numbers) mn, unnest(p_keywords) kw
             WHERE length(kw) >= 3 AND upper(mn) = upper(kw)
           )
      THEN 1
      -- Tier 2: product name contains an OCR token (brand tokens excluded —
      -- names embed the brand, see header)
      WHEN EXISTS (
             SELECT 1 FROM unnest(p_keywords) kw
             WHERE length(kw) >= 3 AND p.name ILIKE '%' || kw || '%'
               AND (p.brand IS NULL OR p.brand NOT ILIKE '%' || kw || '%')
           )
      THEN 2
      -- Tier 3: curated aliases (full product names, Hebrew names)
      WHEN EXISTS (
             SELECT 1 FROM unnest(p.aliases) pa, unnest(p_keywords) kw
             WHERE length(kw) >= 3 AND pa ILIKE '%' || kw || '%'
               AND (p.brand IS NULL OR p.brand NOT ILIKE '%' || kw || '%')
           )
      THEN 3
      -- Tier 4: keywords or ocr_keywords array tokens
      WHEN EXISTS (
             SELECT 1 FROM unnest(p.keywords) pk, unnest(p_keywords) kw
             WHERE length(kw) >= 3 AND pk ILIKE '%' || kw || '%'
               AND (p.brand IS NULL OR p.brand NOT ILIKE '%' || kw || '%')
           )
        OR EXISTS (
             SELECT 1 FROM unnest(p.ocr_keywords) ok, unnest(p_keywords) kw
             WHERE length(kw) >= 3 AND ok ILIKE '%' || kw || '%'
               AND (p.brand IS NULL OR p.brand NOT ILIKE '%' || kw || '%')
           )
      THEN 4
      -- Tier 5: brand-only. ≥4 chars (the old function's WHERE already
      -- required ≥4 here while its CASE said ≥3 — harmonized to the
      -- stricter bound).
      WHEN EXISTS (
             SELECT 1 FROM unnest(p_keywords) kw
             WHERE length(kw) >= 4 AND p.brand ILIKE '%' || kw || '%'
           )
      THEN 5
      ELSE NULL
    END AS match_rank
  ) r
  WHERE r.match_rank IS NOT NULL
  ORDER BY r.match_rank, p.popularity_score DESC NULLS LAST
  LIMIT p_limit;
$$;

-- Privileges are preserved across CREATE OR REPLACE, but re-grant for
-- idempotence on fresh environments.
GRANT EXECUTE ON FUNCTION match_products_by_ocr(TEXT[], INT) TO anon, authenticated, service_role;
