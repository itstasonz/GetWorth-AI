// ══════════════════════════════════════════════════════════════════════════════
// HIGH-2 — PROVIDER DISCOVERY COVERAGE
//
// THE PROPERTY
//   Every production module capable of initiating a billable external provider
//   call is DISCOVERABLE by the verification system, or EXPLICITLY REJECTED
//   by it.
//
// The round-9 scanner asserted that property and could not deliver it:
//   · it searched for FOUR KNOWN HOSTS, so a fifth provider matched nothing;
//   · it read `.js` and `.mjs`, so `.cjs` and `.ts` were never opened;
//   · a host built at runtime is in no literal, and nothing said so.
//
// The fix is not more strings. It is two layers with a stated division of
// labour, and a per-mutation record of WHICH layer catches WHICH shape:
//
//   STATIC   tests/helpers/provider-scan.mjs — finds hosts it has never heard
//            of, across every executable extension, and REFUSES construction it
//            cannot resolve rather than reporting clean.
//   RUNTIME  tests/helpers/analyze-harness.mjs — records any unmodelled host
//            ATTEMPTED during a request, out of band, so a `try/catch` in
//            production cannot hide it (HIGH-1).
//
// Static alone cannot be complete: a host can be assembled from values that
// only exist at runtime. Runtime alone cannot be complete either: it only sees
// paths a test actually walks. Neither layer is claimed to be sufficient, which
// is the part the previous round got wrong.
//
//   node --test tests/provider-discovery.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// ── S-1. THIS SUITE WAS LISTED AS A JUDGE AND COULD NOT SEE THE DEFENDANT ───
//
// tests/mutations/provider-run.mjs names this file among the three suites it
// judges provider mutants with, and this file imported the scanner DIRECTLY.
// So every mutant written to the temp copy was invisible here: PD-2, PD-4,
// PD-9, M-CONCAT and M-IMPORT could never go red, and mutants those tests are
// the natural observers for were reported SURVIVED for a reason that has
// nothing to do with the property. One third of the harness's own judging
// surface was decorative.
const SCAN_URL = process.env.PROVIDER_SCAN_PATH
  ? new URL(`file://${process.env.PROVIDER_SCAN_PATH}`)
  : new URL('./helpers/provider-scan.mjs', import.meta.url);
const { discoverModules, scanAll, scanModule, lex, SCANNED_EXTENSIONS, enclosingFunction } =
  await import(SCAN_URL.href);
// ── S-2. THE SURFACE IS DERIVED FROM THE DEPLOYMENT CONTRACT ────────────────
// `const API = new URL('../api/', import.meta.url)` was an axiom nobody had
// checked. See tests/helpers/runtime-surface.mjs.
// Pointed at the mutated copy for the same reason the scanner is: S-2 put
// thirteen more security decision sites in that module, and a suite that
// imports it directly cannot observe any of them being deleted.
const SURFACE_URL = process.env.RUNTIME_SURFACE_PATH
  ? new URL(`file://${process.env.RUNTIME_SURFACE_PATH}`)
  : new URL('./helpers/runtime-surface.mjs', import.meta.url);
const { discoverRuntimeSurface, deploymentContract, UNSCANNABLE_RUNTIME_EXTENSIONS } =
  await import(SURFACE_URL.href);

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const PROBE = new URL('./fixtures/provider-probe/', import.meta.url);

// ── THE HOST REGISTRY ───────────────────────────────────────────────────────
// Every host literal under api/ gets an explicit disposition. "Not a provider"
// is a claim someone made on the record, not an omission.
//
//   PROVIDER  — billable third party. MUST also appear in the refund INVENTORY.
//   OWN       — our own infrastructure.
//   INBOUND   — a CORS origin allowlist. This is a host we ACCEPT requests from,
//               never one we send requests to. Different direction, different
//               risk; conflating the two is how an allowlist entry becomes an
//               egress target by accident.
//   DEV       — local development only.
const HOST_REGISTRY = {
  'api.anthropic.com':       'PROVIDER',
  'api.openai.com':          'PROVIDER',
  'vision.googleapis.com':   'PROVIDER',
  'api.voyageai.com':        'PROVIDER',
  'get-worth-ai.vercel.app': 'INBOUND',
  localhost:                 'DEV',
};

// ── THE UNRESOLVABLE-SITE REGISTRY ──────────────────────────────────────────
// A site where the target host cannot be resolved by reading the source. Each
// needs a written reason and a named layer that covers it instead. An entry
// here is a DEBT, not an exemption: it says "static analysis stops here, and
// this is what catches it next".
const DYNAMIC_REGISTRY = [
  {
    file: 'api/analyze.js', shape: 'variable-base-target',
    why: 'Supabase JWKS, base from process.env.SUPABASE_URL — our own infrastructure, not a provider',
    coveredBy: 'runtime: the harness routes fake.supabase.co explicitly; anything else is recorded unknown',
  },
  {
    file: 'api/analyze.js', shape: 'non-literal-target',
    why: 'fetchWithRetry(url) — the retry wrapper. Its callers pass the literals scanned above',
    coveredBy: 'static: every fetchWithRetry CALLER has a literal target, asserted below',
  },
];

const SURFACE = discoverRuntimeSurface(REPO);
const MODULES = SURFACE.modules;

describe('discovery covers every executable module and every host', () => {
  test('PD-1 the scanned extension set includes the ones that were missing', () => {
    for (const ext of ['.js', '.mjs', '.cjs', '.ts']) {
      assert.ok(SCANNED_EXTENSIONS.includes(ext), `${ext} must be scanned — its absence WAS the finding`);
    }
  });

  test('PD-2 every runtime module is discovered, including nested _lib', () => {
    const paths = MODULES.map((m) => m.path);
    assert.ok(paths.includes('api/analyze.js'));
    assert.ok(paths.includes('api/_lib/openai-recognition.js'), 'nested modules must be discovered');
    assert.ok(paths.length >= 9, `expected every runtime module, found ${paths.length}`);
    // The discovery mechanism the MUTATION harness breaks is `discoverModules`,
    // and the surface deriver does not use it — so the same property is asserted
    // through it as well, or a mutant that blinds it has no observer here.
    const walked = discoverModules(new URL('./fixtures/provider-probe/', import.meta.url));
    assert.ok(walked.length >= 5,
      `discoverModules walked ${walked.length} files in a directory that plainly has more`);
  });

  // ── S-2. THE SURFACE, DERIVED ────────────────────────────────────────────
  describe('PD-11 the runtime surface comes from the deployment contract', () => {
    test('PD-11a the contract is READ, and names the artefacts it was read from', () => {
      const c = deploymentContract(REPO);
      assert.ok(c.sources.includes('vercel.json'),
        'the deployment contract must be read from the repository, not assumed');
      assert.ok(c.roots.length >= 1, 'no function root was derived at all');
      assert.ok(!c.roots.includes(c.outputDirectory),
        'the static build output is not server code, whatever a rewrite says');
    });

    test('PD-11b a provider path in a location NOBODY NAMED is still discovered', () => {
      // THE ADVERSARIAL PROOF. A synthetic repository carrying THIS repo's real
      // vercel.json, with three provider paths planted where no line of the
      // implementation mentions them:
      //   1. a deeply nested module under the function root
      //   2. a module OUTSIDE every function root, reached only by an import
      //   3. a Python function — executable in production, unreadable here
      // All three must be accounted for. The third must be REFUSED by name
      // rather than skipped, because a blind spot that reports clean is the
      // defect this whole layer exists to remove.
      const root = mkdtempSync(join(tmpdir(), 'gw-surface-'));
      try {
        copyFileSync(join(REPO, 'vercel.json'), join(root, 'vercel.json'));
        copyFileSync(join(REPO, 'package.json'), join(root, 'package.json'));
        mkdirSync(join(root, 'api/_lib/deeply/nested'), { recursive: true });
        mkdirSync(join(root, 'lib/pricing'), { recursive: true });
        writeFileSync(join(root, 'api/quote.js'),
          "import { price } from '../lib/pricing/vendor.js';\nexport default async function h(req) { return price(req); }\n");
        writeFileSync(join(root, 'api/_lib/deeply/nested/market.mjs'),
          "export const q = () => fetch('https://api.nested-market-vendor.example/v1');\n");
        writeFileSync(join(root, 'lib/pricing/vendor.js'),
          "export const price = (q) => fetch('https://api.outside-the-root-vendor.example/v1');\n");
        writeFileSync(join(root, 'api/report.py'), "import requests\n");

        const s = discoverRuntimeSurface(root);
        const paths = s.modules.map((m) => m.path);
        assert.ok(paths.includes('api/_lib/deeply/nested/market.mjs'),
          'a module nested below the function root was not discovered');
        assert.ok(paths.includes('lib/pricing/vendor.js'),
          'a module OUTSIDE every function root, imported by a handler, runs on the server ' +
          'and was not discovered — this is the assumption S-2 exists to remove');

        const hosts = scanAll(s.modules).literals.map((l) => l.host).sort();
        assert.deepEqual(hosts,
          ['api.nested-market-vendor.example', 'api.outside-the-root-vendor.example'],
          'both planted providers must be found by the scan over the derived surface');

        assert.deepEqual(s.unscannable.map((u) => u.path), ['api/report.py'],
          'a runtime an extension this toolchain cannot lex must be REFUSED by name, not skipped');
        assert.ok(UNSCANNABLE_RUNTIME_EXTENSIONS.includes('.py'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('PD-11c a specifier chosen at RUNTIME is refused, not reported clean', () => {
      // THE SELF-REVIEW'S WITNESS against the first version of this module. A
      // handler containing `await import('../lib/hidden/' + n + '.js')` reaches
      // a provider the surface never lists — and `unresolved` came back EMPTY,
      // so the report was clean about a region it had not entered. That is the
      // four-known-hosts failure one level up, and it is why the walk now
      // DETECTS THE SHAPE AND REFUSES IT rather than resolving what it can and
      // saying nothing about the rest.
      const root = mkdtempSync(join(tmpdir(), 'gw-dyn-'));
      try {
        copyFileSync(join(REPO, 'vercel.json'), join(root, 'vercel.json'));
        mkdirSync(join(root, 'api'), { recursive: true });
        mkdirSync(join(root, 'lib'), { recursive: true });
        writeFileSync(join(root, 'api/a.js'),
          "const n = 'vendor';\nexport default async function h() { const m = await import('../lib/' + n + '.js'); return m.go(); }\n");
        writeFileSync(join(root, 'lib/vendor.js'),
          "export const go = () => fetch('https://api.computed-specifier-vendor.example/v1');\n");
        // The control beside it: an ORDINARY literal dynamic import is followed,
        // not refused. A walk that flags every `import(` is noise, not a guard.
        writeFileSync(join(root, 'api/b.js'),
          "export default async function h2() { const m = await import('./_ok.js'); return m.ok(); }\n");
        writeFileSync(join(root, 'api/_ok.js'),
          "export const ok = () => fetch('https://api.literal-dynamic-vendor.example/v1');\n");

        const s = discoverRuntimeSurface(root);
        const computed = s.unresolved.filter((u) => u.shape === 'computed-specifier');
        assert.equal(computed.length, 1,
          `a computed specifier must be refused by name; got ${JSON.stringify(s.unresolved)}`);
        assert.equal(computed[0].from, 'api/a.js');
        assert.ok(scanAll(s.modules).literals.map((l) => l.host)
          .includes('api.literal-dynamic-vendor.example'),
          'a LITERAL dynamic import must still be followed — refusing every import() is noise');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test('PD-11d the real surface has no unscannable file and no unfollowable import', () => {
      assert.deepEqual(SURFACE.unscannable, [],
        'a production file the platform executes and this toolchain cannot read');
      assert.deepEqual(SURFACE.unresolved, [],
        'an import this walk cannot follow — unresolvable on disk, or a specifier chosen at ' +
        'runtime — is a region of the surface it did not enter');
    });
  });

  test('PD-3 every host literal under api/ has an explicit disposition', () => {
    const { literals } = scanAll(MODULES);
    const unregistered = [...new Set(literals.map((l) => l.host))].filter((h) => !(h in HOST_REGISTRY));
    assert.deepEqual(unregistered, [],
      'a host appears in production source with no disposition. If it is billable, add it to ' +
      'HOST_REGISTRY as PROVIDER and to the INVENTORY in tests/refund-crossproduct.test.mjs; ' +
      'if it is not, say which it is and why.');
  });

  test('PD-4 the registry is not stale — every registered host is still in source', () => {
    const { literals } = scanAll(MODULES);
    const seen = new Set(literals.map((l) => l.host));
    for (const host of Object.keys(HOST_REGISTRY)) {
      assert.ok(seen.has(host), `HOST_REGISTRY declares ${host}, which no longer appears under api/`);
    }
  });

  test('PD-5 every PROVIDER host is also in the refund INVENTORY', () => {
    // The two artefacts disagreed once before, in exactly this direction:
    // api.openai.com was live and inventoried nowhere. Assert the agreement.
    const xp = readFileSync(new URL('./refund-crossproduct.test.mjs', import.meta.url), 'utf8');
    const inventoried = new Set([...xp.matchAll(/host:\s*'([^']+)'/g)].map((m) => m[1]));
    for (const [host, kind] of Object.entries(HOST_REGISTRY)) {
      if (kind !== 'PROVIDER') continue;
      assert.ok(inventoried.has(host),
        `${host} is registered as a billable PROVIDER but has no INVENTORY entry, so no ledger ` +
        'disposition has been claimed for it');
    }
  });

  test('PD-6 an INBOUND origin is never used as an egress target', () => {
    // A CORS allowlist entry and a fetch target look identical to a grep. They
    // are not the same thing, and a host that is both is worth noticing.
    const { literals } = scanAll(MODULES);
    for (const l of literals) {
      if (HOST_REGISTRY[l.host] !== 'INBOUND') continue;
      const src = MODULES.find((m) => m.path === l.file).source;
      const line = src.split(String.fromCharCode(10))[l.line - 1];
      assert.ok(!/\bfetch\s*\(|\bnew\s+URL\s*\(/.test(line),
        `${l.host} is registered INBOUND but appears in a request at ${l.file}:${l.line}`);
    }
  });
});

describe('unresolvable construction is REFUSED, not reported clean', () => {
  test('PD-7 every unresolvable site under api/ is registered with a reason', () => {
    const { dynamic } = scanAll(MODULES);
    const key = (d) => `${d.file}::${d.shape}`;
    const declared = new Set(DYNAMIC_REGISTRY.map((d) => `${d.file}::${d.shape}`));
    const found = [...new Set(dynamic.map(key))];

    for (const k of found) {
      assert.ok(declared.has(k),
        `UNRESOLVABLE REQUEST TARGET at ${k} with no disposition. The host cannot be read from ` +
        'the source, so either make it a literal, or register it in DYNAMIC_REGISTRY saying what ' +
        'it is and which layer covers it.');
    }
    for (const k of declared) {
      assert.ok(found.includes(k), `DYNAMIC_REGISTRY declares ${k}, which no longer exists`);
    }
  });

  test('PD-8 every fetchWithRetry caller passes a literal — the wrapper claim is checked', () => {
    // DYNAMIC_REGISTRY says fetchWithRetry is safe BECAUSE its callers pass
    // literals. That is a claim about other code, so it gets verified here
    // rather than believed. A caller that passes a computed URL turns the
    // wrapper into an unbounded egress point.
    const analyze = MODULES.find((m) => m.path === 'api/analyze.js');
    const { code, strings } = lex(analyze.source);
    const literalAt = new Map(strings.map((s) => [s.index, s]));
    const callers = [];
    for (const m of code.matchAll(/\bfetchWithRetry\s*\(/g)) {
      const head = analyze.source.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(head)) continue;                 // the declaration
      let k = m.index + m[0].length;
      while (k < analyze.source.length && /\s/.test(analyze.source[k])) k++;
      const lit = literalAt.get(k);
      const line = analyze.source.slice(0, m.index).split(String.fromCharCode(10)).length;
      callers.push({ line, literal: lit ? lit.text : null });
    }
    assert.ok(callers.length >= 4, `expected the known fetchWithRetry callers, found ${callers.length}`);
    for (const c of callers) {
      assert.ok(c.literal && /^https:\/\/[A-Za-z0-9.-]+\//.test(c.literal),
        `fetchWithRetry at analyze.js:${c.line} is called with a NON-LITERAL target ` +
        `(${c.literal ?? 'identifier'}). The wrapper's registry entry claims every caller ` +
        'passes a literal; that is no longer true.');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// THE MUTATIONS. Each is a provider that the round-9 scanner reported clean.
// The fixtures are real files under tests/fixtures/provider-probe/ — the
// scanner is pointed at a directory, so it can be aimed at a hostile tree
// without writing anything into api/.
//
//   MUTATION                     LAYER THAT CATCHES IT
//   provider in a new .cjs       STATIC  — extension set
//   provider in a new .ts        STATIC  — extension set
//   concatenated hostname        STATIC  — refused as unresolvable, never "clean"
//   imported hostname constant   STATIC  — twice: literal at the declaration,
//                                          unresolvable target at the consumer
//   interpolated authority       STATIC  — refused as unresolvable
//   anything the above miss      RUNTIME — HIGH-1's out-of-band record
// ══════════════════════════════════════════════════════════════════════════════
describe('MUTATIONS — each planted provider is detected, and by a named layer', () => {
  const PROBE_MODULES = discoverModules(PROBE);
  const scan = (file) => scanModule(PROBE_MODULES.find((m) => m.path === file));

  test('M-CJS a provider in a .cjs module is found STATICALLY', () => {
    const r = scan('vendor-cjs.cjs');
    assert.deepEqual(r.literals.map((l) => l.host), ['api.cjs-market-vendor.example'],
      'a CommonJS module was not even opened by the previous scanner');
    assert.equal(enclosingFunction(PROBE_MODULES.find((m) => m.path === 'vendor-cjs.cjs').source, r.literals[0].line),
      'priceFromVendor', 'the site must be attributed to its function, for a ledger disposition');
  });

  test('M-TS a provider in a .ts module is found STATICALLY', () => {
    const r = scan('vendor-ts.ts');
    assert.deepEqual(r.literals.map((l) => l.host), ['api.ts-market-vendor.example']);
  });

  test('M-CONCAT a concatenated hostname is REFUSED, and never resolved wrongly', () => {
    const r = scan('vendor-concat.mjs');
    const shapes = new Set(r.dynamic.map((d) => d.shape));
    assert.ok(shapes.has('concatenated-authority'),
      'a host assembled with + must be flagged as unresolvable');
    // And the fragment must NOT be reported as if it were the host. A false
    // resolution is worse than none: it looks like an answer.
    assert.deepEqual(r.literals, [],
      "the fragment 'https://api.' must not be reported as the host 'api.'");
    assert.ok(shapes.has('partial-authority'), 'a truncated authority is itself a finding');
  });

  test('M-IMPORT an imported hostname constant is caught at BOTH ends', () => {
    const decl = scan('host-constant.mjs');
    assert.deepEqual(decl.literals.map((l) => l.host), ['api.imported-const-vendor.example'],
      'the declaring module still contains the literal, and is scanned');

    const use = scan('vendor-imported.mjs');
    assert.ok(use.dynamic.some((d) => d.shape === 'non-literal-target' && d.ident === 'MARKET_HOST'),
      'the CONSUMING module has no literal at all, so the call target must be refused as unresolvable');
  });

  test('M-INTERP an interpolated authority is REFUSED', () => {
    const r = scan('vendor-imported.mjs');
    assert.ok(r.dynamic.some((d) => d.shape === 'interpolated-authority'),
      'https://${vendor}.market.example is a host chosen at runtime');
  });

  test('M-CONTROL a module with no request reports NOTHING', () => {
    // Without this the suite proves only that the scanner is noisy. The fixture
    // names two provider hosts in comments and the word fetch( in a string.
    const r = scan('clean.mjs');
    assert.deepEqual(r.literals, [], 'a host in a COMMENT is not a call site');
    assert.deepEqual(r.dynamic, [], 'the word fetch( inside a string is not a call site');
  });

  test('M-ALL the probe tree as a whole: five findings, zero silent passes', () => {
    const r = scanAll(PROBE_MODULES);
    const files = new Set([...r.literals, ...r.dynamic].map((x) => x.file));
    for (const f of ['vendor-cjs.cjs', 'vendor-ts.ts', 'vendor-concat.mjs', 'vendor-imported.mjs', 'host-constant.mjs']) {
      assert.ok(files.has(f), `${f} plants a provider and produced NO finding — a silent pass`);
    }
    assert.ok(!files.has('clean.mjs'), 'the control must stay clean');
  });
});

// ── THE LEXER'S OWN RUNAWAY GUARD ───────────────────────────────────────────
// The first draft of lex() used a single depth counter for templates, ran off
// the end of api/analyze.js's prompt builders, and blanked EVERY provider
// literal after line 1010 — all four api.anthropic.com sites included. It
// reported "no provider hosts in analyze.js" and would have passed every test
// above by finding nothing at all. Same failure, same file, as the runaway
// recorded in tests/refund-crossproduct.test.mjs.
test('PD-9 the lexer does not desynchronise on the largest production file', () => {
  const analyze = MODULES.find((m) => m.path === 'api/analyze.js');
  const { code, strings } = lex(analyze.source);

  assert.equal(code.length, analyze.source.length, 'the mask must not shift a single index');
  assert.equal(code.split(String.fromCharCode(10)).length,
    analyze.source.split(String.fromCharCode(10)).length, 'line count must be preserved');

  // Literals must be found across the WHOLE file, not just the first third.
  const last = Math.max(...strings.map((s) => s.line));
  const total = analyze.source.split(String.fromCharCode(10)).length;
  assert.ok(last > total * 0.9,
    `the last literal the lexer saw is at line ${last} of ${total} — it desynchronised and ` +
    'stopped seeing the file. This is the exact shape that made the scan vacuous.');

  // And the known provider sites are all present, by line.
  const anthropic = scanModule(analyze).literals.filter((l) => l.host === 'api.anthropic.com');
  assert.equal(anthropic.length, 4,
    `expected 4 api.anthropic.com sites in analyze.js, found ${anthropic.length}`);
});

test('PD-10 a comment is never a call site, a call site is never a comment', () => {
  const src = [
    "// https://api.commented-vendor.example/v1",
    "/* https://api.block-commented.example/v1 */",
    "const doc = 'mentions https://api.in-a-string.example/v1';",
    "await fetch('https://api.real-call.example/v1');",
  ].join(String.fromCharCode(10));
  const r = scanModule({ path: 'probe.mjs', source: src });
  const hosts = r.literals.map((l) => l.host).sort();
  assert.deepEqual(hosts, ['api.in-a-string.example', 'api.real-call.example'],
    'comments are dropped; a host in a live string is reported even outside a call, because a ' +
    'string is a value the code can still use');
});
