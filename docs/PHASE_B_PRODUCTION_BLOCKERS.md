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

## The central architectural finding of this phase — CLOSED

**The blocker.** Phase B could obtain genuine market evidence and compute a
deterministic valuation from it, and `validateQuote` could not recognise that
evidence as market authority. Every priced benchmark was refused with
`V-MARKET-EVIDENCE: market evidence pending`.

That violation never meant "the evidence is weak". It meant **the evidence is
of no class the guard recognises**. The guard's only market-evidence class was
`ANCHOR` — a GetWorth catalog row carrying a price — and §1 forbids OpenAI
output from ever becoming one. Two correct rules composed into a closed door: a
*correct* Phase-B result was unacceptable by construction.

**The fix was not to trust OpenAI more.** It was to give GetWorth a word for
the thing it actually has.

### VERIFIED_MARKET

`api/_lib/market-evidence.js`. A third class, between the two that existed:

| Class | Means |
|---|---|
| `ANCHOR` | GetWorth holds a priced row for this product. |
| `VERIFIED_MARKET` | GetWorth independently validated a quorum of diverse, identity-compatible, priced used listings for it. |
| neither | we are guessing. |

Authority is minted by a private `WeakSet`, exactly as `sealServerAuthority`
mints pricing provenance. A model response containing
`{"evidence_class":"VERIFIED_MARKET"}` is an ordinary object that is not in the
set, so it reads as absent; a real token that is serialised loses its authority,
which is correct, because a value that has crossed the wire is no longer the
object this server minted.

Every qualification check reads data the server can verify for itself — price,
currency, source domain, and the listing **title**. None of it consults the
model's opinion of its own work. `match.confidence` can still *reject* a listing
and can never *admit* one, because an architecture that qualifies on a
model-authored decimal has only moved "trust the model" behind a decimal point.

### What the guard was, and was not, allowed to widen

§11 required an audit rather than a widening. Five decisions ask "do we have an
anchor?"; only two of them were really asking about price evidence.

| Decision | Real question | Widened? |
|---|---|---|
| `resolveValuationVerdict` → PENDING_MARKET | **B** — has anything measured this product's price? | **Yes**, to a new `VERIFIED_MARKET` verdict — never to `ANCHORED` |
| `requiresAnchorAboveSoft` | **B** — is there corroboration for an exceptional number? | **Yes** |
| `bucketEntryPermitted` | A — does GetWorth hold a row for this? | **No** |
| `CATEGORY_WIDENING_EVIDENCE` | A — and about identity, not price | **No** |
| `derivePricingSource` HIGH grade | A — "we hold a priced row" | **No**; own source `verified_market`, grade MEDIUM |

The bucket gate is the one that matters most. `ANCHOR` short-circuits every
entry requirement in the envelope table, so granting it to marketplace listings
would let four Rolex listings open the ₪250,000 `watches:luxury` bucket for a
photographed watch **strap**. `MG-3a` pins that it does not.

### Benchmark outcome

| Benchmark | Admitted / sources | Guard | Status |
|---|---|---|---|
| NINJA | 3 across 2 | `accept` | COMPLETE |
| LOGITECH | 4 across 2 | `accept` | COMPLETE |
| LG | — (no model on the subject) | — | IDENTIFIED_PENDING_MARKET |
| LOUIS VUITTON | 4 across 2 | `degrade` | PRICED_GUARD_WITHHELD |
| UNKNOWN | — | — | IDENTIFIED_PENDING_MARKET |
| NINJA_BLADE | — (query skipped) | — | IDENTIFIED_PENDING_MARKET |

Louis Vuitton is the §34 envelope conflict, **not** an evidence failure: the
second-hand market for that fragrance genuinely exceeds the beauty `hard_max` of
₪1,600. `V-ENVELOPE-BAND` still refuses it and the envelope was not widened. The
conflict remains visible, which is the point.

### Limitations, recorded rather than faked

- **Seller identity** is not exposed by the hosted research mechanism, so
  "same seller, two listings" is undetectable. Domain diversity is the weaker
  property that *can* be verified, and is what is claimed.
- **Transliterated brands** are not matched. A yad2 title reading
  `בלנדר נינג׳ה` names Ninja in Hebrew letters and no deterministic rule here
  recognises it; such listings are held out of the quorum rather than guessed
  at. This costs real evidence — one of the four Ninja comps — and keeps the
  claim true.
- **Used-ness** is not deterministically verifiable from a title. New-retail and
  parts markers subtract; nothing grants "used", and `listing_kind` can only
  reject.
- **The grade ladder has four rungs** and cannot express "measured market
  evidence, but not a catalog row". `verified_market` shares MEDIUM with an
  unanchored `stage2_ai` estimate. They are disjoint by construction —
  `stage2_ai` reaches a price only through category-level BOUNDED, and verified
  market requires product-level recognition — so no scan can be graded by both.
  A fifth rung is a UI change, and is not in scope here.

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
| `market_evidence.accepted` | `price_observations` | Source provenance retained, currency verified, and a GetWorth-side re-fetch. Qualification under `VERIFIED_MARKET` is necessary and **not** sufficient: it establishes the listing is about this product, not that the listing still exists. |
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
- [x] An evidence class for researched market observations — `VERIFIED_MARKET`
- [ ] B-f: seller-level diversity, or a documented acceptance that domain
      diversity is the ceiling
- [ ] A promotion policy that does not exist yet
- [ ] Explicit human authorization

*Last updated: VERIFIED_MARKET authority, from base `500ddcd`.*
