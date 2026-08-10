#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// UI-002A — MUTATION HARNESS for the interaction and CSS contract suites.
//
// Answers the question those suites cannot answer about themselves: "if one of
// the UI-002A fixes were silently reverted, would any test notice?"
//
// For each mutant in ui-mutants.mjs: write a broken COPY of its target BESIDE
// the original, point the suite at the copy through an env var, and run the
// suite. The suite is expected to FAIL.
//
//   KILLED   — the suite failed. The invariant is genuinely protected.
//   SURVIVED — the suite passed against broken code. THAT IS A TEST GAP.
//   MALFORMED— the mutant no longer matches the source (a refactor moved it).
//              Treated as a failure so the harness can never silently rot into
//              reporting a perfect score against code it isn't actually testing.
//
// The real files are never written to. Exit code is 0 only when every mutant is
// KILLED and every suite was green to begin with.
//
//   node tests/mutations/ui-run.mjs
//   node tests/mutations/ui-run.mjs --list
//   node tests/mutations/ui-run.mjs --filter U07
//   node tests/mutations/ui-run.mjs --verbose      (show the failing suite output)
// ══════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_MUTANTS, TARGETS } from './ui-mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const abs = (p) => join(REPO, p);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};

const VERBOSE = has('--verbose');
const filter = valueOf('--filter');

if (has('--list')) {
  for (const m of UI_MUTANTS) console.log(`${m.id.padEnd(36)} ${m.target.padEnd(9)} ${m.invariant}`);
  console.log(`\n${UI_MUTANTS.length} mutants.`);
  process.exit(0);
}

// Mutant copies live in the working tree (they have to — relative imports and
// Tailwind's content globs resolve from the file's own directory). Nothing may
// survive the run, including a run killed with ^C, so removal is registered
// before the first file is ever written.
const sweep = () => {
  for (const t of Object.values(TARGETS)) rmSync(abs(t.mutant), { force: true });
};
sweep();
process.on('exit', sweep);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { sweep(); process.exit(130); });
}

const sources = Object.fromEntries(
  Object.entries(TARGETS).map(([k, t]) => [k, readFileSync(abs(t.src), 'utf8')])
);

const runSuite = (suite, env) =>
  spawnSync(process.execPath, ['--test', '--test-reporter=tap', abs(suite)], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 180000,
  });

/**
 * Judge a mutant with the LINTER instead of a test suite, differentially.
 *
 * Some invariants are invisible to a DOM test by construction. `items-${align}`
 * and a lookup table produce byte-identical runtime markup — the difference is
 * that Tailwind's build-time text scanner never sees the interpolated name, so
 * the utility is never emitted and the prop silently does nothing. No jsdom
 * assertion can observe that; only source inspection can.
 *
 * A plain pass/fail lint cannot answer it either: a whole-file copy of a legacy
 * view is over a zeroed ledger whether or not it was mutated. So each file is
 * linted ALONE, before and after, and the mutant is killed only if the mutation
 * made some rule's count go up.
 */
const lintCounts = (fileName, contents) => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-mut-lint-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', fileName), contents, 'utf8');
    const r = spawnSync(process.execPath, [abs('scripts/design-lint.mjs'), '--json', '--fixture'], {
      cwd: REPO,
      env: { ...process.env, DESIGN_LINT_SRC: join(dir, 'src') },
      encoding: 'utf8',
      timeout: 60000,
    });
    if (r.status !== 0) return null;
    return JSON.parse(r.stdout).counts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const judgeByLint = (m, target, original, mutated) => {
  const name = basename(target.src);
  const before = lintCounts(name, original);
  const after = lintCounts(name, mutated);

  // A linter that failed to run is INFRASTRUCTURE breakage, not a test gap.
  // Reporting it as SURVIVED is the same confusion MALFORMED exists to prevent:
  // it would print "the suites do not enforce this" when the truth is that
  // nothing was measured at all.
  if (!before || !after) return { error: 'the linter did not report counts — cannot judge' };

  const raised = Object.keys(after).filter((id) => after[id] > before[id]);

  // The mutant must be caught by the rule it NAMES. Accepting any risen rule
  // lets a mutant kill itself on something incidental — a `replace` that happens
  // to introduce a hex literal or a rounded-2xl would score as a kill while the
  // invariant it claims to protect goes unenforced.
  if (!m.expectRule) return { error: `mutant ${m.id} is lint-judged but names no expectRule` };
  const killed = raised.includes(m.expectRule);
  const incidental = raised.filter((id) => id !== m.expectRule);

  return {
    killed,
    detail: killed
      ? `${m.expectRule} rose${incidental.length ? ` (also, incidentally: ${incidental.join(', ')})` : ''}`
      : raised.length
        ? `${m.expectRule} did NOT rise; only ${raised.join(', ')} did`
        : 'no rule noticed the change',
  };
};

const selected = filter ? UI_MUTANTS.filter((m) => m.id.includes(filter)) : UI_MUTANTS;
if (!selected.length) {
  console.error(`No mutant matches --filter ${filter}`);
  process.exit(2);
}

// ── Baseline ────────────────────────────────────────────────────────────────
// A suite that is ALREADY failing kills every mutant for the wrong reason and
// reports a flawless 100%. Establish that each one is green against the real
// source before believing anything it says about broken source.
const suites = [...new Set(selected.filter((m) => m.suite !== 'lint').map((m) => TARGETS[m.target].suite))];
console.log(`UI-002A/B mutation run — ${selected.length} mutants across ${suites.length} suite(s)\n`);

// Lint-judged mutants need the linter itself to be green on the real tree first,
// for the same reason the suites do.
if (selected.some((m) => m.suite === 'lint')) {
  const base = spawnSync(process.execPath, [abs('scripts/design-lint.mjs')], { cwd: REPO, encoding: 'utf8' });
  if (base.status !== 0) {
    console.error('FATAL: scripts/design-lint.mjs does not pass against the unmodified tree.');
    if (VERBOSE) console.error(base.stdout || base.stderr);
    process.exit(2);
  }
  console.log('  baseline ok  scripts/design-lint.mjs');
}

for (const s of suites) {
  const base = runSuite(s, {});
  if (base.status !== 0) {
    console.error(`FATAL: ${s} does not pass against unmodified source.\n` +
      'Every mutant would "die" of that pre-existing failure and the score would be meaningless.');
    if (VERBOSE) console.error(base.stdout || base.stderr);
    process.exit(2);
  }
  console.log(`  baseline ok  ${s}`);
}
console.log('');

// ── Run ─────────────────────────────────────────────────────────────────────
const killed = [];
const survived = [];
const malformed = [];
// Harness failure, kept strictly separate from SURVIVED. A mutant that could not
// be judged tells you nothing about the tests; conflating the two turns a broken
// harness into a report about the test suite.
const broken = [];

/**
 * Refuse to judge anything if a target changed on disk since startup.
 *
 * This harness is NOT concurrency-safe, by design: mutant copies go to fixed
 * paths in the working tree (relative imports and Tailwind's content globs have
 * to resolve from the file's own directory) and the suites share a rolldown
 * output dir. So a second run — or a person editing a source file — while one is
 * in flight makes the two stomp each other, and `sweep()` on startup deletes the
 * in-flight run's mutant out from under it.
 *
 * The failure mode is silent and INVERTED: a mutant that should be KILLED gets
 * reported as SURVIVED, i.e. a phantom test gap. During UI-003 wave 0 that cost
 * three specialists real time — one chased a focus-restore bug that did not
 * exist, and three separate "80/80 killed" claims turned out to describe
 * different trees. A score that varies run to run cannot support the claim this
 * harness exists to make.
 *
 * Fixing the concurrency properly means per-run mutant paths and a PID-keyed
 * cache dir. Until then this makes the corruption LOUD rather than silent, which
 * is the same reasoning behind MALFORMED and `broken`: never report a number
 * that was not actually measured.
 */
const assertTreeUnchanged = (why) => {
  for (const [key, t] of Object.entries(TARGETS)) {
    if (readFileSync(abs(t.src), 'utf8') !== sources[key]) {
      console.error(
        `\nFATAL: ${t.src} changed on disk during the run (${why}).\n` +
        'Another mutation run or an editor is writing to this tree. Results up to this\n' +
        'point are unreliable — a killed mutant can be misreported as SURVIVED. Re-run\n' +
        'with exclusive access to the working tree.'
      );
      process.exit(2);
    }
  }
};

for (const m of selected) {
  const target = TARGETS[m.target];
  const source = sources[m.target];
  const edits = m.edits ?? [{ find: m.find, replace: m.replace }];

  assertTreeUnchanged(`before ${m.id}`);

  // Each edit must pin exactly one site IN THE ORIGINAL. Zero means the code
  // moved; many means the mutation is ambiguous and we would not know what we
  // actually broke.
  const bad = edits.find((e) => source.split(e.find).length - 1 !== 1);
  if (bad) {
    const n = source.split(bad.find).length - 1;
    malformed.push({ ...m, occurrences: n, find: bad.find });
    console.log(`  MALFORMED  ${m.id}  (find matched ${n}x in ${target.src}, expected 1)`);
    continue;
  }

  let mutated = source;
  for (const e of edits) mutated = mutated.replace(e.find, e.replace);

  // Judged by source inspection rather than by a suite — see judgeByLint. These
  // never touch the working tree at all.
  if (m.suite === 'lint') {
    const { killed: died, detail, error } = judgeByLint(m, target, source, mutated);
    if (error) {
      broken.push({ ...m, error });
      console.log(`  BROKEN     ${m.id}  (${error})`);
    } else if (died) {
      killed.push(m);
      console.log(`  killed     ${m.id}  (lint: ${detail})`);
    } else {
      survived.push(m);
      console.log(`  SURVIVED   ${m.id}  ← TEST GAP: ${m.invariant} [${detail}]`);
    }
    continue;
  }

  writeFileSync(abs(target.mutant), mutated, 'utf8');
  try {
    const run = runSuite(target.suite, { [target.env]: abs(target.mutant) });

    // Exit 0 = the suite passed against deliberately broken code.
    if (run.status === 0) {
      survived.push(m);
      console.log(`  SURVIVED   ${m.id}  ← TEST GAP: ${m.invariant}`);
    } else {
      killed.push(m);
      const failing = (run.stdout || '').match(/^\s*not ok \d+ - (.+)$/gm) || [];
      const names = failing.slice(0, 2).map((l) => l.replace(/^\s*not ok \d+ - /, '').trim()).join('; ');
      console.log(`  killed     ${m.id}  (${failing.length} failing${names ? `: ${names}` : ''})`);
      if (VERBOSE) console.log((run.stdout || run.stderr || '').split('\n').slice(0, 40).join('\n'));
    }
  } finally {
    rmSync(abs(target.mutant), { force: true });
  }
}

const scored = selected.length - broken.length;
const score = scored ? ((killed.length / scored) * 100).toFixed(1) : '0.0';
console.log(`\n──────────────────────────────────────────────────────────────`);
console.log(`killed ${killed.length}/${scored}   survived ${survived.length}   malformed ${malformed.length}   broken ${broken.length}   score ${score}%`);

if (survived.length) {
  console.log('\nSURVIVING MUTANTS — the suites do not actually enforce these:');
  for (const m of survived) {
    console.log(`  ${m.id}\n    ${m.invariant}\n    expected to be caught by: ${(m.kills || []).join('; ') || '(unstated)'}`);
  }
}
if (malformed.length) {
  console.log('\nMALFORMED MUTANTS — the source was refactored; re-pin these in ui-mutants.mjs:');
  for (const m of malformed) {
    console.log(`  ${m.id} (matched ${m.occurrences}x)\n    find: ${m.find.split('\n')[0].slice(0, 100)}`);
  }
}

if (broken.length) {
  console.log('\nBROKEN MUTANTS — the harness could not judge these. This is harness breakage,');
  console.log('NOT a statement about the tests:');
  for (const m of broken) console.log(`  ${m.id}\n    ${m.error}`);
}

const ok = survived.length === 0 && malformed.length === 0 && broken.length === 0;
console.log(ok ? '\nAll mutants killed — the UI-002A suites enforce every listed invariant.' : '\nFAILED.');
process.exit(ok ? 0 : 1);
