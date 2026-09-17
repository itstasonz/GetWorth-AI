# GW-RELEASE-002 — Scan Quality & Performance Release Gate

**Type:** Read-only evidence audit
**Date:** 2026-09-06
**Repository state:** branch `main`, HEAD `fce24f9` (all 12 scan-work commits merged and pushed)
**Scope:** Recognition accuracy, exact-model safety, retrieval quality, pricing-anchor safety, valuation quality, and scan latency — evaluated as **release criteria**, not as engineering aspirations.

> **No code, migration, dependency, environment, or deployment was changed by this audit.**

---

## Executive summary

**Verdict: INSUFFICIENT REAL-WORLD DATA** (stated formally in §8).

The distinction this audit exists to enforce is between **evidence that the code behaves correctly** and **evidence that the product performs acceptably for real users**. GetWorth has a great deal of the former and effectively none of the latter.

Three findings shape everything below:

1. **Every accuracy number in this repository is synthetic.** The only benchmark tier that touches a real image or a real model call — tier 2 — **has never executed**. Its own output records `fixtures_present: 0`, `anthropic_key: false`, `skipped_reason: "ANTHROPIC_API_KEY not set"`.

2. **The only measured production latency figure in the entire repository is a single sentence in a commit message** — Stage 2 ≈19.7s (`0250e80`) — and `api/analyze.js:347` records that *6 of 6* production scans aborted **at** the cap, making 19.7s a **lower bound**, not a measurement of completion.

3. **The instrumentation needed to close both gaps already exists and is already persisting data.** `scan_events` was purpose-built for this (its migration says *"This single table powers the Internal Intelligence Dashboard"*), `_debug` is *"always attached"* to every response and stored in `valuations.ai_raw_response`, and `recognition_memory` accumulates human confirmation/correction counts. **No new code is required to measure most of what this gate needs — only traffic and a query.**

The correct reading is not "the scan is bad." It is: **the scan has never been measured, and the machinery to measure it is already built and running.**

---

## A. What accuracy metrics are currently measurable

### A1. Offline / synthetic — runnable today, zero cost, zero credentials

Source: `scripts/recognition-benchmark.mjs` (tier 1 + tier 1b), `tests/recognition-baseline.test.mjs` (44 tests), `tests/fast-path.test.mjs` (30 tests).

| Metric | What it measures | Provenance |
|---|---|---|
| **Identity convergence** | Do all spellings of one product yield one key? | SYNTHETIC — string pairs from `cases.json`, no image |
| **Sibling separation** | Do different products keep different keys? | SYNTHETIC |
| **Ranking top-1** | Does evidence beat score in an adversarial pool? | SYNTHETIC — hand-built rows |
| **DB-missing control** | Does an absent product stay unmatched? | SYNTHETIC |
| **Fast-path gate qualification** | Does the gate fire/refuse on 28 constructed scenarios? | SYNTHETIC |
| **Confidence calibration invariants** | Can self-declaration raise confidence? | SYNTHETIC |

**What these prove:** the *logic* is correct under constructed conditions, and is mutation-verified (14 mutants killed across three suites).
**What these do not prove:** anything about a real photograph of a real object.

### A2. Production-measurable **without any new code** — requires only traffic + a query

This is the most under-appreciated asset in the repository.

| Metric | Source | Status |
|---|---|---|
| **Correction rate** (user corrected the identity) | `_debug.stage1.correction_source` in `valuations.ai_raw_response`; `recognition_memory_samples.sample_type = 'correction'`; `recognition_memory.correction_count` | Wired end-to-end |
| **Confirmation rate** (user confirmed the identity) | `api/confirm-identity.js:184` → `memory_record_confirmation`; `recognition_memory.confirmation_count`, `distinct_user_count` | Wired end-to-end |
| **Alternatives-selection rate** (user picked a different candidate) | `_debug.stage1.correction_source = 'user_selected'` | Wired |
| **DB-match rate** | `_debug.retrieval.db_match_found` | Wired |
| **Candidate-needed rate** (DB-missing) | `result.product_candidate_needed` | Wired |
| **Identification-method distribution** | `_debug.stage2.identification_method` | Wired |
| **Confidence distribution** (raw vs calibrated) | `_debug.stage2.raw_confidence`, `calibrated_confidence` | Wired |
| **Retrieval candidate counts + top-3** | `_debug.retrieval.candidates_count`, `top3` | Wired |

**Critical property:** `recognition_memory` confirmation/correction counts are **human-verified ground truth**, generated as a by-product of normal use. The memory *layer* is shadow-only for **influence** — but the **data it collects is real**, and reading it for measurement does not violate the shadow constraint.

This means the headline accuracy question — *how often do users tell us we were wrong?* — is answerable from production with **zero new instrumentation**.

### A3. NOT measurable without human labelling

| Metric | Why not |
|---|---|
| **True wrong-exact rate** | Requires knowing what the item actually was. Correction rate is a *lower bound* — users who don't notice an error, or don't bother correcting, are invisible. |
| **High-confidence wrong-exact rate** | Same. Requires a labelled corpus. |
| **Exact + appropriate family ≥80%** | Requires ground-truth family labels. |
| **Useful identity ≥90%** | "Useful" needs a human judgement per scan. |

**Consequence:** the four IDENTITY thresholds in §F **cannot be evaluated by instrumentation alone**, ever. They require a labelled fixture corpus (tier 2) or human-reviewed production sampling.

---

## B. What latency metrics are currently measurable

### B1. HISTORICAL — already persisted; queryable now if any production traffic exists

| Metric | Source | Since |
|---|---|---|
| **Server total scan time** | `scan_events.payload.total_ms` (event `scan_analyzed`); also `_debug.pipeline.total_ms` | commit `3d7a8aa`, well before this session |
| **Stage 2 fallback occurrence** | `scan_events.payload.stage2_fallback`; `_debug.pricing.stage2_fallback_used`, `stage2_timeout` | `3d7a8aa` / GW-000 |
| **Google Vision usage** | `scan_events.payload.vision_used`; `_debug.pipeline.vision_used` | Same |
| **Per-strategy retrieval latency** | `_debug.retrieval.strategy_log[].elapsed_ms` + `parallel_group`, `started_ms`, `finished_ms` | GW-001 |
| **Budget headroom** | `_debug.pipeline.budget_ms` vs `total_ms` | Same |
| **Technical completion** | `scan_events` event types: `scan_analyzed`, `valuation_recorded`, `persistence_failed`, `derived_failed` | GW-000 |

`supabase/migrations/20260701120000_gw000_scan_persistence.sql:39` states the intent explicitly: *"This single table powers the Internal Intelligence Dashboard."*

**If GetWorth has served any production scans, median and P90 total latency, Stage 2 fallback frequency, and Vision usage are already answerable by SQL today.** Whether rows exist is **UNVERIFIED** — this audit cannot query the database.

### B2. NEW — future scans only (merged in `fce24f9`, no scan has yet used them)

| Metric | Source |
|---|---|
| **Per-stage waterfall** — auth, body_parse, rate_limit, stage1_vision, google_vision, embed_corrections, retrieval, stage2_verify, pricing_rescue, persist_scan, persist_derived | `result._timings` + `[Waterfall]` log |
| **`unaccounted`** (glue cost) | `_timings.unaccounted` |
| **Fast-path fire + provenance** | `result.stage2_status`, `result.fast_path.corroboration` |
| **Identity resolution level** | `result.identity.level`, `ambiguous_between` |
| **Confidence provenance** | `verification.confidence_evidence` |

These ship on every response and are persisted via `ai_raw_response`, so they will accumulate automatically from the first post-merge scan.

### B3. NOT measurable — a genuine gap

| Metric | Why not |
|---|---|
| **User-perceived total time** | The server budget clock starts at `TREQ` inside the handler. Client-side compression, upload, and render are **outside** it. |
| **Client compress + upload time** | Logged client-side only under `if (DEV)` (`AppContext.jsx:222`, `[Pipeline] API:`), and `DEV` is hostname-gated to localhost — **compiled out of every Preview and Production build.** |
| **Abandonment / user-cancelled scans** | Aborted pipelines return before `scan_analyzed` is emitted. |
| **Client-observed 401/429/504** | No client telemetry sink. |

**This is the single instrumentation gap that matters for the PERFORMANCE thresholds.** "Median total scan ≤20s" is a *user-perceived* criterion; the repository can currently only measure the *server* portion. On a 3-photo scan at ~1.2 MB base64, upload alone is a derived ~1.9s at 5 Mbps — plus compression and render.

---

## C. What is known from existing benchmarks

### C1. Synthetic results — recorded, reproducible

From `docs/baselines/recognition-baseline-2026-09-06.json` and `recognition-after-scan016.json`:

| Metric | Value | Provenance |
|---|---|---|
| Identity convergence (mean) | **31.0%** — 2/23 products have a single identity | SYNTHETIC |
| Sibling separation (mean) | **97.8%** — 22/23 stay distinct | SYNTHETIC |
| Ranking top-1, flat sort | **0/23** | SYNTHETIC (adversarial by construction) |
| Ranking top-1, evidence-class | **23/23** | SYNTHETIC |
| DB-missing control | `exact_match=false` — PASS | SYNTHETIC |

**The convergence figure is a real quality signal despite being synthetic:** `G900` / `G 900` / `M-G900` / `G900 Chaos Spectrum` produce four identities for one mouse, and `Samsung` vs `Samsung Electronics` forks every Samsung product. This fragments learning and price history in production regardless of image quality.

**The 0/23 figure must not be quoted as a production accuracy claim.** That pool is deliberately constructed so decoys outrank truth under a flat sort; it measures whether evidence beats score, not real top-1 accuracy.

### C2. The one production number that exists

> *"Verified in production: Stage 2 completes (~19.7s), comp_based price, confidence 83%, no rough fallback."* — commit `0250e80`

Corroborated by two code comments citing production scans (`api/analyze.js:3374`, `:3705`: *"18–20s (4/4 production scans)"*). **But** `api/analyze.js:347` records: *"the non-streaming verification call was output-bound past its cap (6/6 production scans aborted at cap+2-6ms)"* — so Stage 2's true completion time has **never been observed**; 18–20s is a floor.

Also cited from production, unverified independently: JWKS auth 1.8–3.1s (`:3375`) — now moot, since `SUPABASE_JWT_SECRET` is confirmed set, putting auth on the ~1ms local-HMAC path.

### C3. Derived (NOT measured) critical path

```
Stage 1   15–25s  [production comment, api/analyze.js:3482]
Stage 2   18–20s  [measured floor]
retrieval  ~2s    [derived from caps]
embedding  ~1.5s  [derived]
auth+RL    ~0–3s  [HMAC ~1ms; RL cold ~2-3s]
persist    ~2s    [derived]
──────────────────────────
typical   40–46s  DERIVED — NOT MEASURED
```

Consistent with `BUDGET_MS = 50_000` and the client's 58s abort, both of which were sized to observed reality. **If this derivation is even approximately right, the product is roughly 2× outside its P90 threshold and 2× outside "routine >35s unacceptable."** That is the central open question of this gate.

---

## D. What remains unknown without real production scan samples

Everything that matters for the release decision:

| Unknown | Threshold it blocks |
|---|---|
| Wrong-exact rate | `≤2.5%` |
| High-confidence wrong-exact count | `= 0 preferred` |
| Exact + appropriate family rate | `≥80%` |
| Useful identity rate | `≥90%` |
| Usable valuation rate | `≥80% where priceable` |
| Wrong sibling anchor count **in production** | `= 0` |
| Catastrophic pricing error count | `= 0` |
| Median / P90 total scan time | `≤20s / ≤30s` |
| Rate of scans >35s | "routine >35s unacceptable" |
| Technical completion rate | `≥95%` |
| Stuck-scanning reproducibility | `= 0` |
| Fast-path hit rate, correctness, time saved | "measure" |
| Stage 1 real latency distribution | — |
| Google Vision real fire rate | — |
| Stage 2 timeout/fallback frequency | — |

**Zero of the fourteen audit topics have production evidence.**

One threshold is partially answerable from code today: **unsafe guard bypass = 0**. The valuation guard is fail-closed by construction, covered by 95 passing tests plus a mutation harness, and `tests/fast-path.test.mjs` FP-14b proves the fast path refuses a `brand_category_sibling` anchor. That is strong evidence of *code correctness* — but a production count of 0 still requires querying `_debug.pricing.guard_action` / `guard_degraded_reason` over real scans.

---

## E. Is current instrumentation sufficient to collect the missing data?

**Mostly yes — better than expected. Three gaps.**

| Need | Sufficient? | Detail |
|---|---|---|
| Server latency, median/P90 | **YES — already collecting** | `scan_events.payload.total_ms` |
| Per-stage waterfall | **YES — from first post-merge scan** | `result._timings` |
| Stage 2 fallback/timeout frequency | **YES — already collecting** | `scan_events.payload.stage2_fallback`, `_debug.pricing.stage2_timeout` |
| Google Vision fire rate | **YES — already collecting** | `scan_events.payload.vision_used` |
| Retrieval latency, per strategy | **YES — already collecting** | `_debug.retrieval.strategy_log[].elapsed_ms` |
| Fast-path hit rate + provenance | **YES — from first post-merge scan** | `result.stage2_status`, `result.fast_path` |
| Technical completion | **YES** | `scan_events` event types incl. `persistence_failed` |
| Accuracy *proxy* (correction/confirmation) | **YES — already collecting** | `recognition_memory` counts; human-generated |
| Pricing safety in production | **YES** | `_debug.pricing.guard_*` fields |
| **User-perceived total time** | **NO** | Server clock excludes compress/upload/render |
| **Client-side failures & abandonment** | **NO** | No client telemetry sink; client logs are `DEV`-gated and stripped from Production builds |
| **True wrong-exact rate** | **NO — not an instrumentation problem** | Requires labelled ground truth; no telemetry can supply it |

### Conclusion for §E

Instrumentation is **sufficient for all PERFORMANCE and FAST PATH thresholds**, and for PRICING safety counts. It is **insufficient for the IDENTITY thresholds**, which require labelled data — and it is **insufficient for user-perceived latency**, which needs a small client-side timing beacon that does not currently exist.

**No new server instrumentation is required.** The gap is data (traffic + labels) and two small additions: a client timing beacon, and a labelled fixture corpus.

---

## F. Release thresholds — evaluation

Every row is evaluated against **evidence actually present in the repository**.

### IDENTITY

| Threshold | Verdict | Basis |
|---|---|---|
| Wrong exact ≤2.5% | **INSUFFICIENT DATA** | No labelled corpus; tier 2 never ran. Correction rate would give a lower bound only. |
| High-confidence wrong exact = 0 | **INSUFFICIENT DATA** — *structural safeguards in place* | `calibrateRecognition` clamps unearned model confidence to 0.70; `calibrateVerification` refuses self-declared floors and caps uncorroborated confidence at 0.75; `identity_resolution` reports `family` rather than a guess. All synthetic-verified, none production-verified. |
| Exact + appropriate family ≥80% | **INSUFFICIENT DATA** | Requires ground-truth family labels. |
| Useful identity ≥90% | **INSUFFICIENT DATA** | Requires per-scan human judgement. |

### PRICING

| Threshold | Verdict | Basis |
|---|---|---|
| Usable valuation ≥80% where priceable | **INSUFFICIENT DATA** — *measurable now* | `_debug.pricing.pricing_status` + `price_method='manual_required'` are persisted; needs a query over real scans. |
| Wrong sibling pricing anchor = 0 | **CODE-SAFE, PRODUCTION UNVERIFIED** | `evaluateFastPath` requires `verdict.modelMatched === true`, rejecting `brand_category_sibling`; `preQuoteFromCatalog` gates every anchor through `isCompatibleAnchor`. FP-14b proves the Nike-"S"/Air-Max-90 case is refused, and a mutation run proved that test is load-bearing. **No production count exists.** |
| Catastrophic pricing error = 0 | **INSUFFICIENT DATA** | Guard bounds the envelope and fails closed to `manual_required`; needs production distribution of `guard_degraded_reason`. |
| Unsafe guard bypass = 0 | **CODE-SAFE (strong), PRODUCTION UNVERIFIED** | `api/_lib/valuation-guard.js` + 95 tests + mutation harness; degraded quotes route to rescue then to `manual_required` with a depth-1 terminator. Strongest evidence in this audit — but still code evidence. |

### PERFORMANCE

| Threshold | Verdict | Basis |
|---|---|---|
| Median total scan ≤20s | **INSUFFICIENT DATA — likely FAIL** | Derived typical 40–46s. Stage 1 (15–25s) + Stage 2 (18–20s) alone exceed 20s. Not measured. |
| P90 ≤30s | **INSUFFICIENT DATA — likely FAIL** | Same derivation. |
| Routine >35s unacceptable | **INSUFFICIENT DATA — at risk** | `BUDGET_MS=50s` and a 58s client abort were sized to observed reality, which implies routine scans approach those bounds. |
| Technical completion ≥95% | **INSUFFICIENT DATA — measurable now** | `scan_events` records `scan_analyzed` vs `persistence_failed`. |
| Stuck scanning = 0 reproducible | **FIXED, UNVERIFIED IN PREVIEW** | Two causes found and fixed in `76d3ec7`: no auth guard on `runPipeline`, and an `AbortError` early-return that left `pipelineState` at `'identifying'` while `clearUserState()` aborts the pipeline on every sign-in. 16 tests, 4 mutants killed. **Not yet validated on a Preview/Production build.** |

### FAST PATH

| Threshold | Verdict | Basis |
|---|---|---|
| Measure hit rate | **NOT YET MEASURED** | `stage2_status` ships from the first post-merge scan. |
| Measure correctness | **NOT YET MEASURED** | Correctness = fast-path scans whose identity is later confirmed, not corrected — joinable via `scan_uuid` → `recognition_memory`. |
| Measure time saved | **NOT YET MEASURED** | `_timings.stage2_verify` absent on fast-path scans vs present on others. |
| Never loosen gates for hit rate | **UPHELD — recorded** | FP-23 deliberately pins a known conservatism: a catalog row spelled `G-502` does not match a recognised `G502`, so the gate declines and Stage 2 runs. The documented remedy is better catalog model matching, **not** a looser gate. |

---

## G. Minimal real-world production benchmark

Three work packages. **None requires changing scan behaviour.**

### G1. Query what already exists — *hours, no code*

Run against Production (read-only):

1. `SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'total_ms')::int) AS p50, percentile_cont(0.9) … AS p90, max(…) FROM scan_events WHERE event_type='scan_analyzed';`
2. Rate of `payload->>'stage2_fallback' = 'true'` and `payload->>'vision_used' = 'true'`.
3. `scan_analyzed` count vs `persistence_failed` count → technical completion.
4. `SELECT sum(confirmation_count), sum(correction_count) FROM recognition_memory;` → correction ratio (accuracy lower bound).
5. Distribution of `ai_raw_response->'_debug'->'pricing'->>'pricing_status'` → usable-valuation rate.

**Answers immediately (if traffic exists):** median/P90 server latency, Stage 2 fallback frequency, Vision fire rate, technical completion, usable-valuation rate, correction ratio.
**If zero rows:** that is itself the finding — the product has no meaningful production usage yet, and the gate must be run on seeded traffic.

### G2. Seeded labelled corpus — *the only path to IDENTITY thresholds*

- Populate the **24 existing fixture slots** in `tests/fixtures/recognition/cases.json` (all currently `image: null`) with real photographs, including deliberate hard cases: shape-only gaming mice, sibling phones, an item genuinely absent from the catalog.
- Set `ANTHROPIC_API_KEY` (+ optionally `GOOGLE_VISION_API_KEY`, `VOYAGE_API_KEY`) and run `npm run bench:recognition`.
- Tier 2 then yields per-case brand/model/category correctness **and** per-stage latency against known ground truth.

**Minimum viable sample:** the 24 cases × 3 photo conditions (clean label / shape-only / angled) = **72 scans**. Enough to place wrong-exact rate to roughly ±5pp — sufficient to tell 2% from 20%, which is the decision that matters.

### G3. Client timing beacon — *the one genuine instrumentation gap*

Add compress-ms, upload-ms and total-perceived-ms to an existing telemetry path (`src/lib/telemetry.js` / `observations.js` already exist). Without it, "median total scan ≤20s" remains unanswerable because the server clock excludes client work.

**Note:** classified as a finding, not implemented — this audit is read-only.

### Suggested gate run order

```
G1 (query existing production data)     → hours
      ↓ tells you whether traffic exists at all
G2 (labelled corpus + tier 2)           → 1–2 days
      ↓ the only route to IDENTITY thresholds
G3 (client beacon) + re-run G1          → after next deploy
      ↓ closes user-perceived latency
RE-EVALUATE THIS GATE
```

---

## 8. Final verdict

# INSUFFICIENT REAL-WORLD DATA

**Why not PASS:** not a single one of the fourteen audited topics has production evidence. Every accuracy figure is synthetic; the only production latency figure is a lower bound from a commit message.

**Why not FAIL:** a FAIL would assert measured underperformance. Nothing has been measured. The code-level safety evidence is genuinely strong — fail-closed valuation guard with 95 tests and a mutation harness, an evidence-gated fast path with 30 tests and 5 killed mutants, confidence calibration that structurally cannot be inflated by self-declaration, and sibling protection proven load-bearing by mutation testing. Declaring FAIL would misrepresent that.

**Why not CONDITIONAL:** CONDITIONAL implies known metrics sitting near a threshold with a defined remediation. There are no metrics.

**The honest state:** this is a scan pipeline with strong correctness safeguards, comprehensive telemetry already deployed and collecting, and **no one has ever looked at the numbers.**

### The one finding that should change the plan

The repository already contains a purpose-built production telemetry table (`scan_events`, described in its own migration as powering an *"Internal Intelligence Dashboard"*), an always-attached `_debug` payload persisted with every valuation, and a human confirmation/correction loop feeding `recognition_memory`. **A substantial part of this gate is a SQL query away, not an engineering project.**

Before commissioning any new measurement work, run **G1**. It is hours of effort and will either produce most of the PERFORMANCE and PRICING numbers immediately, or reveal that Production has no meaningful scan traffic — which is itself the answer.

### Standing constraint

The derived 40–46s typical scan time is **the largest single risk to the value proposition** and sits roughly 2× outside the stated P90 threshold. It must be measured, not assumed — and if confirmed, addressed by reducing Stage 1 output and raising fast-path eligibility through **better catalog model matching**, never by loosening the evidence gates that make the pipeline trustworthy.

---

*End of GW-RELEASE-002.*
