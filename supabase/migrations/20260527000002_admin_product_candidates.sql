-- ══════════════════════════════════════════════════════════════
-- Admin RPCs + trust criteria for product_candidates
-- ══════════════════════════════════════════════════════════════
-- Phase 7: Admin review workflow + Phase 3 approval safeguards
--
-- Changes:
--   1. confirmed_by uuid[] on product_candidates
--      Tracks distinct user IDs that confirmed the same item.
--      Used by trust criteria (>= 2 distinct confirmers required).
--
--   2. Updated submit_product_candidate — append caller to confirmed_by
--      (idempotent: same user never counted twice)
--
--   3. candidate_meets_trust_criteria(p_id) → boolean
--      True when candidate qualifies for admin-assisted approval.
--
--   4. Admin RPCs — caller identity from auth.uid() (never a parameter):
--        admin_list_product_candidates(p_status, p_limit, p_offset)
--        admin_approve_product_candidate(p_candidate_id)
--        admin_reject_product_candidate(p_candidate_id, p_reason)
--        admin_promote_candidate_to_product(p_candidate_id, prices...)
--
-- Auth design:
--   • Caller is always auth.uid() — the JWT sub verified by PostgREST.
--   • is_admin is read from profiles DB row, never from JWT claims.
--   • Functions are SECURITY DEFINER so they can bypass RLS on product_candidates,
--     but they enforce their own admin gate before doing anything.
--   • Client never passes a user ID — the DB derives it.
-- ══════════════════════════════════════════════════════════════

-- ── 1. confirmed_by column ─────────────────────────────────────
ALTER TABLE public.product_candidates
  ADD COLUMN IF NOT EXISTS confirmed_by uuid[] NOT NULL DEFAULT '{}';

-- GIN index for array containment queries
CREATE INDEX IF NOT EXISTS idx_pc_confirmed_by
  ON public.product_candidates USING GIN (confirmed_by);

-- ── 2. Updated submit_product_candidate — track confirmed_by ───
-- Signature unchanged (still called server-side with service key +
-- verified p_caller_id from API route JWT check).
-- Adds confirmed_by tracking to both INSERT and UPDATE paths.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_product_candidate(
  p_caller_id    uuid,
  p_name         text,
  p_brand        text    DEFAULT NULL,
  p_model        text    DEFAULT NULL,
  p_category     text    DEFAULT NULL,
  p_subcategory  text    DEFAULT NULL,
  p_product_type text    DEFAULT NULL,
  p_ocr_text     text    DEFAULT NULL,
  p_confidence   numeric DEFAULT NULL,
  p_source       text    DEFAULT 'ocr_label',
  p_image_path   text    DEFAULT NULL,
  p_metadata     jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id   uuid;
  v_new_count     integer;
  v_resolved_name text;
  v_resolved_src  text;
BEGIN
  -- ① Require authenticated caller
  IF p_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- ② Resolve name — NOT NULL constraint requires a value
  v_resolved_name := COALESCE(
    NULLIF(trim(p_name), ''),
    CASE
      WHEN p_brand IS NOT NULL AND p_model IS NOT NULL
        THEN trim(p_brand) || ' ' || trim(p_model)
      WHEN p_brand IS NOT NULL THEN trim(p_brand)
      WHEN p_model IS NOT NULL THEN trim(p_model)
      ELSE NULL
    END
  );

  IF v_resolved_name IS NULL THEN
    RAISE EXCEPTION 'Candidate must include at least name, brand, or model'
      USING ERRCODE = '22023';
  END IF;

  -- ③ Validate source
  v_resolved_src := COALESCE(p_source, 'ocr_label');
  IF v_resolved_src NOT IN ('ocr_label', 'visual', 'manual_correction', 'db_missing') THEN
    v_resolved_src := 'ocr_label';
  END IF;

  -- ④ Duplicate detection: same lower(name) OR lower(brand)+lower(model)
  SELECT id INTO v_existing_id
  FROM public.product_candidates
  WHERE status IN ('pending', 'approved')
    AND (
      lower(name) = lower(v_resolved_name)
      OR (
        p_brand IS NOT NULL AND p_model IS NOT NULL
        AND lower(brand) = lower(p_brand)
        AND lower(model) = lower(p_model)
      )
    )
  LIMIT 1;

  -- ⑤ Duplicate → increment + append caller to confirmed_by (idempotent)
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.product_candidates
       SET occurrence_count = occurrence_count + 1,
           updated_at       = now(),
           confirmed_by = CASE
             WHEN p_caller_id = ANY(confirmed_by) THEN confirmed_by
             ELSE array_append(confirmed_by, p_caller_id)
           END
     WHERE id = v_existing_id
    RETURNING occurrence_count INTO v_new_count;

    RETURN jsonb_build_object(
      'status',           'deduplicated',
      'candidate_id',     v_existing_id,
      'occurrence_count', v_new_count
    );
  END IF;

  -- ⑥ New candidate → insert (confirmed_by seeds with the creator)
  INSERT INTO public.product_candidates (
    created_by, name, brand, model, category, subcategory, product_type,
    ocr_text, confidence, source, image_path, metadata, status,
    occurrence_count, confirmed_by
  )
  VALUES (
    p_caller_id,
    v_resolved_name,
    NULLIF(trim(p_brand), ''),
    NULLIF(trim(p_model), ''),
    NULLIF(trim(p_category), ''),
    NULLIF(trim(p_subcategory), ''),
    NULLIF(trim(p_product_type), ''),
    p_ocr_text,
    p_confidence,
    v_resolved_src,
    NULLIF(trim(p_image_path), ''),
    COALESCE(p_metadata, '{}'::jsonb),
    'pending',
    1,
    ARRAY[p_caller_id]
  )
  RETURNING id INTO v_existing_id;

  RETURN jsonb_build_object(
    'status',           'created',
    'candidate_id',     v_existing_id,
    'occurrence_count', 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_product_candidate TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_product_candidate TO service_role;

-- ── 3. candidate_meets_trust_criteria — read-only helper ───────
-- Evaluates all Phase 3-B rules server-side. Admin UI queries this
-- to flag which pending candidates are ready for approval.
-- Does NOT auto-approve — every approval requires an admin action.
--
-- Rules:
--   • occurrence_count >= 3
--   • array_length(confirmed_by, 1) >= 2   (at least 2 distinct users)
--   • confidence >= 0.70
--   • source IN ('ocr_label', 'manual_correction')  — no visual-only
--   • status = 'pending'
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.candidate_meets_trust_criteria(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT
      occurrence_count >= 3
      AND array_length(confirmed_by, 1) >= 2
      AND COALESCE(confidence, 0) >= 0.70
      AND source IN ('ocr_label', 'manual_correction')
      AND status = 'pending'
    FROM public.product_candidates
    WHERE id = p_id
  ), false)
$$;

GRANT EXECUTE ON FUNCTION public.candidate_meets_trust_criteria TO authenticated;
GRANT EXECUTE ON FUNCTION public.candidate_meets_trust_criteria TO service_role;

-- ══════════════════════════════════════════════════════════════
-- 4. Admin RPCs — auth.uid() pattern
--
-- All four functions below:
--   • Read caller from auth.uid() (never accept user ID as param)
--   • Check is_admin from profiles DB row (never from JWT claims)
--   • Log v_caller_id in metadata for the audit trail
--   • Are SECURITY DEFINER to bypass RLS on product_candidates
--
-- DROP old signatures first (p_admin_id was first param in the
-- draft version).  DROP IF EXISTS is safe / idempotent on a fresh DB.
-- ══════════════════════════════════════════════════════════════

-- Drop any draft signatures that included p_admin_id as first param
DROP FUNCTION IF EXISTS public.admin_list_product_candidates(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_approve_product_candidate(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_reject_product_candidate(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.admin_promote_candidate_to_product(uuid, uuid, numeric, numeric, numeric, numeric, text, text);

-- ── 4a. admin_list_product_candidates ─────────────────────────
-- Returns candidates with trust-criteria flag per row.
-- p_status: 'pending' | 'approved' | 'rejected' | 'merged' | 'all'
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_product_candidates(
  p_status text    DEFAULT 'pending',
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  created_at       timestamptz,
  created_by       uuid,
  brand            text,
  model            text,
  name             text,
  category         text,
  subcategory      text,
  source           text,
  status           text,
  occurrence_count integer,
  confirmed_by     uuid[],
  confidence       numeric,
  image_path       text,
  metadata         jsonb,
  meets_trust      boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.profiles WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pc.id,
    pc.created_at,
    pc.created_by,
    pc.brand,
    pc.model,
    pc.name,
    pc.category,
    pc.subcategory,
    pc.source,
    pc.status,
    pc.occurrence_count,
    pc.confirmed_by,
    pc.confidence,
    pc.image_path,
    pc.metadata,
    public.candidate_meets_trust_criteria(pc.id) AS meets_trust
  FROM public.product_candidates pc
  WHERE (p_status = 'all' OR pc.status = p_status)
  ORDER BY pc.occurrence_count DESC, pc.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_product_candidates TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_product_candidates TO service_role;

-- ── 4b. admin_approve_product_candidate ───────────────────────
-- pending → approved.
-- Approved candidates enter live retrieval (Strategy 9).
-- Does NOT promote to products — use admin_promote_candidate_to_product.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_approve_product_candidate(
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
  v_name      text;
  v_status    text;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.profiles WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT name, status INTO v_name, v_status
  FROM public.product_candidates
  WHERE id = p_candidate_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Candidate not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Candidate is already % — only pending candidates can be approved', v_status
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.product_candidates
     SET status     = 'approved',
         updated_at = now(),
         metadata   = COALESCE(metadata, '{}')
           || jsonb_build_object(
               'approved_by', v_caller_id::text,
               'approved_at', now()::text
             )
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'status',       'approved',
    'candidate_id', p_candidate_id,
    'name',         v_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_product_candidate TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_product_candidate TO service_role;

-- ── 4c. admin_reject_product_candidate ────────────────────────

CREATE OR REPLACE FUNCTION public.admin_reject_product_candidate(
  p_candidate_id uuid,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin  boolean;
  v_name      text;
  v_status    text;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.profiles WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT name, status INTO v_name, v_status
  FROM public.product_candidates
  WHERE id = p_candidate_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Candidate not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('rejected', 'merged') THEN
    RAISE EXCEPTION 'Candidate is already % — cannot reject', v_status
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.product_candidates
     SET status     = 'rejected',
         updated_at = now(),
         metadata   = COALESCE(metadata, '{}')
           || jsonb_build_object(
               'rejected_by',    v_caller_id::text,
               'rejected_at',    now()::text,
               'reject_reason',  COALESCE(p_reason, 'admin decision')
             )
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'status',       'rejected',
    'candidate_id', p_candidate_id,
    'name',         v_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reject_product_candidate TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_product_candidate TO service_role;

-- ── 4d. admin_promote_candidate_to_product ────────────────────
-- Inserts candidate into products with admin-provided prices.
-- Sets candidate status = 'merged', matched_product_id = new product id.
-- Requires price data — promotion without pricing is refused.
-- Returns: { status, product_id, candidate_id, name }
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_promote_candidate_to_product(
  p_candidate_id  uuid,
  p_price_low     numeric DEFAULT NULL,
  p_price_mid     numeric DEFAULT NULL,
  p_price_high    numeric DEFAULT NULL,
  p_retail_price  numeric DEFAULT NULL,
  p_name_override text    DEFAULT NULL,
  p_notes         text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      uuid;
  v_is_admin       boolean;
  v_cand           public.product_candidates%ROWTYPE;
  v_new_product_id uuid;
  v_resolved_name  text;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM public.profiles WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  -- Price data required — never promote an unpriced item
  IF p_price_mid IS NULL AND p_price_low IS NULL THEN
    RAISE EXCEPTION 'Price data required for promotion (provide p_price_mid or p_price_low)'
      USING ERRCODE = '22023';
  END IF;

  -- Load candidate
  SELECT * INTO v_cand FROM public.product_candidates WHERE id = p_candidate_id;
  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'Candidate not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cand.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Candidate is % — only pending/approved candidates can be promoted', v_cand.status
      USING ERRCODE = '55000';
  END IF;

  -- Resolve product name
  v_resolved_name := COALESCE(NULLIF(trim(p_name_override), ''), v_cand.name);

  -- Insert into products
  INSERT INTO public.products (
    name,
    brand,
    model,
    category,
    subcategory,
    avg_used_price_ils,
    price_low_ils,
    price_high_ils,
    retail_price_ils,
    price_source,
    price_updated_at,
    popularity_score,
    scan_count,
    keywords
  )
  VALUES (
    v_resolved_name,
    v_cand.brand,
    v_cand.model,
    v_cand.category,
    v_cand.subcategory,
    COALESCE(p_price_mid, (COALESCE(p_price_low, 0) + COALESCE(p_price_high, 0)) / 2.0),
    p_price_low,
    p_price_high,
    p_retail_price,
    'admin_promotion',
    now(),
    COALESCE(v_cand.occurrence_count, 1),
    0,
    ARRAY[]::text[]
  )
  RETURNING id INTO v_new_product_id;

  -- Mark candidate as merged
  UPDATE public.product_candidates
     SET status             = 'merged',
         matched_product_id = v_new_product_id,
         updated_at         = now(),
         metadata           = COALESCE(metadata, '{}')
           || jsonb_build_object(
               'promoted_by',    v_caller_id::text,
               'promoted_at',    now()::text,
               'promote_notes',  COALESCE(p_notes, '')
             )
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'status',       'promoted',
    'product_id',   v_new_product_id,
    'candidate_id', p_candidate_id,
    'name',         v_resolved_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_promote_candidate_to_product TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_promote_candidate_to_product TO service_role;
