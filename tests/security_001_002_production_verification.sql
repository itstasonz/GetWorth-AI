-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-001 + SECURITY-002 — PRODUCTION VERIFICATION SUITE
--
-- Proves that the order-status lockdown (SECURITY-001) and the reputation /
-- trust-score lockdown (SECURITY-002) are actually in force on a running
-- database. Run it after applying:
--
--   supabase/migrations/20260719000003_orders_status_lockdown.sql
--   supabase/migrations/20260719000004_admin_order_status_matrix.sql
--   supabase/migrations/20260723000001_security002_reputation_lockdown.sql
--
-- ── HOW TO RUN ────────────────────────────────────────────────────────────────
--   Supabase dashboard → SQL Editor → paste this whole file → Run.
--   Or:  psql "$DB_URL" -f tests/security_001_002_production_verification.sql
--
--   Read the SUMMARY row at the bottom first. If it says ALL CHECKS PASSED you
--   are done. Otherwise it names every failing check_id; find those rows above.
--   Every row's `status` is either the literal 'PASS' or 'FAIL: <reason>', and
--   `detail` always carries the observed value — on pass and on fail alike.
--
--   RUN IT AS THE TABLE OWNER / `postgres` — which is what the Supabase SQL
--   Editor already does. This is not a formality. A partially privileged role is
--   the dangerous middle ground: it has enough access to produce a full board of
--   green rows and not enough to have actually checked anything.
--
--   The dominant mechanism is ROW LEVEL SECURITY on the base tables, not
--   catalog visibility. Measured: a role holding SELECT but subject to a
--   restrictive `profiles` policy sees zero rows, so S002.10-S002.12 scanned
--   nothing and reported "all 0 profiles agree" — PASS — on a database with 40
--   genuinely drifted profiles. Those three checks now fail closed on an empty
--   scan, which converts that false green into a loud failure, but the same role
--   also mis-reads `orders` (RLS there keys on auth.uid(), which is NULL outside
--   PostgREST) and would report drift that does not exist.
--
--   Catalog visibility is the secondary effect: information_schema.columns only
--   exposes columns the caller holds some privilege on, which would narrow S002.1
--   and S002.3. (`pg_db_role_setting`, used by S002.13, is NOT restricted — a
--   plain non-superuser reads every row of it, including other roles' setconfig.
--   Verified directly; an earlier version of this header claimed otherwise.)
--
--   A role with no access at all is safe: it aborts with `permission denied for
--   table ...` rather than reporting a false green. Which table gets named
--   depends on plan order, so do not read anything into it. If you did not run
--   this as the owner, the result does not count.
--
--   Expected runtime: a second or so. Measured 1.33-1.37 s server-side against a
--   database of 100k profiles / 200k reviews / 1M orders; cold and warm are within
--   noise of each other, so this is I/O-independent. Roughly half is the data scan
--   (the drift checks plus S002.16); the rest is catalog inspection. Re-measure and
--   update this line when you add a check. If it runs for minutes, something is wrong —
--   stop and investigate rather than waiting; a long-running SELECT on production
--   pins the xmin horizon and blocks autovacuum from reclaiming dead tuples
--   database-wide, and see the lock note below for the second reason to care.
--
-- ── WHY THIS FILE IS DIFFERENT FROM THE OTHER TWO SECURITY SUITES ─────────────
--   tests/security_001_order_transitions.test.sql   and
--   tests/security_002_reputation_lockdown.test.sql
--   are ADVERSARIAL suites: they forge orders and reputation to prove the
--   controls reject them, so they MUTATE data and must NEVER touch production.
--   They answer "does the control reject an attack?" on a disposable database.
--
--   THIS file answers a different question: "is the control actually deployed
--   HERE, right now?" — so it is strictly read-only and safe on production.
--   It is deliberately NOT named `*.test.sql`, to keep it visibly distinct from
--   the two suites that would damage production if run against it.
--
-- ── PRODUCTION SAFETY CONTRACT ────────────────────────────────────────────────
--   This file is ONE `SELECT` statement — one semicolon, first token `WITH`.
--   It therefore contains:
--     • no INSERT / UPDATE / DELETE / TRUNCATE / MERGE   (no writes)
--     • no CREATE / ALTER / DROP / GRANT / REVOKE        (no DDL)
--     • no TEMP tables, no CTAS, no cursors              (no temporary objects)
--     • no BEGIN / COMMIT / ROLLBACK / SAVEPOINT         (no transaction wrappers)
--     • no SET / SET LOCAL / set_config()                (no session mutation)
--     • no DO blocks, and every function it calls is a read-only catalog,
--       privilege or aggregate function
--   It is therefore idempotent by construction: running it a thousand times
--   leaves the database LOGICALLY identical. Not bit-for-bit — first read after a
--   write can set hint bits and visibility-map bits, physically dirtying pages
--   without changing any value. That is true of any SELECT.
--
--   LOCKS. It takes only the ACCESS SHARE locks any SELECT takes. Measured, with
--   the suite's transaction held open and each probe run standalone:
--     • not blocked: SELECT, INSERT/UPDATE/DELETE, VACUUM, ANALYZE,
--       CREATE INDEX, ALTER TABLE ... SET (fillfactor)
--     • blocked:     ALTER TABLE ... ADD COLUMN, TRUNCATE, REINDEX TABLE,
--       DROP INDEX, VACUUM FULL   (i.e. the ACCESS EXCLUSIVE family)
--     • stalls:      CREATE INDEX CONCURRENTLY — waits on the snapshot, not the lock
--   It cannot block ordinary traffic DIRECTLY. It can transitively: lock requests
--   queue FIFO, so if a DDL statement arrives while the suite is running, later
--   plain SELECTs queue behind that DDL and were observed being cancelled by
--   lock_timeout. That is a ~1 s window at the runtime above and operationally
--   irrelevant — but it is the reason the runtime matters, not just the xmin horizon.
--
--   Two independent proofs of the above, both worth re-running after any edit:
--     1. Static: strip comments and string literals, then grep for DML/DDL
--        keywords — there must be zero hits, and exactly one semicolon.
--     2. Empirical: wrap the file in `BEGIN READ ONLY; ... COMMIT;`. Postgres
--        aborts a read-only transaction on the first write attempt, so if it
--        runs to completion the file provably wrote nothing.
--
-- ── WHAT THIS SUITE DOES *NOT* PROVE (read before trusting a green run) ───────
--   It verifies that the controls are DEPLOYED, by inspecting the catalog. It
--   does not execute attacks. In particular it does not prove:
--     • that the bodies of transition_order() / the guard triggers are logically
--       correct — only that they exist, are hardened and are wired. The
--       adversarial suites above are what test behaviour.
--     • that no future migration re-opens a hole between two runs of this file.
--     • S001.11 scans functions in schema `public` only (prokind 'f' and 'p').
--       A rogue writer planted in another schema would not be seen. `public` is
--       where all application code lives; widening the scan to every schema
--       would drag in Supabase-managed internals and produce false alarms.
--     • S001.10, S001.6 and S002.7 match the deployed function TEXT. Text
--       matching can in principle be satisfied by a comment; treat it as a strong
--       smoke test, not a proof of behaviour. It exists because every non-text
--       property of a trigger can be intact while its body is a no-op.
--     • S002.15 answers a question the repository cannot: no migration here ever
--       enables RLS on `reviews`, so whether that control exists is a property of
--       the live database only. A green S002.15 is evidence about production; it
--       says nothing about what the migrations would rebuild.
--     • It does NOT sweep the schema for other client-writable tables. That was
--       considered and deliberately rejected: on the reconstruction, 19 of 24
--       public tables have RLS off with client write grants, so a generalized
--       sweep emits a 19-line wall of FAILs and the board becomes something
--       operators learn to ignore — the failure mode that ends a regression
--       suite's useful life. The named tables here are the ones SECURITY-001 and
--       SECURITY-002 actually control. `public.order_events` in particular
--       (order_id, from_status, to_status — the order audit trail) is created by
--       no migration, referenced by no application code, and sat wide open in the
--       reconstruction; it is a real question for production, but it belongs to
--       its own ticket and its own check, not to a sweep bolted on here.
--
--   ALL-OR-NOTHING: because the whole file is a single statement (which is what
--   makes the safety contract above provable), it cannot report partial results.
--   If `profiles`, `orders` or `reviews` does not exist, Postgres aborts with a
--   bare `relation "..." does not exist` and you get NO rows at all rather than
--   a page of FAILs. That is deliberate and fail-closed — a green board is
--   impossible on a database missing its core tables — but if you see that
--   error you are almost certainly connected to the wrong database. Check that
--   before you start debugging the suite.
--
-- ── HOW TO EXTEND THIS FILE (read this before adding a check) ─────────────────
--   Every check is one SELECT branch inside the `checks` CTE emitting exactly
--   these SIX columns, in this order:
--       ord | check_id | area | check_name | status | detail
--   `ord` drives display order only — keep it aligned with `check_id`.
--   `status` must be the literal 'PASS' or 'FAIL: <why>'. Put the observed
--   value in `detail` on BOTH paths: a check that only explains itself when it
--   fails is useless when you are trying to understand what "passing" meant.
--
--   Prefer `pg_catalog.has_table_privilege()` / `pg_catalog.has_column_privilege()` /
--   `pg_catalog.has_function_privilege()` over the `information_schema` grant views: the
--   information_schema views only show grants where the current user is the
--   grantor or grantee, so they silently under-report depending on which role
--   the SQL Editor session happens to run as. The has_*_privilege() family
--   answers the real question ("could this role do it?") regardless of who asks,
--   and correctly accounts for privileges inherited from PUBLIC.
--
--   Always write `pg_catalog.has_*_privilege(...)`, never the bare name. This is
--   not style. `pg_catalog`'s 3- and 4-argument privilege functions take `name`
--   arguments, this file passes `text`, so a `public.has_column_privilege(text,
--   text,text,text)` is an EXACT match and wins overload resolution — and the
--   safety contract forbids `SET`, so search_path cannot be pinned to stop it.
--   Demonstrated: on a database where `authenticated` genuinely held
--   `UPDATE(rating)` on profiles, planting one such shadow flipped S002.1-S002.4
--   from FAIL to PASS and the board to ALL CHECKS PASSED. Only the table owner can
--   create it, so this is not an app-user escalation path — it is an
--   anti-forensics weakness in a file whose entire job is to be evidence.
--
--   SIX TRAPS, each of which produced a real false PASS in this file's history.
--   Every one of them let a check report PASS while its control was absent:
--
--   1. NULL TRAP — `proconfig` is NULL for a function with no pinned
--      search_path, `true AND NULL` is NULL, and `bool_and()` SKIPS NULLs. So
--      `bool_and(prosecdef AND proconfig LIKE '%...%')` silently returns true
--      while an unpinned function sits right there. Every predicate inside an
--      aggregate must be NULL-free — coalesce first. Same applies to `prosrc`,
--      which is NULL for SQL-standard-body functions.
--
--   2. WRONG-OBJECT TRAP — matching a database object by NAME alone. pg_trigger
--      names are unique per table, not per database, so `WHERE tgname = 'x'`
--      matches a trigger of that name on ANY table. S002.9 once passed while
--      the recompute triggers were absent from `reviews`/`orders`, because
--      identically-named triggers existed on an unrelated table. Always
--      constrain `tgrelid` (or join pg_class) to the table you actually mean.
--
--   3. EMPTY-SET TRAP — a check that examines zero objects must FAIL, not pass.
--      `bool_and()` over no rows is NULL, and `count(*) FILTER (...) = 0` over
--      no rows is trivially true. If the table or column you are inspecting has
--      been renamed away, "nothing was wrong" and "nothing was checked" look
--      identical. Assert the population size explicitly — see S002.2, and
--      S002.10-S002.12, where RLS (not renaming) was the thing that emptied the
--      set on a database that was genuinely drifted.
--
--   4. INSTALLED-IS-NOT-ENFORCING TRAP — the largest family. A trigger can be
--      present, enabled, and bound to a correctly-named function while being a
--      complete no-op. Each of these was reproduced against this file and each
--      left every other check green:
--        • body replaced with `RETURN NEW`            (S001.6, S002.7 body_re)
--        • BEFORE flipped to AFTER — it vetoes a row
--          that has already been written               (tgtype in the reference CTEs)
--        • event mask narrowed, e.g. a recompute
--          trigger cut down to `AFTER INSERT`          (S002.9 tgtype)
--        • COLUMN list narrowed — `BEFORE UPDATE OF
--          avatar_url` leaves tgtype identical and the
--          guard never fires on a `rating` write        (updcols / pg_trigger.tgattr)
--        • SECURITY DEFINER added to a guard whose
--          test is `current_user IN ('anon',…)`,
--          making that test unsatisfiable              (S001.6 expect_secdef)
--        • SECURITY DEFINER function reassigned to a
--          low-privileged owner — it runs AS the owner (fn_hardening.owner_ok)
--        • search_path "pinned" to `evil_schema,public`,
--          which passes any LIKE '%search_path%' test  (fn_hardening.path_safe)
--      Verify every property that has to hold, not the one that is easiest to read.
--
--   5. BYPASS-SURFACE TRAP — the controls assume writes arrive as ordinary
--      statements against the table. An auto-updatable VIEW (owner's rights, so
--      it defeats both column grants and RLS, and PostgREST publishes it) or a
--      `DO ALSO` rewrite RULE (rewritten at parse time, so BEFORE ROW triggers
--      never fire) reaches the table without touching any of them. Both were
--      reproduced as total bypasses. See bypass_surface, S001.12, S002.14.
--
--   6. SOURCE-OF-TRUTH TRAP — locking a derived column only moves the forgery
--      one table upstream. `profiles.rating` is now computed from `reviews`, so
--      a client that can forge a review still sets its own Trust Score, and the
--      drift checks AGREE with it, because the stored value genuinely does match
--      its source. Every drift check in this file is blind to this by
--      construction. Three distinct layers had to be checked before the chain was
--      actually covered, and each was reproduced as a live forgery that left the
--      board fully green:
--        • can a client write a review it is not entitled to?   (S002.15)
--        • can it forge the VALUE of one it IS entitled to?     (S002.16 —
--          rating is a bare `integer`; one review at INT_MAX put a seller's
--          rating at 715827883.7 with S002.10 still reporting PASS)
--        • can it write MANY?                                   (S002.17 —
--          without the UNIQUE(order_id, reviewer_role) index, one buyer took a
--          seller 5.0 → 1.4 from a single genuine order)
--      When you lock a cached aggregate, check what feeds it — then check what
--      constrains THAT, at every layer down to the column's domain.
--
--   Column-level grants are the subtle one: `pg_catalog.has_table_privilege(role, tbl,
--   'UPDATE')` is FALSE when the role holds only column-level UPDATE. Use
--   `pg_catalog.has_any_column_privilege()` when you mean "can this role write ANYTHING
--   in this table", and per-column `pg_catalog.has_column_privilege()` when you mean
--   "exactly which columns".
--
--   Scanning function bodies: read them with `pg_catalog.pg_get_functiondef(oid)`, not
--   `prosrc`. `prosrc` is NULL for functions written with a SQL-standard
--   `BEGIN ATOMIC` body, so a prosrc-based WHERE clause silently skips them.
--   And write table matches as `orders\y` (word boundary), never `orders\s+set`
--   — the latter is defeated by an alias, e.g. `UPDATE orders o SET status=...`,
--   and would also mis-match `orders_archive` without the boundary.
--
-- Last verified: 2026-07-29, against databases reconstructed from the live schema
-- with all three migrations replayed — a 100k profiles / 200k reviews / 1M orders
-- instance for timing, and small populated instances for behaviour.
--
-- PRODUCTION STATE, as separately observed on 2026-07-29 and reported by the
-- operator (not measured by this session): `reviews` has RLS enabled, a public
-- SELECT policy, an INSERT policy restricted to the authenticated buyer or seller
-- of a completed order, and NO client UPDATE or DELETE policy; ratings are
-- constrained to 1-5 with zero out-of-range rows; zero duplicate reviews;
-- `one_review_per_order_role` exists on (order_id, reviewer_role); and
-- `order_events` has RLS enabled with only a participant SELECT policy and no
-- client write policies. On that state S002.15, S002.16 and S002.17 are all
-- expected to report PASS. This resolves, in production's favour, the conditional
-- that the paragraph below leaves open — it does NOT make the local reconstruction
-- any more trustworthy as evidence, and the caveat still governs every future run.
--
-- THE RECONSTRUCTION FAILS S002.15 and S002.16, and now S002.17 as well (the
-- migration declares a 3-column index; production has the correct 2-column one).
-- Read the next paragraph before drawing any conclusion about production from
-- a local run in either direction.
--
-- WHAT THE RECONSTRUCTION IS, AND WHAT ITS FAILURES DO NOT PROVE. It was built
-- from live TABLE STRUCTURE plus a replay of `supabase/migrations/`. Those two
-- sources do not cover the same ground, and the gap is measurable: 20 of its 24
-- public tables are created by no migration at all (so structure came from the
-- live schema), while RLS is enabled on exactly the tables whose migrations
-- enable it, and the whole database carries ZERO foreign keys and two CHECK
-- constraints. Production certainly has more than that. So:
--   • table/column structure  — reasonably faithful
--   • RLS state, constraints  — essentially migration-derived, NOT faithful
-- A red S002.15 or S002.16 here is therefore evidence about THIS REPOSITORY, not
-- about production. What is independently verified is only the repository half:
--   • no migration enables RLS on `reviews` (grep the tree — there is no such
--     line). With RLS off, tests/security_002_reputation_lockdown.test.sql fails
--     at A14, "self / non-party review accepted" — so IF production shares this,
--     the reputation lockdown is defeated one table upstream. That conditional is
--     the honest claim; the unconditional one is not available from here.
--   • no migration bounds `reviews.rating`.
-- Which is the entire reason this file exists: run it against production and the
-- conditional resolves. Do not resolve it from a local run in either direction.
--
-- Mutation-tested: all 29 checks. Every check was verified to FAIL when, and only
-- when, its own control was individually broken and then restored — 20 of them in
-- a dedicated pass that found no survivors, plus these, each of which was a live
-- false PASS before the check that now covers it:
--   allowlist widened · guard body gutted · BEFORE flipped to AFTER · guard made
--   SECURITY DEFINER · function owner reassigned · search_path repointed at an
--   attacker schema · recompute events narrowed · UPDATE OF column list narrowed ·
--   writable view (incl. nested and cross-schema) · DO ALSO rule · reviews RLS
--   disabled · reviews UPDATE policy · rating forged to INT_MAX · privilege
--   function shadowed in `public`
-- S002.17's uniqueness key was mutation-tested in all five of its failure modes:
--   dropped · made non-unique · made PARTIAL (`WHERE reviewer_role = 'buyer'`) ·
--   widened to (order_id, reviewer_id, reviewer_role) · narrowed to (order_id)
-- Every mutation was killed by the intended check and no other.
-- See the git log for this file.
-- ══════════════════════════════════════════════════════════════════════════════

WITH RECURSIVE

-- ── Reference data ────────────────────────────────────────────────────────────

-- The ONLY columns a normal (non-admin) user may ever write on their own
-- profile. Mirrors `v_allowed` inside profiles_prevent_privilege_escalation_update()
-- and the column-level GRANT in 20260723000001. If you change one, change all three.
allowed_profile_cols(col) AS (
  VALUES ('avatar_url'), ('full_name'), ('location'), ('phone'), ('updated_at')
),

-- Reputation / identity columns whose forgery WAS the SECURITY-002 vulnerability.
-- Listed explicitly (rather than only "everything not allowlisted") so the intent
-- stays legible: these are the fields the client Trust Score derives from, plus
-- the identity flags that gate admin and verified status.
protected_profile_cols(col) AS (
  VALUES ('rating'), ('review_count'), ('total_sales'), ('badge'),
         ('reputation_points'), ('response_rate'), ('is_phone_verified'),
         ('is_verified'), ('is_admin'), ('verification_status'), ('verified_at'),
         ('created_at'), ('email')
),

-- The complete, closed inventory of functions permitted to write orders.status.
-- SECURITY-001 exists because a SECOND, unvalidated transition engine was found
-- (admin_update_order_status had no matrix at all — see 20260719000004). S001.11
-- fails if a third one ever appears.
sanctioned_order_writers(fn) AS (
  VALUES ('transition_order'), ('create_order'), ('admin_update_order_status')
),

-- Which recompute trigger must sit on WHICH table, firing on WHICH events. Both
-- the pairing and the event mask are load-bearing:
--   • pairing — checking the trigger name alone is what let S002.9 pass while
--     `reviews` and `orders` had no recompute trigger at all (WRONG-OBJECT TRAP).
--   • event mask — narrowing a recompute trigger to `AFTER INSERT` alone leaves
--     it installed, enabled and correctly bound, so every name/binding check
--     still passes, while deletes and status changes silently stop recomputing.
--     Reproduced; it is the quietest way to break reputation without tripping a
--     single other check.
--
-- `tgtype` is a bitmask: 1=ROW 2=BEFORE 4=INSERT 8=DELETE 16=UPDATE 32=TRUNCATE.
-- Matching it EXACTLY (not "contains") is the fail-closed choice: for a control
-- trigger, "exactly these events, at exactly this timing" is the contract, and an
-- ADDED event is as much an unreviewed change as a removed one. If a trigger
-- definition legitimately changes, update the expected value here — deliberately,
-- as a reviewed edit.
--   13 = ROW + INSERT + DELETE                 (AFTER INSERT OR DELETE)
--   29 = ROW + INSERT + DELETE + UPDATE        (AFTER INSERT OR DELETE OR UPDATE OF status)
-- `updcols` is the `UPDATE OF <cols>` column list (pg_trigger.tgattr), '' meaning
-- "all columns". It must be asserted SEPARATELY from tgtype, because narrowing a
-- trigger to a column list does not change tgtype at all: `AFTER ... UPDATE OF
-- price` and `AFTER ... UPDATE OF status` are both tgtype 29. Reproduced — the
-- suite stayed fully green while a guard had been narrowed to a column nobody
-- attacks, so the trigger existed, was enabled, was correctly timed and never
-- fired on the writes that matter.
expected_recompute_triggers(tgname, relname, tgtype, updcols) AS (
  VALUES ('trg_reviews_recompute_rating',     'reviews', 13::smallint, ''),
         ('trg_orders_recompute_total_sales', 'orders',  29::smallint, 'status')
),

-- The three GUARD triggers, with the same exact-mask contract. These are the
-- ones whose timing is a security property rather than a correctness one: a
-- BEFORE guard that is flipped to AFTER still fires, still raises, still shows
-- `tgenabled='O'` — and is a complete no-op, because the row it was meant to
-- veto has already been written. Reproduced on all three.
--    7 = ROW + BEFORE + INSERT                 (BEFORE INSERT)
--   19 = ROW + BEFORE + UPDATE                 (BEFORE UPDATE)
--   23 = ROW + BEFORE + INSERT + UPDATE        (BEFORE INSERT OR UPDATE)
-- `expect_secdef` differs per guard and is a security property in BOTH directions:
--   • the two profiles guards MUST be SECURITY DEFINER — they read profiles.is_admin,
--     which RLS would otherwise hide from the calling user.
--   • orders_status_guard MUST NOT be. Its entire test is `current_user IN
--     ('anon','authenticated')`; under SECURITY DEFINER current_user becomes the
--     owner, that test is never true, and the guard degrades to `RETURN NEW` while
--     remaining present, enabled, correctly bound and correctly timed. Reproduced.
--
-- `body_re` is a regex the deployed body must still match — the same technique, and
-- the same caveat, as S001.10: text matching is a strong smoke test, not a proof of
-- behaviour. It exists because name + binding + timing + enabled can ALL be intact
-- while the body has been replaced with `RETURN NEW` (reproduced), or while the L2
-- allowlist has been widened to include `rating` and `is_admin` (reproduced). The
-- allowlist regex matches an array built ONLY from the five personal columns, so an
-- added column fails it whatever the ordering or whitespace.
-- All three guards must cover ALL columns (`updcols` = ''), never an `UPDATE OF`
-- list. This is the single most dangerous narrowing available: rewriting the L2
-- guard as `BEFORE UPDATE OF avatar_url` leaves tgtype at 19, the name, binding,
-- timing, secdef and body all untouched — and the guard then fires only when
-- avatar_url changes, so an UPDATE that touches only `rating` walks straight
-- past it. Reproduced: the board stayed ALL CHECKS PASSED with L2 fully bypassed.
expected_guard_triggers(tgname, relname, tgtype, updcols, proname, expect_secdef, body_re) AS (
  VALUES ('trg_orders_status_guard', 'orders', 23::smallint, '',
          'orders_status_guard', false,
          'insufficient_privilege'),
         ('trg_profiles_prevent_privilege_escalation_update', 'profiles', 19::smallint, '',
          'profiles_prevent_privilege_escalation_update', true,
          'ARRAY\[(''avatar_url''|''full_name''|''location''|''phone''|''updated_at''|,|\s)+\]'),
         ('trg_profiles_enforce_safe_defaults_insert', 'profiles', 7::smallint, '',
          'profiles_enforce_safe_defaults_insert', true,
          'NEW\.is_admin\s*:=\s*false')
),

-- The role that owns the application tables. Every SECURITY DEFINER function in
-- this design must be owned by it, because SECURITY DEFINER runs AS THE OWNER:
-- reassign transition_order() to a low-privileged role and the function keeps its
-- name, its `prosecdef=true`, its pinned search_path and its EXECUTE grants while
-- losing the privileges that made it authoritative. Reproduced — every ownership
-- check that only PRINTS the owner passed.
--
-- Anchored to the owner of `profiles` rather than asserting `rolsuper`, because
-- managed Postgres (Supabase included) does not necessarily grant the table-owning
-- role superuser, and an rolsuper assertion would false-FAIL there. What actually
-- matters is that the function owner and the table owner are the same principal.
app_owner(rolname) AS (
  SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_class
  WHERE oid = 'public.profiles'::regclass
),

-- Per-function hardening facts, computed once and shared by S001.7-S001.9 and
-- S002.8 so the four checks cannot drift apart.
--
-- `path_safe` is the half that a `LIKE '%search_path%'` test misses entirely:
-- `SET search_path = evil_schema, public` IS pinned, and is strictly worse than
-- unpinned, because it silently and permanently prefers an attacker's schema for
-- every unqualified reference in the body. Reproduced. So every schema named in
-- the pin must be one we recognise; anything else fails.
fn_hardening(oid, proname, secdef, owner, owner_ok, cfg, path_pinned, path_safe) AS MATERIALIZED (
  SELECT p.oid,
         p.proname::text,
         p.prosecdef,
         pg_catalog.pg_get_userbyid(p.proowner),
         pg_catalog.pg_get_userbyid(p.proowner) = (SELECT rolname FROM app_owner),
         coalesce(p.proconfig::text, 'UNPINNED'),
         coalesce(p.proconfig::text, '') LIKE '%search_path=%',
         NOT EXISTS (
           SELECT 1
           FROM unnest(string_to_array(
                  right((SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
                        -length('search_path=')), ',')) s
           WHERE btrim(s, ' "') NOT IN ('public', 'pg_catalog', 'pg_temp', '$user')
         )
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),

-- Observed state of every guard trigger, scored against expected_guard_triggers.
-- Shared by S001.6 (orders) and S002.7 (profiles) so the two cannot drift apart.
--
-- LEFT JOIN from the EXPECTED side, so a trigger that has been dropped outright
-- still produces a row saying which one is missing — the EMPTY-SET TRAP guard.
-- Joined on (tgname, relname) together, never name alone — WRONG-OBJECT TRAP.
guard_trigger_state(relname, tgname, ok, detail) AS MATERIALIZED (
  SELECT x.relname, x.tgname,
         coalesce(t.tgenabled = 'O'
              AND t.tgtype    = x.tgtype
              AND t.updcols   = x.updcols
              AND t.proname   = x.proname
              AND t.prosecdef = x.expect_secdef
              AND t.body ~ x.body_re, false),
         x.tgname || ' on public.' || x.relname || ' → ' ||
         CASE WHEN t.tgname IS NULL THEN 'MISSING'
              ELSE t.proname || '() enabled=' || t.tgenabled::text
                   || ' tgtype=' || t.tgtype::text
                        || CASE WHEN t.tgtype = x.tgtype THEN '' ELSE '(EXPECTED ' || x.tgtype::text || ')' END
                   || ' cols=' || CASE WHEN t.updcols = '' THEN 'all' ELSE t.updcols END
                        || CASE WHEN t.updcols = x.updcols THEN ''
                                ELSE '(EXPECTED ' || CASE WHEN x.updcols = '' THEN 'all' ELSE x.updcols END || ')' END
                   || ' secdef=' || t.prosecdef::text
                        || CASE WHEN t.prosecdef = x.expect_secdef THEN '' ELSE '(EXPECTED ' || x.expect_secdef::text || ')' END
                   || ' body=' || CASE WHEN t.body ~ x.body_re THEN 'intact' ELSE 'ALTERED' END
         END
  FROM expected_guard_triggers x
  LEFT JOIN (
    SELECT tg.tgname::text AS tgname, c.relname::text AS relname, tg.tgenabled, tg.tgtype,
           p.proname::text AS proname, p.prosecdef,
           coalesce(pg_catalog.pg_get_functiondef(p.oid), '') AS body,
           coalesce((SELECT string_agg(a.attname, ',' ORDER BY a.attname)
                     FROM unnest(tg.tgattr::int2[]) col
                     JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = col), '') AS updcols
    FROM pg_trigger tg
    JOIN pg_class     c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc      p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND n.nspname = 'public'
  ) t ON t.tgname = x.tgname AND t.relname = x.relname
),

-- Write paths that reach a protected table WITHOUT passing through its triggers.
-- Two mechanisms, both reproduced as complete bypasses of SECURITY-001/002 that
-- left every other check green:
--   • an auto-updatable VIEW. `CREATE VIEW v AS SELECT * FROM profiles` + `GRANT
--     UPDATE ON v TO authenticated` gives a client a writable handle on the table
--     with none of its column-level grants — and, because the view owner is the
--     table owner, it runs with the OWNER's rights, so RLS on the base table does
--     not apply either. PostgREST exposes every view in `public` as an endpoint,
--     so this is directly reachable, not theoretical.
--   • a REWRITE RULE. `CREATE RULE ... DO ALSO` rewrites the query at parse time;
--     the rewritten action is not a row-level trigger event, so BEFORE ROW guards
--     never see it.
-- Both are detected structurally (pg_depend / pg_rewrite), not by parsing SQL text.
--
-- DISTINCT is load-bearing, not tidiness: pg_depend records one row per COLUMN a
-- view references, so `SELECT * FROM profiles` produces one row per profiles
-- column and a naive count reported 21 bypass paths for a single view.
--
-- RECURSIVE is equally load-bearing. A one-level pg_depend join sees only views
-- built DIRECTLY on the table. `CREATE VIEW outer AS SELECT * FROM inner` where
-- `inner` selects from profiles depends on `inner`, not on `profiles`, so a
-- two-level chain was completely invisible and the check reported PASS while a
-- client-writable handle on `profiles` existed. Reproduced, including an actual
-- forged row written through a nested view. The closure below follows view→view
-- edges to any depth; UNION (not UNION ALL) dedupes and terminates on cycles.
--
-- Scope is every schema, not just `public`: the base table must live in `public`,
-- but a view over it anywhere is a bypass if a client role can write it, and
-- PostgREST's exposed-schema list is configuration, not a constant.
view_closure(base, viewoid) AS (
  SELECT c.oid, v.oid
  FROM pg_class c
  JOIN pg_depend  d  ON d.refobjid = c.oid AND d.classid = 'pg_rewrite'::regclass
                    AND d.refclassid = 'pg_class'::regclass
  JOIN pg_rewrite rw ON rw.oid = d.objid
  JOIN pg_class   v  ON v.oid = rw.ev_class
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('profiles', 'orders', 'reviews')
    AND v.relkind IN ('v', 'm')
    AND v.oid <> c.oid
  UNION
  SELECT vc.base, v2.oid
  FROM view_closure vc
  JOIN pg_depend  d2  ON d2.refobjid = vc.viewoid AND d2.classid = 'pg_rewrite'::regclass
  JOIN pg_rewrite rw2 ON rw2.oid = d2.objid
  JOIN pg_class   v2  ON v2.oid = rw2.ev_class
  WHERE v2.relkind IN ('v', 'm')
    AND v2.oid <> vc.viewoid
),
bypass_surface(relname, kind, objname) AS MATERIALIZED (
  SELECT DISTINCT b.relname::text, 'writable view',
         (vn.nspname || '.' || v.relname)::text
  FROM view_closure vc
  JOIN pg_class     b  ON b.oid = vc.base
  JOIN pg_class     v  ON v.oid = vc.viewoid
  JOIN pg_namespace vn ON vn.oid = v.relnamespace
  WHERE pg_catalog.has_any_column_privilege('authenticated', v.oid, 'UPDATE')
     OR pg_catalog.has_any_column_privilege('authenticated', v.oid, 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', v.oid, 'DELETE')
     OR pg_catalog.has_any_column_privilege('anon', v.oid, 'UPDATE')
     OR pg_catalog.has_any_column_privilege('anon', v.oid, 'INSERT')
     OR pg_catalog.has_table_privilege('anon', v.oid, 'DELETE')
  UNION ALL
  SELECT c.relname::text, 'rewrite rule', rw.rulename::text
  FROM pg_class c
  JOIN pg_rewrite rw ON rw.ev_class = c.oid
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('profiles', 'orders', 'reviews')
    AND rw.rulename <> '_RETURN'
),

-- ── Expected reputation aggregates ────────────────────────────────────────────
-- Computed ONCE, set-based, from the authoritative source tables.
--
-- These deliberately do NOT use a correlated subquery per profile. `reviews` has
-- no index on seller_id, so the correlated form degrades to a sequential scan of
-- `reviews` for every row of `profiles` — a plan costed at 644 MILLION on the
-- 100k/200k/1M reconstruction, which never completed. The GROUP BY + LEFT JOIN
-- form below returns identical rows in ~0.5 s. Do not "simplify" it back.
reviews_expected(seller_id, avg_rating, review_count) AS (
  SELECT r.seller_id, round(avg(r.rating)::numeric, 1), count(*)::int
  FROM reviews r
  GROUP BY r.seller_id
),
orders_expected(seller_id, completed_count) AS (
  SELECT o.seller_id, count(*)::int
  FROM orders o
  WHERE o.status = 'completed'
  GROUP BY o.seller_id
),

-- One row per profile, flagging each stored aggregate that disagrees with its
-- source. MATERIALIZED so the three drift checks below share a single pass over
-- profiles/reviews/orders instead of repeating it.
--
-- The coalesce()s reproduce the semantics of the per-profile subqueries exactly:
-- a profile with no reviews expects rating 0 and review_count 0 (avg over an
-- empty set is NULL; count over an empty set is 0), and a seller with no
-- completed orders expects total_sales 0.
reputation_drift(id, rating_drift, review_count_drift, total_sales_drift) AS MATERIALIZED (
  SELECT p.id,
         coalesce(p.rating, 0)       IS DISTINCT FROM coalesce(re.avg_rating, 0),
         coalesce(p.review_count, 0) IS DISTINCT FROM coalesce(re.review_count, 0),
         coalesce(p.total_sales, 0)  IS DISTINCT FROM coalesce(oe.completed_count, 0)
  FROM profiles p
  LEFT JOIN reviews_expected re ON re.seller_id = p.id
  LEFT JOIN orders_expected  oe ON oe.seller_id = p.id
),

checks(ord, check_id, area, check_name, status, detail) AS MATERIALIZED (

-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-001 — orders: one authoritative transition path
-- ══════════════════════════════════════════════════════════════════════════════

-- Clients must hold no direct write privilege of any kind on orders. Checked at
-- both table and column level, and including TRUNCATE — TRUNCATE is gated by
-- neither RLS nor BEFORE ROW triggers, so a stray grant would bypass L2 and L3.
SELECT 1, 'S001.1', 'orders/grants', 'client roles hold no write privilege on orders',
  CASE WHEN bool_and(NOT ok) THEN 'PASS' ELSE 'FAIL: client can still write orders' END,
  CASE WHEN bool_and(NOT ok) THEN 'anon + authenticated: no INSERT/UPDATE/DELETE/TRUNCATE, incl. column-level'
       ELSE 'still granted: ' || string_agg(role_name || '.' || priv, ', ') FILTER (WHERE ok) END
FROM (
  SELECT r.role_name, p.priv,
         CASE WHEN p.priv = 'UPDATE'
              THEN pg_catalog.has_any_column_privilege(r.role_name, 'public.orders', 'UPDATE')
              ELSE pg_catalog.has_table_privilege(r.role_name, 'public.orders', p.priv) END AS ok
  FROM (VALUES ('anon'), ('authenticated')) r(role_name)
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
) g

UNION ALL
-- SELECT must survive: order visibility is governed by the SELECT policies, and
-- the reviews INSERT policy's EXISTS-on-orders subquery depends on it. A "lockdown"
-- that also revoked SELECT would break the app, so assert the boundary explicitly.
SELECT 2, 'S001.2', 'orders/grants', 'authenticated retains SELECT on orders',
  CASE WHEN pg_catalog.has_table_privilege('authenticated', 'public.orders', 'SELECT')
       THEN 'PASS' ELSE 'FAIL: SELECT was revoked — order visibility is broken' END,
  'reviews INSERT policy and the orders UI both depend on this'

UNION ALL
-- L2: with every write policy dropped and RLS still on, a re-granted write
-- privilege still fails closed (default-deny).
SELECT 3, 'S001.3', 'orders/rls', 'no write RLS policies remain on orders',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' write policy/policies survived' END,
  coalesce('present: ' || string_agg(policyname || ' (' || cmd || ')', ', '),
           'none — INSERT/UPDATE/DELETE/ALL policies all dropped')
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders' AND cmd <> 'SELECT'

UNION ALL
-- The flip side of S001.3: dropping write policies must not have taken the read
-- policies with it, or every non-admin loses sight of their own orders.
SELECT 4, 'S001.4', 'orders/rls', 'orders SELECT policies still present',
  CASE WHEN count(*) >= 1 THEN 'PASS' ELSE 'FAIL: no SELECT policy — orders are invisible to clients' END,
  coalesce(string_agg(policyname, ', '), '(none)')
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders' AND cmd = 'SELECT'

UNION ALL
-- RLS must stay ENABLED. A table whose write policies were dropped but whose RLS
-- is off is wide open to any role holding a table privilege — the failure mode
-- S001.3 alone would not catch.
SELECT 5, 'S001.5', 'orders/rls', 'RLS is enabled on orders',
  CASE WHEN bool_and(relrowsecurity) THEN 'PASS' ELSE 'FAIL: RLS disabled — default-deny backstop is gone' END,
  'relrowsecurity=' || bool_and(relrowsecurity)::text
FROM pg_class WHERE oid = 'public.orders'::regclass

UNION ALL
-- L3: the backstop trigger. "Installed" is five separate assertions, and each one
-- of the other four was independently reproduced as a way to neuter the guard
-- while leaving a name-and-enabled check green:
--   enabled   — tgenabled 'D' means present but never fires
--   timing    — BEFORE flipped to AFTER vetoes a row that is already written
--   binding   — rebound to a no-op function of a different name
--   secdef    — SECURITY DEFINER makes its `current_user` test unsatisfiable
--   body      — replaced with `RETURN NEW`
-- See expected_guard_triggers for the expected values and why each is load-bearing.
SELECT 6, 'S001.6', 'orders/trigger', 'trg_orders_status_guard installed, enabled, correctly timed and bound',
  CASE WHEN count(*) = 0 THEN 'FAIL: examined 0 triggers — expected_guard_triggers is empty'
       WHEN bool_and(ok) THEN 'PASS'
       ELSE 'FAIL: guard trigger missing, disabled, mistimed, misbound, or its body was altered' END,
  string_agg(detail, '; ' ORDER BY tgname)
FROM guard_trigger_state WHERE relname = 'orders'

UNION ALL
-- transition_order() is THE authoritative transition matrix. Four properties, all
-- of them necessary, computed once in fn_hardening (see there for the reasoning):
--   SECURITY DEFINER — it writes a table clients cannot
--   owner            — SECURITY DEFINER runs AS the owner; reassigning it to a
--                      low-privileged role guts it without changing anything else
--   search_path      — pinned AND pointing only at schemas we recognise
--   EXECUTE          — authenticated yes, anon never
SELECT 7, 'S001.7', 'orders/rpc', 'transition_order() is a hardened SECURITY DEFINER RPC',
  CASE WHEN count(*) = 0 THEN 'FAIL: transition_order() does not exist'
       WHEN bool_and(secdef AND owner_ok AND path_pinned AND path_safe
                 AND pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
                 AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'))
       THEN 'PASS'
       ELSE 'FAIL: not SECDEF, owner reassigned, search_path unpinned or unsafe, or EXECUTE misgranted' END,
  coalesce(string_agg('secdef=' || secdef::text
    || ' owner=' || owner
         || CASE WHEN owner_ok THEN '' ELSE ' (EXPECTED ' || (SELECT rolname FROM app_owner) || ')' END
    || ' cfg=' || cfg
         || CASE WHEN path_pinned AND path_safe THEN '' ELSE ' (UNSAFE)' END
    || ' exec[authenticated]=' || pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text
    || ' exec[anon]=' || pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text, '; '), '(absent)')
FROM fn_hardening WHERE proname = 'transition_order'

UNION ALL
-- create_order() is the sole INSERT path; same hardening requirements.
SELECT 8, 'S001.8', 'orders/rpc', 'create_order() is a hardened SECURITY DEFINER RPC',
  CASE WHEN count(*) = 0 THEN 'FAIL: create_order() does not exist'
       WHEN bool_and(secdef AND owner_ok AND path_pinned AND path_safe
                 AND pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
                 AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'))
       THEN 'PASS'
       ELSE 'FAIL: not SECDEF, owner reassigned, search_path unpinned or unsafe, or EXECUTE misgranted' END,
  coalesce(string_agg('secdef=' || secdef::text
    || ' owner=' || owner
         || CASE WHEN owner_ok THEN '' ELSE ' (EXPECTED ' || (SELECT rolname FROM app_owner) || ')' END
    || ' cfg=' || cfg
         || CASE WHEN path_pinned AND path_safe THEN '' ELSE ' (UNSAFE)' END
    || ' exec[authenticated]=' || pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')::text
    || ' exec[anon]=' || pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text, '; '), '(absent)')
FROM fn_hardening WHERE proname = 'create_order'

UNION ALL
-- admin_update_order_status() is the admin escape hatch. It runs as the owner, so
-- trg_orders_status_guard does NOT constrain it — its own body is the only
-- control. anon must never hold EXECUTE.
SELECT 9, 'S001.9', 'orders/rpc', 'admin_update_order_status() is a hardened SECURITY DEFINER RPC',
  CASE WHEN count(*) = 0 THEN 'FAIL: admin_update_order_status() does not exist'
       WHEN bool_and(secdef AND owner_ok AND path_pinned AND path_safe
                 AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'))
       THEN 'PASS'
       ELSE 'FAIL: not SECDEF, owner reassigned, search_path unpinned or unsafe, or anon holds EXECUTE' END,
  coalesce(string_agg('secdef=' || secdef::text
    || ' owner=' || owner
         || CASE WHEN owner_ok THEN '' ELSE ' (EXPECTED ' || (SELECT rolname FROM app_owner) || ')' END
    || ' cfg=' || cfg
         || CASE WHEN path_pinned AND path_safe THEN '' ELSE ' (UNSAFE)' END
    || ' exec[anon]=' || pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')::text, '; '), '(absent)')
FROM fn_hardening WHERE proname = 'admin_update_order_status'

UNION ALL
-- Static assertion that the DEPLOYED body of admin_update_order_status is the
-- FIXED one from 20260719000004, not the 20260519000001 original that had no
-- matrix at all. Pre-fix, an admin could reverse a completed order or fabricate
-- a completion on a cancelled one.
--
-- This greps the deployed definition for the two guarantees the fix added. It is
-- deliberately loose (substring, not exact body match) so that unrelated edits
-- do not false-alarm — but it WILL fail if someone reverts the function or
-- CREATE OR REPLACEs it from the old migration. If this fails, diff the live
-- definition (`SELECT pg_catalog.pg_get_functiondef(oid) FROM pg_proc
-- WHERE proname='admin_update_order_status'`) against 20260719000004 before
-- assuming it is a false alarm. coalesce() guards the NULL TRAP: prosrc is NULL
-- for a SQL-standard-body function, and NULL inside bool_and() would be skipped.
SELECT 10, 'S001.10', 'orders/rpc', 'admin_update_order_status enforces terminal states + listing side effect',
  CASE WHEN count(*) = 0 THEN 'FAIL: function absent'
       WHEN bool_and(coalesce(pg_catalog.pg_get_functiondef(p.oid), '') LIKE '%terminal state%'
                 AND coalesce(pg_catalog.pg_get_functiondef(p.oid), '') LIKE '%sold%')
       THEN 'PASS' ELSE 'FAIL: deployed body lacks the 20260719000004 guards — old version is live' END,
  CASE WHEN bool_and(coalesce(pg_catalog.pg_get_functiondef(p.oid), '') LIKE '%terminal state%')
       THEN 'terminal-state guard: present' ELSE 'terminal-state guard: MISSING' END ||
  CASE WHEN bool_and(coalesce(pg_catalog.pg_get_functiondef(p.oid), '') LIKE '%sold%')
       THEN ', listings-sold side effect: present' ELSE ', listings-sold side effect: MISSING' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'admin_update_order_status'

UNION ALL
-- "One authoritative transition matrix" means exactly that. Any OTHER function
-- whose body writes orders.status is, by definition, a second transition engine —
-- which is precisely the class of bug 20260719000004 was written to fix.
--
-- Reads the body via pg_catalog.pg_get_functiondef() so SQL-standard-body functions (whose
-- prosrc is NULL) are not silently skipped, covers procedures as well as
-- functions, and matches `orders\y` on a word boundary so that neither an alias
-- (`UPDATE orders o SET ...`) nor a lookalike table (`orders_archive`) fools it.
-- Scope is schema `public` — see "WHAT THIS SUITE DOES NOT PROVE" in the header.
--
-- Triage on FAIL: the named function may be legitimate (e.g. a new RPC that
-- correctly delegates). Read its body. If it is a real transition path, either
-- fold it into transition_order() or add it to sanctioned_order_writers above
-- WITH a comment justifying it. Do not silence this check casually.
SELECT 11, 'S001.11', 'orders/rpc', 'no unsanctioned function writes orders.status',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' unsanctioned writer(s) of orders.status' END,
  coalesce('unsanctioned: ' || string_agg(p.proname, ', '),
           'only transition_order / create_order / admin_update_order_status write orders.status')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND coalesce(pg_catalog.pg_get_functiondef(p.oid), '') ~* 'update\s+(public\.)?orders\y'
  AND coalesce(pg_catalog.pg_get_functiondef(p.oid), '') ~* 'status'
  AND p.proname NOT IN (SELECT fn FROM sanctioned_order_writers)

UNION ALL
-- Every control above assumes writes arrive at `orders` as ordinary INSERT/UPDATE
-- statements against the table, where grants, RLS and the BEFORE ROW guard all
-- apply. A writable view or a rewrite rule breaks that assumption outright: the
-- write reaches the table without passing any of the three. Both were reproduced
-- as total bypasses that left all other checks green. See bypass_surface.
SELECT 12, 'S001.12', 'orders/bypass', 'no view or rule writes orders behind the guards',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' bypass path(s) reach orders without the guards' END,
  coalesce('bypass: ' || string_agg(kind || ' ' || objname, ', ' ORDER BY objname),
           'no client-writable view and no rewrite rule on orders')
FROM bypass_surface WHERE relname = 'orders'

-- ══════════════════════════════════════════════════════════════════════════════
-- SECURITY-002 — profiles: reputation, trust score and badge integrity
-- ══════════════════════════════════════════════════════════════════════════════

UNION ALL
-- L1, positive form: the grant is exactly the five personal columns. Asserting
-- set equality (not just "contains") is what makes this fail-closed — an extra
-- granted column is as much a finding as a missing one.
SELECT 13, 'S002.1', 'profiles/grants', 'authenticated UPDATE allowlist is exactly the 5 personal columns',
  CASE WHEN coalesce(array_agg(c.column_name::text ORDER BY c.column_name::text), '{}'::text[])
            = (SELECT array_agg(col ORDER BY col) FROM allowed_profile_cols)
       THEN 'PASS' ELSE 'FAIL: allowlist does not match the intended set' END,
  'granted: ' || coalesce(array_to_string(
                   array_agg(c.column_name::text ORDER BY c.column_name::text), ', '), '(none)')
    || ' | expected: ' || (SELECT array_to_string(array_agg(col ORDER BY col), ', ') FROM allowed_profile_cols)
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'profiles'
  AND pg_catalog.has_column_privilege('authenticated', 'public.profiles', c.column_name, 'UPDATE')

UNION ALL
-- L1, negative form, named. Redundant with S002.1 by construction, and that is
-- the point: this is the check whose failure message says "rating is writable",
-- which is the sentence an on-call engineer needs at 3am.
-- Columns absent from this database are skipped, so the check survives schema drift.
-- The `count(*) = 0` arm is NOT redundant — it is the EMPTY-SET TRAP guard: if
-- `profiles` were renamed or dropped, the EXISTS filter below would match nothing,
-- the FILTER'd count would be 0, and a naive check would report PASS on a table
-- that no longer exists. Zero columns examined is a failure to verify, not a
-- verification of safety.
SELECT 14, 'S002.2', 'profiles/grants', 'no reputation or identity column is client-writable',
  CASE WHEN count(*) = 0 THEN 'FAIL: examined 0 columns — profiles is missing or has none of the protected columns'
       WHEN count(*) FILTER (WHERE writable) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) FILTER (WHERE writable) || ' protected column(s) are client-writable' END,
  CASE WHEN count(*) = 0 THEN 'no protected column found on public.profiles — schema drift or wrong database'
       WHEN count(*) FILTER (WHERE writable) = 0
       THEN 'verified locked (' || count(*) || '): ' || string_agg(col, ', ' ORDER BY col)
       ELSE 'WRITABLE: ' || string_agg(col, ', ' ORDER BY col) FILTER (WHERE writable) END
FROM (
  SELECT pc.col,
         pg_catalog.has_column_privilege('authenticated', 'public.profiles', pc.col, 'UPDATE') AS writable
  FROM protected_profile_cols pc
  WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema='public' AND c.table_name='profiles'
                  AND c.column_name = pc.col)
) x

UNION ALL
-- Fail-closed for the future. S002.2 only knows about columns that existed when
-- it was written; this one catches a column ADDED later that someone granted
-- broadly (or that inherited a table-wide GRANT). This is the check that keeps
-- working after everyone who wrote SECURITY-002 has left.
SELECT 15, 'S002.3', 'profiles/grants', 'every non-allowlisted profiles column is unwritable (incl. future ones)',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' non-allowlisted column(s) writable' END,
  coalesce('writable but not allowlisted: ' || string_agg(c.column_name::text, ', '),
           'no column outside the allowlist is writable')
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name = 'profiles'
  AND c.column_name::text NOT IN (SELECT col FROM allowed_profile_cols)
  AND pg_catalog.has_column_privilege('authenticated', 'public.profiles', c.column_name, 'UPDATE')

UNION ALL
-- anon is unauthenticated and must not be able to UPDATE profiles at all — not
-- one column. This is the privilege SECURITY-002 explicitly revokes
-- (20260723000001 lines 71-72: REVOKE UPDATE ... FROM anon), and the column-level
-- re-GRANT goes to `authenticated` only. So anon must hold zero UPDATE.
-- pg_catalog.has_any_column_privilege() also catches a grant made to PUBLIC, which anon
-- would inherit without ever being named.
SELECT 16, 'S002.4', 'profiles/grants', 'anon holds no UPDATE privilege on profiles',
  CASE WHEN NOT pg_catalog.has_any_column_privilege('anon', 'public.profiles', 'UPDATE')
       THEN 'PASS' ELSE 'FAIL: anon can UPDATE profiles — the column re-GRANT leaked to anon' END,
  'anon update privilege (table or column level): '
    || pg_catalog.has_any_column_privilege('anon', 'public.profiles', 'UPDATE')::text

UNION ALL
-- INSERT and DELETE on profiles are governed by RLS, NOT by table grants, and
-- deliberately so: SECURITY-002 revokes only UPDATE. In a stock Supabase project
-- anon/authenticated commonly retain blanket INSERT/DELETE grants on public
-- tables, with RLS as the real gate — so asserting "anon holds no INSERT grant"
-- would fail on a perfectly secure database. The control that actually exists is
-- default-deny: with RLS enabled (S002.6) and no INSERT/DELETE policy naming anon
-- or PUBLIC, no anon insert or delete can succeed whatever the grant says.
--
-- If this ever fails, do not just drop the policy — find out what needed it.
-- Profile rows are normally created server-side (auth trigger / service_role).
-- Note that trg_profiles_enforce_safe_defaults_insert is currently a backstop for
-- a path nothing can reach: `profiles` has no INSERT policy at all, so RLS
-- default-deny rejects every client INSERT before the trigger is consulted
-- (verified: `ERROR: new row violates row-level security policy`). It is not
-- redundant — it is what makes adding an INSERT policy later a safe change rather
-- than an instant reputation hole — but do not mistake it for the active control.
SELECT 17, 'S002.5', 'profiles/rls', 'no RLS policy lets anon INSERT or DELETE profiles',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' policy/policies expose anon INSERT/DELETE' END,
  coalesce('exposed by: ' || string_agg(policyname || ' (' || cmd || ' → ' || roles::text || ')', ', '),
           'default-deny holds; raw grants (gated by RLS) — insert='
             || pg_catalog.has_any_column_privilege('anon', 'public.profiles', 'INSERT')::text
             || ' delete=' || pg_catalog.has_table_privilege('anon', 'public.profiles', 'DELETE')::text)
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
  AND cmd IN ('INSERT', 'DELETE', 'ALL')
  AND (roles::text[] && ARRAY['anon', 'public'])

UNION ALL
-- Same reasoning as S001.5: policies without RLS are decoration.
SELECT 18, 'S002.6', 'profiles/rls', 'RLS is enabled on profiles',
  CASE WHEN bool_and(relrowsecurity) THEN 'PASS' ELSE 'FAIL: RLS disabled on profiles' END,
  'relrowsecurity=' || bool_and(relrowsecurity)::text
FROM pg_class WHERE oid = 'public.profiles'::regclass

UNION ALL
-- L2: the defence-in-depth trigger that reverts protected changes even if the
-- column grant is ever loosened. Verified by name AND bound function AND enabled
-- AND SECURITY DEFINER — it reads profiles.is_admin, so it needs to see rows RLS
-- would otherwise hide from the calling user. tgrelid is pinned to profiles so a
-- same-named trigger elsewhere cannot satisfy this check.
-- Installed is not the same as enforcing: S002.13 checks that the trigger's
-- trusted-write escape hatch has not been pinned open.
SELECT 19, 'S002.7', 'profiles/trigger', 'both profiles guard triggers installed, enabled, correctly timed and bound',
  CASE WHEN count(*) <> 2 THEN 'FAIL: expected 2 profiles guard triggers in expected_guard_triggers'
       WHEN bool_and(ok) THEN 'PASS'
       ELSE 'FAIL: guard trigger missing, disabled, mistimed, misbound, or its body was altered' END,
  string_agg(detail, '; ' ORDER BY tgname)
FROM guard_trigger_state WHERE relname = 'profiles'

UNION ALL
-- The recompute functions are the ONLY legitimate writers of rating /
-- review_count / total_sales. They must be SECURITY DEFINER with a pinned
-- search_path, because they set the transaction-local trusted-write flag that
-- lets them through the L2 trigger — an unpinned search_path here would be the
-- single highest-value hijack target in the whole design.
SELECT 20, 'S002.8', 'profiles/recompute', 'reputation recompute functions are hardened SECURITY DEFINER',
  CASE WHEN count(*) <> 2 THEN 'FAIL: expected 2 recompute functions, found ' || count(*)
       WHEN bool_and(secdef AND owner_ok AND path_pinned AND path_safe) THEN 'PASS'
       ELSE 'FAIL: recompute function not SECDEF, owner reassigned, or search_path unpinned/unsafe' END,
  coalesce(string_agg(proname || '(secdef=' || secdef::text
                      || ' owner=' || owner
                           || CASE WHEN owner_ok THEN '' ELSE ' EXPECTED ' || (SELECT rolname FROM app_owner) END
                      || ' cfg=' || cfg
                           || CASE WHEN path_pinned AND path_safe THEN '' ELSE ' UNSAFE' END
                      || ')', '; ' ORDER BY proname),
           '(both absent)')
FROM fn_hardening
WHERE proname IN ('recompute_profile_rating', 'recompute_profile_total_sales')

UNION ALL
-- ...and they must actually be WIRED, each to its own table. Locked columns with
-- no recompute trigger would freeze reputation at its backfilled values: no
-- error, no alert, just a marketplace whose ratings quietly stop moving. This is
-- the most easily overlooked failure mode in SECURITY-002.
--
-- Driven from expected_recompute_triggers via a LEFT JOIN so that a MISSING
-- trigger still produces a row saying which pairing is absent. Matching on
-- (tgname, table) together is essential — see WRONG-OBJECT TRAP in the header:
-- this check once passed while both triggers sat on an unrelated table.
SELECT 21, 'S002.9', 'profiles/recompute', 'recompute triggers wired on reviews and orders, on the right events and columns',
  CASE WHEN count(*) <> 2 THEN 'FAIL: expected 2 recompute triggers in expected_recompute_triggers'
       WHEN count(*) FILTER (WHERE t.tgenabled = 'O' AND t.tgtype = x.tgtype
                               AND t.updcols = x.updcols) = 2 THEN 'PASS'
       ELSE 'FAIL: reputation would freeze — recompute trigger missing, disabled, on the wrong table, or narrowed to fewer events/columns' END,
  string_agg(x.tgname || ' on public.' || x.relname || ' → '
             || coalesce('found (enabled=' || t.tgenabled::text || ' tgtype=' || t.tgtype::text
                  || CASE WHEN t.tgtype = x.tgtype THEN '' ELSE ' EXPECTED ' || x.tgtype::text END
                  || ' cols=' || CASE WHEN t.updcols = '' THEN 'all' ELSE t.updcols END
                  || CASE WHEN t.updcols = x.updcols THEN ''
                          ELSE ' EXPECTED ' || CASE WHEN x.updcols = '' THEN 'all' ELSE x.updcols END END
                  || ')',
                  'MISSING'),
             '; ' ORDER BY x.tgname)
FROM expected_recompute_triggers x
LEFT JOIN (
  SELECT tg.tgname::text AS tgname, c.relname::text AS relname, tg.tgenabled, tg.tgtype,
         coalesce((SELECT string_agg(a.attname, ',' ORDER BY a.attname)
                   FROM unnest(tg.tgattr::int2[]) col
                   JOIN pg_attribute a ON a.attrelid = tg.tgrelid AND a.attnum = col), '') AS updcols
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT tg.tgisinternal AND n.nspname = 'public'
) t ON t.tgname = x.tgname AND t.relname = x.relname

UNION ALL
-- ── Aggregate drift ─────────────────────────────────────────────────────────
-- The three stored aggregates must equal what their source tables say. Drift
-- means either a forged value that predates the lockdown and survived the
-- backfill, or a recompute path that has stopped working.
--
-- Split into one check per column rather than one combined check: when this
-- fires you want to know WHICH aggregate drifted, because rating and total_sales
-- have completely different root causes. All three read the shared, materialized
-- reputation_drift CTE, so the source tables are scanned once in total.
--
-- All three open with the EMPTY-SET TRAP guard, and it is not theoretical here.
-- These are the only checks in the file that read DATA rather than catalog, so
-- they are the only ones RLS can silently narrow. Demonstrated: a role holding
-- SELECT but subject to a restrictive `profiles` policy sees zero rows, every
-- drifted profile disappears from the scan, and all three checks report
-- "all 0 profiles agree" — PASS — on a database with real forged reputation.
-- Zero rows examined is a failure to verify, never a verification of safety.
-- (A genuinely empty `profiles` table also fails here. That is intended: an empty
-- profiles table means you are on the wrong database, not that reputation is sound.)
SELECT 22, 'S002.10', 'profiles/integrity', 'profiles.rating matches reviews',
  CASE WHEN count(*) = 0 THEN 'FAIL: examined 0 profiles — RLS-narrowed session, or wrong database'
       WHEN count(*) FILTER (WHERE rating_drift) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) FILTER (WHERE rating_drift) || ' profile(s) with forged or stale rating' END,
  CASE WHEN count(*) = 0 THEN 'no profile rows visible to this session — re-run as the table owner'
       WHEN count(*) FILTER (WHERE rating_drift) = 0
       THEN 'all ' || count(*) || ' profiles agree with round(avg(reviews.rating),1)'
       ELSE 'drifted ids: ' || left(string_agg(id::text, ', ') FILTER (WHERE rating_drift), 400) END
FROM reputation_drift

UNION ALL
SELECT 23, 'S002.11', 'profiles/integrity', 'profiles.review_count matches reviews',
  CASE WHEN count(*) = 0 THEN 'FAIL: examined 0 profiles — RLS-narrowed session, or wrong database'
       WHEN count(*) FILTER (WHERE review_count_drift) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) FILTER (WHERE review_count_drift) || ' profile(s) with forged or stale review_count' END,
  CASE WHEN count(*) = 0 THEN 'no profile rows visible to this session — re-run as the table owner'
       WHEN count(*) FILTER (WHERE review_count_drift) = 0
       THEN 'all ' || count(*) || ' profiles agree with count(reviews)'
       ELSE 'drifted ids: ' || left(string_agg(id::text, ', ') FILTER (WHERE review_count_drift), 400) END
FROM reputation_drift

UNION ALL
SELECT 24, 'S002.12', 'profiles/integrity', 'profiles.total_sales matches completed orders',
  CASE WHEN count(*) = 0 THEN 'FAIL: examined 0 profiles — RLS-narrowed session, or wrong database'
       WHEN count(*) FILTER (WHERE total_sales_drift) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) FILTER (WHERE total_sales_drift) || ' profile(s) with forged or stale total_sales' END,
  CASE WHEN count(*) = 0 THEN 'no profile rows visible to this session — re-run as the table owner'
       WHEN count(*) FILTER (WHERE total_sales_drift) = 0
       THEN 'all ' || count(*) || ' profiles agree with count(orders where status=completed)'
       ELSE 'drifted ids: ' || left(string_agg(id::text, ', ') FILTER (WHERE total_sales_drift), 400) END
FROM reputation_drift

UNION ALL
-- S002.7 proves the L2 trigger is INSTALLED. This proves it still ENFORCES.
--
-- The L2 trigger's first act is to wave through any session where
-- `app.reputation_trusted_write` = '1'. That escape hatch is meant to be
-- transaction-local, set by the SECURITY DEFINER recompute functions for the
-- duration of one statement and cleared immediately. PostgREST cannot set app.*
-- GUCs, so a client can never reach it — but a *pinned* default can, and then
-- every session starts trusted and L2 is silently disabled for everybody while
-- the trigger still sits there looking healthy.
--
-- Reproduced: `ALTER DATABASE <db> SET app.reputation_trusted_write='1'` lets a
-- normal user's UPDATE write straight through the guard. The drift checks catch
-- the fallout for rating/review_count/total_sales but NOT for is_admin,
-- is_verified, badge, verified_at or created_at, which have no source of truth
-- to compare against — so without this check a privilege escalation through a
-- disabled L2 is invisible.
--
-- Both pinning mechanisms must be covered, and neither alone is sufficient:
--   • pg_db_role_setting catches ALTER DATABASE ... SET and ALTER ROLE ... SET.
--     ALTER ROLE authenticated SET is invisible to pg_catalog.current_setting() here,
--     because this suite runs as postgres, not as authenticated.
--   • pg_catalog.current_setting() catches a value arriving any other way (postgresql.conf,
--     ALTER SYSTEM, or a SET issued earlier in this same editor session).
-- NULL and '' are both treated as clean: '' is what the recompute functions
-- write when they clear the flag.
SELECT 25, 'S002.13', 'profiles/trigger', 'trusted-write escape hatch is not pinned on (L2 still enforces)',
  CASE WHEN count(*) = 0 AND coalesce(pg_catalog.current_setting('app.reputation_trusted_write', true), '') = ''
       THEN 'PASS'
       ELSE 'FAIL: app.reputation_trusted_write is pre-set — the L2 profiles guard is bypassed for every session' END,
  CASE WHEN count(*) = 0 AND coalesce(pg_catalog.current_setting('app.reputation_trusted_write', true), '') = ''
       THEN 'transaction-local only: unset in this session, and no per-database or per-role default pins it'
       ELSE 'this session sees ''' || coalesce(pg_catalog.current_setting('app.reputation_trusted_write', true), '(unset)') || ''''
            || coalesce('; pinned by ' || string_agg(
                 coalesce(d.datname, 'ALL DATABASES') || '/' || coalesce(r.rolname, 'ALL ROLES'), ', '), '') END
FROM pg_db_role_setting s
LEFT JOIN pg_database d ON d.oid = s.setdatabase
LEFT JOIN pg_roles    r ON r.oid = s.setrole
WHERE array_to_string(s.setconfig, ',') LIKE '%app.reputation_trusted_write%'
  -- pg_db_role_setting is CLUSTER-wide. Only rows that can affect sessions on
  -- THIS database count: setdatabase = 0 means "every database" (an
  -- `ALTER ROLE x SET ...` with no IN DATABASE clause), otherwise it must be us.
  -- Without this filter the check false-alarms on a setting pinned to some
  -- unrelated database sharing the cluster.
  AND (s.setdatabase = 0
       OR s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))

UNION ALL
-- The profiles counterpart of S001.12. L1 (column grants) and L2 (the BEFORE ROW
-- trigger) both assume the write arrives as an UPDATE against `profiles` itself.
-- `CREATE VIEW v AS SELECT * FROM profiles` + `GRANT UPDATE ON v TO authenticated`
-- is auto-updatable, runs with the view OWNER's rights, and is published by
-- PostgREST as its own endpoint — so it defeats the column allowlist AND RLS in a
-- single statement, with the trigger never consulted. A `DO ALSO` rule does the
-- same at parse time. Both reproduced; both left the other 26 checks green.
SELECT 26, 'S002.14', 'profiles/bypass', 'no view or rule writes profiles behind the guards',
  CASE WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' bypass path(s) reach profiles without the guards' END,
  coalesce('bypass: ' || string_agg(kind || ' ' || objname, ', ' ORDER BY objname),
           'no client-writable view and no rewrite rule on profiles')
FROM bypass_surface WHERE relname = 'profiles'

UNION ALL
-- SECURITY-002 stops clients writing `profiles.rating` directly, and makes the
-- recompute triggers the only writers. That converts the problem rather than
-- solving it: the value is now whatever `reviews` says, so `reviews` inherits the
-- entire trust burden. If a client can forge a row there, it can still set its own
-- Trust Score — the recompute trigger will faithfully copy the forgery into
-- `profiles.rating` and every check S002.10 makes will agree, because the stored
-- value genuinely does match its source.
--
-- This is the check most likely to fail on a real database, and it is NOT
-- redundant with the RLS checks above, because it covers a table SECURITY-002
-- never touched. NO migration in this repository ever runs
-- `ALTER TABLE reviews ENABLE ROW LEVEL SECURITY` — `reviews` carries an INSERT
-- policy that is pure decoration unless RLS was switched on by hand in the
-- dashboard, and `authenticated` holds table-wide INSERT and UPDATE grants on it.
-- Whether production is safe here cannot be answered from the repository; it can
-- only be answered by this check, on the live database.
--
-- Passing requires RLS enabled AND no policy handing UPDATE or DELETE of reviews
-- to a client role. INSERT is expected and is gated by the existing
-- reviews_insert_order_party_only policy (which only binds once RLS is on).
-- Three ways `reviews` can be forgeable, all checked here, because they are three
-- routes to the same outcome and any one of them is sufficient:
--   1. RLS off      — the INSERT policy is decoration and the raw grants govern
--   2. a client UPDATE/DELETE policy — lets a review be edited after the fact
--   3. a bypass path — a writable view (at any nesting depth) or a rewrite rule
-- (3) is not covered by S001.12 or S002.14: those are scoped to orders and
-- profiles. `reviews` earns its own, because it is where rating originates.
SELECT 27, 'S002.15', 'reviews/integrity', 'reviews (the source of truth for rating) is not client-forgeable',
  CASE WHEN NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reviews'::regclass)
       THEN 'FAIL: RLS is DISABLED on reviews — its policies do not apply and any client can forge reviews'
       WHEN (SELECT count(*) FROM bypass_surface WHERE relname = 'reviews') > 0
       THEN 'FAIL: ' || (SELECT count(*) FROM bypass_surface WHERE relname = 'reviews')
            || ' view/rule bypass path(s) write reviews behind its policies'
       WHEN count(*) = 0 THEN 'PASS'
       ELSE 'FAIL: ' || count(*) || ' policy/policies let a client role UPDATE or DELETE reviews' END,
  'rls=' || (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reviews'::regclass)::text
    || ' | raw grants (gated by RLS only): insert='
    || pg_catalog.has_any_column_privilege('authenticated', 'public.reviews', 'INSERT')::text
    || ' update=' || pg_catalog.has_any_column_privilege('authenticated', 'public.reviews', 'UPDATE')::text
    || ' delete=' || pg_catalog.has_table_privilege('authenticated', 'public.reviews', 'DELETE')::text
    || ' | ' || coalesce('client write policies: ' || string_agg(policyname || ' (' || cmd || ')', ', '),
                         'no client UPDATE/DELETE policy')
    || ' | ' || coalesce((SELECT 'bypass: ' || string_agg(kind || ' ' || objname, ', ' ORDER BY objname)
                          FROM bypass_surface WHERE relname = 'reviews'), 'no view/rule bypass')
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'reviews'
  AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  AND (roles::text[] && ARRAY['anon', 'authenticated', 'public'])

UNION ALL
-- S002.15 asks whether a client can forge a review it was not entitled to write.
-- This asks the question one layer deeper: given a review it IS entitled to write,
-- can it forge the VALUE? `reviews.rating` is a bare `integer` — no CHECK, no
-- domain, no bound anywhere in the migration history.
--
-- Reproduced end to end: one review on a genuine completed order, satisfying every
-- policy, with rating = 2147483647. The recompute trigger faithfully averaged it in
-- and profiles.rating became 715827883.7 — and S002.10 reported PASS, "all 50
-- profiles agree", because the stored value genuinely DOES match round(avg(...)).
-- Every drift check in this file agrees with a forged Trust Score, by construction.
-- This is the one check that can catch it.
--
-- Both halves are required and neither implies the other: out-of-range DATA proves
-- a forgery has already happened; a missing CONSTRAINT proves the next one is
-- unopposed. If the bound is enforced some other way (domain type, trigger), this
-- will FAIL — update the reference below deliberately rather than deleting it.
SELECT 28, 'S002.16', 'reviews/integrity', 'reviews.rating is bounded to the 1-5 star domain',
  CASE WHEN (SELECT count(*) FROM reviews WHERE rating IS NULL OR rating < 1 OR rating > 5) > 0
       THEN 'FAIL: ' || (SELECT count(*) FROM reviews WHERE rating IS NULL OR rating < 1 OR rating > 5)
            || ' review(s) hold an out-of-range rating — profiles.rating is already forged'
       WHEN count(*) = 0
       THEN 'FAIL: no CHECK constraint bounds reviews.rating — any entitled reviewer can set it to INT_MAX'
       ELSE 'PASS' END,
  'out-of-range rows=' || (SELECT count(*) FROM reviews WHERE rating IS NULL OR rating < 1 OR rating > 5)::text
    || ' | observed range=' || coalesce((SELECT min(rating)::text || '..' || max(rating)::text FROM reviews), 'no reviews')
    || ' | ' || coalesce('bounding constraint: ' || string_agg(conname, ', '),
                         'NO bounding CHECK constraint on reviews.rating')
FROM pg_constraint
WHERE conrelid = 'public.reviews'::regclass AND contype = 'c'
  AND pg_catalog.pg_get_constraintdef(oid) ~* 'rating'

UNION ALL
-- The other way to forge a rating without forging any single review: write MANY.
-- This index is the only thing stopping one party posting twenty reviews against
-- one completed order. Reproduced with it dropped: a single genuine order let one
-- buyer drag a seller from 5.0 to 1.4, and every other check stayed green —
-- including the drift checks, since the stored average honestly reflected all
-- twenty rows.
--
-- THE COLUMN SET IS THE BUSINESS RULE, and it is exactly (order_id,
-- reviewer_role). An order has exactly one buyer and one seller, so role already
-- identifies the party uniquely within that order: at most one buyer review and
-- one seller review per order, full stop. Adding `reviewer_id` to the key would
-- WEAKEN it, not tighten it — (order, buyer, 'buyer') and (order, someone_else,
-- 'buyer') would become distinct keys, so a second identity reviewing in the same
-- role would pass. That is why a 3-column index FAILS this check rather than
-- satisfying it, and why the equality below is exact rather than "contains".
--
-- Note the deployed index name `one_review_per_order_role` is accurate for this
-- 2-column rule; migration 20260718000002 declares it over three columns, so the
-- repo and production disagree here. Production is authoritative per the
-- SECURITY-002 business-rule decision; the migration is the thing that needs
-- correcting, under its own ticket.
--
-- Four ways this can be satisfied on paper but not in fact, all mutation-tested:
--   • index absent            — 20260718000002 creates it inside a
--                               `DO $$ ... EXCEPTION WHEN others THEN RAISE
--                               WARNING` block, so a failed creation on
--                               production ships silently as a success
--   • not UNIQUE              — indisunique
--   • PARTIAL (`WHERE ...`)   — indpred IS NULL; a partial unique index leaves
--                               every row outside its predicate unconstrained
--   • extra/expression key    — indnkeyatts pins the key width at exactly 2, so
--                               neither an added column nor an expression key
--                               (which resolves to no pg_attribute row and would
--                               otherwise let the name set match anyway) counts
-- INCLUDE columns are deliberately tolerated: they are payload, not key, and do
-- not affect uniqueness. Matched on column set rather than name — uniqueness is
-- the control — with the name reported in detail because the frontend's
-- duplicate-review error handler has keyed on it since FRONTEND-005.
SELECT 29, 'S002.17', 'reviews/integrity', 'one review per (order, reviewer_role) is enforced',
  CASE WHEN count(*) > 0 THEN 'PASS'
       ELSE 'FAIL: no unconditional UNIQUE index on reviews(order_id, reviewer_role) — one party can flood a seller''s rating' END,
  coalesce('enforced by: ' || string_agg(idxname, ', '),
           'MISSING — no unique index whose exact key is (order_id, reviewer_role). '
           || 'Present on reviews: ' || coalesce((
                SELECT string_agg(ic2.relname || '(' || pg_catalog.pg_get_indexdef(i2.indexrelid) || ')', '; ')
                FROM pg_index i2 JOIN pg_class ic2 ON ic2.oid = i2.indexrelid
                WHERE i2.indrelid = 'public.reviews'::regclass), '(no indexes)'))
FROM (
  SELECT ic.relname::text AS idxname
  FROM pg_index i
  JOIN pg_class ic ON ic.oid = i.indexrelid
  WHERE i.indrelid = 'public.reviews'::regclass
    AND i.indisunique
    AND i.indpred IS NULL
    AND i.indnkeyatts = 2
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, pos)
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
         WHERE k.pos <= i.indnkeyatts)
        = ARRAY['order_id', 'reviewer_role']
) u

)

-- ── Output ────────────────────────────────────────────────────────────────────
-- Per-check rows in check_id order, then a single summary row last.
-- Read the summary first; if it says anything other than ALL CHECKS PASSED, the
-- rows above name every control that is not in force.
--
-- Sorting is on the numeric `ord`, never on check_id — a text sort would order
-- S001.10 and S001.11 between S001.1 and S001.2, which reads as though checks
-- are missing. `ord` is selected in the inner query and used only for ordering.
SELECT check_id, area, check_name, status, detail
FROM (
  SELECT ord, check_id, area, check_name, status, detail
  FROM checks

  UNION ALL

  SELECT 9999, '═══ SUMMARY ═══', 'all areas', count(*)::text || ' checks run',
         CASE WHEN count(*) FILTER (WHERE status <> 'PASS') = 0
              THEN 'ALL CHECKS PASSED'
              ELSE count(*) FILTER (WHERE status <> 'PASS')::text || ' CHECK(S) FAILED' END,
         CASE WHEN count(*) FILTER (WHERE status <> 'PASS') = 0
              THEN 'SECURITY-001 and SECURITY-002 are in force on this database'
              ELSE 'investigate: ' || string_agg(check_id, ', ' ORDER BY ord) FILTER (WHERE status <> 'PASS') END
  FROM checks
) report
ORDER BY ord;
