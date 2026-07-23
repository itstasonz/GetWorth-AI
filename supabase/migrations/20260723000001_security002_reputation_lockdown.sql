-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-002 — Reputation, Trust Score & Seller-Badge Integrity Lockdown
-- Generated: 2026-07-23   Forward-only. Idempotent. Safe to re-run.
--
-- THREAT (reproduced on a disposable Postgres, see tests/security_002_*.test.sql):
--   A normal authenticated user could PATCH their OWN profiles row and set
--   rating, review_count, total_sales, badge, reputation_points, response_rate,
--   is_phone_verified, verification_status, verified_at and backdate created_at.
--   The prior guard (20260518000001) was a BLACKLIST that only reverted
--   is_admin / is_verified (and referenced trust_score / seller_badge columns
--   that DO NOT EXIST in the live schema), so every reputation column that
--   actually feeds the Trust Score (utils.js computeTrustScore) stayed forgeable.
--
-- FIX — two independent, fail-closed ALLOWLIST layers:
--   L1 (primary, loud): column-level UPDATE privileges. `authenticated` may
--       UPDATE only explicitly personal columns; any other column → 42501.
--       A column added in the future is NOT writable unless granted → fail-closed.
--   L2 (defense-in-depth): a BEFORE UPDATE trigger that reconstructs the row
--       from OLD, overlaying ONLY allowlisted personal columns from NEW, so any
--       non-allowlisted change (present or future column) is reverted even if
--       the grant is ever loosened by a later migration. A transaction-local
--       trusted-write flag lets the SECURITY DEFINER recompute functions (the
--       ONLY legitimate writers of rating/review_count/total_sales) through.
--   Trusted server writers (recompute triggers, admin RPCs, service role, the
--   verification Edge Function) run as the table owner / service role and are
--   unaffected by L1, and are exempted from L2 by the flag / admin / NULL-uid.
--
-- Authoritative source-of-truth (unchanged, re-asserted here):
--   rating, review_count   ← reviews (recompute_profile_rating)
--   total_sales            ← completed orders (recompute_profile_total_sales)
--   is_verified/verified_at/verification_status ← admin + verification Edge Fn
--   badge / trust score    ← DERIVED in the client from the above (never stored-trusted)
--
-- Live personal columns a normal user may edit (group A):
--   avatar_url, full_name, location, phone, updated_at
--
-- Rollback: see the ROLLBACK block at the foot of this file.
-- ══════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ══════════════════════════════════════════════════════════════════════════════
-- 0. Preconditions — this migration targets the LIVE profiles schema. Abort loudly
--    if a personal-allowlist column is missing (schema drift would silently widen
--    or narrow the allowlist).
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['avatar_url','full_name','location','phone','updated_at']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name=c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY-002 abort: profiles is missing personal column(s): %', v_missing;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. LAYER 1 — column-level UPDATE privilege allowlist (primary, fail-closed)
--    Remove the blanket table-level UPDATE (which covers every current AND future
--    column) and re-grant UPDATE on ONLY the personal columns.
-- ══════════════════════════════════════════════════════════════════════════════
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT  UPDATE (avatar_url, full_name, location, phone, updated_at)
  ON public.profiles TO authenticated;
-- anon gets no UPDATE at all. SELECT/INSERT grants are left as-is (governed by RLS
-- + the INSERT trigger below).


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. LAYER 2 — BEFORE UPDATE fail-closed allowlist trigger (defense-in-depth)
--    Reconstructs the row from OLD, overlaying only allowlisted personal columns
--    from NEW. Everything else keeps its OLD value. New columns are protected
--    automatically. Trusted recompute writes are let through via a
--    transaction-local flag that clients cannot set (PostgREST never sets app.*).
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.profiles_prevent_privilege_escalation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid;
  v_is_admin   boolean;
  v_allowed    text[] := ARRAY['avatar_url','full_name','location','phone','updated_at'];
  v_patch      jsonb;
  v_reverted   text;
BEGIN
  -- (a) Service role / internal (no JWT) → full trust (migrations, admin ops, Edge Fn).
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- (b) Trusted server recompute path (rating/review_count/total_sales). Only our
  --     SECURITY DEFINER functions set this transaction-local flag; PostgREST
  --     cannot set app.* GUCs, so a client can never reach this branch.
  IF current_setting('app.reputation_trusted_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- (c) Admins (read from the DB row, never the JWT claim) → full trust.
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- (d) Normal user: rebuild NEW = OLD overlaid with ONLY allowlisted keys of NEW.
  --     Any change to any other column (present or future) is reverted.
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    INTO v_patch
  FROM jsonb_each(to_jsonb(NEW))
  WHERE key = ANY(v_allowed);

  -- Observability: warn if the client attempted a protected change (best-effort).
  SELECT string_agg(key, ',') INTO v_reverted
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE NOT (key = ANY(v_allowed))
    AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> key);
  IF v_reverted IS NOT NULL THEN
    RAISE WARNING 'profiles: reverting protected column change(s) [%] attempted by uid=%',
      v_reverted, v_caller;
  END IF;

  NEW := jsonb_populate_record(OLD, v_patch);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_prevent_privilege_escalation_update ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_privilege_escalation_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_prevent_privilege_escalation_update();


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. BEFORE INSERT — force safe reputation defaults on client inserts
--    (references only columns that exist in the live schema).
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.profiles_enforce_safe_defaults_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role / trigger-seeded rows (no JWT) may set anything.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Any authenticated self-insert starts with zero, unearned reputation.
  NEW.is_admin            := false;
  NEW.is_verified         := false;
  NEW.is_phone_verified   := false;
  NEW.rating              := 0;
  NEW.review_count        := 0;
  NEW.total_sales         := 0;
  NEW.badge               := NULL;
  NEW.reputation_points   := 0;
  NEW.response_rate       := NULL;
  NEW.verification_status := NULL;
  NEW.verified_at         := NULL;
  NEW.created_at          := now();   -- cannot backdate account age
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_enforce_safe_defaults_insert ON public.profiles;
CREATE TRIGGER trg_profiles_enforce_safe_defaults_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_enforce_safe_defaults_insert();


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Trusted recompute functions — recompute-from-source, flagged so L2 lets them
--    through. Also (re)assert their triggers so the machinery is present even if
--    20260718000002 / 20260719000001 were not applied. Logic is otherwise
--    identical to those migrations.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recompute_profile_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_subject uuid;
BEGIN
  v_subject := COALESCE(NEW.seller_id, OLD.seller_id);
  PERFORM set_config('app.reputation_trusted_write', '1', true);
  UPDATE profiles p
  SET rating       = COALESCE((SELECT round(avg(r.rating)::numeric, 1)
                               FROM reviews r WHERE r.seller_id = v_subject), 0),
      review_count = (SELECT count(*)::int
                      FROM reviews r WHERE r.seller_id = v_subject)
  WHERE p.id = v_subject;
  PERFORM set_config('app.reputation_trusted_write', '', true);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_recompute_rating ON public.reviews;
CREATE TRIGGER trg_reviews_recompute_rating
  AFTER INSERT OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.recompute_profile_rating();

CREATE OR REPLACE FUNCTION public.recompute_profile_total_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seller uuid;
BEGIN
  v_seller := COALESCE(NEW.seller_id, OLD.seller_id);
  PERFORM set_config('app.reputation_trusted_write', '1', true);
  UPDATE profiles p
  SET total_sales = (SELECT count(*)::int
                     FROM orders o
                     WHERE o.seller_id = v_seller AND o.status = 'completed')
  WHERE p.id = v_seller;
  PERFORM set_config('app.reputation_trusted_write', '', true);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_recompute_total_sales ON public.orders;
CREATE TRIGGER trg_orders_recompute_total_sales
  AFTER INSERT OR DELETE OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.recompute_profile_total_sales();


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. Reconciliation backfill — heal any values a client forged while the hole was
--    open. Runs as the migration role (service) → exempt from the guards. Small
--    table (profiles); single-pass, no batching required.
-- ══════════════════════════════════════════════════════════════════════════════
-- 5a. rating / review_count ← reviews
UPDATE profiles p
SET rating       = COALESCE(agg.avg_rating, 0),
    review_count = COALESCE(agg.cnt, 0)
FROM (
  -- LEFT JOIN yields NULL review rows for profiles with no reviews; avg() and
  -- count(r.id) both skip NULLs, so no FILTER is needed.
  SELECT pr.id,
         round(avg(r.rating)::numeric, 1) AS avg_rating,
         count(r.id)::int                 AS cnt
  FROM profiles pr
  LEFT JOIN reviews r ON r.seller_id = pr.id
  GROUP BY pr.id
) agg
WHERE p.id = agg.id
  AND (p.rating       IS DISTINCT FROM COALESCE(agg.avg_rating, 0)
    OR p.review_count IS DISTINCT FROM COALESCE(agg.cnt, 0));

-- 5b. total_sales ← completed orders
UPDATE profiles p
SET total_sales = agg.cnt
FROM (
  SELECT pr.id, count(o.id) FILTER (WHERE o.status = 'completed')::int AS cnt
  FROM profiles pr
  LEFT JOIN orders o ON o.seller_id = pr.id
  GROUP BY pr.id
) agg
WHERE p.id = agg.id
  AND COALESCE(p.total_sales, 0) IS DISTINCT FROM agg.cnt;

-- NOTE: badge, reputation_points and response_rate have no authoritative
-- server-side maintainer and do NOT feed the client Trust Score (which derives
-- the badge from rating/review_count/total_sales/is_verified/created_at). They
-- are now locked (cannot be client-written) but pre-existing values are left
-- intact to avoid destroying data. See "Remaining risks" in the report.


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. VERIFY — run after applying (expected results in comments)
-- ══════════════════════════════════════════════════════════════════════════════
-- 6a. authenticated may UPDATE only the 5 personal columns:
--   SELECT column_name FROM information_schema.column_privileges
--   WHERE table_name='profiles' AND grantee='authenticated' AND privilege_type='UPDATE'
--   ORDER BY 1;
--   → avatar_url, full_name, location, phone, updated_at   (exactly these 5)
-- 6b. anon has no UPDATE on profiles → 0 rows for grantee='anon'.
-- 6c. Triggers present:
--   SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
--     AND tgname LIKE 'trg_profiles_%';   → 2 rows
-- 6d. Aggregate integrity (no forged rows remain):
--   SELECT p.id FROM profiles p
--   WHERE p.review_count <> (SELECT count(*) FROM reviews r WHERE r.seller_id=p.id)
--      OR p.total_sales  <> (SELECT count(*) FROM orders o
--                            WHERE o.seller_id=p.id AND o.status='completed');
--   → 0 rows

-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   GRANT UPDATE ON public.profiles TO authenticated;        -- restores old (unsafe) breadth
--   DROP TRIGGER  IF EXISTS trg_profiles_prevent_privilege_escalation_update ON public.profiles;
--   DROP TRIGGER  IF EXISTS trg_profiles_enforce_safe_defaults_insert       ON public.profiles;
--   -- (recompute functions can keep the trusted-write flag harmlessly.)
-- ══════════════════════════════════════════════════════════════════════════════
