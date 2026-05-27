-- ══════════════════════════════════════════════════════════════
-- product_candidates — staging table for items not found in DB
-- ══════════════════════════════════════════════════════════════
-- Purpose: when a scan returns 0 DB candidates but Stage 1 has
-- useful recognition data, the user-confirmed result lands here.
-- Admins later approve → products, merge, or reject.
-- NEVER auto-insert into products from raw AI output.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_candidates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  source_scan_id      uuid        REFERENCES valuations(id)  ON DELETE SET NULL,
  brand               text,
  model               text,
  name                text,
  category            text,
  subcategory         text,
  product_type        text,
  ocr_text            text,
  confidence          numeric,
  source              text CHECK (source IN ('ocr_label', 'visual', 'manual_correction')),
  image_url           text,
  correction_text     text,
  status              text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  matched_product_id  uuid,       -- set by admin on merge/approve
  metadata            jsonb       NOT NULL DEFAULT '{}',
  occurrence_count    integer     NOT NULL DEFAULT 1
);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS set_product_candidates_updated_at ON product_candidates;
CREATE TRIGGER set_product_candidates_updated_at
  BEFORE UPDATE ON product_candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_pc_status        ON product_candidates(status);
CREATE INDEX IF NOT EXISTS idx_pc_brand         ON product_candidates(lower(brand));
CREATE INDEX IF NOT EXISTS idx_pc_category      ON product_candidates(lower(category));
CREATE INDEX IF NOT EXISTS idx_pc_created_by    ON product_candidates(created_by);

-- ── Row Level Security ──
ALTER TABLE product_candidates ENABLE ROW LEVEL SECURITY;

-- Authenticated users: insert their own candidates
CREATE POLICY "users_can_insert_own_candidates"
  ON product_candidates FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Authenticated users: select their own candidates
CREATE POLICY "users_can_select_own_candidates"
  ON product_candidates FOR SELECT
  USING (auth.uid() = created_by);

-- Admins: full access
CREATE POLICY "admins_full_access_candidates"
  ON product_candidates FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );
