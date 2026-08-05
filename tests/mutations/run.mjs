#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// VAL-001 — MUTATION HARNESS for api/_lib/valuation-guard.js
//
// Answers the question the contract suite cannot answer about itself: "if the
// guard silently lost one of its safety rules, would any test notice?"
//
// For each mutant in mutants.mjs: write a broken COPY of the guard under a temp
// dir, point tests/valuation-guard.test.mjs at it via VAL001_GUARD_PATH, and run
// the suite. The suite is expected to FAIL.
//
//   KILLED   — the suite failed. The invariant is genuinely protected.
//   SURVIVED — the suite passed against broken code. THAT IS A TEST GAP.
//   MALFORMED— the mutant no longer matches the source (a refactor moved it).
//              Treated as a failure so the harness can never silently rot into
//              reporting a perfect score against code it isn't actually testing.
//
// The real module is never written to. Exit code is 0 only when every mutant is
// KILLED.
//
//   node tests/mutations/run.mjs
//   node tests/mutations/run.mjs --list
//   node tests/mutations/run.mjs --filter M01
//   node tests/mutations/run.mjs --verbose      (show the failing suite output)
// ══════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const GUARD = join(REPO, 'api/_lib/valuation-guard.js');
const SUITE = join(REPO, 'tests/valuation-guard.test.mjs');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};

const VERBOSE = has('--verbose');
const filter = valueOf('--filter');

if (has('--list')) {
  for (const m of MUTANTS) console.log(`${m.id.padEnd(34)} ${m.invariant}`);
  console.log(`\n${MUTANTS.length} mutants.`);
  process.exit(0);
}

const source = readFileSync(GUARD, 'utf8');

// The suite imports the guard from an arbitrary path, so a guard that grew a
// relative import would resolve against the temp dir and fail for the wrong
// reason — every mutant would "die" of a module error and the score would be a
// meaningless 100%.
const relImport = source.match(/^\s*import\s[^\n]*from\s+['"]\.[^\n]*$/m);
if (relImport) {
  console.error(`FATAL: valuation-guard.js now has a relative import:\n  ${relImport[0].trim()}\n` +
    'Copying it to a temp dir would break resolution and every mutant would die spuriously.\n' +
    'Teach run.mjs to copy the dependency tree before trusting these results.');
  process.exit(2);
}

const selected = filter ? MUTANTS.filter((m) => m.id.includes(filter)) : MUTANTS;
if (!selected.length) {
  console.error(`No mutant matches --filter ${filter}`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'val001-mut-'));
const killed = [];
const survived = [];
const malformed = [];
const equivalent = [];

console.log(`VAL-001 mutation run — ${selected.length} mutants against tests/valuation-guard.test.mjs\n`);

for (const m of selected) {
  // A mutant must pin exactly one site. Zero means the code moved; many means
  // the mutation is ambiguous and we would not know what we actually broke.
  const occurrences = source.split(m.find).length - 1;
  if (occurrences !== 1) {
    malformed.push({ ...m, occurrences });
    console.log(`  MALFORMED  ${m.id}  (find matched ${occurrences}x, expected 1)`);
    continue;
  }

  const mutantPath = join(work, `${m.id}.guard.mjs`);
  writeFileSync(mutantPath, source.replace(m.find, m.replace), 'utf8');

  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', SUITE], {
    cwd: REPO,
    env: { ...process.env, VAL001_GUARD_PATH: mutantPath },
    encoding: 'utf8',
    timeout: 120000,
  });

  // Exit 0 = the whole contract suite passed against deliberately broken code.
  if (run.status === 0) {
    if (m.equivalent) {
      // Expected. A later rule already rejects everything this one would have,
      // so the mutant cannot produce an observably different verdict. Each of
      // these was verified by differential probe before being marked.
      equivalent.push(m);
      console.log(`  equivalent ${m.id}  (survives by design: ${m.equivalent})`);
    } else {
      survived.push(m);
      console.log(`  SURVIVED   ${m.id}  ← TEST GAP: ${m.invariant}`);
    }
  } else {
    killed.push(m);
    const failing = (run.stdout || '').match(/^\s*not ok \d+ - (.+)$/gm) || [];
    const names = failing.slice(0, 2).map((l) => l.replace(/^\s*not ok \d+ - /, '').trim()).join('; ');
    const tag = m.equivalent ? ' [marked equivalent but KILLED — drop the marker]' : '';
    console.log(`  killed     ${m.id}  (${failing.length} failing${names ? `: ${names}` : ''})${tag}`);
    if (VERBOSE) console.log((run.stdout || run.stderr || '').split('\n').slice(0, 40).join('\n'));
  }
}

rmSync(work, { recursive: true, force: true });

// Equivalent mutants are excluded from the denominator: no test can kill them,
// so counting them would cap the achievable score below 100% and make the number
// meaningless as a pass/fail signal.
const scored = selected.length - equivalent.length;
const score = scored ? ((killed.length / scored) * 100).toFixed(1) : '100.0';
console.log(`\n──────────────────────────────────────────────────────────────`);
console.log(`killed ${killed.length}/${scored}   survived ${survived.length}   equivalent ${equivalent.length} (excluded)   malformed ${malformed.length}   score ${score}%`);

if (survived.length) {
  console.log('\nSURVIVING MUTANTS — the suite does not actually enforce these:');
  for (const m of survived) console.log(`  ${m.id}\n    ${m.invariant}\n    expected to be caught by: ${(m.kills || []).join(', ') || '(unstated)'}`);
}
if (malformed.length) {
  console.log('\nMALFORMED MUTANTS — the guard was refactored; re-pin these in mutants.mjs:');
  for (const m of malformed) console.log(`  ${m.id} (matched ${m.occurrences}x)\n    find: ${m.find.split('\n')[0].slice(0, 100)}`);
}

const ok = survived.length === 0 && malformed.length === 0;
console.log(ok ? '\nAll mutants killed — the contract suite enforces every listed invariant.' : '\nFAILED.');
process.exit(ok ? 0 : 1);
