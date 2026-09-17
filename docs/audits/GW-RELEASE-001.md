# GW-RELEASE-001 — GetWorth v1 Release-Candidate Completion Audit

**Type:** Read-only evidence audit
**Date:** 2026-09-06
**Repository state at time of writing:** branch **`main`**, HEAD `fce24f9`, working tree clean apart from this document.
**Scope:** Determine how complete the application actually is, and produce an evidence-backed release backlog.

> **No code, migration, dependency, environment, or deployment was changed by this audit.**

### Repository-state correction (recorded during the audit)

This audit began expecting HEAD to be `76d3ec7` on `test/windows-path-fix`, unpushed. It is not. The reflog shows that between the previous work session and this audit, someone checked out `main`, merged `test/windows-path-fix` into it, and pushed:

```
fce24f9 HEAD@{0}: commit (merge): Merge branch 'test/windows-path-fix'
2b0e87d HEAD@{1}: checkout: moving from test/windows-path-fix to main
76d3ec7 HEAD@{2}: commit: fix(scan): require a session before calling /api/analyze
```

Verified facts:

- **All 12 commits are present in `main`** (each confirmed via `git merge-base --is-ancestor`).
- **`main` has been pushed** — `git ls-remote --heads origin main` returns `fce24f9`.
- The branch `test/windows-path-fix` still exists locally at `76d3ec7`.

Two consequences worth flagging, neither of which changes the findings below:

1. **The merge commit message is malformed.** It contains git's editor comment template inline as the subject: `Merge branch 'test/windows-path-fix' # Please enter a commit message to explain why this merge is necessary, # especially if it merges an updated upstream…`. Cosmetic, but it is now permanent history on `main` and will read oddly in any changelog or blame view. Rewriting it would require a force-push to `main`, which is a larger decision than the defect warrants — recorded here rather than acted on.
2. **The audit's premise shifted from "should we merge?" to "what is already on main?"** The findings are unaffected — every piece of evidence below was gathered from the merged tree — but the release backlog now describes work against `main`, not against a pending branch.

---

## 0. How to read this report

Three distinctions are used throughout and matter more than any percentage:

| Distinction | Meaning |
|---|---|
| **CODE ISSUE** | Provable from repository contents. |
| **DEPLOYMENT STATE UNVERIFIED** | The code/migration exists in git; whether Production/Preview actually has it applied cannot be established from the repo. |
| **NEEDS EXTERNAL APP-STORE VERIFICATION** | Depends on current Apple policy, which this audit does not invent. |

A migration existing in git is **not** proof that Production has applied it. A component rendering is **not** proof the action completes.

### Architecture verification

The stated architecture was checked against the repository and is **accurate**: 9 views, 8 components, 12 libs, 1 context (4,008 lines), 3 API routes + 2 `_lib` modules (`api/analyze.js` is 5,226 lines), 54 migrations, 2 Edge Functions, 17 test files. One correction: the journey description references order statuses `ready` and `received`; the real vocabulary is `pending → accepted → shipped|ready_pickup → delivered → completed`, plus `declined`/`cancelled`/`disputed`.

---

## 1. Headline findings

**The architecture is coherent and, in several places, unusually well-built.** Orders, reviews, admin authorization and the valuation guard show deliberate, defensive server-side design with real integrity enforcement. This is not a codebase that needs redesign.

The gaps are **completion and legal/release gaps**, not architectural ones:

1. **No account deletion exists anywhere** — zero hits across `src/`, `api/`, `supabase/`. (P0)
2. **No Privacy Policy or Terms of Service exists in the product.** (P0)
3. **Two of three API routes have a hardcoded CORS allowlist that excludes Vercel Preview URLs** — identity confirmation and candidate submission are broken on every Preview deployment. (P1)
4. **Condition questions are almost entirely decorative** — of ~40 collected answer keys, only two move the price, and one gated branch is dead code. (P1)
5. **`product_type` is hardcoded `null`** in the scan pipeline's candidate payload, so the taxonomy column can never be populated from a scan. (P1)
6. **No CI exists**, and the design-lint gate has been failing silently. (P2)

Product principles were verified and are **upheld**: DB-is-truth, uncertainty-as-valid-result, evidence-gated fast path, and — confirmed by direct tracing — **Recognition Memory is genuinely shadow-only**.

---

## 2. Master audit table

### 2.1 App bootstrap / auth

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Email signup/login | COMPLETE | — | `AuthProfileView.jsx` :: forms; `AppContext.jsx` :: `signInEmail`, `signOut` (:1438) | Works | — |
| Google OAuth | COMPLETE | — | `AppContext.jsx` :: `signInGoogle`; `AuthProfileView.jsx:154` | Works | — |
| Session restore / bootstrap | COMPLETE | — | `AppContext.jsx:478-540` — `getSession()` + `onAuthStateChange`, `mounted` guard, unsubscribe on unmount | Works | — |
| Logout / account-switch reset | COMPLETE | — | `AppContext.jsx:580` :: `clearUserState()` — documented single reset point, idempotent, ownership-guarded | Works | — |
| Password reset / recovery | COMPLETE | — | `AppContext.jsx:1478` :: `updatePassword`; `PASSWORD_RECOVERY` event handled at `:520` | Works | — |
| **Scan auth pre-flight** | COMPLETE | — | `AppContext.jsx` :: `runPipeline` session pre-flight before state mutation; `analyzeWithRetry` refuses null token; `api/analyze.js:218` verifies Bearer JWT; `tests/scan-auth.test.mjs` (16 tests, 4 mutants killed) | Fixed in `76d3ec7` | Redeploy Preview to validate |
| **Account deletion** | **PLACEHOLDER** (absent) | **P0** | Zero matches for `deleteAccount\|account.?deletion\|auth.admin.deleteUser` across `src/`, `api/`, `supabase/`. Only `clearAllValuations` + `deleteValuation` exist | User cannot delete account or personal data | Build deletion path — see GW-RC-001 |
| Preview OAuth return | UNVERIFIED | P1 | Boot diagnostic added in `76d3ec7` (`[Auth] boot`) but **not yet observed on a Preview build** | Unknown | Redeploy Preview, read one boot line |

### 2.2 Home / navigation

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Home feed | COMPLETE | — | `HomeView.jsx` (378 lines); `AppContext.jsx` :: `loadListings` with `PAGE_SIZE` pagination + `cacheSet` | Works | — |
| URL sync / deep links / back | COMPLETE | — | `src/lib/urlSync.js` (300 lines) — documented pushState/replaceState policy per navigation class | Works | — |
| Offline cache | PARTIAL | P2 | `src/lib/appCache.js`; listings cached via `cacheSet('listings', …)`. No evidence of offline write queue or offline UX copy | Degraded offline behaviour unclear | Define offline scope |

### 2.3 Scan

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Capture + compression | COMPLETE | — | `AppContext.jsx:194` `compressImage`; scan path calls `(raw, 1280, 0.82)` at `:2196`/`:3006` | Works | — |
| Multi-photo append | COMPLETE | — | `runPipeline(raw, appendMode=true)`; keeps last 3; `scan_uuid` reused for lifecycle correlation | Works | — |
| Rate limit / quota | COMPLETE | — | `api/analyze.js` :: `checkRateLimit` → `check_and_increment_scan_rate` RPC; fails **closed** on every error path; bounded 6s (`RATE_LIMIT_TIMEOUT_MS`) | Works | — |
| Abort / retry | COMPLETE | — | `pipelineAbortRef`; abort now resets state (`76d3ec7`); `lastAttemptRef` snapshot for replay | Works | — |
| Stuck "Scanning…" on abort | COMPLETE (fixed) | — | Was: catch returned on `AbortError` without clearing state, and `clearUserState()` aborts on sign-in. Fixed + `tests/scan-auth.test.mjs` SA-09/SA-10 | Fixed | Validate on Preview |
| `_timings` waterfall | COMPLETE | — | `api/analyze.js` :: 11 instrumented stages + `[Waterfall]` log + `result._timings`; `tests/pipeline-timings.test.mjs` | Observability | — |
| **Live latency** | UNVERIFIED | P1 | No fixture images, no captured production log. Only measured figure in repo: Stage 2 ≈19.7s (commit `0250e80`), itself a lower bound (`api/analyze.js:347`: "6/6 production scans aborted at cap") | Unknown real scan time | Capture one Preview waterfall |

### 2.4 Recognition / retrieval

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Stage 1 uncertainty | COMPLETE | — | `buildRecognitionPrompt` uncertainty contract; `calibrateRecognition` clamps unearned model confidence to 0.70; `identity_resolution` (`exact\|family\|brand\|unknown`) | Honest uncertainty | — |
| Evidence-class ranking | COMPLETE | — | `EVIDENCE_CLASS`, `rankCandidates`, class-first sort; benchmark tier 1b 23/23 vs 0/23 under flat sort | Sibling protection | — |
| DB-missing protection | COMPLETE | — | `dbMatchFound` requires model-level evidence; DB-missing control passes | Correct "not in catalog" | — |
| Corroborated confidence | COMPLETE | — | `calibrateVerification` — caps may read self-declared fields, floors/boosts may not; `UNCORROBORATED_CEILING` | No manufactured confidence | — |
| Stage-2 fast path | EXPERIMENTAL | P2 | `evaluateFastPath` + 30 tests + 5 mutants killed. **Qualifying rate never observed live** | Unknown hit rate | Measure on Preview |
| **Identity-key normalization** | PARTIAL | P2 | Benchmark: convergence **31.0%**, 2/23 products have a single identity. `G900`/`G 900`/`M-G900`/`G900 Chaos Spectrum` = 4 identities; `G502`/`G502 Hero`/`G502 X Plus` merge to 1 | Fragmented learning/pricing history | v3 key layer + re-key migration (frozen v1/v2 contract) |
| Recognition Memory | SHADOW-ONLY | — | Verified: `memoryRow` used only to gate a sample write (`api/analyze.js:4317`); **zero** reads into recognition/verification/pricing | Principle 6 upheld | Keep shadow |
| **`product_type`** | **BROKEN** | **P1** | `api/analyze.js:3988` — `product_type: null` **hardcoded**. `api/submit-candidate.js:166,266` accepts it; `product_candidates.product_type` column exists (migration `20260527000001`) | Taxonomy can never populate from a scan | GW-RC-004 |

### 2.5 Valuation

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Valuation guard | COMPLETE | — | `api/_lib/valuation-guard.js` (727 lines); `tests/valuation-guard.test.mjs` 95/95 + mutation harness | Fails closed | — |
| `manual_required` fail-closed | COMPLETE | — | Guard degrades to `manual_required`; `calcPrice` returns `null` not 0; `tests/persistence-rows.test.mjs` | No fabricated precision | — |
| Authoritative persistence | COMPLETE | — | `record_scan` awaited before response; `result.persisted` returned; `tests/pipeline-timings.test.mjs` PT-01 | Durable | — |
| Pricing rescue engine | COMPLETE | — | `pricingRescueEngine`: catalog → Haiku → category → manual | Graceful degradation | — |
| Derived/shadow writes | COMPLETE | — | Bounded by budget clock, overlapped, non-fatal (PT-02..PT-05) | No 504 on committed scans | — |

### 2.6 Condition questions ← **most significant product gap**

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Question definitions | PARTIAL | P1 | `SellViews.jsx:1020` :: `getQuestionsForCategory(category, answers)` — switch on **broad category only** (Electronics/Furniture/Watches/…). Deterministic, in code, bilingual inline | Generic questions | Product-type layer |
| Subtype selection | PARTIAL | P1 | Subtype is chosen **by the user** via a first question (`deviceType`: phone/laptop/tablet/…), **not** derived from recognition | User re-states what the scan knew | Drive from recognition |
| **Answers → valuation** | **BROKEN** | **P1** | `src/lib/utils.js:191` `calcPrice`: only `ans.scratches === 'yes'` (−2%) and `ans.issues === 'yes'` (−3%) affect price. `scratches:'some'` = 0. **~38 other keys are collected and never priced** | Users answer questions that do nothing | GW-RC-003 |
| **Battery penalty** | **DEAD** | **P1** | `utils.js:215` gates on `ans.deviceType ∈ ['devicePhone','deviceLaptop','deviceTablet']`; `SellViews.jsx:1694` stores the raw option `'phone'`/`'laptop'`/`'tablet'`. **Condition never true — has never fired** | Battery condition never affects price | GW-RC-003 |
| Answer persistence | PARTIAL | P2 | Written to `listings.attributes` (jsonb) at `AppContext.jsx:3249`, **on publish only**, and never read back. Not in `valuations`, not in observations | Answers lost if user doesn't publish | Persist with valuation |
| Questions gated to used/poor | PARTIAL | P2 | `AppContext.jsx:3719` `selectCondition` — questions shown only for `used`/`poor` | New/like-new skip condition capture | Product decision |

### 2.7 Save / portfolio

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Scan history / valuations | COMPLETE | — | `AuthProfileView.jsx:768-830` — list, delete, clear-all with confirm | Works | — |
| Saved listings | COMPLETE | — | `AppContext.jsx:1688` `toggleSave`; RLS migration `20260719000002_saved_items_rls_admin_bypass.sql` | Works | — |

### 2.8 Sell / listings

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Create listing | COMPLETE | — | `SellViews.jsx` flow; `AppContext.jsx` :: `publishListing`; `listings` schema migrations | Works | — |
| Edit / delete listing | COMPLETE | — | `updateListing` (:1784), `deleteListing` (:1730), owner-scoped + RLS | Works | — |
| Listing images | COMPLETE | — | Storage bucket policies `20260519000007_storage_bucket_policies.sql` | Works | — |
| Listing uses adjusted price | PARTIAL | P2 | `startListing` prefills `marketValue.mid`; `selectCondition` → `suggestPrice(c)` → `calcPrice`. Adjustment is real but driven by the condition **selector**, not by the ~38 dead answers | Price barely reflects condition detail | Follows GW-RC-003 |

### 2.9 Browse / detail · 2.10 Saved marketplace items

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Browse + filters + pagination | COMPLETE | — | `loadListings`, debounced search, category/condition/price filters | Works | — |
| Listing detail | COMPLETE | — | `BrowseDetailView.jsx` (821 lines) | Works | — |
| **Report listing** | COMPLETE | — | `AppContext.jsx:3340` `reportListing`; admin review `AdminPanel.jsx:412` `removeListing`, `:161` `admin_dismiss_report` | UGC reporting exists | — |
| **Block user** | PLACEHOLDER (absent) | P2 | `ChatViews.jsx:811` comment: "restore this slot with a Report user / Block user sheet". No implementation, no table | Cannot block a harasser | GW-RC-008 |

### 2.11 Chat

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Conversation create / dedupe | COMPLETE | — | `AppContext.jsx:1263-1271` retry/lookup path; migration `20260525000001_conversations_insert_seller.sql` | Works | — |
| Send message | COMPLETE | — | `sendMessage` (:1318); image messages `sendChatImageMessage` (:1399) via `__chat_img__` prefix | Works | — |
| Realtime + reconnect | COMPLETE | — | `AppContext.jsx:84-125` — documented reconnect with backoff; previous version only *logged* on `CHANNEL_ERROR`/`TIMED_OUT`, now drops+rebuilds channel | Works | — |
| Messaging isolation | COMPLETE | — | `20260519000005_messaging_security.sql` | Private | — |
| Unread state | COMPLETE | — | `unreadCount`, mark-read on open (:730) | Works | — |
| Call buttons | DEAD (comment only) | P3 | `ChatViews.jsx:750` comment says "call stubs" but **no Phone/Video button renders** — stale comment | None | Delete comment |

### 2.12 Orders

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| **Order state machine** | COMPLETE | — | `transition_order()` SECURITY DEFINER (`20260519000005_messaging_security.sql:181`): auth check → party check → terminal-state rejection → explicit transition matrix → role enforcement → `FOR UPDATE` row lock. Client calls the RPC (`AppContext.jsx:3512`), timestamps are optimistic UI only | Integrity enforced | — |
| Status lockdown | COMPLETE | — | `20260719000003_orders_status_lockdown.sql`: direct status writes rejected by trigger; `create_order()` is sole creation path | Cannot forge `completed` | — |
| Admin order matrix | COMPLETE | — | `20260719000004_admin_order_status_matrix.sql`; `admin_update_order_status` | Works | — |
| Order tests | PARTIAL | P2 | `tests/security_001_order_transitions.test.sql` exists but is **SQL, not in `npm test`** — requires a live DB | Untested in CI | Wire into a DB test job |

### 2.13 Reviews / reputation

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Review submission | COMPLETE | — | `AppContext.jsx:3636` direct insert, but RLS `reviews_insert_order_party_only` (`20260718000002`) enforces `reviewer_id = auth.uid()`, `seller_id <> auth.uid()`, order `status = 'completed'`, and role matches actual side | Client checks are advisory; DB is authoritative | — |
| One review per order/role | COMPLETE | — | `UNIQUE INDEX one_review_per_order_role` (`20260729000001`) with a pre-flight dedupe guard | Enforced | — |
| Reputation aggregate | COMPLETE | — | `trg_reviews_recompute_rating`; `20260723000001_security002_reputation_lockdown.sql`; `tests/reputation.integration.mjs` | Works | — |
| Review moderation | COMPLETE | — | `admin_delete_review` (`20260718000003`) | Works | — |
| Reputation integration test | UNVERIFIED | P2 | `tests/reputation.integration.mjs` requires real Supabase creds; **fails to start locally** (`src/lib/supabase.js:10` throws on missing env) | Not run in `npm test` | Document as prod-only |

### 2.14 Notifications

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| In-app notifications | COMPLETE | — | `NotificationsPanel.jsx`; `src/lib/notifications.js` :: `resolveNotificationTarget`; RLS `notifications_select_own` (`20260531000002`) | Works | — |
| Order notification creation | COMPLETE | — | `20260607000003_create_order_seller_notification.sql` | Works | — |
| **Push notifications** | PLACEHOLDER (absent) | P2 | No `pushManager`, `web-push`, `VAPID`, or `Notification.requestPermission` anywhere | No background alerts | Product decision (see App Store §6) |

### 2.15 Profile · 2.16 Verification

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Profile view/edit, avatar | COMPLETE | — | `AuthProfileView.jsx`; `uploadAvatar` (:1499) with type/size validation | Works | — |
| Profile column privacy | COMPLETE | — | `20260518000001_protect_profile_columns.sql`, `20260519000002_profiles_column_privacy.sql` | Private columns protected | — |
| Verification submission | COMPLETE | — | `AppContext.jsx:1645` invokes Edge Function `submit-verification-selfie`; bypasses Storage RLS deliberately, sets `verification_status='pending'` | Works | — |
| Admin verification review | COMPLETE | — | `admin_list_pending_verifications`, `admin_verify_user`; Edge Function `admin-get-verification-url` | Works | — |
| **Verification bucket privacy** | **DEPLOYMENT STATE UNVERIFIED** | **P1** | `20260518000002_verification_photos_private.sql:11` — *"After applying this SQL you MUST also make the storage bucket private"*. A manual console step the repo cannot confirm | If missed, **selfies are publicly readable by URL** | GW-RC-002 — verify in Supabase console |

### 2.17 Admin

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| Admin authorization | COMPLETE | — | `20260519000001_admin_server_side_auth.sql:7` — *"Reads `profiles.is_admin` from the DB — never trusts JWT claims"*; every admin RPC re-checks | No privilege escalation via JWT | — |
| Admin panel | COMPLETE | — | `AdminPanel.jsx` (930 lines): verifications, users, listings/reports, reviews, orders, candidates | Works | — |
| Candidate moderation | COMPLETE | — | `20260527000002_admin_product_candidates.sql`; approve → searchable via strategy 9 | Works | — |
| Admin discoverability | UNVERIFIED | P3 | No evidence of how a user reaches `/admin`; gated on `profile?.is_admin` | — | — |

### 2.18 Security / privacy

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| RLS coverage | COMPLETE (code) / UNVERIFIED (deployed) | P1 | 54 migrations covering profiles, listings, orders, messaging, reviews, notifications, saved items, valuations, storage. **Existence ≠ applied** | — | Run `tests/*_production_verification.sql` against Production |
| Server-side auth on `/api/analyze` | COMPLETE | — | JWT verify (local HMAC fast path + JWKS fallback); fail-closed; `tests/scan-auth.test.mjs` SA-16 asserts no anonymous path | Secure | — |
| Scan quota / abuse | COMPLETE | — | `USER_DAILY_LIMIT=50`, per-IP + per-user per-minute, atomic RPC, fail-closed, quota refunded on failure | Bounded cost | — |
| **PII in production logs** | COMPLETE (clean) | — | All three email/PII log sites (`AppContext.jsx:494`, `:537`, `:2132`) are **DEV-gated**. New auth diagnostics are booleans only (`tests/scan-auth.test.mjs` SA-15, mutation-verified) | No PII leak | — |
| **CORS — `confirm-identity` / `submit-candidate`** | **BROKEN on Preview** | **P1** | `api/confirm-identity.js:35` and `api/submit-candidate.js:33` — hardcoded `ALLOWED_ORIGINS = ['https://get-worth-ai.vercel.app','http://localhost:5173','http://localhost:4173']`, falling back to `ALLOWED_ORIGINS[0]`. **Preview URLs excluded.** `api/analyze.js` correctly uses env-driven `ALLOWED_ORIGIN` | Identity confirmation + candidate submission fail on every Preview | GW-RC-005 |
| Secret handling | COMPLETE | — | No literal secrets in diff or source; all via `process.env` | — | — |
| Security SQL tests | UNVERIFIED | P2 | 5 `.sql` test files exist but run against a live DB, not in `npm test` | Unenforced | Wire a DB test job |

### 2.19 PWA / mobile

| Feature | Status | Sev | Evidence | User impact | Required action |
|---|---|---|---|---|---|
| SW update strategy | COMPLETE | — | `vite.config.js:23` `registerType: 'prompt'` — deliberate, with documented rationale against `autoUpdate` force-reloads | No surprise reloads | — |
| Safe areas / dvh | PARTIAL | P2 | `env(safe-area-inset-*)` / `dvh` present in `index.css`, `ChatViews.jsx` (9), `CameraResultsView.jsx` (3), `ui.jsx` (2). Coverage uneven across views | Possible layout issues on notched devices | Device pass |
| Keyboard / visualViewport | PARTIAL | P2 | `ChatViews.jsx:694` handles iOS `scrollIntoView` on textarea focus. No global `visualViewport` handling found | Chat handled; other forms unverified | Device pass |
| **Manifest completeness** | PARTIAL | P2 | `public/manifest.json` has name/short_name/start_url/display/colors/orientation + 192/512 icons. **Missing:** `maskable` icons, `screenshots`, `scope`, `lang`, `dir` — even though `icon-maskable-{192,512}.png` and `screenshot-{narrow,wide}.png` **exist in `public/`** | Weaker install UX | GW-RC-009 |
| Device behaviour | UNVERIFIED | P1 | No device tests exist. All iPhone/Safari behaviour is inferred from code comments only | Unknown | Physical iPhone pass |

### 2.20 Release / dev cleanup

| Item | Classification | Sev | Evidence |
|---|---|---|---|
| Eruda / vConsole | **SAFE TO KEEP** (absent) | — | Zero matches |
| Debug panel | **KEEP DEV-ONLY** | — | `CameraResultsView.jsx:2342` gated `profile?.is_admin === true \|\| import.meta.env.DEV` — correct |
| `X-GetWorth-Build` header | **REMOVE BEFORE RC** | P2 | `api/analyze.js:106-108` — its own comment says *"TEMPORARY build marker… Remove after validation"*; stale value `774e6e9-node-budget` |
| `[Waterfall]` / `[Identity]` / `[Calibrate]` logs | **SAFE TO KEEP** | — | Once-per-scan, no PII; the only real latency observability that exists |
| `[Auth] boot` diagnostic | **KEEP** (needs decision on longevity) | P3 | Deliberately ungated to be visible on Preview; booleans only |
| `[CAM]` logger | **NEEDS DECISION** | P3 | `AppContext.jsx:67` — appears ungated |
| "call stubs" comment | **REMOVE BEFORE RC** | P3 | `ChatViews.jsx:750` — describes UI that does not exist |
| `raw-hex 292/273 (+19)` | **NEEDS DECISION** | P2 | 19 violations in `src/App.jsx`; the sole `npm test` failure |
| **No CI** | **REMOVE BEFORE RC** (add it) | P2 | No `.github/workflows`. The design-lint gate was crashing on Windows rather than failing, so it was silently off |
| `src/lib/enrich-products.mjs` | KEEP DEV-ONLY | P3 | Operational script; writes mechanically-derived aliases |
| `bundle.txt` (644 KB) | NEEDS DECISION | P3 | Source bundle at repo root, not referenced by build |

### 2.21 App Store preparation gaps

| Requirement | Status | Sev | Evidence / note |
|---|---|---|---|
| **Privacy Policy** | ABSENT | **P0** | Zero matches for `privacy.?policy` / `/privacy` in `src/`, `public/`, `index.html`, `docs/` |
| **Terms of Service** | ABSENT | **P0** | Zero matches |
| **Account deletion** | ABSENT | **P0** | §2.1 |
| Privacy/data-collection disclosures | ABSENT | P1 | No data-collection manifest; app collects photos, location, email, selfies |
| UGC reporting | PRESENT | — | `reportListing` + admin moderation |
| User blocking | ABSENT | P2 | §2.10 |
| Camera/photo permission purpose strings | N/A (web) | P1 | Required at native wrapper stage |
| Sign in with Apple | NEEDS EXTERNAL APP-STORE VERIFICATION | P1 | Google OAuth present. Whether Apple requires Sign in with Apple alongside it is a policy question this audit does not adjudicate |
| Push notifications | ABSENT | P2 | In-app only |
| App icons / launch assets | PARTIAL | P2 | Icons + splash images exist in `public/`; manifest under-declares them |
| Versioning | PARTIAL | P3 | `BUILD_VERSION` from `__BUILD_TS__` (`src/App.jsx:12`); `package.json` version `1.0.0` static |
| Support/contact path | UNVERIFIED | P2 | No support email/URL found |
| AI valuation disclaimer | PARTIAL | P2 | `trust-copy.test.mjs` guards against unearned "Verified" claims; no explicit "estimate, not an appraisal" disclaimer found |
| Native wrapper | ABSENT (expected) | — | No Xcode project. **Not penalized** per instructions |

---

## 3. Release backlog

### P0 — RELEASE BLOCKERS

---

**GW-RC-001 — No account deletion exists**

- **Area:** Auth/account, Privacy, App Store
- **Status:** PLACEHOLDER (absent)
- **Evidence:** Zero matches for `deleteAccount|account.?deletion|auth.admin.deleteUser|delete.?account` across `src/`, `api/`, `supabase/`. Available account actions are `signOut` (`AppContext.jsx:1438`), `clearAllValuations`, `deleteValuation`, `deleteListing`. `clearUserState()` clears *local* state only.
- **Root cause:** Feature never built. Logout was likely treated as sufficient.
- **User impact:** A user cannot remove their account, profile, listings, messages, orders, reviews, valuations, avatar, or verification selfie.
- **Security/data impact:** Personal data — including **identity-verification selfies** — is retained indefinitely with no user-facing removal path.
- **Files/symbols:** new API route or Edge Function; `AuthProfileView.jsx` (entry point); `AppContext.jsx` (`clearUserState` for post-delete reset).
- **Backend/schema dependencies:** Requires a decision per table — hard delete vs anonymize. Orders and reviews are referenced by **other** users, so blanket deletion breaks their transaction history and reputation. Likely: anonymize `profiles`, hard-delete `valuations`/`saved_items`/verification photos, retain order/review rows with a tombstoned author.
- **Tests currently covering it:** None.
- **Recommended fix direction:** A `SECURITY DEFINER` RPC or service-role Edge Function performing a documented per-table policy, plus `auth.admin.deleteUser`, plus storage object deletion. Confirmation UI with typed confirmation.
- **Acceptance criteria:** An authenticated user can request deletion from Profile; after completion (a) they are signed out, (b) re-login with the same credentials fails, (c) their profile no longer resolves in browse/chat/reviews, (d) their verification selfie object is gone from storage, (e) counterparties' completed orders and received reviews remain intact with an anonymized author, (f) a second deletion request is idempotent.
- **Regression risks:** Cascading deletes breaking counterparty history; orphaned storage; reputation aggregates skewed.
- **Estimated scope:** **L**

---

**GW-RC-002 — Privacy Policy and Terms of Service do not exist**

- **Area:** Legal, App Store
- **Status:** PLACEHOLDER (absent)
- **Evidence:** Zero matches for `privacy.?policy|terms.?of.?service|/privacy|/terms` in `src/`, `public/`, `index.html`, `docs/`.
- **Root cause:** Not yet authored.
- **User impact:** No disclosure of what is collected (photos, selfies, location, email, chat content) or how it is used.
- **Security/data impact:** The app processes biometric-adjacent data (verification selfies) with no published policy.
- **Files/symbols:** New routes/pages + links from Auth and Profile; manifest/store metadata later.
- **Tests:** None.
- **Recommended fix direction:** Author both documents; host at stable URLs; link from signup, Profile, and store listing. Include AI-valuation limitations.
- **Acceptance criteria:** Both documents reachable from within the app without authentication; linked at account creation; URLs stable and externally reachable.
- **Regression risks:** None technical.
- **Estimated scope:** **M** (mostly non-engineering)

---

**GW-RC-003 — Condition answers do not affect valuation**

- **Area:** Condition intelligence, Valuation
- **Status:** BROKEN
- **Evidence:**
  - `src/lib/utils.js:191` `calcPrice(mv, cond, ans, category)` — only `ans.scratches === 'yes'` (−2%) and `ans.issues === 'yes'` (−3%) alter price. `scratches:'some'` contributes exactly 0.
  - `utils.js:215` `hasBattery` requires `ans.deviceType ∈ ['devicePhone','deviceLaptop','deviceTablet']`; `SellViews.jsx:1694` stores the raw option value (`'phone'`,`'laptop'`,`'tablet'`). **The battery penalty has never fired.**
  - ~38 further keys (`storage`, `screenCond`, `charger`, `connectivity`, `earpads`, `waterResist`, `panelType`, `stains`, `upholstery`, `authenticity`, `boxPapers`, …) are collected and never priced.
  - Answers persist only to `listings.attributes` on publish (`AppContext.jsx:3249`) and are never read back.
- **Root cause:** The question UI was built ahead of the pricing model; the two were never connected. The `deviceType` mismatch is a label-key vs option-value confusion.
- **User impact:** Users answer up to 20 questions that do not change the number. This is a trust problem, not just a feature gap.
- **Security/data impact:** None.
- **Files/symbols:** `src/lib/utils.js` :: `calcPrice`; `src/views/SellViews.jsx` :: `getQuestionsForCategory`; `AppContext.jsx` :: `selectCondition`, `suggestPrice`.
- **Backend dependencies:** Persisting adjusted valuations requires deciding whether the adjustment is client-derived or server-validated (the valuation guard currently owns pricing integrity — a client-side multiplier bypasses it).
- **Tests:** None for `getQuestionsForCategory`; `calcPrice` partially covered by `tests/persistence-rows.test.mjs` mirrors.
- **Recommended fix direction:** (1) Fix the `deviceType` key mismatch. (2) Define an explicit answer→modifier map with stable IDs. (3) Decide where the modifier is applied so the guard still owns the envelope. Do **not** invent percentages without evidence — start with the two that exist and extend deliberately.
- **Acceptance criteria:** For a given base valuation, answering a defined high-impact question changes the suggested price by a documented, testable amount; a unit test asserts each priced key; no answer key is collected without either affecting price or being explicitly marked informational.
- **Regression risks:** Changing suggested prices affects listing prefills; the guard's upside clamp must still bound the result.
- **Estimated scope:** **L**

---

### P1 — MUST FIX BEFORE RELEASE CANDIDATE

---

**GW-RC-004 — `product_type` is hardcoded null in the scan pipeline**

- **Area:** Recognition, Condition intelligence
- **Status:** BROKEN
- **Evidence:** `api/analyze.js:3988` — `product_type: null` inside `result.candidate_payload`, unconditional. `api/submit-candidate.js:166,266` accepts and persists `product_type`; `product_candidates.product_type` exists (`20260527000001_product_candidates.sql:24`). Stage 1 returns only `category` (14 fixed values) + free-text `subcategory`; `normalizeForUI` surfaces `classification.subcategory` but no product type.
- **Root cause:** Column and API were built; the producing end never was.
- **User impact:** The taxonomy needed to make condition questions item-specific can never populate from a scan, and approved candidates carry no product type.
- **Files/symbols:** `api/analyze.js` :: `candidate_payload` construction; `normalizeForUI`.
- **Backend dependencies:** `products` has `category` + `subcategory` but **no** `product_type`; `product_candidates` does. Note `products.subcategory` already carries product-type-shaped values (`'smartphone'`, `'laptop'`, `'gaming console'`, `'smartwatch'`, `'tv'` — see `src/lib/enrich-products.mjs:17`), so a resolver may be cheaper than a new column.
- **Tests:** None.
- **Recommended fix direction:** Populate from a deterministic resolver over `subcategory` + brand/model + OCR before adding new recognition output. Blocks GW-RC-003's item-specific layer.
- **Acceptance criteria:** A scan of a known laptop produces `candidate_payload.product_type === 'laptop'`; an unrecognized item produces `null` rather than a guess; a unit test covers ≥10 of the target types.
- **Regression risks:** Low (additive field).
- **Estimated scope:** **M**

---

**GW-RC-005 — Hardcoded CORS allowlist breaks two APIs on every Preview deployment**

- **Area:** Security/privacy, Scan, Unknown-product flow
- **Status:** BROKEN (Preview); works in Production
- **Evidence:** `api/confirm-identity.js:35` and `api/submit-candidate.js:33` both declare `const ALLOWED_ORIGINS = ['https://get-worth-ai.vercel.app','http://localhost:5173','http://localhost:4173']` and return `ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]`. Preview URLs (`*-git-<branch>-*.vercel.app`) are absent, so the browser receives a mismatched `Access-Control-Allow-Origin` and blocks the response. `api/analyze.js:100` correctly uses env-driven `ALLOWED_ORIGIN`.
- **Root cause:** Two routes were written with a literal list; the third was later migrated to env config and they were not.
- **User impact:** On Preview, **identity confirmation and candidate submission silently fail** — precisely the unknown-product journey. This will masquerade as a recognition bug during tester validation.
- **Security/data impact:** None (fails closed), but the `: ALLOWED_ORIGINS[0]` fallback echoes a *wrong* origin rather than omitting the header — sloppy, though not exploitable.
- **Files/symbols:** `api/confirm-identity.js` :: `cors()`; `api/submit-candidate.js` :: `cors()`.
- **Tests:** None.
- **Recommended fix direction:** Reuse `api/analyze.js`'s env-driven pattern in both routes; omit the header entirely for disallowed origins.
- **Acceptance criteria:** From a Preview origin, `OPTIONS` and `POST` to both routes return `Access-Control-Allow-Origin` equal to the requesting Preview origin; from an unknown origin, no ACAO header is returned; Production behaviour unchanged.
- **Regression risks:** Misconfigured `ALLOWED_ORIGIN` would break Production — mitigate by keeping the production domain as a built-in default.
- **Estimated scope:** **S**

---

**GW-RC-006 — Verification-photo bucket privacy is a manual, unverified step**

- **Area:** Security/privacy, Verification
- **Status:** DEPLOYMENT STATE UNVERIFIED
- **Evidence:** `supabase/migrations/20260518000002_verification_photos_private.sql:11` — *"After applying this SQL you MUST also make the storage bucket private"*, with an example public URL at `:26`. `20260518000003_verification_photos_bucket_policy.sql` adds policies, but bucket public/private is a console setting the repo cannot assert.
- **Root cause:** A required deployment action lives in a SQL comment rather than in enforced configuration.
- **User impact:** If missed, **any identity-verification selfie is readable by anyone who can guess or obtain its URL** (`/storage/v1/object/public/verification-photos/<user-id>/selfie.jpg` — the path is the user id, i.e. guessable).
- **Security/data impact:** **High if unapplied.** Biometric-adjacent PII exposure.
- **Files/symbols:** Supabase Storage bucket `verification-photos`.
- **Tests:** `tests/security_001_002_production_verification.sql` exists but is not run in CI.
- **Recommended fix direction:** Verify in the Supabase console immediately. Then add an automated check asserting the bucket is private.
- **Acceptance criteria:** An unauthenticated `GET` of a known verification photo path returns 4xx; an admin fetch via `admin-get-verification-url` succeeds.
- **Regression risks:** None.
- **Estimated scope:** **XS** to verify, **S** to automate

---

**GW-RC-007 — Deployed RLS/migration state is unverified**

- **Area:** Security/privacy
- **Status:** DEPLOYMENT STATE UNVERIFIED
- **Evidence:** 54 migrations in git. Two production-verification scripts exist (`tests/security_001_002_production_verification.sql`, `tests/val_001_production_verification.sql`) but are not executed by `npm test` and require a live DB.
- **User impact:** Unknown — the code is strong; whether Production reflects it is unproven.
- **Recommended fix direction:** Run both verification scripts against Production and Preview; record output in this audit directory.
- **Acceptance criteria:** Both scripts pass against Production with recorded output.
- **Estimated scope:** **S**

---

**GW-RC-008 — Live scan latency and fast-path hit rate never measured**

- **Area:** Scan, Release confidence
- **Status:** UNVERIFIED
- **Evidence:** No fixture images (`tests/fixtures/recognition/` has `cases.json` only, `image: null` for all 24 cases); benchmark tier 2 reports `SKIPPED — ANTHROPIC_API_KEY not set`. Only measured figure in the repo is Stage 2 ≈19.7s (commit `0250e80`), itself a lower bound per `api/analyze.js:347`.
- **User impact:** Scan duration is unknown; derived estimate is 40–46s typical, far outside the 3–7s product goal.
- **Recommended fix direction:** Redeploy Preview, run scans, capture `[Waterfall]` lines and `result._timings`. Add fixture photos for the 24 benchmark cases.
- **Acceptance criteria:** ≥10 real Preview scans with recorded per-stage timings and observed fast-path fire rate.
- **Estimated scope:** **M**

---

**GW-RC-009 — Device/PWA behaviour never validated on hardware**

- **Area:** Mobile/PWA
- **Status:** UNVERIFIED
- **Evidence:** Safe-area/`dvh` usage is uneven (`index.css` 1, `ChatViews.jsx` 9, `CameraResultsView.jsx` 3, `ui.jsx` 2). No device tests. All iOS behaviour is inferred from comments.
- **User impact:** Unknown layout, keyboard, camera and install behaviour on real iPhones.
- **Recommended fix direction:** Structured physical-device pass on installed PWA.
- **Acceptance criteria:** Documented pass covering camera capture, keyboard overlap in chat and listing forms, safe areas on a notched device, install + OAuth return in standalone mode, and RTL layout.
- **Estimated scope:** **M**

---

### P2 — SHOULD FIX BEFORE PUBLIC V1

- **GW-RC-010 — No CI.** No `.github/workflows`. The design-lint gate crashed on Windows rather than failing, so it was off for an unknown period; 19 `raw-hex` violations accumulated in `src/App.jsx` (292/273). **Acceptance:** a CI job runs `npm test` + `npm run build` on every PR and fails the build on regression. **Scope: S**
- **GW-RC-011 — `raw-hex` design-lint ratchet exceeded.** 19 violations in `src/App.jsx`. The linter forbids raising the budget by design. **Acceptance:** `npm test` exits 0. **Scope: S**
- **GW-RC-012 — Stale `X-GetWorth-Build` header.** `api/analyze.js:106-108`, value `774e6e9-node-budget`; its own comment says remove. **Scope: XS**
- **GW-RC-013 — Manifest under-declares existing assets.** Add `maskable` icons, `screenshots`, `scope`, `lang`, `dir` — assets already exist in `public/`. **Scope: XS**
- **GW-RC-014 — User blocking absent.** `ChatViews.jsx:811` documents the intent. **Scope: M**
- **GW-RC-015 — Condition answers not persisted with the valuation.** Only `listings.attributes` on publish; lost otherwise. **Scope: M**
- **GW-RC-016 — Push notifications absent.** In-app only. Product decision. **Scope: L**
- **GW-RC-017 — SQL security/order tests not executed anywhere.** 5 `.sql` test files never run. **Scope: M**
- **GW-RC-018 — Support/contact path and AI-valuation disclaimer missing.** **Scope: S**
- **GW-RC-019 — Identity-key normalization fragments products.** Benchmark convergence 31.0%; requires a v3 key layer + re-key migration (v1/v2 are frozen by contract in `api/_lib/recognition-memory.js`). **Scope: L**

### P3 — POST-V1

- **GW-RC-020** — Remove stale "call stubs" comment (`ChatViews.jsx:750`). **XS**
- **GW-RC-021** — Decide on ungated `[CAM]` logger (`AppContext.jsx:67`). **XS**
- **GW-RC-022** — Remove/relocate `bundle.txt` (644 KB at repo root). **XS**
- **GW-RC-023** — Rename branch `test/windows-path-fix` (describes 1 of 12 commits). **XS**
- **GW-RC-024** — Recognition Memory activation beyond shadow. **L**
- **GW-RC-025** — Offline behaviour definition. **M**
- **GW-RC-026** — Retire `suggested_followup` (write-only Stage 1 field). **XS**

---

## 4. Recommended implementation order

```
1. LEGAL + ACCOUNT FOUNDATION        GW-RC-001, 002
   └─ unblocks: any App Store submission; nothing else can proceed to store without these

2. SECURITY VERIFICATION             GW-RC-006, 007
   └─ unblocks: confidence in every downstream flow; must precede tester traffic

3. PREVIEW CORRECTNESS               GW-RC-005
   └─ unblocks: unknown-product journey validation on Preview (and GW-RC-008)

4. MEASUREMENT                       GW-RC-008
   └─ unblocks: all latency decisions; converts derived estimates into evidence

5. CONDITION → VALUATION             GW-RC-004 → GW-RC-003 → GW-RC-015
   └─ product_type first: item-specific questions cannot exist without it

6. RELEASE HYGIENE                   GW-RC-010, 011, 012, 013
   └─ unblocks: trustworthy green build; CI must exist before the backlog grows

7. MARKETPLACE SAFETY                GW-RC-014, 018
   └─ unblocks: UGC-safety posture for review

8. MOBILE HARDENING                  GW-RC-009
   └─ unblocks: TestFlight candidacy

9. NATIVE iOS PREPARATION            (not yet ticketed)
```

**Why this order:** GW-RC-001/002 are the only items that make submission *impossible*, and GW-RC-001 is **L** — it needs the most lead time. GW-RC-006 is **XS to verify** and potentially high-severity, so it should be checked today regardless of sequencing. GW-RC-005 must precede GW-RC-008 or Preview measurement will be polluted by CORS failures misread as recognition bugs.

---

## 5. Release matrix

| Area | Readiness | Blocking issues | RC-ready? |
|---|---:|---|---|
| Auth/account | 70% | GW-RC-001 (deletion absent) | No |
| Scan | 85% | GW-RC-008 (unmeasured) | Nearly |
| Recognition | 85% | GW-RC-004, 019 | Nearly |
| Valuation | 90% | — (guard is strong) | Yes |
| Condition intelligence | 25% | GW-RC-003, 004 | No |
| Portfolio/save | 90% | — | Yes |
| Listings | 85% | GW-RC-003 (price link) | Nearly |
| Marketplace | 85% | GW-RC-014 | Nearly |
| Chat | 90% | — | Yes |
| Orders | 95% | GW-RC-017 (untested in CI) | Yes |
| Reviews | 90% | GW-RC-017 | Yes |
| Notifications | 70% | GW-RC-016 (no push) | Nearly |
| Profile | 85% | GW-RC-001 | Nearly |
| Verification | 75% | GW-RC-006 (bucket unverified) | No |
| Admin | 90% | — | Yes |
| Security/privacy | 75% | GW-RC-005, 006, 007 | No |
| Mobile/PWA | 60% | GW-RC-009, 013 | No |
| Release hygiene | 40% | GW-RC-010, 011, 012 | No |

**Justification note:** percentages reflect *evidence of completeness*, not code quality. Orders scores 95% because the DB matrix is genuinely authoritative and role-enforced; Condition intelligence scores 25% because the UI exists but the system it feeds does not consume it.

### Readiness summary

- **CORE PRODUCT READINESS: 78%** — the primary journey (scan → valuation → list → browse → chat → order → review) can complete end-to-end, with the condition-question branch being decorative.
- **RELEASE-CANDIDATE READINESS: 55%** — held down by absent account deletion, absent legal pages, unverified deployment state, and no CI.
- **APP STORE READINESS: NOT READY**

**Distinction:** *Core product readiness* asks "can a user accomplish the thing the app promises?" — mostly yes. *Release-candidate readiness* asks "would we ship this to the public?" — not yet. *App Store readiness* additionally requires deletion, legal documents, disclosures and a native wrapper, none of which exist. Moving from NOT READY → PREPARATION requires GW-RC-001 and GW-RC-002 only.

---

## 6. Top 10 release risks

| # | Risk | Evidence | Failure scenario | Severity | Mitigation |
|---|---|---|---|---|---|
| 1 | Verification selfies publicly readable | `20260518000002:11` manual bucket step | Path is `<user-id>/selfie.jpg` — enumerable; biometric-adjacent PII leak | **Critical if unapplied** | Verify bucket today (GW-RC-006) |
| 2 | No account deletion | §2.1 | Store rejection; privacy-request non-compliance | Critical | GW-RC-001 |
| 3 | No legal pages | §2.21 | Store rejection; undisclosed data collection | Critical | GW-RC-002 |
| 4 | Deployed RLS state unproven | 54 migrations, unverified | A single unapplied migration could expose private columns or cross-user data | High | GW-RC-007 |
| 5 | Preview CORS breaks two APIs | `confirm-identity.js:35`, `submit-candidate.js:33` | Tester validation blames recognition for a CORS failure; wasted cycles and wrong fixes | High | GW-RC-005 |
| 6 | Scan latency unknown, likely 40s+ | Stage 2 ≈19.7s measured, lower bound | Testers abandon scans; 58s client abort reached | High | GW-RC-008 |
| 7 | Condition questions decorative | `utils.js:191`, dead battery gate | Users notice answers change nothing → trust collapse | High | GW-RC-003 |
| 8 | No CI; gate silently off | No `.github/workflows`; 19 accrued violations | Regressions merge unnoticed, as already happened | Medium | GW-RC-010 |
| 9 | Device behaviour unvalidated | No device tests | Keyboard/safe-area/camera defects found only by testers | Medium | GW-RC-009 |
| 10 | Identity fragmentation | Benchmark convergence 31% | Learning and price history split across spellings of one product | Medium | GW-RC-019 |

---

## 7. Test coverage / validation map

| Area | Automated | Integration | Mutation | Needs prod | Needs iPhone | Needs 2 users | Needs admin |
|---|---|---|---|---|---|---|---|
| Scan auth | **Yes** (16) | No | **Yes** (4 killed) | Yes | Yes | No | No |
| Valuation guard | **Yes** (95) | No | **Yes** | No | No | No | No |
| Recognition/ranking | **Yes** (44) | No | **Yes** (5 killed) | Yes | No | No | No |
| Fast path | **Yes** (30) | No | **Yes** (5 killed) | Yes | No | No | No |
| Pipeline timings | **Yes** (19) | No | **Yes** | Yes | No | No | No |
| Persistence/observations | **Yes** | Partial | **Yes** | Yes | No | No | No |
| UI contracts/interaction | **Yes** | jsdom | **Yes** | No | Yes | No | No |
| **Orders** | **No** (SQL only, unrun) | No | No | **Yes** | No | **Yes** | Partial |
| **Reviews/reputation** | Integration only, **cannot start locally** | Yes | No | **Yes** | No | **Yes** | No |
| **Chat/realtime** | **None** | No | No | **Yes** | Yes | **Yes** | No |
| **Notifications** | **None** | No | No | **Yes** | Yes | **Yes** | No |
| **Listings CRUD** | **None** | No | No | **Yes** | No | No | No |
| **Verification** | **None** | No | No | **Yes** | Yes | No | **Yes** |
| **Admin** | **None** | No | No | **Yes** | No | No | **Yes** |
| **Condition questions** | **None** | No | No | No | No | No | No |
| **Account deletion** | N/A (absent) | — | — | — | — | — | — |

**Critical paths with no meaningful test:** chat/realtime, notifications, listings CRUD, verification, admin, condition questions, and orders (SQL tests exist but never execute).

**Important caveat:** much of the existing suite consists of **source-contract assertions** (structural greps over source), not end-to-end validation. `tests/scan-auth.test.mjs`, `tests/pipeline-timings.test.mjs` and parts of `tests/fast-path.test.mjs` verify that code is *shaped* correctly, not that a real request succeeds. They are valuable regression guards and were mutation-verified, but **they are not evidence that the app works in production.**

---

## 8. Final verdict

# GO — READY TO BEGIN RELEASE-CANDIDATE FIXES

**1. Why.** The architecture is coherent and, in the transaction-integrity layer, notably disciplined. `transition_order()` enforces authentication, party membership, terminal states, an explicit transition matrix, role requirements and row locking in one `SECURITY DEFINER` function. Reviews are constrained by RLS tied to completed orders plus a uniqueness index. Admin authorization reads `profiles.is_admin` from the database and explicitly refuses JWT claims. The valuation guard fails closed rather than fabricating precision. Recognition Memory was traced and is genuinely shadow-only. None of the findings in this audit require redesigning a foundation — they are things that were never finished, never connected, or never verified.

**2. Largest blocker.** Account deletion does not exist anywhere in the product (GW-RC-001). It is simultaneously a store requirement, a privacy obligation, and the largest single piece of unbuilt work (**L**), and it is entangled with counterparty data — orders and reviews belong to *both* users, so deletion needs a per-table policy rather than a cascade.

**3. First recommended work package.** **GW-RC-006 today** (XS, potentially critical — verify the verification-photos bucket is private), then **GW-RC-001 + GW-RC-002** in parallel with **GW-RC-005** (S, unblocks Preview validation). GW-RC-001 should start first because it has the longest lead time.

**4. What must NOT be changed yet.**
- The Stage-2 fast-path gate — evidence-gated and mutation-verified; do not loosen for speed.
- `api/_lib/recognition-memory.js` v1/v2 key normalization — frozen by contract; changing it orphans stored keys.
- The valuation guard's fail-closed behaviour — `manual_required` is correct, not a bug.
- Recognition Memory's shadow status.
- `/api/analyze` authentication requirements — the recent 401 was a client defect and has been fixed client-side.
- The order transition matrix.

**5. Is an architectural rewrite justified?** **No.** Two subsystems need *completion*, not replacement: the condition-question engine (built but disconnected) and identity-key normalization (needs a v3 layer alongside the frozen v1/v2, which the existing versioning scheme already anticipates). Everything else is finishing, verifying, and documenting work.

---

*End of GW-RELEASE-001.*
