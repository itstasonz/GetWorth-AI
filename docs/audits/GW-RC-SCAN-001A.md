# GW-RC-SCAN-001A — Correction to GW-RC-SCAN-001

**Type:** Read-only correction / root-cause confirmation
**Date:** 2026-09-06
**Repository state:** branch `main`, HEAD `fce24f9`
**Supersedes:** §4, §6, §7, §8, §10 and the closing summary of `GW-RC-SCAN-001.md`

> **No code, migration, or deployment was changed.**

---

## 0. What was wrong, and why

GW-RC-SCAN-001 asserted:

> *"`_timings` is already persisted on these exact scans… **Every one of these five scans therefore already contains a full per-stage waterfall that has simply not been read.**"*

**That was false, and Production disproved it:** `timings_anywhere = 0` across all five current-engine scans.

The error was a reasoning shortcut. I verified that `_timings` is *assigned to `result`* and that `ai_raw_response: result` is *persisted*, then concluded the two must meet. I never checked the **order** of those two operations. They do not meet — the assignment happens 244 lines after the write.

This matters beyond the single claim: it is exactly the failure mode this audit series has repeatedly flagged in the product ("a component existing is not proof the action completes"), and I committed it in the audit itself. **Runtime instrumentation and persisted telemetry are different things**, and I conflated them.

The defect being corrected is also mine, introduced in commit `6282b68`.

---

## A. Corrected timing conclusion

### A1. Where the runtime timing object is created

`api/analyze.js`, inside `handleRequest`, immediately after the budget clock:

```js
const timings = { _order: [] };
const mark  = (name, ms) => { … };
const timed = async (name, p) => { const t = Date.now(); try { return await p; } finally { mark(name, Date.now() - t); } };
```

A closure-scoped plain object. Not persisted anywhere by itself.

### A2. Exact property path

`result._timings` — a flattened copy (`_order` stripped) attached to the response object.

### A3. Where it is attached

**Line 4481**, inside the `[Waterfall]` block, immediately before `return json(...)`:

```js
const { _order, ...flat } = timings;
result._timings = flat;
```

### A4. Before or after persistence — **AFTER**

| Operation | Line |
|---|---|
| `result.stage2_status = stage2Status` | 3929 |
| `result.fast_path = { … }` | 3931 |
| `result._debug = { … }` | 4073 |
| `const valuationRow = { … ai_raw_response: result … }` | 4194 / 4204 |
| **`await timed('persist_scan', …)`** | **4237** |
| **`result._timings = flat`** | **4481** |
| `return json({ content: … })` | 4484 |

`_timings` is assigned **244 lines and one network round-trip after** the row is written.

### A5. Is it stripped by `normalizeForUI` or another transform?

**No.** `normalizeForUI` runs earlier and constructs `result`; nothing removes `_timings`. There is no stripping step. This is purely an ordering defect.

### A6. Is the persisted object an earlier snapshot?

**Effectively yes.** `ai_raw_response: result` stores a *reference*, but `supabase.rpc('record_scan', { p_valuation: valuationRow })` **serialises the object to JSON at call time** (line 4237). Serialisation is the snapshot. Any property added to `result` after that call — `_timings` among them — cannot appear in the stored JSON.

This also explains, without contradiction, why `stage2_status`, `fast_path` and `_debug` **are** present in Production: all three are assigned before line 4237.

### A7. Could Production differ from HEAD?

**It does not need to.** The absence is fully explained by HEAD's own ordering, so no deployment-drift hypothesis is required. Note separately that HEAD was merged and pushed only immediately before this analysis, so the five scans ran on a build containing `6282b68`+`ece8411` — consistent with `fast_path` being present and `_timings` absent. **The two observations together confirm the ordering explanation rather than a stale deploy.**

### A8. Minimum change required to persist stage timings safely

**Snapshot the timings into `valuationRow` before the write, and keep the complete object on the response.**

```
// Conceptual — NOT implemented in this audit.
// Immediately BEFORE `const valuationRow = {...}` (line 4194):
//   const { _order, ...timingsSoFar } = timings;
// then include `timings: timingsSoFar` (or fold into ai_raw_response)
// The existing line 4481 assignment stays, so the RESPONSE keeps the
// complete object including persist_* and total.
```

Properties of this change:

- **Uses the existing helper.** No second telemetry architecture.
- **Zero added latency** — an object spread.
- **No behaviour change** — `timings` is write-only; nothing reads it to make a decision.
- **Captures every stage that matters for latency root cause**: `body_parse`, `auth`, `rate_limit`, `stage1_vision`, `google_vision`, `embed_corrections`, `retrieval`, `stage2_verify`, `pricing_rescue`. **Stage 1 and Stage 2 — the two dominant costs — are both complete by line 4194.**
- **Known limitation, stated deliberately:** `persist_scan`, `persist_derived`, `total` and `unaccounted` are measured *after* the snapshot and will be absent from the persisted copy. They remain in the response and the `[Waterfall]` log. Persisting them would require a second write, which is not worth the cost. `scan_events.payload.total_ms` already provides the end-to-end figure independently.

**Do not claim the database contains stage timings.** It does not, and it will not until this change ships and new scans occur.

---

## B. Fast path for scans 4/5 — now CONFIRMED

### B1. The two anchor requirements, re-verified at HEAD

**Guard anchor** (`api/analyze.js`, `guardAnchor`):
```js
candidates.find(c => isCompatibleAnchor(c, id, recognition)?.ok === true) || null
```
Requires `.ok` only. **No** price check, **no** `modelMatched` check.

**Fast-path anchor** (`api/analyze.js`, `evaluateFastPath`):
```js
for (const c of candidates) {
  if (!(c.avg_used_price_ils > 0)) continue;
  const verdict = isCompatibleAnchor(c, identity, recognition);
  if (verdict.ok && verdict.modelMatched === true) anchors.push(c);
}
if (!anchors.length) return reject('no_compatible_priced_anchor');
```
Requires `avg_used_price_ils > 0` **AND** `.ok` **AND** `modelMatched === true`.

Both call `assessFallbackIdentity(recognition)` on the same `recognition`, so the identity argument is identical. **The fast-path anchor set is a strict subset of the guard anchor set.**

### B2. The proof

`derivePricingSource` (`valuation-guard.js:315-320`):
```js
if (ctx.stage === 'stage2') {
  return anchored ? {source:'stage2_comp_anchored', grade:'HIGH'}
                  : {source:'stage2_ai',            grade:'MEDIUM'};
}
```
where `anchored = !!ctx.anchor` and `ctx.anchor` is `guardAnchor`.

Therefore:

```
guard_pricing_source === 'stage2_ai'
  ⇒ guardAnchor === null
  ⇒ NO candidate satisfied isCompatibleAnchor().ok
  ⇒ the fast-path anchor set (a strict subset) is necessarily empty
  ⇒ evaluateFastPath returns reject('no_compatible_priced_anchor')
```

Scans **3, 4 and 5** all report `guard_pricing_source = stage2_ai`.

> ### CONFIRMED: NO_COMPATIBLE_PRICED_ANCHOR
>
> Scans 3, 4 and 5 failed the fast path at condition 10. This is a **logical necessity** from the recorded field, not an inference.

**Two precision notes.**

1. This proves condition 10 **necessarily** failed. It does **not** prove condition 10 was the *first* failure — conditions 2/3/4 (identity level, ambiguity) may also have failed and are still unobservable. For scans 4/5 the outcome is unaffected: the gate could not have passed regardless.
2. Scans **1 and 2** report `stage2_comp_anchored` with `guard_envelope_key = anchor:<uuid>`, so a compatible `.ok` anchor **did** exist for them. Their fast-path rejection therefore occurred on a *different* condition — `modelMatched === false`, `avg_used_price_ils <= 0`, or an earlier identity/ambiguity condition. **Scans 1 and 2 remain NOT OBSERVABLE.**

### B3. Corrected root-cause distribution (N=5)

| Scan | `guard_pricing_source` | Fast-path cause |
|---|---|---|
| 1 | `stage2_comp_anchored` | NOT OBSERVABLE (anchor existed; failed a stricter or earlier condition) |
| 2 | `stage2_comp_anchored` | NOT OBSERVABLE — note `db_match_found = false`, so condition 6 also failed |
| 3 | `stage2_ai` | **CONFIRMED** `no_compatible_priced_anchor` |
| 4 | `stage2_ai` | **CONFIRMED** `no_compatible_priced_anchor` |
| 5 | `stage2_ai` | **CONFIRMED** `no_compatible_priced_anchor` |

**3/5 confirmed, 2/5 still require `fast_path_rejection_reasons`.**

**The gate is not loosened, and no change to it is proposed.** The cause is upstream: no catalog row was compatible enough to anchor a price.

---

## C. Envelope key investigation

### C1–C2. What feeds the selector

`api/analyze.js` builds `gctx` with `recognition` and **does not** pass `envelope_key`. `resolveEnvelope` therefore falls through to `resolveEnvelopeKey(ctx.recognition)`, which reads:

```js
const cat  = (recognition.category || '').toLowerCase();      // ← STAGE 1 category
const sub  = (recognition.subcategory || '').toLowerCase();
const pt   = (recognition.product_type || '').toLowerCase();  // always undefined — see note
const mdl  = recognition.model_candidates?.[0]?.model;
const brnd = recognition.brand_candidates?.[0]?.brand;
const ocr  = recognition.ocr_text?.raw_texts.join(' ');
```

**The envelope is selected from Stage 1's category — never Stage 2's `final_category`.**

This is a real inconsistency: `result.category` is `verification.final_category || recognition.category`, so if Stage 2 corrected the category, **the user sees the corrected one while the guard used the uncorrected one.**

Note also `recognition.product_type` is read but **never populated** — GW-RELEASE-001 confirmed `product_type` is hardcoded `null` in the candidate payload and Stage 1 emits no such field. That matcher input is dead.

### C3. How `home` and `beauty` were produced

Every electronics matcher is gated behind `el = cat.includes('electron')`:

```js
['electronics:headphones', () => el && (… || /wh-|qc\d|airpods|earbuds/.test(sig))],
```

The `airpods` pattern **exists and would have matched** — but `el` was false, so it never ran. Execution fell through to:

```js
['home',   () => cat.includes('home') || cat.includes('household')],
['beauty', () => cat.includes('beauty') || cat.includes('cosmetic')],
```

**Therefore Stage 1 assigned `category = "Home"` to the AirPods Pro and `category = "Beauty"` to the Magic Mouse.** The envelope keys are faithful outputs of a correct selector fed a wrong category.

### C4. Can electronics legitimately receive these keys?

**No.** Neither is reachable for a correctly-categorised electronics item — `el` short-circuits every electronics matcher first, and `electronics` (bare) is the catch-all before any non-electronics bucket.

### C5. Does the envelope affect acceptance?

**Yes.** `floor`, `soft_max` and `hard_max` gate `validateQuote`:

```js
if (mid < env.floor)    return degrade('V-ENVELOPE-HARD', …);
if (mid > env.hard_max) return degrade('V-ENVELOPE-HARD', …);
```

Out-of-range **degrades** — never clamps.

### C6–C7. Were these two observations unsafe? — **No**

Computed from `ENVELOPES` at HEAD:

| Item | Envelope used | floor | soft_max | hard_max | Correct envelope | floor | soft_max | hard_max | Direction |
|---|---|---|---|---|---|---|---|---|---|
| AirPods Pro | `home` | 12 | 1 500 | **4 800** | `electronics:headphones` | 20 | 1 500 | **4 800** | **Ceiling identical**; floor 8 ILS lower |
| Magic Mouse | `beauty` | 4 | 500 | **1 600** | `electronics:gaming mouse` | 20 | 1 000 | **3 200** | **Stricter** — half the ceiling |

**Neither observed case weakened VAL-001.**

- AirPods: the wrong envelope was **numerically identical at both ceilings**. The only difference is an 8-ILS-lower floor — a price between ₪12 and ₪19 would be accepted instead of degraded. Immaterial.
- Magic Mouse: `beauty` is **markedly stricter**. Any price above ₪1 600 would have been **degraded**. The error ran in the **fail-safe direction** — a false rejection, not an unsafe acceptance.

### C7 verdict — mapping bug?

**The envelope selector is not buggy. Stage 1's category assignment is wrong, and the selector is structurally fragile to that.**

Two distinct findings:

1. **Stage 1 category errors** — AirPods → Home, Magic Mouse → Beauty. Two errors in five scans on unambiguous, iconic Apple products, both with readable text. That is a **recognition-quality** finding of its own, independent of pricing.
2. **Structural fragility, latent** — strong product-level signals (`airpods`, `g502`, `macbook`) are gated behind a category the model can get wrong. When it does, they are discarded. **In these two cases the fallback happened to be equal or stricter. It is not guaranteed to be.**

**The genuinely permissive path** is `resolveEnvelopeKey` returning `null` (no matcher hit) → `GLOBAL_ENVELOPE` with **hard_max 500 000**. A miscategorised item landing in an unmatched bucket gets a 500 000 ILS ceiling. **Not observed in these five scans**, and not measurable retrospectively beyond `guard_envelope_key = 'global'`, which is already persisted and countable.

---

## D. Corrected pricing interpretation

**GW-RC-SCAN-001 said "0/5 catalog-backed pricing." That was too broad and is withdrawn.**

### Corrected distribution

| Field | Value |
|---|---|
| `guard_pricing_source = stage2_comp_anchored` | **2 / 5** (scans 1, 2) |
| `guard_pricing_source = stage2_ai` | **3 / 5** (scans 3, 4, 5) |
| `pricing_status = ai_estimate` | 5 / 5 |
| `guard_action = accept` | 5 / 5 |

### The two fields answer different questions

| Field | Question | Authored by |
|---|---|---|
| `pricing_status` / `price_method` | **How was the number generated?** | Stage 2 — the model's own claim |
| `guard_pricing_source` | **What did the guard validate it against?** | The guard — derived from `guardAnchor`, never from the model |

`stage2_comp_anchored` means the AI-generated estimate was **constrained and validated against a compatible catalog anchor** — via `resolveEnvelope`'s anchor branch, which replaces the category envelope with a retail-relative one: `floor 0.08×`, `soft 1.00×`, `hard 1.25×` of the anchor's `retail_price_ils`. That is a materially tighter constraint than any category bucket, and `guard_envelope_key = anchor:<uuid>` on scans 1 and 2 confirms it was applied.

### Is this the intended semantic?

**Yes — and it is a deliberately good design.** The guard's own comment states it plainly:

> *"`anchor` present ⇒ the caller found a compatible catalog row; that — not the model's self-declared `comp_based` — is what earns the HIGH grade."*

Provenance is **derived from evidence the guard verified**, never from the model's self-report. This is the same principle enforced in `calibrateVerification` (self-declaration cannot raise confidence), applied to pricing.

**So the corrected statement is:** *2/5 AI estimates were anchor-constrained against a compatible catalog row; 3/5 were validated only against a category envelope.* Not "0/5 catalog-backed."

---

## E. Priced-catalog coverage — measurement design

### Why scans 4/5 had exact retrieval evidence but no compatible anchor

The two tests are independent and gate on different columns:

| | Retrieval / identity | Pricing anchor |
|---|---|---|
| Test | `_evidence_class >= MODEL_TEXT` | `avg_used_price_ils > 0` **+** `isCompatibleAnchor().ok` **+** (fast path) `modelMatched` |
| Columns | `model`, `name`, `keywords`, `aliases`, `model_numbers` | `avg_used_price_ils`, `retail_price_ils`, `price_low_ils`, `price_high_ils`, `brand`, `category`, `subcategory` |

`isCompatibleAnchor` rejects on any of: **R0** model overlap missing when the model is confident and usable; **R1** brand-head mismatch; **R2** category inequality (**fail-closed** — both must be non-empty and equal); **R3** subcategory word-overlap failure.

**R2 is the strongest suspect given §C.** If Stage 1 said `Home` for the AirPods while the catalog row says `Electronics`, `isCompatibleAnchor` returns `category_mismatch` and **no anchor is possible — regardless of price data.** That would make §C and §B the *same root cause*: a Stage-1 category error simultaneously mis-selects the envelope and blocks every anchor.

This is a **strong hypothesis, not proven** — the rejection reason is logged (`[PRE] anchor rejected … : ${verdict.reason}`) but never persisted.

### Aggregate SQL (run manually in Production; aggregate-only, no product names)

```sql
-- 1–3. Overall priced-anchor coverage
SELECT
  count(*)                                                        AS total_products,
  count(*) FILTER (WHERE avg_used_price_ils > 0)                  AS with_used_price,
  count(*) FILTER (WHERE retail_price_ils  > 0)                   AS with_retail_price,
  count(*) FILTER (WHERE avg_used_price_ils > 0
                     AND category IS NOT NULL AND category <> '') AS anchor_eligible,
  round(100.0 * count(*) FILTER (WHERE avg_used_price_ils > 0)
        / NULLIF(count(*),0), 1)                                  AS pct_with_used_price
FROM products;

-- 4. By category
SELECT category,
       count(*) AS n,
       count(*) FILTER (WHERE avg_used_price_ils > 0) AS priced,
       round(100.0 * count(*) FILTER (WHERE avg_used_price_ils > 0)
             / NULLIF(count(*),0), 1) AS pct_priced
FROM products GROUP BY category ORDER BY n DESC;

-- 5. Fields isCompatibleAnchor depends on
SELECT
  count(*) FILTER (WHERE category   IS NULL OR category   = '') AS missing_category,
  count(*) FILTER (WHERE subcategory IS NULL OR subcategory = '') AS missing_subcategory,
  count(*) FILTER (WHERE brand      IS NULL OR brand      = '') AS missing_brand,
  count(*) FILTER (WHERE model      IS NULL OR model      = '') AS missing_model
FROM products;

-- 6. Envelope fallback frequency — is the 500k global bucket being hit?
SELECT ai_raw_response->'_debug'->'pricing'->>'guard_envelope_key' AS envelope_key,
       count(*)
FROM valuations GROUP BY 1 ORDER BY 2 DESC;
```

Query 6 uses data **already persisted** and directly measures the one genuinely permissive path identified in §C.

**No Production rows were inspected for this audit.**

---

## F. Updated severity

### GW-RC-PERF-001 — latency · **P1 (unchanged)**

No new evidence. Median 31.6s, 5/5 > 20s, all completing successfully. §A removes the claimed means of diagnosing it, which **raises the priority of the telemetry fix** but does not change the severity of the latency itself.

### GW-RC-FASTPATH-001 — **reclassified: catalog/pricing coverage, not fast-path logic** · **P2**

Per instruction, zero activation is not treated as a defect. The evidence now shows the gate **behaved correctly**:

- 3/5 provably blocked by absence of any compatible anchor (§B) — correct.
- 1/5 (scan 2) had `db_match_found = false` — correctly ineligible.
- 1/5 (scan 1) unresolved.

**No fast-path logic defect is evidenced.** The issue is upstream: catalog rows that identify a product but cannot anchor its price. **Ticket reassigned to GW-RC-PRICING-COVERAGE-001.** The residual fast-path item is **observability only** (persist rejection reasons).

### GW-RC-PRICING-COVERAGE-001 — *new* · **P2**

Insufficient compatible priced-anchor coverage. Evidence: 3/5 scans found **no** `.ok` anchor despite 4/5 having exact retrieval evidence. Root cause is one of — unpriced catalog rows, or category/subcategory incompatibility (§E, R2 suspected). Not yet distinguished.

**Impact:** suppresses fast-path activation **and** degrades pricing provenance from anchor-constrained to category-envelope. It is the shared root cause behind two of the three original tickets, and it is likely a **data** problem, not a code one.

### GW-RC-VAL-GUARD-001 — envelope mapping · **P2, downgraded from suspected P0/P1**

**The two observed cases did not weaken VAL-001** — one envelope was numerically identical at both ceilings, the other was strictly tighter (§C6). No unsafe acceptance occurred or could have occurred in these five scans.

Remains P2 because:
- The selector reads **Stage 1's** category while the user is shown Stage 2's — a real inconsistency.
- Strong product signals (`airpods`) are discarded when the category gate fails.
- The unmatched fallback grants a **500 000 ILS** ceiling, and nothing currently measures how often it is used (query 6 in §E fixes that).

**Would escalate to P1** if query 6 shows meaningful `global` envelope usage.

### GW-RC-RECOGNITION-CATEGORY-001 — *new* · **P2**

Distinct from all of the above, and arguably the most interesting finding: **Stage 1 categorised AirPods Pro as `Home` and a Magic Mouse as `Beauty`** — two errors in five scans, on iconic products, with readable text present. Category feeds the envelope selector, `isCompatibleAnchor`'s fail-closed R2 test, retrieval strategies 5 and 8, and the memory key. **A category error has unusually wide blast radius.** N=5 is far too small to estimate a rate; this is flagged for the labelled corpus, which should now over-represent category-ambiguous accessories.

---

## G. Minimum implementation package

Ordered; each step's value depends on the one before.

### Step 1 — Persist stage timings · **XS** · *unblocks all latency work*

Snapshot `timings` into the row **before** line 4194 (§A8). Uses the existing helper, adds an object spread, changes no behaviour. **Without this, latency root cause remains unmeasurable** — which §A proved is the current state.

### Step 2 — Persist `fast_path_rejection_reasons` · **XS**

Record the reason string `evaluateFastPath` already returns. Split `no_compatible_priced_anchor` into `anchor_none_compatible` / `anchor_model_mismatch` / `anchor_unpriced` — the distinction §B could not resolve for scans 1 and 2, and §E needs. Enum strings only; no product names, no OCR text.

### Step 3 — Persist the anchor-rejection reason · **XS**

`isCompatibleAnchor` returns `{ok, reason}` with values `no_model_overlap` / `brand_mismatch` / `category_mismatch` / `subcategory_mismatch`. Currently logged, never persisted. This single field **distinguishes "catalog has no prices" from "category mismatch blocks anchoring"** — the open question in §E, and the difference between a data-backfill project and a category-correctness fix.

### Step 4 — Measure catalog coverage · **S** · read-only

Run §E queries 1–6. Query 6 in particular quantifies the `global` envelope exposure behind GW-RC-VAL-GUARD-001.

### Step 5 — Envelope selector robustness · **S** · *only after Step 4*

If Step 4 shows material `global` usage or further category errors: allow high-confidence product signals (`airpods`, `macbook`, `g502`) to select an electronics envelope **without** requiring `cat.includes('electron')`, and consider passing Stage 2's `final_category` when it disagrees with Stage 1. **Deferred deliberately** — the observed cases were safe, and changing envelope selection without measurement risks loosening the guard.

### Explicitly not proposed

Lowering confidence gates · removing `modelMatched` · weakening sibling safety · weakening VAL-001 · changing models · raising timeout budgets · any fast-path gate change.

---

## Corrections applied to GW-RC-SCAN-001

| § | Original claim | Corrected |
|---|---|---|
| §1, §7 | "`_timings` already exists on these five scans" | **FALSE.** Assigned 244 lines after persistence; `timings_anywhere = 0` |
| §7 | "Only two additions needed (`fast_path_eval`, `valuation_guard`)" | **Understated.** The entire object is unpersisted; ordering fix comes first |
| §4 | Scans 4/5 "NOT OBSERVABLE" | **CONFIRMED** `no_compatible_priced_anchor` for scans 3/4/5 via `stage2_ai` ⇒ null guardAnchor ⇒ empty subset |
| §8, §10 | "0/5 catalog-backed pricing" | **Withdrawn.** 2/5 `stage2_comp_anchored` (anchor-constrained), 3/5 `stage2_ai` |
| §11 Step 0 | "Read `_timings` — hours, zero code" | **Impossible.** Requires Step 1 first |
| §10 | GW-RC-FASTPATH-001 as fast-path issue | **Reclassified** to catalog/pricing coverage |
| — | — | **New:** GW-RC-PRICING-COVERAGE-001, GW-RC-RECOGNITION-CATEGORY-001 |

---

```
TIMING CLAIM CORRECTED: YES

SCAN 4/5 FAST-PATH CAUSE:
CONFIRMED — no_compatible_priced_anchor. guard_pricing_source='stage2_ai'
proves guardAnchor was null, so no candidate passed isCompatibleAnchor().ok;
the fast-path anchor set is a strict subset and is therefore necessarily empty.
(Also confirmed for scan 3. Scans 1 and 2 remain NOT OBSERVABLE — an anchor
existed for them.)

AIRPODS HOME ENVELOPE: SAFE
  Root cause is a Stage-1 category error ("Home"), not a mapping bug. The
  resulting envelope is numerically IDENTICAL to electronics:headphones at both
  soft (1500) and hard (4800) ceilings; only the floor differs (12 vs 20).

MAGIC MOUSE BEAUTY ENVELOPE: SAFE
  Same root cause ("Beauty"). The beauty envelope is STRICTER than the correct
  one (hard 1600 vs 3200) — the error ran in the fail-safe direction.

  Both flagged as GW-RC-RECOGNITION-CATEGORY-001 (Stage-1 category accuracy) and
  GW-RC-VAL-GUARD-001 (latent fragility: product signals gated behind category;
  unmatched fallback grants a 500,000 ILS ceiling).

PRICING COVERAGE VERDICT:
INSUFFICIENT — 3/5 scans found no compatible anchor despite 4/5 having exact
retrieval evidence. Cause not yet distinguished between unpriced catalog rows
and category-mismatch rejection; §E query set resolves it.

RECOMMENDED FIRST IMPLEMENTATION:
Step 1 — persist the timings snapshot before line 4194 (XS, no behaviour
change). Everything latency-related is unmeasurable until it ships.

CODE CHANGED: NO
MIGRATIONS CREATED: NO
DEPLOYMENT PERFORMED: NO
```

---

*End of GW-RC-SCAN-001A.*
