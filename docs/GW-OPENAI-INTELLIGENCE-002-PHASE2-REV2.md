# GW-OPENAI-INTELLIGENCE-002 — Phase 2 REV-2

Branch: `feat/gw-openai-intelligence-002`. **Design only — no code, no
migration, no live OpenAI call, no API key requested.**

Supersedes `e05b3df` (rev-1), which five independent reviews rejected. This
revision records what was wrong and why, because three of the rev-1 errors
were *assertions that were checkable and false*, and the corrections are the
most valuable content here.

> **Projections, not results.** Every latency figure is a budget, not a
> measurement. No claim is made that OpenAI is faster, more accurate, or
> prices better. Those require the physical benchmark.

---

## 0. What rev-1 got wrong

| rev-1 claim | Reality | Found by |
|---|---|---|
| Stage 2's contract is `VERIFICATION_SCHEMA` | **Dead code** — never enforced; `verifyAndPrice` does a bare `parseJSON`. The real contract is the prompt's JSON block, which contains `authenticity_assessment`, a field the schema lacks. | architecture |
| `authenticity_assessment` degrades safely via `\|\| {}` | **Degrades to blind.** RULE 9's four confidence caps become unreachable; `replicaTier` pins at `'unknown'`; the 0.07/0.15/0.28 replica multipliers never fire. A suspected-fake Rolex keeps full confidence and full price. | architecture |
| `buildFastPathVerification` covers 27/27 consumers | **24/27.** `buildFallback` is 25 keys, not 22. `israeli_market_notes` *is* set by both. | architecture |
| Memory aggregates use whitelists, so new types are inert "by construction" | **False.** `last_verified_price_at` has *no* `sample_type` filter — inert only by accident of the provenance values chosen. The unguarded dimension is **provenance**, not sample_type. | memory |
| `memory_confirmed` = "human-confirmed, ≥2 distinct users" | **Wrong about the schema.** `distinct_user_count` counts *identity* confirmations; `price_p50` admits `provenance='stage2_ai'` — pure AI prices. One identity confirmation opens the price gate forever. | valuation |
| Transactions are "trustworthy at source" | Proves price **integrity**, not **validity**. Self-purchase is blocked same-account only; completion needs role `'buyer'` with **no payment check**. Two accounts mint top-tier evidence free. | security |
| `mixed_corroborated` is safe | `ai_reasoned` is not independent of evidence it was **shown**. One stale catalog row + its own echo → HIGH. | pricing + valuation |
| Proposed rollback | **Impossible.** The ledger is pinned append-only in the catalog; un-widening the CHECK would require deleting rows. | memory |
| Gate forensics on `needsAuthenticityForensics` before call 1 | **Circular** — every input it reads is a call-1 output, and the request body has nothing category-shaped. | architecture |

---

## 1. Corrected architecture

```
CAMERA ──► IMAGE ──► client compress 1280px/0.82
                             ▼
      ╔══════════════════════════════════════════════════════╗
      ║ OPENAI CALL 1 — PERCEPTION           luna·none·high  ║
      ║  identity · visible text · logos · condition         ║
      ║  AUTHENTICITY **OBSERVATIONS** (always in schema)    ║
      ║  uncertainty / candidates                            ║
      ║  ✗ NO PRICE   ✗ NO AUTHENTICITY *CONCLUSION*         ║
      ╚═══════════════════════╤══════════════════════════════╝
                              ▼
        normalize + calibrate (001 safety layer, unchanged)
                              ▼
        ┌─────────────────────────────────────────────┐
        │ SERVER-DERIVED AUTHENTICITY  (deterministic)│
        │ observations + existing risk rules          │
        │ → replica_tier · status · evidence_score    │
        └─────────────────────┬───────────────────────┘
                              ▼
      ╔══════════════════════════════════════════════════════╗
      ║ GETWORTH RETRIEVAL          (existing, unchanged)    ║
      ║  catalog rows → gradeRowEvidence / classifyRowEvidence║
      ║  corrections                                          ║
      ║  memory → IDENTITY SIGNAL ONLY (no price) ◄── §11/§12 ║
      ╚═══════════════════════╤══════════════════════════════╝
                              ▼
                  ┌───────────────────────┐
                  │ EVIDENCE SUFFICIENCY  │
                  └──────┬───────────┬────┘
                  enough │           │ thin
                         ▼           ▼
      ╔══════════════════════════╗  (skip call 2 —
      ║ OPENAI CALL 2 — REASONING║   deterministic quote
      ║ terra · low · TEXT ONLY  ║   or manual_required)
      ║ in: identity + condition ║
      ║     + EVIDENCE ROWS      ║
      ║     (all fenced, §15)    ║
      ║ out: pricing HYPOTHESIS  ║
      ║ ✗ never visual claims    ║
      ╚═══════════╤══════════════╝
                  ▼
      ╔══════════════════════════════════════════════════╗
      ║ PRICING ORCHESTRATOR — deterministic, no model   ║
      ║ evidence independence · disagreement · fusion    ║
      ╚═══════════════════════╤══════════════════════════╝
                              ▼
      ╔══════════════════════════════════════════════════╗
      ║ VAL-001 validateQuote — final choke, may only    ║
      ║ NARROW. Single call site. Unchanged role.        ║
      ╚═══════════════════════╤══════════════════════════╝
                              ▼
                        FINAL RESULT
                              ▼
            USER CONFIRMATION / CLASS-B QUESTIONS ONLY
```

Removed from the OpenAI path: legacy Stage 1, legacy Stage 2, Google Vision
fallback, the separate serial-OCR round trip. Unchanged: retrieval, evidence
classification, sibling protection, the 001 safety layer, VAL-001,
persistence, auth, quota.

---

## 2. Stage-2 runtime consumer matrix

Traced from **actual runtime reads**, not `VERIFICATION_SCHEMA` (dead code).
27 distinct `verification.*` consumers in `api/analyze.js`, plus UI consumers
reading the normalized result.

**Stage 2 may not be removed until every SAFETY row below is green.**

| # | Stage 2 output | Consumer | Safety/UX purpose | New source | Fallback | Test |
|---|---|---|---|---|---|---|
| **SAFETY-CRITICAL** |
| 1 | `authenticity_assessment.replica_tier` | `normalizeForUI:3104` multiplier 0.07/0.15/0.28 | Replica pricing haircut | **Server-derived** from call-1 observations + existing risk rules | Risk high & observations absent → `verification_required`, price degraded | Fake Rolex ⇒ multiplier < 1.0 |
| 2 | `authenticity_assessment.status` | `calibrateVerification:2637` RULE 9 caps 0.72/0.65/0.55/0.35 | Confidence ceiling on counterfeit-prone items | same | caps applied on `unknown` | Each cap reachable |
| 3 | `authenticity_assessment.signal_conflict` | RULE 9 + `assessAuthenticity:2891` | Brand claimed but absent from OCR | Structural rule **already server-side** — survives | n/a | Existing test |
| 4 | `pricingMode === 'replica_adjusted'` | `analyze.js:4579` memory write gate | Keeps replica prices out of shared memory | same as 1 | Gate fails **closed** | Replica ⇒ no memory sample |
| 5 | `authenticity_assessment.visual_signals` | `assessAuthenticity` → UI panel | Evidence shown to user | Call-1 observations | Empty list, panel hidden | Panel renders or hides cleanly |
| 6 | `match_confidence` | 11 sites incl. tier + guard | Confidence everywhere | Orchestrator, from evidence | `calibrateVerification` unchanged | Existing |
| 7 | `final_brand` / `final_model` / `final_category` | 40 sites, memory key, candidate payload | Identity of record | Call 1 + retrieval | `unidentified` | Existing |
| 8 | `price_estimate_low/mid/high` | VAL-001 input | The price | Orchestrator | `manual_required` | Existing guard suite |
| 9 | `price_method`, `_pricing_meta.*` | provenance + UI | Pricing provenance | Orchestrator | `manual_required` | New |
| 10 | `condition` | ladder basis | Condition adjustment | Call 1 | `''` → basis null | Existing |
| **UX (non-safety, but currently shipped)** |
| 11 | `israeli_market_notes` | `result.details.description` + UI ×4 | Item description | **Call 2** `market_notes` | `''` — card hides | Snapshot |
| 12 | `selling_tips` | UI ×4 | Seller guidance | **Call 2** `selling_tips` | `''` | Snapshot |
| 13 | `price_factors` | UI ×3, `result.priceFactors` | Why this price | **Orchestrator `factors[]`** (evidence-derived, better) | `[]` | New |
| 14 | `market_demand` | UI market-insight card | Demand signal | **Call 2** | `'moderate'` | Snapshot |
| 15 | `is_sellable`, `selling_tips`, `full_name*`, `matched_product_ids`, `confidence_reasoning`, `identification_method`, `brand_confidence`, `new_retail_price_ils`, `currency` | various | display + provenance | Call 1 / orchestrator / existing builders | existing defaults | Existing |
| **NOT FROM STAGE 2 — no action** |
| 16 | `raw_match_confidence` | `calibrateVerification` sets it | — | unchanged | — | — |
| 17 | `_val001` | handler stamps it | — | unchanged | — | — |

**Conclusion: Stage 2 is removable**, conditional on rows 1–5 being satisfied
by §3. Rows 11–14 are real UX losses that rev-1 did not account for and that
call 2 must now own.

---

## 3. Authenticity-forensics replacement

Rev-1's plan (gate forensics on `needsAuthenticityForensics` before call 1)
is **impossible**: that predicate reads `recognition.category`,
`.subcategory`, `.brand_candidates`, `.ocr_text.*` — all call-1 outputs — and
the request body carries nothing category-shaped. Under `strict:true` a
conditional block means a second schema variant, and there is nothing to
select it with.

**Adopted: split perception from conclusion.**

**Call 1 emits OBSERVATIONS only** — always in schema, no gating needed:

```
authenticity_observations {
  serial_visible, logo_legible, stitching_resolvable,
  text_spacing_observable, print_quality_assessable,
  resolution_adequate            : boolean
  visual_signals                 : string[]   // what is SEEN, not concluded
}
```

**The server derives the CONCLUSIONS** — `replica_tier`, `status`,
`evidence_score` — from those observations plus the risk rules already in
`assessAuthenticity` (`:2861-2950`), which are deterministic today.

Why this is better than porting the conclusion into call 1:

1. **It dissolves the gating problem.** Observations are small and always
   emittable (~20 tokens for a non-risk item: `"serial_visible":false,
   "visual_signals":[]`).
2. **It fixes a live defect rather than moving it.** Today `replica_tier` is
   *a conclusion about an image asserted by a model that has no image* —
   `verifyAndPrice:2341` sends text only, while the prompt asks what details
   "in the image" support authenticity. Call 1 has the photograph.
3. **It is the same principle as §7 pricing** — the model perceives,
   GetWorth concludes. One rule, two subsystems.
4. **It removes a prompt-injection surface.** `red_flags`/`green_flags` are
   model-authored prose rendered straight into the UI
   (`CameraResultsView.jsx:1566`). Templated-from-observations copy is
   deterministic, translatable and injection-free.

**Fail-closed rule.** If risk is high (brand/category regex) and observations
are absent or `resolution_adequate: false`, the item does **not** get a clean
bill: status stays `unknown`/`verification_required`, confidence caps apply,
and pricing degrades. Never "no evidence of fake ⇒ genuine".

**Named quality risk:** forensics at `effort:'none'` on the nano tier is
unvalidated. The benchmark must measure counterfeit-prone items specifically.

---

## 4. Call-1 contract

Extends the existing `OPENAI_IDENTITY_SCHEMA` — reused, so every 001 safety
property (mutual corroboration, logos excluded from model evidence, text
keys before identity keys, `carriesIdentifyingText`, `'unidentified'`
sentinel, out-of-range → 0) carries over unchanged.

Additive: `variant`, `generation`, `capacity`, `color`;
`condition { grade, confidence, visible_issues[], missing_components[],
completeness, packaging_visible, additional_info_needed[] }`;
`authenticity_observations` (§3); `alternative_identities[]`.

**Absent by construction: any price field, and any authenticity
*conclusion*.** A field the model cannot emit is a field it cannot anchor on.

---

## 5. Retrieval contract

Unchanged. Catalog rows via `gradeRowEvidence` / `classifyRowEvidence` /
`rankCandidates`; corrections via `fetchCorrections`; memory **identity
signal only** (§11).

Each row is normalized to `PricingEvidence` (§6) with `identity_match` taken
from `classifyRowEvidence` — never from anything a model said. This is what
keeps sibling contamination out of pricing.

---

## 6. Call-2 pricing contract

Text-only. Receives identity, condition, and evidence rows — **all fenced
per §15**. Produces a **hypothesis**, never a verdict.

```
valuation_hypothesis {
  used_low, used_mid, used_high, currency: 'ILS'
  confidence
  pricing_factors[]            // feeds matrix row 13
  market_notes                 // feeds row 11
  selling_tips                 // feeds row 12
  market_demand                // feeds row 14
  evidence_assessment {
    stale_evidence_ids[], conflicting_evidence_ids[],
    insufficient: boolean, reasoning: string
  }
  disagrees_with_catalog: boolean
  more_evidence_required: boolean
}
```

Call 2 **may** disagree with catalog evidence, flag stale evidence, and say
it needs more. It **may not** make visual claims (it has no image) or emit
authenticity conclusions.

`PricingEvidence` (unchanged from rev-1 except as noted):

```
kind        transaction* | memory_price* | catalog | market* | ai_reasoned
            | ai_prior | category_bucket | user_declared
price_ils, condition, sample_count, geographic,
identity_match  exact|family|sibling|category   (from classifyRowEvidence)
verified, source_ref, provenance
observed_at  NON-NULLABLE: ISO8601 | 'undatable'   ◄── §8
```
`*` = deferred this phase (§12, §13).

**`observed_at` is non-nullable with an explicit `'undatable'` value.** This
is a design-level fix for an implementation-level failure: with a nullable
field someone writes `freshness(observed_at ?? Date.now())`, which makes
every undatable row *maximally fresh* — the exact inversion of the safety
requirement. A sentinel forces the code to branch instead of coerce.

---

## 7. Pricing orchestrator

Deterministic, no model call. Wall clock and evidence reads are injected, so
the fusion core stays a pure function (testable without I/O).

1. **Filter** — drop `identity_match ∈ {sibling, category}` from *anchoring*.
2. **Cap, don't decay, what cannot be dated.** `undatable` evidence (catalog
   rows have no market-observation timestamp — `products` carries only a
   write time) is **capped at MEDIUM and may never select an envelope**.
   Dated evidence decays on a named curve per category class
   (electronics fast, furniture slow), with a floor.
3. **Independence partition** (§9) — before any corroboration.
4. **Disagreement** (§9) — resolved, never averaged.
5. **Fuse** — weighted median of survivors.
6. **Derive** presentation prices from the fused band + condition ladder.
7. **Emit** proposal + strongest *independent* provenance.

**Two hard rules.** The orchestrator proposes, VAL-001 disposes. And the
envelope is selected only from **independent, datable** evidence — `ai_*`
can never select or widen one.

---

## 8. Revised evidence hierarchy

| Rank | provenance | ceiling | live this phase? |
|---|---|---|---|
| 1 | `transaction_verified` | HIGH | ❌ **deferred** (§13) |
| 2 | `memory_confirmed` | HIGH | ❌ **deferred** (§12) |
| 3 | `catalog_anchored` | HIGH *(MEDIUM if undatable)* | ✅ |
| 4 | `market_observed` | MEDIUM | ❌ no source exists |
| 5 | `ai_reasoned` | MEDIUM | ✅ |
| 6 | `ai_prior` | **LOW** | ✅ |
| 7 | `category_bucket` | LOW | ✅ |
| 8 | `manual_required` | MANUAL_REQUIRED | ✅ |
| — | `user_declared` | MEDIUM, cannot select an envelope | ✅ (§14) |

**Four of eight tiers are live.** Stated explicitly so the benchmark is not
read as exercising a full ladder. In practice almost every scan this phase
resolves on rank 3, 5, 6, 7 or 8.

`mixed_corroborated` is **removed entirely** (§9).

---

## 9. Evidence-independence rules

Rev-1's `mixed_corroborated` promoted one grade above the best single source
when ≥2 "independent kinds" agreed. It is deleted. Two replacements:

**Rule 1 — independence means *does not causally descend from*, not *is not
the same call*.** `ai_reasoned` is a function of every evidence row passed
into call 2, so it descends from all of them and is **independent of
nothing**. It can act as a tiebreaker or a degrader; it can never be a
corroborator and can never raise any grade — least of all its own.

**Rule 2 — no promotion ladder at all.** The grade is the ceiling of the
strongest single *independent, datable* source. Agreement between sources
raises **confidence within** that grade; it never raises the grade. This kills
both rev-1 failures at once: stale-catalog + its own echo → HIGH, and
`ai_prior` + `category_bucket` → MEDIUM (two ways of saying "we are guessing"
must not multiply into a MEDIUM).

---

## 10. VAL-001 interaction

**Role unchanged: final safety choke point, one call site, fail-closed,
may only narrow.**

Additive only: accept an optional `ctx.evidence` array; derive provenance
from §8 instead of inferring it from `ctx.stage` truthiness; apply the grade
ceilings; treat `disagreement` as degrade-only. **Callers passing no evidence
behave exactly as today.**

Unchanged: envelope values, `manual_only` categories (jewelry et al.), the
spread cap, the fail-closed exception path, the replica multiplier, the
`isPricedVerdict` presentation boundary. **No new ceiling exceeds HIGH**,
today's maximum.

Not implemented until the mandatory valuation-safety gate passes.

---

## 11. Recognition Memory scope

**Identity and corrections only. No pricing.**

Two guardrails, because key collapse contaminates the identity read too —
`confirmation_count` on a collapsed key evidences the **family**, never the
variant:

1. Memory signal may **never** raise `identity_resolution.level` to `exact`.
2. Memory signal is **barred from `evaluateFastPath`'s inputs entirely.**

Rationale for (2), verified: `analyze.js:5256` rejects on
`ir.level !== 'exact'`, so `exact` is precisely the gate that skips Stage 2.
A family-level confirmation arriving as `exact` would be sibling
substitution on the one path with no model call left to catch it. Today
memory is shadow-only, so this risk does not exist; a naive read path would
create it.

---

## 12. Deferred: memory pricing

`price_p25/p50/p75` and `last_price_mid` are **excluded** from the pricing
path. Four established reasons: variant-collapsing v2 keys (verified:
iPhone 15 / 15 Pro, AirPods / AirPods Pro, Galaxy S24 / S24 Plus,
Switch / Switch Lite all share one key — 6 of 8 tested pairs); AI-origin
prices already inside the percentiles; identity confirmation ≠ price
confirmation; and a write→read feedback loop that saturates a 20-row window
after 20 scans.

**No narrower cut exists.** Key collapse is *undetectable from the read
side*: nothing distinguishes "40 samples, all 15 Pro" from "20 Pro, 20 base",
because the key **is** the identity and samples carry no model string. There
is no field to filter, cap or penalise against.

**Preserved as shadow measurement.** Compute the projection, persist it in
`ai_raw_response`, never let it reach the orchestrator. Zero valuation risk;
it is precisely the dataset needed to decide whether to enable it after v3.

Follow-up ticket: **RECOGNITION MEMORY V3 — variant-safe + provenance-clean
pricing memory.**

---

## 13. Deferred: transaction pricing

Not created as an evidence tier. **No migration is proposed this phase.**

A completed order is not yet proof of a genuine market transaction:
`create_order` validates `p_price = listing.price` (integrity, not validity);
the seller sets that price; self-purchase is blocked **same-account only**;
and the transition to `completed` requires role `'buyer'` with **no payment
verification**. Two accounts mint rank-1 evidence on a globally shared key
at zero cost.

Rev-1's migration is withdrawn in full. For the record, it was also defective:
the idempotency index was defeated by NULL payloads (and
`memory_append_sample` has no `payload` parameter), scoping should have been
global rather than per-memory, `memory_append_sample` needed a fail-closed
whitelist, and the stated rollback was **impossible** — the ledger is pinned
append-only in the catalog.

Follow-up ticket: transaction learning, gated on a trustworthy
transaction-verification model.

---

## 14. Questionnaire strategy

Classification retained (A 46 / B 24 / C 28 / D 15). **No question deleted,
reworded or reordered this phase.**

Target flow: call 1 pre-fills **class A** as confirmable defaults; the user
is asked **only class B** — the 24 that need a human and move the price
(`workingCond`, `battery`, `storage`, `authenticity`, `warranty`, `km`, …),
of which only 3 affect price today. Class C stays on the listing; class D is
retired in its own ticket.

Interface: `/api/analyze` accepts optional `condition_answers`; answers with
a declared price effect enter as `PricingEvidence { kind: 'user_declared' }`
at MEDIUM, **unable to select an envelope** — the same containment
`calcPrice`'s upside clamp already applies. **Validated and `promptSafe`'d
at the boundary** (§15): this is a new client-controlled input.

---

## 15. Prompt-input trust boundaries

**Dependency: GW-PROMPT-INJECTION-001 ships first.** It documents a live
client-controlled injection into the *current* Stage 2 pricing prompt, and
the fact that `fence` / `FENCE_RULE` / `promptSafeList` /
`sanitizeClientCorrections` have **zero call sites**.

Rules for this design, built on the fixed primitives from day one:

- Call 1 — the image is untrusted. `visible_text` is data to extract; the
  prompt says so and the schema gives it nowhere to act.
- **Call 2 is the new surface.** Every string in its input — identity from a
  photographed label, condition text, catalog aliases, memory display names,
  `user_declared` answers — is `promptSafe`'d and `fence()`d, with
  `FENCE_RULE` emitted once. Evidence blocks are data and can never alter
  instructions.
- `authenticity_observations.visual_signals` is model-authored prose reaching
  the UI — templated via §3 rather than rendered raw.
- Never persisted: secrets, prompts, raw provider payloads, chain-of-thought.

---

## 16. Failure / fallback state machine

Decision 3 preserved: **no automatic full-legacy fallback.** Rev-1's measured
~42.5 s path is designed out.

```
CALL 1 ─┬─ success ─► identity? ─┬─ exact/family ─► RETRIEVAL ─► sufficiency
        │                        └─ unknown ─────► NEEDS_USER_INPUT
        └─ fail/timeout ─────────────────────────► RECOVERABLE_FAILURE
                                                    (503 retryable, quota
                                                     refunded, NO legacy run)

sufficiency ─┬─ enough ─► CALL 2 ─┬─ success ─► ORCHESTRATOR
             │                    └─ fail ────► ORCHESTRATOR (evidence only,
             │                                   grade capped at best evidence)
             └─ thin ────────────► DETERMINISTIC QUOTE or manual_required
                                          ▼
                                       VAL-001
```

Reachability check (rev-1 gap): call 1 succeeds with unknown identity **and**
empty retrieval **and** call 2 skipped → `NEEDS_USER_INPUT`, not a dead end.
High authenticity risk with inadequate observations → `verification_required`
with degraded pricing, never a clean bill.

Legacy engine stays available behind the flag for rollback and A/B.

---

## 17. Telemetry

Extends the 001 roll-ups; rides in `ai_raw_response` + the
`openai_experiment_timings` event. **No migration.**

`recognition_engine`, `openai_model_call1/2`, `call1_ms`, `call2_ms`,
`retrieval_ms`, `memory_ms`, `orchestrator_ms`, `val001_ms`,
`persistence_ms`, `total_ms`, `call2_skipped(+reason)`, `fallback_used`,
`identity_confidence`, `condition_confidence`, `authenticity_status`,
`authenticity_derived_from` (observations vs risk-rules-only),
`pricing_source`, `pricing_confidence`, `evidence_kinds[]`, `evidence_count`,
`undatable_evidence_count`, `disagreement{detected,magnitude,action}`,
`val001_action`, `usage{...}`, `estimated_cost_usd`,
`memory_price_shadow{...}` (§12).

Preserved from 001: a genuine 0 ms stays 0; external latency includes the
full body read; `vision_ms` stays visible.

---

## 18. Latency budget

**A budget, not a measurement. No official latency figures exist for any of
these models.**

| Segment | Budget |
|---|---|
| upload + body parse | 0.5–1.5 s |
| auth + rate limit (warm) | 0.3–0.8 s |
| **call 1** (image, ~1.8k in / ~400 out) | **2.5–4.0 s** |
| retrieval (parallel groups) | 0.5–2.0 s |
| **call 2** (text, ~1.5k in / ~600 out) | **2.0–3.5 s** |
| orchestrator + VAL-001 | < 0.05 s |
| persistence | 0.3–0.8 s |
| network overhead | 0.2–0.5 s |
| **P50 target** | **~7–8 s** |
| **P90 ceiling** | **< 12 s** |

Call 2 is skipped on thin evidence, removing 2–3.5 s from exactly the scans
that would otherwise be guessing. Nothing is hidden: upload, body read,
retrieval, pricing and persistence are all inside the number.

---

## 19. Cost model

Per scan at the verified rates (luna $0.20/$1.20, terra $2.00/$12.00 per
Mtok), with this pipeline's real 1280 px image (~1,440 image tokens):

| | $ |
|---|---|
| Call 1 — luna, ~1.8k in / ~400 out | 0.00084 |
| Call 2 — terra, ~1.5k in / ~600 out | 0.01020 |
| **Total** | **≈ 0.0110** |
| per 1,000 scans | ≈ $11 |

≈ ₪0.04/scan. Rev-1 quoted two different totals ($0.0153 and $0.0092) from
different call-2 output assumptions; this supersedes both. **Cost must be
computed per scan from `usage.*`** — and `reasoning_tokens` are already
inside `output_tokens`, so counting them again double-bills.

`detail:'high'` caps image input at 3,000 tokens/image regardless of upload
size, bounding a 180,000-token worst case to 15,000. **A cost and
input-bound protection — not a latency improvement.**

---

## 20. Feature flags / rollback

```
RECOGNITION_ENGINE = current | openai     # default current
PRICING_ENGINE     = legacy  | orchestrator  # default legacy
```

Two flags, justified: pricing and recognition must roll back independently,
and the A/B must separate "recognition improved" from "pricing improved" —
the distinction the production decision needs. `openai` + `legacy` is a valid
combination (new recognition, old pricing) and is the natural first rollout
step. No removal of the legacy path.

---

## 21. Test strategy

Carry forward all 50 OpenAI tests from 001. New, at minimum:

Identity/condition mapping; missing brand/model stay missing; **AI cannot
corroborate itself** (rule 1); sibling cannot become trusted; weak-OCR
substring cannot create exact identity; speculative brand stays out of `[0]`;
**every matrix row 1–5 has a test**; replica multiplier reachable; each RULE 9
cap reachable; replica excluded from memory; **undatable evidence capped at
MEDIUM and cannot select an envelope**; disagreement degrades/escalates;
missing evidence degrades confidence; VAL-001 still executes with exactly one
call site; malformed/timeout call-1 and call-2 fail safe; provider errors
sanitized; key never client-side; `RECOGNITION_ENGINE=current` byte-identical;
timing fields persist; genuine 0 ms stays 0; jewelry/bags envelopes protected;
**product text cannot prompt-inject either call**; memory cannot raise
`level` to `exact`; memory barred from fast path.

**Mutation-test the critical guards** — remove the guard, assert a test fails.
Three 001 tests passed for the wrong reason because their fixtures
neutralised the assertion; every new safety test needs a negative control.

---

## 22. Security model

Per-call: key server-only, `store:false`, `detail:'high'`, errors classified
not raw, no image to call 2, quarantined inputs (§15), auth/quota/RLS
unchanged.

New surfaces this design creates: call 2's text input (mitigated §15),
`condition_answers` as client input (validated + clamped, §14), and
`visual_signals` prose (templated, §3).

Deferred surfaces: transaction wash-trading (§13), memory poisoning via
collapsed keys (§12).

---

## 23. Phase-3 implementation sequence

0. **GW-PROMPT-INJECTION-001 ships first** (dependency).
1. Call-1 contract: variant/condition/authenticity **observations**. Tests first.
2. `detail:'high'`.
3. Server-derived authenticity from observations — matrix rows 1–5, each with a test.
4. `PricingEvidence` normalizers over catalog + corrections. Pure functions.
5. Orchestrator + independence rules + disagreement. Heavy unit tests.
6. Call-2 adapter: text-only, fenced input, strict schema, UX fields (rows 11–14).
7. VAL-001 additive provenance — **only after the mandatory gate passes**.
8. Telemetry + shadow memory projection.
9. Benchmark extensions.
10. Full regression + independent reviews.

---

## 24. Remaining assumptions

| # | Assumption | Status |
|---|---|---|
| 1 | ~7–8 s P50 | **Projection.** No official model latency figures exist. |
| 2 | Forensics quality at `effort:'none'` on the nano tier | **Unvalidated.** Benchmark counterfeit-prone items specifically. |
| 3 | Terra at `low` suits evidence reasoning | Unvalidated. Smoke test first. |
| 4 | Freshness curve shape per category class | Named as logic, values unvalidated. |
| 5 | Removing Google Vision loses a real OCR fallback | Benchmark weak-text items. |
| 6 | Call 2 can carry the UX fields (rows 11–14) at quality | Unvalidated. |
| 7 | Cost ≈ $0.011/scan | Estimate; compute from `usage.*`. |
| 8 | 4 of 8 evidence tiers empty | **Known**, stated in §8. |
| 9 | Deterministic authenticity rules match today's model-asserted output | Must be measured, not assumed — could differ in either direction. |
| 10 | `gpt-5.6-luna` / `terra` and `effort` values current | Doc-verified, not smoke-tested. |

**Everything in §10 and §2 rows 1–5 is a design claim, not a verified
property.** They are what the mandatory valuation-safety gate is being asked
to attack.
