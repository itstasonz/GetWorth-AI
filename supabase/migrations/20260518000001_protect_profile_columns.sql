-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — Profile Column Protection
-- Generated: 2026-05-18
-- DO NOT run blindly. Read every WARNING before executing.
-- Apply in Supabase Dashboard → SQL Editor.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- What this migration does:
--   1. Consolidates duplicate profiles SELECT policies into one clean public policy.
--   2. Adds a BEFORE UPDATE trigger that silently reverts any attempt by a normal
--      user to modify: is_admin, is_verified, trust_score, seller_badge.
--      Service role (used by admin operations) is exempt.
--   3. Adds a BEFORE INSERT trigger that unconditionally forces safe defaults
--      for the same four columns on every new profile row, regardless of what
--      the client sends. Service role is exempt (admin seeding, migrations).
--
-- Protected columns (UPDATE + INSERT):
--   is_admin        — privilege escalation (user cannot self-grant admin)
--   is_verified     — trust signal (must be set by admin only)
--   trust_score     — computed reputation (must come from backend logic)
--   seller_badge    — earned badge (must come from backend logic)
--
-- NOT protected (intentionally left writable by client):
--   verification_photo_url  — written by requestVerification() in AppContext.jsx
--   verification_photo_path — written by requestVerification() in AppContext.jsx
--   verification_status     — written by requestVerification() in AppContext.jsx
--
-- Admin exemption mechanism:
--   Both triggers check auth.uid() IS NULL. When Supabase Admin operations
--   use the service role key they run with a NULL JWT uid — the trigger
--   returns NEW unchanged, allowing full column writes.
--   The UPDATE trigger also reads is_admin from the DB (not the JWT claim)
--   to prevent a compromised token from bypassing the admin check.
--
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. PROFILES SELECT — consolidate duplicate policies
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Profiles are a public marketplace entity. Full_name, avatar_url, rating,
-- seller_badge, and is_verified are intentionally readable by everyone.
-- The app reads other users' profiles for seller cards, chat headers,
-- order details, and FK joins on listings and conversations.
--
-- We collapse whatever combination of SELECT policies currently exist into
-- exactly ONE policy: USING (true).

-- Drop all known variants (actual names observed in pg_policies).
DROP POLICY IF EXISTS "Users can view their own profile"       ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Profiles are publicly readable"         ON profiles;
DROP POLICY IF EXISTS "Anyone can read profiles"               ON profiles;
DROP POLICY IF EXISTS "profiles_select_public"                 ON profiles;

-- Idempotency — drop target name before creating.
DROP POLICY IF EXISTS "profiles_select_public" ON profiles;

CREATE POLICY "profiles_select_public"
  ON profiles
  FOR SELECT
  USING (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. BEFORE UPDATE trigger — protect privilege columns
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION profiles_prevent_privilege_escalation_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id  uuid;
  v_is_admin   boolean;
BEGIN
  -- Service role runs with no JWT → auth.uid() returns NULL.
  -- Exempt service role entirely so admin operations (approve verification,
  -- set seller_badge via cron, etc.) are not blocked.
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Read is_admin from the DB row, not from the JWT claim.
  -- This prevents a user with a manipulated token from bypassing the check.
  SELECT is_admin INTO v_is_admin
  FROM profiles
  WHERE id = v_caller_id;

  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- For non-admin authenticated callers, silently revert any attempt
  -- to change the four protected columns. The UPDATE is not rejected —
  -- it succeeds but those fields stay at their current DB value.
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE WARNING
      'profiles: reverting is_admin change attempted by uid=%', v_caller_id;
    NEW.is_admin := OLD.is_admin;
  END IF;

  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
    RAISE WARNING
      'profiles: reverting is_verified change attempted by uid=%', v_caller_id;
    NEW.is_verified := OLD.is_verified;
  END IF;

  IF NEW.trust_score IS DISTINCT FROM OLD.trust_score THEN
    RAISE WARNING
      'profiles: reverting trust_score change attempted by uid=%', v_caller_id;
    NEW.trust_score := OLD.trust_score;
  END IF;

  IF NEW.seller_badge IS DISTINCT FROM OLD.seller_badge THEN
    RAISE WARNING
      'profiles: reverting seller_badge change attempted by uid=%', v_caller_id;
    NEW.seller_badge := OLD.seller_badge;
  END IF;

  RETURN NEW;
END;
$$;

-- Idempotency — drop before re-creating.
DROP TRIGGER IF EXISTS trg_profiles_prevent_privilege_escalation_update ON profiles;

CREATE TRIGGER trg_profiles_prevent_privilege_escalation_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION profiles_prevent_privilege_escalation_update();


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. BEFORE INSERT trigger — enforce safe defaults on new profiles
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Without this, a client can INSERT a profile row with is_admin=true in the
-- payload. The UPDATE trigger above would not fire on INSERT.
-- This trigger unconditionally overwrites the four privilege columns with safe
-- defaults for any authenticated insert. Service role is exempt.

CREATE OR REPLACE FUNCTION profiles_enforce_safe_defaults_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role (auth.uid() IS NULL) may seed admin accounts or run migrations.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Unconditionally force safe values regardless of what the client sent.
  NEW.is_admin     := false;
  NEW.is_verified  := false;
  NEW.trust_score  := COALESCE(NEW.trust_score, 0);   -- keep 0 (safe), never allow positive
  NEW.seller_badge := NULL;

  -- Clamp trust_score: even if the column default is 0 and client sends 0,
  -- overwrite to guarantee it cannot be positive on INSERT.
  IF NEW.trust_score <> 0 THEN
    RAISE WARNING
      'profiles: forcing trust_score=0 on INSERT (client sent %)', NEW.trust_score;
    NEW.trust_score := 0;
  END IF;

  RETURN NEW;
END;
$$;

-- Idempotency — drop before re-creating.
DROP TRIGGER IF EXISTS trg_profiles_enforce_safe_defaults_insert ON profiles;

CREATE TRIGGER trg_profiles_enforce_safe_defaults_insert
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION profiles_enforce_safe_defaults_insert();


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. VERIFY — run after applying all changes
-- ══════════════════════════════════════════════════════════════════════════════

-- 4a. Confirm exactly one SELECT policy on profiles.
SELECT policyname, cmd, qual AS using_expr
FROM pg_policies
WHERE tablename = 'profiles' AND cmd = 'SELECT'
ORDER BY policyname;
-- Expected: one row — "profiles_select_public" with qual = 'true'

-- 4b. Confirm both triggers exist.
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'profiles'::regclass
  AND tgname IN (
    'trg_profiles_prevent_privilege_escalation_update',
    'trg_profiles_enforce_safe_defaults_insert'
  );
-- Expected: two rows, tgenabled = 'O' (origin) meaning active

-- 4c. Smoke-test UPDATE guard (run as a normal user, not service role).
--     Replace '<your-user-uuid>' with a real non-admin profile id.
--     The UPDATE should succeed (200) but is_admin must remain false afterward.
--
-- UPDATE profiles SET is_admin = true WHERE id = '<your-user-uuid>';
-- SELECT id, is_admin, is_verified, trust_score, seller_badge
-- FROM profiles WHERE id = '<your-user-uuid>';
-- Expected: is_admin = false (trigger reverted it silently)

-- 4d. Smoke-test INSERT guard.
--     Insert a row with privileged values. Verify they are forced to safe defaults.
--
-- INSERT INTO profiles (id, full_name, is_admin, is_verified, trust_score, seller_badge)
-- VALUES (gen_random_uuid(), 'Test User', true, true, 99, 'gold');
-- SELECT is_admin, is_verified, trust_score, seller_badge
-- FROM profiles ORDER BY created_at DESC LIMIT 1;
-- Expected: false, false, 0, NULL
-- (Clean up: DELETE FROM profiles WHERE full_name = 'Test User';)
