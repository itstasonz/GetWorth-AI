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

// LINE ENDINGS ARE NORMALISED BEFORE ANYTHING MATCHES AGAINST THEM.
//
// The mutant catalog is written with LF, because that is what the committed
// blob holds. `core.autocrlf=true` and no `.gitattributes` mean the WORKING
// TREE is CRLF on Windows, and the apply step below is a literal substring
// match (`source.split(m.find)`). So every mutant whose `find` spans a newline
// matched ZERO times and was reported MALFORMED — 9 of 30, which is exactly
// the 9 multi-line ones. Score 66.7%, "the guard was refactored; re-pin these".
//
// None of that was true. The guard had not drifted, the mutants were correct,
// and the harness's own diagnostic was a false accusation that would have sent
// someone to rewrite nine correct mutants against correct code. A verification
// artefact that misreports WHY it failed is worse than one that simply fails.
//
// Normalising here fixes the comparison rather than the catalog, and makes the
// result identical on every platform. `.gitattributes` pins the checkout too,
// so a fresh clone cannot reintroduce it.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const source = readFileSync(GUARD, 'utf8').split(CR + LF).join(LF);

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
const invalid = [];
const equivalent = [];
const applied = [];

console.log(`VAL-001 mutation run — ${selected.length} mutants against tests/valuation-guard.test.mjs\n`);

for (const m of selected) {
  // A mutant must pin exactly one site. Zero means the code moved; many means
  // the mutation is ambiguous and we would not know what we actually broke.
  const occurrences = source.split(m.find).length - 1;
  if (occurrences !== 1) {
    invalid.push({ ...m, reason: `find matched ${occurrences}x, expected exactly 1` });
    console.log(`  INVALID    ${m.id}  (find matched ${occurrences}x, expected 1)`);
    continue;
  }

  // MUTATION_APPLIED = YES, proved rather than assumed. A replacement that
  // produced byte-identical text changed nothing, and a result read from it is
  // a lie in whichever direction it lands. Only APPLIED mutants are scored.
  const mutated = source.replace(m.find, m.replace);
  if (mutated === source) {
    invalid.push({ ...m, reason: 'replacement is byte-identical to the original — nothing was mutated' });
    console.log(`  INVALID    ${m.id}  (replacement identical to source)`);
    continue;
  }
  applied.push(m);

  const mutantPath = join(work, `${m.id}.guard.mjs`);
  writeFileSync(mutantPath, mutated, 'utf8');

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
const scored = applied.length - equivalent.length;
const score = scored ? ((killed.length / scored) * 100).toFixed(1) : '100.0';
const bar = '─'.repeat(70);
console.log(`\n${bar}`);
console.log('MUTATION_APPLIED gate — only APPLIED mutants are scored');
console.log(`  selected ${selected.length}   APPLIED ${applied.length}   INVALID ${invalid.length}`);
console.log(bar);
console.log('Result, over APPLIED only');
console.log(`  KILLED     ${killed.length}/${scored}`);
console.log(`  SURVIVED   ${survived.length}/${scored}`);
console.log(`  EQUIVALENT ${equivalent.length} (excluded from the denominator — unkillable by construction)`);
console.log(`  score      ${score}%`);
console.log(bar);

if (survived.length) {
  console.log('\nSURVIVING MUTANTS — the suite does not actually enforce these:');
  for (const m of survived) console.log(`  ${m.id}\n    ${m.invariant}\n    expected to be caught by: ${(m.kills || []).join(', ') || '(unstated)'}`);
}
if (invalid.length) {
  // Deliberately NOT "the guard was refactored". That message stood for four
  // months as a false diagnosis — the real cause was a CRLF working tree against
  // LF `find` strings — and it would have sent a reader to rewrite nine correct
  // mutants against correct code. State the observation, never a guess at why.
  console.log('\nINVALID MUTANTS — NOT scored in either direction. Re-pin them, or fix the harness:');
  for (const m of invalid) console.log(`  ${m.id}\n    ${m.reason}\n    find: ${m.find.split('\n')[0].slice(0, 100)}`);
}

const ok = survived.length === 0 && invalid.length === 0 && applied.length === selected.length;
console.log(ok
  ? `\nAll ${killed.length} scored mutants killed (${equivalent.length} equivalent, excluded). The contract suite enforces every listed invariant.`
  : '\nFAILED.');
process.exit(ok ? 0 : 1);
