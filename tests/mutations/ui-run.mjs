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
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
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

const selected = filter ? UI_MUTANTS.filter((m) => m.id.includes(filter)) : UI_MUTANTS;
if (!selected.length) {
  console.error(`No mutant matches --filter ${filter}`);
  process.exit(2);
}

// ── Baseline ────────────────────────────────────────────────────────────────
// A suite that is ALREADY failing kills every mutant for the wrong reason and
// reports a flawless 100%. Establish that each one is green against the real
// source before believing anything it says about broken source.
const suites = [...new Set(selected.map((m) => TARGETS[m.target].suite))];
console.log(`UI-002A mutation run — ${selected.length} mutants across ${suites.length} suite(s)\n`);
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

for (const m of selected) {
  const target = TARGETS[m.target];
  const source = sources[m.target];
  const edits = m.edits ?? [{ find: m.find, replace: m.replace }];

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

const score = selected.length ? ((killed.length / selected.length) * 100).toFixed(1) : '100.0';
console.log(`\n──────────────────────────────────────────────────────────────`);
console.log(`killed ${killed.length}/${selected.length}   survived ${survived.length}   malformed ${malformed.length}   score ${score}%`);

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

const ok = survived.length === 0 && malformed.length === 0;
console.log(ok ? '\nAll mutants killed — the UI-002A suites enforce every listed invariant.' : '\nFAILED.');
process.exit(ok ? 0 : 1);
