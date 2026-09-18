# GW-SCAN-ENTITLEMENT-001 — provider cost vs user entitlement

**Type:** design ticket. **Status:** OPEN — documentation only.
**Raised by:** GW-PROMPT-INJECTION-001 rounds 5–7, from independent
valuation-safety and security reviews that reached opposite conclusions from the
same evidence.

**Nothing in this ticket is implemented.** No second quota, no credit
restoration, no compensation wallet, no billing tables, no migrations. It exists
so a real product decision is recorded rather than absorbed silently into a
security fix.

---

## 1. The conflation

One counter, `USER_DAILY_LIMIT = 50`, currently answers two different questions:

| | Question | Correct signal |
|---|---|---|
| **A — provider cost / abuse accounting** | Did GetWorth potentially incur provider cost for this request? | positive evidence the provider was billed |
| **B — user entitlement** | Did the user receive a usable scan result? | did a price reach the user |

These are **not the same state**, and the difference is not hypothetical — it is
exactly where two competent reviewers disagreed for two rounds.

The security invariant GW-PROMPT-INJECTION-001 established is about **A**:

> Once a provider attempt is known to be billable/consumed, that request's cost
> state is monotonic. No later GetWorth failure may refund the abuse-limiting
> quota.

That invariant is correct and must not be weakened. Refunding a billed call is
the free-paid-call loop that rounds 3–6 closed. But it says nothing about **B**,
and **B** is where the user lives.

---

## 2. Verified cases where cost = consumed and result = failed

Every row reproduced through the real handler, refunds observed as actual
`decrement_user_daily_scan` RPCs.

| Provider outcome | Billed | User got a price | Quota consumed |
|---|---|---|---|
| 200 + body unreadable | yes | no | **yes** |
| 200 + bad content shape | yes | no | **yes** |
| 200 + `stop_reason: max_tokens` (busy label) | yes | no | **yes** |
| 200 + model emits prose, not JSON | yes | no | **yes** |
| 200 + later calibration `TypeError` | yes | no | **yes** |
| 200 + later logging `TypeError` | yes | no | **yes** |
| 200 + unknown internal fault | yes | no | **yes** |
| OpenAI 200 + usage, invalid contract | yes | no | **yes** |
| Stage-2 provider failure after a billed Stage 1 | yes | `manual_required`, 0/0/0 | **yes** |

### Added in round 6, verified in round 7

Two classes that are **named refundable** became unreachable once positive
consumption evidence exists. Both reproduced as `refunds: 1 → 0`:

- **`stage1_timeout` after a 200.** The provider answers 200 and the body is
  still streaming when the inner abort fires. Classified refundable, but the
  consumption gate — correctly — blocks it.
- **`upstream_network_error` in the post-response window.** The body dies
  mid-transfer after a 200.

**Correction (round 8): "narrow" was true of only one of them.** The
post-response ambiguity below is genuinely narrow. The *pre-provider* window is
not — round 7 showed a client can open it on demand by delivering its upload
slowly, collapsing the Stage-1 budget until the provider is aborted
mid-generation. That was a deterministic, repeatable free-paid-call loop, and it
is fixed in round 8 by an ingestion boundary that refuses the request rather
than calling a provider on a doomed clock. What remains here is only the
genuinely narrow case:

Both remaining windows are narrow (Anthropic's non-streaming endpoint normally emits
headers with the body), but they are real, and they mean the entitlement gap
**grew** in round 6 rather than holding steady.

### The user-visible consequence

A 503 with `retryable: true` and *"Recognition failed — please try again"*, **and
one of the day's scans is gone.** On the 50th scan of the day the retry returns
`429 retryable:false` and the user gets **no price at all**.

---

## 3. What this ticket is NOT

- **Not a refund-policy widening.** Adding these classes back to
  `REFUNDABLE_FAILURE_KINDS` re-opens the loop. That was tried and rejected.
- **Not a valuation defect.** Independently confirmed across both rounds: prompts
  and valuation payloads are byte-identical, and every consuming case returns a
  503 with *no* price rather than a wrong one. **The cost is the allowance, not
  the number.**
- **Not urgent on correctness grounds.** No user is shown a wrong price. The harm
  is a lost entitlement, concentrated at the daily limit.

---

## 4. Known-unknown: we cannot always tell whether we were billed

GW-PROMPT-INJECTION-001 round 6 established only one direction:

> **positive evidence of consumption ⇒ consumed**

It did **not** establish the converse. `no 2xx ⇒ unbilled` is **false**:

- A request aborted by our own budget clock mid-generation is billed by the
  provider, and we never see a 2xx. Reproduced: `stage1_timeout`, `refunds=1`.
- A network failure after the provider began generating is in the same position.

So the current policy **refunds some attempts that may well have been billed**
(the abort and mid-transfer cases). Whether it also *consumes* some genuinely
unbilled ones is **not claimed either way** — we have no evidence either
direction. Any accounting design must treat both as **UNKNOWN billing state**,
never as "free". Inventing
certainty here would be the same error the security work spent three rounds
undoing.

---

## 5. Open questions for the product decision

1. Should provider-cost accounting and user entitlement be **separate counters**?
2. If so, what grants an entitlement back — a delivered price, or any 2xx?
3. How should **UNKNOWN** billing states (abort, mid-transfer failure) be
   accounted on each counter?
4. Is a grace allowance simpler than a second counter — e.g. N "failed scan"
   retries per day that do not consume entitlement but *do* consume cost budget?
5. What is the abuse ceiling once entitlement is restorable? Any restoration
   mechanism is itself an attack surface, and the current single counter is what
   bounds the loop today.

**Implementation note for whoever takes this:** the relevant surfaces are
`check_and_increment_scan_rate`, `decrement_user_daily_scan`, `USER_DAILY_LIMIT`
and the refund sites in `api/analyze.js`. Do not reuse `decrement_user_daily_scan`
for entitlement restoration — it is the abuse-accounting lever, and overloading
it a second time is how this conflation started.

---

## 6. Round-7 addendum — the gap grew on the OpenAI-fallback path

Recorded because the entitlement cost of a security fix must not be absorbed
silently. This is the direct trade of round 7's HIGH fix.

Round 7 threaded the provider ledger into the Anthropic **fallback** call
(`recognize(..., onBilled)` on the OpenAI-failure path). That closed a real
free-paid-call loop: a billed fallback 200 followed by an internal fault was
being refunded. The cost is that **five failure classes moved from refund to no
refund on that path**, verified `refunds: 1 → 0`:

`body-parse` · `content-extract` · `contract/parse` · `truncation` · `calibration`

In every case the user still receives a 503 with no price — **the delta is the
allowance, never the number** — but the scan is now consumed where it previously
was not.

**Latency of the exposure.** `RECOGNITION_ENGINE` defaults to `current`
(`api/_lib/openai-recognition.js`, `resolveRecognitionEngine`), so the
OpenAI-fallback path does not execute in the default configuration. This
expansion is therefore **latent behind an off-by-default flag** in the currently
verified setup — real, but not currently reachable in production as configured.
It becomes live the moment that flag is turned on.

## 7. Round-8 addendum — what the ingestion boundary changed

Round 8 removed the largest entitlement *risk* rather than adding to it, but it
did change who gets rejected and when.

- **Slow uploads are now refused before the provider is called.** If ingestion
  consumes enough of the budget that Stage 1 cannot be given its full intended
  cap, the request returns `503 INGESTION_TOO_SLOW` with **no quota charged and
  no provider call**. Previously the same user got a doomed provider call, a
  mid-generation abort, a 503, and a refund. Net effect for an honest user on a
  slow connection: **the same 503, sooner, with no scan consumed** — strictly
  better — but it is a new rejection reason that did not exist before, and a
  user on a genuinely slow network will now see it where they previously saw a
  (failing) scan attempt.
- **serialOCR provider failures now return 503 and refund**, where they
  previously returned `200` with an empty string and silently consumed the
  scan. That is an entitlement *improvement*: the user keeps the allowance and
  can tell the difference between "no text in the photo" and "OCR failed".

Neither changes a price or an identity.

## 8. Round-8 measurement — the ingestion gate's real cost to honest users

Quantified by the round-8 independent security review, driving a **real HTTP
server** (not a mocked adapter), so these are wire-accurate:

| Case | Result |
|---|---|
| fast upload | `200`, ingest 13 ms, cap 28,000 ms |
| **legitimate 25 MB over 12 s** | **`503 INGESTION_TOO_SLOW`** — no quota charged, no provider call |
| legitimate 25 MB over 40 s | `503 INGESTION_TOO_SLOW` — no quota charged |
| 9 s stall + 3 s rate-limit RPC | `200`, cap 28,000 ms |

> **ROUND 9 — do not read a threshold off this table.** Every row is accurate,
> but the two "25 MB" rows invite the inference that the boundary is near 12 s,
> or that it depends on payload size. Neither is true: the gate never looks at
> bytes, and the boundary is exactly **10.000 s of wall time**. The same 25 MB
> delivered in 9 s passes; a 40 KB payload delivered over 11 s fails. Derivation
> and the two gate sites are in "Round 9 — the ingestion threshold, stated as a
> number" at the end of this file.

**A 25 MB upload taking 12 seconds is entirely ordinary on mobile**, and it is
now refused. That is the honest cost of the ingestion boundary, and it belongs
in this ticket rather than in a commit message.

Before round 8 the same user was not served either: they got a doomed provider
call, a mid-generation abort, a 503, and a refund. So **no user who previously
received a PRICE now receives none** — the change is that the refusal is
earlier, cheaper, and does not consume the scan. But the *reason* shown to them
is new, and a slow-network user will now see `INGESTION_TOO_SLOW` routinely
where they previously saw a generic recognition failure.

This is the clearest case yet of the A/B split this ticket exists to name:
**provider-cost accounting** is fully protected, while **user entitlement** on a
slow connection is bounded by an upload-speed threshold nobody chose as a
product decision — it fell out of a 50 s budget minus a 28 s provider cap minus
a 12 s reserve.

### Ingestion timeout — what actually exists

Measured on the real server: Node's HTTP defaults are `requestTimeout = 300000`
(5 minutes) and `headersTimeout = 60000`. So an ingestion timeout **does** exist
at the runtime layer — an earlier round-8 note that "no application-level
ingestion timeout exists" was correct only about the *application*, and
incomplete. GetWorth's own ingestion gate now fires far earlier than either,
so the runtime values are defence-in-depth rather than the operative control.

---

# Round 9 — the ingestion threshold, stated as a number

Documentation only. Round 9 changed **no** ingestion behaviour, **no** threshold,
**no** quota policy, **no** retry policy and **no** provider budget.

## The threshold is 10 seconds, and §8 above never said so

§8 records the round-8 measurements — "fast upload → 200", "25 MB over 12 s →
`503 INGESTION_TOO_SLOW`" — and from those two rows a reader naturally infers a
boundary somewhere near 12 s, or a boundary that depends on payload size. Both
readings are wrong. The gate does not look at bytes at all, and the boundary is
exact.

`api/analyze.js:3963`:

```js
const ingestMs = Date.now() - TREQ;
if (rem() < STAGE1_INTENDED_CAP_MS + STAGE1_BUDGET_RESERVE_MS) { … 503 INGESTION_TOO_SLOW }
```

with `BUDGET_MS = 50_000` (`:3726`), `STAGE1_INTENDED_CAP_MS = 28_000` and
`STAGE1_BUDGET_RESERVE_MS = 12_000` (`:309-310`), and
`rem() = BUDGET_MS - (Date.now() - TREQ)`. Substituting:

```
reject  ⟺  50_000 − elapsed  <  28_000 + 12_000
        ⟺  elapsed  >  10_000 ms
```

**The ingestion budget is exactly 10.000 seconds of wall time from the start of
`handleRequest`**, and it is spent by everything in that window, not only by the
upload: body read, JSON parse, auth, and the CORS/limit preamble all come out of
the same 10 s.

That is the behaviour round 8's own review measured from the outside:

| ingestion time | outcome |
|---|---|
| ~9.9 s | **passes** — `200`, and Stage 1 receives its full 28,000 ms cap |
| ~9.95 s and above | **`503 INGESTION_TOO_SLOW`** — no quota charged, no provider called |

The residual gap between "10.000 s of budget" and "~9.95 s of upload" is the
auth and parse work that shares the window. §8's "25 MB over 12 s" row is a
*consequence* of the 10 s rule, not the rule; the same 25 MB delivered in 9 s
passes, and a 40 KB payload delivered over 11 s fails.

**No number was chosen here as a product decision.** 10 s is the arithmetic
residue of a 50 s request budget minus a 28 s provider cap minus a 12 s reserve
— exactly the A/B split §8 names. It is recorded as a number now so that a
future change to any of those three constants is visibly a change to the upload
deadline users experience.

### There are TWO gates, not one

| # | site | when | if the quota was already charged |
|---|---|---|---|
| 1 | `:3963` | after body parse and auth, **before** the rate-limit RPC | nothing charged yet — nothing to refund |
| 2 | `:4083` | at Stage-1 entry, **after** the rate-limit RPC | refunds (`pre_paid_call_fatal`, unconsumed ledger) |

Gate 2 is round 8b. It exists because gate 1's guarantee is **stale** by the
time Stage 1 starts: the rate-limit RPC is a network call, and a measured 5.5 s
RPC after a 9.5 s upload left `cap = 22,952 ms` against an intended 28,000 ms.
Both gates return the identical `503 INGESTION_TOO_SLOW` body, so the split is
invisible to the client — but only gate 2 can need to give a scan back.

## MEDIUM-2 — no application-level deadline on an INCOMPLETE body

**Audited in round 9. NOT fixed. Recorded for a separate ticket.**

### What exists, and what does not

`readBodyBounded` (`api/analyze.js:341`) enforces a **size** ceiling and no
**time** ceiling:

```js
for await (const chunk of asyncChunks) {
  total += buf.length;
  if (total > max) throw new BodyTooLargeError(total);
  chunks.push(buf);
}
```

The loop stops consuming the instant the byte ceiling is crossed. It will wait
indefinitely on a client that opens a connection, sends a few bytes, and then
neither sends more nor closes. Nothing in the application interrupts that wait.

The 10 s gate above does **not** help: it runs *after* `await bodyPromise`
resolves, so a body that never completes never reaches it.

### Why this is MEDIUM and not HIGH

- **A wall does exist.** `export const config = { maxDuration: 60 }`
  (`api/analyze.js:21`) is the operative control. Node's own
  `requestTimeout = 300_000` and `headersTimeout = 60_000` sit at or above it,
  so the platform kills the function first. §8's "Ingestion timeout — what
  actually exists" note stands.
- **It costs nothing the attacker can convert.** The stall happens before the
  rate-limit RPC and before any provider call, so a held request charges no
  quota, bills no provider and returns no price. The cost is one occupied
  function instance for up to 60 s.
- **It is not an entitlement bug.** No honest user loses a scan to it.

The exposure is therefore concurrency/resource, bounded at 60 s per connection,
against a platform that reuses instances across concurrent requests.

### A safe implementation exists, and it needs no new number

The instruction for round 9 was to propose one only if it introduces no
arbitrary timeout and no new product policy. It does not have to:

> **The deadline already exists and is already decisive.** A request still
> ingesting at `TREQ + 10_000 ms` is, by the arithmetic above, *guaranteed* to be
> refused by the gate at `:3963` the moment its body finally arrives. Aborting
> the read at that same instant changes **no outcome** — same `503`, same
> `INGESTION_TOO_SLOW` code, same "no quota charged, no provider called" — it
> changes only **when** the identical refusal is issued, and releases the
> instance up to ~50 s earlier.

Concretely: pass the already-computed deadline into `readBodyBounded` and have
it stop consuming when the clock crosses it, exactly as it already stops when
the byte count crosses `REQUEST_BODY_MAX_BYTES`. The deadline is
`BUDGET_MS − STAGE1_INTENDED_CAP_MS − STAGE1_BUDGET_RESERVE_MS` from `TREQ` —
derived from the three constants Stage 1 already uses, with no fourth constant
introduced. A `BodyDeadlineError` would map to the same 503 the gate produces,
so the client contract is unchanged.

### Why round 9 did not implement it

1. It is a **runtime behaviour change on the ingestion path**, and round 9 is
   explicitly scoped to leave ingestion behaviour and thresholds alone. The
   change is outcome-neutral by the argument above, but "outcome-neutral by
   argument" is exactly the class of claim this ticket's history says should be
   demonstrated before it is believed.
2. It needs its own regression coverage: a client that stalls **mid-body** and
   never completes, driven against a real HTTP server. `tests/ingestion-boundary.test.mjs`
   already has the harness shape for it (`drive({ bodyChunks, stallMs })` at
   `:70`), but every existing case stalls and then *finishes*; none of them
   never-finishes, and that is the case being defended against.
3. The severity does not force it. Nothing in round 9 raised it.

**Disposition: MEDIUM, open, proposed, unimplemented.** The proposal above is
the recommended shape; the new ticket should carry the never-completing-client
test, not just the change.

## Entitlement / UX — still unresolved, still a product decision

Unchanged by round 9 and restated so it is not mistaken for a security item:

- A user on a slow connection is refused at **10 s of ingestion** with
  `503 INGESTION_TOO_SLOW`, `retryable: true`.
- **The client does not retry**, despite `retryable: true`. The flag is
  advisory and nothing acts on it.
- Round 8 established the boundary empirically: ~9.9 s passes, ~9.95 s does not.
- Nobody chose 10 s. It is `50 − 28 − 12`.

These four facts are a **product/UX decision**, not a security defect, and
round 9 deliberately did not mix them back into the security work. The
`INGESTION_TOO_SLOW` threshold, the quota policy, the retry policy, the provider
budget and the 50 s request budget are all **unchanged**.

The open question for that decision — the same A/B split this ticket exists to
name — is whether a user who cannot upload in 10 s should see a refusal at all,
or should be served by a path that does not require the full provider budget.
Answering it means changing a threshold or adding a path, and both are outside a
stabilisation round.
