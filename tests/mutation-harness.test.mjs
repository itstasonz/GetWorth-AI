// ══════════════════════════════════════════════════════════════════════════════
// THE MUTATION HARNESS IS ITSELF UNDER TEST  ·  §13
//
// THE PROPERTIES
//   ISOLATION      mutation A affects only A's target; two concurrent runs
//                  cannot see each other's mutant; results are deterministic.
//   SENSITIVITY    an intentionally broken mutation IS killed.
//   SPECIFICITY    an unrelated, intentionally inert mutation SURVIVES.
//
// WHY. The previous concurrency remediation gave each run a per-process id for
// its mutant PATHS, which fixed the collision it was written for and created a
// worse one. The mutant copies still live in the working tree — they have to,
// because relative imports and Tailwind's content globs resolve from the file's
// own directory — and two tree walkers had no opinion about them:
//
//   scripts/design-lint.mjs  walk(src/)        linted another run's mutants
//   analyze-harness.mjs      discoverEndpoints drove another run's handler
//
// So a second run in flight failed suites for reasons belonging to nobody's
// mutant, every mutant came back "killed", and the score read 100%. A harness
// that kills everything is exactly as invalid as one that kills nothing, and it
// is harder to notice because the number looks like success.
//
// The calibration itself — a control that must die and a control that must live
// — runs inside `npm run test:mutation`, because only the harness can judge it.
// What is asserted here is that the controls EXIST and are wired, so a future
// edit cannot quietly delete the only thing keeping the score honest.
//
//   node --test tests/mutation-harness.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_MUTANTS, PROVIDER_CONTROLS } from './mutations/provider-mutants.mjs';
import { MUTANTS, GUARD_CONTROLS } from './mutations/mutants.mjs';
import { UI_MUTANTS, TARGETS } from './mutations/ui-mutants.mjs';
import { discoverEndpoints } from './helpers/analyze-harness.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const API_DIR = join(REPO, 'api');

// THE TEST RUNNER'S OWN ENVIRONMENT MUST NOT TRAVEL WITH THE CHILD.
//
// `node --test` sets NODE_TEST_CONTEXT in its children. Inherited by a spawned
// harness, it reaches the `node --test` the harness spawns in turn — which then
// runs in test-child mode and exits 0 over a failing suite. Every mutant the
// harness judged from inside this file therefore came back SURVIVED, and the
// failure looked exactly like the concurrency defect I was trying to observe.
// An hour, and two wrong diagnoses, were spent on that.
const CLEAN_ENV = () => {
  const e = { ...process.env };
  for (const k of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'NODE_V8_COVERAGE']) delete e[k];
  return e;
};

const run = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { cwd: REPO, env: { ...CLEAN_ENV(), ...env } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

// ════════════════════════════════════════════════════════════════════════════
// MH-1 · THE UNIVERSAL KILLER
// ════════════════════════════════════════════════════════════════════════════
describe('MH-1 a mutant scratch copy is never production source', () => {
  test('MH-1a the design linter does not lint another run’s mutant', async () => {
    // THE WITNESS. `src/components/ui.__mutant__.<run>.jsx` is a deliberately
    // broken file. Linted as though it were production, it fails every
    // concurrent run and every concurrent `npm test` — which is how a harness
    // starts killing everything.
    const dir = mkdtempSync(join(tmpdir(), 'mh-lint-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      // A file that violates a hard-zero rule, twice over, under a mutant name.
      writeFileSync(join(dir, 'src', 'Broken.__mutant__.abc123.jsx'),
        'export const X = () => <div className="focus:outline-none" style={{ color: "#ff0000" }} />;\n');
      const r = await run([join(REPO, 'scripts/design-lint.mjs'), '--json', '--fixture'],
        { DESIGN_LINT_SRC: join(dir, 'src') });
      assert.equal(r.code, 0, `the linter failed over a mutant scratch copy:\n${r.out}`);
      const counts = JSON.parse(r.out).counts;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      assert.equal(total, 0,
        `a mutant scratch copy produced ${total} lint hits — every concurrent run now fails ` +
        'for reasons that belong to somebody else’s mutant');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('MH-1b endpoint discovery does not drive another run’s handler', async () => {
    // tests/mutations/sanitizer-run.mjs writes api/analyze.__mutant__.<run>.js.
    // `discoverEndpoints` looks for a default export under api/ and found it.
    const name = `__probe__.__mutant__.${process.pid}.js`;
    const path = join(API_DIR, name);
    try {
      writeFileSync(path, 'export default async function handler() { throw new Error("mutant"); }\n');
      const found = discoverEndpoints();
      assert.ok(!found.includes(name),
        `endpoint discovery returned a mutant scratch copy (${name}) — PC-5b would drive a ` +
        'deliberately broken handler belonging to another run');
      assert.ok(found.includes('analyze.js'), 'and it must still find the real endpoints');
    } finally { rmSync(path, { force: true }); }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MH-2 · CONCURRENCY
// ════════════════════════════════════════════════════════════════════════════
describe('MH-2 two runs at once do not judge each other', () => {
  test('MH-2a per-run mutant paths are unique, and named so walkers can skip them', () => {
    // Both halves matter. Uniqueness stops two runs writing the same file;
    // the `__mutant__` marker is what every tree walker keys on, so a path
    // scheme that dropped it would reopen MH-1 silently.
    for (const [key, t] of Object.entries(TARGETS)) {
      assert.match(t.mutant, /__mutant__/,
        `${key}: a mutant path must carry the __mutant__ marker every walker excludes`);
      assert.notEqual(t.mutant, t.src);
    }
    const src = readFileSync(new URL('./mutations/ui-run.mjs', import.meta.url), 'utf8');
    assert.match(src, /const RUN_ID = /, 'mutant paths must be per-run');
    assert.match(src, /__mutant__\.\$\{RUN_ID\}/,
      'the per-run suffix must come AFTER the marker, or the marker stops matching');
  });

  test('MH-2b concurrent runs on DIFFERENT targets are independent', async () => {
    // Mutation A only affects A's isolated target and mutation B only B's.
    const [a, b] = await Promise.all([
      run([join(REPO, 'tests/mutations/ui-run.mjs'), '--filter', 'U66']),
      run([join(REPO, 'tests/mutations/ui-run.mjs'), '--filter', 'U45']),
    ]);
    assert.equal(a.code, 0, `run A failed while B was in flight:\n${a.out}`);
    assert.equal(b.code, 0, `run B failed while A was in flight:\n${b.out}`);
    assert.match(a.out, /killed 1\/1/, `A judged the wrong number of mutants:\n${a.out}`);
    assert.match(b.out, /killed 1\/1/, `B judged the wrong number of mutants:\n${b.out}`);
    assert.ok(!/FATAL/.test(a.out + b.out),
      'a concurrent run tripped the tree-corruption guard — the isolation is not real');
  });

  test('MH-2c concurrent runs on the SAME target agree', async () => {
    // Determinism. If two identical runs can disagree, no single run’s number
    // means anything — which is exactly what four reviewers hit when one of them
    // reported U16 as SURVIVED against a mutant a serial run kills.
    const [a, b] = await Promise.all([
      run([join(REPO, 'tests/mutations/ui-run.mjs'), '--filter', 'U66']),
      run([join(REPO, 'tests/mutations/ui-run.mjs'), '--filter', 'U66']),
    ]);
    assert.equal(a.code, b.code, `identical concurrent runs disagreed:\nA:\n${a.out}\nB:\n${b.out}`);
    assert.equal(a.code, 0, a.out);
    const verdict = (o) => (o.match(/^ {2}(killed|SURVIVED|MALFORMED|BROKEN)\s+(\S+)/m) || []).slice(1).join(' ');
    assert.equal(verdict(a.out), verdict(b.out),
      `the same mutant got two verdicts in two concurrent runs:\nA:\n${a.out}\nB:\n${b.out}`);
  });

  test('MH-2d nothing is left behind in the working tree', () => {
    // A sweep that misses makes the NEXT run lint a corpse.
    //
    // ── A LEFTOVER IS AN ORPHAN, NOT MERELY A FILE THAT EXISTS ─────────────
    //
    // This asserted that NO `__mutant__` file exists anywhere, which is false
    // while any mutation run is legitimately in flight — the scratch copies
    // have to live in the tree, that is the whole reason MH-1 exists. So this
    // test failed whenever it ran beside a live harness, which is exactly the
    // "possible flake in this suite" an independent reviewer reported and could
    // not reproduce: it depends on what else is running.
    //
    // Mutant paths carry `<pid>-<rand>`, so a leftover is a file whose OWNING
    // PROCESS IS GONE. `process.kill(pid, 0)` asks that without signalling.
    // A test that fails because a sibling run is working is not measuring
    // cleanup; it is measuring timing.
    const ownerAlive = (name) => {
      const m = /__mutant__\.(\d+)-/.exec(name);
      if (!m) return false;                       // no owner encoded: an orphan by default
      const pid = Number(m[1]);
      if (pid === process.pid) return false;      // ours, and we are not mid-run
      try { process.kill(pid, 0); return true; } catch { return false; }
    };

    const leftovers = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'dist', '.vercel'].includes(e.name)) continue;
        if (e.name.includes('__mutant__')) {
          if (!ownerAlive(e.name)) leftovers.push(join(dir, e.name));
          continue;
        }
        if (e.isDirectory()) walk(join(dir, e.name));
      }
    };
    walk(REPO);
    assert.deepEqual(leftovers, [],
      'ORPHANED mutant scratch copies — their owning process is gone, so a sweep missed them ' +
      'and they are now inside the tree every walker reads. Files belonging to a LIVE run are ' +
      'not leftovers and are excluded.');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// MH-3 · THE CALIBRATION EXISTS AND IS WIRED
// ════════════════════════════════════════════════════════════════════════════
describe('MH-3 every harness carries a kill control and a survive control', () => {
  const CATALOGS = [
    ['provider', PROVIDER_CONTROLS, 'tests/mutations/provider-run.mjs'],
    ['guard', GUARD_CONTROLS, 'tests/mutations/run.mjs'],
  ];

  for (const [name, controls, runner] of CATALOGS) {
    test(`MH-3a ${name}: both control kinds are declared, for every channel`, () => {
      // PER CHANNEL, not per harness. A reviewer found that thirteen provider
      // mutants target the runtime-surface module while both controls defaulted
      // to the scanner — so the banner printed SENSITIVITY/SPECIFICITY PROVEN
      // over a channel no control had touched. If the surface indirection ever
      // stopped working, all thirteen would read as "SURVIVED — TEST GAP" and be
      // misdiagnosed as missing tests rather than as a broken instrument.
      // The runner's own default, so a mutant that omits `target` is counted on
      // the channel it actually runs against rather than on a fictional one.
      const scored = name === 'provider' ? PROVIDER_MUTANTS : MUTANTS;
      const DEFAULT_TARGET = name === 'provider' ? 'scan' : 'guard';
      const channelOf = (m) => m.target || DEFAULT_TARGET;
      const channels = new Set(scored.map(channelOf));
      for (const channel of channels) {
        const forChannel = controls.filter((c) => channelOf(c) === channel);
        assert.ok(forChannel.some((c) => c.control === 'kill'),
          `${name}/${channel}: no SENSITIVITY control — every "killed" on this channel is unexplained`);
        assert.ok(forChannel.some((c) => c.control === 'survive'),
          `${name}/${channel}: no SPECIFICITY control — every "killed" on this channel is unearned`);
      }
      for (const c of controls) {
        assert.ok(c.find && c.replace && c.find !== c.replace, `${c.id}: not an applied mutation`);
        assert.ok(c.invariant, `${c.id}: a control needs a stated reason`);
      }
    });

    test(`MH-3b ${name}: the runner judges the controls and refuses on failure`, () => {
      const src = readFileSync(new URL(`../${runner}`, import.meta.url), 'utf8');
      assert.match(src, /SENSITIVITY/, `${runner} must report sensitivity`);
      assert.match(src, /SPECIFICITY/, `${runner} must report specificity`);
      assert.match(src, /HARNESS INVALID/,
        `${runner} must REFUSE the run when a control lands the wrong way — reporting it and ` +
        'exiting 0 is how an uncalibrated instrument keeps producing numbers');
    });
  }

  test('MH-3c a control is never counted as a rule', () => {
    const ids = new Set([...PROVIDER_MUTANTS, ...MUTANTS, ...UI_MUTANTS].map((m) => m.id));
    for (const c of [...PROVIDER_CONTROLS, ...GUARD_CONTROLS]) {
      assert.ok(!ids.has(c.id),
        `${c.id} appears in a scored catalog as well as in the controls — it would inflate ` +
        'the denominator with a measurement of the instrument');
    }
  });

  test('MH-3e a `kills` name refers to a test that actually exists', () => {
    // A reviewer's point, generalised. The runner matches `kills` against the
    // names of FAILING tests, so a name that matches nothing can only ever be
    // reported as MISATTRIBUTED — but a name that is a fragment of a real one
    // ("PC", "PC-") silently matched the enclosing suite and counted as a kill.
    // The runner now requires a word boundary; this is the complementary half,
    // and the stronger one: the name must denote a test that is really there,
    // checked against the suites' source rather than against one run's failures.
    const SUITES = [
      'tests/round5-provider-controls.test.mjs',
      'tests/network-observability.test.mjs',
      'tests/provider-discovery.test.mjs',
    ];
    const titles = SUITES.flatMap((s) =>
      [...readFileSync(join(REPO, s), 'utf8').matchAll(/\b(?:test|describe)\(\s*['"`]([^'"`]+)/g)]
        .map((m) => m[1]));
    for (const m of PROVIDER_MUTANTS) {
      for (const k of m.kills || []) {
        assert.ok(titles.some((t) => t === k || t.startsWith(`${k} `) || t.startsWith(`${k}:`)),
          `${m.id} claims to be observed by "${k}", which is not the id of any test in the ` +
          'suites this harness runs. A mutant that names a test that does not exist can only ' +
          'ever be reported MISATTRIBUTED, which reads as a test gap rather than a typo.');
      }
    }
  });

  test('MH-3d every scored mutant names the test that must observe it', () => {
    // MISATTRIBUTION is the third outcome the provider runner learned to report:
    // a mutant that goes red somewhere unrelated leaves its own invariant
    // unobserved while counting as a kill.
    for (const m of PROVIDER_MUTANTS) {
      assert.ok(Array.isArray(m.kills) && m.kills.length,
        `${m.id} names no observing test, so "killed" cannot be attributed to anything`);
      assert.ok(m.mechanism, `${m.id} claims no mechanism from the derived inventory`);
    }
  });
});
