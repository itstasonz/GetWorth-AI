# GW-OPENAI-INTELLIGENCE-002 — Phase 2: architecture design

Branch: `feat/gw-openai-intelligence-002`. **Design only — no code, no
migration executed, no live OpenAI call, no API key requested.**

Builds on Phase 1 (`ca68445`, `1bfdc9d`, `3622486`). Every structural claim
below was checked against the code; the checks are named so a reviewer can
re-run them.

> **Two things in this document are projections, not results.** The ~8 s
> end-to-end figure and any statement about OpenAI accuracy or pricing
> quality. Both require the physical benchmark. Nothing here should be quoted
> as achieved performance.

---

## 1. Proposed architecture

```
                         ┌─────────────────────────────┐
   CAMERA ──► IMAGE ────►│ client compress 1280px/0.82 │
                         └──────────────┬──────────────┘
                                        ▼
                    ╔═══════════════════════════════════════╗
                    ║  OPENAI CALL 1 — PERCEPTION           ║
                    ║  luna · effort:none · detail:high     ║
                    ║  ├── identity (brand/family/model)    ║
                    ║  ├── visible evidence (text, logos)   ║
                    ║  ├── condition + visible issues       ║
                    ║  └── uncertainty / candidates         ║
                    ║  ***NO PRICE. NOT ASKED. NOT ALLOWED*** ║
                    ╚═══════════════════┬═══════════════════╝
                                        ▼
                         normalize + calibrate (001 safety layer)
                                        ▼
        ╔═══════════════════════════════════════════════════════╗
        ║  GETWORTH EVIDENCE RETRIEVAL   (all existing, in ║)   ║
        ║  ├── catalog rows        → gradeRowEvidence          ║
        ║  ├── Recognition Memory  → memory_lookup             ║
        ║  ├── corrections         → fetchCorrections          ║
        ║  ├── price samples       → memory percentiles        ║
        ║  ├── verified transactions   ◄── NEW (§10)           ║
        ║  └── market evidence         ◄── NEW interface (§5)  ║
        ╚═══════════════════════╦═══════════════════════════════╝
                                ▼
                    ┌───────────────────────────┐
                    │ EVIDENCE SUFFICIENCY GATE │
                    └───────┬───────────┬───────┘
              enough evidence│           │thin / absent
                             ▼           ▼
        ╔════════════════════════════╗  (skip call 2 —
        ║ OPENAI CALL 2 — REASONING  ║   deterministic
        ║ terra · effort:low         ║   quote or manual)
        ║ TEXT ONLY. NO IMAGE.       ║
        ║ in:  identity + condition  ║
        ║      + EVIDENCE ROWS       ║
        ║ out: valuation reasoning   ║
        ╚════════════┬═══════════════╝
                     ▼
        ╔════════════════════════════════════════════╗
        ║  PRICING ORCHESTRATOR  (new, deterministic)║
        ║  weighs provenance · detects disagreement  ║
        ║  selects envelope from INDEPENDENT evidence║
        ╚════════════════════┬═══════════════════════╝
                             ▼
        ╔════════════════════════════════════════════╗
        ║  VAL-001  validateQuote  — UNCHANGED ROLE  ║
        ║  final choke point. may only NARROW.       ║
        ╚════════════════════┬═══════════════════════╝
                             ▼
                      FINAL RESULT
                             ▼
              USER CONFIRMATION / CLASS-B QUESTIONS
                             ▼
                    LISTING ──► ORDER ──► COMPLETED SALE
                             ▼
              GETWORTH MEMORY  (transaction provenance, §10)
                             ↺
                        FUTURE SCANS
```

**What is removed from the OpenAI path:** old Stage 1, old Stage 2, the
Google Vision fallback, the separate serial-OCR round trip. **What is kept
unchanged:** retrieval, evidence classification, sibling protection, the
001 safety layer, VAL-001, persistence, auth, quota, memory.

---

## 2. One call vs two

**Two.** Settled in Phase 1 on an architectural reason, restated because it
is the load-bearing decision of this design:

A single call **necessarily runs before retrieval**, so it cannot see the
catalog. Any price it emits comes from model priors with a Feb 2026 cutoff —
"confidence is not evidence" relocated from an identity string into a dollar
figure, which is the precise failure the 001 ticket spent four review rounds
eliminating.

Worse, it would dismantle an existing defence. **Reasoning tokens are emitted
before any visible token**, so at `effort:'low'`+ a combined call prices the
item *before* it emits `brand` — defeating the schema key-ordering rule 001
added specifically to stop conclusions contaminating perception.

| | Call 1 | Call 2 |
|---|---|---|
| model / effort | `gpt-5.6-luna` · `none` | `gpt-5.6-terra` · `low` |
| input | image, `detail:'high'` | **text only** |
| produces | identity + condition, **no price** | valuation reasoning |
| position | before retrieval | **after** retrieval |

Cost ≈ **$0.0153/scan** vs $0.0013 combined. 12×, and still ≈ ₪0.06.

`none` for call 1 / `low` for call 2 follows the documented scoping: `none`
is for *"fast information retrieval, and classification"*; `low` for
*"multi-step decision making"*. Condition grading is classification and
survives `none`; a defensible price range is deduction and does not.

**Call 2 is skippable.** When evidence is thin (§8 gate), the orchestrator
produces a deterministic quote or `manual_required` without calling it —
saving both cost and latency on exactly the scans where a model would be
guessing anyway.

---

## 3. Can the existing Stage 2 be removed? **Yes — and the codebase already proves it**

This is the question that decides whether the project is worth doing, so it
is answered structurally rather than by assertion.

Stage 2's output contract is `VERIFICATION_SCHEMA`. Its downstream consumers
are 27 distinct `verification.*` fields. **`buildFastPathVerification`
already produces every one of them with zero model calls**, and it ships in
production today — the fast path skips Stage 2 entirely and still earns the
`stage2_comp_anchored` / HIGH grade.

```
consumers of verification.*          27 fields
buildFastPathVerification produces   27 fields  ← complete coverage
buildFallback produces               22 fields  ← the degraded subset
```

The four consumer fields neither builder sets all degrade safely:
`israeli_market_notes` (`|| ''`), `authenticity_assessment` (`|| {}`),
`raw_match_confidence` (`??`, set by `calibrateVerification`), `_val001`
(stamped by the handler).

**Conclusion.** Stage 2's *contract* is already synthesizable without a model
call. What Stage 2 uniquely contributes today is (a) pricing reasoning over
candidates and (b) an identity-verification narrative. Call 2 replaces (a)
with strictly better inputs — it sees retrieval, which Stage 2 also does, but
it is not simultaneously re-deciding identity. (b) is redundant: identity is
already established by call 1 + the 001 safety layer + retrieval evidence.

So the OpenAI path is **call 1 → retrieval → call 2 → orchestrator → VAL-001**,
with **no legacy Stage 1 and no legacy Stage 2**. The forbidden shape
(`OpenAI → old Stage 1 → retrieval → old Stage 2`) is explicitly not what is
proposed.

**Latency arithmetic** (projection): call 1 ~3–4 s + retrieval ~1–2 s +
call 2 ~2–3 s ≈ **8 s**, against today's 21–36 s. Unproven until benchmarked.

---

## 4. Recognition contract (call 1)

Extends the existing `OPENAI_IDENTITY_SCHEMA` — **reused, not replaced**, so
every 001 safety property carries over unchanged.

Additive fields only:

```
identity:   + variant, generation, capacity, color
condition:  + grade, confidence, visible_issues[], missing_components[],
              completeness, packaging_visible, additional_info_needed[]
uncertainty:+ alternative_identities[]   (candidate_models/brands exist)
```

**`valuation` is deliberately absent from call 1's schema.** Not optional —
absent. A field the model cannot emit is a field it cannot anchor on.

Preserved verbatim from 001, all regression-tested:

| Protection | Mechanism |
|---|---|
| Self-corroboration | mutual token corroboration; logos excluded from model evidence; **text keys before identity keys** |
| Weak OCR | `carriesIdentifyingText` — `CE`/`OK`/`12` are not evidence |
| Sibling/substring | claim-side strict + entry-side noise-filtered, both directions |
| Model-number evidence | `labels_detected` gated on real corroboration |
| Speculative brand | `'unidentified'` sentinel |
| Null brand | absence preserved |
| Confidence | out-of-range → 0; silhouette clamp downstream |
| SCAN-018 | untouched |

Schema budget is a non-issue: **5,000 properties / 10 nesting levels**; a
~50-field schema is ~1% of budget. Keep the schema **byte-stable across
deploys** — schema processing is a one-time cold cost, not per-scan.

---

## 5. Pricing evidence contract

One normalized shape, source-agnostic and provenance-aware. **Lives in
`ai_raw_response` JSONB — no migration** (§11 covers the one that is needed).

```
PricingEvidence {
  kind          transaction | memory_price | catalog | market | ai_reasoned
                | ai_prior | category_bucket
  price_ils     integer                 // ILS only; converted values carry fx
  condition     newSealed|likeNew|used|poor|null
  observed_at   ISO8601                 // drives freshness decay
  sample_count  integer                 // 1 for a single row
  geographic    IL | converted:<cc> | unknown
  identity_match exact | family | sibling | category   // from evidence class
  verified      boolean                 // server-side verifiable at source
  source_ref    opaque id (order id, product id, memory key) — never a URL
  provenance    see §7
}
```

`identity_match` is the field that stops sibling contamination reaching
pricing: it is set from the **existing** `classifyRowEvidence` result, not
from anything a model said.

**MarketEvidence** is the same shape with `kind: 'market'` plus
`source_name`. No connector is implemented in this ticket (§47); the
interface exists so a future legitimate source plugs in without touching
valuation.

---

## 6. Pricing Orchestrator

Deterministic. **No model call. Pure function of evidence + call-2 output.**

```
inputs:  identity, condition, PricingEvidence[], call2 reasoning (optional)
output:  PricingProposal { low, mid, high, recommended_listing,
                           expected_sale_low/high, quick_sale,
                           confidence, provenance, factors[],
                           disagreement, needs_review }
```

Algorithm:

1. **Filter** — drop evidence whose `identity_match` is `sibling` or
   `category` from *anchoring* (it may still inform the band). Drop
   `geographic: converted:*` from Israeli anchoring unless nothing else
   exists, and mark it if used (§46).
2. **Weight** — each surviving item gets `w = base(provenance) ×
   freshness(observed_at) × √sample_count × condition_match`.
   Freshness is a decay, which is how requirement 2 of Decision 2 is met:
   *a stale catalog row loses weight automatically rather than needing a
   special case*.
3. **Cluster** — group central estimates; compute `magnitude = max/min`.
4. **Disagree** (§8) before fusing. Disagreement is resolved, not averaged.
5. **Fuse** — weighted median of the surviving cluster, not a mean (outlier
   resistance).
6. **Derive** the presentation prices from the fused band and the condition
   ladder: `recommended_listing` ≈ high-side, `expected_sale` = the band,
   `quick_sale` ≈ low-side. These are *derived*, never separately invented.
7. **Emit** proposal + the provenance of the *strongest* contributing
   evidence.

**Hard rule: the orchestrator proposes, VAL-001 disposes.** The proposal is
an input to `validateQuote`, never a substitute for it.

**Second hard rule — the one that keeps OpenAI from self-certifying:** the
*envelope* is selected from the strongest **independent** evidence. An
`ai_reasoned` or `ai_prior` item can never select or widen an envelope. If
the only evidence is AI, the category envelope applies exactly as it does
today.

---

## 7. Pricing provenance hierarchy

Additive to `derivePricingSource`'s existing vocabulary. Existing values keep
their current meaning and grade.

| Rank | provenance | grade ceiling | basis |
|---|---|---|---|
| 1 | `transaction_verified` | HIGH | completed GetWorth sale, server-recorded price |
| 2 | `memory_confirmed` | HIGH | human-confirmed memory samples, ≥2 distinct users |
| 3 | `catalog_anchored` *(= existing `stage2_comp_anchored`)* | HIGH | compatible row with model evidence |
| 4 | `market_observed` | MEDIUM | external evidence, IL market |
| 5 | `ai_reasoned` | MEDIUM | call 2 **over evidence** |
| 6 | `ai_prior` | **LOW** | model priors, no evidence |
| 7 | `category_bucket` | LOW | existing |
| 8 | `manual_required` | MANUAL_REQUIRED | existing |
| — | `mixed_corroborated` | one grade **above** the best single source, max HIGH | ≥2 independent kinds agreeing within 1.3× |

Three rules make this safe:

- **Independence is required for corroboration.** Two items sharing a
  provenance *or* sharing an inference origin (call 1 and call 2 are the same
  origin) count once. This is §19 applied to pricing.
- **`ai_prior` is capped at LOW and can never be the sole basis for a
  non-degraded price.** It is the honest home for "we have nothing but the
  model's guess".
- **Freshness decays every tier**, so rank 3 does not automatically beat
  rank 4 when the catalog row is two years old.

---

## 8. Disagreement handling

```
magnitude = max(central estimates) / min(central estimates)
```

| magnitude | action |
|---|---|
| < 1.5× | `agreement` — proceed |
| 1.5–2.5× | `degrade` — confidence down one grade, `factors[]` records it |
| > 2.5× | `escalate` — see below |

**Escalation treats disagreement as an IDENTITY signal first.** The commonest
cause of a 3× gap is not a bad price — it is the wrong variant. So the order
is:

1. Is `identity_resolution.level` below `exact`, or `exact_model_ambiguous`
   set? → `verify_identity`: ask the user to confirm between
   `alternative_identities`. Do not price confidently.
2. Is the only high evidence a `sibling` match? → drop it, re-fuse, mark.
3. Is the AI the outlier against ≥2 independent evidence kinds? → drop
   `ai_*`, re-fuse on evidence, grade MEDIUM.
4. Is evidence the outlier against a fresh transaction? → trust the
   transaction, mark the catalog row stale.
5. Otherwise → `needs_review: true`, widen the band, degrade to LOW, and
   surface uncertainty in the UI.

**Never silently pick one.** `disagreement` is always persisted, including
when it resolves cleanly (`{ detected: false, magnitude }`), so the benchmark
can measure how often it fires.

---

## 9. Recognition Memory integration

**Read path (new, replaces the shadow-only lookup):** after call 1 and the
canonical key is built, `memory_lookup` returns the aggregate row. Feed call
2 **only** a bounded, relevant projection — never the memory database (§44):

```
{ canonical_key, confirmation_count, distinct_user_count,
  price_p25/p50/p75, price_sample_count, last_verified_price_at,
  transaction_count, transaction_p50,          ◄── new
  reputation_score }
```

Bounded by construction: one row, ~10 scalars, no free text, no other users'
data.

**Write path — unchanged for everything that exists.** The only addition is
transaction evidence (§10). An AI hypothesis still cannot create a trusted
row: `origin='ai_observed'` stays zero-trust, and price samples still gate on
`confirmation_count > 0`.

---

## 10. Transaction learning

The flywheel's strongest signal, and today it has nowhere to go.

**The data is already trustworthy at source.** `create_order`
(`20260519000003:232`) copies `listing.price` server-side and *refuses* a
client-supplied price; `orders.status='completed'` is lockdown-protected
(`20260719000003`); `listings.valuation_id` ↔ `valuations.listing_id` already
cross-reference.

**Proposed flow** — one new service-role RPC, triggered on transition to
`completed`:

```
order completed
  → resolve listing → valuation → canonical_key
  → memory_append_transaction(key, price, condition, order_id)
      sample_type = 'transaction_price'
      provenance  = 'transaction_verified'
      payload     = { v:1, order_id, listing_id, valuation_id, sold_at }
```

**Idempotency without a new column:** unique index on
`(memory_id, (payload->>'order_id'))` filtered to
`sample_type='transaction_price'`. The `payload jsonb` column already exists
(added in 1.1B). Replaying the same order is a no-op.

---

## 11. Minimal proposed migration

**Additive only. No row rewritten. No existing value removed.** Follows the
exact DROP/ADD CHECK precedent 1.1B already set on this table.

```sql
-- 1. sample_type: add three values
ALTER TABLE public.recognition_memory_samples
  DROP CONSTRAINT IF EXISTS recognition_memory_samples_sample_type_check;
ALTER TABLE public.recognition_memory_samples
  ADD CONSTRAINT recognition_memory_samples_sample_type_check
  CHECK (sample_type IN (
    'confirmation','valuation_price','manual_listing_price',
    'correction','ai_observation',
    'transaction_price','market_price','admin_verification'   -- NEW
  ));

-- 2. provenance: add three values
ALTER TABLE public.recognition_memory_samples
  DROP CONSTRAINT IF EXISTS recognition_memory_samples_provenance_check;
ALTER TABLE public.recognition_memory_samples
  ADD CONSTRAINT recognition_memory_samples_provenance_check
  CHECK (provenance IN (
    'stage2_ai','stage2_comp','pre_haiku','memory_stabilized',
    'seller','user','ai_scan',
    'transaction_verified','market_observed','admin_verified' -- NEW
  ));

-- 3. idempotency for transaction rows (no new column)
CREATE UNIQUE INDEX IF NOT EXISTS uq_rm_samples_order
  ON public.recognition_memory_samples (memory_id, (payload->>'order_id'))
  WHERE sample_type = 'transaction_price';

-- 4. keep the reputation formula clean (see below)
--    extend the ai_observation exclusion in memory_recompute()
```

### Why this is behaviour-preserving — verified, not assumed

`memory_recompute`'s aggregates use **whitelists**, so new `sample_type`
values are inert by construction:

| aggregate | filter | new types affect it? |
|---|---|---|
| confirmations / distinct users / corrections | `FILTER (WHERE sample_type = 'confirmation' \| 'correction')` | **no** |
| price percentiles, count | `sample_type IN ('valuation_price','manual_listing_price')` | **no** |
| manual price count | `sample_type = 'manual_listing_price'` | **no** |
| **confidence avg/max** | **no sample_type filter** — only `AND sample_type <> 'ai_observation'` | **YES — must be extended** |

That last row is the *only* leak: a blacklist, guarding the reputation
formula's 0.15-weight confidence term. Item 4 of the migration extends it.
Belt-and-braces, the new writers also set `source_confidence = NULL`.

**Transaction evidence is deliberately NOT added to the existing price
percentiles in this migration.** Folding a sold price into `price_p50`
would silently change what that number means for every existing consumer.
The orchestrator reads transaction rows from the ledger directly. Changing
the aggregates is a separate, later decision.

**Rollback:** re-apply the two CHECKs without the new values (only possible
while no row uses them), drop the index, restore `memory_recompute`. Stated
in the migration file per repo convention.

---

## 12. VAL-001 — proposed changes

**Role unchanged: the final safety choke point. Still exactly one
`validateQuote` call site. Still fail-closed. Still may only narrow.**

Minimal additive changes, all inside `derivePricingSource` / `resolveEnvelope`:

1. **Accept a provenance argument.** Today provenance is *inferred* from
   `ctx.stage` + `ctx.anchor` truthiness. Proposed: the orchestrator passes
   `ctx.evidence` (the §5 array) and `derivePricingSource` reads the §7
   ranking from it. Existing callers that pass neither behave **exactly as
   today** — the new branch is additive and defaults off.
2. **Grade ceilings per provenance** (§7 table). No provenance gains a
   ceiling above HIGH, which is the current maximum. **No new ceiling is
   higher than any existing one.**
3. **Envelope selection from independent evidence only.** `ai_*` provenance
   cannot select or widen an envelope. Category envelopes, `manual_only`
   buckets (jewelry et al.) and the spread cap are untouched.
4. **`disagreement` is an input that can only degrade**, never upgrade.

**Explicitly NOT changed:** envelope values, `manual_only` categories, the
spread cap, the fail-closed exception path, the replica multiplier, the
`isPricedVerdict` presentation boundary.

**Nothing here is implemented until the independent valuation-safety review
passes** (Decision 2). The seven required verifications are addressed in §20.

---

## 13. Questionnaire integration

**No question is deleted, reworded or reordered in this ticket.** What is
designed is the *interface* by which answers can eventually reach pricing —
today they reach nothing, because the whole adjustment is client-side in
`calcPrice` and answers never reach the server.

Classification of all 113 keys:

**A — visually inferable by call 1 (≈46).** `scratches`, `defects`, `stains`,
`colorFading`, `cleanness`, `completeness`, `accessories`, `screenCond`,
`crystalCond`, `bracelet`, `bandFit`, `earpads`, `soleCond`, `upholstery`,
`pages`, `cover`, `bookCondition`, `bowlCond`, `material`, `fabricType`,
`finish`, `shade`, `boxPapers`, and the ~23 *type* selectors
(`deviceType`, `furnitureType`, `vehicleType`, `toyType`, `toolType`,
`watchType`, `bookType`, `beautyType`, `homeType`, `smokingType`,
`sportType`, `bikeType`, `speakerType`, `panelType`, `clothingType`,
`doorType`, `tableShape`, `seatCount`, `shelvesCount`, `discDrive`,
`controllerType`, `builtStatus`, `gemstone`). **These should become
pre-filled, confirmable defaults — not questions.**

**B — needs the user AND moves price (≈24).** `workingCond`, `battery`,
`storage`, `authenticity`, `warranty`, `service`, `issues`, `km`, `mileage`,
`usage`, `expiry`, `opened`, `amountLeft`, `certificate`, `charger`,
`smartFeatures`, `waterResist`, `resistance`, `sensorAccuracy`, `maxSpeed`,
`electricRange`, `energyRating`, `engineType`, `movement`. **This is the set
worth asking.** Note only 3 of these 24 currently affect price at all.

**C — listing metadata, not valuation (≈28).** `clothingSize`, `shoeSize`,
`skinType`, `scent`, `scentNotes`, `spf`, `ageGroup`, `fitType`,
`volumeSize`, `perfumeSize`, `tableSeats`, `firmness`, `mattressType`,
`noise`, `washed`, `powerSource`, `assembly`, `dimensions`, `frameSize`,
`screenSize`, `pieceCount`, `coilType`, `hoseCount`, `liquidIncluded`,
`colorType`, `clothingSize`, `edition`, `connectivity`. Keep, but they belong
on the listing, not the valuation.

**D — redundant / no demonstrated use (≈15).** Overlapping wear scales
measuring the same thing on the same item: `scratches` vs `defects` vs
`stains` vs `colorFading` vs `cleanness`; `usage` vs `mileage` vs `worn` vs
`km`; `bookCondition` / `toolCondition` / `soundQuality` / `filterCond` /
`bladeBit` / `brakes` / `tires` duplicating the global condition ladder.

**Proposed interface (design only):** `/api/analyze` accepts an optional
`condition_answers` object; answers with a declared price effect enter the
orchestrator as `PricingEvidence { kind: 'user_declared' }` at MEDIUM,
capped so a user answer can adjust within the validated band but never
select the envelope. This is the same containment the client-side
`calcPrice` already applies via its upside clamp.

---

## 14. Failure / fallback state machine

**Decision 3 applied: no automatic full-legacy fallback.** The ~42.5 s path
is designed out.

```
                    ┌──────────────────┐
                    │  CALL 1 (≤5 s)   │
                    └────┬────────┬────┘
                 success │        │ fail / timeout / malformed
                         ▼        ▼
                  ┌──────────┐  ┌──────────────────────────────┐
         identity │ CONFIDENT│  │ RECOVERABLE_FAILURE          │
           level? │          │  │ 503 retryable, quota refunded│
                  └────┬─────┘  │ NO legacy pipeline run       │
       exact/family    │        └──────────────────────────────┘
                       ▼
              ┌────────────────┐        unknown / ambiguous
              │   RETRIEVAL    │◄──┐         │
              └───────┬────────┘   │         ▼
                      ▼            │   ┌──────────────────┐
           ┌──────────────────┐    │   │ NEEDS_USER_INPUT │
           │ SUFFICIENCY GATE │    │   │ confirm identity │
           └───┬──────────┬───┘    └───┤ or add a photo   │
        enough │          │ thin       └──────────────────┘
               ▼          ▼
        ┌────────────┐  ┌────────────────────┐
        │  CALL 2    │  │ DETERMINISTIC QUOTE│
        │  (≤4 s)    │  │ or manual_required │
        └─────┬──────┘  └─────────┬──────────┘
      fail /  │ success           │
      timeout │                   │
              ▼                   ▼
     ┌────────────────────────────────────┐
     │ ORCHESTRATOR (evidence only, no AI)│  ◄── call-2 failure degrades
     │ grade capped at the best evidence  │      to evidence-only pricing,
     └──────────────┬─────────────────────┘      NOT to a second engine
                    ▼
                 VAL-001
```

Key properties:

- **Call 1 failure does not run the legacy pipeline.** It returns the
  existing retryable 503 + quota refund. A fast honest failure beats a 42 s
  success.
- **Call 2 failure is not fatal** — the orchestrator still prices from
  evidence, capped at the best *evidence* grade. This is graceful
  degradation, not a fallback engine.
- **Uncertainty is a first-class outcome**, not an error: `NEEDS_USER_INPUT`
  asks for confirmation or another photo.
- **The legacy engine remains fully available behind `RECOGNITION_ENGINE`**
  for rollback and A/B — Decision 3 removes *automatic sequential* fallback,
  not the engine.

---

## 15. Telemetry

Extends the 001 roll-ups; all ride in `ai_raw_response` + the
`openai_experiment_timings` event. **No migration.**

```
recognition_engine, openai_model_call1, openai_model_call2,
call1_ms, call2_ms, retrieval_ms, memory_ms, orchestrator_ms,
val001_ms, persistence_ms, total_ms,
call2_skipped (+reason), fallback_used, vision_used,
identity_confidence, condition_confidence,
pricing_source, pricing_confidence, evidence_kinds[], evidence_count,
disagreement { detected, magnitude, action },
val001_action,
usage { input_tokens, cached_tokens, cache_write_tokens,
        output_tokens, reasoning_tokens }, estimated_cost_usd
```

Preserved from 001: genuine 0 ms stays 0 (`sumMeasured`), external latency
includes the full body read, `vision_ms` remains visible. Never persisted:
secrets, prompts, raw provider payloads, chain-of-thought.

---

## 16. Request / cost model

Per scan, computed from the documented rates and this pipeline's real 1280 px
image (~1,440 image tokens):

| | tokens | $ |
|---|---|---|
| Call 1 — luna, ~1,840 in / ~350 out | | $0.00079 |
| Call 2 — terra, ~1,200 in / ~500 out | | $0.00840 |
| **Total** | | **≈ $0.0092** |
| per 1,000 scans | | ≈ $9.20 |
| per 10,000 scans | | ≈ $92 |

(The earlier $0.0153 figure assumed a larger call-2 output; both are
estimates. **Cost must be computed per scan from `usage.*`**, not from these
numbers — and `reasoning_tokens` are already inside `output_tokens`, so
counting them again double-bills.)

`detail:'high'` caps image input at 3,000 tokens/image regardless of what a
client uploads, bounding a worst case of 180,000 tokens (~$0.036 luna /
$0.36 terra) to a fixed 15,000. **This is a cost and input-bound protection.
It is not a latency improvement** and must not be reported as one.

---

## 17. Security boundaries

Carried from 001, extended for call 2:

- `OPENAI_API_KEY` server-only, never `VITE_*`, never logged/returned/persisted.
- `store: false` on **both** calls.
- `detail: 'high'` — bounds client-controlled cost amplification.
- Upstream errors classified (`classifyOpenAIFailure`); raw bodies never
  persisted or returned.
- **Call 2 receives no image and no raw provider payload** — only extracted
  facts and evidence rows. This is a privacy improvement: the reasoning call
  never sees the photograph.
- **Prompt injection (§38).** Text read off a product is UNTRUSTED. Call 1
  already treats `visible_text` as data to extract. Call 2 is the new risk:
  it receives that text as input. Design: quarantine every model-authored
  and user-authored string in call 2's input behind the existing
  `promptSafe`/fence pattern, and state in the developer message that
  evidence blocks are data and can never alter instructions.
  *(Phase 1 noted `fence()` appears unused in `analyze.js` today — that is a
  pre-existing gap, reported separately, and call 2 must not inherit it.)*
- Auth, quota, rate limits, RLS unchanged.

---

## 18. Feature flags

**Reuse `RECOGNITION_ENGINE`** — no competing flag for the recognition path.

```
RECOGNITION_ENGINE=current   # default, unchanged
RECOGNITION_ENGINE=openai    # full two-call intelligence path
```

**One new flag is justified and requested:** `PRICING_ENGINE=legacy|orchestrator`.
Justification: the orchestrator and the VAL-001 provenance changes must be
independently reversible from recognition. Without it, a pricing regression
forces a rollback of recognition too, and the A/B cannot separate "recognition
got better" from "pricing got better" — which is the distinction §58 requires
for the production decision. Default `legacy`.

---

## 19. Implementation plan (Phase 3, not started)

1. Extend call-1 contract (variant/condition fields). Tests first.
2. `detail: 'high'`.
3. `PricingEvidence` normalizers over existing sources — catalog, memory,
   corrections. Pure functions, no I/O.
4. Orchestrator as a pure module + disagreement engine. Heavy unit tests.
5. Call-2 adapter (text-only, quarantined input, strict schema).
6. VAL-001 additive provenance — **only after the safety review passes**.
7. Migration file authored + reviewed; **executed only on separate approval**.
8. Transaction hook on order completion.
9. Telemetry + benchmark extensions.
10. Full regression + independent reviews.

---

## 20. Risks and unresolved assumptions

| # | Risk | Mitigation / status |
|---|---|---|
| 1 | **~8 s is a projection.** No official latency figures exist for any of these models. | Benchmark only. Never quoted as achieved. |
| 2 | **Two calls double the failure surface** and add a serial dependency. | Call 2 is skippable and non-fatal; evidence-only pricing is the degraded path. |
| 3 | **Call 2 could still self-corroborate** by reasoning from call 1's output, which shares an inference origin. | §7 independence rule: call 1 + call 2 count as ONE source. Needs adversarial review. |
| 4 | **Terra at `low` is unvalidated for this task.** | Smoke test then benchmark. |
| 5 | **Evidence weights are unvalidated.** The base/freshness/√n formula is a reasoned starting point, not a fitted model. | Benchmark measures `dangerous pricing error rate`; weights are tunable data, not logic. |
| 6 | **No market evidence exists yet**, so `market_observed` is an empty tier at launch. | Interface only (§47). |
| 7 | **Transaction volume may be too low** for the flywheel to matter near-term. | Design is cheap and additive; value accrues later. |
| 8 | **Removing Google Vision loses a real OCR fallback.** | Benchmark must measure identity accuracy on weak-text items specifically. |
| 9 | **Cost rises ~7–12×** per scan versus the recognition-only prototype. | Still ≈ ₪0.03–0.06/scan. Flagged, not hidden. |
| 10 | `fence()` unused in `analyze.js` (pre-existing). | Call 2 must not inherit it; reported separately. |

### Decision 2's seven required verifications — where each is addressed

| # | Requirement | Design answer |
|---|---|---|
| 1 | OpenAI cannot self-certify its own price | §6 rule 2 (AI cannot select/widen an envelope); §7 `ai_prior` capped LOW; §7 independence rule |
| 2 | Stale catalog cannot dominate stronger evidence | §6 step 2 freshness decay — automatic, not special-cased |
| 3 | Verified transaction outranks an AI estimate | §7 rank 1 vs rank 5/6 |
| 4 | Sibling contamination fail-closed | §5 `identity_match` from `classifyRowEvidence`; §6 step 1 drops siblings from anchoring; §8 escalation step 2 |
| 5 | Disagreement degrades/escalates, never hidden | §8, always persisted including when it resolves |
| 6 | Category/manual-sensitive protections intact | §12 — envelopes, `manual_only`, spread cap explicitly unchanged |
| 7 | Additive, no expanded unsafe ceilings | §12 — no new ceiling above HIGH, which is today's maximum |

**These are design claims, not verified properties.** They are what the
independent valuation-safety reviewer is being asked to attack.
