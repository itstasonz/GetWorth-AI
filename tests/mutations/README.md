# VAL-001 — Mutation harness for the valuation guard

The contract suite (`tests/valuation-guard.test.mjs`) proves the guard behaves
correctly. It cannot prove anything about *itself* — a test that asserts a
weaker property than the one it names still passes, forever, and looks green.

This harness answers the different question: **if the guard silently lost one of
its safety rules, would any test notice?**

```bash
node tests/mutations/run.mjs              # full run
node tests/mutations/run.mjs --list       # catalog, no execution
node tests/mutations/run.mjs --filter M14 # one mutant
node tests/mutations/run.mjs --verbose    # show the failing suite output
```

Exit code is 0 only when every scored mutant is killed.

## How it works

For each entry in `mutants.mjs`, the runner writes a **copy** of
`api/_lib/valuation-guard.js` to a temp dir with one safety rule broken, points
the contract suite at it via the `VAL001_GUARD_PATH` env var, and runs the suite.
The real module is never written to.

| Outcome | Meaning |
|---|---|
| `killed` | The suite failed. The invariant is genuinely enforced. |
| `SURVIVED` | The suite **passed against broken code**. This is a test gap — fix the test, not the guard. |
| `equivalent` | Survives by design; see below. Excluded from the score. |
| `MALFORMED` | The mutant's `find` no longer matches the source. Fails the run. |

`MALFORMED` is deliberately fatal. A refactor that moves guard code would
otherwise leave mutants silently matching nothing, and the harness would report
a perfect score while testing nothing at all. If you refactor the guard, re-pin
the affected `find` strings.

## Equivalent mutants

Three mutants survive because the guard has **redundant depth**: a later rule
already rejects every input the mutated rule would have caught, so the mutation
cannot produce an observably different verdict. These are marked with an
`equivalent:` field carrying the justification, and are excluded from the score
denominator — no test can kill them, so counting them would cap the achievable
score below 100% and destroy the number's value as a pass/fail signal.

Each was classified by **differential probe** (running the real and mutated guard
side by side across the rule's input space and diffing the verdicts), not by
assumption. Do not mark a mutant equivalent because it is inconvenient — if it
changes any verdict, it is a gap.

Currently equivalent:

- **M06** — a non-positive `low` makes `high/low` non-positive, so `V-SPREAD-MIN`
  degrades it first.
- **M16** — `R-SPREAD-CLAMP` mathematically guarantees the ratio that the
  post-repair `V-SPREAD-MAX` check re-tests, making that check unreachable.
- **M19** — a negative multiplier yields a negative mid, which the
  post-transform `prices.mid <= 0` check degrades anyway.

All three are worth keeping: they are backstops against a future bug in the rule
that currently shadows them.

## What this harness has already found

The first full run scored **59.1%** and exposed six real holes, all now closed by
the `M-01`..`M-06` tests in section H of the contract suite:

| Mutant | Hole in the suite |
|---|---|
| M07 | An unordered triple (`low > mid`) was silently repaired into an ordered one and shipped graded HIGH, instead of degrading. |
| M12 | `S-03` asserted the *source* of a PRE catalog row but passed `null` for the grade, so `LOW → MEDIUM` grade inflation went unnoticed. |
| M14 | `DEGRADE-NEVER-CLAMP` only proved `mid` was not rewritten to a *bound*. A degraded verdict could pass the **original rejected price** straight through. |
| M18 | The envelope was not re-asserted after the replica multiplier, so a ₪1 price could be emitted where the guard should degrade. |
| M21 | The suite **re-implemented** `conditionDelta` as a local `residual()` helper, so `C-04`..`C-07` tested the test rather than the module — `conditionDelta` could return `NaN` and all four still passed. |
| M22 | `C-08` only varied `ctx.recognition.visual_features.condition`; condition math introduced via the quote's own higher-priority `condition` field was invisible. |

M21 is the one to remember: a test file that re-implements the logic it is
testing will pass no matter what the production code does.

## Adding a mutant

Add to `MUTANTS` in `mutants.mjs`:

```js
{
  id: 'M23-SHORT-SLUG',
  invariant: 'The one sentence a reader must believe after this test passes.',
  kills: ['CONTRACT-TEST-ID'],   // documentation; not enforced by the runner
  find: 'exact source substring, must match exactly once',
  replace: 'the broken version (must still parse as valid JS)',
}
```

Then run it. If it survives, you have found a test gap — write the contract test
that kills it, in section H, naming the mutant.
