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

Both windows are narrow (Anthropic's non-streaming endpoint normally emits
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

So the current policy **refunds some billed attempts** (abort/network cases) and
**consumes some unbilled ones** is not claimed either way. Any accounting design
must treat these as **UNKNOWN billing state**, not assume free. Inventing
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
