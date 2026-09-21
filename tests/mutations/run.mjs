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
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { readSource } from './read-source.mjs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS, GUARD_CONTROLS } from './mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const GUARD = join(REPO, 'api/_lib/valuation-guard.js');
// EVERY suite that speaks for the guard, not just the original one.
//
// The round-3 rules (§3 bucket authority, §4 category authority, §5 verdicts)
// are observed by two NEW suites, and a mutant that breaks one of them would
// have SURVIVED against tests/valuation-guard.test.mjs alone — producing a
// 100% score that meant "the rules written in 2026-09 are protected" while the
// ones written this week were not. A mutation score is only as wide as the
// suites it runs.
const SUITES = [
  'tests/valuation-guard.test.mjs',
  'tests/envelope-authority.test.mjs',
  'tests/valuation-verdicts.test.mjs',
  // ROUND 4. Added after eight round-4 mutants SURVIVED on their first run — not
  // because the properties were untested, but because the suite that tests them
  // was not in this list. A mutation score measures the suites it runs and says
  // nothing whatever about the ones it does not.
  'tests/round4-properties.test.mjs',
  'tests/round5-properties.test.mjs',
  // ROUND 6. The block-provenance and server-authority rules live in
  // api/_lib/pricing-authority.js, which this harness can already mutate — but
  // a mutant of a rule whose only observer is a suite NOT in this list survives
  // for a reason that has nothing to do with the property.
  'tests/round6-authority.test.mjs',
  // VERIFIED_MARKET. Two suites, because the class is observed from two sides:
  // market-authority.test.mjs watches qualification (what earns the token) and
  // market-guard-authority.test.mjs watches consumption (what the token buys).
  // A mutant that loosened qualification while the guard kept behaving would
  // survive against either one alone.
  'tests/market-authority.test.mjs',
  'tests/market-guard-authority.test.mjs',
];

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
// N-3: shared with ui-run.mjs and sanitizer-run.mjs. The normalisation used to
// live here alone, which is why the other two still reported MALFORMED on a
// CRLF checkout long after this one was fixed.
const source = readSource(GUARD);

// A MUTANT MAY TARGET THE GUARD OR ITS PURE SIBLING.
//
// §6 moved the category token vocabulary into api/_lib/pricing-authority.js so
// the guard and api/_lib/category.js could not hold two copies of it. That put a
// rule the guard DEPENDS ON outside the only file this harness could break -- so
// "100% killed" would have meant "every rule still inside valuation-guard.js is
// protected", while the shared predicate underneath it was untested. A mutation
// score is only as wide as the files it can damage.
const AUTHORITY = join(REPO, 'api/_lib/pricing-authority.js');
// A THIRD MUTABLE CHANNEL. api/_lib/market-evidence.js decides what earns
// VERIFIED_MARKET, and it sits outside both files above — so without this, a
// run reporting 100% would mean "every rule inside the guard and its pure
// sibling is protected" while the module that mints market authority was never
// damaged once. Same reasoning that added `authority`, one module later.
const MARKET = join(REPO, 'api/_lib/market-evidence.js');
const SOURCES = { guard: source, authority: readSource(AUTHORITY), market: readSource(MARKET) };

// THE MUTANT IS COPIED TO A TEMP DIR, SO ITS DEPENDENCIES MUST COME WITH IT.
//
// This used to be a FATAL: "valuation-guard.js now has a relative import ...
// Teach run.mjs to copy the dependency tree before trusting these results." The
// reasoning was right -- an unresolvable import makes every mutant die of a
// module error and the score becomes a meaningless 100% -- and the refusal was
// the correct thing to do until somebody did the work.
//
// §6 is what forced it. The category token vocabulary has to be ONE table shared
// by the guard and api/_lib/category.js, because two tables agreeing by
// inspection is exactly how `/watch/` and `cat.includes('watch')` drifted into
// disagreeing about "Watchdog". So the guard now imports a pure sibling, and the
// harness copies the closure of relative imports beside the mutant.
//
// The FATAL is kept for the case it was written for: an import this walk cannot
// resolve still stops the run rather than producing a number nobody can trust.
const RELATIVE_IMPORT = /(?:^|\n)\s*(?:import|export)[^\n]*?from\s+['"](\.[^'"\n]*)['"]/g;

function copyDependencyClosure(entryPath, entrySource, destDir) {
  const copied = [];
  const seen = new Set();
  const walk = (fromPath, text) => {
    for (const m of text.matchAll(RELATIVE_IMPORT)) {
      const spec = m[1];
      const abs = resolve(dirname(fromPath), spec);
      if (seen.has(abs)) continue;
      seen.add(abs);
      let dep;
      try {
        dep = readSource(abs);
      } catch {
        console.error(`FATAL: cannot resolve ${spec} imported by ${fromPath}.\n` +
          'The mutant copy would fail to load and every mutant would die spuriously.');
        process.exit(2);
      }
      // Windows separators, normalised so the copied layout matches the import path.
      const rel = relative(dirname(entryPath), abs).split(String.fromCharCode(92)).join("/");
      if (rel.startsWith('..')) {
        console.error(`FATAL: ${spec} resolves outside the module's directory (${rel}).\n` +
          'Copying it would change its own relative imports. Flatten the dependency or ' +
          'teach this walk to mirror the directory layout.');
        process.exit(2);
      }
      const target = join(destDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, dep);
      copied.push(rel);
      walk(abs, dep);
    }
  };
  walk(entryPath, entrySource);
  return copied;
}

const selected = filter ? MUTANTS.filter((m) => m.id.includes(filter)) : MUTANTS;
if (!selected.length) {
  console.error(`No mutant matches --filter ${filter}`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'val001-mut-'));
// Copied ONCE, before any mutant runs: the sibling is not the thing under test,
// and re-copying it per mutant would invite the two to drift within a run.
const deps = copyDependencyClosure(GUARD, source, work);
if (deps.length) console.log(`  dependency closure copied: ${deps.join(', ')}`);
const killed = [];
const survived = [];
const invalid = [];
const equivalent = [];
const applied = [];
// §13. Harness calibration. Judged, never scored — see GUARD_CONTROLS.
const controls = [];

console.log(`VAL-001 mutation run — ${selected.length} mutants + ${GUARD_CONTROLS.length} controls against tests/valuation-guard.test.mjs\n`);

for (const m of [...selected, ...GUARD_CONTROLS]) {
  // A mutant must pin exactly one site. Zero means the code moved; many means
  // the mutation is ambiguous and we would not know what we actually broke.
  const target = m.target || 'guard';
  const targetSource = SOURCES[target];
  if (!targetSource) {
    invalid.push({ ...m, reason: `unknown target "${target}"` });
    console.log(`  INVALID    ${m.id}  (unknown target "${target}")`);
    continue;
  }
  const occurrences = targetSource.split(m.find).length - 1;
  if (occurrences !== 1) {
    invalid.push({ ...m, reason: `find matched ${occurrences}x, expected exactly 1` });
    console.log(`  INVALID    ${m.id}  (find matched ${occurrences}x, expected 1)`);
    continue;
  }

  // MUTATION_APPLIED = YES, proved rather than assumed. A replacement that
  // produced byte-identical text changed nothing, and a result read from it is
  // a lie in whichever direction it lands. Only APPLIED mutants are scored.
  const mutated = targetSource.replace(m.find, m.replace);
  if (mutated === targetSource) {
    invalid.push({ ...m, reason: 'replacement is byte-identical to the original — nothing was mutated' });
    console.log(`  INVALID    ${m.id}  (replacement identical to source)`);
    continue;
  }
  if (!m.control) applied.push(m);

  const mutantPath = join(work, `${m.id}.guard.mjs`);
  // The guard copy is always written -- unmutated when the mutant targets the
  // sibling -- so the two are never mixed between runs.
  writeFileSync(mutantPath, target === 'guard' ? mutated : SOURCES.guard, 'utf8');
  const authorityPath = join(work, 'pricing-authority.js');
  writeFileSync(authorityPath, target === 'authority' ? mutated : SOURCES.authority, 'utf8');
  // The guard copy imports './market-evidence.js', so this path is also what
  // the guard itself loads. The suites are pointed at the SAME file for a
  // reason that is not tidiness: market authority is WeakSet membership, and
  // two copies of this module would be two disjoint WeakSets.
  const marketPath = join(work, 'market-evidence.js');
  writeFileSync(marketPath, target === 'market' ? mutated : SOURCES.market, 'utf8');

  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SUITES], {
    cwd: REPO,
    env: {
      ...process.env,
      VAL001_GUARD_PATH: mutantPath,
      VAL001_AUTHORITY_PATH: authorityPath,
      VAL001_MARKET_PATH: marketPath,
    },
    encoding: 'utf8',
    timeout: 120000,
  });

  // §13. A control measures the instrument, so it is neither a kill nor a gap.
  if (m.control) {
    const wanted = m.control === 'kill';
    const got = run.status !== 0;
    controls.push({ ...m, wanted, got, ok: wanted === got });
    console.log(`  ${wanted === got ? 'control ok ' : 'CONTROL BAD'} ${m.id}  ` +
      `(wanted ${m.control.toUpperCase()}, got ${got ? 'KILLED' : 'SURVIVED'})`);
    continue;
  }

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
console.log('HARNESS CALIBRATION — judged, never scored');
for (const c of controls) {
  console.log(`  ${c.ok ? 'ok  ' : 'BAD '} ${c.id.padEnd(28)} wanted ${c.control.toUpperCase().padEnd(8)} ` +
    `got ${c.got ? 'KILLED' : 'SURVIVED'}`);
}
const sensitivityOk = controls.some((c) => c.control === 'kill' && c.ok);
const specificityOk = controls.some((c) => c.control === 'survive' && c.ok);
console.log(`  SENSITIVITY ${sensitivityOk ? 'PROVEN' : 'NOT PROVEN'}   SPECIFICITY ${specificityOk ? 'PROVEN' : 'NOT PROVEN'}`);
console.log(bar);
if (!sensitivityOk || !specificityOk) {
  console.log('\nHARNESS INVALID — the instrument failed its own calibration.');
  for (const c of controls.filter((x) => !x.ok)) {
    console.log(`  ${c.id}\n    ${c.invariant}\n    wanted ${c.control.toUpperCase()}, got ${c.got ? 'KILLED' : 'SURVIVED'}`);
  }
  console.log('\nA harness that kills everything is as invalid as one that kills nothing.');
  console.log('\nFAILED.');
  process.exit(1);
}

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
