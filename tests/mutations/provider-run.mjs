#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER-CONTROL MUTATION HARNESS  ·  S-1
//
// Answers the question tests/round5-provider-controls.test.mjs cannot answer
// about itself: "if one of the provider rules were silently deleted, would any
// test notice?"
//
// It exists because the answer was NO. Round 4 added five mechanisms to
// tests/helpers/provider-scan.mjs and shipped them untested; a security reviewer
// deleted each one and all five mutants SURVIVED the entire suite. The other
// three harnesses mutate production modules, and the provider rules live in a
// TEST helper — so nothing could reach them, and "100% mutation score" was a
// statement about a set of files that did not include the security controls.
//
// Each mutant restores the PRE-ROUND-4 behaviour of one rule. The suite is
// pointed at the mutated copy through PROVIDER_SCAN_PATH, the same indirection
// VAL001_GUARD_PATH already uses.
//
//   KILLED   — the suite failed. The rule is genuinely observed.
//   SURVIVED — the suite passed against a deleted control. THAT IS A TEST GAP.
//   INVALID  — the mutation did not apply, so its result means nothing either way.
//
// Mutant paths carry a per-process id so two runs cannot judge each other's
// mutants — see §10 in ui-run.mjs for the incident that made that necessary.
// ══════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './read-source.mjs';
import { PROVIDER_MUTANTS, PROVIDER_CONTROLS } from './provider-mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
// TWO MODULES, NOT ONE.
//
// S-2 added tests/helpers/runtime-surface.mjs — thirteen more security
// decision sites, in a module this harness could not touch. Leaving it outside
// would have been the S-1 finding reproduced in the code written to close it:
// a verification layer whose own rules nothing can delete and watch.
//
// The mutant copies keep their real FILENAMES, in a per-mutant directory, so
// runtime-surface's `import { lex } from './provider-scan.mjs'` resolves to the
// copy beside it rather than to the original.
const MODULE_FILES = {
  scan: 'tests/helpers/provider-scan.mjs',
  surface: 'tests/helpers/runtime-surface.mjs',
};
const SCAN = join(REPO, MODULE_FILES.scan);
const SUITES = [
  'tests/round5-provider-controls.test.mjs',
  'tests/network-observability.test.mjs',
  'tests/provider-discovery.test.mjs',
];

const SOURCES = Object.fromEntries(
  Object.entries(MODULE_FILES).map(([k, rel]) => [k, readSource(join(REPO, rel))]));
const source = SOURCES.scan;
const work = mkdtempSync(join(tmpdir(), 'provider-mut-'));
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } });

const killed = [];
const survived = [];
const invalid = [];
const misattributed = [];
const controls = [];

console.log(`PROVIDER mutation run — ${PROVIDER_MUTANTS.length} mutants + ${PROVIDER_CONTROLS.length} controls against:\n  ${SUITES.join('\n  ')}\n`);

for (const m of [...PROVIDER_MUTANTS, ...PROVIDER_CONTROLS]) {
  const target = m.target || 'scan';
  const targetSource = SOURCES[target];
  if (!targetSource) {
    invalid.push({ ...m, reason: `unknown target "${target}"` });
    console.log(`  INVALID    ${m.id}  (unknown target "${target}")`);
    continue;
  }
  const hits = targetSource.split(m.find).length - 1;
  if (hits !== 1) {
    invalid.push({ ...m, reason: `find matched ${hits}x, expected exactly 1` });
    console.log(`  INVALID    ${m.id}  (find matched ${hits}x)`);
    continue;
  }
  const mutated = targetSource.replace(m.find, m.replace);
  if (mutated === targetSource) {
    invalid.push({ ...m, reason: 'replacement is byte-identical — nothing was mutated' });
    console.log(`  INVALID    ${m.id}  (replacement identical)`);
    continue;
  }

  // BOTH modules are written every time, so the untargeted one is never a
  // stale copy from a previous mutant, and the relative import between them
  // resolves inside the mutant directory rather than back to the originals.
  const dir = join(work, m.id);
  mkdirSync(dir, { recursive: true });
  const paths = {};
  for (const key of Object.keys(MODULE_FILES)) {
    paths[key] = join(dir, basename(MODULE_FILES[key]));
    writeFileSync(paths[key], key === target ? mutated : SOURCES[key], 'utf8');
  }
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SUITES], {
    cwd: REPO,
    env: { ...process.env, PROVIDER_SCAN_PATH: paths.scan, RUNTIME_SURFACE_PATH: paths.surface },
    encoding: 'utf8',
    timeout: 180000,
  });

  // ── §13. THE CONTROLS ARE JUDGED, NEVER SCORED ────────────────────────────
  // They measure the instrument, not the suite, so they live outside the
  // numerator and the denominator alike. A control that lands the wrong way
  // invalidates the whole run: a blind harness and an indiscriminate one both
  // produce numbers that mean nothing, and the second one looks like success.
  if (m.control) {
    const wanted = m.control === 'kill';
    const got = run.status !== 0;
    controls.push({ ...m, wanted, got, ok: wanted === got });
    console.log(`  ${wanted === got ? 'control ok ' : 'CONTROL BAD'} ${m.id}  ` +
      `(wanted ${m.control.toUpperCase()}, got ${got ? 'KILLED' : 'SURVIVED'})`);
    continue;
  }

  if (run.status === 0) {
    survived.push(m);
    console.log(`  SURVIVED   ${m.id}  ← TEST GAP: ${m.invariant}`);
  } else {
    // ── SPECIFICITY, NOT ONLY SENSITIVITY  ·  §13 ──────────────────────────
    //
    // "The suite went red" is the WEAKEST possible reading of a kill. A mutant
    // that breaks the module so badly every suite explodes is indistinguishable
    // here from one that a named assertion caught — and the header of
    // provider-mutants.mjs claimed for two rounds that `kills` was CHECKED
    // rather than printed. It was printed.
    //
    // So the named tests must be among the failures. A mutant that goes red for
    // reasons unrelated to the invariant it deletes is MISATTRIBUTED: the
    // invariant is still unobserved, and the number covering it is a lie of
    // exactly the kind this round exists to stop reporting.
    // A PREFIX OVER A POOL THAT CONTAINS PARENT SUITE NAMES IS TOO WEAK.
    // A reviewer showed that `kills: ["PC-6"]`, `["PC-"]` and even `["PC"]` all
    // counted as KILLED against real TAP where only PC-6a/6d/6e were red,
    // because the failure pool carries the enclosing `describe` names too. Every
    // current entry is specific, so this was latent — but a latent way to claim
    // an observation you do not have is the thing this column exists to remove.
    // The name must be followed by a word boundary, and it must match a LEAF
    // test rather than the suite that contains it.
    //
    // A WORD BOUNDARY, NOT A BARE PREFIX. `["PC"]` and `["PC-"]` both matched
    // `PC-6 unobserved security authority…` under `startsWith`, so a mutant
    // could claim an observation it did not have by naming a fragment. The
    // name must now BE the test id or be followed by a separator.
    //
    // I first also required the match to be a LEAF — the deepest failing entry
    // — and that was wrong in the other direction: `PD-*` are top-level tests
    // while `PC-*` are nested, so a global maximum depth excluded ten
    // legitimate kills and reported them as misattributed. The complementary
    // property, that a `kills` name refers to a test that actually EXISTS, is
    // asserted statically in tests/mutation-harness.test.mjs instead, where it
    // does not depend on which tests happen to be red in one run.
    const failing = [...(run.stdout || '').matchAll(/^\s*not ok \d+ - (.+)$/gm)]
      .map((x) => x[1].trim()).filter((n) => !n.startsWith('tests'));
    const missing = (m.kills || []).filter((k) =>
      !failing.some((f) => f === k || f.startsWith(`${k} `) || f.startsWith(`${k}:`)));
    if (missing.length) {
      misattributed.push({ ...m, missing, failing: failing.slice(0, 3) });
      console.log(`  MISATTRIB  ${m.id}  ← named test(s) stayed GREEN: ${missing.join(', ')}`);
    } else {
      killed.push(m);
      console.log(`  killed     ${m.id}  (${failing.slice(0, 2).join('; ') || 'suite failed'})`);
    }
  }
}

const line = '─'.repeat(70);
const applied = killed.length + survived.length + misattributed.length;
console.log(`\n${line}`);
console.log('MUTATION_APPLIED gate — only APPLIED mutants are scored');
console.log(`  SELECTED ${PROVIDER_MUTANTS.length}   APPLIED ${applied}   INVALID ${invalid.length}`);
console.log(line);
console.log('Result, over APPLIED only');
console.log(`  KILLED       ${killed.length}/${applied}`);
console.log(`  SURVIVED     ${survived.length}/${applied}`);
console.log(`  MISATTRIBUTED ${misattributed.length}/${applied}`);
console.log(`  EQUIVALENT   0`);
console.log(line);
console.log('HARNESS CALIBRATION — judged, never scored');
for (const c of controls) {
  console.log(`  ${c.ok ? 'ok  ' : 'BAD '} ${c.id.padEnd(28)} wanted ${c.control.toUpperCase().padEnd(8)} ` +
    `got ${c.got ? 'KILLED' : 'SURVIVED'}`);
}
const badControls = controls.filter((c) => !c.ok);
const missingControls = ['kill', 'survive'].filter((k) => !controls.some((c) => c.control === k));
console.log(`  SENSITIVITY ${controls.some((c) => c.control === 'kill' && c.ok) ? 'PROVEN' : 'NOT PROVEN'}` +
  `   SPECIFICITY ${controls.some((c) => c.control === 'survive' && c.ok) ? 'PROVEN' : 'NOT PROVEN'}`);
console.log(line);

if (badControls.length || missingControls.length) {
  console.log('\nHARNESS INVALID — the instrument failed its own calibration:');
  for (const c of badControls) {
    console.log(`  ${c.id}\n    ${c.invariant}\n    wanted ${c.control.toUpperCase()}, got ${c.got ? 'KILLED' : 'SURVIVED'}`);
  }
  for (const k of missingControls) console.log(`  no ${k.toUpperCase()} control was run at all`);
  console.log('\nEvery number above was measured with an instrument that does not work.');
  console.log('\nFAILED.');
  process.exit(1);
}

if (survived.length || invalid.length || misattributed.length) {
  if (survived.length) {
    console.log('\nSURVIVING MUTANTS — a deleted control that no test observes:');
    for (const m of survived) console.log(`  ${m.id}\n    ${m.invariant}\n    expected to be caught by: ${m.kills.join(', ')}`);
  }
  if (misattributed.length) {
    console.log('\nMISATTRIBUTED MUTANTS — the suite went red, but not where it claims to:');
    for (const m of misattributed) {
      console.log(`  ${m.id}\n    ${m.invariant}\n    stayed GREEN: ${m.missing.join(', ')}` +
        `\n    actually failed: ${m.failing.join('; ') || '(nothing named)'}`);
    }
  }
  if (invalid.length) {
    console.log('\nINVALID MUTANTS — NOT scored in either direction. Re-pin them:');
    for (const m of invalid) console.log(`  ${m.id}\n    ${m.reason}`);
  }
  console.log('\nFAILED.');
  process.exit(1);
}
console.log(`\nAll ${killed.length} provider controls are observed by the suite, each by the test it names.`);
