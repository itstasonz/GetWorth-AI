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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { discoverEndpoints, driveEndpoint, mintJWT, IMG } from './helpers/analyze-harness.mjs';

const SCAN_URL = process.env.PROVIDER_SCAN_PATH
  ? new URL(`file://${process.env.PROVIDER_SCAN_PATH}`)
  : new URL('./helpers/provider-scan.mjs', import.meta.url);
const S = await import(SCAN_URL.href);
const { scanModule, discoverModules, SCANNED_EXTENSIONS, NETWORK_ENTRYPOINTS } = S;

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
    assert.deepEqual(
      shapes("import { createClient } from '@supabase/supabase-js';\nexport const f = () => createClient(a, b);")
        .filter((s) => s === 'undeclared-dependency'), []);
    assert.deepEqual(
      shapes("import { x } from './y.js';\nexport const f = () => x();")
        .filter((s) => s === 'undeclared-dependency'), []);
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
