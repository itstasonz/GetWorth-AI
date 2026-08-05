-- ══════════════════════════════════════════════════════════════════════════════
-- VAL-001 — valuations authoritative-column freeze + insert provenance
-- Generated: 2026-07-30   Forward-only. Idempotent. Safe to re-run.
--
-- THREAT — a documented invariant that is already false.
--
--   api/confirm-identity.js:9-13 states the anti-forgery contract of the whole
--   Recognition Memory layer:
--
--     "Anti-forgery by construction: the client sends ONLY a valuation_id.
--      Brand / model / category / canonical key are derived server-side from
--      the persisted valuation (which the pipeline wrote with the service
--      role) — a user can only confirm what the pipeline actually told them,
--      never a fabricated identity."
--
--   The parenthetical is load-bearing and it is not true. RLS on valuations
--   (20260607000001) is ownership-only — SELECT/INSERT/UPDATE/DELETE all gated
--   on user_id = auth.uid(), with no column restriction of any kind, no
--   column-level GRANT allowlist and no trigger. So a normal authenticated user
--   can do both of these through PostgREST:
--
--     (a) PATCH a row they own and rewrite ai_raw_response, ai_name,
--         ai_name_hebrew, ai_category, ai_confidence, scan_uuid and every price
--         column.
--     (b) INSERT a wholly fabricated valuation with a uuid of their choosing.
--         src/contexts/AppContext.jsx:2040-2065 (backupValuation) is a
--         client-COMPOSED full-row upsert; RLS is satisfied by user_id =
--         auth.uid() and nothing checks where the content came from.
--
--   Why that reaches other users: api/confirm-identity.js:155-175 loads the
--   caller's own valuation and derives the memory identity from exactly those
--   forgeable fields (brand/model come out of ai_raw_response), then calls
--   memory_record_confirmation — THE single row-creating path into the shared,
--   cross-user recognition_memory table (20260707000001:301-347, reworked in
--   20260716000001:83-150). A forged row therefore lets one account create an
--   arbitrary memory row under any canonical key, plant that key's display name
--   (first non-NULL wins via COALESCE, 20260716000001:121-122), and inflate
--   confirmation_count — which is precisely the "human-trusted" gate that
--   authorises price samples to be appended to a shared row
--   (api/analyze.js:3273-3299).
--
--   SEVERITY, STATED HONESTLY: recognition memory is still in SHADOW. memoryRow
--   is read at api/analyze.js:3094-3113 and feeds only memoryDebug and the
--   sample-write gate — it reaches no prompt and no price. The damage is
--   STORED, not yet SERVED. This is a fix-before-Phase-2 blocker, not a live
--   user-facing exploit. Per lead decision D10 this migration performs NO
--   production data reconciliation: pre-fix memory rows are accepted as
--   unaudited and PRICING-002 will gate on distinct_user_count before memory
--   leaves shadow.
--
-- FIX — three fail-closed layers, reusing the SECURITY-002 shape verbatim
-- (20260723000001 sections 1-3):
--   L1  Column-level UPDATE privileges. `authenticated` may UPDATE only the four
--       genuine annotation columns; any other column raises 42501. A column
--       added in future is NOT writable unless explicitly granted → fail-closed
--       by construction.
--   L2  BEFORE UPDATE trigger that rebuilds the row from OLD overlaid with only
--       allowlisted keys of NEW, so a non-allowlisted change is reverted even if
--       the grant is ever loosened. Plus one valuations-specific clamp the
--       profiles version does not need: a non-trusted caller may only ever move
--       identified_by TO 'user_confirmed'.
--   L3  New `origin` column plus a BEFORE INSERT trigger that stamps
--       'client_backup' on any insert carrying a user JWT. record_scan runs as
--       service_role with auth.uid() NULL, so pipeline rows keep 'server'; the
--       client cannot override the stamp. This is what actually closes the
--       cross-user channel: api/confirm-identity.js can then require
--       origin = 'server' before seeding shared memory.
--
--   ACCEPTED TRADE-OFF (lead decision D12): a scan that genuinely fell back to
--   the client backup path — server persistence failed all three attempts,
--   api/analyze.js:2145-2160 — loses its ability to contribute a memory
--   confirmation. The user keeps the scan in their history; only the shadow
--   memory contribution is dropped. That is the fail-closed direction. Removing
--   the client insert path altogether is cleaner and is an API change, not a
--   migration; it is recorded as a follow-up.
--
-- Columns the client legitimately UPDATEs — exhaustive, every
-- `.from('valuations').update(` in src/:
--   user_confirmed  src/contexts/AppContext.jsx:2436, :2490
--   user_correction src/contexts/AppContext.jsx:2436
--   identified_by   src/contexts/AppContext.jsx:2490   (only ever 'user_confirmed')
--   listing_id      src/contexts/AppContext.jsx:3125
--
-- Authoritative columns being frozen — the record_scan insert list
-- (20260701120000:87-116), which is also what api/analyze.js:3238-3260 builds:
--   id, user_id, scan_uuid, valuation_version, product_id, ai_name,
--   ai_name_hebrew, ai_category, ai_confidence, ai_raw_response, ocr_text,
--   model_number, alternatives, price_low, price_mid, price_high, new_retail,
--   price_method, comp_count, lang  (+ created_at, + anything added later)
--
-- LOCKING NOTE: section 2 runs ALTER TABLE … ADD COLUMN … DEFAULT. On
-- PostgreSQL 11+ that stores the default in the catalog and does NOT rewrite the
-- table, so it is fast — but it still takes a brief ACCESS EXCLUSIVE lock and
-- will queue behind any long-running transaction touching valuations. Apply it
-- when the site is quiet, not during a traffic peak.
--
-- Rollback: see the ROLLBACK block at the foot of this file.
-- ══════════════════════════════════════════════════════════════════════════════

-- Apply via the Supabase SQL Editor or `supabase db push` (both run this as a
-- single transaction, so any error aborts the whole migration). With raw psql,
-- pass -v ON_ERROR_STOP=1 on the command line. Do not reintroduce an in-file
-- ON_ERROR_STOP directive: that is a psql meta-command, not SQL, and is a
-- syntax error over a plain Postgres connection (Supabase SQL Editor included).


-- ══════════════════════════════════════════════════════════════════════════════
-- 0. PRECONDITIONS
--
--    `valuations` is created by NO migration in this repo — it predates version
--    control, and only ALTER TABLE … ADD COLUMN for scan_uuid /
--    valuation_version exists (20260701120000:28-29). So every assumption about
--    its shape has to be asserted here rather than assumed, and a fresh-database
--    rebuild must fail loudly instead of half-applying a freeze against a table
--    that is not there.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_missing text;
BEGIN
  IF to_regclass('public.valuations') IS NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: public.valuations does not exist. It is created by no migration in this repo (see 20260701120000, which only ALTERs it) — this is either the wrong database or a fresh rebuild that needs the base schema first.';
  END IF;

  -- The four annotation columns. If one is missing the allowlist below would
  -- silently narrow and break a live client write path.
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['user_confirmed', 'user_correction', 'identified_by', 'listing_id']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'valuations' AND column_name = c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: valuations is missing annotation column(s): % — the UPDATE allowlist would silently narrow', v_missing;
  END IF;

  -- The authoritative columns this migration exists to freeze. If these are
  -- absent the freeze protects nothing and the schema is not what we audited.
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id', 'user_id', 'ai_name', 'ai_name_hebrew', 'ai_category',
                    'ai_confidence', 'ai_raw_response', 'scan_uuid',
                    'price_low', 'price_mid', 'price_high', 'price_method']) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'valuations' AND column_name = c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 abort: valuations is missing authoritative column(s): % — schema drift', v_missing;
  END IF;

  -- Column privileges are the primary layer, but they are only half the control:
  -- without RLS anyone could UPDATE anyone else's row within the allowlist.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.valuations'::regclass) THEN
    RAISE EXCEPTION 'VAL-001 abort: RLS is not enabled on valuations — apply 20260607000001 first';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. LAYER 1 — column-level UPDATE privilege allowlist (primary, fail-closed)
--
--    Remove the blanket table-level UPDATE (which covers every current AND
--    future column) and re-grant UPDATE on only the four annotation columns.
--
--    This is safe for the client backup path specifically because that path
--    never UPDATEs: `.upsert(row, { onConflict: 'id', ignoreDuplicates: true })`
--    (src/contexts/AppContext.jsx:2047-2049) sends
--    `Prefer: resolution=ignore-duplicates`, i.e. INSERT … ON CONFLICT DO
--    NOTHING. Verified before choosing column privileges over a trigger-only
--    design: if that call had been a real upsert, L1 would have broken it.
-- ══════════════════════════════════════════════════════════════════════════════
REVOKE UPDATE ON public.valuations FROM authenticated;
REVOKE UPDATE ON public.valuations FROM anon;

GRANT UPDATE (user_confirmed, user_correction, identified_by, listing_id)
  ON public.valuations TO authenticated;

-- `authenticated` keeps INSERT and DELETE: those are governed by the ownership
-- RLS policies of 20260607000001, and narrowing INSERT would break
-- backupValuation (the client-side offline backup path).
--
-- `anon`, however, gets NO write privilege of any kind. This was originally left
-- alone on the same "would break backupValuation" reasoning, which is wrong for
-- anon specifically and was caught by check V001.8 on a disposable database:
--   • backupValuation returns early unless a signed-in `user` exists
--     (src/contexts/AppContext.jsx), so it never runs as anon; and
--   • the RLS check is WITH CHECK (user_id = auth.uid()), and auth.uid() is NULL
--     for anon, so `user_id = NULL` is NULL — never true. An anon INSERT was
--     already impossible.
-- Revoking is therefore pure defence in depth with zero behavioural cost: it
-- removes the privilege so a future permissive policy cannot silently activate
-- it. Fail-closed by construction, which is the property L1 exists for.
REVOKE INSERT, DELETE ON public.valuations FROM anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. `origin` — provenance for every row, decided by the server
--
--    Default 'server' so existing rows and the record_scan path need no change.
--    The BEFORE INSERT trigger in section 4 overwrites it for any insert that
--    carries a user JWT, so a client cannot claim 'server' by sending it.
--
--    Per lead decision D10 this migration does NOT attempt to reconstruct the
--    provenance of rows that already exist: they all become 'server', which is
--    an assertion we cannot actually make about the pre-fix past. That is
--    recorded, not hidden — PRICING-002 must not treat origin='server' on a row
--    created before this migration as evidence of anything.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.valuations
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'server';

COMMENT ON COLUMN public.valuations.origin IS
  'VAL-001. Who wrote this row: ''server'' = the pipeline via record_scan (service role), '
  '''client_backup'' = a PostgREST insert from a user session (backupValuation). '
  'Stamped by trg_valuations_stamp_origin_insert and not client-settable. '
  'Rows created BEFORE migration 20260730000002 all read ''server'' by default and that '
  'value is NOT evidence of provenance for them — see lead decision D10.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. LAYER 2 — BEFORE UPDATE fail-closed allowlist trigger (defence in depth)
--
--    Rebuilds the row from OLD, overlaying only the allowlisted annotation
--    columns from NEW. Everything else keeps its OLD value, so a column added in
--    future is protected automatically even if someone grants UPDATE on it.
--
--    Trust branches, in order — identical in structure to
--    profiles_prevent_privilege_escalation_update (20260723000001:88-142):
--      (a) no JWT (service role / migrations / Edge Functions) → full trust
--      (b) transaction-local trusted-write flag → full trust. PostgREST cannot
--          set app.* GUCs, so a client can never reach this branch. No writer
--          sets it today; it exists so a future SECURITY DEFINER recompute path
--          has a sanctioned door that does not require widening the allowlist.
--      (c) admin, read from the DB row and never from a JWT claim → full trust
--      (d) everyone else → allowlist
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.valuations_freeze_authoritative_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid;
  v_is_admin boolean;
  v_allowed  text[] := ARRAY['user_confirmed', 'user_correction', 'identified_by', 'listing_id'];
  v_patch    jsonb;
  v_reverted text;
BEGIN
  -- (a) Service role / internal (no JWT) → full trust.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- (b) Trusted server write path. PostgREST never sets app.* GUCs.
  IF current_setting('app.valuation_trusted_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- (c) Admins — read is_admin from the row, never from the JWT claim.
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller;
  IF v_is_admin IS TRUE THEN
    RETURN NEW;
  END IF;

  -- (d) Normal user: NEW = OLD overlaid with ONLY the allowlisted keys of NEW.
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    INTO v_patch
  FROM jsonb_each(to_jsonb(NEW))
  WHERE key = ANY(v_allowed);

  -- identified_by is the one column that is BOTH a pipeline output
  -- (api/analyze.js:3253) and a client write. The only client write that exists
  -- sets it to the literal 'user_confirmed' (src/contexts/AppContext.jsx:2490),
  -- so that is the only transition a non-trusted caller may make. Anything else
  -- keeps the pipeline's value.
  IF (v_patch ->> 'identified_by') IS DISTINCT FROM (to_jsonb(OLD) ->> 'identified_by')
     AND coalesce(v_patch ->> 'identified_by', '') <> 'user_confirmed' THEN
    RAISE WARNING 'valuations: refusing identified_by -> % (only ''user_confirmed'' is client-settable), uid=%',
      coalesce(v_patch ->> 'identified_by', 'NULL'), v_caller;
    v_patch := v_patch - 'identified_by';
  END IF;

  -- Observability: name every protected column the client tried to change.
  SELECT string_agg(key, ',') INTO v_reverted
  FROM jsonb_each(to_jsonb(NEW)) n
  WHERE NOT (key = ANY(v_allowed))
    AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> key);
  IF v_reverted IS NOT NULL THEN
    RAISE WARNING 'valuations: reverting protected column change(s) [%] attempted by uid=%',
      v_reverted, v_caller;
  END IF;

  NEW := jsonb_populate_record(OLD, v_patch);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_valuations_freeze_authoritative_update ON public.valuations;
-- No `UPDATE OF <cols>` list. That narrowing is the single most dangerous edit
-- available here: it leaves the name, timing, binding, security and body intact
-- while the guard simply never fires for an update that touches only a frozen
-- column. Check V001.9 asserts tgtype AND an empty updcols for exactly this.
CREATE TRIGGER trg_valuations_freeze_authoritative_update
  BEFORE UPDATE ON public.valuations
  FOR EACH ROW
  EXECUTE FUNCTION public.valuations_freeze_authoritative_update();


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. LAYER 3 — BEFORE INSERT provenance stamp
--
--    auth.uid() is NULL for the service role (its JWT carries role=service_role
--    and no `sub`) and non-NULL for every PostgREST client insert. So this
--    single predicate separates "the pipeline wrote it" from "a browser wrote
--    it", and the browser has no way to influence the outcome.
--
--    It deliberately does NOT reject the client insert. backupValuation is a
--    real durability path for the user's own scan history (api/analyze.js:2145
--    persists first; the client only backs up what the server reported as
--    failed). We keep the row and mark it, rather than lose the user's scan.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.valuations_stamp_origin_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- Service role / migrations / record_scan. Respect an explicit value so a
    -- future server-side importer can label its own rows.
    NEW.origin := coalesce(NEW.origin, 'server');
  ELSE
    -- Any insert carrying a user JWT, whatever the payload claimed.
    NEW.origin := 'client_backup';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_valuations_stamp_origin_insert ON public.valuations;
CREATE TRIGGER trg_valuations_stamp_origin_insert
  BEFORE INSERT ON public.valuations
  FOR EACH ROW
  EXECUTE FUNCTION public.valuations_stamp_origin_insert();


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. POSTCONDITIONS — fail the whole migration rather than ship a partial fix.
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_cols     text;
  v_expected text := 'identified_by, listing_id, user_confirmed, user_correction';
  v_tg       text;
BEGIN
  -- 5a. authenticated holds UPDATE on EXACTLY the four annotation columns.
  --     Set equality, not containment: an EXTRA grant is as much a failure as a
  --     missing one, and containment would not notice ai_raw_response appearing.
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO v_cols
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'valuations'
    AND grantee = 'authenticated' AND privilege_type = 'UPDATE';
  IF coalesce(v_cols, '<none>') <> v_expected THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: authenticated UPDATE columns are [%], expected [%]',
      coalesce(v_cols, '<none>'), v_expected;
  END IF;

  -- 5b. anon holds no UPDATE at all.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'valuations'
      AND grantee = 'anon' AND privilege_type = 'UPDATE'
  ) OR pg_catalog.has_table_privilege('anon', 'public.valuations', 'UPDATE') THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: anon still holds UPDATE on valuations';
  END IF;

  -- 5c. Both triggers exist, are enabled ('O' = origin/default), fire BEFORE and
  --     FOR EACH ROW, and cover ALL columns.
  --       tgtype 19 = ROW + BEFORE + UPDATE
  --       tgtype  7 = ROW + BEFORE + INSERT
  SELECT string_agg(x.tgname, ', ') INTO v_tg
  FROM (VALUES ('trg_valuations_freeze_authoritative_update', 19::smallint),
               ('trg_valuations_stamp_origin_insert',          7::smallint)) x(tgname, tgtype)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.valuations'::regclass
      AND t.tgname  = x.tgname
      AND t.tgenabled = 'O'
      AND t.tgtype    = x.tgtype
      AND t.tgattr    = ''::int2vector   -- no UPDATE OF <cols> narrowing
  );
  IF v_tg IS NOT NULL THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: guard trigger missing, disabled, mistimed or column-narrowed: %', v_tg;
  END IF;

  -- 5d. origin exists, is NOT NULL, and defaults to 'server'.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'valuations'
      AND column_name = 'origin'
      AND is_nullable = 'NO'
      AND column_default LIKE '%server%'
  ) THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: valuations.origin missing, nullable, or wrongly defaulted';
  END IF;

  -- 5e. No RLS policy on valuations binds anon or public. The four ownership
  --     policies of 20260607000001 omit TO and therefore bind `public`; that is
  --     the same shape 20260729000002 corrected on profiles. Ownership here is
  --     `user_id = auth.uid()`, which anon can never satisfy, so this is not a
  --     hole — but it is unscoped, so it is reported rather than enforced.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'valuations'
      AND roles::text[] && ARRAY['anon']
  ) THEN
    RAISE EXCEPTION 'VAL-001 postcondition failed: an RLS policy on valuations explicitly binds anon';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. VERIFY (read-only, run after applying — or just run
--    tests/val_001_production_verification.sql, checks V001.7-V001.12)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT grantee, privilege_type, column_name
-- FROM information_schema.column_privileges
-- WHERE table_schema='public' AND table_name='valuations'
--   AND privilege_type='UPDATE' AND grantee IN ('anon','authenticated')
-- ORDER BY grantee, column_name;
-- Expected: exactly four rows, all grantee='authenticated', columns
--           identified_by / listing_id / user_confirmed / user_correction.
--
-- SELECT tgname, tgenabled, tgtype FROM pg_trigger
-- WHERE tgrelid='public.valuations'::regclass AND NOT tgisinternal;
-- Expected: trg_valuations_freeze_authoritative_update (O, 19)
--           trg_valuations_stamp_origin_insert         (O, 7)


-- ══════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP REQUIRED IN APPLICATION CODE (not this migration's file to touch):
--   api/confirm-identity.js:155-160 must add `.eq('origin', 'server')` to the
--   valuation load. Until it does, L3 records provenance without acting on it —
--   the column is populated and correct, but a forged client_backup row can
--   still seed shared recognition memory. L1 and L2 stand alone and take effect
--   immediately; L3 is only half a control until that one line lands.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — restores the pre-migration state, which is the state this
-- migration exists to end; here so a broken production can be undone in one
-- paste):
--
--   DROP TRIGGER IF EXISTS trg_valuations_freeze_authoritative_update ON public.valuations;
--   DROP TRIGGER IF EXISTS trg_valuations_stamp_origin_insert          ON public.valuations;
--   GRANT UPDATE ON public.valuations TO authenticated;   -- restores old (unsafe) breadth
--
-- Leave the `origin` column in place: dropping it would break any code already
-- reading it, and an unused column is harmless. Drop it only if you are also
-- reverting the api/confirm-identity.js follow-up:
--   ALTER TABLE public.valuations DROP COLUMN IF EXISTS origin;
-- ══════════════════════════════════════════════════════════════════════════════
