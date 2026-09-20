// ══════════════════════════════════════════════════════════════════════════════
// NO NETWORK DESTINATION IS INVISIBLE TO BOTH LAYERS  ·  §2   +   N-3
//
// THE INVARIANT
//   For every way of reaching an external host, at least one of
//     A. static provider discovery      (tests/helpers/provider-scan.mjs)
//     B. runtime unknown-host observation (tests/helpers/analyze-harness.mjs)
//   must either RESOLVE the destination or REFUSE the construction by name.
//   No construction may be silently green in both.
//
// WHY A GENERATED MATRIX AND NOT FIXTURES. The round-2 review found two holes,
// and neither was in the fixture set, because a fixture set contains the shapes
// somebody thought of:
//
//   N-1  `export const f = (q) => fetch(H + '/v1')`  reported NOTHING, while the
//        identical call in a `function` body reported `non-literal-target`. The
//        declaration filter matched `=>` in order to skip `const f = () => ...`,
//        a shape it could never have matched, and skipped every concise arrow
//        BODY instead. The record claimed this mutant was caught "STATIC —
//        unresolvable target at the consumer". For arrow bodies that was false,
//        and an `await` between the arrow and the call is the only reason any
//        case survived to look correct.
//
//   N-2  `import https from 'node:https'; https.request(o)` reported NOTHING
//        statically and could not be observed at runtime either, because the
//        harness patches `globalThis.fetch` and nothing else. A literal host in
//        an options object carries no `//`, so even the literal case was invisible.
//
// So the matrix below is CONSTRUCTED here, in code, from the axes that matter —
// how the URL is built, how the call is written, what module system, what
// transport — and every cell must be accounted for. Adding an axis adds cases
// without anyone writing them down.
//
//   node --test tests/network-observability.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  scanModule, discoverModules, SCANNED_EXTENSIONS,
  NETWORK_ENTRYPOINTS, UNSUPPORTED_TRANSPORTS,
} from './helpers/provider-scan.mjs';
import { readSource, normalizeEol } from './mutations/read-source.mjs';

const mod = (source, path = 't.mjs') => scanModule({ path, source });
const verdict = (r) => ({
  hosts: r.literals.map((l) => l.host),
  shapes: [...new Set(r.dynamic.map((d) => d.shape))],
  seen: r.literals.length > 0 || r.dynamic.length > 0,
});

// ════════════════════════════════════════════════════════════════════════════
// §2  THE ADVERSARIAL CONSTRUCTION MATRIX
// ════════════════════════════════════════════════════════════════════════════
describe('NO-1 the generated construction matrix', () => {
  // AXIS 1 — how the destination is built. Each entry yields the expression text
  // and what the scanner is entitled to conclude about it.
  const TARGETS = [
    ['literal',          () => "'https://api.matrix-a.example/v1'",            'resolved'],
    ['concatenation',    () => "'https://api.' + REGION + '-b.example/v1'",    'refused'],
    ['template-authority', () => '`https://${VENDOR}.c.example/v1`',           'refused'],
    ['imported-constant', () => "HOST + '/v1'",                                'refused'],
    ['variable-base',    () => '`${BASE}/rest/v1/x`',                          'refused'],
    ['array-join',       () => "PARTS.join('') + '/v1'",                       'refused'],
    ['base64',           () => "Buffer.from(ENC, 'base64').toString()",        'refused'],
    ['object-property',  () => 'TARGET.url',                                   'refused'],
  ];
  // AXIS 2 — how the call is written. The arrow body is N-1.
  const CALLS = [
    ['arrow-body',      (t) => `export const f = (q) => fetch(${t});`],
    ['arrow-await',     (t) => `export const f = async (q) => await fetch(${t});`],
    ['function-body',   (t) => `export function f(q) { return fetch(${t}); }`],
    ['async-function',  (t) => `export async function f(q) { const r = await fetch(${t}); return r; }`],
    ['method',          (t) => `export const o = { async f(q) { return fetch(${t}); } };`],
    ['new-url',         (t) => `export const f = (q) => fetch(new URL(${t}));`],
    ['retry-helper',    (t) => `export const f = (q) => fetchWithRetry(${t}, {});`],
  ];
  const PRELUDE = [
    "const REGION = 'eu';",
    "const VENDOR = process.env.V;",
    "import { HOST } from './h.mjs';",
    "const BASE = process.env.B;",
    "const PARTS = ['ht', 'tps://', 'api.matrix-k.example'];",
    "const ENC = 'aHR0cHM6Ly9hcGkuZXhhbXBsZQ==';",
    "const TARGET = { url: 'https://api.matrix-l.example/v1' };",
  ].join('\n');

  test('NO-1a every cell is either RESOLVED or REFUSED — none is silently green', () => {
    const silent = [];
    let cells = 0;
    for (const [tname, target, expectation] of TARGETS) {
      for (const [cname, build] of CALLS) {
        cells++;
        const src = `${PRELUDE}\n${build(target())}\n`;
        const v = verdict(mod(src));
        if (!v.seen) { silent.push(`${tname} / ${cname}`); continue; }
        if (expectation === 'resolved') {
          assert.ok(v.hosts.length > 0 || v.shapes.length > 0,
            `${tname}/${cname}: a literal destination must be reported`);
        } else {
          assert.ok(v.shapes.length > 0 || v.hosts.length > 0,
            `${tname}/${cname}: an unresolvable destination must be REFUSED, not ignored`);
        }
      }
    }
    assert.ok(cells >= 50, `only ${cells} cells generated`);
    assert.deepEqual(silent, [],
      'these constructions reach the network and the scanner reported nothing at all');
  });

  test('NO-1b N-1 THE WITNESS: an arrow body is a call site, not a declaration', () => {
    // The exact pair from the round-2 report. Same call, same target, and the
    // verdicts must now agree.
    const arrow = verdict(mod("import { H } from './h.mjs';\nexport const f = (q) => fetch(H + '/v1');"));
    const fn = verdict(mod("import { H } from './h.mjs';\nexport function f(q) { return fetch(H + '/v1'); }"));
    assert.ok(arrow.seen, 'the arrow body reported NOTHING before this fix');
    assert.deepEqual(arrow.shapes, fn.shapes,
      'the same call written two ways must produce the same verdict');
    assert.ok(arrow.shapes.includes('non-literal-target'));
  });

  test('NO-1c a real DECLARATION is still not a call site', () => {
    // The negative control for NO-1b. Relaxing the filter must not have turned
    // the definition of fetchWithRetry into a finding — a scanner that reports
    // its own helper produces noise, and noise devalues every other verdict.
    const decl = verdict(mod('async function fetchWithRetry(url, options) { return url; }'));
    assert.equal(decl.seen, false, 'a function DECLARATION must not be reported as a call');
    const arrowDecl = verdict(mod("const fetchWithRetry = (url) => url;\nexport { fetchWithRetry };"));
    assert.equal(arrowDecl.seen, false, 'nor an arrow-assigned declaration of the same name');
  });

  test('NO-1d N-2 THE WITNESS: an unsupported transport fails the gate BY NAME', () => {
    for (const t of ['node:https', 'node:http', 'axios', 'undici', 'got', 'node-fetch']) {
      const v = mod(`import x from '${t}';\nexport function f(o) { return x.request(o); }`);
      const hit = v.dynamic.find((d) => d.shape === 'unsupported-transport');
      assert.ok(hit, `${t} must be refused`);
      assert.equal(hit.transport, t, 'the report must NAME the transport, not merely flag the file');
    }
    // require() too — a .cjs provider is the shape that was missed once already.
    const cjs = mod("const https = require('node:https');\nmodule.exports = (o) => https.request(o);", 'v.cjs');
    assert.ok(cjs.dynamic.some((d) => d.shape === 'unsupported-transport'));
  });

  test('NO-1e a transport named only in a COMMENT or a prompt is not an import', () => {
    // The mirror of NO-1c. A scanner that flags the word `axios` inside a prompt
    // string produces findings nobody can act on.
    const noise = mod([
      "// we deliberately do not use axios or node:https here",
      "const PROMPT = `Do not import node:https or undici.`;",
      "export const f = (q) => fetch('https://api.clean.example/v1');",
    ].join('\n'));
    assert.deepEqual(noise.dynamic.filter((d) => d.shape === 'unsupported-transport'), []);
    assert.deepEqual(noise.literals.map((l) => l.host), ['api.clean.example']);
  });

  test('NO-1f every declared entrypoint is genuinely followed', () => {
    // NETWORK_ENTRYPOINTS is a claim about what this scanner can see. Asserted
    // rather than trusted: a name listed there and not actually matched would be
    // a documented capability that does not exist.
    for (const ep of NETWORK_ENTRYPOINTS) {
      const call = ep === 'new URL' ? 'new URL(TARGET.url)' : `${ep}(TARGET.url)`;
      const v = verdict(mod(`const TARGET = { url: '' };\nexport const f = () => ${call};`));
      assert.ok(v.seen, `${ep} is declared an entrypoint but a non-literal target through it is invisible`);
    }
    assert.ok(UNSUPPORTED_TRANSPORTS.length >= 10, 'the transport list must not have been emptied');
  });

  test('NO-1g every executable extension is discovered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-ext-'));
    try {
      for (const ext of SCANNED_EXTENSIONS) {
        writeFileSync(join(dir, `v${ext.replace('.', '_')}${ext}`),
          `export const f = () => fetch('https://api.ext${ext.replace('.', '-')}.example/v1');\n`);
      }
      const mods = discoverModules(pathToFileURL(dir + '/'));
      assert.equal(mods.length, SCANNED_EXTENSIONS.length, 'every declared extension must be opened');
      for (const m of mods) {
        assert.ok(scanModule(m).literals.length > 0, `${m.path}: a literal host in it was not found`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('NO-2 the runtime layer is the backstop, and it is fail-closed', () => {
  test('NO-2a the harness records an unknown host OUT OF BAND and refuses to pass', () => {
    // Static analysis cannot be complete — NO-1a's `base64` and `array-join`
    // rows are resolved by nobody. Those are RUNTIME's, and runtime only counts
    // if production cannot swallow it. The record must therefore live outside
    // production's call stack.
    const src = readSource(new URL('./helpers/analyze-harness.mjs', import.meta.url).pathname.replace(/^\//, ''));
    assert.match(src, /state\.unknownHosts\.push/,
      'the out-of-band record is what survives a try/catch in production');
    assert.match(src, /assertNoUnknownHosts/);
    // And the one escape hatch exists in exactly one file, so it cannot become
    // an idiom.
    // The "escape hatch appears in exactly one file" property is NOT asserted
    // here. tests/provider-observability.test.mjs already owns it, and writing
    // the token in a second counting test made the two disagree about their own
    // expected lists — each one's mention became the other's violation. One
    // property, one owner; this test cites it rather than re-deriving it.
    assert.match(readFileSync(new URL('./provider-observability.test.mjs', import.meta.url), 'utf8'),
      /it exists only to prove the /,
      'the single-file property must still be asserted SOMEWHERE, by its owner');
  });

  test('NO-2b production reaches the network ONLY through declared entrypoints', () => {
    // The composition of the two layers, checked against the real tree rather
    // than against fixtures. If api/ ever imports a transport the scanner cannot
    // follow, this fails by name — which is the whole point of N-2.
    const api = discoverModules(new URL('../api/', import.meta.url));
    assert.ok(api.length >= 5, 'the api/ tree must actually have been discovered');
    const offenders = [];
    for (const m of api) {
      for (const d of scanModule(m).dynamic) {
        if (d.shape === 'unsupported-transport') offenders.push(`${m.path}:${d.line} ${d.transport}`);
      }
    }
    assert.deepEqual(offenders, [],
      'a transport neither layer can observe reached production');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// N-3  THE MUTATION GATE CAN RUN
// ════════════════════════════════════════════════════════════════════════════
describe('NO-3 a mutation harness cannot be defeated by line endings', () => {
  test('NO-3a a multi-line needle matches a CRLF source through the shared reader', () => {
    // The behaviour, not the source text. `ui-run.mjs` reported 27 MALFORMED
    // mutants on a CRLF checkout and blamed the catalog — "the guard was
    // refactored; re-pin these" — which is a false accusation that sends someone
    // to rewrite correct mutants against correct code.
    const needle = 'const a = 1;\nconst b = 2;';
    const crlf = 'const a = 1;\r\nconst b = 2;\r\n';
    assert.equal(crlf.includes(needle), false, 'this is the failure being fixed');
    assert.equal(normalizeEol(crlf).includes(needle), true);
    assert.equal(normalizeEol(normalizeEol(crlf)), normalizeEol(crlf), 'idempotent');
    assert.equal(normalizeEol('a\rb'), 'a\nb', 'a lone CR is a line ending too');
  });

  test('NO-3b ALL THREE harnesses read through it — not just the one that was fixed', () => {
    // The round-9 fix was applied to run.mjs alone, and `.gitattributes` was
    // added without renormalising the working tree, so two harnesses kept
    // reading raw. sanitizer-run.mjs passed anyway, purely because its two
    // targets happened to be LF on disk. That is an accident of file history,
    // not a property, and this is what makes it one.
    for (const h of ['run.mjs', 'ui-run.mjs', 'sanitizer-run.mjs']) {
      const src = readFileSync(new URL(`./mutations/${h}`, import.meta.url), 'utf8');
      assert.match(src, /import \{ readSource \} from '\.\/read-source\.mjs'/,
        `${h} must read sources through the shared normaliser`);
      assert.equal(/readFileSync\((?:GUARD|ANALYZE|TRUST|abs\(t\.src\))/.test(src), false,
        `${h} still reads a mutation target raw`);
    }
  });

  test('NO-3c the working tree obeys the EOL policy it declares', () => {
    // `.gitattributes` said `eol=lf` while `git ls-files --eol` reported
    // `i/lf w/crlf attr/text eol=lf` for 385 files: the index LF, the attribute
    // LF, the file on disk CRLF. A declared policy nothing enforces is the same
    // shape of defect as a guard nothing calls.
    const attrs = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
    const declared = [...attrs.matchAll(/^\*(\.\w+)\s+text\s+eol=lf/gm)].map((m) => m[1]);
    assert.ok(declared.includes('.js') && declared.includes('.mjs'),
      '.gitattributes must still declare LF for the files the harnesses read');
    const CR = String.fromCharCode(13);
    const offenders = [];
    for (const root of ['../api/', './']) {
      for (const m of discoverModules(new URL(root, import.meta.url))) {
        if (declared.some((d) => m.path.endsWith(d)) && m.source.includes(CR)) offenders.push(m.path);
      }
    }
    assert.deepEqual(offenders, [],
      'these files are declared eol=lf and are CRLF on disk — re-checkout or renormalise');
  });
});
