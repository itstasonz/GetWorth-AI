> Two harnesses live here, sharing one idea. `run.mjs` + `mutants.mjs` cover the
> VAL-001 valuation guard (below); `ui-run.mjs` + `ui-mutants.mjs` cover the
> UI-002A interaction and CSS contract suites (at the end of this file).
> `npm run test:mutation` runs both.

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

---

# UI-002A — Mutation harness for the interaction and CSS suites

Same question, different code: **if one of the UI-002A fixes were silently
reverted, would any test notice?**

```bash
node tests/mutations/ui-run.mjs              # full run
node tests/mutations/ui-run.mjs --list       # catalog, no execution
node tests/mutations/ui-run.mjs --filter U07 # one mutant
node tests/mutations/ui-run.mjs --verbose    # show the failing suite output
```

This is worth having here in particular because **every defect UI-002A fixed
rendered correctly**. The markup was right in all of them; the bug lived in
focus movement, timer lifetime, event ownership, or a stylesheet that quietly
emitted no rule. Assertions about that class of behaviour are unusually easy to
write in a way that passes without checking anything, so the assertions
themselves need checking.

## How it works

For each entry in `ui-mutants.mjs` the runner writes a broken **copy** of its
target *beside* the original — `src/components/ui.__mutant__.jsx` and friends —
points the suite at it through an env var (`UI002A_UI_PATH`, `UI002A_CSS_PATH`,
`UI002A_TW_CONFIG`, …) and runs the suite. Real files are never written to.

Placement beside the original is load-bearing: `./ui`, `../lib/utils`, the
Tailwind content globs and the `@tailwind` directives all resolve from the
file's own directory, so a copy in a temp dir would fail for reasons unrelated
to the mutation and every mutant would "die" spuriously. Copies are removed on
exit, including on `^C`; `*.__mutant__.*` is gitignored as the net for a hard
kill.

Before scoring anything, the runner asserts each suite is **green against
unmodified source**. An already-failing suite kills every mutant for the wrong
reason and reports a flawless 100%.

| Target | File | Suite |
|---|---|---|
| `ui` | `src/components/ui.jsx` | interaction |
| `card` | `src/components/ListingCard.jsx` | interaction |
| `utils` | `src/lib/utils.js` | interaction |
| `css` | `src/index.css` | CSS contract |
| `tailwind` | `tailwind.config.js` | CSS contract |
| `html` | `index.html` | CSS contract |

## Layered defences need multi-line mutants

Some invariants are held by more than one guard. A sheet rejects an inside click
via *both* the scrim's target check and the panel's `stopPropagation`; removing
either alone leaves the behaviour correct, so a single-line mutant would survive
for a good reason and be indistinguishable in the report from a genuine test
gap. Those entries carry `edits: [...]` and remove every layer at once.

## Adding a mutant

```js
{
  id: 'U41-SHORT-SLUG',
  target: 'ui',                  // key in TARGETS
  invariant: 'The one sentence a reader must believe after this test passes.',
  kills: ['name of the test expected to catch it'],   // documentation only
  find: 'exact source substring, must match exactly once',
  replace: 'the broken version (must still parse)',
}
```

If it survives, you have found a test gap — write the test that kills it.
