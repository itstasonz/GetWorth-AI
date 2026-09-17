# GW-RC-PERF-003 — Production Scan Latency + Retrieval Root-Cause Audit

**Type:** Read-only investigation
**Date:** 2026-09-06
**Production commit:** `f507b16811319ac8f6ce00069144b05da7dc5ad0`
**Evidence:** 5 real Production scans with persisted `_timings` (`snapshot='pre_persist'`), the first per-stage data this project has ever had.

> **No code, migration, environment variable, model, timeout, prompt, gate or threshold was changed.**

**Evidence labelling used throughout:** `CODE FACT` (provable from source) · `PRODUCTION FACT` (from the five scans) · `INFERENCE` (reasoned from both) · `HYPOTHESIS` (plausible, unproven) · `NOT OBSERVABLE` (telemetry cannot answer).

**Method note.** Three specialist workstreams (Stage 1 latency, Stage 2 responsibility, Fast Path / anchors) ran in parallel against this codebase. Their findings **corroborated the lead analysis with no contradictions** and contributed three refinements now folded in: the corrected `timed()` measurement boundary (§4.1), the Stage 2 dual-deadline defect (§5.4), and the gate's first-failure-only short-circuit (§9). Every conclusion below was independently verified against source by the lead before inclusion.

---

## 1. Executive verdict

Four questions were asked. Three now have proven answers, and they share a root cause that is **not** what the ticket assumed.

**The headline: Stage 1 is the binding constraint, and no amount of fast-path or retrieval work reaches the performance goal without addressing it.** If the fast path fired on **every** scan and Stage 2 dropped to 0ms deterministic pricing, the median total would still be **15,862ms** — above the 10–15s "normal scan" target — because Stage 1 alone has a median of 12,888ms. That single arithmetic fact reorders the entire optimization ranking.

**Verified: Stage 1 + Stage 2 = 89.3% of scan time.** I recomputed this independently rather than repeating the ticket's arithmetic. More usefully, the *unaccounted* residual is **10–446ms per scan** — auth, rate-limit, retrieval, Vision, guard, normalise, persistence and JSON encoding together are noise. **There is no hidden cost anywhere. It is two model calls.**

**Retrieval is genuinely broken, and the mechanism is proven.** A **3-character substring match against the `model` column, with no category or brand filter**, promoted to the *highest* evidence tier and stamped with a *fixed* 0.92 "similarity". For the Ninja scan the OCR token `duo` matched *SodaStream **Duo***, *SodaStream **Duo** White* and *Instant Pot **Duo** 6Qt* — exactly the observed candidates.

**Two debug-UI labels actively misreport correct behaviour**, and both misled this investigation before code disproved them:
- `DB MATCH — 6 found ✓` fires on those unrelated rows.
- `⛔ Stage 1 failed / timed out — used fallback` was shown for the Sofa scan. **Stage 1 did not fail, did not time out, and no fallback was used.**

**A defect I introduced.** `classifyRowEvidence` maps `_ocr_model_confirmed → EVIDENCE_CLASS.MODEL_TEXT` with the comment *"read text, not resemblance."* That is correct for Tier 1's `model_numbers` equality half and **wrong** for its `model ILIKE '%kw%'` substring half. I conflated them in `cee3f20`. It is the link that turns a 3-letter coincidence into `db_match_found = true`.

**What held.** Pricing safety was never breached: `isCompatibleAnchor` independently rejected every unrelated row, which is precisely why `guard_pricing_source = stage2_ai` on four of five scans. The garbage reached *identity telemetry* and the *Stage 2 prompt*, never a *price*.

---

## 2. Production five-scan table

| # | Item | total | stage1 | vision | retrieval | stage2 | cands | db_match | pricing_source | outcome |
|---|---|---:|---:|---:|---:|---:|---:|---|---|---|
| 1 | Ninja blender | 25,526 | **15,607** | — | 1,510 | 6,981 | 6 | true | `stage2_ai` | identified |
| 2 | Russell Hobbs kettle | 21,507 | 10,829 | 1,353 | 1,925 | 6,928 | 1 | false | `stage2_ai` | generic |
| 3 | Logitech mouse | 26,993 | 13,803 | 1,150 | 574 | 10,910 | 6 | false | `stage2_comp_anchored` | unidentified |
| 4 | Corner sofa | 29,450 | 10,422 | 1,277 | 704 | **16,578** | 5 | false | `stage2_ai` | unidentified |
| 5 | ENZUO knife | **31,059** | 12,888 | 1,510 | 862 | 15,197 | 6 | true | `stage2_ai` | unidentified |

Other measured stages (`body_parse` 0ms, `auth` 2–502ms, `rate_limit` 336–441ms, `embed_corrections` 117–144ms) are collectively **under 1.1s on every scan**.

`fast_path` persisted as `null` on all five — **CODE FACT:** `result.fast_path` is written *only* when the gate passes, so `null` means "did not fire" and carries no reason.

---

## 3. Latency budget

**N=5 is forensic evidence, not release certification.** Percentiles over five points are descriptive only; "P90" here is effectively the second-highest value and is labelled as such.

| Stage | min | median | mean | max | share of total |
|---|---:|---:|---:|---:|---:|
| stage1_vision | 10,422 | **12,888** | 12,710 | 15,607 | **47.2%** |
| stage2_verify | 6,928 | **10,910** | 11,319 | 16,578 | **42.1%** |
| retrieval | 574 | 862 | 1,115 | 1,925 | 4.1% |
| google_vision (4 invoked) | 1,150 | 1,315 | 1,323 | 1,510 | 3.9% |
| auth + rate_limit + embed | ~460 | ~600 | ~700 | ~1,100 | ~2.4% |
| **total** | 21,507 | **26,993** | 26,907 | 31,059 | 100% |

**Stage 1 + Stage 2 = 120,143 / 134,535 ms = 89.3%** — independently verified.

**Unaccounted residual per scan: 446, 15, 10, 11, 17 ms.** The guard, `normalizeForUI`, memory shadow writes, JSON encoding and the response write are **collectively negligible**. Note this residual excludes `persist_scan`/`persist_derived`, which occur after the `pre_persist` snapshot by design (GW-RC-PERF-002); `scan_events.payload.total_ms` is captured before persistence too, so both totals share that boundary.

---

## 4. Stage 1 root cause

### 4.1 What `stage1_vision` measures — CODE FACT

`timed('stage1_vision', withTimeout(recognize(imageList, lang, apiKey, stage1Cap), stage1Cap, ...))`.

**Correction to an earlier draft of this section.** `timed()` receives an **already-created promise**, and JavaScript evaluates arguments before the call. So `t = Date.now()` is sampled *after* `recognize()` has already run synchronously to its first `await`. That places more work **outside** the span than first stated:

**Outside** (evaluated during argument evaluation, before the clock starts):
- `buildRecognitionPrompt(language)` — the full template build
- the `content` array construction wrapping each base64 image
- **`JSON.stringify` of the entire request body, including every base64 image payload** — potentially ~1.2MB for 3 photos
- the synchronous `fetch()` dispatch and `AbortController` arming
- and afterwards: `calibrateRecognition`, the user-correction injection, `embeddingText` derivation

**Inside**: the request upload, Anthropic queue + inference, response download, `res.json()`, the `stop_reason === 'max_tokens'` check, and `parseJSON` (including its regex-span retry). `maxRetries = 0`, so no retry is hidden.

So `stage1_vision` is a clean proxy for **the Anthropic round trip** — it does *not* include body serialisation. Any serialisation cost falls into `unaccounted`, which is 10–446ms per scan (highest on Ninja, the only 3-image-capable scan without Vision). **That bounds base64 serialisation at well under half a second and rules it out as a latency factor.**

### 4.2 Decomposition — PRODUCTION FACT + INFERENCE

Latency ranks **perfectly monotonically** with output richness, with model, parameters and image handling identical throughout:

| stage1 | scan | output produced |
|---:|---|---|
| 15,607 | Ninja | brand 99% + full model name 97% + rich OCR (NINJA / POWER BLENDER DUO PRO / BLENDSENSE) |
| 13,803 | Logitech | brand 95% + model 45% + **2 alternatives** (G Pro Wireless 45%, G305 25%) |
| 12,888 | ENZUO | brand 88% + model hypothesis 55% + OCR |
| 10,829 | Kettle | brand 92% + generic model 45%, minimal OCR |
| 10,422 | Sofa | **no brand, no model, empty OCR** |

This decomposes Stage 1 into:

- **A floor of ~10,422ms** — reached when output is essentially empty. This is image processing + prompt ingestion + minimum generation. **Output trimming cannot touch it.**
- **A variable band of ~5,185ms** (33% of the maximum) that scales with generated output.

**INFERENCE (strong, N=5):** Stage 1 is output-token bound above a substantial fixed floor. The monotonic ordering across five independent items with identical configuration is notable, but five points cannot establish causation.

### 4.3 Input cost — CODE FACT + arithmetic

Client sends `compressImage(raw, 1280, 0.82)` (`src/contexts/AppContext.jsx:2196`), up to 3 images.

| Resolution | tokens/image (≈ w·h/750) | 3 images |
|---|---:|---:|
| **1280×960 (current)** | **1,638** | **4,914** |
| 1024×768 | 1,049 (−36%) | 3,147 |
| 800×600 | 640 (−61%) | 1,920 |

Plus the recognition prompt at 4,508 characters (~1,200 tokens). **`max_tokens: 1500`, `temperature: 0`, non-streaming, no thinking/reasoning parameter.**

### 4.4 The Sofa anomaly — RESOLVED, and the UI is wrong

**The ticket states "Stage 1 failed / timed out — used fallback". All three claims are false.**

`src/views/CameraResultsView.jsx:2373` renders that string from `s1.failed`, which `api/analyze.js` defines as:

```js
failed: !recognition.brand_candidates?.length && !recognition.ocr_text?.has_readable_text,
```

**CODE FACT:** `failed` means *"Stage 1 returned no brand candidates and no readable text."* It is not a failure flag, not a timeout flag, and there is no fallback path.

Proof that Stage 1 succeeded: the Stage-1 `catch` returns **HTTP 503 and does not continue the pipeline** (`code: 'STAGE1_TIMEOUT'`, quota refunded). The Sofa scan produced a valuation, so no throw occurred. Also `stage1Cap = max(min(28_000, rem()−12_000), 8_000)` ≈ 28s, and 10,422ms is nowhere near it.

**What actually happened:** an unbranded corner sofa with no text. Stage 1 ran for 10.4s, **succeeded**, and honestly returned `Furniture 40%, no brand, no model, no OCR` — which is exactly the uncertainty behaviour built in SCAN-015 working as designed. The debug UI then labelled correct behaviour a failure.

**This label materially misled the investigation.** Classified separately from any latency defect.

---

## 5. Stage 2 root cause

### 5.1 What `stage2_verify` measures — CODE FACT

`timed('stage2_verify', withTimeout(verifyAndPrice(...), stage2Cap, ...))` — prompt construction, the text-only Anthropic call (no images), `res.json()`, the truncation check, `parseJSON`, and the non-forensics stub injection. `calibrateVerification`, the guard and `normalizeForUI` are **outside**.

### 5.2 Input size is NOT the driver — the cleanest negative result in this audit

| scan | candidates | stage2 |
|---|---:|---:|
| Ninja | **6** | 6,981 |
| Kettle | **1** | 6,928 |

**Six times the candidate payload costs +53ms — 0.8%.** The "more candidates → bigger prompt → slower" hypothesis is effectively **DISPROVEN** for this range. Prompt/input size is not what makes Stage 2 slow.

### 5.3 Uncertainty is the driver — PRODUCTION FACT + INFERENCE

| Outcome | scans | mean stage2 |
|---|---|---:|
| Resolved identity | Ninja 6,981 · Kettle 6,928 | **6,955** |
| Ended `unidentified` | Logitech 10,910 · Sofa 16,578 · ENZUO 15,197 | **14,228** |

**Scans that could not resolve identity took 105% longer.** Combined with §5.2 (input irrelevant), the remaining explanation is **output volume**: hedged answers generate `confidence_reasoning`, alternatives and wider price bands.

This is consistent with the codebase's own prior finding — `api/analyze.js` records that the non-streaming verification call was *"output-bound past its cap (6/6 production scans aborted at cap+2-6ms)"*, which motivated the Stage 2 output slimming in `6da7e3e`.

**INFERENCE, not fact:** N=5, and the two groups differ in more than one way. But the input-size alternative is disproven, which materially narrows the field.

### 5.4 A latent defect found while tracing the timing boundary — CODE FACT

Stage 2 arms **two deadlines at the identical value**:

```js
verification = await timed('stage2_verify', withTimeout(
  verifyAndPrice(recognition, candidates, corrections, lang, apiKey, visionData, stage2Cap), // → fetchWithRetry(..., 0, attemptTimeoutMs)
  stage2Cap,                                                                                  // → withTimeout
  'Stage 2 verification'
));
```

`verifyAndPrice` passes `attemptTimeoutMs` straight through to `fetchWithRetry(..., 0, attemptTimeoutMs)` (`api/analyze.js:2257`). Because `fetchWithRetry`'s `AbortController` timer is armed **first**, it always wins the race.

**Stage 1 deliberately avoids exactly this** (`api/analyze.js:926`):

```js
const innerAttemptMs = Math.max(attemptTimeoutMs - 500, 3000);
...
throw new Error(`[Timeout] Recognition inner fetch aborted at ${innerAttemptMs}ms`);
```

**Stage 2 has no equivalent guard and no distinguishable message.** Consequence: a Stage-2 budget overrun surfaces as `Verification API 503: …` — an *upstream provider error* — rather than a timeout.

**INFERENCE:** this is very likely the mechanism behind the codebase's own recorded signature, *"6/6 production scans aborted at cap+2-6ms"* (`api/analyze.js:~344`). Those were budget overruns misattributed to Anthropic. It means historical `stage2FallbackReason` values understate timeout frequency and overstate provider errors.

**Severity: LOW for latency, MEDIUM for diagnosis.** It changes no user-visible behaviour — both paths route to the pricing rescue engine — but it has been corrupting the fallback-reason telemetry that any Stage-2 tuning would rely on. Not fixed here; recorded for the backlog.

### 5.5 The irony worth stating

The three slowest Stage 2 calls are the three that concluded **"unidentified"** — the pipeline spends the *most* time on the scans where it ultimately commits to *nothing*. Ninja, with a confident identity, was the fastest.

---

## 6. Retrieval root cause — PROVEN

### 6.1 The mechanism

`supabase/migrations/20260705000001_scan005_ocr_rpc_ranking.sql`, Tier 1 of `match_products_by_ocr`:

```sql
WHEN EXISTS (
       SELECT 1 FROM unnest(p_keywords) kw
       WHERE length(kw) >= 3 AND p.model ILIKE '%' || kw || '%'
         AND (p.brand IS NULL OR p.brand NOT ILIKE '%' || kw || '%')
     )
  OR EXISTS (
       SELECT 1 FROM unnest(p.model_numbers) mn, unnest(p_keywords) kw
       WHERE length(kw) >= 3 AND upper(mn) = upper(kw)
     )
THEN 1
```

Three properties combine badly:

1. **A 3-character substring match** on the `model` column. `length(kw) >= 3` is the only guard.
2. **No category filter and no brand filter** anywhere in the function. The final `WHERE` is only `r.match_rank IS NOT NULL`.
3. **`ORDER BY r.match_rank, p.popularity_score DESC NULLS LAST`** — within a tier, the most *popular* product wins, not the most *relevant*. This is why famous products surface.

The migration's own comment shows the intent was understood for the *other* half: *"Equality for model_numbers is deliberate: short regulatory codes must not substring-match into unrelated products."* **That protection was applied to `model_numbers` and not to the `model` column beside it.**

### 6.2 Ninja — CONFIRMED

OCR reads `NINJA / POWER BLENDER DUO PRO / BLENDSENSE`. The token `duo` is 3 characters, passes the length guard, and `p.model ILIKE '%duo%'` matches:

- SodaStream **Duo**
- SodaStream **Duo** White
- Instant Pot **Duo** 6Qt

**Exactly the three unrelated candidates observed in Production.** The token `pro` would likewise match every product with "Pro" in its model.

### 6.3 ENZUO — mechanism confirmed, specific token NOT OBSERVABLE

Dyson Supersonic HD07, Adidas Superstar EG4959 and Nintendo Super Mario Odyssey are admitted by the same unfiltered, popularity-ordered path. The exact matching token cannot be identified because **`p_keywords` is not persisted** — `_debug.retrieval` stores `strategy_log` and `top3` but not the keyword array sent to the RPC. The `super` fragment common to all three names is suggestive of a Tier-2 `p.name ILIKE` hit rather than Tier 1, but that is **HYPOTHESIS**.

### 6.4 The structural inversion

**CODE FACT:** only strategies **5** (`brand_category`, sim 0.60) and **8** (`category_fallback`, sim 0.28) constrain by category — both are low-priority *sequential* Group-B strategies gated on `results.length < 3` / `=== 0`. Strategy **2** (`ocr_rpc`, sim up to 0.92) has **no category or brand constraint and runs first, in the parallel Group A**.

**The least-constrained strategy produces the highest-scoring rows, and its output suppresses the constrained strategies from ever running.**

---

## 7. The `sim=92%` explanation

**`sim=92%` is a hardcoded constant. It is not a similarity measurement of any kind.**

`api/analyze.js`:

```js
const OCR_MATCH_SIM = {
  model_number: 0.92,  // model column or model_numbers array hit
  ocr_keyword:  0.80,
  alias:        0.78,
  keyword:      0.72,
  brand:        0.55,
};
```

**What 92% actually means:** *"the OCR RPC matched this row via Tier 1."* It is a **provenance tag**, not a probability, not a distance, not pg_trgm, not an embedding score. It carries no information about whether the row is the same product.

For each retrieval path:

| Source | `similarity` origin | Real measurement? |
|---|---|---|
| `ocr_rpc` | `OCR_MATCH_SIM[match_type]` fixed constant | **No** |
| `exact_brand_model` | fixed 0.92 | No |
| `normalized_model` / `name_col` / `model_candidates` | fixed 0.85 / 0.82 / 0.72 | No |
| `brand_category` / `ocr_brand_only` | fixed 0.60 | No |
| `fts` | fixed 0.68 | No |
| **`vector`** | `1 − (embedding <=> query)` cosine | **Yes** — the only real one |
| `category_fallback` | fixed 0.28 | No |
| `approved_candidate` | 0.65 × `confidence_weight` | No |

**Nine of ten paths emit a constant.** The UI renders all of them as a percentage, and `buildVerificationPrompt` previously presented them to Stage 2 as `Similarity: X%` — corrected in `cee3f20` to *"Rank score … (internal ranking weight, NOT a measured similarity)"*, but the debug UI still displays `sim=92%`.

**Classification: this is a semantic mislabelling defect in the UI and telemetry, separate from retrieval correctness.** Both are real; they need different fixes.

---

## 8. `db_match_found` semantics

**CODE FACT** at HEAD `f507b16`:

```js
const dbMatchFound = retrievalEvidence
  ? retrievalEvidence.exact_match === true
  : candidates.length > 0;
```

with `exactMatch: (t0?._evidence_class ?? 0) >= EVIDENCE_CLASS.MODEL_TEXT`.

### The complete chain — how 3 letters become "DB MATCH ✓"

```
OCR token "duo" (3 chars, passes length(kw) >= 3)
  → Tier 1:  p.model ILIKE '%duo%'   [no category filter, no brand filter]
  → RPC returns match_type = 'model_number'
  → _ocr_model_confirmed = (r.match_type === 'model_number')  → TRUE
  → OCR_MATCH_SIM.model_number = 0.92                          → UI "sim=92%"
  → classifyRowEvidence: _ocr_model_confirmed === true          → EVIDENCE_CLASS.MODEL_TEXT
  → rankCandidates: top._evidence_class >= MODEL_TEXT           → exact_match = TRUE
  → dbMatchFound = TRUE
  → UI: "DB MATCH — 6 found ✓"
```

### What `db_match_found = true` guarantees

| Guarantee | Answer |
|---|---|
| Correct brand? | **No** |
| Correct category? | **No** |
| Compatible model? | **No** |
| Exact model? | **No** |
| *Any* lexical evidence? | Yes — but as little as a 3-character substring of the `model` column |
| One candidate carrying an evidence class ≥ MODEL_TEXT? | **Yes — this is all it means** |

**Ninja is a direct counterexample:** `db_match_found = true` while the candidates were SodaStream and Instant Pot.

**The debug UI string `DB MATCH — 6 found ✓` is semantically misleading** — it reads as "we found this product in the catalog" when it means "≥1 row shares a 3-character fragment." (No UI change made in this ticket.)

### Correction to my own prior work

`classifyRowEvidence` carries the comment *"The RPC's model_number tier means an OCR token hit the model column or the model_numbers array — read text, not resemblance."* That reasoning holds for the `model_numbers` **equality** half and fails for the `model ILIKE` **substring** half. I introduced this in `cee3f20`. It is the specific link that promotes a coincidence to MODEL_TEXT.

**Note it did not breach pricing safety** — `isCompatibleAnchor` rejected these rows independently, which is why `guard_pricing_source = stage2_ai`.

---

## 9. Fast Path gate map

`evaluateFastPath(ctx)`, evaluated **before** `verifyAndPrice` so Stage 2's self-declared fields are structurally unreachable.

| # | Condition | Reason ID | Persisted? |
|---|---|---|---|
| 1 | `identity_resolution` present | `no_identity_resolution` | **No** |
| 2 | `level === 'exact'` or model-naming user correction | `identity_level_not_exact` | **No** |
| 3 | not `exact_model_ambiguous`, `ambiguous_between` empty | `identity_ambiguous` | **No** |
| 4 | `retrievalEvidence.ambiguous !== true` | `retrieval_ambiguous` | **No** |
| 5 | `retrievalEvidence` non-null | `no_retrieval_evidence` | **No** |
| 6 | `exact_match === true` | `retrieval_lacks_model_evidence` | **No** |
| 7 | `top_class >= MODEL_TEXT` (implied by 6) | `retrieval_top_class_too_weak` | **No** |
| 8 | `identity.brandOk && identity.modelOk` | `identity_not_brand_and_model` | **No** |
| 9 | corroboration: Stage 1 OCR **or** Vision **or** user correction | `no_independent_corroboration` | **No** |
| 10 | `avg_used_price_ils > 0` **and** `.ok` **and** `modelMatched === true` | `no_compatible_priced_anchor` | **No** |
| 11 | `preQuoteFromCatalog()` non-null | `catalog_pricing_declined` | **No** |
| 12 | `price_estimate_mid > 0` | `anchor_price_unusable` | **No** |

**Every rejection reason is computed and console-logged; none is persisted.** `result.fast_path` is written only on success.

**Two structural properties that shape the telemetry design in §17:**

1. **Short-circuit — only the FIRST failing condition is ever produced.** Each check calls `reject()` and returns immediately, so a scan failing four conditions reports one. A persisted reason is therefore a *first-blocker*, not a complete diagnosis; aggregate counts will systematically under-report later conditions. The field should be named and interpreted accordingly.
2. **Condition 7 can never fire independently.** `rankCandidates` defines `exactMatch` as `topClass >= MODEL_TEXT`, so condition 6 subsumes it. The gate has **11 effective conditions**, not 12 — harmless, but it should not appear in a reason distribution as a distinct cause.

**Anchor relationship reconfirmed at HEAD:** `guardAnchor` requires `isCompatibleAnchor().ok` only; the fast path requires `avg_used_price_ils > 0 && .ok && modelMatched === true`. **The fast-path anchor set is a strict subset of the guard anchor set.**

---

## 10. Five-scan Fast Path analysis

| Scan | Verdict | Proof |
|---|---|---|
| **1 Ninja** | **CONFIRMED** — condition 10 | `guard_pricing_source = stage2_ai` ⇒ `guardAnchor` null ⇒ **no** row passed `.ok` ⇒ the strict subset is necessarily empty. Conditions 6/7 **passed** (`db_match_found = true`). Whether 2/3 also failed is **NOT OBSERVABLE** — but irrelevant: condition 10 could not have passed |
| **2 Kettle** | **CONFIRMED** — conditions 6 **and** 10 | `db_match_found = false` ⇒ `exact_match` false ⇒ condition 6 fails. `stage2_ai` ⇒ condition 10 fails. Model 45% "generic stainless-steel kettle", exact model explicitly unconfirmed ⇒ `level` cannot be `exact` ⇒ condition 2 **STRONGLY SUPPORTED**. Correctly ineligible |
| **3 Logitech** | **CONFIRMED** — condition 6 | `db_match_found = false` ⇒ condition 6 fails. Notably `stage2_comp_anchored` ⇒ an `.ok` anchor **did** exist, so condition 10 was *not* the binding failure here. Model 45% with alternatives at 45%/25% ⇒ within `AMBIGUITY_MARGIN = 0.15` of the top ⇒ condition 3 **STRONGLY SUPPORTED**. Correctly ineligible — the gate preserved a real ambiguity |
| **4 Sofa** | **CONFIRMED** — conditions 2, 6, 8, 10 | No brand, no model ⇒ `level = 'unknown'`, `brandOk`/`modelOk` false. `db_match_found = false`. `stage2_ai`. Correctly ineligible on four independent grounds |
| **5 ENZUO** | **CONFIRMED** — condition 10 | `stage2_ai` ⇒ same proof as Ninja. Conditions 6/7 passed. Model 55% ⇒ below the 0.75 needed for `level = 'exact'` ⇒ condition 2 **STRONGLY SUPPORTED** |

### The Ninja question — why did excellent recognition still require Stage 2?

**CONFIRMED:** because **no catalog row was compatible enough to anchor a price**. Recognition was excellent (brand 99%, model 97%, OCR-confirmed); retrieval returned SodaStream and Instant Pot rows; `isCompatibleAnchor` correctly rejected all of them on brand-head and/or category grounds; with no anchor there is no deterministic price, so the fast path cannot produce a result and Stage 2 is mandatory.

**The gate behaved correctly. The failure is upstream, in retrieval.**

---

## 11. Priced-anchor analysis

Reconfirmed at HEAD: `guard_pricing_source = 'stage2_ai'` ⇒ `anchored = !!ctx.anchor` false ⇒ `guardAnchor` null ⇒ no candidate passed `isCompatibleAnchor().ok`. True for scans 1, 2, 4, 5.

**Why was there no compatible anchor?** `isCompatibleAnchor` rejects on: R0 model overlap (when the model is confident and usable), R1 brand-head containment, R2 **category equality, fail-closed**, R3 subcategory word overlap.

For Ninja and ENZUO the returned rows were from unrelated brands and categories, so **R1 and/or R2 would reject them** — `INFERENCE`, strongly supported by the observed candidate names.

**The exact rejection reason is NOT OBSERVABLE.** `preQuoteFromCatalog` logs `[PRE] anchor rejected {brand} {model}: {verdict.reason}` but the verdict is **never persisted**. Distinguishing "no usable price data" from "category mismatch" — a data-backfill problem versus a correctness problem — requires persisting `verdict.reason`. This remains the single highest-value missing field.

---

## 12. Shared root-cause analysis

**Hypothesis:** *irrelevant retrieval → no compatible priced anchor → fast path impossible → Stage 2 mandatory → +7–17s.*

### Verdict: **PARTIALLY CONFIRMED** — and the distinction matters

| Scan | Was retrieval quality the *binding* constraint? |
|---|---|
| **1 Ninja** | **YES — CONFIRMED.** Identity was excellent (99%/97%, OCR-confirmed). The *only* thing preventing the fast path was the absence of a compatible priced anchor, caused by retrieval returning unrelated rows |
| **5 ENZUO** | **PARTIALLY.** Retrieval was garbage, but model confidence was 55% — below the 0.75 required for `level = 'exact'` — so condition 2 would likely have blocked it regardless |
| **2 Kettle** | **NO.** Identity itself was generic (45%, exact model unconfirmed). The gate would refuse on identity grounds even with perfect retrieval |
| **3 Logitech** | **NO.** Genuine sibling ambiguity (45% / 45% / 25%). An `.ok` anchor existed. Refusing was *correct* |
| **4 Sofa** | **NO.** Unbranded object with no text. Correctly unidentifiable |

**So: 1 of 5 scans was blocked *solely* by retrieval quality; 1 partially; 3 would have been correctly refused anyway.**

This is an important correction to the ticket's framing. **Fixing retrieval will not make most of these scans fast** — three of five were correctly ineligible because the *item itself* was ambiguous or unbranded, which is the system working as designed.

### The Stage-1-category hypothesis

**DISPROVEN for this batch.** Prior Production cases (AirPods → `Home`, Magic Mouse → `Beauty`, GW-RC-SCAN-001A) showed category errors blocking anchors. In this batch Stage 1's categories are **correct**: Ninja → Electronics, Kettle → Home, Logitech → Electronics, Sofa → Furniture, ENZUO → Tools. Category error is a real failure mode but **is not what happened here**.

### The dominant relationship the ticket did not propose

**Fast path is not the lever that reaches the goal.** With Stage 2 at 0ms on every scan, median total = **15,862ms**, still above the 10–15s target, because Stage 1 median is 12,888ms. `CODE FACT` + arithmetic.

---

## 13. Dependency / parallelism graph

| Operation | Classification | Note |
|---|---|---|
| `body_parse` | **CAN RUN IN PARALLEL** — already does | Runs concurrently with auth (SCAN-008) |
| `auth` | MUST WAIT (gates everything) | ~2ms on the HMAC path; 502ms once (cold JWKS/pool) |
| `rate_limit` | MUST WAIT for auth | Security gate; fails closed. 336–441ms |
| `stage1_vision` | MUST WAIT for auth + rate limit | **The critical path** |
| `google_vision` | **CONDITIONALLY PARALLEL** | Its *input* is only the image (`fallbackVision(visionImage, supa)`); its *gate* reads Stage 1 confidence. Could run concurrently at the cost of firing on scans that would have skipped it. Fired 4/5 in Production, ~1.3s |
| `embed_corrections` | MUST WAIT for Stage 1 | Embeds `embedding_text` derived from Stage 1. Already an internal `Promise.all` pair. 117–144ms |
| `retrieval` | MUST WAIT for Stage 1 | Needs brand/model/OCR tokens. Group A already parallel; Group B sequential and gated |
| `fast_path_eval` | MUST WAIT for retrieval | Pure, synchronous, unmeasured |
| `stage2_verify` | MUST WAIT for retrieval + fast-path decision | **The second critical path** |
| valuation guard | MUST WAIT for Stage 2 | Inside the ~10–446ms residual |
| `persist_scan` | MUST WAIT (authoritative) | `result.persisted` ships to the client |
| `persist_derived` | **CONDITIONALLY PARALLEL** — already overlapped | Joined before response (GW-RC-PERF-002 ordering) |

**Only two safe parallelism opportunities exist, and both are small:** Google Vision concurrent with Stage 1 (**3.9%** of total), and further overlap in the persistence tail (already done; residual is ~0.4%).

**There is no large parallelism win available.** The two model calls are genuinely sequential — Stage 2 consumes Stage 1's identity and retrieval's candidates.

---

## 14. Ranked optimization candidates — **DO NOT IMPLEMENT**

Modelled against the real five-scan data. Baseline median **26,993ms**.

### 1. Constrain retrieval Tier 1 (raise min token length, add category/brand guard)

- **Latency impact: LOW** (retrieval is 4.1%) — **but it is the prerequisite for the fast path ever firing**
- **Accuracy risk: NONE** — strictly *removes* false matches. Raises precision
- **Valuation safety risk: NONE** — tightens an already-safe path
- **Size: S** (SQL function change; requires a migration — out of scope here)
- **Evidence:** §6, Ninja `duo` → SodaStream/Instant Pot CONFIRMED
- **Measurement:** candidate relevance by category-match rate; `db_match_found` rate; fast-path fire rate; anchor-rejection reasons once persisted

### 2. Persist fast-path rejection reasons + anchor-rejection verdict

- **Latency impact: NONE** (observability)
- **Accuracy/safety risk: NONE**
- **Size: XS**
- **Evidence:** §9 — all 12 reasons computed, none persisted; §11 — anchor reason logged, not persisted
- **Measurement:** aggregate reason distribution over ≥50 scans. **This is what tells us whether fixing retrieval actually unblocks the fast path**

### 3. Reduce Stage 1 output responsibility

- **Latency impact: MEDIUM** — bounded by the ~5,185ms variable band; a 30% output cut models to **−14.2%** total (median → ~22,852ms)
- **Accuracy risk: MEDIUM** — Stage 1's candidate list *is* the uncertainty mechanism from SCAN-015. Trimming alternatives would directly damage family-level identity. Only genuinely unread fields are safe
- **Valuation safety risk: LOW**
- **Size: S**
- **Evidence:** §4.2 monotonic ordering; `e9cd0cf` already removed 5 write-only fields
- **Measurement:** benchmark tier 2 before/after on wrong-exact and family-correct rates

### 4. Reduce image resolution 1280 → 1024

- **Latency impact: MEDIUM-UNKNOWN** — −36% image tokens; effect on the ~10.4s floor **unmeasured**
- **Accuracy risk: MEDIUM-HIGH** — OCR is the single strongest evidence source in this architecture. Smaller images degrade small-text reading, which feeds Stage 1 confidence, corroboration and the fast-path gate
- **Valuation safety risk: LOW-MEDIUM** (indirect, via lost corroboration)
- **Size: XS to change, L to validate**
- **Evidence:** §4.3
- **Measurement:** **must** be an A/B on the labelled corpus measuring OCR token recovery, not just latency. **Not recommended without that**

### 5. Google Vision concurrent with Stage 1

- **Latency impact: LOW** — **−3.9%** (median → ~25,843ms)
- **Accuracy risk: NONE** — same data, earlier
- **Valuation safety risk: NONE**
- **Cost risk: MEDIUM** — fires on scans that would have skipped it (Ninja skipped it). Bounded by the 24h image cache, daily cap and per-IP limit
- **Size: S**
- **Evidence:** §13 — input has no Stage-1 dependency

### 6. Defer presentation-only Stage 2 output

- **Latency impact: MEDIUM** — a 30% Stage 2 output cut models to **−12.6%**
- **Accuracy risk: LOW** — `selling_tips`, `israeli_market_notes`, `market_demand`, `price_factors` do not affect identity or price
- **Valuation safety risk: NONE**
- **Size: S** — `6da7e3e` already proved the technique with forensics
- **Evidence:** §5.3

### 7. Model / provider change

- **Latency impact: HIGH-UNKNOWN** — the only lever that can move the ~10.4s Stage 1 floor
- **Accuracy risk: HIGH** — unmeasured
- **Size: M**
- **Evidence:** §4.2 — the floor is not output tokens, so no prompt work reaches it
- **Measurement:** full benchmark on the labelled corpus (accuracy, latency, JSON reliability, cost). **A faster model is not automatically the recommendation** — nothing here justifies it yet

### Combined ceiling

Stage 1 −30% **and** Stage 2 −30% **and** Vision parallel = median **~18,750ms**. **Still above the ≤20s difficult-scan bar only barely, and far above the 10–15s normal-scan goal.** The stated targets are not reachable by trimming alone.

---

## 15. Accuracy / safety risk assessment

**Nothing in §14 proposes lowering a standard.** Explicitly rejected as mechanisms: reducing confidence requirements, accepting weaker sibling matches, treating visual similarity as identity, trusting model self-confidence, weakening corroboration, widening envelopes, bypassing VAL-001, using unrelated rows as anchors, or blind timeout changes.

Two candidates carry genuine accuracy risk and must be gated on the labelled corpus: **#3** (Stage 1 output — the candidate list *is* the uncertainty mechanism) and **#4** (image resolution — OCR is the strongest evidence source). **#1 and #2 have no accuracy risk at all** and are the natural starting point.

**What this audit found that protects safety:** the guard rejected every unrelated row independently. The garbage reached identity telemetry and the Stage 2 prompt; it never reached a price. `isCompatibleAnchor`'s fail-closed category equality is what stopped it.

---

## 16. Future validation plan

**A. Existing automated tests** (must stay green): `pipeline-timings` (26), `fast-path` (30), `valuation-guard` (95), `recognition-baseline` (44), `persistence-rows` (26), `scan-auth` (16), `observation-payloads` (34) — 399 total — plus `npm run build` and the design-lint ratchet at 292/273 with **no drift**.

**B. Labelled corpus — 18 items × 3 photo conditions.** Based on *this* batch, over-represent:

| Category | Why — from this batch |
|---|---|
| Products whose model contains a common 3-letter word (`Duo`, `Pro`, `Max`, `Air`, `One`) | Directly triggers the Tier 1 defect (§6.2) |
| Sibling-dense electronics (Logitech G-series, AirPods) | Scan 3's 45%/45%/25% ambiguity |
| Unbranded / textless objects (sofa, generic kettle) | Scans 2 and 4 — the `_debug.stage1.failed` mislabel |
| Strong OCR + likely-absent-from-catalog (ENZUO knife) | Scan 5 |
| Confident identity + catalog present (the fast-path candidate) | Scan 1 — the case that *should* fast-path |

**C. Performance comparison:** median, descriptive P90, fast-path hit rate, Stage 1, Stage 2, total — before/after, same corpus.

**D. Accuracy comparison:** wrong-exact, high-confidence wrong-exact, family-level correct, DB-missing safe handling, wrong sibling anchor, guard bypass.

**Rejection rule: any latency improvement that regresses accuracy or safety is rejected regardless of the time saved.**

---

## 17. Recommended FIRST implementation — one only

### Persist fast-path rejection reasons and the anchor-compatibility verdict

**Why this and not the retrieval fix**, even though retrieval is the proven defect:

1. **It is the only zero-risk item.** No accuracy risk, no safety risk, no migration, no behaviour change.
2. **It answers the question the retrieval fix depends on.** §11 cannot currently distinguish "no usable price data" from "category mismatch" — a data-backfill project versus a correctness fix. Guessing wrong wastes the larger effort.
3. **It measures whether the retrieval fix works.** Without a persisted reason distribution, "did constraining Tier 1 raise the fast-path rate?" is unanswerable — exactly the position GW-RC-PERF-002 was created to escape.
4. **The retrieval fix needs a migration** (`match_products_by_ocr` is a SQL function), which is explicitly out of scope for the current approval.

Concretely: `result.fast_path_eligible` (boolean) and `result.fast_path_rejection_reasons` (array of the fixed enum strings in §9, with `no_compatible_priced_anchor` split into `anchor_none_compatible` / `anchor_model_mismatch` / `anchor_unpriced`), plus persisting `isCompatibleAnchor`'s `verdict.reason`. Enum strings only — no product names, no OCR text, no PII.

**Retrieval Tier 1 (candidate #1) is the substantive fix and should follow immediately**, once the telemetry can prove its effect.

---

## 18. Open questions / telemetry gaps

| Gap | Impact | Fix |
|---|---|---|
| Fast-path rejection reason not persisted | Cannot aggregate why the gate declines | §17 |
| Anchor rejection verdict not persisted | Cannot distinguish unpriced catalog from category mismatch | §17 |
| `p_keywords` (RPC query tokens) not persisted | ENZUO's matching token is NOT OBSERVABLE (§6.3) | Persist the token array (no PII — OCR fragments; needs a privacy decision) |
| Provider token usage not captured | Output-token hypothesis (§4.2, §5.3) is INFERENCE, not fact | Record `usage.output_tokens` from the Anthropic response |
| `fast_path_eval` and `valuation_guard` untimed | Both fall into `unaccounted` — currently 10–446ms, so **not urgent** | Deferred |
| Stage 2 overruns misrecorded as provider 503s | `stage2FallbackReason` telemetry understates timeouts (§5.4) | Give Stage 2 the `-500ms` inner-cap guard Stage 1 already has |
| Only the first fast-path blocker is knowable | A persisted reason under-reports later conditions (§9) | Accept and label, or evaluate all conditions before rejecting |
| Client-side time invisible | Server `total_ms` is a lower bound on user-perceived latency | Client timing beacon |
| Catalog price coverage unmeasured | Cannot size the anchor problem | §E SQL from GW-RELEASE-002A |

**The most valuable single addition is provider `usage.output_tokens`.** It would convert the central latency finding of this audit from strong inference into fact.

---

*End of GW-RC-PERF-003.*
