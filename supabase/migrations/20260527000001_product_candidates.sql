-- ══════════════════════════════════════════════════════════════
-- product_candidates — staging table for items not found in DB
-- ══════════════════════════════════════════════════════════════
-- Purpose: when a scan returns 0 DB candidates but Stage 1 has
-- useful recognition data, the user-confirmed result lands here.
-- Admins later approve → products, merge, or reject.
-- NEVER auto-insert into products from raw AI output.
-- ══════════════════════════════════════════════════════════════

-- ── Table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_candidates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  created_by          uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  brand               text,
  model               text,
  name                text        NOT NULL,

  category            text,
  subcategory         text,
  product_type        text,

  ocr_text            text,
  confidence          numeric,

  source              text        NOT NULL
                        CHECK (source IN (
                          'ocr_label',
                          'visual',
                          'manual_correction',
                          'db_missing'
                        )),

  status              text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',
                          'approved',
                          'rejected',
                          'merged'
                        )),

  matched_product_id  uuid        NULL REFERENCES public.products(id) ON DELETE SET NULL,

  occurrence_count    integer     NOT NULL DEFAULT 1,

  image_path          text,

  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- ── Updated-at trigger ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_product_candidates_updated_at ON public.product_candidates;
CREATE TRIGGER set_product_candidates_updated_at
  BEFORE UPDATE ON public.product_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pc_name        ON public.product_candidates(lower(name));
CREATE INDEX IF NOT EXISTS idx_pc_brand       ON public.product_candidates(lower(brand));
CREATE INDEX IF NOT EXISTS idx_pc_model       ON public.product_candidates(lower(model));
CREATE INDEX IF NOT EXISTS idx_pc_status      ON public.product_candidates(status);
CREATE INDEX IF NOT EXISTS idx_pc_category    ON public.product_candidates(lower(category));
CREATE INDEX IF NOT EXISTS idx_pc_created_by  ON public.product_candidates(created_by);
CREATE INDEX IF NOT EXISTS idx_pc_created_at  ON public.product_candidates(created_at);

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE public.product_candidates ENABLE ROW LEVEL SECURITY;

-- Authenticated users: insert their own candidates only
CREATE POLICY "users_can_insert_own_candidates"
  ON public.product_candidates FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = created_by);

-- Authenticated users: select their own candidates only
CREATE POLICY "users_can_select_own_candidates"
  ON public.product_candidates FOR SELECT
  USING (auth.uid() = created_by);

-- Admins: full access — reads is_admin from DB row, never JWT claims
CREATE POLICY "admins_full_access_candidates"
  ON public.product_candidates FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- ══════════════════════════════════════════════════════════════
-- RPC: submit_product_candidate
-- ══════════════════════════════════════════════════════════════
-- Called server-side (API route with service key).
-- Caller must pass the verified user ID from a JWT check.
-- Deduplicates by lower(name) OR lower(brand)+lower(model).
-- Returns: { status, candidate_id, occurrence_count }
-- ══════════════════════════════════════════════════════════════

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
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
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

  -- ④ Duplicate detection:
  --    same lower(name)
  --    OR same lower(brand) + lower(model) when both are provided
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

  -- ⑤ Duplicate → increment and return
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.product_candidates
       SET occurrence_count = occurrence_count + 1,
           updated_at       = now()
     WHERE id = v_existing_id
    RETURNING occurrence_count INTO v_new_count;

    RETURN jsonb_build_object(
      'status',           'deduplicated',
      'candidate_id',     v_existing_id,
      'occurrence_count', v_new_count
    );
  END IF;

  -- ⑥ New candidate → insert
  INSERT INTO public.product_candidates (
    created_by,
    name,
    brand,
    model,
    category,
    subcategory,
    product_type,
    ocr_text,
    confidence,
    source,
    image_path,
    metadata,
    status,
    occurrence_count
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
    1
  )
  RETURNING id INTO v_existing_id;

  RETURN jsonb_build_object(
    'status',           'created',
    'candidate_id',     v_existing_id,
    'occurrence_count', 1
  );
END;
$$;

-- Grant execute to authenticated users (even though it's called via service key)
GRANT EXECUTE ON FUNCTION public.submit_product_candidate TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_product_candidate TO service_role;
