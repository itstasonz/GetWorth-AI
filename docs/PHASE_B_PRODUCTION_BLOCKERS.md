# PHASE B — PRODUCTION ACTIVATION BLOCKERS

**Phase B development: AUTHORIZED and implemented.**
**Phase B production activation: BLOCKED.**

This document exists because §41 requires the unresolved foundation findings to
be *recorded rather than quietly carried*. None of them blocks Phase-B
development; every one of them blocks turning `OPENAI_ENRICHMENT_ENABLED=true`
on in production.

Nothing in this list was fixed while implementing Phase B. §45 is explicit that
an unrelated foundation issue is to be recorded, not turned into another
remediation round.

---

## How to read this

A blocker here means: **if Phase B were switched on in production today, this
defect would still be live on the path Phase B feeds into.** Phase B produces a
read-only candidate, so none of these is currently reachable *through* Phase B —
they become reachable the moment a promotion layer exists, which is why they are
listed against activation rather than against development.

---

## The central architectural finding of this phase

**No Phase-B valuation can be accepted by the GetWorth guard. Not one — and not
because of a defect.**

Every benchmark that produced a price was declined:

| Benchmark | Candidate (₪ low/mid/high) | Guard | Violation |
|---|---|---|---|
| NINJA | 603 / 660 / 755 | `pending` | `V-MARKET-EVIDENCE` |
| LOGITECH | 401 / 437 / 488 | `pending` | `V-MARKET-EVIDENCE` |
| LOUIS VUITTON | 1299 / 1427 / 1618 | `degrade` | `V-ENVELOPE-SOFT`, `V-ENVELOPE-BAND` |

In each case the guard zeroes the displayed prices and returns
`grade: MANUAL_REQUIRED`.

### Why

`V-MARKET-EVIDENCE: market evidence pending` is not saying the evidence is
weak. It is saying the evidence **is of no class the guard recognises**. The
guard's only market-evidence class is `ANCHOR` — a GetWorth catalog row that
carries a price. Phase B never grants `ANCHOR`, by deliberate construction,
because §1 forbids OpenAI output from becoming a trusted catalog anchor.

So the two rules compose into a closed door:

- §1: research-derived comparables may not become an anchor.
- The guard: without an anchor there is no market evidence.
- Therefore: **a correct Phase-B result is, by definition, unacceptable to the
  guard.**

This is the authority boundary working, not failing. Four genuine filtered
used-ILS comparables for the Ninja produced ₪660, and the system still refused
to present it as a value — which is exactly what should happen to a number no
one has yet granted authority to.

### What it means for whoever builds promotion

It cannot be closed by granting `ANCHOR` to Phase-B observations. That is
precisely the move §1 exists to prevent, and doing it would let a single
model-authored listing set a price ceiling.

The real question it forces, and which this phase deliberately does not answer:

> **What evidence class do verified market observations belong to, and what
> does membership in it entitle you to?**

A plausible shape — recorded as a starting point, not a decision:

- a new class (`RESEARCHED_MARKET`) that is weaker than `ANCHOR`
- admissible only with retained source provenance, a verified currency, and a
  GetWorth-side re-fetch that confirms the listing still exists at that price
- entitling a *band*, never a point estimate, and never an envelope override

Until that class exists, `PRICED_GUARD_WITHHELD` is the honest terminal state
for a successful Phase-B scan, and the pipeline reports it by that name rather
than collapsing it into "identity only".

### The Louis Vuitton case is a different failure, and also correct

`V-ENVELOPE-BAND: displayed high 1618 > hard_max 1600 (beauty/category)` is the
§34 conflict arriving on schedule. The second-hand market for that fragrance is
genuinely around ₪1,300–1,600; the beauty envelope caps at ₪1,600. Phase B did
not widen the envelope and must not. Recorded for calibration review.

---

## CRITICAL

### C-1 · Logo carve-out re-opens the H-6 accessory witness
**Where:** `api/_lib/pricing-authority.js` — `classifiedLines` appends
`visionData.logos` outside the `subjectLinesPermitted` gate.
**Witness:** block `"Silicone Case / for Apple iPhone 15 Pro Max / Device not included"`
with `logos:['Apple']` yields `OBJECT_CLASS, BRAND_TEXT, DERIVED` and grants
`electronics:iphone` / `macbook` / `ipad` — ₪24,000 instead of ₪6,400.
**Note:** I documented this carve-out as safe in `R6-1g`. That was wrong.
`ocr_context.logo_boxes` is captured and consumed by nobody, so the geometry
needed to distinguish a logo *on the object* from a logo *inside the
compatibility sentence* already exists and is unused.

### C-2 · `watches:luxury` — unlisted languages reach ₪250,000
**Where:** the compatibility-marker vocabulary in `api/_lib/pricing-authority.js`.
**Witness:** `"για\nROLEX SUBMARINER"`, `"ile uyumlu\n…"`, `"สายสำรองสำหรับ\n…"` —
12 unlisted languages plus every scriptio-continua script outside the four the
CJK containment rule names.
**Partially mitigated in round 6:** `OBJECT_CLASS` was added to
`watches:luxury`. Measured effect: it closes only the *no-classifier* case. A
strap photo labelled `['Strap','Watch accessory']` still reaches ₪250,000,
because of REC7-H1 below. **The two findings compose.**

### C-3 · S1-H2 — a rule below module scope is unobservable
**Where:** `tests/helpers/authority-inventory.mjs`; recorded live as `PC-6f`.
**Witness:** a rule installed lazily from inside a function body (`a8`) changes
what the provider scanner answers and produces **zero** mechanisms. A rule on an
intrinsic rather than `globalThis` (`a7`) does the same.
**What closes it:** statement-level mutation coverage of the security module,
function bodies included. Not attempted.

---

## HIGH

### H-1 · REC7-H1 — `OBJECT_CLASS` is presence-only
`bucketEntryPermitted` checks that the class is PRESENT, never what the
classifier said. A Vision label of `"Banana"` satisfies
`electronics:smartphone` (6,400 → 9,600; with `subcategory:'laptop'`, 24,000).
`object_class_tokens` is produced by `deriveEvidence` and read by **nobody** —
the sixth "rule with no reachable input" in this work. Live witness: `E6-4`.
**This blocks the repair of C-2.**

### H-2 · `pricing_status` is the model's word
`api/analyze.js` — on the normal Stage-2 path nothing seals `_pricing_meta`, so
`readServerAuthority(...)` is null and the value falls through to
`verification.price_method`, an allowlisted schema field. The client maps
`db_based` to *"based on comparable sales"*. Found by the valuation review.

### H-3 · `authenticity_assessment` moves the shipped price by up to 85%
`api/analyze.js:3353,3358,3582-3586`. The comment at `api/analyze.js:706`
asserting this field carries no pricing authority **is false**; I wrote it.
§19 requires Phase B not to worsen this, and it does not: Phase B's condition
stage emits an *observation* from a closed enum with no "authentic" value, and
that observation reaches no pricing path.

### H-4 · Over-suppression — the block is the whole photograph
`fullBlock = textAnnotations[0].description` is Vision's text for the entire
image, so one "for" anywhere in frame destroys all text identity for a genuine
item: `"ROLEX / OYSTER PERPETUAL / SUBMARINER / Thank you for shopping"` →
`DERIVED`. Needs spatial scoping; that is a recognition redesign.

### H-5 · S1-H3 — equivalence markers are unchecked claims
`EQUIVALENT 3` in the guard harness rests on hand-written sentences. One
(`P01`) **already went stale during round 6**, was reported KILLED, and was
withdrawn — caught only because that mutant happened to become killable.
`behaviourFingerprint` is the substrate for a real check; it needs a guard-input
corpus that does not exist.

### H-6 · S-2 runtime-surface silent misses
Absent from `modules`, `unscannable` **and** `unresolved`: legacy `vercel.json`
`builds` root; junctioned/symlinked directory under a function root; `Worker` and
`child_process.fork` entrypoints; anything under `api/build|dist|coverage`; root
`middleware.js`; and any extension in neither runtime list (`.sh`, `.wasm`,
`.java`). The last is the S-1 enumeration failure reproduced inside S-2's
refusal and wants the same polarity inversion.

---

## Phase-B-specific items — not blockers, but must be closed before activation

| # | Item | Why it is not a blocker today |
|---|---|---|
| B-a | `existing_recognition` / `existing_ocr` arrive from the client | They are hints only, fenced as untrusted, and never read as evidence classes. §3 prefers server-side reconstruction from `scan_uuid`; that needs a read path this phase does not build. |
| B-b | No verified FX mechanism | Foreign-currency observations are held as `context_only` and excluded from ILS calculation (§17). Activating international evidence requires a real rate source with timestamp and provenance. |
| B-c | No quota/billing policy | §26 asks only for an accounting boundary in this phase; the call ledger provides it. A customer-facing charging policy is out of scope. |
| B-d | Market mechanism is a single hosted tool | Isolated behind `marketResearch.search(query)` (§14), so replacing it is a one-file change — but it has never been exercised against live results. |
| B-e | Latency is unmeasured against a real provider | All timings so far are mocked. §25 requires measured timing before any decision about a synchronous vs async contract. |

---

## What Phase B would be allowed to promote later, and under whose authority

§24 asks this to be documented now and implemented never (in this phase).

| Candidate field | Could eventually promote to | Required authority |
|---|---|---|
| `identity_candidate.subject` | `recognition_memory` | User confirmation **or** `corroboration.level === READ_OFF_ITEM` **and** a catalog row agreeing |
| `identity_candidate.identifiers` | `product_candidates` | Human review — an MPN is a durable claim |
| `market_evidence.accepted` | `price_observations` | Source provenance retained, currency verified, and a GetWorth-side re-fetch |
| `condition_candidate` | nothing | Per-scan, not per-product; never a durable fact |
| `valuation_candidate` | nothing | A derived number, recomputable from the observations |

The rule this table encodes: **GetWorth learns from validated scans, not from
everything OpenAI ever said.**

---

## Activation checklist

Production activation requires **all** of:

- [ ] CRITICAL C-1, C-2, C-3 closed
- [ ] HIGH H-1 … H-6 closed
- [ ] B-a: server-side scan-context reconstruction
- [ ] B-b: verified FX, or international evidence permanently context-only
- [ ] Live latency measured; synchronous vs async contract decided (§25)
- [ ] An evidence class for researched market observations (see "The central
architectural finding") — without it no Phase-B result can ever be shown
- [ ] A promotion policy that does not exist yet
- [ ] Explicit human authorization

*Last updated: Phase B implementation, from base `500ddcd`.*
