# GW-SCAN-LAB-001 — Scan Lab: benchmark capture inside the installed PWA

Status: implemented on `scan-engine-v2`; the release that carries only Scan Lab is cut from the commit Production runs, `b3888a5` (§9). The storage SQL of §5 was approved and applied to Production on 2026-10-06 and every verification matched. **Not deployed. No paid call made.**

## 1. What it is

A private screen in the GetWorth PWA, for one allowlisted account, that replaces the localhost capture helper:

photograph an item → the original is stored byte for byte → the scan's own image preparation makes the prepared copy → a person confirms what the item is, with a provenance per value → capture readiness is shown in the app.

It makes no recognition, search or pricing call, and has no action that could start a benchmark.

## 2. Why the local helper could not simply be exposed

| Fact | Consequence |
|---|---|
| The helper writes to disk beside the manifest and has no authentication. Vercel functions have no persistent disk. | New server path. The helper is unchanged and stays development-only. |
| Vercel refuses a request body over 4.5 MB; iPhone originals are larger. | The phone uploads straight to private storage with a one-object token the server signs. The server then reads the object back and hashes it itself. |
| The benchmark runner is local and reads photographs from disk under the freeze. | `scripts/scan-lab-pull.mjs` downloads, re-verifies every hash, and writes through the helper's own manifest store. The runner, the freeze and the cost ceiling are untouched. |
| `tests/scan-v2-capture-helper.test.mjs` CH-2b forbids ground-truth vocabulary in `dist/`. | Slots and vocabularies are served by the authorized endpoint; they are not in the client bundle. |
| `tests/scan-v2-endpoints.test.mjs` V2-18 forbids database writes and new hosts under `api/_lib/v2`. | Scan Lab lives in `api/scan-lab.js` and `api/_lib/scan-lab/`. |

## 3. Architecture

```
iPhone PWA (ScanLabView)                    Vercel function                     Supabase
  file input (camera / library)
  SHA-256 + compressImage(1280, 0.82)
  queue in IndexedDB  ───────────────►  POST /api/scan-lab {begin}
                                          session → flag → allowlist
                                          sign 2 one-object upload tokens  ───► storage (service role)
  upload original + prepared ─────────────────────────────────────────────────► bucket scan-lab (private)
                      ───────────────►  {commit}: download, hash, compare  ◄──► bucket + table scan_lab_items
  ground-truth form   ───────────────►  {truth}: validate, store           ───► table scan_lab_items

benchmark machine:  scripts/scan-lab-pull.mjs ──(service role)──► verify hashes ──► photos/ + manifest ──► existing runner
```

Files:

| File | Role |
|---|---|
| `api/scan-lab.js` | The endpoint and its gate. |
| `api/_lib/scan-lab/config.js` | Flag, allowlist, service-key check, limits. |
| `api/_lib/scan-lab/sets.js` | The capture sets (data). Today: `preflight-5`. |
| `api/_lib/scan-lab/truth.js` | Ground-truth vocabulary and validation; image header reader. |
| `api/_lib/scan-lab/service.js` | state / begin / commit / truth / photo_url / remove / remove_set. |
| `api/_lib/scan-lab/store.js` | The only module that reaches storage. |
| `src/lib/scanLab.js`, `src/lib/scanLabDb.js` | Client: hashing, preparation, the resumable queue. |
| `src/views/ScanLabView.jsx`, `src/components/ScanLabTruthForm.jsx` | The screen. |
| `src/App.jsx`, `src/lib/urlSync.js`, `src/views/AuthProfileView.jsx` | Route `/scan-lab` and the Profile entry. |
| `src/contexts/AppContext.jsx` | The word `export` on two existing functions: `compressImage` and `assessImageDataUrl`. Nothing else. |
| `scripts/scan-lab-pull.mjs` | Pull to the benchmark machine. |
| `scripts/vite-dev-api.mjs` | Mounts the endpoint in local development. |

## 4. Authentication and security design

1. **Order of the gate**, for every action: method → session (the existing `verifyJWT`) → bounded body (64 KB) → `SCAN_LAB_ENABLED` → `SCAN_LAB_USER_IDS` → storage configured.
2. **Separate flag, separate allowlist.** `SCAN_LAB_ENABLED` must be exactly `true`. `SCAN_LAB_USER_IDS` empty admits nobody in any environment. Enabling Scan Engine V2 for an account does not open Scan Lab.
3. **A refused account learns nothing.** Flag off and "not on the list" are the same 403 body. Only an enrolled account is told that storage is not configured.
4. **The owner is the session subject.** No request field can name another account; every object path starts with the caller's id and cleanup never leaves that prefix.
5. **Storage is closed to browsers.** The bucket is private and a restrictive policy removes it from every browser role's view of `storage.objects`; the table has row security on, a restrictive deny and no grant (§5.2). The only door is the function holding the service-role key. A deployment without one is `UNAVAILABLE`.
6. **Uploads:** a token valid for one new object path, minted after authorization. **Downloads:** a link signed for 60 seconds. No public URL exists.
7. **Integrity:** the phone declares SHA-256, size and format; the server downloads what was uploaded and computes them itself. A mismatch is removed and never recorded. Captures are immutable: a retake is a new capture id and new paths. The record is written only while the row still expects that capture, so a commit overtaken by a newer begin records nothing. A storage fault while reading back is a 502, never "not uploaded".
   **Deletion** removes everything stored under the item (or the set) and fails, keeping the record, if storage refuses.
   **A confirmation belongs to a photograph:** it is stored with the capture it was made for, and a retake is not ready until it is confirmed again.
8. **Client flag `VITE_SCAN_LAB_ENABLED`** is a build-time convenience only. Without it the screen is not in the bundle. With it the screen is public code that holds no data.
9. **Secrets:** none in the client. The service key is read by the function and by the local pull script from the environment and is never logged or returned.

Known limits, stated plainly:

- The original keeps its EXIF; the prepared copy carries none. HEIC is refused at once with instructions. Both are set out in §8.
- The phone's queue is a resume buffer. If iOS evicts site storage before an upload finishes, that photograph must be retaken.
- Vercel environment changes take effect on the next deployment.
- With the build flag on, every signed-in user's Profile sends one probe to `/api/scan-lab` and, unless enrolled, gets a bare 403. The endpoint's name is therefore visible in a browser's network panel; nothing behind it is.
- The phone's queue is keyed by account and is not cleared on sign-out; a queued photograph is uploaded when that account signs in again.

Not verified here, because it needs the live project or a device (see §9):

- that Supabase Storage refuses a second upload to an existing path with a non-upsert token (the documented behaviour the immutability of a verified object rests on);
- the SQL of §5, which has not been executed anywhere;
- that `SUPABASE_SERVICE_KEY` exists in Vercel Production and is the service-role key (§9.2);
- iPhone behaviour: the camera input's file, IndexedDB persistence across app closure, large-photo decoding.

## 5. Storage requirements and the proposed migration

**PROPOSED. NOT APPLIED. NOT APPROVED.** This is deliberately not a file under `supabase/migrations/`. After approval it becomes one, unchanged.

```sql
-- GW-SCAN-LAB-001: private storage for Scan Lab. Idempotent. One transaction.
begin;

-- 1. The private bucket. Size and type limits are enforced by storage itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-lab', 'scan-lab', false, 26214400, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. A wall around the bucket that no other policy can open.
--    A RESTRICTIVE policy is ANDed with every permissive policy, present and
--    future. For every role that is subject to row security, an object in
--    'scan-lab' is invisible and unwritable, whatever else is on this table.
--    It changes nothing for any other bucket: the expression is true for them.
drop policy if exists "scan_lab_objects_server_only" on storage.objects;
create policy "scan_lab_objects_server_only"
  on storage.objects
  as restrictive
  for all
  to public
  using (bucket_id is distinct from 'scan-lab')
  with check (bucket_id is distinct from 'scan-lab');

-- 3. Benchmark metadata, apart from valuations and listings.
create table if not exists public.scan_lab_items (
  owner_id uuid not null references auth.users(id) on delete cascade,
  set_name text not null check (set_name ~ '^[a-z0-9-]{1,40}$'),
  item_id text not null check (item_id ~ '^[a-z0-9-]{1,80}$'),
  photo jsonb,          -- the verified capture: master and prepared records
  pending jsonb,        -- an upload begun and not yet verified
  truth jsonb,          -- the person's confirmation, with provenance
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, set_name, item_id)
);

-- 4. Row security ON, a RESTRICTIVE deny for every role subject to it, and no
--    table privilege for any browser role. Three independent locks.
alter table public.scan_lab_items enable row level security;
drop policy if exists "scan_lab_items_server_only" on public.scan_lab_items;
create policy "scan_lab_items_server_only"
  on public.scan_lab_items
  as restrictive
  for all
  to public
  using (false)
  with check (false);
revoke all on public.scan_lab_items from public, anon, authenticated;
--    The server's own role, stated rather than left to the project's default privileges.
grant select, insert, update, delete on public.scan_lab_items to service_role;

commit;

-- 5. Verify (read-only).
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'scan-lab';
--    expected: public = false, 26214400, the three image types
select relrowsecurity from pg_class where oid = 'public.scan_lab_items'::regclass;
--    expected: true
select tablename, policyname, permissive, cmd, roles, qual, with_check from pg_policies
 where policyname in ('scan_lab_objects_server_only', 'scan_lab_items_server_only');
--    expected: 2 rows, both permissive = RESTRICTIVE, cmd = ALL, roles = {public}
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'scan_lab_items' and grantee in ('PUBLIC', 'anon', 'authenticated');
--    expected: 0 rows
select (has_table_privilege('service_role', 'public.scan_lab_items', 'select') and has_table_privilege('service_role', 'public.scan_lab_items', 'insert') and has_table_privilege('service_role', 'public.scan_lab_items', 'update') and has_table_privilege('service_role', 'public.scan_lab_items', 'delete')) as server_can,
       has_table_privilege('authenticated', 'public.scan_lab_items', 'select') as browser_can_read,
       (select rolbypassrls from pg_roles where rolname = 'service_role') as server_bypasses_rls;
--    expected: true, false, true
```

`tests/scan_lab_production_verification.sql` repeats the checks and adds two that act as a signed-in user. It writes nothing and ends in `rollback`.

### 5.1 What the SQL creates, line by line

| Object | What it is | Why |
|---|---|---|
| Bucket `scan-lab` | `public = false`; 25 MB per object; JPEG, PNG, WEBP only | No object has a public URL. Storage itself refuses a larger or differently typed upload. |
| Policy `scan_lab_objects_server_only` on `storage.objects` | RESTRICTIVE, all commands, all roles; true only when the object is NOT in `scan-lab` | A restrictive policy is ANDed with every permissive one, so no existing or future policy can expose this bucket. It is a no-op for `listings`, `avatars` and `verification-photos`. |
| Table `public.scan_lab_items` | One row per account, set and item | Benchmark metadata, kept away from `valuations` and `listings`. |
| Policy `scan_lab_items_server_only` | RESTRICTIVE, all commands, all roles, `false` | Row security alone already denies with no policy; this keeps it denied if someone later adds a permissive one. |
| `revoke all ... from public, anon, authenticated` | No table privilege for a browser role | A third, independent lock: the query is refused before row security is consulted. |
| `grant ... to service_role` | The server's role, explicitly | Does not depend on the project's default privileges. |

Columns:

| Column | Type | Meaning |
|---|---|---|
| `owner_id` | uuid, not null, FK `auth.users(id)` on delete cascade | The account. Always the verified session subject. |
| `set_name` | text, not null, `^[a-z0-9-]{1,40}$` | The capture set, e.g. `preflight-5`. |
| `item_id` | text, not null, `^[a-z0-9-]{1,80}$` | The slot, e.g. `pf-appliance`. |
| `photo` | jsonb, null | The verified capture: `capture_id`, and for master and prepared: storage path, SHA-256, format, bytes, pixels, `stored_at`. |
| `pending` | jsonb, null | An upload begun and not yet verified: capture id, declared hashes, paths. |
| `truth` | jsonb, null | The confirmation: identity fields, provenance per field, condition, notes, and the capture it was made for. |
| `confirmed_at` | timestamptz, null | When a person confirmed. |
| `created_at`, `updated_at` | timestamptz, not null, default `now()` | Bookkeeping; `updated_at` is set by the server on every write. |

- **Indexes:** one, the primary key `(owner_id, set_name, item_id)`. Every query the server makes is by that key or its `(owner_id, set_name)` prefix. No other index.
- **Constraints:** the primary key; the foreign key to `auth.users`; the two format checks, which also make it impossible for a set or item name to contain `/` or `..` and so to shape a storage path.
- **No trigger, no function, no view, no realtime publication.**

### 5.2 The access model

| Who | Table `scan_lab_items` | Objects in `scan-lab` |
|---|---|---|
| `anon` (no session) | no privilege; denied | invisible, unwritable |
| `authenticated` (any signed-in user, including the founder's own browser session) | no privilege; denied | invisible, unwritable |
| `/api/scan-lab` holding the service-role key | full, after the gate, always filtered by the session's own id | full, only under `<session id>/...` |
| A phone holding an upload token | none | may create exactly ONE new object at the path the server signed, within two hours, and cannot overwrite it |
| Anyone holding a signed download link | none | may read exactly ONE object for 60 seconds |

**Can an ordinary authenticated Supabase user directly read or write another tester's Scan Lab data? No**, and not their own either:

1. On the table, the role has no privilege at all (`revoke`), row security is on with no permissive policy, and a restrictive `false` policy stands behind both.
2. On storage, the bucket is private (no public URL route) and the restrictive policy removes `scan-lab` objects from every row-security-subject role's view of `storage.objects`, for every command. Supabase Storage evaluates direct client requests as the caller's role, so list, download, upload, update and delete all see nothing.
3. Through the endpoint, the owner of every query and every path is the verified session subject; no request field can name another account (`SL-1h`, `SL-1i`, `LAB03`).

What this rests on, stated so it can be checked: Postgres row-security semantics (restrictive policies are ANDed; a role without privilege is refused first); `service_role` having `BYPASSRLS` (queried in step 5); and Supabase Storage serving signed-URL operations with its service connection rather than the caller's role. The last two are standard for a Supabase project and are observable: step 5 reads the role attribute, and the first capture exercises the signed upload. This SQL has not been executed anywhere, including a disposable database.

### 5.3 Service-role assumptions

- Scan Lab reads `SUPABASE_SERVICE_KEY` and nothing else. It does not fall back to `SUPABASE_KEY` or to any anon key.
- The key must be service-role shaped: a JWT whose `role` claim is `service_role`, or an `sb_secret_` key. A key equal to a configured anon key is refused.
- Otherwise every action answers `UNAVAILABLE: storage_not_configured` to an enrolled account and 403 to everyone else. Nothing is stored and nothing is read (`SL-1f`, `LAB07`).
- `node scripts/scan-lab-config-check.mjs` prints the shape of the configuration as yes/no lines and never a value.

### 5.4 Deletion behaviour

- **Photo:** every object under `<owner>/<set>/<item>/` is listed and removed, including what an abandoned or replaced upload left; then the record's `photo` and `pending` are cleared. The confirmation is kept but no longer counts (it was for the deleted photograph).
- **Confirmation:** `truth` and `confirmed_at` are cleared. The photograph is kept.
- **Item:** the objects, then the row.
- **Set:** every object under `<owner>/<set>/`, then every row. The set's name must be repeated in the request.
- If storage refuses a removal, the request fails with 502 and the record that names the photograph is kept.
- Deleting the auth user cascades to the rows but NOT to storage objects. Delete the set in the screen first, or empty `<user id>/` in the bucket afterwards.
- Nothing expires on its own: a frozen benchmark binds photographs by hash.

## 6. Benchmark isolation

- The engine receives only a photograph and normal application context. Human answers are stored in `scan_lab_items`, which no recognition or pricing module reads (`SL-5c`).
- Preflight items carry `excluded_from_benchmark: true` in the lab set, and the pull refuses a manifest that disagrees (`SLP-2c`).
- The 44-item benchmark is not a lab set yet. Adding it is one data entry in `sets.js`; no code changes.
- No recognition prompt, pricing rule, threshold or provider behaviour was changed.

## 7. Future execution

The screen shows nine "not run" fields per item (recognition result, model accuracy, follow-up requirement, identity latency, market search results, qualified evidence, pricing tier, total latency, replay status). There is no endpoint action that runs anything. A live run remains the existing local command under `--approve-usd`, `--ceiling-usd` and `--expect-freeze`.

## 8. iPhone, HEIC and metadata

Not tested on a device. What follows is from Apple's developer forum and WebKit's bug tracker, and from the code.

| Path | What iOS hands the web app | Scan Lab |
|---|---|---|
| A. **Take photo** (`<input type="file" accept="image/*" capture="environment">`) | A JPEG. iOS transcodes the capture for web content whatever the Camera app's format setting is. Since iOS 16.4 the GPS tags are removed; other EXIF stays. | Stored as received. |
| B. **Choose photo → Photos** (`accept="image/jpeg,image/png,image/webp"`) | By default ("Automatic" / "Most Compatible") a JPEG transcoded from the HEIC. From iOS 17 the picker's Options sheet lets the person choose Format "Current" (the HEIC itself) and whether location is included. A web page cannot set either. | A JPEG is stored as received. A HEIC is refused at once. |
| C. **HEIC/HEIF content** (Options → Current; or Files → Browse; or a desktop browser) | The HEIC bytes, untouched. | Refused at once, before anything is read in full, hashed, queued or sent, with what to do instead. |

Why HEIC is refused rather than supported, for this release:

- The benchmark tooling this feeds (`scripts/market-benchmark-report.mjs`, the capture helper's `acceptPhoto`) accepts JPEG, PNG and WEBP by their first bytes. Those files are under the benchmark freeze; teaching them HEIC changes frozen code.
- Only Safari can decode HEIC, so the prepared JPEG could be made on the iPhone but the server could not check the master beyond its hash without an ISO-BMFF parser.
- Converting in the browser would mean a WebAssembly HEIF decoder (`heic2any` / `libheif-js`, on the order of 1.3–2.7 MB uncompressed in a lazy chunk) — and the converted file would not be the original, which is the property the lab exists to keep. No such dependency was added.
- Paths A and B, the ones a person uses by default, never produce HEIC.

What "the original" means here: the bytes the browser handed the app. On an iPhone that is already iOS's JPEG rendition, not the HEIC in the camera roll. That is also exactly what a normal GetWorth scan receives.

Metadata:

- **The master may contain EXIF**: camera, lens, time, orientation, and location if the phone included it. It is never stripped, rewritten or re-encoded: byte-for-byte preservation is the point, and the hash proves it.
- **The prepared derivative carries no EXIF.** It is a canvas re-encode; nothing copies metadata into it. One exception by rule: an original under 150 KB has no derivative and is itself what a benchmark run would send. An iPhone photograph is never that small.
- **The master is private.** No public URL exists for it. A download link is signed by the server after authorization and lives 60 seconds.
- **For the later three-person Alpha Test** this is not sufficient as it stands. Before any other person's originals are stored, the release needs: their explicit consent to storing the unmodified original including its metadata, a stated retention period and deletion path they can use, and a decision on whether location is stored at all. Until then the allowlist holds the founder only.

## 9. Release (Option A): Production engine unchanged, founder-only Scan Lab

Production runs `b3888a5` (branch `main`, deployed 2026-10-01; read from the Vercel deployment record and from the build SHA in the served bundle on 2026-10-06). The branch `scan-engine-v2` is ahead of it by commits that change the V2 engine. The release is therefore a separate branch cut from `b3888a5` that carries only Scan Lab.

An earlier candidate, `237b90b` on `release/scan-lab-001`, was cut from `6531b46` on the mistaken belief that Production ran that commit. It must not be deployed: it lacks `b3888a5` and would roll the Production engine back.

### 9.1 Environment variables (Vercel, Production)

| Variable | Value | Kind | State |
|---|---|---|---|
| `SCAN_LAB_ENABLED` | `true` | server | new |
| `SCAN_LAB_USER_IDS` | the founder's Supabase user id, one id | server | new |
| `VITE_SCAN_LAB_ENABLED` | `true` | build time | new |
| `SUPABASE_SERVICE_KEY` | the project's service-role key | server, secret | must exist under exactly this name |
| `SUPABASE_URL` (or `VITE_SUPABASE_URL`) | the project URL | server | existing |
| `SUPABASE_JWT_SECRET` / `SUPABASE_ANON_KEY` | existing | server | existing, used by the session verifier |

Nothing else changes. `SCAN_ENGINE_V2_*` and `OPENAI_*` are untouched.

### 9.2 Service-role gate (before anything else)

1. `vercel env ls production` shows names only: confirm `SUPABASE_SERVICE_KEY` is listed.
2. To check its shape without displaying it: `vercel env pull .env.production.check --environment=production`, then `node --env-file=.env.production.check scripts/scan-lab-config-check.mjs`, then delete `.env.production.check`. The script prints yes/no lines only.
3. If it reports that the key is absent or not service-role shaped: stop. Add the key in Vercel under that name; do not rename or reuse `SUPABASE_KEY`.

### 9.3 Migration

1. Approve the SQL of §5.
2. In the Supabase SQL editor, run `tests/scan_lab_production_verification.sql` part 0 (read-only): it lists every existing policy on `storage.objects`, for the record.
3. Run the `begin; ... commit;` block of §5 once.
4. Run the rest of `tests/scan_lab_production_verification.sql`. Every line must match its expected value. If one does not: run the rollback of §9.5 (data level) and stop.

### 9.4 Deployment

1. Push the release branch (not `main`) and open it for review.
2. Set the variables of §9.1 for Production.
3. Deploy the release commit to Production.
4. Check the served build: the SHA in the app equals the release commit.
5. iPhone: open GetWorth, accept "Update available", Profile → Scan Lab. Diagnostics must say "builds match: yes" and "storage: private bucket reachable".
6. With a second, non-enrolled account: no Scan Lab entry in Profile; `/scan-lab` shows "Not available"; a direct `POST /api/scan-lab` with that account's session answers 403.
7. One normal scan with each account: unchanged.
8. Capture one item end to end; then `tests/scan_lab_production_verification.sql` part 3 shows the object exists for the server and not for a signed-in user.

### 9.5 Rollback

| Level | Action | Effect |
|---|---|---|
| Kill switch | Unset `SCAN_LAB_ENABLED` (or empty `SCAN_LAB_USER_IDS`) and redeploy | Every action answers 403. Stored data untouched. |
| Hide the screen | Unset `VITE_SCAN_LAB_ENABLED` and redeploy | The screen leaves the bundle. |
| Code | Promote the previous Production deployment (`b3888a5`, `dpl_2WisgDfFhBcc2FRnqzis9SDsGqgi`) in Vercel | Production is exactly what it was. The normal scan was never changed. |
| Data | "Delete the whole set" in the screen; or empty the `scan-lab` bucket in the dashboard, then: `drop policy if exists "scan_lab_objects_server_only" on storage.objects; drop table if exists public.scan_lab_items;` and delete the bucket in the dashboard | Removes every photograph and confirmation, and the two policies. No other table or bucket is touched. |

Rollback of the code never requires rollback of the data, and the reverse.
