#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — MUTATION HARNESS
//
// "If V2 silently lost one of its rules, would any test notice?"
//
// The real tree is never written to. The harness mirrors `api/`, `src/` and the V2
// suites into a scratch directory INSIDE the repository (so bare imports still
// resolve to node_modules), breaks one rule in the mirror, runs the suites
// there, and restores the file.
//
//   KILLED    the suites failed. The rule is observed.
//   SURVIVED  the suites passed against broken code. That is a test gap.
//   MALFORMED the mutant no longer matches the source exactly once.
//
// Two controls are judged and never scored: one that must die (the harness
// reaches the code) and one that must live (the suites are not red for
// unrelated reasons). Exit code is 0 only when every mutant is KILLED and both
// controls behave.
//
//   node tests/mutations/v2-run.mjs
//   node tests/mutations/v2-run.mjs --list
//   node tests/mutations/v2-run.mjs --filter X0
//   node tests/mutations/v2-run.mjs --verbose
// ══════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { V2_MUTANTS, V2_CONTROLS } from './v2-mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SCRATCH = join(HERE, '.v2-scratch');
// Every suite that speaks for the V2 server. A mutation score is only as wide
// as the suites it runs.
const SUITES = [
  'tests/scan-v2-gate.test.mjs',
  'tests/scan-v2-evidence.test.mjs',
  'tests/scan-v2-pipeline.test.mjs',
  'tests/scan-v2-market.test.mjs',
  'tests/scan-v2-alias.test.mjs',
  'tests/scan-v2-anchor.test.mjs',
  'tests/scan-v2-resolution.test.mjs',
  'tests/scan-v2-market-data.test.mjs',
  'tests/scan-v2-orchestrator.test.mjs',
  'tests/scan-v2-benchmark.test.mjs',
  'tests/scan-v2-capture-helper.test.mjs',
  'tests/scan-v2-endpoints.test.mjs',
  // The client half: the photograph's path from the shutter to the request.
  'tests/scan-v2-client.test.mjs',
];

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const filter = argv.includes('--filter') ? argv[argv.indexOf('--filter') + 1] : null;

if (argv.includes('--list')) {
  for (const m of V2_MUTANTS) console.log(`${m.id.padEnd(36)} ${m.invariant}`);
  console.log(`\n${V2_MUTANTS.length} mutants, ${V2_CONTROLS.length} controls.`);
  process.exit(0);
}

// The catalog is written with LF; a Windows working tree may be CRLF.
const readLF = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

function mirror() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(join(SCRATCH, 'tests'), { recursive: true });
  cpSync(join(REPO, 'api'), join(SCRATCH, 'api'), { recursive: true });
  cpSync(join(REPO, 'src'), join(SCRATCH, 'src'), { recursive: true });
  cpSync(join(REPO, 'tests/helpers'), join(SCRATCH, 'tests/helpers'), { recursive: true });
  cpSync(join(REPO, 'tests/fixtures'), join(SCRATCH, 'tests/fixtures'), { recursive: true });
  // The offline calibration harness: a suite holds that nothing the scan runs imports it.
  mkdirSync(join(SCRATCH, 'scripts'), { recursive: true });
  cpSync(join(REPO, 'scripts/valuation-calibration.mjs'), join(SCRATCH, 'scripts/valuation-calibration.mjs'));
  cpSync(join(REPO, 'scripts/market-benchmark.mjs'), join(SCRATCH, 'scripts/market-benchmark.mjs'));
  cpSync(join(REPO, 'scripts/market-benchmark-report.mjs'), join(SCRATCH, 'scripts/market-benchmark-report.mjs'));
  cpSync(join(REPO, 'scripts/market-benchmark-live.mjs'), join(SCRATCH, 'scripts/market-benchmark-live.mjs'));
  cpSync(join(REPO, 'scripts/dev'), join(SCRATCH, 'scripts/dev'), { recursive: true });
  // The benchmark suite holds that no npm script runs the benchmark live.
  cpSync(join(REPO, 'package.json'), join(SCRATCH, 'package.json'));
  for (const s of SUITES) cpSync(join(REPO, s), join(SCRATCH, s));
}

function runSuites() {
  const r = spawnSync(process.execPath, ['--test', ...SUITES], { cwd: SCRATCH, encoding: 'utf8' });
  return { passed: r.status === 0, output: `${r.stdout}\n${r.stderr}` };
}

function apply(m) {
  const path = join(SCRATCH, m.file);
  const original = readLF(path);
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) return { malformed: `find matches ${hits} time(s) in ${m.file}` };
  writeFileSync(path, original.replace(m.find, () => m.replace));
  const result = runSuites();
  writeFileSync(path, original);
  return result;
}

let exitCode = 0;
try {
  mirror();
  const clean = runSuites();
  if (!clean.passed) {
    console.error('The V2 suites fail against UNMUTATED code. Nothing below would mean anything.');
    if (VERBOSE) console.error(clean.output);
    process.exitCode = 2;
  } else {
    for (const c of V2_CONTROLS) {
      const r = apply(c);
      const ok = !r.malformed && (c.control === 'kill' ? !r.passed : r.passed);
      console.log(`${ok ? 'ok      ' : 'BROKEN  '} ${c.id.padEnd(36)} ${r.malformed ?? (r.passed ? 'survived' : 'killed')}`);
      if (!ok) exitCode = 1;
    }
    const chosen = V2_MUTANTS.filter((m) => !filter || m.id.includes(filter));
    let killed = 0;
    for (const m of chosen) {
      const r = apply(m);
      const verdict = r.malformed ? 'MALFORMED' : (r.passed ? 'SURVIVED' : 'KILLED');
      if (verdict === 'KILLED') killed += 1; else exitCode = 1;
      console.log(`${verdict.padEnd(9)} ${m.id.padEnd(36)} ${r.malformed ?? m.invariant}`);
      if (VERBOSE && verdict === 'SURVIVED') console.log(r.output.split('\n').slice(-12).join('\n'));
    }
    console.log(`\n${killed}/${chosen.length} killed (${chosen.length ? ((killed / chosen.length) * 100).toFixed(1) : '0.0'}%).`);
    process.exitCode = exitCode;
  }
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}
