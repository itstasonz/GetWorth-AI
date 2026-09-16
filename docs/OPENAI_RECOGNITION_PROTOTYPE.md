# GW-OPENAI-RECOGNITION-001 — OpenAI recognition prototype

Status: **prototype, disabled by default, unproven.**
Nothing in this document claims OpenAI is faster or more accurate. The
benchmark that would decide that has not been run — see
[Required production experiment](#required-production-experiment).

---

## 1. The current production scan path (Phase 1 audit, read at HEAD)

`POST /api/analyze` → `handler` → `toWebRequest` → `handleRequest`
(`api/analyze.js`). One budget clock (`BUDGET_MS = 50_000`, `maxDuration 60`)
derives every stage cap; stages are **skipped rather than truncated** when the
remaining budget is tight.

| # | Stage | Where | External call | Cap |
|---|---|---|---|---|
| 1 | Auth (JWT, local HMAC or JWKS) | `verifyJWT` | Supabase JWKS (fallback only) | 5 s |
| 2 | Body parse + image validation | `validateImages` | — | — |
| 3 | Rate limit / quota | `checkRateLimit` | Supabase RPC | 6 s, **fails closed** |
| 4 | **Stage 1 recognition** | `recognize()` | **Anthropic `claude-sonnet-4-6`** | ≤28 s |
| 5 | Calibration | `calibrateRecognition` | — | sync |
| 6 | Google Vision fallback | `fallbackVision` | **Google Vision** (cached 24 h, 1500/day) | ≤5 s |
| 7 | Query embedding | `generateQueryEmbedding` | **Voyage** | ≤3.5 s |
| 8 | Retrieval | `retrieveCandidates` | Supabase (parallel strategy groups) | ≤4.5 s |
| 9 | Fast path *or* **Stage 2** | `evaluateFastPath` / `verifyAndPrice` | **Anthropic `claude-sonnet-4-6`** | ≤24 s |
| 10 | Pricing rescue (PRE) | `pricingRescueEngine` | Anthropic `claude-haiku-4-5` | ≤3.5 s |
| 11 | **VAL-001 guard** | `normalizeForUI` → `validateQuote` | — | sync |
| 12 | Persistence | `recordScanWithRetry` → `record_scan` | Supabase | budget-bounded |
| 13 | Derived + memory writes | `updateDerivedWithRetry`, `memory_*` RPCs | Supabase | best-effort |

Answers to the ten audit questions:

1. **Image entry** — `handleRequest`, `parsedBody.images[] | imageData`, validated by `validateImages` (magic bytes, 5 MB each, 25 MB envelope).
2. **Stage 1 boundaries** — begins at `timed('stage1_vision', …)`, ends when `calibrateRecognition` returns.
3. **External calls in Stage 1** — exactly one: Anthropic Messages, `claude-sonnet-4-6`, `max_tokens 1500`, `temperature 0`.
4. **Google Vision** — *after* Stage 1, only when `category_confidence < 0.60` **or** top brand/model confidence `< 0.60`, and only with ≥12 s of budget.
5. **Retrieval entry** — `retrieveCandidates(recognition, queryEmbedding, visionData)`, gated at `rem() >= 6_000`.
6. **Stage 2 entry** — `verifyAndPrice(...)`, unless `evaluateFastPath` is eligible or the budget forces the rescue engine.
7. **Stage 1 → Stage 2 dependencies** — `brand_candidates`, `model_candidates`, `category`, `category_confidence`, `ocr_text.*`, `visual_features.*`, `model_family`, `exact_model_ambiguous`, `embedding_text`, and the injected `_user_correction`.
8. **UI dependencies** — `result.recognition.{ocrText, modelNumber, identifiedBy, alternatives}`, `result.name/nameHebrew/category/confidence/condition`, `marketValue.*`, `candidate_payload`, `_debug` (admin only).
9. **Persistence dependencies** — the `valuations` row built in `handleRequest` (`ai_name`, `ai_category`, `ai_confidence`, `ai_raw_response`, `ocr_text`, `model_number`, `identified_by`, `alternatives`, prices), plus `product_candidates`, `price_observations`, and the `recognition_memory` key from `buildRecognitionMemoryKey({category, brand, model})`.
10. **Pricing safeguards that depend on recognition** — `calibrateRecognition`'s 0.70 silhouette clamp, `gradeRowEvidence` / `classifyRowEvidence` / `rankCandidates`, `isCompatibleAnchor` (PRE anchors), `evaluateFastPath`, and `validateQuote` (VAL-001), which reads `ctx.identity` and `ctx.recognition`.

Observed production cost: Stage 1 ~10–16 s, retrieval ~0.5–2 s, Stage 2 ~7–17 s,
total ~21–36 s.

---

## 2. What this ticket added

```
IMAGE
 → [RECOGNITION_ENGINE] ─┬─ current : recognize()            (unchanged)
                         └─ openai  : recognizeWithOpenAI()  (new)
 → calibrateRecognition                                       (unchanged)
 → Google Vision / embedding / retrieval                      (unchanged)
 → evidence classification + ranking                          (unchanged)
 → fast path / Stage 2 / pricing rescue                       (unchanged)
 → VAL-001 validateQuote                                      (unchanged)
 → persistence                                                (unchanged)
 → RESULT
```

Three modules, split at real seams (and to stay under the repo's 500-line
rule):
- `openai-recognition-contract.js` — **what we ask for**: schema, prompt,
  taxonomy. The file to diff when an accuracy number moves between benchmark
  runs, since a prompt or schema edit is the likeliest cause.
- `openai-recognition-normalize.js` — **how the answer is interpreted**. Where
  the "confidence is not evidence" rule is actually enforced, and where five of
  the seven review findings landed. Worth reading on its own.
- `openai-recognition.js` — **how we call it**: feature flag, key handling,
  HTTP, failure classification, telemetry.
- `api/analyze.js` touches OpenAI in five places: the import, the
  `runStage1()` engine branch, the `snapshotTimings` roll-ups, the
  `_debug.recognition_engine` payload and the `scan_timings` event. Only the
  engine branch changes BEHAVIOUR; the rest is telemetry. (An earlier draft of
  this doc and of the code comments claimed a single touch point. That was
  wrong, and the architecture review caught it.)
- The current engine is **not modified**. `recognize()`, `MODEL_VISION`,
  `buildRecognitionPrompt()` and `RECOGNITION_SCHEMA` are byte-identical, and
  test `OAI-30` pins that.

### API contract (verified against current OpenAI docs)

`POST https://api.openai.com/v1/responses`, `Authorization: Bearer …`, with
`input[].content[]` carrying `{type:'input_image', image_url:'data:<detected mime>;base64,…'}`
(MIME detected from the same magic bytes `validateImages` checks — JPEG, PNG,
WebP, HEIC — rather than hardcoded, so a provider rejection names the real
format instead of looking like a decode failure), `store:false`,
`text.format = {type:'json_schema', name, schema, strict:true}`,
`reasoning.effort='none'` and `max_output_tokens`. Output is read from
`output[].content[]` parts of type `output_text` — the SDK-only `output_text`
convenience field is deliberately **not** used. Refusals arrive as a `refusal`
content part; truncation as `status:'incomplete'`.

Default model **`gpt-5.6-luna`**, overridable with `OPENAI_RECOGNITION_MODEL`.
It is the cheapest current vision tier that supports `reasoning.effort:'none'`,
which is what makes a ≤5 s target plausible at all.

### Feature flag

```
RECOGNITION_ENGINE=current   # default; also the value when unset
RECOGNITION_ENGINE=openai    # prototype; ALSO requires OPENAI_API_KEY
OPENAI_API_KEY=…             # server-side only, never VITE_*
OPENAI_RECOGNITION_MODEL=…   # optional benchmark override
```

No existing flag mechanism was found in the repo, so this is a plain
server-side env var — the smallest thing that works. `resolveRecognitionEngine`
returns `current` for every value except an exact (trimmed, case-insensitive)
`openai`, and downgrades to `current` when the key is missing rather than
failing every scan.

> `.env.example` could not be edited from this session (the tooling denies
> writes to env files in the project root). **Add these three lines manually.**

### Telemetry

`result._timings` gains `recognition_engine`, `openai_recognition_ms`,
`retrieval_ms`, `pricing_ms`, and — in the `complete` snapshot —
`persistence_ms` and `total_ms`. All are *derived* from the existing measured
spans, so they cannot disagree with the waterfall.

`ai_raw_response` can only ever hold the `pre_persist` snapshot, because
`record_scan` serialises before persistence has happened. The complete set is
therefore also written to the existing `scan_events` table as a
`scan_timings` event keyed by the same `scan_uuid`. **No migration, no schema
change** — `scan_events.payload` is already JSONB.

`openai_recognition_ms` measures request-sent → **response body fully read**,
excluding local parse and normalization. The body read is deliberately inside
the window: `await fetch()` resolves on headers, so stopping there would
report time-to-headers, while the current engine's `stage1_vision` span covers
its own `res.json()`. Same boundary on both sides is what makes the A/B
numbers comparable (`OAI-31b`, `OAI-31c`).

---

## 3. Phase 9 — failure behaviour, and why

**Decision: OpenAI failure falls back to the existing engine, budget-gated.**

Any adapter error — timeout, 429, 5xx, refusal, truncation, malformed JSON —
throws. `runStage1()` catches it and:

1. If `rem() - 12_000 >= 8_000`, it runs the **existing** `recognize()` with
   that cap. `recognitionEngineUsed` is set back to `current`, so the scan is
   never counted as an OpenAI result.
2. Otherwise it **throws**. The pre-existing Stage 1 catch then returns
   `503 / STAGE1_TIMEOUT / retryable:true` and refunds the daily quota —
   unchanged behaviour.

Rejected alternative — *ask the user for confirmation or another photo*:
the failures here are transient infrastructure faults, not ambiguous images.
Charging a real person an extra interaction for an upstream 429 is the wrong
trade, and it would also destroy A/B comparability by removing the failing
scans from the sample. The latency cost is bounded: the OpenAI attempt is
capped at 8 s, so the worst case is 8 s + a normal Stage 1, which still fits
the 50 s budget.

Under no failure mode is a fabricated identity returned.

---

## 4. Why OpenAI confidence is not evidence here

### What independent review found first

Five specialist reviewers audited this prototype. Two **critical** defects were
found, both in this adapter, both reproduced by execution, both now fixed and
regression-tested. They are recorded because the pattern will recur.

**C2 — an uncorroborated `model_number` became a read label.** The adapter set
`labels_detected: modelNum ? [modelNum] : []` — a straight copy of a
model-*asserted* string into the OCR evidence channel, eleven lines after it
had already computed `modelInText` and established the string does not appear
in the text. `labels_detected` is one of three disjuncts in
`calibrateRecognition`'s `textConfirmed`. Measured effect of that one field:

| | `model_number: null` | `model_number: 'G903'` |
|---|---|---|
| model confidence | 0.70 (clamped) | **0.97** unclamped |
| `identity_resolution.level` | `family` | **`exact`** |
| `evaluateFastPath` | rejected | **eligible, `stage1_ocr`** — Stage 2 skipped, priced off anchor |

The adapter was manufacturing the very evidence it exists to verify. Fixed:
`(modelNum && modelInText) ? [modelNum] : []`.

**C1 — one glyph disabled the silhouette clamp.** `has_readable_text` was
`visibleText.length > 0`, so `visible_text: ['·']` took a 0.97 silhouette guess
from clamped/`family` to unclamped/`exact`. A single glyph is below retrieval's
own 3-character token floor, so it bought nothing but the bypass — and real
photographs almost always carry some incidental marking, meaning the clamp
would have been off on most scans precisely when model-level confidence is
least earned. Fixed: an entry must contain ≥2 alphanumeric or Hebrew
characters, and junk is excluded from `raw_texts` too (filtering only the flag
left the bypass open through the second disjunct).

> **Declared A/B asymmetry #2 (valuation review).** The `'unidentified'`
> sentinel makes `brand_candidates` non-empty on a brandless scan that carries
> a runner-up, which skips `calibrateRecognition`'s zero-length clamp
> (`conf -> 0.55`) in favour of the weaker `topBrand.confidence < 0.50` clamp
> (`conf -> 0.65`). Measured: this does NOT materialise on brandless/no-text
> scans (the -0.15 no-readable-text penalty holds both arms at <=0.50), only on
> `brand null + readable text + runner-up + identity_confidence >= 0.60` —
> where the OpenAI arm skips the Google Vision fallback the current engine
> would run. Not a safety issue: `visionData` is only ever consumed to ADD
> corroboration, so losing it is strictly more conservative and `brandOk` stays
> false either way. It matters for A/B FAIRNESS — on those scans you are
> comparing OpenAI-without-Vision against current-with-Vision. The benchmark
> reports `google_vision_rate` per engine so the divergence is visible.

> **Declared A/B asymmetry.** The C1 fix makes this engine *stricter* than the
> current one, which takes the model's word for the same flag. That is a
> deliberate choice — the adapter has the actual strings and can check them —
> but it is a confound the benchmark must account for: some of any accuracy
> difference will come from the stricter clamp, not from the model. Recorded
> here rather than hidden.

**F2 — the strict enum silently widened the pricing envelope (CRITICAL).**
`resolveEnvelopeKey` matches `bags` and `jewelry`, but neither was in the
adapter's category enum. The current engine types `category` as a *free-form
string*, so Sonnet can return "Jewelry" and the jewelry envelope is selected;
a strict `enum` is a hard constraint, so those categories were coerced to
`'Other'`, matched no matcher, and fell through to `GLOBAL_ENVELOPE`
(`hard_max` 500000 vs jewelry's 2000, losing the `manual_only` grade-down and
`needs_review`). Measured on one ₪18,000 Cartier gold band:

| | current engine | OpenAI engine (before fix) |
|---|---|---|
| envelope | `jewelry` / `manual_only` | `global` / `global` |
| outcome | degrade → **₪0/0/0 MANUAL_REQUIRED** | accept → **₪18,000 at MEDIUM** |

Jewelry is one of four deliberate `manual_only` buckets, and bags/jewelry are
the two highest counterfeit-risk categories. Fixed by adding both to the enum;
`OAI-16b` now drives the Cartier case end-to-end. **Any future edit to
`resolveEnvelopeKey`'s matcher list must be mirrored in `CATEGORIES`.**

**F3 — condition defaulted to a rung (MEDIUM).** An unrecognised condition, or
a missing `visual_attributes`, produced `'Good'` → the `used` rung (0.30),
where the guard's contract says an unmappable condition must yield `null` and
callers "MUST treat null as no adjustment, never as a default rung". The
current engine does yield null. Directional: with basis `used`, a user
selecting New gets `conditionDelta = 0 − 0.30`, a **30% price uplift** the
current engine would never apply. Now returns `''` → `null`.

**Two silent behaviour regressions (MEDIUM), both fixed.** `brand_candidates`
was capped at 1 while `recognize()` returns up to 5 — and
`needsAuthenticityForensics` scans *every* candidate against the high-risk
brand list, so a watch the current engine reads as `[{Seiko,0.5},{Rolex,0.4}]`
triggered counterfeit forensics while the OpenAI path did not. Fixed with a
`candidate_brands` schema field. And `category_hebrew` was hardcoded `''`,
which emptied `final_category_hebrew` and `full_name_hebrew` on both degraded
paths — persisted, and user-visible in a Hebrew-first product. Fixed with a
lookup keyed off the enum.

**One HIGH availability bug, fixed.** The `scan_timings` write this ticket
added was an unbounded `await`; `supabase-js` has no default timeout and its
try/catch swallows rejections, not stalls, so a stalled pool could run past
`maxDuration` — a 504 for a valuation that had already committed. Now
`withTimeout`-bounded like its two siblings.

**H1 — corroboration was broken in BOTH directions (HIGH, two rounds).** Corroboration was `haystack.includes(claim)` — no token boundary, no
length floor, no specificity test. Every one of these was stamped
`model_number_text` / `level: exact` / confidence 0.93:

| claim | label | verdict before |
|---|---|---|
| `iPhone 15` | `iPhone 15 Pro Max` | "corroborated" |
| `MX` | `MX MASTER 3S` | "corroborated" |
| `XM4` | `WH-1000XM4` | "corroborated" |
| `G5` | `G502 HERO` | "corroborated" |
| brand `a` | `abcdefg` | "corroborated" |

The direction is backwards — the *less* specific claim confirmed by the *more*
specific label, so a cheaper base variant got stamped text-confirmed by a Pro
Max sticker. This is the same class commit `7d9aa69` closed at the retrieval
layer (`isSpecificTokenMatch`), reopened one layer upstream.

The first fix then leaked the *opposite* way — and that direction is the more
likely real shape: a moulding reads `G502`, the model reads it correctly, then
names the ₪480 `G502 X Plus` and gets it stamped text-confirmed. Same
₪170-vs-₪480 harm, operands swapped.

Corroboration is now **mutual**, and the two halves are tuned asymmetrically
on purpose — a false positive prices the wrong product, a false negative only
costs 0.96 → 0.70:

- **claim side, strict**, no noise filtering: every claim token must have been
  read. `pro` / `plus` / `x` *are* the claim.
- **entry side, loose**, noise-filtered: some entry must be fully accounted
  for by the claim.

The noise list is deliberately *smaller* than `analyze.js`'s
`OCR_GENERIC_TOKENS`, which drops `pro`/`max`/`plus`/`mini`/`lite`/`ultra` as
"marketing suffixes". That is right for retrieval tokens and wrong here —
those are the sibling discriminators, and filtering them would rebuild the
undersell. A test asserts none of them ever enters the list, mutation-verified
by injecting `pro`/`max` and watching two tests fail.

Accepted residual: box copy (`"Logitech G502 HERO Gaming Mouse"`) still
under-corroborates, because category nouns are not filtered either —
"Magic Mouse" is a model name. Conservative direction, documented in place.

**The schema was ordering generation against us.** Structured output emits keys
in schema order, so `visible_text` sitting *after* `brand`/`model` meant the
model committed to an identity and then generated the text it had "read" — the
setup that produces an echo, which retrieval then stamps `origin: 'OCR'` and
treats as evidence. The current engine counteracts this in prose ("EXTRACTION
STEPS: 1. OCR SCAN … 4. MODEL CANDIDATES"); the short prompt did not. Text
fields now precede identity fields, and the prompt opens with an explicit
ORDER OF WORK block.

**Telemetry that laundered the echo.** `model_text_corroborated` reads as
"verified against text" to anyone judging the A/B, but the model authors both
the identity *and* the text, so under echo it is a tautology. Renamed to
`model_appears_in_returned_text` / `brand_appears_in_returned_text`, which
state only what they measure.

**A fix that opened a worse hole — worth reading as a pattern.** Restoring
runner-up brands (so `needsAuthenticityForensics` stays armed) put them through
the same push as the primary. With a null brand, the first *speculative*
runner-up therefore landed at `brand_candidates[0]` — the single slot
`assessFallbackIdentity` and `resolveEnvelopeKey` read as **the** brand. The
prompt actively invites that speculation ("include a luxury brand even at low
confidence"), so this was the expected path, not an edge case. Measured, on a
scan where the model explicitly said it could not read the brand
(`brand: null`, `needs_confirmation: true`, Rolex offered at 0.25):

| | envelope | verdict |
|---|---|---|
| without sentinel | `anchor:r1` (soft 52 000) | **ACCEPT ₪34 000/38 000/44 000 at HIGH** + ledger write |
| with sentinel | `watches` (soft 2 000) | DEGRADE ₪0/0/0 MANUAL_REQUIRED |

Fixed with an `'unidentified'` sentinel — the codebase's own existing
convention — pushed ahead of the runner-ups, and only when runner-ups exist so
the empty case keeps exact clamp parity with the current engine. Forensics
stays armed; the identity does not move.

**Two of my regression tests passed for the wrong reason.** `OAI-08` pinned the
clamp with a fixture whose `model_number` was `null`, which was the field that
broke it; `OAI-16c` asserted counterfeit forensics using category `Watches`,
which `AUTHENTICITY_PROMPT_CATEGORIES` matches on the *first line* before
`brand_candidates` is read — deleting the entire feature left the test green.
Both are rewritten with fixtures that isolate the behaviour and explicit
negative controls. Recorded because it happened twice: an assertion is only
worth what its fixture lets it see.

**Known parity issues, deliberately NOT fixed** (fixing them asymmetrically
would confound the comparison, and Phase 11 forbids touching the old pipeline):

- *Self-corroboration.* `visible_text` is model-authored, and
  `retrieveCandidates` stamps its tokens `origin: 'OCR'`, so an echoed guess
  can grade catalog rows as evidence. The current engine's `raw_texts` is
  identically model-authored and identically stamped — a pre-existing
  architectural property the prototype inherits, not one it introduces. (On
  one axis the adapter is *better*: Sonnet can write `evidence:
  "readable_text"` itself and hit the clamp-bypass regex with nothing in
  `raw_texts` at all; the adapter derives that string instead.) Three
  mitigations are in place — schema ordering, the prompt's ORDER OF WORK
  block, and token-based corroboration — but none of them is a guarantee, and
  **the reviewer demonstrated a 2.8x overvaluation end-to-end** (a G502 HERO
  priced as a G502 X Plus at MEDIUM) purely from an echoed `visible_text`.
  This is the single largest residual risk in the prototype and the thing the
  benchmark's confident-and-wrong rate exists to measure.
- *Image-borne prompt injection.* A photograph is fully attacker-controlled
  and neither prompt carries a data-vs-instructions rule.

### Three mechanisms, all tested

1. **`has_readable_text` is derived, not reported.** The model is never asked
   for it; the adapter computes it from whether `visible_text`/`logos`
   actually contain anything. `calibrateRecognition` uses that flag to enforce
   the 0.70 silhouette ceiling, so a confident model cannot unlock its own cap
   (`OAI-07`, `OAI-08`).
2. **Corroboration is checked, not accepted.** `brand_text_corroborated` /
   `model_text_corroborated` are true only when the claimed string actually
   appears in the text the model read back (`OAI-10`).
3. **Absence is preserved.** `null`, `""`, `"unknown"`, `"unidentified"`,
   `"generic"` and friends produce *no candidate at all*, not a placeholder
   identity that retrieval would then search for (`OAI-04`, `OAI-05`, `OAI-06`).

Beyond the adapter, nothing changes: the catalog row still decides evidence
class (`OAI-13`), a sibling still cannot outrank the true row (`OAI-14`) or
anchor a price (`OAI-15`), the fast path stays closed without corroboration
(`OAI-16`), and VAL-001 still adjudicates every number (`OAI-17`, `OAI-18`).

The adapter also builds its output from an allowlist rather than spreading the
parsed JSON, so model output cannot forge `_user_correction`,
`identity_resolution` or any other pipeline-authored field (`OAI-22`).

---

## 5. Security

Independent security review found **no critical or high defect in key
isolation** — that was attacked directly, including an upstream stubbed to
echo the `Authorization` header back, and it held. The findings were about
data flow.

- **`store: false` is set on every request** (review finding, HIGH). The
  Responses API defaults `store` to **true** and retains stored requests for
  at least 30 days in a browsable dashboard. Without this, every scanned
  photograph became a second copy outside any GetWorth deletion path — the
  difference between a processor call and an unreachable duplicate, and a
  broken GDPR Art. 17 erasure story. An optional pseudonymous
  `safety_identifier` is supported; it is deliberately not the user id or
  email.
- **Upstream error text is classified, never persisted raw** (review finding,
  MEDIUM). An OpenAI 400 echoing the offending `image_url` was reproduced
  writing ~150 bytes of the *user's own base64 image* into
  `valuations.ai_raw_response` and `scan_events.payload`, and onto the client
  response. `classifyOpenAIFailure()` now maps the message to a stable code
  (`timeout` / `rate_limited` / `auth` / `upstream_5xx` / `refusal` /
  `incomplete` / `parse` / `http_4xx` / `network`); the full scrubbed text
  stays in the server log only.
- `OPENAI_API_KEY` is read only inside `api/_lib/openai-recognition.js`, a
  path Vercel does not route or serve. It is never returned, never attached to
  an error, never logged.
- `scrubKey()` redacts the configured key *and* anything matching `sk-…` from
  every upstream body before it can reach a log line or an `Error`. The test
  drives an upstream that echoes the `Authorization` header back and asserts
  no leak (`OAI-24`).
- The key is sent as a header only, never interpolated into the body
  (`OAI-25`), and no `VITE_` variable is involved (`OAI-26`).
- Image data goes to a new third-party processor. That is a **data-flow change
  requiring a privacy review before any production enablement** — user-uploaded
  photographs of personal property, potentially including faces, documents or
  addresses in frame, would be sent to OpenAI. This is out of scope for the
  prototype but must not be skipped before the experiment runs.
- Auth, CORS, rate limiting, quota and the prompt-quarantine fences are
  untouched and still run ahead of recognition.

---

## 6. Cost per scan

| | current Stage 1 | prototype (`gpt-5.6-luna`) |
|---|---|---|
| model | `claude-sonnet-4-6` | `gpt-5.6-luna` |
| input | ~1.5 k tok (1 image + prompt) | ~1.5 k tok |
| output | ≤1500 tok | ~250 tok (schema-bounded, no reasoning) |
| list price | $3 / $15 per Mtok | **$0.20 / $1.20 per Mtok** |
| ≈ per scan | ≈ $0.027 | **≈ $0.0006** |

Roughly a 40× reduction on the recognition call — about two orders of
magnitude — **if** `luna` proves accurate enough. On `gpt-5.6-terra`
($2 / $12) it is ≈ $0.006, still ~4× cheaper. These are list-price estimates
from token counts, not measured spend; the benchmark reports real
`input_tokens` / `output_tokens` per scan.

Stage 2 is unchanged and still dominates total scan cost.

---

## 7. What this could eventually eliminate — and what it cannot

**Could be removed if the hypothesis holds**

- The Google Vision fallback (step 6, ≤5 s). It exists because Stage 1's OCR
  is unreliable on weak text; a stronger reader makes it redundant.
- Much of Stage 2's *identity verification* half (`final_brand`,
  `final_model`, `identification_method`, `brand_confidence`), leaving Stage 2
  as a pricing call only — the largest single latency win available.
- The serial-OCR side call (`ocrSerialLabel`).
- Some pricing-rescue invocations, which mostly fire because Stage 2 ran out
  of budget.

**Must remain, regardless of how good recognition gets**

- Retrieval, evidence classification, ranking, sibling protection — a model
  hypothesis is not a catalog row, and this is what separates the two.
- `isCompatibleAnchor` and VAL-001. These constrain *prices*, which no
  recogniser produces.
- Condition questions, persistence, auth, rate limits, quota, user
  corrections and the recognition-memory learning loop.
- `calibrateRecognition`'s clamp. It is engine-independent by design.

**Expected latency improvement — projected, not measured.** If OpenAI
recognition lands at 3–5 s against a 10–16 s Stage 1, and Vision is dropped,
the plausible saving is **8–16 s** off a 21–36 s scan. Should Stage 2 later
shrink to pricing-only, another 4–8 s. Both figures are arithmetic on the
current baseline, not evidence.

**Accuracy risks.** Untested on Hebrew packaging text; unknown sibling
discrimination versus the tuned Sonnet prompt; `reasoning.effort:'none'` is an
explicit quality-for-latency trade that has not been quantified; and
`gpt-5.6-luna` is the cheapest tier, so it is the most likely to
under-perform. The single most important number in the benchmark is
**confident-and-wrong rate**, not speed.

---

## 8. Required production experiment

The A/B harness exists (`npm run bench:recognition:ab`) and currently
**skips**: `tests/fixtures/recognition/` contains 24 case definitions covering
every class the ticket lists — branded electronics, exact-model electronics,
appliances, furniture, clothing, a generic control, readable model numbers,
low-text objects, and visually similar siblings — but **zero fixture images**.

To run the experiment:

1. Add the 24 fixture photographs (`tests/fixtures/recognition/<id>.jpg`).
2. Complete the privacy review for sending user images to OpenAI.
3. Set `OPENAI_API_KEY` and `BENCH_JWT` (a benchmark user's access token) in a
   **staging** environment — the harness consumes real quota and writes real
   valuations.
4. **Check the catalog taxonomy: `node scripts/check-catalog-categories.mjs`.**
   Retrieval strategies 3a/3b filter with `.ilike('category', '%' + category + '%')`.
   The adapter can now emit `Bags` and `Jewelry` (it must — see F2), but if the
   `products` table spells those differently or has no rows for them, those
   strategies return **zero** for exactly the two highest-value,
   highest-counterfeit-risk categories, and the benchmark would score that as
   *OpenAI retrieves worse* when the cause is taxonomy, not recognition. The
   script exits non-zero and names the offenders. Map them to the catalog's own
   wording in the contract module — do not widen the enum again, and do not
   drop them (that reopens the GLOBAL-envelope bypass).

   This also exposes a pre-existing problem worth its own ticket: GetWorth has
   **four independent category lists that have already drifted** — the Stage 1
   prompt (14, free-form), this adapter's enum (16), `AppContext.jsx` (14, has
   `Music`, lacks Smoking/Bags/Jewelry) and `BrowseDetailView.jsx` (12). Scan a
   handbag and publish it, and the listing says `Other` while the valuation
   says `Bags`, silently.

5. **Smoke-test the model first, with one call.** `gpt-5.6-luna` and
   `reasoning.effort: 'none'` are verified against current OpenAI docs but
   have not been exercised against the live API. If either is rejected or
   ignored, reasoning tokens eat `max_output_tokens`, every response comes
   back `incomplete`, every scan falls back — and the pipeline is *strictly
   slower than today*. It fails loudly (`attributable: 0`, verdict prints
   `NO DATA`), but not before spending a full benchmark run.
6. `npm run bench:recognition:ab -- --repeat 3 --json > docs/baselines/openai-ab-<date>.json`
   The harness alternates engine order per case so neither side absorbs
   cold-start cost, paces scans 13 s apart (the per-IP and per-user limits are
   5/min, and they bite *harder the faster the engine is* — a benchmark whose
   sampling penalises the thing it measures is not a benchmark), warns when a
   run exceeds the 50/day quota, and attributes a scan to an engine only when
   that engine actually answered.

   **Read the printed caveats before quoting any number.** In particular:
   latency is reported twice — "clean" excludes fallbacks, "ALL" includes them
   and is the honest cost of routing to that engine; Google Vision's trigger
   is engine-dependent, because OpenAI's `brand: null` honesty systematically
   buys an extra ≤5 s call; and the 24 h `vision_cache` is keyed on image
   hash, so the second engine to scan a fixture may inherit a Vision result
   the first paid for.
7. Read the verdict against the ticket's targets: recognition ≤5 s target /
   ≤8 s acceptable / >10 s failure; end-to-end ≤10 s target / ≤15 s acceptable.
8. Only if recognition is *both* faster and no worse on
   confident-and-wrong — set `RECOGNITION_ENGINE=openai` for a limited
   production cohort, with the flag flipped back on regression.

Do not enable in production before step 7 produces numbers.
