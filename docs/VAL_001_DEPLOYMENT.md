# VAL-001 — Production Deployment Package

**Branch:** `val-001-valuation-safety` · **Prepared:** 2026-08-05 · **State:** nothing applied

Read section 0 before opening the SQL Editor. One of the gates there will take
production scanning to a hard stop if it is skipped.

---

## 0. Pre-flight gates

### 0.1 BLOCKER — confirm the service-role key is set in production

`api/analyze.js:1466` builds the Supabase client with a **fallback chain**:

```js
const key = process.env.SUPABASE_SERVICE_KEY
         || process.env.SUPABASE_KEY
         || process.env.VITE_SUPABASE_ANON_KEY;   // ← silent anon fallback
```

If neither `SUPABASE_SERVICE_KEY` nor `SUPABASE_KEY` is set in the Vercel
production environment, that client is built with the **anon key** — and today
it still works, because anon currently holds EXECUTE on the quota RPCs. That is
precisely the vulnerability migration 1 closes.

The moment migration 1 is applied:

1. `check_and_increment_scan_rate` returns a permission error for anon;
2. the rate limiter treats any RPC error as **fail-closed**
   (`api/analyze.js:1027` → `{ allowed: false, limitType: 'quota_error' }`);
3. **every scan for every user is denied.** Total outage of the core product
   flow, not a partial degradation.

**Gate:** confirm the variable is present and non-empty in the Production
environment before applying migration 1.

```bash
vercel env ls production | grep -E 'SUPABASE_(SERVICE_)?KEY'
```

If it is absent, set it and redeploy **first**. This gate applies to migration 1
only; 2–4 are unaffected.

### 0.2 Scope — apply exactly four files, nothing else

The working tree contains untracked migrations that are **not** part of VAL-001
and must not be swept into this deploy:

- `supabase/migrations/20260607000004_notify_order_email_trigger.sql`
- `supabase/functions/notify-order-email/`

Both belong to the order-email feature. Leave them alone.

### 0.3 Apply path

This project has **no `supabase/config.toml`**, so `supabase db push` is not
available. Use one of:

- **Supabase dashboard → SQL Editor**, pasting each file whole. The files contain
  no `psql` meta-commands (`\i`, `\set`), so they paste cleanly.
- **Management API** query endpoint with a personal access token — runs as
  `postgres`.

Apply **one file at a time**, in the order below, and read the result before
starting the next.

---

## 1. Exact migration order

| # | File | Must run after |
|---|---|---|
| 1 | `20260730000001_val001_scan_quota_lockdown.sql` | gate 0.1 cleared |
| 2 | `20260730000002_val001_valuations_column_freeze.sql` | — |
| 3 | `20260730000003_val001_products_trgm_indexes.sql` | — |
| 4 | `20260730000004_val001_valuation_constraints.sql` | 2 (recommended) |

**Ordering rationale.** This is timestamp order and it is the order the
verification suite documents. The real constraints are looser than the table
suggests:

- **1 and 3 are fully independent** of the other three. They touch different
  objects (quota RPCs; `products` indexes) and could run in any position.
- **2 before 4 is a recommendation, not a hard dependency.** They are the two
  halves of one idea — 2 bounds *who may write* a price, 4 bounds *what value is
  writable* — and each migration's header tells you to read them together.
  Applying 4 first would work, but leaves a window where values are bounded
  while authorship is not, which is the weaker of the two orderings.

There is no in-file dependency check that enforces ordering between the four.
Each one independently verifies the **pre-existing** schema it needs (§3).

---

## 2. Purpose of each migration

### 1 — `val001_scan_quota_lockdown` (579 lines)

Locks down three `SECURITY DEFINER` quota functions that shipped with **no
GRANT or REVOKE at all**: `increment_user_daily_scan`,
`decrement_user_daily_scan`, `check_and_increment_scan_rate`. Supabase's default
privileges write a direct EXECUTE grant to `anon` at CREATE time, so all three
were callable through PostgREST by anyone holding the publishable key, and their
bodies took both the user id *and* the limits from the caller.

Closes four live consequences: unlimited free scans (the daily quota is the only
cost ceiling on the Anthropic + Vision path), quota exhaustion against a named
user, per-IP burst-window poisoning, and caller-supplied quota policy.

Changes: `REVOKE ALL … FROM PUBLIC, anon, authenticated` → `GRANT EXECUTE TO
service_role`; adds an L1 server-only guard to each body; clamps the three limit
parameters with `LEAST()` against server-side authoritative values so a caller
can only ever be *more* restrictive; pins `search_path` on all three.

### 2 — `val001_valuations_column_freeze` (465 lines)

Makes true an anti-forgery invariant that `api/confirm-identity.js` already
documents but that RLS did not enforce. RLS on `valuations` is ownership-only
with no column restriction, so an authenticated user could PATCH their own row's
`ai_raw_response` / `ai_name` / price columns, or INSERT a fabricated valuation —
and `confirm-identity` derives the shared cross-user recognition-memory identity
from exactly those fields.

Changes: `REVOKE UPDATE` from `authenticated` and `anon`, then re-`GRANT UPDATE`
on **only** `(user_confirmed, user_correction, identified_by, listing_id)`;
`REVOKE INSERT, DELETE` from `anon`; adds an `origin` column with a BEFORE INSERT
stamp trigger; adds a BEFORE UPDATE trigger that reverts protected-column changes
and logs a warning.

`authenticated` deliberately keeps INSERT and DELETE — those are governed by the
ownership RLS policies, and narrowing INSERT would break the client-side offline
backup path.

### 3 — `val001_products_trgm_indexes` (275 lines)

Four `gin_trgm_ops` GIN indexes on `products` (`brand`, `model`, `name`,
`category`), matching the `ILIKE '%token%'` predicates already in the retrieval
path.

**This is not a performance improvement today, and its own header says so.** At
~1,854 rows the planner will almost certainly keep choosing a sequential scan,
and scan time will not change. It ships because the cost is near zero (<2 MB
total, no indexed column on the write-back hot path, millisecond build) and the
plan flips on its own when the catalog grows — with no code change. Do not cite
it as a speedup in a release note.

### 4 — `val001_valuation_constraints` (337 lines)

A declarative floor under every stored price, enforced by the database rather
than by whichever code path is writing — including `SECURITY DEFINER` writers
like `record_scan()`, which a session-flag trigger would let through.

Four CHECK constraints: `valuations_price_nonneg`, `valuations_price_ordered`
(`low <= mid <= high`, each pair NULL-guarded independently),
`valuations_price_ceiling` (100,000,000), `price_observations_price_sane`.

These are **arithmetic** constraints. They make a stored price a coherent number,
not an honest one — a `price_mid` of 99,000,000 satisfies all four. Honesty is
the runtime guard's job (`api/_lib/valuation-guard.js`).

---

## 3. Dependencies

Every migration opens with a preflight block that raises a descriptive
`EXCEPTION` and aborts if its prerequisites are absent. None of them will apply
partially against the wrong database.

| # | Requires | Preflight aborts on |
|---|---|---|
| 1 | `20260518000004`, `20260625000001`, `20260625000002`; tables `scan_daily_usage`, `scan_rate_log` | missing table; missing function; **function signature drift**; RLS off on `scan_daily_usage`; any RLS *policy* present on it |
| 2 | `20260607000001` (valuations RLS); `public.valuations` | table absent; missing annotation column (the UPDATE allowlist would silently narrow); missing authoritative column; RLS not enabled |
| 3 | `public.products` with `brand`, `model`, `name`, `category` | missing column |
| 4 | `public.valuations`; `public.price_observations` | missing price column on either table |

Two details worth knowing:

- **Migration 1 checks signatures, not just names.** If any of the three quota
  functions has drifted from its expected argument list, it aborts rather than
  replacing something it did not analyse.
- **Migration 3 creates `pg_trgm` if absent**, into the `extensions` schema when
  that schema exists, otherwise the default. Requires privileges to
  `CREATE EXTENSION` — you have them running as `postgres` via the SQL Editor.

---

## 4. Idempotency

**All four are idempotent and safe to re-run.** Verified by the DB review.

| # | Mechanism |
|---|---|
| 1 | `CREATE OR REPLACE FUNCTION`; `REVOKE`/`GRANT` are no-ops when already in the target state; `ALTER FUNCTION … SET search_path` re-asserted in the same loop |
| 2 | Column/table `REVOKE`/`GRANT`; `ADD COLUMN IF NOT EXISTS`; `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`; `CREATE OR REPLACE FUNCTION` |
| 3 | `CREATE EXTENSION` guarded by a `pg_extension` lookup; `CREATE INDEX IF NOT EXISTS`, plus a postcondition validating **actual index shape**, not just the name — a same-named wrong-shaped index is caught rather than silently accepted |
| 4 | Each `ADD CONSTRAINT` guarded by a `pg_constraint` existence check; `VALIDATE` skipped when already `convalidated`. Safe after a partial apply |

**Migration 4 cannot hard-fail on dirty data.** It adds each constraint
`NOT VALID`, then counts violating rows. If any exist it raises a `WARNING` and
**skips `VALIDATE`** — the constraint still binds every future write, and you can
clean the rows and re-run to promote it. This is a sanctioned outcome, not an
error. See §5.2 for why you will probably not see that warning.

`CREATE INDEX CONCURRENTLY` is deliberately **not** used anywhere, because the
SQL Editor runs each paste as a single transaction and `CONCURRENTLY` cannot run
inside one. This is documented in migration 3's header.

---

## 5. Expected SQL Editor output

### 5.1 What success looks like

Each file's executable content is `DO $$ … $$` blocks and DDL. None of them
returns a result set, so the SQL Editor will report:

> **Success. No rows returned**

**Silence is the success signal.** Every migration ends with a postcondition
block that raises an `EXCEPTION` if the intended end state was not reached, and
an exception surfaces in the SQL Editor as a red error with the message text. So:

- **No error → the postconditions passed.** Migration 1 alone asserts that
  EXECUTE is no longer misgranted, that all three functions are `SECURITY
  DEFINER` owned by the table owner, that `search_path` is pinned, that the L1
  guard is present in each body, that the limit clamp is present, and that
  `scan_daily_usage` still has RLS on with zero policies.
- **Red error beginning `VAL-001 abort:`** → a *preflight* failure. Nothing was
  changed. Read the message; it names the missing object or the drift.
- **Red error beginning `VAL-001 postcondition failed:`** → the migration ran but
  did not reach its target state. Do **not** proceed to the next file.

### 5.2 The one caveat — `RAISE NOTICE` may not render

The migrations emit informative notices (`VAL-001 hardened …`, `ensured
idx_products_… `, `… validated (convalidated = true)`). **The Supabase SQL Editor
does not reliably surface `NOTICE`/`WARNING` output.** Do not treat their absence
as a problem, and more importantly:

> **Do not rely on seeing migration 4's "skipping VALIDATE" WARNING.** If
> pre-existing rows violate a constraint, that warning may be invisible and the
> migration will still report success. Confirm validation status from check
> **V001.13**, which reports `convalidated` explicitly (§6).

If you want the notices, run via `psql` instead, which prints them.

### 5.3 Per-file expectations

| # | Expect | Watch for |
|---|---|---|
| 1 | Success, no rows | Any `VAL-001 abort:` naming signature drift — stop and investigate |
| 2 | Success, no rows | `postcondition failed: authenticated UPDATE columns are […]` — the allowlist did not land |
| 3 | Success, no rows | Nothing. Lowest-risk file |
| 4 | Success, no rows | Nothing visible; verify `convalidated` via V001.13 |

---

## 6. Production verification

Run **`tests/val_001_production_verification.sql`** after all four are applied.

It is **genuinely read-only** — the executable body is a single `WITH … SELECT`
(CTEs + `UNION ALL`) with no `INSERT`/`UPDATE`/`DELETE`/`SET ROLE`/DDL anywhere.
The `MUTATION:` lines are comments documenting what would break each check.
Confirmed safe against production by the DB review.

Paste it whole into the SQL Editor. It returns **16 rows**: 15 checks plus a
`SUMMARY` row.

**Read the SUMMARY row first.** Expected:

```
SUMMARY | VAL-001 verification result | ALL CHECKS PASSED | 14 passed, 0 failed, 1 informational
```

Every row carries `status` (`PASS`, `FAIL: <reason>`, or `INFO`) and a `detail`
column with the observed value — on pass and fail alike, so you can sanity-check
a pass rather than trusting the label.

| Check | Asserts |
|---|---|
| V001.1 | `anon` holds no EXECUTE on any quota RPC |
| V001.2 | `authenticated` holds no EXECUTE either |
| V001.3 | `service_role` **does** hold EXECUTE on all three (the check that proves the app still works) |
| V001.4 | All three are `SECURITY DEFINER`, correctly owned, `search_path` pinned |
| V001.5 | A caller can no longer widen its own limits |
| V001.6 | `scan_daily_usage` keeps RLS on with **zero** policies |
| V001.7 | `authenticated` holds UPDATE on exactly the four annotation columns |
| V001.8 | `anon` holds no UPDATE and no INSERT on `valuations` |
| V001.9 | Freeze trigger installed, **enabled**, row-level BEFORE UPDATE |
| V001.10 | Trigger body still allowlists exactly those four columns |
| V001.11 | `origin` exists, defaults to `'server'`, BEFORE INSERT stamp present |
| V001.12 | RLS still on for `valuations`; every policy ownership-scoped |
| V001.13 | The four price constraints exist — **reports `convalidated`** |
| V001.14 | The four `pg_trgm` indexes exist on `products` |
| V001.15 | **INFORMATIONAL ONLY** — `misidentifications` / `upsert_correction` surface |

**V001.15 is informational and does not count as a failure.** V001.13 is the one
to read closely: a constraint can be present but unvalidated, which is a
sanctioned state (§4) that you should nonetheless know about.

---

## 7. Manual smoke-test checklist

Run against production after verification passes. Ordered by blast radius —
stop and roll back at the first failure.

**A. Scan flow (exercises migration 1 — highest risk)**

- [ ] Sign in and run one full scan end-to-end. It must complete and return a
      price.
- [ ] Check the function logs for `[RateLimit] allowed … dailyCount=N`. Seeing
      `denied source=db reason=rpc_failed` means gate 0.1 was missed — roll back
      migration 1 immediately.
- [ ] Confirm `dailyCount` **increments** across two consecutive scans (the
      charge path still works under `service_role`).
- [ ] Force a scan failure if you can; confirm the refund path logs
      `refunded daily quota` rather than `refund failed`.

**B. Valuation writes (exercises migration 2)**

All three client UPDATE paths were audited against the new four-column
allowlist and each writes only allowlisted columns — so these should pass. Verify
anyway:

- [ ] Confirm an identity on a scan result → `user_confirmed` / `identified_by`
      persist (`AppContext.jsx:2501`).
- [ ] Submit a correction → `user_confirmed` / `user_correction` persist
      (`:2447`).
- [ ] Publish a listing from a scan → `listing_id` lands on the valuation
      (`:3136`).
- [ ] Delete a valuation from history → still works (`authenticated` keeps
      DELETE).
- [ ] Spot-check a newly written valuation row: `origin` should read `'server'`.

**C. Price integrity (migration 4)**

- [ ] A new scan writes a valuation whose `price_low <= price_mid <= price_high`.
- [ ] A manual-priced result (guard degraded) stores `0/0/0` without a constraint
      error.

**D. Retrieval (migration 3)**

- [ ] Scan an item that previously matched a catalog product; confirm it still
      matches. Indexes must not change results, only plans.

**E. Negative control (optional, requires a throwaway account)**

- [ ] With a client-side session, attempt `PATCH /rest/v1/valuations?id=eq.<own>`
      setting `price_mid`. Expect the value to be **unchanged** (trigger reverts)
      or the request rejected. A successful change means migration 2 did not take.

---

## 8. Rollback considerations

### 8.1 The honest framing

Three of these four are **security migrations closing confirmed, live holes**.
Rolling 1 or 2 back re-opens a vulnerability that is currently exploitable with
nothing but the publishable anon key. Roll back only to restore service, and
treat it as an incident with a same-day fix-forward — not as a resting state.

Migration 3 is cosmetic and migration 4 is a safety net; both can sit rolled back
indefinitely without security impact.

### 8.2 Risk ranking

| # | Breakage risk | Why |
|---|---|---|
| 1 | **High** — but entirely concentrated in gate 0.1 | If the service key is set, risk is near zero; if not, it is a total scan outage. Binary |
| 2 | **Low–moderate** | All three client UPDATE paths were audited and write only allowlisted columns. Residual risk is an unaudited path or a future one |
| 4 | **Low** | Rejects writes only for genuinely out-of-range values. The runtime guard already prevents these |
| 3 | **Negligible** | Indexes change plans, never results |

### 8.3 Rollback statements

**Migration 3** — clean and complete:

```sql
DROP INDEX IF EXISTS public.idx_products_brand_trgm;
DROP INDEX IF EXISTS public.idx_products_model_trgm;
DROP INDEX IF EXISTS public.idx_products_name_trgm;
DROP INDEX IF EXISTS public.idx_products_category_trgm;
-- leave pg_trgm installed; dropping it is unnecessary and affects other objects
```

**Migration 4** — clean and complete:

```sql
ALTER TABLE public.valuations         DROP CONSTRAINT IF EXISTS valuations_price_nonneg;
ALTER TABLE public.valuations         DROP CONSTRAINT IF EXISTS valuations_price_ordered;
ALTER TABLE public.valuations         DROP CONSTRAINT IF EXISTS valuations_price_ceiling;
ALTER TABLE public.price_observations DROP CONSTRAINT IF EXISTS price_observations_price_sane;
```

**Migration 2** — restores the pre-VAL-001 (vulnerable) state:

```sql
DROP TRIGGER IF EXISTS trg_valuations_freeze_authoritative_update ON public.valuations;
DROP TRIGGER IF EXISTS trg_valuations_stamp_origin_insert         ON public.valuations;
GRANT UPDATE ON public.valuations TO authenticated;
-- Leave the `origin` column in place: it is nullable-safe for readers, has a
-- default, and dropping it loses provenance already recorded on real rows.
```

If the failure is narrower than "writes are broken", prefer **widening the
allowlist** over dropping the trigger:

```sql
GRANT UPDATE (user_confirmed, user_correction, identified_by, listing_id,
              <the column that broke>)
  ON public.valuations TO authenticated;
```

That keeps the freeze trigger — the part doing the real work — in force.

**Migration 1** — no clean one-statement rollback.

It used `CREATE OR REPLACE` on three function bodies, so restoring the previous
behaviour means re-applying the original definitions from
`20260518000004`, `20260625000001` and `20260625000002`. Re-granting EXECUTE
alone restores *reachability* but leaves the new L1 guard in the body, which will
still reject non-`service_role` callers:

```sql
-- Emergency reachability restore ONLY. Re-opens the quota vulnerability and is
-- NOT sufficient on its own — the L1 guard in each body still rejects anon.
GRANT EXECUTE ON FUNCTION public.check_and_increment_scan_rate(text, uuid, date, int, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_user_daily_scan(uuid, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_user_daily_scan(uuid, date) TO anon, authenticated;
```

**Because that rollback is awkward, gate 0.1 is the control that matters.** Fixing
the environment variable and redeploying is faster and safer than unwinding
migration 1. Verify the key before you apply, not after.

### 8.4 Ordering

Roll back in reverse (4 → 3 → 2 → 1). Nothing depends on anything else at
rollback time, so partial rollback of a single migration is safe.

---

## Appendix — file inventory

| Artifact | Path |
|---|---|
| Migration 1 | `supabase/migrations/20260730000001_val001_scan_quota_lockdown.sql` |
| Migration 2 | `supabase/migrations/20260730000002_val001_valuations_column_freeze.sql` |
| Migration 3 | `supabase/migrations/20260730000003_val001_products_trgm_indexes.sql` |
| Migration 4 | `supabase/migrations/20260730000004_val001_valuation_constraints.sql` |
| Production verification (read-only) | `tests/val_001_production_verification.sql` |
| Adversarial quota test — **disposable DB only** | `tests/val_001_quota_lockdown.test.sql` |
| Architecture contract | `docs/VALUATION_ARCHITECTURE.md` |

**`tests/val_001_quota_lockdown.test.sql` must never be run against production.**
It uses `SET ROLE` and writes rows. It is for a disposable Postgres fixture only;
its own header says so.
