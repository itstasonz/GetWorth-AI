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
