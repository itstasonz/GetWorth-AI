# GW-OPENAI-INTELLIGENCE-002 — Phase 1: read-only audit

Branch: `feat/gw-openai-intelligence-002` (from `feat/gw-openai-recognition-001`)
Audited at: `e8ed93f`. **No code changed in this phase.**

Everything below was read from the repository. Where the ticket's assumptions
and the code disagree, the code wins and the disagreement is called out.

---

## 0. Reconciling the ticket against the repo

| Ticket assumption | Actual state |
|---|---|
| "the current OpenAI recognition prototype" | Exists, on `feat/gw-openai-recognition-001`, **3 commits, not merged to `main`**. This branch continues from it. |
| `RECOGNITION_ENGINE` flag | Exists, defaults `current`, also requires `OPENAI_API_KEY`. **Reuse it** (§34) — no new flag needed for recognition. |
| "database price = truth" is the thing to change | Only partly. The guard does not force a DB anchor; it *grades* provenance. The real constraint is narrower and is described in §4 below. |
| MarketEvidence may need a migration | **No migration needed** for the evidence object itself — see §6. A migration *is* needed for transaction provenance in memory — see §5. |
| Condition answers "did not materially affect valuation" | Confirmed, and worse than stated: **113 questions asked, 3 affect price** — see §3. |

---

## 1. The current scan path, and where the time goes

`POST /api/analyze` → `handler` → `toWebRequest` → `handleRequest`
(`api/analyze.js`, 5.3k lines). One budget clock (`BUDGET_MS = 50_000`,
`maxDuration 60`); stages are **skipped, not truncated**, when budget is tight.

| # | Stage | External call | Cap | Observed |
|---|---|---|---|---|
| 1 | Auth (JWT local HMAC / JWKS) | Supabase JWKS (fallback only) | 5 s | ~1.8–3.1 s cold |
| 2 | Body parse + `validateImages` | — | — | upload-bound |
| 3 | Rate limit / quota | Supabase RPC | 6 s, **fails closed** | ~2–3 s cold |
| 4 | **Stage 1 recognition** | **Anthropic `claude-sonnet-4-6`** | ≤28 s | **~10–16 s** |
| 5 | `calibrateRecognition` | — | sync | — |
| 6 | Google Vision fallback | **Google Vision** (24 h cache, 1500/day) | ≤5 s | ≤5 s when it fires |
| 7 | Query embedding | **Voyage** | ≤3.5 s | — |
| 8 | Retrieval | Supabase, parallel groups | ≤4.5 s | ~0.5–2 s |
| 9 | Fast path *or* **Stage 2** | **Anthropic `claude-sonnet-4-6`** | ≤24 s | **~7–17 s** |
| 10 | Pricing rescue (PRE) | Anthropic `claude-haiku-4-5` | ≤3.5 s | on failure only |
| 11 | **VAL-001** `validateQuote` | — | sync | — |
| 12 | Persistence `record_scan` | Supabase | budget-bounded | — |
| 13 | Derived + memory writes | Supabase RPCs | best-effort | — |

**Three sequential LLM calls in the worst case** (Stage 1 → Stage 2 → PRE),
two in the normal case. **Stage 1 + Stage 2 ≈ 17–33 s of a 21–36 s scan.**
The ticket's framing is correct: retrieval is not the problem, and optimising
it cannot fix the UX.

There is a **fourth** model call outside the scan: `serialOCR: true` is a
separate full `/api/analyze` round trip from the client
(`AppContext.jsx:3855`) that runs `ocrSerialLabel` (Haiku) and returns early.

---

## 2. Pricing authority as it actually works

The ticket's "DB price = truth" framing is not quite what the code does.
`validateQuote` (`api/_lib/valuation-guard.js`) is a **grader**, not a
DB-anchor enforcer. `derivePricingSource` (:302) is the whole authority model:

| Condition | `pricing_source` | grade |
|---|---|---|
| Stage 2 ran **and** a compatible catalog anchor exists | `stage2_comp_anchored` | **HIGH** |
| Stage 2 ran, no anchor | `stage2_ai` | MEDIUM |
| PRE catalog anchor, model evidence | `pre_catalog` | MEDIUM |
| PRE catalog anchor, no model evidence | `pre_catalog` | LOW |
| PRE Haiku | `pre_haiku` | MEDIUM |
| Category bucket | `category_bucket` | LOW |
| Nothing | `manual_required` | MANUAL_REQUIRED |

Then `resolveEnvelope` bounds the number by category (`jewelry` and three
others are `manual_only`), and the spread ratio is capped.

**The real limitation** is not that the DB overrides AI. It is that:

1. **There is no provenance value for memory-backed, transaction-backed or
   market-backed pricing.** The vocabulary above is the complete set. A
   verified completed sale has nowhere to be represented, so it cannot
   outrank anything.
2. **`ctx.anchor` is binary.** The guard asks "is there a compatible catalog
   row" — not "how good, how fresh, how many samples". So a single stale
   catalog row and a well-evidenced one grade identically.
3. **Evidence cannot disagree.** There is exactly one price in, one verdict
   out. No structure can express "AI says ₪1,500, evidence says ₪500".

That is the gap GW-OPENAI-INTELLIGENCE-002 has to fill, and it is additive —
nothing above has to be weakened to fill it.

---

## 3. Condition questions — the §42 defect, quantified

**113 distinct question keys** are defined in
`src/views/SellViews.jsx::getQuestionsForCategory`.

**`calcPrice` (`src/lib/utils.js:191`) reads exactly four**, and only three
change the number:

| Key | Effect |
|---|---|
| `scratches === 'yes'` | −0.02 |
| `issues === 'yes'` | −0.03 |
| `battery === 'poor' / 'degraded'` | −0.02 / −0.01 |
| `deviceType` | **gate only** — decides whether `battery` counts |

So **110 of 113 questions collect answers that cannot move the price.** They
include `authenticity`, `completeness`, `boxPapers`, `screenCond`, `storage`,
`charger`, `warranty`, `workingCond`, `defects` — several of which are
genuinely price-determining in a real second-hand market.

Two further facts:

- **Answers never reach the backend.** The whole condition adjustment happens
  client-side in `calcPrice`. `/api/analyze` never sees them, so they cannot
  inform valuation, memory, or learning.
- **They are persisted** — into `listings.attributes` (JSONB,
  `AppContext.jsx:3248`) — but only at listing time, and nothing reads them
  back for pricing.

The condition ladder itself is sound: `CONDITION_LADDER`
(newSealed 0 / likeNew 0.15 / used 0.30 / poor 0.70), applied as a delta
against the server's `condition_basis`, with an upside clamp to the guard's
`high` and deliberately no downside clamp.

**Implication for this ticket.** The ticket's target flow — *AI pre-fills
everything visible, GetWorth asks only what cannot be inferred* — is
achievable, but the honest starting point is that the current questionnaire
is almost entirely decorative. Per §42 this ticket does **not** redesign it;
it is reported here and recommended as its own piece of work.

---

## 4. What the OpenAI prototype already gives us

`feat/gw-openai-recognition-001` (3 commits) delivers, all reusable:

- `openai-recognition-contract.js` — strict `json_schema`, taxonomy, prompt
- `openai-recognition-normalize.js` — interpretation + the safety rules
- `openai-recognition-tokens.js` — corroboration token helpers
- `openai-recognition.js` — flag, key handling, HTTP, failure classification,
  telemetry shaper
- `runStage1()` engine branch in `analyze.js`, budget-gated fallback
- 50 tests; timing roll-ups; an A/B harness; a catalog-taxonomy pre-check

**Safety properties already established and regression-tested** — §19 of the
ticket asks that these be preserved, and they are all live:

| Protection | Mechanism |
|---|---|
| Self-corroboration | mutual token corroboration; `logos` excluded from model evidence; schema emits text **before** identity |
| Weak OCR | `carriesIdentifyingText` — boilerplate (`CE`, `OK`, `12`) is not evidence |
| Substring/sibling | claim-side strict + entry-side noise-filtered, both directions |
| Model-number evidence | `labels_detected` gated on actual corroboration |
| Speculative brand | `'unidentified'` sentinel keeps runner-ups out of `[0]` |
| Null brand | absence preserved; no placeholder identities |
| Confidence calibration | out-of-range → 0; clamp enforced downstream |
| SCAN-018 | untouched; `gradeRowEvidence` still the retrieval gate |

**This is the single most important input to Phase 2:** the expensive part of
the previous ticket was not the adapter, it was discovering — through four
rounds of adversarial review — the specific ways a vision model's output
launders itself into evidence. Adding *pricing* to the same call puts all of
those at risk again, because a price is another thing the model can assert
and then justify with its own output.

---

## 5. Memory — what exists, and the one hard blocker

`recognition_memory` (`20260707000001`) already covers most of §9: canonical
key + version, brand, model, display names, category/subcategory, `aliases`,
`key_attrs` (JSONB), confirmation/distinct-user/correction/price-sample
counts, `last_price_mid`, `last_verified_price_at`, confidence avg/max,
`recognition_reputation_score`, first/last seen, `origin` (`human` |
`ai_observed`).

`recognition_memory_samples` is the append-only ledger, with `payload jsonb`
(added in 1.1B, documented as ai_observation-only).

**Both `sample_type` and `provenance` are closed CHECK sets:**

```
sample_type: confirmation | valuation_price | manual_listing_price
             | correction | ai_observation
provenance:  stage2_ai | stage2_comp | pre_haiku | memory_stabilized
             | seller | user | ai_scan
```

Mapping the ticket's §10 trust levels onto that:

| §10 level | Available today |
|---|---|
| AI_HYPOTHESIS | ✅ `ai_scan` / `stage2_ai` / `pre_haiku` |
| USER_CONFIRMED | ✅ `sample_type='confirmation'` + `provenance='user'` |
| USER_CORRECTED | ✅ `sample_type='correction'` |
| CATALOG_VERIFIED | ⚠️ partial — `stage2_comp` is comp-derived, not catalog-verified |
| MARKET_OBSERVED | ❌ none |
| **TRANSACTION_VERIFIED** | ❌ **none** |
| ADMIN_VERIFIED | ❌ none |

**This is the one place the ticket's vision genuinely requires a migration.**
The learning flywheel's strongest signal — a completed sale — has no
provenance value, and `recognition_memory_samples` has no JSONB escape hatch
for non-observation rows. The migration would be **additive and
non-destructive** (extend two CHECK constraints), but it is a schema change
and needs explicit approval under §0.

Orders already carry the data: `create_order` copies `listing.price`
server-side and refuses a client-supplied price
(`20260519000003_order_integrity.sql:232`), and `orders.status='completed'`
is lockdown-protected (`20260719000003`). So **transaction evidence is
trustworthy at source** — it simply has nowhere to go.

The flywheel is also already half-wired: `listings.valuation_id` and
`valuations.listing_id` cross-reference (`AppContext.jsx:3282`).

---

## 6. Persistence — what is free, and what is frozen

`record_scan(p_valuation jsonb)` is a **service-role** RPC
(`20260701120000`) that maps named keys into columns. The full result object
rides in **`ai_raw_response jsonb`**.

Against §16's desired pricing fields:

| Field | Home today |
|---|---|
| `price_low/mid/high` | ✅ real columns |
| `estimated_retail_price` | ✅ `new_retail` |
| `recommended_listing_price`, `expected_sale_*`, `quick_sale_price`, `pricing_confidence`, `pricing_provenance`, `pricing_factors`, `pricing_warning`, `needs_review`, `disagreement_state` | ❌ no column — **but all fit in `ai_raw_response` with zero migration** |

And a hard constraint that makes JSONB the right answer rather than merely the
convenient one: **`valuations` is column-frozen**
(`20260730000002_val001_valuations_column_freeze.sql`). `UPDATE` is revoked
from `authenticated` and re-granted on exactly four annotation columns
(`user_confirmed`, `user_correction`, `identified_by`, `listing_id`), backed
by a fail-closed BEFORE UPDATE trigger. Adding real pricing columns would mean
a migration *and* touching that allowlist — i.e. touching VAL-001's
anti-forgery layer. **Do not.**

`price_observations` exists **only in production** — no migration in this repo
creates it (stated at `20260730000004:76`). Its write is already
provenance-gated: `stage2_comp_anchored && !degraded && !needs_review`, with
provenance versioned into the `source` string because there is no column for
it. That string-encoding trick is the precedent for adding new provenance
without a migration.

---

## 7. Answers to the Phase 1 questions

1. **Bottlenecks** — Stage 1 (10–16 s) and Stage 2 (7–17 s). Retrieval is not
   the problem. Cold auth + rate-limit add ~4–6 s before any AI runs.
2. **AI calls** — Stage 1 Sonnet; Stage 2 Sonnet; PRE Haiku on failure;
   Google Vision conditionally; Voyage embedding; plus a separate serial-OCR
   round trip. Up to **three sequential LLM calls** inside one scan.
3. **Pricing authority** — `derivePricingSource` + `resolveEnvelope` +
   spread cap, inside the single `validateQuote` call site.
4. **Memory reads/writes** — read: `memory_lookup` (shadow). Write:
   `memory_append_sample` (price/correction, gated on
   `confirmation_count > 0`), `memory_record_observation` (zero-trust),
   `memory_record_confirmation` (via `api/confirm-identity.js`).
5. **Condition adjustment** — client-side `calcPrice` only; 3 of 113
   questions matter; answers never reach the server.
6. **Fields persisted** — see §6.
7. **Existing prototype** — see §4; fully reusable.
8. **Reusable** — everything in §4, all of retrieval/evidence, VAL-001,
   memory, auth, quota, persistence.
9. **Possibly eliminable, if the benchmark supports it** — Google Vision
   fallback, Stage 2's *identity* half, the separate serial-OCR call. Stage
   2's *pricing* half should become the orchestrator, not disappear.

---

## 7b. The fallback is already a latency trap (§36) — measured

§36 worries that "OpenAI 8 s then the old engine 25 s" produces a terrible
experience. That is **not hypothetical — it is the 001 prototype's current
behaviour.** Replaying `analyze.js`'s own budget arithmetic:

| Scenario | Fallback | Total |
|---|---|---|
| cold preamble, both engines slow | yes, cap 26 s | **~42.5 s** |
| cold preamble, Stage 1 at cap | yes, cap 26 s | ~38.0 s (Stage 2 skipped) |
| very cold preamble (9 s) | yes, cap 21 s | **~42.5 s** |
| warm, both fast | yes, cap 28 s | ~27.0 s |

A fallback scan is **worse than today's 21–36 s**, because it pays the OpenAI
attempt *and* the full existing pipeline. The 001 prototype was right to
prefer fallback over failing (the failures are transient upstream faults), but
that reasoning was about *correctness*, and it was made before latency became
the headline goal.

For contrast, the prize:

| Path | Total |
|---|---|
| OpenAI 4 s + Stage 2 12 s | ~20 s |
| **OpenAI 4 s, Stage 2 eliminated** | **~10 s** |

Two consequences for Phase 2:

1. **Eliminating Stage 2 is where the win actually is** — roughly 10 s of the
   20 s, and it is the difference between "faster" and "fast". A fast Stage 1
   alone gets to ~20 s, which still misses the <8 s P50 target.
2. **The fallback policy must be re-decided under a latency budget, not just
   a correctness one.** Options to weigh in Phase 2: a much shorter OpenAI
   cap (fail fast at ~4–5 s so the fallback still lands inside today's
   envelope); a degraded-but-useful result plus a user prompt instead of a
   full second pipeline; or no fallback at all once the engine is proven, so
   a failure is a fast retryable 503 rather than a 42 s success.

This is the single strongest argument in the audit for why this ticket cannot
stop at "swap Stage 1" — that alone does not reach the product target, and its
failure path regresses.

---

## 7c. OpenAI API research — PENDING

An independent researcher (§48) is verifying, against current official
OpenAI documentation only: available vision model IDs and prices, whether
`reasoning.effort:'none'` is still right once the same call must also do
condition and pricing reasoning, one-call-vs-two, strict-schema size limits,
retention/`store` behaviour, documented prompt-injection guidance, and the
exact usage fields needed to compute per-scan cost from the response.

**Not yet returned. Nothing in this document assumes its outcome**, and the
model choice inherited from the 001 prototype (`gpt-5.6-luna`,
`reasoning.effort:'none'`) is explicitly *unconfirmed for the larger job* —
perception and pricing reasoning are different tasks, and the cheap tier with
reasoning disabled was chosen for the former.

---

## 8. Feasibility verdict for Phase 2

**The architecture can be implemented without destructive change**, with two
qualifications that must be decided before Phase 3:

1. **Transaction provenance needs an additive migration** (two CHECK
   constraints). Everything else fits existing JSONB. Needs approval.
2. **Pricing provenance must be added to `derivePricingSource`**, which is
   VAL-001 code. Per §7 of the ticket this requires an independent
   valuation-safety review before any change. The change is *additive* — new
   sources that can grade HIGH on evidence the current vocabulary cannot
   express — and nothing existing needs to be weakened.

The largest *technical* risk is not integration. It is that the previous
ticket spent four review rounds proving how easily a vision model's own output
becomes "evidence", and **asking the same call for a price adds a second,
higher-stakes thing it can assert and then self-justify.** The pricing path
needs the same adversarial treatment the identity path just received, and the
orchestrator must treat an OpenAI price as one input among several rather than
as a starting point to be adjusted.
