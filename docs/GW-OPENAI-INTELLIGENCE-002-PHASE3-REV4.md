# GW-OPENAI-INTELLIGENCE-002 — REV-4 architecture + foundation record

**Status:** foundation implemented. **PHASE 3 = NOT APPROVED.** No OpenAI key
requested, no live OpenAI call made, nothing deployed.

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
