# GW-OPENAI-INTELLIGENCE-002 — REV-4 architecture + foundation record

**Status:** foundation round 3 implemented — see §6. **PHASE 3 = NOT APPROVED.**
No OpenAI key requested, no live OpenAI call made, nothing deployed, no migration.

REV-1, REV-2 and REV-3 contain rejected assumptions and are superseded by this
document for anything they disagree about. This file records two things: the
architecture decisions that survived four independent reviews, and the live
defects those reviews exposed — which are now fixed, because Phase 3 could not
safely be built on top of them.

---

## 1. Architecture — TWO-PHASE

The single-request design in the earlier revisions does not fit and cannot be
made to fit. The measured budget at `f4445b7`: p50 already sits at ~45–50 s of a
50 s ceiling, Stage 1 is attested at 15–25 s and Stage 2 at 18–20 s, and with
Stage 1 at 20 s `stage2Cap` computes *below* Stage 2's own empirical need. There
is no slack to reallocate. Identity research plus market research plus condition
plus grading plus fusion adds an estimated +36 s to +93 s.

`waitUntil()` is not available — `@vercel/functions` is not a dependency, and
`api/analyze.js` says so at the persistence tail. So Phase B cannot be
fire-and-forget.

```
PHASE A — POST /api/analyze                    (exists, ≤50 s, unchanged shape)
  photo(s) → identity → GetWorth DB/memory as EVIDENCE → visible condition
           → valuation guard → result + scan_uuid + "enrichment available"
  MUST NOT wait for external market research.

PHASE B — POST /api/enrich                     (FUTURE — not built)
  scan_uuid → market evidence → currency normalisation → comparable grading
            → outlier rejection → distribution → re-run the guard
            → persist safe observations → revised valuation
  Separate provider ledger · budget · quota/cost policy · observability.
```

Phase B is client-polled or queue-driven. It reads the persisted valuation and
writes a **revision**; it never bypasses `validateQuote`.

## 2. Market access — an INTERFACE, not a vendor

Not hard-wired to hosted OpenAI `web_search`, and not hard-wired to marketplace
APIs either.

```
searchMarket({ identity, variant, condition, market, currency }) → Comparable[]
```

Adapters are chosen later and may include marketplace APIs, Israeli
retail/search sources, cached GetWorth observations, approved search providers,
or — only if separately approved — a controlled OpenAI web-search fallback.

**The model produces structured search INTENT. GetWorth controls retrieval.**
OpenAI never decides which URL GetWorth fetches. This is the control that
collapses both the SSRF surface and the "untrusted page content enters the
provider's context where we cannot sanitise it" problem at once.

Two facts that constrain any hosted-search adapter, both doc-confirmed:
`web_search` bills **per `web_search_call`**, many per HTTP request, at
$10/1k calls plus search tokens — roughly 30–40× the current per-scan AI cost;
and OpenAI publishes no latency figures, so no budget may assume one.

## 3. What the foundation fixed, and why it had to come first

Four independent reviews returned 3 CRITICAL and ~14 HIGH against the REV-4
design. The subset that was **live in production, independent of Phase B**, is
fixed here. Each was a way of pricing something GetWorth had not identified.

### The Ninja case

A real scan: Stage 1 category "Other" 10%, brand none, model none, OCR empty;
Stage 2 "unidentified unidentified / Footwear", 28%; price ₪30/₪70/₪130.

Every numeric rule passed, because ₪70 is plausible for *something*. The guard
had no rule asking whether there was a PRODUCT to attach a number to:
`validateQuote` never read `category_confidence`, and `resolveEnvelopeKey` reads
category *strings*, which "Footwear" satisfies without being a GetWorth category
at all. It then fell through to `GLOBAL_ENVELOPE` — floor 5 / soft 20,000 /
hard 500,000, **the loosest bounds in the system, handed to the
least-identified item in the system.**

### Rules added

| Rule | Property |
|---|---|
| `V-IDENTITY-FLOOR` | No meaningful identity ⇒ no product-specific price. Tiers: EXACT_MODEL / FAMILY / BRAND_ONLY / CATEGORY_ONLY / UNIDENTIFIED. CATEGORY_ONLY additionally requires a *priced* category bucket — a confident string for a category we hold no evidence for is not evidence. |
| global-envelope inversion | A non-confirmed identity falling through to no bucket now gets `MANUAL_ONLY` (5/1000/2000), not `GLOBAL_ENVELOPE`. Unknown narrows capability; it does not expand it. |
| `V-ENVELOPE-BAND` | The whole **displayed** distribution fits the envelope. Previously only `mid` was bounded, so `high` could legally reach **6× `hard_max`** via `SPREAD_MAX_WEAK`. Tolerable while `high` was a fuzzy edge; not tolerable once it is surfaced as `optimistic_listing`. |
| `V-SOURCE-UNREGISTERED` | A `MANUAL_REQUIRED` grade refuses the **number**, not just the label. An unregistered `pre_source` previously graded MANUAL_REQUIRED *and shipped a price*. |
| `V-FX` | Money without a proven conversion never contributes. ISO currency required; non-ILS requires `fx_rate` / `normalized_amount` / `normalized_currency` / `fx_timestamp` / `fx_source`, and the arithmetic must be self-consistent. **No live FX is implemented.** |
| envelope input trust | `resolveEnvelopeKey` resolves twice and keeps the lower ceiling, so photographed label text may **narrow** the envelope and never widen it. Writing "macbook" on a sticker used to move the ceiling to ₪40,000. |
| variant contradiction | An anchor whose storage / volume / size / generation token contradicts the item no longer sets the envelope. |
| `pre_haiku` MEDIUM → LOW | An unanchored model estimate no longer outranks a real compatible catalog row. |

**The LLM cannot buy eligibility with confidence.** The inputs are candidate
strings and strict booleans, not self-reported certainty. Adversarial probing
found five ways around the first draft — an out-of-range confidence, a
non-number confidence, an absent or array identity, a truthy-string `brandOk`,
and a caller-supplied `envelope_key` that answered the identity question — all
closed and pinned as tests.

### Verification artefacts repaired

- **SEC-2** — the round-9 provider inventory scanned only `api/analyze.js`, so
  `api.openai.com` in `api/_lib/` was invisible to every ordering and vacuity
  test while they reported green. The scan now discovers every module under
  `api/`. Mutation-proven: a provider in a new module fails the guard by name
  and file.
- **SEC-9** — the refund harness answered any unmodelled host `200 []`.
  `generateQueryEmbedding@api.voyageai.com` was inventoried as covered, had no
  bucket, and was stubbed-green across all 50 passing tests. Voyage now has a
  bucket; unknown external hosts throw.
- **SEC-1** — `externalResearchAttempted` records the Phase-B refund invariant:
  once an external research action has been *attempted*, the request is not
  refundable, because hosted tools bill before any response exists and
  `providerConsumed` cannot witness the spend. **Nothing sets it yet**; it
  exists so Phase B cannot silently inherit Phase A semantics.
- **VAL-001 harness** — reported a false 66.7% with "the guard was refactored"
  for four months. The real cause was a CRLF working tree against LF `find`
  strings. Fixed at the source read plus `.gitattributes`; now 27/27, and the
  misleading diagnosis is gone.

### Prepared, deliberately NOT wired

`webSafe()` / `webSafeBlock()` / `MARKET_UNTRUSTED` fence / `MARKET_FENCE_RULE`.
NFKC runs **before** the strip, which closes fullwidth `＜＞` fence forgery as a
side effect. C1, U+0085, all `Cf` and TAG characters are dropped — every one of
which `promptSafe` passes verbatim today, and which are LOW *only* because
`PROMPT_STR_MAX` is 120. Raising that cap for long-form market content would
escalate all three at once, so market content gets its own function rather than
a bigger cap. A test pins them unwired; if it fails, Phase B is live and the
whole boundary must be re-verified against a real sink.

## 4. Known gaps — recorded, NOT fixed here

- **The recognition path is unchanged.** All three missing object-class floors
  remain: no score floor on Vision labels (while `webEntities` are filtered at
  0.5), no signal-class ranking in the Stage-2 prompt, and `final_category` is a
  free-form string with no enum. The guard now refuses to *price* the Ninja
  shape; it does not stop a wrong *category* being displayed.
- **`beauty` envelope is too tight for luxury fragrance** (soft 500 / hard 1600
  against a ₪1,100+ real market). Deliberately not widened here: doing so is a
  pricing change, not a safety fix.
- **No currency conversion module.** `V-FX` refuses unproven money; it does not
  convert.
- **No variant channel beyond the anchor check.** Variant, capacity, storage,
  generation and dimensions still have no structured home. That belongs with the
  Phase-B identity object, where it will have consumers.
- **`api/analyze.js` is ~6,100 lines**, against the repo's own 500-line rule.
  Phase B must not add to it; `createProviderLedger` / `isRefundEligible` /
  `REFUNDABLE_FAILURE_KINDS` need extracting so two endpoints share one policy
  rather than duplicating it.

## 4b. Foundation round 2 — the six HIGH findings, closed

Round 1 left six HIGH findings open and they were the gate. Each is recorded
here as property → producer → consumer → effect → witness → test → mutation,
because "a test is green" is not what closed any of them.

### HIGH-1 — a swallowed unknown host no longer passes

The harness could throw for an unmodelled host, but the throw was raised inside
production's own call stack, so any `try/catch` ate it and the test still went
green. A guard whose only signal is an exception is a guard the code under test
gets to veto — and every real fallback branch in `api/analyze.js` is a catch.

The record now leaves before production can act on it, and `run()` reads it
**after** the handler returns. Six witnesses: the error propagating, the error
swallowed by a catch, a host reached only on a fallback branch, and a host
attempted during a request that then fails. **Negative control:** disabling the
post-handler check turns four of them red — including the propagating case,
which was invisible too.

`allowUnknownHosts` exists only to prove the mechanism works, and a test asserts
it appears in no other file.

### HIGH-2 — discovery that can find what it has not been told about

Three holes with one shape, all of them searching for what was already known:
four hard-coded host strings, so a fifth vendor matched nothing; `.js` and
`.mjs` only; and no notion at all of a host assembled at runtime.

`tests/helpers/provider-scan.mjs` lexes with string bodies **kept** and comments
dropped — the mirror image of the reachability mask, which would blank the thing
being looked for. It reports hosts it has never heard of and **refuses** four
shapes it cannot resolve: interpolated authority, concatenated authority,
variable base, non-literal target. A truncated `https://api.` is refused too;
reporting it as the host `api.` is a false resolution, which is worse than none.

| Mutation | Caught by |
|---|---|
| provider in a new `.cjs` module | STATIC — extension set |
| provider in a new `.ts` module | STATIC — extension set |
| concatenated hostname | STATIC — refused as unresolvable |
| imported hostname constant | STATIC — twice: literal at the declaration, unresolvable target at the consumer |
| interpolated authority | STATIC — refused as unresolvable |
| anything the above cannot see | RUNTIME — HIGH-1's out-of-band record |

Static analysis cannot be complete, so the runtime record is **named** as the
backstop rather than left as an implication. The refund cross-product's comment
claimed a completeness it never had; it does ledger attribution for known
providers and now says so.

My own lexer reproduced the runaway it was written to fix — a single depth
counter never balanced a nested template, it ran off the end of the prompt
builders, and it found **zero** provider hosts in `analyze.js` while passing.
PD-9 pins it by line coverage.

### HIGH-3 — a model may suggest a category, it may not invent one

The taxonomy existed in **four** places that had already drifted: the OpenAI
contract enforced 16 values as a JSON enum; the Stage-1 prompt named 14 of them
in prose and enforced nothing; the valuation guard matched substrings of
whatever arrived and chose a **price** from them; and the client relabelled the
answer against a fifth list containing "Music", which is in no server list,
while dropping Smoking, Bags and Jewelry, which are. A handbag the server
categorised correctly was written to a listing row as "Other".

`api/_lib/category.js` is the one definition. Canonical accepted, known alias
mapped, anything else `Other` — which owns no envelope. Applied at
`calibrateRecognition` and `calibrateVerification`, the two points every engine
and every fallback pass through. `category_raw` keeps the original as evidence;
`category_basis` records whether the value was registered, mapped or refused, so
a guessed category is auditable as a guess.

**The alias table is constrained by a property, not by judgement.** CB-12
asserts the narrow-only rule: normalisation may tighten a bucket or drop it, and
may never hand a string one it did not have. That deleted three aliases —
`backpack`, `automotive`, `kitchen` — and the first draft was worse: it mapped
"Footwear" to Clothing and "Luxury Gaming Appliance" to Home, the reviewer's own
two witnesses, handing each an envelope it had never had. CB-12b enumerates the
two narrowings that do occur, including the one that costs something.

The guard now prices from the category the client is shown. It read Stage 1's
while the client was shown Stage 2's, and Stage 2 exists in order to disagree.

### HIGH-4 — OCR is evidence, not truth, and the candidates are OCR too

`resolveEnvelopeKey` resolves twice and keeps the lower ceiling. Both passes
read `brand_candidates` and `model_candidates`, which **are** photographed text
distilled by Stage 1 into a different field name.

The naive fix is a pricing regression, and it was written first: resolving
without the read-derived candidates caps every iPhone at the generic electronics
ceiling of ₪6,400, because specific envelopes are looser than their parents on
purpose. E-06 caught it. So the escalation is permitted and made **conditional**
— when the only reason a looser bucket was selected is a value read off the
item, everything above its `soft_max` requires an **anchor**.

Stated plainly: this does **not** lower the Rolex witness's 250,000 ceiling.
`watches:luxury` already carried `requiresAnchorAboveSoft`, which is why the
review rated it HIGH and not CRITICAL. What changes is that the bound now
follows from how the identity was obtained, so a bucket added tomorrow without
the flag inherits it.

`evidenceClass` fails closed: `evidence` is free-form model output, so an
unrecognised value counts as read-off-the-item. Only shape, silhouette, form and
colour may widen. OI-7 proves the three priceable cases are untouched as a
property — strip their candidates and their OCR entirely and all three resolve
to the same bucket; the Rolex witness collapses to 6,400.

**The "duo" class, closed — reversing an earlier decision.**
`isSpecificTokenMatch` ended `return sameModelString(row.model, tok)`, so with
no brand recognised anywhere, a plain English word read off the item made a
catalog row EXACT evidence. C-05 asserted that deliberately as "the conservative
fallback"; it was conservative relative to substring matching, not in absolute
terms. A model-shaped token still identifies without a brand, so C-03 stands.

The cross-brand collision is bounded where it becomes money, not where it
becomes a token: `isCompatibleAnchor` refuses a cross-brand row as an anchor,
and OI-12 asserts that bound instead of assuming it.

### HIGH-5 — one prompt trust boundary, importable by both endpoints

`api/_lib/prompt-trust.js` holds §0.9 and §0.95 verbatim. Scope is deliberately
narrow: it is not a utilities module.

The extraction is proven, not asserted. 16 prompts built from hostile inputs —
control characters, forged fence tokens, a coercion bomb, a fullwidth SYSTEM
header — were rendered and hashed before the move and byte-compared after.
Identical, all 16.

Two verification artefacts had to follow the code. The sanitizer mutation
harness read one file, so 14 of 18 primitives reported "find matched 0x"; it now
mutates whichever file holds the code and repoints the analyze copy's import at
the trust copy. The unwired tripwire spans both files and every other module
under `api/`, because after the extraction a second endpoint *can* wire it.

I introduced a false oracle while writing this and caught it in the mutation
output: PI-41b asserted the exact import path, which the harness rewrites, so it
failed under **every** mutant and the run reported 69/69 killed. A universal
killer would have reported a genuine survivor as dead. Fixed; the run returns to
68/68 with the one known equivalent.

### HIGH-6 — the three recognition floors

| Floor | Witness | Root cause | Fix |
|---|---|---|---|
| **A** no score floor on Vision labels | "Footwear" 44% and "Ballet shoe" 12% reaching Stage 2 beside a 97% reading; a 2% Apple logo beside a 94% Logitech | `parseVisionResponse` filtered `webEntities` at 0.5 and applied no floor to `labels` or `logos` — three sibling fields, one rule, applied to one | `VISION_SIGNAL_FLOOR = 0.5` on all three; `ocr_context` stays unfiltered because it feeds no decision |
| **B** no signal-class ranking in the prompt | the same Ninja category, taken from a label | the rules said what to do when signals agree, never what each class IS | an explicit ranked list, TEXT > LOGO > LABEL > WEB ENTITY, with what each may not establish |
| **C** `final_category` free-form | "Footwear" displayed for a blender | `{ type: 'string' }`, and four disagreeing taxonomies | HIGH-3 |

**The matrix.** 17,920 generated states across brand evidence, model evidence,
category evidence, recognition state, confidence and pricing source. 6,912
priced, 11,008 refused — a split that is itself asserted, because a matrix where
everything is priced and one where nothing is prove the same amount. Eight
invariants hold over all of it. Two mutants confirm it observes rather than
decorates: making every scan EXACT_MODEL turns SM-7 red, restoring the LOW grade
for an unrecognised stage turns SM-3 red.

## 4c. Fixed in the same change, same root class

- **An unrecognised `stage` still priced.** `derivePricingSource` failed closed
  on an unregistered `pre_source` and then, three statements later, returned
  `LOW` for an unrecognised stage and priced it. One doctrine, one module, one
  branch applied and one not. Carried as a MEDIUM; it is the same root class as
  the HIGH above it.
- **The anchor gate threw on a catalog row it could not coerce.**
  `[row.model, row.name, ...row.aliases].join(' ')` invokes ToPrimitive on every
  element, and `isCompatibleAnchor` runs at `guardCtx` anchor resolution — so the
  throw landed inside the valuation guard's own input path. The round-3 refund
  DoS class verbatim. Found by the rendered-prompt fixtures, not by review.

## 4d. Still open — MEDIUM, recorded for the next ticket

- `low` has no floor — 8,822 accepted cases below it, worst 0.40×.
- `variantContradiction` false positive: `27"` and `27 inch` are different
  tokens, so the same TV contradicts itself and the envelope widens.
- V-FX coerces money (`Number("3.7")`) and never validates the amount behind an
  ILS comp.
- Category ambiguity resolves by alias order: a string naming two categories
  takes the first match. A documented guess, pinned by CB-9b. Refusing it would
  narrow an envelope the raw string selects today, and a pricing change does not
  belong in a normalisation boundary.
- Dropping the `kitchen` alias means a "Kitchen" scan whose subcategory already
  reads as an appliance loses its bucket. Safe direction, real cost, enumerated
  in CB-12b.
- The `beauty` envelope is too tight for luxury fragrance (soft 500 / hard 1600
  against a ₪1,100+ real market). Widening it is a pricing change, not a safety
  fix.
- `api/analyze.js` is ~6,200 lines against the repo's own 500-line rule. The
  provider ledger still needs extracting before `/api/enrich` exists.

## 5. Acceptance criteria before Phase 3

1. The mechanism is chosen and its adapter contract written against §2.
2. Phase B lands as `/api/enrich`, never inside `/api/analyze`.
3. The ledger is extracted; Phase B does not duplicate refund policy.
4. `webSafe` is wired with the `MARKET_UNTRUSTED` fence, and the tripwire test
   is replaced with live-sink assertions.
5. A currency module exists; `V-FX` has something real to validate.
6. Comparable grading is deterministic in GetWorth code — `mid` is a robust
   statistic computed by us, never a number the model emits — with a domain
   allowlist, dedupe-before-quorum, and web comps that may only **narrow** an
   envelope and may never occupy `ctx.anchor`.
7. All four reviews return no CRITICAL and no HIGH.

---

## 6. FOUNDATION ROUND 3 — the trust model, repaired

Round 2 closed two CRITICALs and left six HIGHs. This round closes all six plus the
four findings the round-2 recovery added. Each is recorded as property → witness →
fix → what the fix does NOT do.

### 6.1 The verification system came first (N-3)

`npm run test:mutation` **exited 1**. 27 UI mutants reported MALFORMED, and the
harness blamed the catalog: "the guard was refactored; re-pin these."

Root cause, two halves, both the same shape as every other finding here — a rule
stated in general terms and applied to one of the places it names:

```
tests/mutations/run.mjs            normalised at the source read   OK (round 9)
tests/mutations/ui-run.mjs         raw                             27 MALFORMED
tests/mutations/sanitizer-run.mjs  raw                             green by accident

git ls-files --eol   i/lf  w/crlf  attr/text eol=lf   x 385 files
```

`.gitattributes` declared `eol=lf` and the working tree had never been
renormalised, so the attribute described a checkout nobody had. `sanitizer-run.mjs`
passed only because its two targets happened to be LF — an accident of file
history, not a property.

Fixed by `tests/mutations/read-source.mjs`: one reader, three callers. The tree was
renormalised (385 files, **0 lines added, 0 removed**), and NO-3c asserts the
declared policy against the files on disk so the two cannot diverge again.

**The gate also got wider.** `run.mjs` ran one suite; it now runs all three that
speak for the guard, and mutants may target `api/_lib/pricing-authority.js` as
well. A mutation score is only as wide as the files it can damage.

### 6.2 Evidence provenance replaces self-assessment (§3, R2-H2)

**Witness.** Zero identity evidence — no brand candidate, no model candidate, no
OCR, no classifier. One free-form string:

```
subcategory: (none)     -> electronics          hard  6,400   ILS 20,000 refused
subcategory: 'laptop'   -> electronics:laptop   hard 24,000   ILS 20,000 ACCEPTED
```

**Twelve** buckets exceed their parent's ceiling. The round-2 record said four,
because somebody counted them by hand; nothing counts them by hand now.

Two previous attempts were withdrawn for asking the model how sure it was, in
different words. This one asks **who produced the evidence**:

| class | established by | forgeable by a sticker? |
|---|---|---|
| `ANCHOR` | a compatible GetWorth catalog row | no |
| `OBJECT_CLASS` | a classifier's verdict, at the recognition floor | no |
| `BRAND_TEXT` | the brand string **occurring in text read off the item** | yes — by design |
| `PRODUCT_TEXT` | the model string, same test | yes — by design |
| `DERIVED` | anything a stage wrote | trivially |

`BRAND_TEXT` being attacker-reachable is the point: printing ROLEX on a watch *is*
that evidence class. The protection is that no bucket above its parent accepts text
alone — `watches:luxury` wants both text classes, the electronics buckets want
`OBJECT_CLASS`, and `requiresAnchorAboveSoft` still applies on top.

**What it does NOT do.** It does not lower any ceiling, and it does not refuse the
ILS 12,000 laptop that withdrew the previous attempt — a laptop a classifier *saw*
still prices and still flags. What changed is that a laptop nobody saw gets the
parent envelope.

**Fail-closed by construction.** A bucket wider than its parent and not declared is
UNSATISFIABLE — unreachable, not permitted. That branch had **no reachable input**
in the real table and a mutant proved it; `bucketEntryRequirement` now takes an
envelope table so a synthetic undeclared bucket can be observed. Fifth "rule with
no reachable input" in this work, and the first found by a mutation run rather than
by a reviewer.

### 6.3 Category authority is monotone in ceilings (§4, R2-H3)

The paperback, end to end: Stage 1 `Books` (hard 480), Stage 2 asking ILS 4,000.

```
final_category Books | Electronics | Furniture | Vehicles | Watches
  -> envelope books, hard 480, in EVERY case
```

Four names, because they are four questions: `display_category`,
`recognition_category`, `pricing_category`, `pricing_envelope_source`.

```
NARROWING     new hard_max <= incumbent   -> always allowed, no evidence needed
WIDENING      new hard_max >  incumbent   -> requires ANCHOR or OBJECT_CLASS
DISAGREEMENT  widening without it         -> pricing_category unchanged,
                                             display_category may still move,
                                             category_disagreement recorded,
                                             V-CATEGORY-DISAGREEMENT refuses the
                                             number UNDER EITHER LABEL
```

Rule C is the half the revert missed. Pricing on Stage 1 while displaying Stage 2
tells the user two things, one of which is false, and they cannot tell which.

**The inverse case works.** A wrong Stage 1 is no longer permanent: with
`OBJECT_CLASS` or `ANCHOR`, Stage 2's category takes over. Tested in both
directions over all 225 ordered pairs of canonical categories.

**Why text does not widen a category.** A brand printed on a book jacket is
genuinely read off the item and says nothing about whether the object is a book or
a laptop. Only a verdict about the *object* speaks to that question.

### 6.4 Recognition and valuation are two verdicts (§5, R2-H5)

The most important change in the round, and the one Phase B cannot be retrofitted
onto.

```
recognition_verdict : IDENTIFIED | FAMILY | CATEGORY | UNKNOWN
valuation_verdict   : ANCHORED | BOUNDED | PENDING_MARKET | MANUAL
```

The Ninja witness, before and after:

```
before  identity EXACT_MODEL -> ACCEPT ILS 400, grade MEDIUM, source stage2_ai
after   recognition IDENTIFIED - valuation PENDING_MARKET - 0/0/0
```

ILS 400 was a number the model wrote down. Nothing measured it, and the user saw it
in the same shape — with a *better* grade — than a price backed by a catalog row.

**The database is evidence and memory, not a whitelist.** An item absent from the
catalog is not unrecognisable; it is unpriced.

**The direction is deliberately counterintuitive and is asserted, not commented:**
better recognition moves a scan from `BOUNDED` to `PENDING_MARKET` — from a
category estimate to an honest refusal, not to a better-looking number. A
category-level estimate labelled as one is honest; a product-specific number with
no product-specific evidence is not.

`pending` is **not** `degrade`. It carries the identity forward for `/api/enrich`
to research, and sets `degraded: true` so every consumer written before it refuses
the number without being taught a new state first.

**Ordering is load-bearing.** V-MARKET-EVIDENCE runs LAST. Placed before the
numeric rules it short-circuited a malformed quote into `pending` — telling the
caller "market research will resolve this" about a quote that violates V-ORDER,
which is the *softer* of the two refusals. A scan must always fail to the harder
one.

### 6.5 A category is a word, not a substring (§6, N-4)

```
"Tablet"    contains "table"  -> FURNITURE, hard_max 16,000
"Watchdog"  contains "watch"  -> watches
"Scorecard" contains "car"    -> vehicles
"Bookcase"  contains "book"   -> books
```

An iPad categorised "Tablet" was priced under the **furniture** envelope. CB-12
could not see it: the property compares raw against canonical, and here both were
wrong in the same direction. A property only observes the disagreement it is
pointed at.

Tokens now declare their match mode (`word`, plural-tolerant, vs `stem`), and the
predicate lives in **one** module that both the guard and `category.js` import. The
one word-anchored alias the table already had (`\bcars?\b`) disagreed with the
guard's `includes('car')`, and the generated corpus dutifully reported "Caravan" as
a *safe narrowing* — recording the drift as a feature of the rule.

**The narrow-only floor is what makes it safe.** "Bookcase" names nothing under the
token rule, and no bucket means MANUAL_ONLY's 2,000 — *above* the 480 it had. So
both rules are resolved and the lower ceiling wins: six strings corrected, three
preserved, nothing widened.

**The property caught its own author, in the same commit.** Word-anchoring broke
"Handbags", so `handbag` was added as an alias — and CB-12 immediately reported 42
widened pairs, because the guard tests the category for `bag` and not for
`handbag`. Adding it to the guard too would have closed the gap and been a
**pricing change**, which does not belong in a normalisation boundary. It is a
product noun, exactly like `backpack`. Removed. Fifth alias deleted by that
property rather than by review.

### 6.6 No network destination is invisible to both layers (§2, N-1/N-2)

```
N-1  export const f = (q) => fetch(H + '/v1');            reported NOTHING
     export function f(q) { return fetch(H + '/v1'); }    non-literal-target
```

The declaration filter matched `=>` in order to skip `const f = () => ...`, a shape
it could never have matched — and skipped every concise arrow **body** instead. An
`await` between the arrow and the call is the only reason any case survived looking
correct. The round-2 record claimed this mutant was caught "STATIC — unresolvable
target at the consumer". For arrow bodies that was false.

```
N-2  import https from 'node:https'; https.request(o)
     STATIC: nothing        RUNTIME: nothing (the harness patches fetch only)
```

`NETWORK_ENTRYPOINTS` and `UNSUPPORTED_TRANSPORTS` are now declared. Static
analysis is not made complete; its **incompleteness is made fail-closed** — an
unfollowable transport is reported BY NAME rather than passing silently.

A generated 56-cell matrix (8 target constructions x 7 call shapes) asserts that
**no cell is silently green**, with negative controls for the two kinds of noise a
looser scanner would produce: a real `function` declaration, and a transport named
only in a comment or a prompt.

### 6.7 One confidence parser (§9)

The guard's `confidence()` closed the *pricing* path. `api/analyze.js` still read
the same three fields through `topBrand?.confidence || 0` and compared
`category_confidence` against the Vision trigger directly — so a percent-scale
confidence read as STRONG there and **skipped Vision**, the one stage that could
have corrected it and the sole producer of `OBJECT_CLASS` evidence. Two halves of
the pipeline disagreeing about what a number meant.

The parser moved to `pricing-authority.js`; four analyze-side reads now use it.
Malformed is WEAK, which triggers Vision — the fail-closed direction is to look
harder, not to trust the number. The guard keeps a byte-identical copy (it may not
import at will) and CF-1c asserts the two agree over the whole malformed matrix
rather than trusting that they do.

---

## 7. MARKET CALIBRATION — RECORDED, NOT ACTED ON

**These are PRODUCT/DATA decisions. No envelope was widened in this round, and no
test was made to pass by widening one.**

| bucket | soft | hard | evidence of mismatch |
|---|---|---|---|
| `beauty` | 500 | 1,600 | a real luxury-fragrance market at ILS 1,100+ |
| `bags` | 1,500 | 4,800 | a used Louis Vuitton Neverfull MM at ~ILS 4,500 is refused by V-ENVELOPE-BAND |

Both are pinned **by value** in `tests/valuation-verdicts.test.mjs` (VV-2e), so
widening either becomes a deliberate act with a failing test attached rather than a
quiet edit.

Louis Vuitton Imagination being correctly identified and then bounded by a tight
beauty envelope is a **calibration** problem, not a recognition failure, and §5 now
keeps the two apart: LV's `recognition_verdict` is `IDENTIFIED` regardless of what
the envelope does to its price.

Calibrating these requires real Israeli resale market data. That is not something to
infer from fixtures, and this round does not.

---

## 8. STILL OPEN AFTER ROUND 3

- `low` has no floor — 8,822 accepted cases below it, worst 0.40x.
- `variantContradiction` false positive: `27"` and `27 inch` are different tokens.
- V-FX coerces money (`Number("3.7")`) and never validates the amount behind an ILS
  comp.
- Category ambiguity resolves by alias order; a string naming two categories takes
  the first match. Documented guess, pinned by CB-9b.
- Dropping `kitchen` (round 2) and `handbag` (round 3) costs those strings their
  bucket. Safe direction, real cost, enumerated in CB-12b/CB-12c.
- `api/analyze.js` is ~6,400 lines against the repo's own 500-line rule. The
  provider ledger still needs extracting before `/api/enrich` exists.
- **`beauty` / `bags` calibration** — §7 above. Product decision.
