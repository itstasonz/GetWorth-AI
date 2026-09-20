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
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './read-source.mjs';
import { PROVIDER_MUTANTS } from './provider-mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SCAN = join(REPO, 'tests/helpers/provider-scan.mjs');
const SUITES = [
  'tests/round5-provider-controls.test.mjs',
  'tests/network-observability.test.mjs',
  'tests/provider-discovery.test.mjs',
];

const source = readSource(SCAN);
const work = mkdtempSync(join(tmpdir(), 'provider-mut-'));
process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ } });

const killed = [];
const survived = [];
const invalid = [];

console.log(`PROVIDER mutation run — ${PROVIDER_MUTANTS.length} mutants against:\n  ${SUITES.join('\n  ')}\n`);

for (const m of PROVIDER_MUTANTS) {
  const hits = source.split(m.find).length - 1;
  if (hits !== 1) {
    invalid.push({ ...m, reason: `find matched ${hits}x, expected exactly 1` });
    console.log(`  INVALID    ${m.id}  (find matched ${hits}x)`);
    continue;
  }
  const mutated = source.replace(m.find, m.replace);
  if (mutated === source) {
    invalid.push({ ...m, reason: 'replacement is byte-identical — nothing was mutated' });
    console.log(`  INVALID    ${m.id}  (replacement identical)`);
    continue;
  }

  const path = join(work, `${m.id}.scan.mjs`);
  writeFileSync(path, mutated, 'utf8');
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SUITES], {
    cwd: REPO,
    env: { ...process.env, PROVIDER_SCAN_PATH: path },
    encoding: 'utf8',
    timeout: 180000,
  });

  if (run.status === 0) {
    survived.push(m);
    console.log(`  SURVIVED   ${m.id}  ← TEST GAP: ${m.invariant}`);
  } else {
    const failing = [...(run.stdout || '').matchAll(/^not ok \d+ - (.+)$/gm)]
      .map((x) => x[1]).filter((n) => !n.startsWith('tests')).slice(0, 2);
    killed.push(m);
    console.log(`  killed     ${m.id}  (${failing.join('; ') || 'suite failed'})`);
  }
}

const line = '─'.repeat(70);
console.log(`\n${line}`);
console.log('MUTATION_APPLIED gate — only APPLIED mutants are scored');
console.log(`  selected ${PROVIDER_MUTANTS.length}   APPLIED ${killed.length + survived.length}   INVALID ${invalid.length}`);
console.log(line);
console.log('Result, over APPLIED only');
console.log(`  KILLED     ${killed.length}/${killed.length + survived.length}`);
console.log(`  SURVIVED   ${survived.length}/${killed.length + survived.length}`);
console.log(`  EQUIVALENT 0`);
console.log(line);

if (survived.length || invalid.length) {
  if (survived.length) {
    console.log('\nSURVIVING MUTANTS — a deleted control that no test observes:');
    for (const m of survived) console.log(`  ${m.id}\n    ${m.invariant}\n    expected to be caught by: ${m.kills.join(', ')}`);
  }
  if (invalid.length) {
    console.log('\nINVALID MUTANTS — NOT scored in either direction. Re-pin them:');
    for (const m of invalid) console.log(`  ${m.id}\n    ${m.reason}`);
  }
  console.log('\nFAILED.');
  process.exit(1);
}
console.log(`\nAll ${killed.length} provider controls are observed by the suite.`);
