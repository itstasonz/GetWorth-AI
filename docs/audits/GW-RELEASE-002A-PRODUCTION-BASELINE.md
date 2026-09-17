# GW-RELEASE-002A — Production Scan Evidence Extraction

**Type:** Read-only data extraction / analysis
**Date:** 2026-09-06
**Repository state:** branch `main`, HEAD `fce24f9`
**Outcome:** **EXTRACTION NOT PERFORMED — no credential path exists from this environment.**

> **No code, migration, dependency, environment, or deployment was changed.**
> **No database was queried. No production data was accessed. No secret value was read or printed.**

---

## EXECUTIVE SUMMARY

**The extraction could not be performed, and no numbers are reported.** This is a blocked task, not a failed one — and the blocker is environmental, not architectural.

The task's own governing constraint was: *"Only query Production if the currently available Supabase credentials/configuration can be positively identified as Production. Do not guess environments."* That gate fails on two independent counts:

1. **No Supabase credentials exist anywhere reachable from this environment** — so no query is possible at all.
2. **Even if credentials existed, nothing here distinguishes Production from Preview** — so querying would have meant guessing, which was explicitly forbidden.

Fabricating a baseline from caps, code paths, or plausible-looking distributions would defeat the entire purpose of GW-RELEASE-002A. Every figure below is therefore stated as **NOT MEASURABLE (blocked)** rather than estimated.

**What this document delivers instead** is the complete, ready-to-run extraction kit: exact SQL for every requested section, the access level each query needs, PII-safety built into each statement, and — the most useful discovery of this task — a **precise pipeline-version discriminator** that makes the required "old vs current pipeline" split exact rather than approximate.

Whoever holds admin access can produce the entire GW-RELEASE-002A baseline in roughly one sitting by running §11.

---

## 1. BLOCKER — evidence

### 1.1 No credentials

Checked without reading or printing any secret value:

| Source | Result |
|---|---|
| Shell environment | All ten relevant vars **unset**: `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_KEY`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_VISION_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_JWT_SECRET` |
| `.env.local` (1,321 bytes) | Defines exactly **one** variable: `VERCEL_OIDC_TOKEN`. Presence-only inspection confirmed: **no** service-role-shaped key, and it does **not** reference the linked project ref |
| `~/.supabase` | Contains only `telemetry.json` and `traces` — no auth material |
| Supabase CLI | **Not on PATH** |
| `psql` | **Not on PATH** |

`VERCEL_OIDC_TOKEN` is a short-lived build-time artifact. It is not a Supabase credential and grants no database access.

### 1.2 Environment cannot be positively identified

`supabase/.temp/linked-project.json` links exactly one project:

```json
{"ref":"xbwxbdxuklrbnkpgonjc","name":"GetWorth","organization_id":"…"}
```

A single linked ref named "GetWorth" does **not** establish which environment it is. Vercel Preview and Production commonly share one Supabase project, and nothing in the repository declares a prod/preview split. Treating this as Production would be exactly the guess the task forbids.

### 1.3 `scan_events` is admin-gated — an anon key would not have sufficed

Even with credentials, the primary telemetry table is not openly readable:

```sql
-- supabase/migrations/20260701120000_gw000_scan_persistence.sql:58-63
ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_events_admin_select
  ON scan_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));
```

And `record_scan` is service-role only (`:128-129`). Extraction therefore requires **either** the service-role key **or** an authenticated session belonging to a user with `profiles.is_admin = true`. Neither is available here.

**This is correct security design, not a defect.** It is recorded so the next attempt provisions the right access rather than rediscovering the wall.

---

## 2. THE USEFUL DISCOVERY — an exact pipeline-version discriminator

Section 1 of the task asked for an "ALL HISTORY" vs "POST-`fce24f9`" split, and allowed a fallback if the deploy timestamp could not be established. **A deploy timestamp is not needed** — a precise, self-describing discriminator exists in the data.

`api/analyze.js:4204` persists `ai_raw_response: result` — the **entire** result object. Three keys were introduced by the merged work and cannot appear on any earlier row:

| Key on `ai_raw_response` | Introduced by | Meaning |
|---|---|---|
| `_timings` | `6282b68` *perf(scan): instrument the pipeline waterfall* | Per-stage waterfall present |
| `stage2_status` | `ece8411` *feat(scan): add evidence-gated Stage 2 fast path* | Fast path exists |
| `fast_path` | `ece8411` | Fast path fired |

So the split is a jsonb key-existence test, exact to the row:

```sql
-- CURRENT pipeline (post-fce24f9)
WHERE v.ai_raw_response ? '_timings'

-- LEGACY pipeline (pre-fce24f9)
WHERE NOT (v.ai_raw_response ? '_timings')
```

`valuation_version = 2` is a coarser fallback (it marks VAL-001+, which predates this work) and should be used only if `_timings` is absent for an unrelated reason.

**Consequence for expectations:** because `fce24f9` was merged and pushed only immediately before this audit, the current-pipeline partition is expected to be **empty or near-empty**. §9 states what that means for the release gate.

---

## 3. FIELD AVAILABILITY BY PIPELINE ERA

This determines what each partition *can* answer, and is the reason mixing eras would corrupt the baseline.

| Metric | Legacy rows | Current rows | Path |
|---|---|---|---|
| Server total latency | **YES** | YES | `scan_events.payload->>'total_ms'`; `_debug.pipeline.total_ms` |
| Stage 2 fallback occurred | **YES** | YES | `scan_events.payload->>'stage2_fallback'`; `_debug.pricing.stage2_fallback_used` |
| Stage 2 timeout | **YES** | YES | `_debug.pricing.stage2_timeout` |
| Google Vision fired | **YES** | YES | `scan_events.payload->>'vision_used'` |
| Retrieval candidates + top-3 | **YES** | YES | `_debug.retrieval.candidates_count`, `.top3` |
| Per-strategy retrieval latency | **YES** | YES | `_debug.retrieval.strategy_log[].elapsed_ms` |
| DB match / candidate needed | **YES** | YES | `_debug.retrieval.db_match_found` |
| Pricing status + guard action | **YES** | YES | `_debug.pricing.pricing_status`, `.guard_action`, `.guard_degraded_reason` |
| Confidence (raw + calibrated) | **YES** | YES | `_debug.stage2.raw_confidence`, `.calibrated_confidence` |
| User correction occurred | **YES** | YES | `_debug.stage1.correction_source` |
| **Per-stage waterfall** | **NO** | YES | `ai_raw_response->'_timings'` |
| **identity_resolution level** | **NO** | YES | `ai_raw_response->'identity'->>'level'` |
| **exact_model_ambiguous** | **NO** | YES | `ai_raw_response->'identity'->>'exact_model_ambiguous'` |
| **stage2_status / fast_path** | **NO** | YES | `ai_raw_response->>'stage2_status'` |
| **Evidence-class distribution** | **NO** | YES | `_debug.retrieval` ranking fields |
| **confidence_evidence** | **NO** | YES | verification provenance |
| User-perceived total time | **NO** | **NO** | Server clock starts at `TREQ`; client timings are `DEV`-gated and stripped from Production builds |
| Abandoned / cancelled scans | **NO** | **NO** | Aborted pipelines return before `scan_analyzed` is emitted |
| Client-observed 401/429/504 | **NO** | **NO** | No client telemetry sink |

**Six of the fourteen requested metric families are NOT MEASURABLE on legacy rows at all** — including every identity-resolution and fast-path metric, which are the ones the release gate most needs.

---

## 4. CURRENT PIPELINE SAMPLE SIZE

**NOT MEASURABLE (blocked).** Requires §11.1.

Expected value once run: **zero or near-zero**, since `fce24f9` was merged and pushed minutes before this audit and no deployment has been confirmed since. If the count is zero, every current-pipeline metric in this document remains INSUFFICIENT DATA regardless of how much legacy traffic exists.

---

## 5. LATENCY TABLE

| Metric | Legacy | Current | Status |
|---|---|---|---|
| Sample count | — | — | NOT MEASURABLE (blocked) |
| Median / P75 / P90 / P95 / min / max server `total_ms` | — | — | NOT MEASURABLE (blocked) — query ready (§11.2) |
| Stage 1 ms | n/a | — | NOT MEASURABLE on legacy; blocked on current |
| Google Vision ms | n/a | — | Same |
| Embedding ms | n/a | — | Same |
| Retrieval ms | partial (`strategy_log`) | — | Blocked |
| Stage 2 ms | n/a | — | NOT MEASURABLE on legacy; blocked on current |
| Persistence ms | n/a | — | Same |
| Unaccounted | n/a | — | Same |
| Missing-data % | — | — | Computed by §11.2 |

**Standing caveat, restated because it governs interpretation:** server `total_ms` is **not** user-perceived latency. Client compression, upload and render fall outside the budget clock, which starts at `TREQ` inside the handler. A 3-photo scan is a derived ~1.2 MB base64 payload — roughly 1.9s of upload alone at 5 Mbps, before compression and render. Server `total_ms` is a **lower bound** on what the user experiences.

---

## 6. FAST PATH VS STAGE 2

**NOT MEASURABLE (blocked), and structurally unmeasurable on legacy rows** — `stage2_status` did not exist before `ece8411`.

Requested breakdown (count, median/P90 `total_ms`, pricing_status distribution, confirmation/correction rate) is produced by §11.4 once current-pipeline rows exist.

**Recorded constraint:** whatever the measured hit rate turns out to be, the gate must not be loosened to raise it. `tests/fast-path.test.mjs` FP-23 deliberately pins a known conservatism — a catalog row spelled `G-502` does not match a recognised `G502`, so the gate declines and Stage 2 runs. The documented remedy is **better catalog model matching**, never a weaker gate. A low hit rate is a catalog-quality finding, not a gate-tuning invitation.

---

## 7. RECOGNITION BEHAVIOR

**NOT MEASURABLE (blocked); `identity_resolution` and `exact_model_ambiguous` are additionally unmeasurable on legacy rows.**

Confidence bucketing (`<0.50`, `0.50–0.69`, `0.70–0.84`, `≥0.85`) **is** available on legacy rows via `_debug.stage2.raw_confidence` / `calibrated_confidence` — see §11.5.

**Labelling discipline, as instructed:** these are **behaviour distributions, not accuracy rates.** A high proportion of `≥0.85` confidence says the system is confident, not that it is right.

---

## 8. CORRECTION PROXY

**NOT MEASURABLE (blocked).** Query ready (§11.6).

> ### CORRECTION RATE = ACCURACY PROXY ONLY
> It is **not** the true wrong-exact rate. Unnoticed mistakes generate no correction, so the measured rate is a **lower bound** on the real error rate. A user who accepts a wrong identity is indistinguishable in telemetry from one who was served a right one.

Two independent sources exist and should be cross-checked:

1. **`recognition_memory`** — `confirmation_count`, `correction_count`, `distinct_user_count`, populated by `memory_record_confirmation` (`api/confirm-identity.js:184`) and by `'correction'` samples appended to the identity the user corrected *away from*.
2. **`_debug.stage1.correction_source`** on each valuation — `'user_selected'` when the user overrode the identity in-session.

**Highest-value cohort, called out as instructed:** `calibrated_confidence >= 0.85 AND correction_source IS NOT NULL`. These are cases where the system was confident **and wrong enough that a human intervened** — the single most diagnostic set available without labelling. §11.6 isolates them, aggregate-only.

---

## 9. RETRIEVAL

**NOT MEASURABLE (blocked).** Available on legacy rows once queried: Vision fire rate, `candidates_count`, `db_match_found`, DB-missing rate, per-strategy `elapsed_ms` and success from `strategy_log`. Evidence-class distribution is **current-pipeline only**.

---

## 10. PRICING

**NOT MEASURABLE (blocked).** `pricing_status`, `price_method`, `guard_action`, `guard_degraded_reason`, `guard_pricing_source`, `pre_source` are all present on legacy rows — §11.7 is runnable immediately with access.

### Guard-safety evidence — the distinction the task asked for

| Question | Answer | Basis |
|---|---|---|
| Guard bypass observed? | **NOT MEASURABLE** (blocked), but **field exists** | `_debug.pricing.guard_action` is recorded per scan; a count is obtainable |
| Incompatible anchor observed? | **NOT MEASURABLE** — *field was never recorded* | Anchor compatibility verdicts are computed in-memory (`isCompatibleAnchor`) and logged to console, **not persisted**. Absence in telemetry must **not** be read as absence in reality |
| Sibling anchor reaching trusted valuation? | **NOT MEASURABLE** — *field was never recorded* | Same. `_sibling_of` is a runtime marker on candidate rows, not persisted |

**This is exactly the ZERO OBSERVED vs NOT MEASURABLE distinction the task demanded.** Code-level evidence for anchor safety is strong — `evaluateFastPath` requires `verdict.modelMatched === true`, `preQuoteFromCatalog` gates every anchor through `isCompatibleAnchor`, and FP-14b proves the `brand_category_sibling` case is refused (mutation-verified) — but **no production count exists, and the schema cannot produce one retrospectively.** Closing that gap would require persisting the anchor verdict, which is a code change and out of scope here.

---

## 11. RELIABILITY

**NOT MEASURABLE (blocked)** for the measurable portion; **structurally unmeasurable** for the rest.

| Metric | Feasible? | Note |
|---|---|---|
| Completed scans | Yes (blocked) | `scan_events` event_type `scan_analyzed` |
| Persistence failures | Yes (blocked) | event_type `persistence_failed` |
| Derived-write failures | Yes (blocked) | `derived_failed` |
| Stage 2 failures / fallbacks | Yes (blocked) | `payload->>'stage2_fallback'` |
| Fallback recoveries | Yes (blocked) | `pre_source` distribution |
| **Scan attempts** | **NO** | A scan that fails before `scan_analyzed` emits nothing durable |
| **Stage 1 failures** | **NO** | Returns 503 and exits before any event is written |
| **401 / 429** | **NO** | Rejected before the pipeline; no durable record |
| **Aborts** | **NO** | Early return, no event |

**Therefore "technical completion ≥95%" is not directly computable.** The denominator — attempts — never reaches durable telemetry. Only *completed-and-persisted* vs *completed-but-persistence-failed* is measurable, which is a narrower and more flattering ratio. This is a genuine instrumentation gap, and the client-side beacon proposed in GW-RELEASE-002 §G3 is what would close it.

---

## 12. RELEASE-GATE TABLE

| Criterion | Verdict | Reason |
|---|---|---|
| Median server latency (proxy for ≤20s user target) | **INSUFFICIENT DATA** | No query access |
| P90 server latency (proxy for ≤30s user target) | **INSUFFICIENT DATA** | No query access |
| Technical completion ≥95% | **NOT MEASURABLE** | Attempt denominator never reaches telemetry (§11) |
| Stage 2 timeout/fallback rate | **INSUFFICIENT DATA** | Field exists on legacy rows; blocked |
| Fast-path hit rate / correctness / time saved | **INSUFFICIENT DATA** | Field exists current-pipeline only; expected sample ≈0 |
| Identity: wrong-exact ≤2.5% | **NOT MEASURABLE** | Requires labelled ground truth — no telemetry can supply it |
| Identity: high-confidence wrong-exact = 0 | **NOT MEASURABLE** | Same. Correction proxy gives a lower bound only |
| Identity: exact + family ≥80% | **NOT MEASURABLE** | Same |
| Identity: useful identity ≥90% | **NOT MEASURABLE** | Same |
| Pricing: usable valuation ≥80% | **INSUFFICIENT DATA** | `pricing_status` on legacy rows; blocked |
| Pricing: wrong sibling anchor = 0 | **NOT MEASURABLE** | Verdict never persisted (§10). Code evidence strong; production count impossible retrospectively |
| Pricing: catastrophic error = 0 | **INSUFFICIENT DATA** | `guard_degraded_reason` distribution obtainable |
| Pricing: unsafe guard bypass = 0 | **INSUFFICIENT DATA** | `guard_action` obtainable; code evidence strongest in the audit |
| Stuck scanning = 0 reproducible | **INSUFFICIENT DATA** | Two causes fixed in `76d3ec7`; not yet validated on a deployed build |

**No criterion reaches PASS or FAIL.** Nine are INSUFFICIENT DATA (unblocked by access); five are NOT MEASURABLE (require new labelling or new instrumentation).

---

## 13. THE EXTRACTION KIT — ready to run

**Access required:** service-role key, **or** an authenticated session for a user with `profiles.is_admin = true`.
**PII discipline:** every statement below is aggregate-only. None selects `user_id`, email, name, message content, image URLs, or free text. Do not add `SELECT *` to these.

### 11.1 Sample & partition

```sql
-- Overall shape + exact pipeline split
SELECT
  count(*)                                                   AS valuations_total,
  count(*) FILTER (WHERE ai_raw_response ? '_timings')        AS current_pipeline,
  count(*) FILTER (WHERE NOT (ai_raw_response ? '_timings'))  AS legacy_pipeline,
  count(DISTINCT scan_uuid)                                   AS distinct_scan_uuids,
  count(DISTINCT user_id)                                      AS distinct_users,   -- aggregate only
  min(created_at) AS earliest, max(created_at) AS latest
FROM valuations;

SELECT count(*) AS scan_events_total,
       count(*) FILTER (WHERE event_type='scan_analyzed') AS analyzed,
       min(created_at) AS earliest, max(created_at) AS latest
FROM scan_events;
```

### 11.2 Latency (run once per partition)

```sql
SELECT
  count(*) AS n,
  count(*) FILTER (WHERE payload->>'total_ms' IS NULL) * 100.0 / NULLIF(count(*),0) AS pct_missing,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (payload->>'total_ms')::numeric) AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY (payload->>'total_ms')::numeric) AS p75,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY (payload->>'total_ms')::numeric) AS p90,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'total_ms')::numeric) AS p95,
  min((payload->>'total_ms')::numeric) AS min_ms,
  max((payload->>'total_ms')::numeric) AS max_ms,
  count(*) FILTER (WHERE (payload->>'total_ms')::numeric > 35000) * 100.0 / NULLIF(count(*),0) AS pct_over_35s
FROM scan_events
WHERE event_type = 'scan_analyzed';
```

### 11.3 Per-stage waterfall (current pipeline only)

```sql
SELECT count(*) AS n,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'stage1_vision')::numeric) AS stage1_p50,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'stage1_vision')::numeric) AS stage1_p90,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'stage2_verify')::numeric) AS stage2_p50,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'retrieval')::numeric)     AS retrieval_p50,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'google_vision')::numeric) AS vision_p50,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'unaccounted')::numeric)   AS unaccounted_p50
FROM valuations WHERE ai_raw_response ? '_timings';
```

### 11.4 Fast path vs Stage 2 (current pipeline only)

```sql
SELECT ai_raw_response->>'stage2_status' AS status,
  count(*) AS n,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'total')::numeric) AS p50_ms,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY (ai_raw_response->'_timings'->>'total')::numeric) AS p90_ms,
  count(*) FILTER (WHERE ai_raw_response->'_debug'->'stage1'->>'correction_source' IS NOT NULL) AS corrected
FROM valuations WHERE ai_raw_response ? 'stage2_status'
GROUP BY 1;
```

### 11.5 Recognition behaviour

```sql
-- Confidence buckets (works on BOTH eras)
SELECT width_bucket((ai_raw_response->'_debug'->'stage2'->>'calibrated_confidence')::numeric,
                    ARRAY[0.50,0.70,0.85]) AS bucket, count(*)
FROM valuations GROUP BY 1 ORDER BY 1;
-- bucket 0:<0.50  1:0.50-0.69  2:0.70-0.84  3:>=0.85

-- identity_resolution (current pipeline only)
SELECT ai_raw_response->'identity'->>'level' AS level,
       count(*) FILTER (WHERE (ai_raw_response->'identity'->>'exact_model_ambiguous')::boolean) AS ambiguous,
       count(*) AS n
FROM valuations WHERE ai_raw_response ? 'identity' GROUP BY 1;
```

### 11.6 Correction proxy — aggregate only

```sql
SELECT sum(confirmation_count) AS confirmations,
       sum(correction_count)   AS corrections,
       sum(correction_count)::numeric / NULLIF(sum(confirmation_count)+sum(correction_count),0) AS correction_ratio
FROM recognition_memory;

-- HIGHEST-VALUE COHORT: confident AND corrected. Counts only — no identities.
SELECT count(*) AS high_conf_corrected
FROM valuations
WHERE (ai_raw_response->'_debug'->'stage2'->>'calibrated_confidence')::numeric >= 0.85
  AND ai_raw_response->'_debug'->'stage1'->>'correction_source' IS NOT NULL;
```

### 11.7 Pricing & guard

```sql
SELECT ai_raw_response->'_debug'->'pricing'->>'pricing_status'      AS status,
       ai_raw_response->'_debug'->'pricing'->>'guard_action'        AS guard_action,
       ai_raw_response->'_debug'->'pricing'->>'guard_degraded_reason' AS degraded_reason,
       ai_raw_response->'_debug'->'pricing'->>'pre_source'          AS pre_source,
       count(*)
FROM valuations GROUP BY 1,2,3,4 ORDER BY 5 DESC;
```

### 11.8 Retrieval & Vision

```sql
SELECT
  count(*) AS n,
  count(*) FILTER (WHERE (payload->>'vision_used')::boolean)     AS vision_fired,
  count(*) FILTER (WHERE (payload->>'stage2_fallback')::boolean) AS stage2_fallback
FROM scan_events WHERE event_type='scan_analyzed';

SELECT (ai_raw_response->'_debug'->'retrieval'->>'db_match_found')::boolean AS db_match,
       count(*),
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY (ai_raw_response->'_debug'->'retrieval'->>'candidates_count')::numeric) AS median_candidates
FROM valuations GROUP BY 1;
```

### 11.9 Reliability

```sql
SELECT event_type, count(*) FROM scan_events GROUP BY 1 ORDER BY 2 DESC;
```

---

## 14. RECOMMENDED LABELLED CORPUS

Production evidence was unavailable to refine this, so the recommendation stays at the task's default and is justified from repository evidence rather than production variance.

**Size: 18 objects × 3 photo conditions = 54 scans.** Within the 15–20 default. Do **not** increase until §11 has run — production variance is precisely what should size the final corpus.

Three conditions per object: **clean label visible** / **shape-only, no legible text** / **angled or partial**. The middle condition is the one that exercises every safeguard built in this work.

**Overrepresent these, justified by repository evidence:**

| Category | Count | Why — from evidence |
|---|---|---|
| Sibling-dense electronics (Logitech G-series mice, iPhone/Galaxy siblings, Sony WH-1000XM4/XM5) | **6** | The prompt itself names these as *"nearly indistinguishable by shape alone"* (`buildRecognitionPrompt`). Benchmark separation failure was `G502`/`G502 Hero`/`G502 X Plus` |
| Identity-fragmenting brands (Samsung vs Samsung Electronics; ASUS vs ASUS ROG) | **3** | Measured convergence 31.0% — brand variants fork every product |
| Genuinely absent from catalog | **3** | Exercises DB-missing → `candidate_needed`, the path most likely to regress |
| Non-electronics (sofa, chair, microwave, coffee machine) | **4** | Whole categories unexercised by the synthetic corpus, which is electronics-heavy |
| Label-rich easy cases (control) | **2** | Establishes the fast-path hit-rate ceiling and a latency floor |

**These 18 slots already exist** in `tests/fixtures/recognition/cases.json` — all 24 currently have `image: null`. Populating them plus setting `ANTHROPIC_API_KEY` makes `npm run bench:recognition` tier 2 executable with no code change.

**Expected resolution:** ~54 scans places wrong-exact rate to roughly ±5pp — enough to distinguish 2% from 20%, which is the decision that matters, and not enough to certify 2.5% precisely. State that limit when reporting the result.

---

## 15. TOP 5 DATA-BACKED PROBLEMS

Ranked by release impact. Each is backed by repository evidence; **none** is backed by production measurement, and that is itself problem #1.

**1 — The product has never been measured, and access to its own telemetry is not provisioned.**
Purpose-built telemetry exists (`scan_events`, described in its migration as powering an *"Internal Intelligence Dashboard"*), has been collecting since GW-000, and **has never been read**. No credential path exists from a developer environment. *Impact: every release threshold is unfalsifiable.*

**2 — The current pipeline has effectively zero production exposure.**
`_timings`, `stage2_status`, `fast_path` and `identity_resolution` were merged minutes before this audit. Every current-pipeline metric — including the entire fast-path evaluation — is expected to return a near-empty sample. *Impact: the newest and least-proven code is the least measured.*

**3 — Technical completion ≥95% is not computable as specified.**
Failures before `scan_analyzed` (Stage 1 503s, 401s, 429s, aborts) emit nothing durable, so the denominator is missing. Only completed-and-persisted vs completed-but-persistence-failed is available — a narrower and more flattering ratio. *Impact: a reliability threshold that cannot be honestly evaluated.*

**4 — Anchor-safety cannot be verified retrospectively at any access level.**
`isCompatibleAnchor` verdicts and `_sibling_of` markers are computed in memory and logged to console, never persisted. "Wrong sibling pricing anchor = 0" is **NOT MEASURABLE**, not "zero observed". Code evidence is strong and mutation-verified; production evidence is structurally impossible without a schema change. *Impact: a P0-class pricing-safety criterion rests entirely on code review.*

**5 — User-perceived latency remains invisible.**
The budget clock starts at `TREQ`; compression, upload and render are outside it, and client timings are `DEV`-gated to localhost and stripped from Production builds. Server `total_ms` is a **lower bound**. *Impact: the ≤20s median target cannot be evaluated even with full database access.*

---

## FINAL STATUS

**EXTRACTION BLOCKED — NO PRODUCTION DATA ACCESSED, NO FIGURES REPORTED.**

The single next action is provisioning read access — a service-role key, or an admin-flagged account whose session can run §11 — after positively confirming which environment the `GetWorth` project serves. Everything else in this document is ready to execute the moment that exists.

---

*End of GW-RELEASE-002A.*
