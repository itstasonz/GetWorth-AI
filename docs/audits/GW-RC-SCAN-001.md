# GW-RC-SCAN-001 — Production Scan Performance & Fast-Path Root Cause

**Type:** Read-only root-cause analysis
**Date:** 2026-09-06
**Repository state:** branch `main`, HEAD `fce24f9`
**Production sample:** N = 5, current-pipeline scans

> **No code, migration, or deployment was changed.**

---

## 1. Executive Summary

Five real scans is a small sample, but it is the first real evidence this project has ever had, and it is already enough to establish three things with confidence and to disprove one assumption.

**Finding 1 — The pipeline is materially faster than the pre-merge derived estimate.** GW-RELEASE-002 derived a typical scan at 40–46s from stage caps and old commit comments. Production says **21.8–36.5s, median 31.6s**. Scans 4 and 5 completed in ~21.8s. The derived estimate was pessimistic; the merged output-trimming work (`e9cd0cf`, `6da7e3e`) is a plausible contributor, though not proven by this data.

**Finding 2 — There is a strong, unexplained bimodality, and it correlates with uncertainty, not with Google Vision.**

| Scans | model_conf | candidates | vision | total_ms |
|---|---|---|---|---|
| 4, 5 | 0.95 / 0.97 | 6 | false | **21 750 / 21 890** |
| 1, 3 | 0.65 / 0.60 | 2 | false | **31 629 / 36 516** |
| 2 | 0.50 | 6 | **true** | 31 683 |

The confident scans are ~10–15s faster than the uncertain ones **with Google Vision held constant** (both groups `vision:false`). Scan 2 is slow for a different, understood reason (Vision fired). This points at Stage 1 output volume, not at an external service — see §6.

**Finding 3 — `fast_path 0/5` is not yet demonstrable as either correct or defective, but one already-persisted field cuts the hypothesis space in half.** `_debug.pricing.guard_pricing_source` is recorded on all five scans and distinguishes "no compatible anchor existed at all" from "an anchor existed but failed the fast path's stricter test." See §4.

**The assumption this data disproves:** `db_match_found = true` was read as implying fast-path eligibility. It does not — but not for the reason one might expect. Since `cee3f20`, `db_match_found` **is** `retrievalEvidence.exact_match === true`, so it satisfies gate conditions 3 and 4 outright. The gate still failed on one of the *remaining* conditions. §3 proves this from code.

**A telemetry naming defect worth correcting immediately:** `db_candidate_used` does **not** mean a catalog row was used for pricing. It is a display string derived from `dbMatchFound` (`api/analyze.js:4116`). Any analysis treating it as pricing provenance is reading the wrong field. The pricing-provenance field is `guard_pricing_source`.

---

## 2. Production Evidence

| Metric | Value |
|---|---|
| N | 5 (current pipeline — `fast_path` field present) |
| Median `total_ms` | 31 629 |
| P90 (as supplied) | 34 583 |
| Min / Max | 21 750 / 36 516 |
| Scans > 20s | **5 / 5** |
| Scans > 35s | 1 / 5 |
| Fast path | **0 / 5** |
| Full Stage 2 | 5 / 5 |
| Stage 2 timeout / fallback | 0 / 5 |
| `price_method = ai_estimate` | 5 / 5 |
| `guard_action = accept` | 5 / 5 |
| `guard_needs_review` | 0 / 5 |
| Google Vision fired | 1 / 5 |
| `db_match_found = true` | 4 / 5 |

**Sample-size discipline:** N=5 supports directional findings and correlation hypotheses. It does **not** support percentile claims. A "P90" over five points is the second-highest value; it is reported because it was supplied, but it should not be treated as a distribution estimate. No threshold below is PASSed or FAILed on N=5 alone.

---

## 3. Exact Fast-Path Gate

Implementation: `api/analyze.js` :: `evaluateFastPath(ctx)`, called at the Stage 2 dispatch **before** `verifyAndPrice`. Helpers: `assessFallbackIdentity`, `isCompatibleAnchor`, `preQuoteFromCatalog`, `EVIDENCE_CLASS`.

Conditions in exact evaluation order:

| # | Condition | Required | Evidence source | Why it exists | Failure reason ID | Tests |
|---|---|---|---|---|---|---|
| 1 | `identity_resolution` present | non-null | `recognition.identity_resolution` | Pre-SCAN-015 shapes must fail closed | `no_identity_resolution` | FP-18 |
| 2 | Identity is exact | `level === 'exact'` **or** user correction naming a model | `identity_resolution.level`; `model_candidates[0].evidence === 'user_correction'` | family/brand/unknown mean the model was not pinned — exactly when Stage 2 reasoning is worth its cost | `identity_level_not_exact` | FP-07/08/09/17 |
| 3 | Not ambiguous (identity) | `exact_model_ambiguous !== true` **and** `ambiguous_between` empty | `identity_resolution` | A sibling tie must not be resolved by list position | `identity_ambiguous` | FP-10 |
| 4 | Not ambiguous (retrieval) | `retrievalEvidence.ambiguous !== true` | `rankCandidates` | Two catalog rows we cannot separate | `retrieval_ambiguous` | FP-11 |
| 5 | Retrieval evidence present | `retrievalEvidence !== null` | caller | Retrieval timeout must fail closed | `no_retrieval_evidence` | FP-16 |
| 6 | Retrieval has model evidence | `exact_match === true` | `rankCandidates` | Excludes CATALOG_FUZZY / SEMANTIC / WEAK **and** DB-missing in one test | `retrieval_lacks_model_evidence` | FP-04/05/12 |
| 7 | Top class strong enough | `top_class >= MODEL_TEXT` | `rankCandidates` | Redundant with #6 by construction (see note) | `retrieval_top_class_too_weak` | FP-15 |
| 8 | Identity has brand **and** model | `identity.brandOk && identity.modelOk` | `assessFallbackIdentity` | Cannot anchor without both | `identity_not_brand_and_model` | — |
| 9 | Independent corroboration | Stage 1 OCR text **or** Vision text/logo **or** user correction | `identity_resolution.text_confirmed`; `visionData`; correction sentinel | Visual confidence alone never qualifies | `no_independent_corroboration` | FP-06/20/21 |
| 10 | Compatible **priced** anchor | `avg_used_price_ils > 0` **and** `isCompatibleAnchor().ok` **and** `verdict.modelMatched === true` | catalog rows | `ok:true` alone admits `brand_category_sibling` — a same-brand row whose model never matched | `no_compatible_priced_anchor` | **FP-14b** |
| 11 | Deterministic quote produced | `preQuoteFromCatalog()` non-null | same function the rescue engine uses | Its own 0.80 similarity floor still applies | `catalog_pricing_declined` | — |
| 12 | Quote has a usable price | `price_estimate_mid > 0` | quote | — | `anchor_price_unusable` | FP-13 |

**Note on #6/#7:** `rankCandidates` defines `exactMatch: (t0._evidence_class ?? 0) >= EVIDENCE_CLASS.MODEL_TEXT` (`api/analyze.js:1707`). Condition 7 is therefore implied by condition 6 and can never independently reject. Harmless, but it means the gate has 11 effective conditions, not 12.

### Proving `db_match_found = true` ≠ fast-path eligible

```js
// api/analyze.js:3895
const dbMatchFound = retrievalEvidence
  ? retrievalEvidence.exact_match === true
  : candidates.length > 0;
```

So `db_match_found = true` **is** `exact_match === true`, which **satisfies conditions 6 and 7**. It says nothing about conditions 2, 3, 4, 9, 10, 11 or 12.

**Structural guarantee worth recording:** condition 9's corroboration is evaluated *before* `verifyAndPrice` runs, so `verification` does not exist yet. Stage 2's self-declared fields (`brand_confidence`, `identification_method`, `match_confidence`) are **unreachable** from the gate — not merely ignored. FP-20 tests this behaviourally; FP-21 asserts it in source.

---

## 4. Scan 4/5 Analysis

The question: `brand_conf 0.98–0.99`, `model_conf 0.95–0.97`, readable text, 6 candidates, `db_match_found = true` — and still no fast path.

### What is proven

| Condition | Status | Proof |
|---|---|---|
| 6 — retrieval has model evidence | **PASSED** | `db_match_found = true` ⇒ `exact_match === true` by definition |
| 7 — top class ≥ MODEL_TEXT | **PASSED** | Implied by #6 |
| 5 — retrieval evidence present | **PASSED** | Non-null, or #6 could not be true |
| 9 — corroboration | **PASSED (near-certain)** | `readable_text: true` ⇒ `ocr.has_readable_text` ⇒ `text_confirmed` |
| 8 — brand and model present | **PASSED (near-certain)** | Confidences of 0.98/0.95 require named values |

### Ranked hypotheses for the actual rejection

**HIGHLY LIKELY — condition 10, `no_compatible_priced_anchor`.**
This is the only hypothesis that explains **both** observations at once: `fast_path 0/5` *and* `price_method = ai_estimate 5/5`. `preQuoteFromCatalog` requires `avg_used_price_ils > 0`; if the matched catalog rows carry no used-price data, the fast path is rejected here **and** Stage 2 has no comps to anchor on, producing `ai_estimate`. One cause, two symptoms, no coincidence required.

Two sub-variants, distinguishable by the field in §4.1:
- **10a — no anchor at all:** no candidate passes even the loose `isCompatibleAnchor().ok`.
- **10b — anchor exists but fails the stricter test:** `.ok === true` but `modelMatched === false` (a `brand_category_sibling`), or `avg_used_price_ils` is null/0.

**POSSIBLE — condition 2, `identity_level_not_exact` via ambiguity.**
`calibrateRecognition` sets `level = 'family'` when `exact_model_ambiguous`, which fires when the top two model candidates are within `AMBIGUITY_MARGIN = 0.15`. With a top model at 0.95, a runner-up above 0.80 would trigger it. Less likely at 0.95/0.97 than at 0.60/0.65, but not excluded.

**POSSIBLE — condition 11, `catalog_pricing_declined`.**
An anchor exists and is priced, but `preQuoteFromCatalog`'s 0.80 similarity floor rejects it (the floor is waived only for `_ocr_model_confirmed` rows).

**POSSIBLE — condition 4, `retrieval_ambiguous`.**
Two same-class rows within 0.08 naming different models. Plausible with 6 candidates.

**RULED OUT — conditions 5, 6, 7** (proven passed above).
**RULED OUT — condition 9** given `readable_text: true`.
**RULED OUT — Stage 2 self-declaration influencing the gate** — structurally impossible (§3).

### Verdict

> ### NOT OBSERVABLE WITH CURRENT TELEMETRY
>
> `result.fast_path` is written **only when the gate passes**. On rejection, `evaluateFastPath` returns `{eligible:false, reason, detail}` and the reason is **logged to console but never persisted**. Nothing in `_debug` records which condition failed.

**Minimum field needed:** `fast_path_rejection_reasons` (§5).

### 4.1 The one answer available from data already persisted

`_debug.pricing.guard_pricing_source` is recorded on all five scans (`api/analyze.js`, `guard_pricing_source: result.marketValue?.validation?.pricing_source`), and `derivePricingSource` (`valuation-guard.js:315-320`) resolves it as:

```js
if (ctx.stage === 'stage2') {
  return anchored ? {source:'stage2_comp_anchored', grade:'HIGH'}
                  : {source:'stage2_ai',            grade:'MEDIUM'};
}
```

where `anchored` is `guardAnchor`, computed with the **looser** test — `.ok === true` only, without `modelMatched`:

```js
// api/analyze.js
const guardAnchor = candidates.find(c => isCompatibleAnchor(c, id, recognition)?.ok === true) || null;
```

Therefore, reading that single field on the five scans discriminates:

| `guard_pricing_source` | Conclusion |
|---|---|
| `stage2_ai` | **No candidate passed even the loose compatibility test** ⇒ hypothesis **10a**. Root cause is anchor *compatibility* (brand-head, category equality, subcategory overlap, or model overlap), not missing price data |
| `stage2_comp_anchored` | **A compatible anchor existed** ⇒ hypothesis **10b**: the fast path failed specifically on `modelMatched === true`, on `avg_used_price_ils > 0`, or on the similarity floor |

```sql
SELECT ai_raw_response->'_debug'->'pricing'->>'guard_pricing_source' AS src,
       ai_raw_response->'_debug'->'pricing'->>'guard_action'         AS action,
       count(*)
FROM valuations
WHERE ai_raw_response ? 'stage2_status'
GROUP BY 1,2;
```

**This requires no code change and no new scans.** It is the single highest-value next step in this audit.

---

## 5. Fast-Path Observability Gap

**Design (not implemented — audit only).** Reuse the existing rejection reasons; do not invent a parallel vocabulary.

`evaluateFastPath` already returns a stable `reason` string per rejection. The minimum change is to persist it.

```js
// Attached beside the existing result.fast_path
result.fast_path_eligible = fastPath.eligible;            // boolean
result.fast_path_rejection_reasons = fastPath.eligible ? [] : [fastPath.reason];
```

**Reason IDs — taken from the implementation, not invented:**

`no_identity_resolution` · `identity_level_not_exact` · `identity_ambiguous` · `retrieval_ambiguous` · `no_retrieval_evidence` · `retrieval_lacks_model_evidence` · `retrieval_top_class_too_weak` · `identity_not_brand_and_model` · `no_independent_corroboration` · `no_compatible_priced_anchor` · `catalog_pricing_declined` · `anchor_price_unusable`

**Recommended refinement:** split `no_compatible_priced_anchor` into three, since it is the leading hypothesis and currently conflates distinct causes:

- `anchor_none_compatible` — nothing passed `isCompatibleAnchor().ok`
- `anchor_model_mismatch` — `.ok` but `modelMatched === false` (sibling)
- `anchor_unpriced` — compatible and model-matched but `avg_used_price_ils <= 0`

That distinction is exactly what §4's hypotheses need, and it is derivable inside the existing loop at no cost.

**Safety properties.** The array carries **only** these fixed enum strings. No product names, no OCR text, no user data, no images, no secrets, no prompt content, no model reasoning. The current `detail` payload (which can contain `ambiguous_between` model strings) must **not** be persisted — log only.

**Cost:** the gate already computes every value; this records an existing string. Negligible.

**Aggregate query it enables:**
```sql
SELECT jsonb_array_elements_text(ai_raw_response->'fast_path_rejection_reasons') AS reason, count(*)
FROM valuations WHERE ai_raw_response ? 'fast_path_rejection_reasons' GROUP BY 1 ORDER BY 2 DESC;
```

---

## 6. Synchronous Critical Path

Every operation between request acceptance and response, in order.

| # | Operation | Seq/Par | Cap | External | Instrumented | Persisted | Blocks response |
|---|---|---|---|---|---|---|---|
| 1 | Body parse | ∥ with auth | none | — | `timed('body_parse')` | **yes** (`_timings`) | yes |
| 2 | Supabase pool warm-up | ∥ fire-and-forget | none | Supabase | no | no | no |
| 3 | Auth / JWT | SEQ | 5 000 | none (HMAC ~1 ms) | `timed('auth')` | **yes** | yes |
| 4 | Content-length + image validation | SEQ | — | — | no | no | yes |
| 5 | Rate limit RPC | SEQ | 6 000 | Supabase | `timed('rate_limit')` | **yes** | yes |
| 6 | **Stage 1 recognition** | SEQ | `max(min(28 000, rem−12 000), 8 000)` | **Anthropic** | `timed('stage1_vision')` | **yes** | yes |
| 7 | Calibration + identity resolution | SEQ | — | — | no (µs) | no | yes |
| 8 | Google Vision | SEQ, gated `rem ≥ 12 000` | `min(5 000, rem−10 000)` | **Google** | `timed('google_vision')` | **yes** | yes |
| 9 | OCE scoring | SEQ | — | — | no (µs, log-only) | no | yes |
| 10 | Embedding ∥ corrections | ∥ pair, gated `rem ≥ 9 000` | 3 500 / 2 500 | **Voyage** / Supabase | `mark('embed_corrections')` | **yes** | yes |
| 11 | Retrieval | SEQ, gated `rem ≥ 6 000` | `max(1 200, min(4 500, rem−8 000))` | Supabase (4–11 queries) | `timed('retrieval')` | **yes** | yes |
| 12 | **Fast-path evaluation** | SEQ | none | — | **no** | **no** | yes |
| 13 | **Stage 2 verify + price** | SEQ | `max(8 000, min(24 000, rem−7 500))` | **Anthropic** | `timed('stage2_verify')` | **yes** | yes |
| 14 | `calibrateVerification` | SEQ | — | — | **no** | no | yes |
| 15 | Guard anchor + `validateQuote` | SEQ | — | — | **no** | no | yes |
| 16 | `normalizeForUI` | SEQ | — | — | **no** | no | yes |
| 17 | Pricing rescue (on failure) | SEQ | `min(3 500, rem−4 000)` | Anthropic (Haiku) | `timed('pricing_rescue')` | **yes** | yes |
| 18 | Memory lookup (shadow) | SEQ | gated `rem ≥ 2 500` | Supabase | **no** | no | yes |
| 19 | `record_scan` | SEQ | `max(1 500, rem−1 000)` | Supabase | `timed('persist_scan')` | **yes** | yes |
| 20 | Derived write-back | started, joined later | `max(1 000, rem−1 500)` | Supabase | `timed('persist_derived')` | **yes** | yes |
| 21 | Memory sample writes (shadow) | SEQ, ∥ with #20 | ~2 000 | Supabase | **no** | no | yes |
| 22 | Waterfall assembly + JSON encode | SEQ | — | — | `unaccounted` | **yes** | yes |

**Two external model calls dominate: #6 and #13.** Everything else is bounded by caps totalling well under 20s and, on scans 4/5, cannot account for 21.8s.

### Why scans 4/5 still take ~21.8s

With Vision skipped and no timeouts or fallbacks, the only substantial synchronous costs are Stage 1 and Stage 2. The single measured production figure for Stage 2 is **≈19.7s** (`0250e80`), and `api/analyze.js:347` records *"6/6 production scans aborted at cap+2-6ms"*, making it a **lower bound**.

If Stage 2 were still ~19.7s, Stage 1 plus everything else would have to fit in ~2s — which contradicts the code comment claiming Stage 1 *"routinely needs 15-25 s"* (`:3482`). **Both historical figures cannot be true of these scans.** At least one improved, and the merged output-trimming work is the plausible cause.

**Conclusion: HIGHLY LIKELY that Stage 1 + Stage 2 constitute ≥18s of the 21.8s, but the split is NOT OBSERVABLE from the fields supplied.**

### The bimodality hypothesis

The ~10–15s gap between the confident scans (4, 5) and the uncertain ones (1, 3) — **with Vision held constant** — is best explained by **Stage 1 output volume**:

- The Stage 1 prompt requests up to 5 model candidates *with evidence strings each*.
- An uncertain scan enumerates several candidates near the 0.50 cap; a confident scan emits essentially one.
- Stage 1 is **output-token bound** — established in this codebase by `6da7e3e` (Stage 2 output slimming) and by the comment at `:344`.
- Uncertain scans also produce fewer retrieval candidates (2 vs 6), consistent with a weaker identity, and feed a *larger* candidate/ambiguity payload into Stage 2.

**Status: HIGHLY LIKELY, NOT PROVEN.** Confirming it requires per-stage durations — which, critically, **already exist on these five scans** (§7).

---

## 7. Latency Instrumentation Gap

**The gap is smaller than assumed. `_timings` is already persisted on these exact scans.**

These five scans carry the `fast_path` field, which was introduced by `ece8411`. `_timings` was introduced one commit earlier (`6282b68`) and is attached unconditionally, then persisted via `ai_raw_response: result`. **Every one of these five scans therefore already contains a full per-stage waterfall that has simply not been read.**

Existing keys: `body_parse`, `auth`, `rate_limit`, `stage1_vision`, `google_vision`, `embed_corrections`, `retrieval`, `stage2_verify`, `pricing_rescue`, `persist_scan`, `persist_derived`, `total`, `unaccounted`.

```sql
SELECT ai_raw_response->'_timings' AS timings,
       ai_raw_response->'_debug'->'pricing'->>'guard_pricing_source' AS pricing_src
FROM valuations
WHERE ai_raw_response ? '_timings'
ORDER BY created_at DESC LIMIT 5;
```

**Running that resolves §6's hypothesis immediately, with zero code change.**

### Coverage against the requested field list

| Requested | Status |
|---|---|
| `auth_rate_limit_ms` | **Exists** — `auth` + `rate_limit` (finer than requested) |
| `stage1_ms` | **Exists** — `stage1_vision` |
| `google_vision_ms` | **Exists** |
| `embedding_ms` | **Exists** — `embed_corrections` (embedding ∥ corrections; not separable) |
| `retrieval_ms` | **Exists** |
| `stage2_ms` | **Exists** — `stage2_verify` |
| `critical_persistence_ms` | **Exists** — `persist_scan` |
| `total_ms` | **Exists** — `total` |
| `unaccounted_ms` | **Exists** |
| `fast_path_eval_ms` | **MISSING** — operation #12 uninstrumented |
| `valuation_guard_ms` | **MISSING** — operations #14–16 fold into `unaccounted` |

**Only two additions are needed**, both using the existing `timed()` helper — no second telemetry architecture:

```js
const fastPath = timedSync('fast_path_eval', () => evaluateFastPath({...}));
// and around calibrateVerification + guard + normalizeForUI:
mark('valuation_guard', Date.now() - tGuard);
```

Both are synchronous and sub-millisecond in the expected case; `unaccounted` already bounds their combined cost today. **If `unaccounted` on these five scans is small, neither addition is urgent** — which is itself answerable from the query above.

---

## 8. Pricing Provenance Analysis

### What `db_match_found` means

Since `cee3f20`: `retrievalEvidence.exact_match === true` — the **top-ranked candidate carries EXACT_MODEL or MODEL_TEXT evidence**. It is an *identity* signal. It says nothing about whether that row has a price, or whether pricing used it.

### The five questions

**1. Why can `db_match_found = true` coexist with no DB pricing?**

They are different tests on different properties:

| | Identity | Pricing anchor |
|---|---|---|
| Test | `_evidence_class >= MODEL_TEXT` | `avg_used_price_ils > 0` **and** `isCompatibleAnchor().ok` (+ `modelMatched` for the fast path) |
| Property | Was the model *identified*? | Does the row carry a *usable price* and pass compatibility? |

A row can carry decisive model evidence and have **no price data**, or fail category/subcategory/brand-head compatibility. Recognition retrieval and pricing provenance are deliberately separate — `dbRowsReturned` is even kept as a distinct variable with the comment *"Pricing may still anchor on them; identity may not."*

**2. What evidence allows `ai_estimate` to receive `guard_action = accept`?**

`validateQuote` validates the **envelope**, not the provenance: price ordering (`low ≤ mid ≤ high`), spread ratio against `SPREAD_MAX_*`, positive values, condition-basis coherence. Provenance is recorded *separately* by `derivePricingSource`, which grades an unanchored Stage 2 price `stage2_ai` / **MEDIUM**. `accept` therefore means *"this quote is internally coherent"*, **not** *"this quote is catalog-backed."*

**3. Can an unanchored AI price reach the user?**

**Yes — by design, at MEDIUM grade.** `derivePricingSource` returns `{source:'stage2_ai', grade:'MEDIUM'}` when `anchored` is false, and MEDIUM is not degraded. The guard's fail-closed behaviour targets *incoherent* prices (which degrade to `manual_required`), not *unanchored* ones.

**4. Under what conditions?**

When Stage 2 returns a price that passes envelope validation and no compatible anchor was found. The spread limit tightens with identity strength (`SPREAD_MAX_CONFIRMED = 2.5` when brand is text-confirmed vs `SPREAD_MAX_WEAK = 6.0`), so a confident identity is held to a *narrower* band — a real safeguard, but still not catalog-backed.

**5. Does this satisfy the intended pricing-safety criterion?**

**Partially — and the answer depends on which criterion.**

- *"Unsafe guard bypass = 0"* — **satisfied in code.** Nothing bypasses `validateQuote`; degraded quotes route to rescue then to a depth-1 `manual_required` terminator.
- *"Wrong sibling pricing anchor = 0"* — **satisfied where an anchor is used**, by `isCompatibleAnchor` + `modelMatched` (FP-14b, mutation-verified). Vacuously satisfied on these five scans, since no anchor was used at all.
- *"Usable valuation ≥80% where priceable"* — **5/5 produced a usable, guard-accepted valuation.** Directionally positive.
- **The gap:** there is currently **no criterion, and no telemetry, for what fraction of prices are catalog-backed versus model-estimated.** 5/5 `ai_estimate` means the AI is doing all the pricing work while a catalog exists and produced identity matches on 4/5. That is a **product-quality** finding — "DB = truth, AI = hypothesis" is being honoured for *identity* but not, in practice, for *price*.

---

## 9. Stage-2 Responsibility Analysis

What Stage 2 contributes, from `VERIFICATION_SCHEMA` and `buildVerificationPrompt`:

| Responsibility | Fields | Could be deterministic / DB-derived? | Deferrable? |
|---|---|---|---|
| **Identity verification** | `final_brand`, `final_model`, `final_category`, `identification_method`, `brand_confidence`, `match_confidence`, `confidence_reasoning` | **Only when the fast path qualifies.** Otherwise this is the ambiguity-resolution work Stage 2 exists for | **No** — blocks the result |
| **Pricing** | `price_estimate_low/mid/high`, `new_retail_price_ils`, `price_method`, `currency` | **Yes when a compatible priced anchor exists** — `preQuoteFromCatalog` is documented *"deterministic, 0 ms, rows already in memory"*. On these 5 scans no anchor was available, so AI pricing was the only option | **No** — the price is the product |
| **Market metadata** | `market_demand`, `israeli_market_notes` | Partially — could be category-derived | **Yes** |
| **Copy / explanation** | `selling_tips`, `confidence_reasoning` | No, but **not needed for first paint** | **Yes** |
| **Authenticity forensics** | `authenticity_assessment` block | No | Already conditional — `needsAuthenticityForensics` gates it (`6da7e3e`) |
| **Price factors** | `price_factors[]` | Partially | **Yes** |

**Off the critical path without weakening identity:** market metadata, selling tips, and price factors are presentational. `6da7e3e` already proved the technique by making forensics conditional. Trimming these reduces Stage 2 **output tokens**, which §6 identifies as the dominant latency driver.

**Not removable:** identity verification and pricing for non-fast-path scans. That is precisely the case where independent evidence was insufficient — removing the reasoning would trade latency for the exact failure mode this architecture was built to prevent.

---

## 10. Release Severity

### GW-RC-PERF-001 — Production scan latency · **P1**

Evidence: N=5, median 31.6s, 5/5 >20s, 1/5 >35s.

**P1, not P0.** All five scans **completed successfully** with accepted valuations — no timeouts, no fallbacks, no data loss, no security impact. This is a severe user-experience problem, not a correctness or safety failure. It does not make release *impossible*; it makes the core value proposition *poor*.

Against the stated targets: median ≤20s → currently 31.6s (**exceeded on 5/5**, even as a server-side lower bound that excludes client compress/upload/render). "Routine >35s unacceptable" → 1/5 at 36.5s.

**Not P0** would change if the sample grew and showed timeouts or abandonment. N=5 cannot establish that.

### GW-RC-FASTPATH-001 — 0/5 activation · **P2 (observability), not a defect**

Per the instruction not to call zero activation a defect on its own, the four possibilities were evaluated:

| Possibility | Assessment |
|---|---|
| Gate is correctly conservative | **Likely true in part.** Scans 1, 2, 3 had `model_conf` 0.50–0.65 — correctly ineligible. Scan 2 had `db_match_found = false`. **3/5 are explained by the gate working as designed.** |
| Eligible scans incorrectly rejected | **Unproven.** Scans 4/5 are the open question (§4) |
| Catalog/pricing evidence prevents qualification | **HIGHLY LIKELY** — consistent with 5/5 `ai_estimate` and 0 anchors used |
| Observability insufficient | **CONFIRMED** — the rejection reason is computed and logged but never persisted |

**Severity is P2 and lands on observability, not on the gate.** The correct action is to record *why* the gate declined — not to loosen it. If the cause is unpriced or incompatible catalog rows, the remedy is **catalog data quality**, which raises hit rate *and* pricing quality together.

### GW-RC-PRICING-001 — 5/5 `ai_estimate`, 0 DB-anchored · **P2**

**Not a safety failure.** All five passed the guard, none needed review, none was degraded, and no sibling anchor was adopted (none was adopted at all). The safety machinery behaved correctly.

**It is a product-quality and positioning finding.** With `db_match_found = true` on 4/5, the catalog is identifying products but not pricing them. "DB = truth, AI = hypothesis" is being honoured for identity and, in practice, inverted for price. P2 because the output is safe and coherent — but it undercuts the trust argument for having a catalog at all.

---

## 11. Proposed Minimal Work Package

Strictly ordered: measure first, then fix what the measurement proves.

### Step 0 — Read what already exists · zero code · **hours**

1. `_timings` on the five scans → resolves §6's Stage 1 vs Stage 2 split.
2. `guard_pricing_source` on the five scans → resolves §4 hypothesis 10a vs 10b.
3. `unaccounted` → decides whether §7's two additions are needed at all.

**No further work should be commissioned before Step 0 runs.** It is likely to change the priority of everything below.

### Step 1 — Fast-path rejection telemetry · **XS**

Persist `fast_path_eligible` + `fast_path_rejection_reasons` (§5), with `no_compatible_priced_anchor` split three ways. Enum strings only. Uses values the gate already computes.

### Step 2 — Two missing timers · **XS** — *only if Step 0 shows `unaccounted` is material*

`fast_path_eval` and `valuation_guard`, via the existing `timed()`/`mark()` helpers.

### Step 3 — Catalog pricing-coverage diagnostic · **S** — read-only

Extend `scripts/check-products-db.js` to report what fraction of `products` rows have `avg_used_price_ils > 0`, overall and for the categories seen in production. If coverage is low, that is the shared root cause of both GW-RC-FASTPATH-001 and GW-RC-PRICING-001, and it is a **data** fix, not a code fix.

### Step 4 — Stage 2 output slimming · **S** — *contingent on Step 0*

If Step 0 confirms Stage 2 dominates, remove `selling_tips`, `israeli_market_notes`, `market_demand` and `price_factors` from the requested schema, exactly as `6da7e3e` did for forensics. Touches output volume only — no identity, pricing, ranking or gate logic.

### Explicitly NOT proposed

Model changes, timeout changes, gate loosening, threshold lowering, architectural redesign. None is justified by current evidence, and §6's dominant cost is not yet split between the two model calls.

---

## 12. Tests Required

Before any implementation is approved:

```
npm test                     # full suite, currently 392 pass / 0 fail / 1 skipped
node scripts/recognition-benchmark.mjs    # tier 1: 31.0% / 97.8%; tier 1b: 23/23
node --test tests/fast-path.test.mjs      # 30 tests
node --test tests/valuation-guard.test.mjs # 95 tests
npm run build
node scripts/design-lint.mjs              # raw-hex must stay 292/273 — no drift
```

Invariants that must survive unchanged:

- evidence-class ranking (`rankCandidates`, class-first sort)
- sibling protection (FP-14b, `modelMatched === true`)
- uncertainty behaviour (`identity_resolution`, silhouette clamp)
- user-correction priority
- fast-path independent corroboration (FP-20/21 — self-declaration unreachable)
- VAL-001 fail-closed (`manual_required` terminator)
- Recognition Memory shadow-only

Any change to `evaluateFastPath` must be re-verified against the five existing mutants; any change to telemetry must satisfy the "no PII, enum strings only" constraint in §5.

---

## 13. Explicit Non-Goals

Not pursued in this audit, and not to be pursued as a consequence of it:

- Loosening any fast-path gate condition to raise the hit rate
- Lowering confidence thresholds
- Removing or weakening independent corroboration
- Admitting visual similarity as corroboration
- Weakening sibling protection or evidence-class ranking
- Bypassing or relaxing VAL-001
- Changing models
- Changing timeout budgets or `BUDGET_MS`
- Redesigning the scan architecture
- Activating Recognition Memory beyond shadow
- Any UI change

**Governing principle, restated:** speed must come from removing unnecessary work, not from accepting weaker identity evidence. Every proposal in §11 removes work or adds measurement; none trades evidence for latency.

---

*End of GW-RC-SCAN-001.*
