/**
 * UI-002B — the linter, tested.
 *
 * scripts/design-lint.mjs is the only thing standing between the design system
 * and a slow return to 340 literals. It was itself untested, which is a specific
 * and well-known failure mode: a lint rule whose regex stops matching after a
 * refactor does not fail loudly — it reports a clean build, forever, and the
 * number in the ledger becomes a monument to a rule that no longer runs.
 *
 * So every rule here is proved to FIRE on a real violation, and the ratchet is
 * proved to REFUSE a raise. The linter imports only node builtins, so unlike
 * ui.jsx a copy of it runs correctly from a temp directory; fixtures are written
 * to a temp tree and the copy is pointed at them with DESIGN_LINT_SRC.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
// Overridable so tests/mutations/ui-run.mjs can ask the decisive question about
// this suite too: if the ratchet were quietly reverted, would anything notice?
const REAL_LINT = process.env.UI002B_LINT_PATH || join(ROOT, 'scripts/design-lint.mjs');

let work;
before(() => { work = mkdtempSync(join(tmpdir(), 'gw-lint-')); });
after(() => rmSync(work, { recursive: true, force: true }));

const source = () => readFileSync(REAL_LINT, 'utf8');

/** Every budget id declared in the ledger. */
const budgetIds = () => [...source().matchAll(/^\s*'([a-z-]+)':\s*\d+,/gm)].map((m) => m[1]);

/**
 * A copy of the linter with every budget forced to `value`. Zeroing them is what
 * lets a one-violation fixture prove a rule fires, regardless of what the real
 * ledger currently tolerates.
 */
const lintCopy = (name, value = 0) => {
  const path = join(work, `${name}.mjs`);
  writeFileSync(path, source().replace(/^(\s*'[a-z-]+':\s*)\d+,/gm, `$1${value},`), 'utf8');
  return path;
};

/** A fixture source tree containing one file. */
const fixture = (name, filename, content) => {
  const dir = join(work, `src-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf8');
  return dir;
};

// `--fixture` is required for the env overrides to be honoured at all. Without
// it the linter always reads the real src/, which is what stops a stray
// environment variable from disabling the gate.
const run = (lint, src, args = []) =>
  spawnSync(process.execPath, [lint, '--fixture', ...args], {
    cwd: ROOT,
    env: { ...process.env, DESIGN_LINT_SRC: src },
    encoding: 'utf8',
  });

// ── Every rule must actually fire ───────────────────────────────────────────
// One violation each, against a zeroed ledger. If any of these passes, that
// rule is decoration.
describe('each rule fires on a real violation', () => {
  const VIOLATIONS = {
    'raw-hex':             `export const a = <div style={{ color: '#6FEEE1' }} />;`,
    'tiny-type':           `export const a = <p className="text-[10px]">x</p>;`,
    'emoji-in-jsx':        `export const a = <span>\u{1F3C6} Top</span>;`,
    'off-ladder-alpha':    `export const a = <div className="bg-accent/37" />;`,
    'legacy-token-object': `const STITCH = { primary: 'x' };`,
    'promotional-copy':    `export const a = <span>{'HOT DEAL'}</span>;`,
    'decorative-gradient': `export const a = <div className="bg-gradient-to-r from-x to-y" />;`,
    'glassmorphism':       `export const a = <div className="backdrop-blur-md" />;`,
    'ad-hoc-shadow':       `export const a = <div className="shadow-2xl" />;`,
    'arbitrary-radius':    `export const a = <div className="rounded-2xl" />;`,
    'interpolated-class':  'export const a = (a) => <div className={`items-${a}`} />;',
    'lint-suppression':    `export const a = <div className="rounded-2xl" />; // design-lint` + `-disable`,
    'legacy-token-import': `import { STITCH } from '../lib/tokens';`,
    'input-zoom-floor':    `export const a = <input className="text-sm" />;`,
  };

  for (const [rule, code] of Object.entries(VIOLATIONS)) {
    test(`${rule} is enforced, not merely declared`, () => {
      const r = run(lintCopy(`fire-${rule}`), fixture(`fire-${rule}`, 'probe.jsx', code));
      assert.notEqual(r.status, 0, `${rule} did not fail its own violation — the rule is dead`);
      assert.match(r.stdout, new RegExp(`FAIL\\s+${rule}\\s+`),
        `${rule} did not report itself as over budget`);
    });
  }

  // focus-suppression is verified separately: its patterns cannot be written
  // literally in a file under src/ (Tailwind's scanner would re-emit the
  // utility into the bundle), so the fixture assembles the token at runtime the
  // same way the rule itself does.
  test('focus-suppression is enforced, not merely declared', () => {
    const src = fixture('fire-focus', 'probe.jsx',
      `export const a = <button className={['focus:' + 'outline-none'].join('')} />;`);
    const r = run(lintCopy('fire-focus'), src);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /FAIL\s+focus-suppression\s+/);
  });
});

// ── Clean code must pass ────────────────────────────────────────────────────
describe('a clean tree passes', () => {
  test('token-only markup trips nothing', () => {
    const r = run(lintCopy('clean'), fixture('clean', 'ok.jsx',
      `export const a = <div className="bg-surface border border-subtle rounded-container p-4">
         <p className="text-body text-text-primary">Camera</p>
       </div>;`));
    assert.equal(r.status, 0, `clean source failed the lint:\n${r.stdout}`);
    assert.match(r.stdout, /No new design-system violations/);
  });

  test('the escape hatch suppresses its line, but is itself counted', () => {
    // Suppression must work — a scrim that genuinely aids legibility needs a way
    // out — but it may not be free, or it becomes the cheapest way to silence
    // every rule in the file. So the gradient is suppressed AND the suppression
    // is reported under its own budget.
    const marker = '// design-lint' + '-disable';
    const r = run(lintCopy('escape', 1), fixture('escape', 'ok.jsx',
      `export const scrim = <div className="bg-gradient-to-t from-black" />; ${marker}`));
    assert.equal(r.status, 0, `the hatch did not suppress the violation:\n${r.stdout}`);
    assert.match(r.stdout, /lint-suppression\s+1\s*\/\s*1/, 'the suppression was not counted');
    assert.match(r.stdout, /decorative-gradient\s+0\s*\//, 'the gradient should have been suppressed');
  });

  test('interpolating a WHOLE class name is legitimate', () => {
    // `${animClass} ${className}` is the normal, correct way to compose class
    // strings and appears throughout the codebase. Only a PARTIAL utility
    // completed by a value is the hazard, so the rule must not fire here or it
    // would be switched off within a day.
    const r = run(lintCopy('whole-class'), fixture('whole-class', 'ok.jsx',
      'export const a = ({ animClass, className }) => <div className={`${animClass} ${className}`} />;'));
    assert.equal(r.status, 0, `interpolating a whole class name tripped the rule:\n${r.stdout}`);
  });

  test('a rule name inside a COMMENT is not itself a violation', () => {
    // Documentation that names an anti-pattern must not be an anti-pattern, or
    // the design system cannot describe what it bans.
    const r = run(lintCopy('comment'), fixture('comment', 'ok.jsx',
      `// Never use backdrop-blur-md or a bg-gradient-to-r here.\nexport const a = <div />;`));
    assert.equal(r.status, 0, `a comment tripped a rule:\n${r.stdout}`);
  });
});

// ── The corpus cannot be redirected ─────────────────────────────────────────
// The first version of the fixture support read DESIGN_LINT_SRC straight from
// the environment, so `DESIGN_LINT_SRC=/tmp/empty npm test` passed all rules and
// exited 0. `npm test` inherits the caller's environment, so that disabled the
// whole gate with one variable. A gate whose corpus is caller-supplied is not a
// gate.
describe('the linted corpus is not caller-supplied', () => {
  test('an env var alone cannot redirect the linter at an empty tree', () => {
    const empty = join(work, 'empty-src');
    mkdirSync(empty, { recursive: true });

    // Deliberately the SHIPPED linter, not a copy. Without --fixture the linter
    // resolves src/ from its own location, so a copy in a temp directory would
    // fail for want of a sibling src/ whether or not it was mutated — this test
    // must be location-independent to mean anything.
    const shipped = join(ROOT, 'scripts/design-lint.mjs');
    const r = spawnSync(process.execPath, [shipped], {
      cwd: ROOT,
      env: { ...process.env, DESIGN_LINT_SRC: empty },
      encoding: 'utf8',
    });

    const counted = Number(r.stdout.match(/raw-hex\s+(\d+)/)?.[1] ?? 0);
    assert.ok(counted > 0,
      `raw-hex counted ${counted} — the env var redirected the corpus and the gate is bypassable`);
  });

  test('an env var alone cannot redirect where --update writes', () => {
    const decoy = join(work, 'decoy-ledger.mjs');
    writeFileSync(decoy, source(), 'utf8');
    const before = readFileSync(decoy, 'utf8');

    spawnSync(process.execPath, [join(ROOT, 'scripts/design-lint.mjs'), '--update'], {
      cwd: ROOT,
      env: { ...process.env, DESIGN_LINT_SELF: decoy },
      encoding: 'utf8',
    });

    assert.equal(readFileSync(decoy, 'utf8'), before,
      'DESIGN_LINT_SELF redirected the write target without --fixture');
  });
});

// ── The ratchet ─────────────────────────────────────────────────────────────
// This is the property that makes every budget above meaningful. --update used
// to rewrite each budget to the CURRENT count, so a regression could be laundered
// into the ledger by one command, in a diff line indistinguishable from progress.
describe('--update is a ratchet, not a rubber stamp', () => {
  test('REFUSES to raise a budget, and writes nothing', () => {
    const lint = lintCopy('raise');
    const before = readFileSync(lint, 'utf8');
    const src = fixture('raise', 'bad.jsx',
      `export const a = <div className="rounded-2xl shadow-2xl backdrop-blur-md" />;`);

    const r = run(lint, src, ['--update']);

    assert.notEqual(r.status, 0, '--update accepted a regression');
    assert.match(r.stderr, /Refusing to update/);
    assert.equal(readFileSync(lint, 'utf8'), before,
      '--update modified the ledger while refusing — the refusal must be total');
  });

  test('lowers a budget when the tree is genuinely cleaner', () => {
    const lint = lintCopy('lower', 9);           // every budget starts at 9
    const src = fixture('lower', 'ok.jsx', `export const a = <div className="bg-surface" />;`);

    const r = run(lint, src, ['--update']);

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ratcheted down/);
    const after = readFileSync(lint, 'utf8');
    assert.ok(!/^\s*'[a-z-]+':\s*9,/m.test(after), 'budgets were not rewritten');
    assert.match(after, /'raw-hex':\s*0,/);
  });

  test('is a no-op when the ledger already matches reality', () => {
    const lint = lintCopy('noop', 0);
    const before = readFileSync(lint, 'utf8');
    const r = run(lint, fixture('noop', 'ok.jsx', `export const a = <div />;`), ['--update']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /nothing to lower/);
    assert.equal(readFileSync(lint, 'utf8'), before);
  });

  test('no flag bypasses the refusal', () => {
    // Asserted behaviourally rather than by grepping for the string "--force":
    // the linter's own header explains that no such escape hatch exists, and a
    // source match would be satisfied by that sentence. What matters is that
    // nothing in argv is READ as permission to raise a budget.
    assert.ok(!/argv[^\n]*['"]--force['"]|['"]--force['"][^\n]*argv/.test(source()),
      'the linter reads a --force flag from argv');

    const src = fixture('force', 'bad.jsx', `export const a = <div className="rounded-2xl" />;`);
    for (const flag of ['--force', '--yes', '-f', '--allow-raise']) {
      const lint = lintCopy(`force${flag.replace(/-/g, '')}`);
      const before = readFileSync(lint, 'utf8');
      const r = run(lint, src, ['--update', flag]);
      assert.notEqual(r.status, 0, `${flag} bypassed the ratchet`);
      assert.equal(readFileSync(lint, 'utf8'), before, `${flag} caused a write`);
    }
  });
});

// ── --json is a load-bearing public contract ────────────────────────────────
// tests/mutations/ui-run.mjs judges lint mutants by diffing these counts. If the
// shape regressed, every lint-judged mutant would be reported as unjudgeable —
// so the contract needs its own test rather than being verified by the harness
// that depends on it.
describe('--json', () => {
  test('emits a count for every ledger rule', () => {
    const r = run(lintCopy('json'), fixture('json', 'probe.jsx',
      `export const a = <div className="rounded-2xl" style={{ color: '#6FEEE1' }} />;`), ['--json']);
    assert.equal(r.status, 0, r.stderr);

    const parsed = JSON.parse(r.stdout);
    assert.ok(parsed.counts, '--json must emit a `counts` object');
    for (const id of budgetIds()) {
      assert.equal(typeof parsed.counts[id], 'number', `--json omitted a count for ${id}`);
    }
    assert.equal(parsed.counts['arbitrary-radius'], 1);
    assert.equal(parsed.counts['raw-hex'], 1);
  });

  test('exits 0 even when the tree is over budget, so counts are always readable', () => {
    // The differential judge needs numbers from a file that is by construction
    // over a zeroed ledger; a non-zero exit would make it unjudgeable.
    const r = run(lintCopy('json-over'), fixture('json-over', 'bad.jsx',
      `export const a = <div className="rounded-2xl shadow-2xl backdrop-blur-md" />;`), ['--json']);
    assert.equal(r.status, 0, '--json must not adopt the pass/fail exit code');
    assert.ok(JSON.parse(r.stdout).counts['glassmorphism'] >= 1);
  });
});

// ── The ledger must stay honest ─────────────────────────────────────────────
describe('the budget ledger is complete', () => {
  test('every rule has a budget and every budget has a rule', () => {
    // A rule with no budget entry reads `undefined` as its maximum, and
    // `n > undefined` is false — so it can never fail. That is a rule that
    // silently does nothing, which is worse than no rule at all.
    const src = source();
    const ruleIds = [...src.matchAll(/^\s*id:\s*'([a-z-]+)',/gm)].map((m) => m[1]);
    const budgets = budgetIds();

    assert.deepEqual(ruleIds.filter((id) => !budgets.includes(id)), [],
      'rule(s) with no budget entry can never fail');
    assert.deepEqual(budgets.filter((id) => !ruleIds.includes(id)), [],
      'budget entry with no rule — a number nothing produces');
    assert.ok(ruleIds.length >= 13, `expected the full rule set, found ${ruleIds.length}`);
  });

  test('the hard-zero accessibility rules are still zero', () => {
    // These are not migration budgets. Each was fixed completely in UI-002A and
    // a single reintroduction is a real accessibility regression, so they must
    // never be allowed to drift upward even by a legitimate-looking edit.
    for (const id of ['focus-suppression', 'input-zoom-floor', 'promotional-copy', 'legacy-token-object']) {
      assert.match(source(), new RegExp(`'${id}':\\s*0,`), `${id} is no longer a hard zero`);
    }
  });
});
