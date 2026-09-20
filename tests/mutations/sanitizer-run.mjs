#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// GW-PROMPT-INJECTION-001 — MUTATION HARNESS for the prompt-input quarantine.
//
// Answers the question tests/prompt-injection.test.mjs cannot answer about
// itself: "if one of the quarantine guards were silently removed, would any
// test notice?" — and does it from the repository, on demand, against whatever
// the source says today.
//
// THE RULE THAT MAKES THE NUMBER MEAN ANYTHING
// Every mutant must prove MUTATION_APPLIED = YES before its result is read. A
// mutation that did not actually change the file is not a passing test and not
// a failing one; it is NOTHING, and counting it either way is how a harness
// rots into reporting a perfect score against code it never touched. Rounds 5,
// 6 and 8 reported scores nobody can re-derive; this exists so round 9's is
// re-derivable by anyone with the repo.
//
//   APPLIED  — the mutation changed the source, at exactly one site, and the
//              mutant module loaded. Only these are scored.
//   KILLED   — an APPLIED mutant made the suite fail. The guard is observed.
//   SURVIVED — an APPLIED mutant left the suite green. THAT IS A TEST GAP.
//   INVALID  — not applied (find matched 0 or many times), or applied and then
//              failed to load. Never counted as killed. Always a failure of the
//              harness or the catalog, and it fails the run.
//
// SECURITY RELEVANCE IS REPORTED SEPARATELY AND NEVER INFERRED FROM A KILL.
// A kill proves the suite is sensitive to that code. Whether the code is a
// security control is a declared property in sanitizer-mutants.mjs, with its
// reasoning attached. Round 6 got this wrong in both directions; the two
// columns are kept apart here so it cannot be got wrong silently again.
//
// The real api/analyze.js is never written to. The mutant copy lives BESIDE it
// (relative `./_lib/…` imports and `@supabase/supabase-js` both resolve from
// the file's own directory) and is swept on exit, including on ^C.
//
//   node tests/mutations/sanitizer-run.mjs
//   node tests/mutations/sanitizer-run.mjs --list
//   node tests/mutations/sanitizer-run.mjs --filter P02
//   node tests/mutations/sanitizer-run.mjs --verbose
// ══════════════════════════════════════════════════════════════════════════════
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { readSource } from './read-source.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMITIVE_MUTANTS, SITE_SCOPES, SITE_GUARDS, NON_SECURITY_SITES } from './sanitizer-mutants.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const ANALYZE = join(REPO, 'api/analyze.js');
// §10. Process-unique, so concurrent runs cannot judge each other's mutants.
const RUN_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const MUTANT = join(REPO, `api/analyze.__mutant__.${RUN_ID}.js`);
// HIGH-5: the quarantine primitives moved to api/_lib/prompt-trust.js so
// /api/enrich can import the same implementation. A mutation harness that reads
// one file would have reported 14 of 18 primitives INVALID — "find matched 0x" —
// which is the honest failure, but the fix is to follow the code, not to re-pin
// the strings at whatever they happen to be now.
const TRUST = join(REPO, 'api/_lib/prompt-trust.js');
const TRUST_MUTANT = join(REPO, `api/_lib/prompt-trust.__mutant__.${RUN_ID}.js`);
const SUITE = join(REPO, 'tests/prompt-injection.test.mjs');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
const VERBOSE = has('--verbose');
const filter = valueOf('--filter');

// N-3. This harness passed on a CRLF checkout only because its two targets
// happened to be LF on disk — an accident of file history, not a property.
const source = readSource(ANALYZE);
const trustSource = readSource(TRUST);
// Which file a mutant edits. `file: 'trust'` on a mutant selects the second.
const SOURCE_OF = { analyze: source, trust: trustSource };

// ── SITE MUTANT GENERATION ──────────────────────────────────────────────────

/** The body of a top-level `function NAME(` up to the next top-level function. */
function scopeBody(name) {
  const decl = new RegExp(String.raw`^(?:export\s+)?(?:async\s+)?function\s+${name}\s*\(`, 'm');
  const m = decl.exec(source);
  if (!m) return null;
  const start = m.index;
  const NEXT = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/gm;
  NEXT.lastIndex = start + m[0].length;
  const n = NEXT.exec(source);
  return { start, end: n ? n.index : source.length };
}

/** Split `a, b(c, d), e` on TOP-LEVEL commas only. */
function splitArgs(text) {
  const out = [];
  let depth = 0, buf = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      buf += c;
      if (c === String.fromCharCode(92)) { buf += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; buf += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim() !== '') out.push(buf);
  return out;
}

/** The index just past the `)` matching the `(` at `open`. */
function matchParen(open) {
  let depth = 0, quote = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === String.fromCharCode(92)) { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/**
 * Every guard CALL inside the declared scopes, as a pass-through mutant.
 *
 * `promptSafe(x, 120)` becomes `(x)` — the value reaches the prompt exactly as
 * the client or the label supplied it. For `fence(label, body)` the body is the
 * quarantined span, so that is what passes through; passing the LABEL would be
 * a different mutation that happens to also break things, which is the kind of
 * mutant that produces a meaningless kill.
 */
function generateSiteMutants() {
  const out = [];
  for (const scope of SITE_SCOPES) {
    const body = scopeBody(scope);
    if (!body) {
      out.push({ id: `S-${scope}-MISSING`, kind: 'site', scope, invalid: `scope ${scope}() not found in api/analyze.js` });
      continue;
    }
    let inScope = 0;
    for (const guard of SITE_GUARDS) {
      const re = new RegExp(String.raw`(?<![\w.])${guard}\s*\(`, 'g');
      re.lastIndex = body.start;
      let m;
      while ((m = re.exec(source)) && m.index < body.end) {
        const open = m.index + m[0].length - 1;
        const close = matchParen(open);
        if (close === -1) continue;
        const call = source.slice(m.index, close);
        const args = splitArgs(source.slice(open + 1, close - 1));
        const keep = (guard === 'fence' ? args[1] : args[0]) ?? args[0];
        if (keep === undefined) continue;
        const line = source.slice(0, m.index).split(String.fromCharCode(10)).length;
        const col = m.index - source.lastIndexOf(String.fromCharCode(10), m.index);
        const nonSec = NON_SECURITY_SITES.find((n) => call.startsWith(n.match));
        inScope++;
        out.push({
          // line AND column: several guards routinely share one line, and an id
          // that cannot tell them apart makes a survivor unlocatable.
          id: `S${String(out.length + 1).padStart(2, '0')}-${scope}-${guard}-L${line}C${col}`,
          kind: 'site', scope, guard, line, col,
          property: `the ${guard}() guard at api/analyze.js:${line} neutralises this interpolation`,
          security: !nonSec,
          securityWhy: nonSec?.why,
          index: m.index, length: close - m.index,
          call, replaceWith: `(${keep.trim()})`,
        });
      }
    }
    // A scope that yields no mutant covers nothing, and a matrix that silently
    // includes it reports a scope as "covered" on the strength of zero tests.
    // That is the same vacuity round 9 removed from the provider-ordering
    // guard, and it is refused here for the same reason.
    if (inScope === 0) {
      out.push({
        id: `S-${scope}-EMPTY`, kind: 'site', scope,
        invalid: `scope ${scope}() contains no ${SITE_GUARDS.join('/')} call — it covers nothing. ` +
                 'Remove it from SITE_SCOPES, or fix the guard names.',
      });
    }
  }
  return out;
}

// ── APPLICATION ─────────────────────────────────────────────────────────────

/**
 * Produce the mutated source, or an `invalid` reason. THIS IS THE GATE: nothing
 * downstream reads a result whose `applied` is false.
 */
function applyMutant(m) {
  if (m.invalid) return { applied: false, reason: m.invalid };

  let mutated;
  if (m.kind === 'site') {
    const at = source.slice(m.index, m.index + m.length);
    if (at !== m.call) return { applied: false, reason: 'source moved under the generated offset' };
    mutated = source.slice(0, m.index) + m.replaceWith + source.slice(m.index + m.length);
    if (mutated === source) return { applied: false, reason: 'replacement is byte-identical to the original' };
    return { applied: true, file: 'analyze', mutated };
  }

  const file = m.file ?? 'analyze';
  const base = SOURCE_OF[file];
  if (base === undefined) return { applied: false, reason: `unknown target file '${file}'` };
  const occurrences = base.split(m.find).length - 1;
  if (occurrences !== 1) {
    return { applied: false, reason: `find matched ${occurrences}x in ${file}, expected exactly 1 — re-pin it` };
  }
  mutated = base.replace(m.find, m.replace);

  // The proof. A replace that produced identical text changed nothing, and a
  // result read from it would be a lie in whichever direction it landed.
  if (mutated === base) return { applied: false, reason: 'replacement is byte-identical to the original' };
  return { applied: true, file, mutated };
}

// ── RUN ─────────────────────────────────────────────────────────────────────

const sweep = () => { rmSync(MUTANT, { force: true }); rmSync(TRUST_MUTANT, { force: true }); };
sweep();
process.on('exit', sweep);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { sweep(); process.exit(130); });

const ALL = [
  ...PRIMITIVE_MUTANTS.map((m) => ({ ...m, kind: 'primitive' })),
  ...generateSiteMutants(),
];

if (has('--list')) {
  for (const m of ALL) {
    console.log(`${m.id.padEnd(52)} ${m.security === false ? 'non-sec' : 'security'}  ${(m.property || m.invalid || '').slice(0, 80)}`);
  }
  console.log(`\n${ALL.length} mutants (${PRIMITIVE_MUTANTS.length} primitive, ${ALL.length - PRIMITIVE_MUTANTS.length} generated site).`);
  process.exit(0);
}

const selected = filter ? ALL.filter((m) => m.id.includes(filter)) : ALL;
if (!selected.length) { console.error(`No mutant matches --filter ${filter}`); process.exit(2); }

const runSuite = (analyzePath, trustPath) =>
  spawnSync(process.execPath, ['--test', '--test-reporter=tap', SUITE], {
    cwd: REPO,
    env: { ...process.env, GWPI_ANALYZE_PATH: analyzePath, GWPI_TRUST_PATH: trustPath },
    encoding: 'utf8',
    timeout: 120000,
  });

// A score against a suite that was already failing is meaningless — every
// mutant would "die" of a pre-existing failure.
console.log('GW-PROMPT-INJECTION-001 sanitizer mutation run\n');
process.stdout.write('  baseline (unmutated) ... ');
const baseline = runSuite(ANALYZE, TRUST);
if (baseline.status !== 0) {
  console.log('FAILED');
  console.error('\nFATAL: tests/prompt-injection.test.mjs is not green before mutation.');
  console.error((baseline.stdout || baseline.stderr || '').split(String.fromCharCode(10)).slice(0, 40).join(String.fromCharCode(10)));
  process.exit(2);
}
const baseCount = (baseline.stdout.match(/^# pass (\d+)/m) || [])[1];
console.log(`green (${baseCount} tests)\n`);

const applied = [], killed = [], survived = [], invalid = [], equivalent = [];

for (const m of selected) {
  const a = applyMutant(m);
  if (!a.applied) {
    invalid.push({ ...m, reason: a.reason });
    console.log(`  INVALID    ${m.id}`);
    console.log(`             not applied: ${a.reason}`);
    continue;
  }

  // BOTH mutant copies are written every time, and the analyze copy's import is
  // repointed at the trust copy — otherwise a mutation of the trust module would
  // be loaded from the REAL file and scored as if it had been applied.
  const analyzeSrc = a.file === 'analyze' ? a.mutated : source;
  const trustSrc = a.file === 'trust' ? a.mutated : trustSource;
  const repointed = analyzeSrc.replace("from './_lib/prompt-trust.js'", `from './_lib/prompt-trust.__mutant__.${RUN_ID}.js'`);
  if (repointed === analyzeSrc) {
    invalid.push({ ...m, reason: "api/analyze.js no longer imports './_lib/prompt-trust.js' — the harness " +
      'cannot guarantee the mutant module is the one under test' });
    continue;
  }
  writeFileSync(TRUST_MUTANT, trustSrc, 'utf8');
  writeFileSync(MUTANT, repointed, 'utf8');

  // An APPLIED mutant that cannot even load is not a killed mutant: it has no
  // observable behaviour to judge, so it is INVALID, and loudly, because it
  // means the catalog produced code that does not parse.
  //
  // This asks the question DIRECTLY, in its own process. The first version
  // grepped the suite's output for 'SyntaxError' and friends — and api/analyze.js
  // contains a COMMENT with that word in it, which a failing assertion echoes
  // back into the TAP stream. Three genuinely-killed mutants were reported as
  // INVALID on the strength of a word in a code comment. Matching prose to
  // decide whether a module loaded is exactly the kind of false oracle this
  // harness exists to retire.
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(MUTANT).href)});`], {
    cwd: REPO, encoding: 'utf8', timeout: 60000,
  });
  if (probe.status !== 0) {
    invalid.push({ ...m, reason: `mutant applied but the module does not load: ${(probe.stderr || '').split(String.fromCharCode(10)).find((l) => /Error/.test(l))?.trim() || 'unknown'}` });
    console.log(`  INVALID    ${m.id}`);
    console.log('             applied, but the mutant module did not load');
    if (VERBOSE) console.log((probe.stderr || '').split(String.fromCharCode(10)).slice(0, 15).join(String.fromCharCode(10)));
    continue;
  }

  const run = runSuite(MUTANT, TRUST_MUTANT);
  const out = (run.stdout || '') + (run.stderr || '');

  // The suite must have actually executed. A run that produced no TAP summary
  // reports nothing about the mutant either way.
  if (!/^# tests \d+/m.test(out)) {
    invalid.push({ ...m, reason: 'the suite produced no TAP summary — nothing was observed' });
    console.log(`  INVALID    ${m.id}`);
    console.log('             the suite did not run to completion');
    if (VERBOSE) console.log(out.split(String.fromCharCode(10)).slice(0, 25).join(String.fromCharCode(10)));
    continue;
  }

  applied.push(m);
  const failing = (run.stdout.match(/^\s*not ok \d+ - (.+)$/gm) || [])
    .map((l) => l.replace(/^\s*not ok \d+ - /, '').trim());

  if (run.status === 0) {
    if (m.equivalent) {
      // Expected: no test CAN kill this, because the mutant computes the same
      // thing. Each one was verified by differential probe before the marker
      // was added, and the marker is checked in the other direction below.
      equivalent.push(m);
      console.log(`  equivalent ${m.id}  (unkillable by construction: ${m.equivalent})`);
    } else {
      survived.push(m);
      console.log(`  SURVIVED   ${m.id}  <- TEST GAP`);
      console.log(`             ${m.property}`);
    }
  } else {
    killed.push({ ...m, failing });
    // A marked-equivalent mutant that DIES was mismarked — either the claim was
    // wrong, or a new test now observes it. Either way the marker is a lie and
    // must go, so say so loudly instead of quietly counting a kill.
    const tag = m.equivalent ? '  [marked equivalent but KILLED — drop the marker]' : '';
    console.log(`  killed     ${m.id}  (${failing.length} failing${failing.length ? `: ${failing.slice(0, 2).join('; ').slice(0, 90)}` : ''})${tag}`);
    if (VERBOSE) console.log(out.split(String.fromCharCode(10)).slice(0, 30).join(String.fromCharCode(10)));
  }
}

sweep();

// ── REPORT ──────────────────────────────────────────────────────────────────
const bar = '─'.repeat(78);
const secKilled = killed.filter((m) => m.security !== false).length;
const nonSecKilled = killed.length - secKilled;

// Equivalent mutants are excluded from the denominator: no test CAN kill them,
// so counting them would cap the achievable score below 100% and make the
// number meaningless as a pass/fail signal.
const scored = applied.length - equivalent.length;

console.log(`\n${bar}`);
console.log('MUTATION_APPLIED gate — only APPLIED mutants are scored');
console.log(`  selected ${selected.length}   APPLIED ${applied.length}   INVALID ${invalid.length}`);
console.log(bar);
console.log('Result, over APPLIED only');
console.log(`  KILLED     ${killed.length}/${scored}`);
console.log(`  SURVIVED   ${survived.length}/${scored}`);
console.log(`  EQUIVALENT ${equivalent.length} (excluded from the denominator — unkillable by construction)`);
for (const m of equivalent) console.log(`      ${m.id}: ${m.equivalent}`);
console.log(bar);
console.log('Security relevance — DECLARED in sanitizer-mutants.mjs, never inferred from a kill');
console.log(`  killed, declared security-relevant : ${secKilled}`);
console.log(`  killed, declared NON-security      : ${nonSecKilled}`);
for (const m of killed.filter((k) => k.security === false)) {
  console.log(`      ${m.id}`);
  console.log(`        ${m.securityWhy || '(no reason recorded)'}`);
}
console.log(bar);

if (survived.length) {
  console.log('\nSURVIVING MUTANTS — the suite does not actually observe these:');
  for (const m of survived) console.log(`  ${m.id}\n    ${m.property}`);
}
if (invalid.length) {
  console.log('\nINVALID MUTANTS — these were NOT scored, in either direction:');
  for (const m of invalid) console.log(`  ${m.id}\n    ${m.reason}`);
}

const ok = survived.length === 0 && invalid.length === 0 && applied.length === selected.length;
console.log(ok
  ? `\nAll ${killed.length} scored mutants killed (${equivalent.length} equivalent, excluded from the denominator). `
    + 'The quarantine layer is observed by the suite.'
  : '\nFAILED.');
process.exit(ok ? 0 : 1);
