# GetWorth Valuation Architecture

**Status:** VAL-001 (Valuation Safety Foundation) — current state + implemented scope
**Basis:** the completed PRICING-001 architecture review (2026-07-29, 8-agent audit)
**Last updated:** 2026-07-30

This document describes what the valuation subsystem *is*, what VAL-001 changes, and what is
deliberately **not** built yet. Sections describing unbuilt systems are explicitly labelled
**FUTURE STATE** and must not be read as descriptions of shipped behaviour.

---

## 1. Current-state diagnosis

The finding that motivates VAL-001, verified independently rather than assumed:

> **The LLM is the pricing engine on every normal path, and its numeric output is unbounded.**

Between the model's JSON response and the number shown to the user, written to `valuations`,
and appended to shared recognition memory, the only operations are `|| 0`, a multiplication,
and `Math.round`. Concretely, before VAL-001:

| Defect | Evidence |
|---|---|
| No price validation on the primary path | `api/analyze.js` — between `parseJSON` (Stage 2) and the emitted `marketValue`, nothing checks type, sign, magnitude, or ordering |
| Declared schemas were never enforced | `RECOGNITION_SCHEMA` / `VERIFICATION_SCHEMA` had **zero consumers** — exported, never imported. Their price fields declared no bounds anyway |
| The *rescue* path was validated, the *primary* path was not | `preQuoteFromAI` has real numeric gates (`mid > 0`, `mid <= 500_000`, ordering); Stage 2 had none |
| A silent ₪0 was detected and shipped anyway | the debug block computed `silent_fail: price_estimate_mid === 0` and then returned that ₪0 as a `MEDIUM`-confidence estimate |
| Condition was applied twice | Stage 2 is instructed to price at observed condition ("Used items: 40-70% of new Israeli retail depending on condition"); the client then applied a *second* 15/30/70% discount to that same number |
| No determinism controls | no `temperature`/`top_p`/`top_k` on any of the four Anthropic calls |
| Provenance was self-declared by the model | `price_method: 'comp_based'` — chosen by the model — drove the pricing grade, the ledger write, and memory sample provenance |
| Currency was asserted, never checked | the response hardcoded `currency: 'ILS'` regardless of what the model returned |
| Identity confidence was presented as price accuracy | the results screen showed identity `match_confidence` under the label "Scan accuracy", directly beneath the price, while the real pricing grade was computed and deliberately not rendered |
| Zero indexes on `products` | 40 `CREATE INDEX` statements across all migrations, none on `products`; every retrieval predicate is `ILIKE '%…%'` |

Two live security findings sat in the same subsystem (§9).

---

## 2. Architectural invariants

These are the properties VAL-001 establishes. Every one is enforced in code and covered by a
test; a change that breaks one is a regression regardless of intent.

- **I-1 — No unvalidated price escapes.** Every price reaching the client, `valuations`,
  `price_observations`, or recognition memory has passed the single validation choke point.
- **I-2 — The model proposes, the server disposes.** A model output is a *candidate*
  valuation, never an authority. It is bounded, or it is discarded.
- **I-3 — Provenance is derived, never declared.** Pricing source is computed from what the
  pipeline actually observed. The model's `price_method` is recorded as an observation only.
- **I-4 — Condition is applied exactly once.**
- **I-5 — Degradation is deliberate and labelled.** When evidence is insufficient the system
  says so. It never presents a rescue guess with the same confidence as a comp-anchored price.
- **I-6 — Repairs are deterministic, documented, and surfaced.** Nothing is silently fixed;
  every repair is a named rule recorded in metadata.
- **I-7 — Clients cannot author authoritative valuation content.** Users annotate; the
  pipeline asserts.
- **I-8 — Untrusted text is evidence, never instruction.**

---

## 3. Layering: identity → evidence → derivation → presentation

The subsystem has four layers. Most historical defects come from a layer reaching across a
boundary — most visibly, presentation showing an *identity* number as if it were a *derivation*
quality signal.

| Layer | Question it answers | Owns | Must NOT own |
|---|---|---|---|
| **Identity** | *What is this object?* | Stage 1 recognition, OCR, catalog retrieval, Stage 2 verification, `match_confidence` | any price number |
| **Evidence** | *What do we know that bears on its price?* | catalog anchors, category buckets, (FUTURE) comparable sales, recognition memory | deciding the final price |
| **Derivation** | *What price follows from that evidence?* | the validation choke point, envelopes, condition ladder, provenance derivation, degradation | inventing evidence |
| **Presentation** | *How do we say it honestly?* | identification confidence, pricing-evidence band, provenance caption, disclaimers | implying evidence the derivation layer did not have |

**The rule that follows:** identification confidence and pricing confidence are different
quantities, are computed by different layers, and must never share a word, a number, or a
visual treatment.

---

## 4. The evidence ladder (L0–L5)

A shared vocabulary for *how much we actually know* about a price. VAL-001 implements the
rungs that exist; it does not build new ones.

| Rung | Evidence | Status | Grade ceiling |
|---|---|---|---|
| **L0** | Nothing usable | implemented — `manual_required` | MANUAL_REQUIRED |
| **L1** | Category bucket only (`FALLBACK_PRICE_MAP`) | implemented | LOW |
| **L2** | Model's own prior, no anchor (Stage 2 AI estimate, Haiku rescue) | implemented | MEDIUM |
| **L3** | A compatible curated catalog row anchors the price | implemented | MEDIUM–HIGH |
| **L4** | Real comparable *listings* for this identity | **NOT BUILT** — FUTURE STATE | — |
| **L5** | Real comparable *completed sales* | **NOT BUILT** — FUTURE STATE | — |

**This ladder is the central honesty constraint of the product.** GetWorth today tops out at
L3. Nothing in the system observes what an item actually sold for. PRICING-001's central
verdict rests on this: a deterministic rules-engine pricer is not yet justified, because it
presupposes L4/L5 evidence that does not exist. Building it now would produce a temperature-0
LLM clamped to hand-tuned envelopes — possibly less accurate than today.

VAL-001 therefore bounds and labels the L0–L3 system rather than replacing it.

---

## 5. What VAL-001 implements

1. **Runtime model-output validation** — a pure, dependency-free validation module that every
   price passes through, on both the primary and every fallback path.
2. **Deterministic model configuration** — `temperature: 0` on all pricing-relevant calls,
   expressed as a model-coupled constant (§7).
3. **One condition-pricing authority** (§8).
4. **Universal price sanity validation** — finiteness, positivity, ordering, currency,
   integer rounding, spread rules.
5. **Category price envelopes** — conservative, centralized, versioned, derived from evidence
   already in the repository (§6.3).
6. **Honest confidence presentation** — identification confidence and pricing evidence split,
   verbal pricing bands, no false precision (§10).
7. **Quota-RPC security remediation** (§9.1).
8. **Valuation-write security remediation** (§9.2).
9. **Product retrieval indexes** — `pg_trgm`, matched to the actual predicates.
10. **Tests, mutation checks, benchmarks, deployment verification.**
11. **This document.**

### 5.1 How the guard is verified

| Suite | Command | What it establishes |
|---|---|---|
| Contract tests | `npm test` | The guard obeys every rule in §6–§8. Pure; no network, DB, or env. |
| Mutation harness | `npm run test:mutation` | The contract tests actually *enforce* those rules. |

The mutation harness (`tests/mutations/`) breaks one safety rule at a time in a
temp copy of the guard and asserts the contract suite fails. A mutant that
survives is a hole in the tests, not in the guard.

Its first run scored 59.1% and found six real holes — most notably that the
suite re-implemented `conditionDelta` as a local helper and so tested itself
rather than the module, and that a degraded verdict could pass the rejected
price straight through. All six are closed (§H of the suite); the harness now
kills every non-equivalent mutant. Three mutants are marked *equivalent*
(a later rule already rejects the same inputs) with justification and are
excluded from the score — see `tests/mutations/README.md`.

A refactor that moves guard code makes the affected mutants MALFORMED, which
fails the run rather than silently reporting a perfect score.

### 5.2 Explicitly deferred (NOT implemented)

Deferred to PRICING-002 and later, and deliberately absent from this codebase:

sale-outcome collection · chat-offer collection · external market-data ingestion · a rebuilt
`price_observations` ledger · a deterministic valuation core · a comparable-sales engine ·
`product_price_stats` · pricing trends · depreciation curves · seasonality · regional pricing ·
learned pricing models · buyer-side price badges · an evidence dashboard · HNSW indexing ·
table partitioning.

---

## 6. The output-validation boundary

### 6.1 Placement

One choke point, positioned so that a single insertion covers every sink: the HTTP response,
`valuations` (via `record_scan`), `price_observations`, and both recognition-memory writes.

The module is **pure** — no I/O, no network, no clock, no `process.env` — following the
contract already established by `api/_lib/recognition-memory.js`. That makes the entire rule
set unit-testable without touching a paid API or a database.

### 6.2 Verdict model

Validation returns a verdict, it does not throw for data problems:

- **accept** — the quote is within all rules.
- **repair** — a *named, deterministic* rule adjusted a bounding value. `mid` is never moved.
- **degrade** — the quote is discarded and the pipeline falls through to the existing pricing
  rescue engine, terminating at worst in the labelled `manual_required` state.

Every verdict carries metadata: validator version, ruleset version, derived pricing source,
pricing grade, envelope key, degraded flag and reason, applied repairs, recorded violations,
and the model that produced the number.

**Degradation is fail-closed and depth-1.** A rescue quote is validated by the same rules; if
it also degrades, the pipeline substitutes the manual-required state directly rather than
recursing.

### 6.3 Category envelopes

Envelopes are **derived from repository evidence, not invented.** The only per-category price
evidence in the codebase is `FALLBACK_PRICE_MAP` — 39 buckets of Israeli-market used prices
(4 of them deliberately `null`), already tuned by prior SCAN work. Envelopes are computed from
those buckets by fixed multipliers, so the envelope table has exactly one source of truth and
adding a bucket automatically yields an envelope.

Three properties matter more than the specific multipliers:

- **Absurd hallucinations degrade; they are never clamped.** Clamping converts "the model is
  wrong about this item" into "the model is right, at the cap" — a confidently wrong number.
  Degrading routes to a labelled fallback instead.
- **Legitimate high-value items are priced, and flagged.** A soft ceiling lowers the grade and
  sets a review flag rather than rejecting.
- **Categories too broad to bound are `manual_only`** — honouring a decision the codebase
  already made by setting those four buckets to `null`.

Where a compatible catalog anchor exists, an anchor-relative envelope applies and is always
tighter. Its basis is the repository's own stated policy ("Used items: 40-70% of new Israeli
retail"), with headroom for scarcity premiums.

Every envelope assumption is documented in the module beside the number it justifies.
Changing any envelope value requires bumping the ruleset version.

### 6.4 Pricing-source provenance

**The model's `price_method` is not trusted.** Provenance is derived in code from pipeline
facts — principally whether a *compatible* catalog anchor actually existed, using the
retrieval layer's existing compatibility rules rather than a reimplementation.

The model's self-declared method is retained solely as `model_claimed_method`, an observation
for drift measurement. The expected finding — `comp_based` claimed with no compatible anchor
present — is precisely why it is recorded.

---

## 7. Determinism

`temperature: 0` is set on pricing-relevant calls. Two honest qualifications:

1. **This is not byte-for-byte determinism.** The provider does not guarantee identical output
   for identical input. The determinism VAL-001 *does* guarantee is over everything downstream
   of the model: **validation, repair, envelope resolution, provenance derivation, fallback
   selection, condition adjustment, and persistence are deterministic functions of the
   normalized model output.** Equivalent normalized inputs produce identical stored results.
2. **Sampling parameters are model-generation-coupled.** They are accepted by the current model
   generation and **rejected (HTTP 400) by newer ones**. The setting is therefore derived from
   the model constant, in the same block as the model IDs, so a future model migration has one
   place to look.

**Model pinning.** The vision model in use publishes no dated snapshot — the alias is the only
available identifier, so pinning is not an option that exists today. This is recorded, not
solved: alias repointing means silent behavioural drift, which for a valuation product is more
dangerous than a loud 404. Mitigations are behavioural — the model string is recorded in every
persisted scan so a drift event is reconstructable, and determinism makes a golden-set price
regression check meaningful.

Recorded per valuation: perception/model version, validator version, ruleset version, pricing
source, degraded status and reason.

---

## 8. Condition authority

**Decision: Stage 2 remains the condition authority; the client applies a residual delta only.**

Before VAL-001 condition was applied twice: Stage 2 prices at the condition the vision model
observed, then the client re-applied an absolute discount (up to 70%, plus 7% of wear extras)
to that already-adjusted number. Both errors point the same way — systematic underpricing of
the suggested listing price.

The alternative — have the model return a condition-*neutral* base and let code apply the
adjustment — is architecturally where this should end up, and it is **not** the right move
inside a safety task: it changes the meaning of every number the model emits, which invalidates
the evidence base the envelopes are derived from (both `FALLBACK_PRICE_MAP` and catalog average
used prices are *used*-condition prices) and silently re-levels every historical comparison.
Shipping a re-levelling change inside a bounding change would make both unverifiable.

The implemented rule:

- The server emits the condition it priced for (`condition_basis`) and the discount ladder
  itself, versioned under the ruleset version — so the constants have exactly one home.
- The client applies only `ladder[userCondition] − ladder[basis]`, clamped within the validated
  band, so when the user agrees with the observed condition — the common case — the adjustment
  is zero and the double discount is gone.
- **Fail-safe:** if the basis is missing or unmappable, the delta is zero. Condition is applied
  once or not at all; it can never be applied twice.
- Answer-driven wear extras (scratches, declared issues, battery health) remain, because they
  encode information the model never saw. They are additive, not duplicative.

Regression tests prove identical validated input is not discounted twice.

---

## 9. Security boundaries

### 9.1 Quota RPCs

The three scan-quota RPCs were `SECURITY DEFINER` with **no `GRANT`/`REVOKE` and no identity
check**, taking caller-supplied user ids *and* caller-supplied limits. Per the repository's own
established finding, Supabase's default ACLs grant `EXECUTE` directly to `anon` and
`authenticated` at `CREATE` time — so `REVOKE … FROM PUBLIC` alone does not close them.

The exposure was live and worse than the SECURITY-001 order-RPC case: those bodies at least
rejected a null `auth.uid()` before acting. These rejected nothing. The refund RPC alone let any
caller hold their daily counter at zero indefinitely, making the only cost ceiling on the most
expensive path in the product unenforceable.

**Boundary:** the quota RPCs are **server-only**. The pipeline calls them with a service-role
client that carries no end-user JWT, so `auth.uid()` is NULL by construction on that path and
identity cannot be derived inside the function. The correct gate is therefore `service_role`-only
`EXECUTE` — the same shape `record_scan` already uses — combined with server-side authoritative
limits, so a caller can only ever be *more* restrictive than policy, never less.

### 9.2 Valuation writes

`api/confirm-identity.js` documents an anti-forgery invariant: the client sends only a
valuation id, and identity is derived server-side from "the persisted valuation (which the
pipeline wrote with the service role)". That parenthetical was load-bearing and false — RLS on
`valuations` was ownership-only with no column restriction, and the client performs a full-row
upsert it composes itself.

The consequence is a path from *user-authored content* into *shared, cross-user recognition
memory*: forge the AI fields on your own row, confirm it, and the confirmation seeds a memory
row keyed to a fabricated identity, plants its display name, and inflates the confirmation
count that gates human-trusted price samples.

**Boundary, in three layers:**
- Column-level UPDATE privileges restrict clients to the small annotation allowlist —
  fail-closed, so a future column is not writable unless explicitly granted.
- A guard trigger reverts non-allowlisted changes for untrusted callers.
- An `origin` stamp distinguishes pipeline-authored rows from client-inserted ones, and only
  pipeline-authored valuations may seed recognition memory.

**Accepted trade-off:** a scan that genuinely fell back to the client backup path loses its
ability to contribute a memory confirmation. The user keeps the scan; only the shadow-memory
contribution is dropped. That is the fail-closed direction.

**Severity note, stated honestly:** recognition memory is in shadow mode — nothing in it
reaches a prompt or a price today. The damage is *stored*, not *served*. This is a
fix-before-promotion blocker, not a live user-facing exploit.

### 9.3 Prompt-input boundary

Untrusted text reaches the pricing prompt from request-body hints and corrections, the
user's model correction, Stage-1 OCR of the photographed object, third-party vision labels,
and catalog rows. Before VAL-001 every one was raw template interpolation with no type check,
no length cap, no control-character strip, and no fencing.

The sharpest of these is a **stored cross-user channel**: the corrections table was read
*globally, unfiltered by user*, and the twenty newest rows were spliced into every other
user's pricing prompt under a heading instructing the model to learn from them.

**Boundary:** untrusted text is evidence, never instruction. Inputs are type-checked,
length-capped, control-character- and newline-stripped at the API boundary, and fenced in the
prompt with an explicit data-not-instructions framing. Cross-user correction content is scoped
rather than global.

**Note for promotion planning:** cross-user recognition memory does **not** currently reach any
prompt. The moment it does, it becomes an injection path with a persistence multiplier — one
poisoned row affecting every future scanner of that product. The fencing introduced here is
designed with that promotion in mind.

---

## 10. Confidence terminology

Two quantities. They never share a word.

| Term | Means | Form |
|---|---|---|
| **Identification confidence** | how sure we are *what the object is* | numeric % — legitimate, it is a calibrated identity score users act on |
| **Pricing evidence** | how much we had to go on for the *price* | **verbal band only** |

Pricing evidence is verbal because the underlying grade is a four-level ordinal, not a
probability. Rendering it as a percentage would be false precision — the exact defect being
corrected.

| Grade | Band |
|---|---|
| HIGH | Strong pricing evidence |
| MEDIUM | **Limited** pricing evidence |
| LOW | Weak pricing evidence |
| MANUAL_REQUIRED | No pricing evidence |

`MEDIUM` maps to "Limited" deliberately. It is the *default* for any non-comp result — an AI
estimate with no comparable sales. Calling that "moderate confidence" would repeat the original
sin at lower volume. Product should expect a change in tone: most healthy scans will now read
"Limited pricing evidence". That is the honest outcome, not a regression.

Additional rules: provenance captions state what the price actually rests on, including the
degraded states that previously rendered as a healthy "Market estimate"; a standing disclaimer
states the figure is an estimate, not a guaranteed sale price; Hebrew and English carry the
same claim — in particular the accuracy word (`דיוק`) does not survive anywhere near a price.

---

## 11. Retrieval indexes

`products` carried **no indexes at all** while every retrieval strategy filters with
`ILIKE '%…%'`. Trigram (`pg_trgm`) GIN indexes match those predicates directly.

Two honest limits on the win: predicates over *array elements* are not assisted by a
column trigram index, and the vector-similarity path needs its own treatment. Index selection
is proven with query plans rather than assumed, and index choice follows measured plans.

Out of scope here: HNSW, partitioning, new market-data tables, the future pricing ledger.

---

## 12. FUTURE STATE — PRICING-002/003 decision gates

**Everything in this section is unbuilt.** It records the gates PRICING-001 defined so VAL-001
does not accidentally pre-empt them.

**PRICING-002 — close the flywheel.** Record what items actually sell for (sale outcomes, chat
offers) and rebuild the observation ledger with a reader. This is the prerequisite for L4/L5
evidence. Until it ships, no amount of pricing sophistication has anything real to calibrate
against.

**PRICING-003 — shadow core: THE DECISION GATE.** Run a deterministic pricer in shadow and
measure the ladder-level distribution of real scans. The gate:

> If a large share of scans land with **no real comps**, a bounded LLM wins and the
> rules-engine pricer must not be promoted.

VAL-001 is deliberately built to make this measurable — derived provenance, recorded envelope
keys, degradation reasons, and versioned metadata are exactly the instrumentation the gate
needs. **Do not promote a deterministic pricer without running this measurement.**

**Later phases** (conditional on the gate): band-first presentation, market intelligence, scale.

### Follow-ups recorded by VAL-001, deliberately not done here

- Remove the client valuation-backup insert path in favour of a server endpoint, retiring the
  `origin` distinction entirely.
- Bring the corrections table and its RPC under version control and audit its ACL — it is a
  caller-supplied-identity `SECURITY DEFINER` function of exactly the shape the quota RPCs
  turned out to be, and it exists in no migration.
- Reconciliation stance for pre-fix recognition-memory rows, which are indistinguishable from
  legitimate ones. Cheaper to decide before memory leaves shadow mode than after.
- The listing-flow price card presents a figure with no evidence signal, and can render ₪0 in a
  celebratory treatment for a `manual_required` scan — the same class of defect one screen
  later.
- `scan_daily_usage` has no purge job; its cleanup schedule was never applied.

### Follow-ups recorded by UI-003 Wave 0, deliberately not done here

**Gap A — `scan_events.payload.price_mid` is an ungated zero sink.**

- **Location** — `api/analyze.js`, the `logScanEvent(supa, scanUuid, 'scan_analyzed', 'pipeline', …)`
  call: `price_mid: result.marketValue?.mid`, written with no priced/unpriced check.
- **Current behaviour** — `marketValue.mid` is `guardPrices.mid`, a literal `0` whenever the
  VAL-001 guard returns `action:'degrade'`. So every rejected valuation appends a lifecycle
  breadcrumb asserting an observed price of ₪0. This is the same defect class as the
  `observations` sink (fixed in this wave via `observedPriceMid`) and the `new_retail` column
  (fixed in this wave via `positivePriceOrNull`) — Gap A is the one instance left standing,
  by explicit decision, to keep the wave's blast radius bounded.
- **Why it is inert today** — `scan_events` (migration `20260701120000`) is a generic
  append-only debugging log. RLS is admin-SELECT-only; no RPC, view, materialized view or
  aggregate reads it; nothing in `src/` or `api/` reads it back. Its stated purpose is
  reconstructing a single `scan_uuid` for debugging, one row at a time — a read pattern in
  which a stray 0 misleads a human reader but corrupts no computation.
- **What would make it relevant** — GW-009 (the Internal Intelligence Dashboard) is the named
  consumer in the migration header, and any funnel/accuracy metric it computes over
  `payload->>'price_mid'` would silently average these zeros in. Fix it *before* GW-009 reads
  the table, not after: unlike `valuations`, this table has no backfill story, because a
  lifecycle log is not supposed to be rewritten.
- **Shape of the fix** — one line, mirroring the sinks already fixed:
  `price_mid: observedPriceMid(result.marketValue)`, or the guard-side
  `isPricedMarketValue(...) ? result.marketValue.mid : null`. `logScanEvent` already writes
  jsonb, so a null key is a non-event.
