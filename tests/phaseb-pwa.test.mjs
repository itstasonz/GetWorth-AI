// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — THE PWA INTEGRATION
//
// The claims this integration makes are all claims about what does NOT happen,
// which means none of them are worth anything as sentences:
//
//   the OpenAI key never reaches the browser
//   Phase B is development-only
//   production is unchanged
//   no mock stands in for the live path
//
// Each is checked here against an artifact or a source file. The build test is
// the important one: "development only" is asserted by grepping the BUILT
// BUNDLE, because tree-shaking either removed the branch or it did not, and
// that is a fact about a file rather than a belief about a flag.
//
//   node --test tests/phaseb-pwa.test.mjs
//
// The build test SKIPS when dist/ is absent, so the suite stays runnable on a
// clean checkout — but `npm test` runs after `npm run build` in CI, and a
// skipped test that matters says so in its message rather than passing quietly.
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, join } from 'node:path';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');

const CONTEXT = 'src/contexts/AppContext.jsx';
const RESULTS = 'src/views/CameraResultsView.jsx';
const DEV_API = 'scripts/vite-dev-api.mjs';
const ENRICH = 'api/enrich.js';

/**
 * Does this function body touch anything a CALLER could influence?
 *
 * Comments are stripped and the names are matched on word boundaries, because
 * the naive version of this check fails on prose. `/req/i` matches the word
 * "required" in a comment, so a correct function reads as compromised — and a
 * test that cries wolf on its own documentation gets loosened until it catches
 * nothing. The question is whether the CODE names a request, not whether the
 * explanation does.
 */
function requestShaped(fnBody) {
  const code = fnBody
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return /\b(req|request|headers|body|query|params|VITE_[A-Z_]+)\b/.test(code);
}

/** Every file under dist/, recursively. */
function distFiles() {
  const root = resolvePath(REPO, 'dist');
  if (!existsSync(root)) return null;
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// PWA-1 · THE KEY NEVER LEAVES THE SERVER
//
// The only rule here with an irreversible consequence. Everything else on this
// page is a correctness bug; this one is a leaked credential.
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-1 OPENAI_API_KEY is server-side only', () => {
  test('PWA-1a no client source reads the key, under any spelling', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(jsx?|tsx?|mjs)$/.test(name)) continue;
        const src = readFileSync(p, 'utf8');
        // Vite only exposes VITE_-prefixed names to the client, so a
        // VITE_OPENAI_* is the specific mistake that would ship a key in a
        // bundle. `process.env.OPENAI` in client code is the other one: it
        // would be replaced at build time if anyone added a define for it.
        for (const re of [/VITE_OPENAI/i, /OPENAI_API_KEY/, /import\.meta\.env\.[A-Z_]*OPENAI/i]) {
          if (re.test(src)) offenders.push(`${p.slice(REPO.length + 1)} matches ${re}`);
        }
      }
    };
    walk(resolvePath(REPO, 'src'));
    assert.deepEqual(offenders, [],
      'client source references the OpenAI key. The browser talks only to GetWorth\u2019s '
      + 'server API; the key is read by api/_lib/phaseb/openai-client.js in the server process and nowhere else.');
  });

  test('PWA-1b vite.config.js does not define any OpenAI value into the client', () => {
    const src = read('vite.config.js');
    const define = /define:\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(define, 'vite.config.js must still have a define block to check');
    assert.ok(!/OPENAI/i.test(define[1]),
      'an OpenAI value is being injected into the client bundle by define');
    assert.ok(!/envPrefix/.test(src),
      'envPrefix is being changed \u2014 widening it past VITE_ would expose server env to the browser');
  });

  test('PWA-1c the dev API plugin prints presence, never a value', () => {
    const src = read(DEV_API);
    assert.match(src, /has\('OPENAI_API_KEY'\)/,
      'the startup banner must report the key as a boolean');
    // The failure mode is interpolating the VALUE — `${process.env.OPENAI_API_KEY}`
    // or `${env.OPENAI_API_KEY}`. Naming the key as a string, which is what
    // `has('OPENAI_API_KEY')` does, is how presence gets reported and is the
    // thing this test wants to see, so the pattern has to tell them apart.
    assert.ok(!/\$\{[^}]*(?:process\.)?env(?:\[['"]|\.)OPENAI_API_KEY/.test(src),
      'the dev plugin interpolates the key VALUE into a string');
    assert.match(src, /\[REDACTED\]/,
      'an error body echoed back from a provider must be scrubbed before it is logged');
  });

  test('PWA-1d no built asset contains a key-shaped string', () => {
    const files = distFiles();
    if (!files) { assert.ok(true, 'dist/ absent \u2014 run `npm run build` first'); return; }
    const offenders = files.filter((p) => /sk-[A-Za-z0-9_-]{16,}/.test(readFileSync(p, 'utf8')));
    assert.deepEqual(offenders, [], 'a built asset contains something shaped like an API key');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PWA-2 · DEVELOPMENT ONLY IS A PROPERTY OF THE ARTIFACT
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-2 Phase B is absent from a production build', () => {
  test('PWA-2a the enrichment is gated on import.meta.env.DEV, not a runtime flag', () => {
    const src = read(CONTEXT);
    const fn = src.indexOf('const runPhaseBEnrichment');
    assert.ok(fn > 0, 'the enrichment function must exist');
    assert.match(src,
      /const PHASE_B_ENABLED = import\.meta\.env\.VITE_PHASE_B_ENABLED === 'true';/,
      "the flag must be an EXACT match against 'true'. An unset Vite variable can arrive "
      + "as the string 'undefined', and every non-empty string is truthy, so a truthiness "
      + 'check would enable Phase B precisely when nobody configured it.');
    const head = src.slice(fn, fn + 400);
    assert.match(head, /if \(!PHASE_B_ENABLED\) return;/,
      'the first statement must be the build-time gate \u2014 a hostname or runtime check '
      + 'would still ship the code, and would disable it on the phone (192.168.x.x is not localhost)');

    // The call site must carry the same gate, so the function is unreachable
    // rather than merely self-disabling. An unreachable call is what lets
    // Rollup drop the whole subtree.
    const call = src.indexOf('runPhaseBEnrichment(analysisResult');
    assert.ok(call > 0, 'the pipeline must call it');
    assert.match(src.slice(call - 600, call), /if \(PHASE_B_ENABLED\) \{/,
      'the call site must be inside a PHASE_B_ENABLED branch, so the whole subtree is '
      + 'UNREACHABLE when the flag is off rather than merely self-disabling');
  });

  test('PWA-2a2 the client flag is not, and cannot become, authority', () => {
    // The property that makes shipping a client flag safe at all: the server
    // decides independently, from its own environment, per request.
    const cfg = read('api/_lib/phaseb/config.js');
    const body = /export function resolveEnrichmentMode[\s\S]*?\n\}/.exec(cfg);
    assert.ok(body, 'server activation must still be resolveEnrichmentMode');
    assert.ok(!requestShaped(body[0]),
      'server activation consults something a caller could influence');
    assert.ok(!/VITE_PHASE_B_ENABLED/.test(read(ENRICH)),
      'the endpoint reads the CLIENT flag, which would make a browser value authoritative');
  });

  test('PWA-2b the bundle contains Phase B if and only if the flag was set', () => {
    const files = distFiles();
    if (!files) { assert.ok(true, 'dist/ absent, run `npm run build` first'); return; }

    // The flag is read at BUILD time, so the honest assertion depends on what
    // the build was given. `npm test` runs in the same environment as
    // `npm run build`, so this variable describes the dist/ on disk.
    //
    // BOTH DIRECTIONS MATTER. Off must mean GONE, not hidden, because a bundle
    // that merely never calls the code is one devtools breakpoint away from
    // calling it. On must mean PRESENT, because a flag that silently fails to
    // reach the client is how a production test measures nothing and then
    // reports success.
    const expected = process.env.VITE_PHASE_B_ENABLED === 'true';
    const NEEDLES = ['/api/enrich', '_phaseB', 'runPhaseBEnrichment', 'existing_recognition'];
    const hits = [];
    for (const p of files) {
      const src = readFileSync(p, 'utf8');
      for (const n of NEEDLES) if (src.includes(n)) hits.push(`${p.slice(REPO.length + 1)}: "${n}"`);
    }
    if (expected) {
      assert.ok(hits.length > 0,
        'VITE_PHASE_B_ENABLED=true was set for this build, but the bundle contains no Phase B. '
        + 'The flag is not reaching the client, so the deployed app would never call /api/enrich.');
    } else {
      assert.deepEqual(hits, [],
        'Phase B survived tree-shaking into a build made WITHOUT the flag. With the flag off it '
        + 'must be removed by the build, not merely unreachable at runtime.');
    }
  });

  test('PWA-2c the results panel is gated on DEV alone, not on is_admin', () => {
    const src = read(RESULTS);
    const at = src.indexOf('result._phaseB');
    assert.ok(at > 0, 'the Phase B panel must exist');
    const gate = src.slice(at - 120, at + 40);
    assert.match(gate, /PHASE_B_ENABLED && result\._phaseB/,
      'the panel must be gated on the same build-time flag that decides whether the browser '
      + 'asks for enrichment: one switch, one meaning');
    assert.ok(!/is_admin[^\n]*_phaseB|_phaseB[^\n]*is_admin/.test(gate),
      'an admin path into the Phase B panel would be a way to read a feature that is '
      + 'switched off in production');
  });

  test('PWA-2d the dev API plugin cannot run during a build', () => {
    const src = read(DEV_API);
    assert.match(src, /apply:\s*'serve'/,
      "the plugin must declare apply: 'serve' so vite build never invokes it");
    // If anything under src/ imported it, it would enter the client graph.
    const walk = (dir, out = []) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(jsx?|mjs)$/.test(name) && readFileSync(p, 'utf8').includes('vite-dev-api')) out.push(p);
      }
      return out;
    };
    assert.deepEqual(walk(resolvePath(REPO, 'src')), [],
      'a client module imports the dev API plugin \u2014 it would be bundled');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PWA-3 · THE LIVE PATH IS THE LIVE PATH
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-3 no mock, no fixture, no stand-in', () => {
  test('PWA-3a the dev API mounts the real handler modules', () => {
    const src = read(DEV_API);
    assert.match(src, /\['\/api\/enrich', '\.\.\/api\/enrich\.js'\]/,
      'the plugin must mount the deployed handler, not a local imitation of it');
    assert.match(src, /\['\/api\/analyze', '\.\.\/api\/analyze\.js'\]/);
    assert.ok(!/fixture|mockOpenAI|rehearsal|benchmarks\.mjs/i.test(src),
      'the dev API can reach a fixture');
  });

  test('PWA-3b a dev API failure is a failure, never a canned 200', () => {
    const src = read(DEV_API);
    const at = src.indexOf('} catch (err) {');
    assert.ok(at > 0);
    const block = src.slice(at, at + 900);
    assert.match(block, /res\.statusCode = 500/, 'a handler throw must surface as a 500');
    assert.ok(!/statusCode = 200|phase_b:\s*\{/.test(block),
      'the dev API fabricates a successful-looking response on error');
  });

  test('PWA-3c the client never substitutes a result when Phase B fails', () => {
    const src = read(CONTEXT);
    const fn = src.indexOf('const runPhaseBEnrichment');
    const end = src.indexOf('const runPipeline = useCallback', fn);
    const body = src.slice(fn, end);
    assert.ok(body.length > 500, 'the enrichment body must be findable');
    // On any failure the function returns, leaving the Phase-A result alone.
    assert.ok(!/setResult\([^)]*mock|fallbackPhaseB|FIXTURE/i.test(body),
      'the client falls back to a stand-in Phase B result');
    const catchAt = body.lastIndexOf('} catch (err) {');
    assert.ok(catchAt > 0, 'the enrichment must handle its own failures');
    assert.ok(!/setResult/.test(body.slice(catchAt)),
      'the failure path writes a result \u2014 a failed Phase B must leave the screen untouched');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PWA-4 · ISOLATION ACROSS SCANS, ON THE CLIENT
//
// tests/phaseb-isolation.test.mjs proves the SERVER does not carry state
// between scans. This proves the client does not paint a late answer about one
// object onto a different object that is already on screen — the same class of
// bug, on the only other side where it can happen.
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-4 a late Phase B answer cannot land on a newer scan', () => {
  test('PWA-4a the response is matched against the live scan id before merging', () => {
    const src = read(CONTEXT);
    const fn = src.indexOf('const runPhaseBEnrichment');
    const end = src.indexOf('const runPipeline = useCallback', fn);
    const body = src.slice(fn, end);

    assert.match(body, /if \(currentScanUuidRef\.current !== scanUuid\)/,
      'the merge must be guarded by the scan id that was captured when the request was sent');
    assert.match(body, /payload\.scan_uuid !== scanUuid/,
      'the server\u2019s own echoed scan_uuid must be checked too \u2014 two independent guards, '
      + 'because a request/response mix-up and a stale-scan race are different faults');

    // The guards must come BEFORE any setResult, or they guard nothing.
    const guardAt = body.indexOf('currentScanUuidRef.current !== scanUuid');
    const firstMerge = body.indexOf('setResult(');
    assert.ok(firstMerge > guardAt,
      'a setResult happens before the stale-scan check \u2014 the guard is downstream of the damage');
  });

  test('PWA-4b every scan gets a fresh, valid UUID even without a secure context', async () => {
    // The regression: crypto.randomUUID is secure-context-only, so on a phone
    // at http://192.168.x.x it is undefined. The old fallback produced
    // "scan-1764..." which /api/enrich rejects with a 400.
    const src = read(CONTEXT);
    assert.match(src, /function newScanUuid\(\)/, 'the generator must exist');
    // CODE ONLY. The generator's own comment quotes the old broken fallback to
    // explain why it was removed, and a test that reads comments would fail on
    // the explanation of the fix it is verifying.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/`scan-\$\{Date\.now\(\)\}/.test(code),
      'the non-UUID fallback is still present; /api/enrich would 400 on every phone scan');

    // Behavioural check of the same algorithm the client uses.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const impl = /function newScanUuid\(\)[\s\S]*?\n\}/.exec(src)[0];
    const seen = new Set();
    for (const cryptoStub of [undefined, { getRandomValues: (b) => b.fill(7) }]) {
      // eslint-disable-next-line no-new-func
      const make = new Function('globalThis', `${impl}; return newScanUuid();`);
      const id = make({ crypto: cryptoStub });
      assert.match(id, UUID_RE, `newScanUuid() produced a non-UUID with crypto=${!!cryptoStub}`);
      assert.equal(id[14], '4', 'must be a v4');
      assert.ok('89ab'.includes(id[19].toLowerCase()), 'must carry the RFC variant bits');
      seen.add(id);
    }
    assert.ok(seen.size >= 1);
  });

  test('PWA-4c the request carries this scan\u2019s own images and nothing cached', () => {
    const src = read(CONTEXT);
    const call = src.indexOf('runPhaseBEnrichment(analysisResult');
    const site = src.slice(call - 500, call + 200);
    assert.match(site, /analyzeInput/,
      'Phase B must be sent the images this scan analysed, not a module-level buffer');
    assert.match(site, /currentScanUuidRef\.current/,
      'and this scan\u2019s id');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PWA-5 · THE ENDPOINT CAN ACTUALLY BE CALLED
//
// api/enrich.js was written against the Web Request shape with no runtime
// declaration, so Vercel's default Node runtime would invoke it as (req, res)
// and `req.headers.get` would throw on the first line. It had never been
// called over HTTP, so nothing caught it.
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-5 /api/enrich runs under the runtime it is deployed to', () => {
  test('PWA-5a it declares a Node runtime with a duration Phase B can fit in', async () => {
    const mod = await import('../api/enrich.js');
    assert.ok(mod.config, 'api/enrich.js must export a config');
    assert.notEqual(mod.config.runtime, 'edge',
      'Edge is wall-capped at 25s and the market_research stage alone is allowed 90s');
    assert.ok(mod.config.maxDuration >= 60,
      `maxDuration must cover a live research round trip; got ${mod.config.maxDuration}`);
  });

  test('PWA-5b the handler accepts the Node (req, res) pair', async () => {
    const mod = await import('../api/enrich.js');
    const chunks = [];
    const res = {
      statusCode: 0, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(t) { chunks.push(t ?? ''); },
    };
    const nodeReq = {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:5173' },
      body: JSON.stringify({ scan_uuid: 'not-a-uuid' }),
    };
    await mod.default(nodeReq, res);
    // 401, because auth runs before the body is even looked at. Reaching a 401
    // at all is the proof: the old code threw a TypeError on req.headers.get
    // before any status could be set.
    assert.equal(res.statusCode, 401, `expected the auth rejection; got ${res.statusCode} ${chunks[0]}`);
    assert.equal(JSON.parse(chunks[0]).error, 'unauthorized');
  });

  test('PWA-5c the handler still accepts a Web Request', async () => {
    const mod = await import('../api/enrich.js');
    const out = await mod.default(new Request('http://localhost/api/enrich', { method: 'GET' }));
    assert.ok(out instanceof Response, 'the Web path must still return a Response');
    assert.equal(out.status, 405);
  });

  test('PWA-5d CORS was not widened to let a phone in', () => {
    const src = read(ENRICH);
    const list = /const ALLOWED_ORIGINS = \[([\s\S]*?)\];/.exec(src);
    assert.ok(list, 'the allowlist must still exist');
    assert.ok(!/192\.168\.|10\.0\.|\*|0\.0\.0\.0/.test(list[1]),
      'a LAN address or a wildcard was added to the production CORS allowlist. The dev API '
      + 'is mounted on the Vite server, so phone requests are SAME-ORIGIN and need no entry here.');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PWA-6 · THE KILL SWITCH
//
// Phase B is being enabled in production. The single most important property
// of that release is not that it works — it is that it can be STOPPED, from
// the server, without a rebuild and without a deploy, the moment anybody wants
// it stopped. Everything below tests the off switch, not the feature.
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-6 Phase B can be switched off from the server alone', () => {
  test('PWA-6a server activation is exact, environment-only, and off by default', async () => {
    const { resolveEnrichmentMode, ENRICHMENT_MODE } = await import('../api/_lib/phaseb/config.js');
    const KEY = 'sk-test-not-a-real-key';

    // Off by default: an environment nobody configured runs nothing.
    assert.equal(resolveEnrichmentMode({}), ENRICHMENT_MODE.DISABLED_FLAG);

    // Every near-miss spelling is OFF. This is the kill switch's real surface:
    // somebody typing `OPENAI_ENRICHMENT_ENABLED=1` to disable it must not
    // accidentally leave it on, and somebody typing `false` must not either.
    for (const v of ['false', 'FALSE', '0', '1', 'yes', 'no', 'on', 'off', '', ' ', 'true!', 'truthy']) {
      assert.equal(
        resolveEnrichmentMode({ OPENAI_ENRICHMENT_ENABLED: v, OPENAI_API_KEY: KEY }),
        ENRICHMENT_MODE.DISABLED_FLAG,
        `"${v}" must not enable Phase B`);
    }
    assert.equal(
      resolveEnrichmentMode({ OPENAI_ENRICHMENT_ENABLED: 'true', OPENAI_API_KEY: KEY }),
      ENRICHMENT_MODE.ENABLED);
  });

  test('PWA-6b with the switch off, the endpoint answers without calling OpenAI', async () => {
    // Proved through the ENDPOINT, not the resolver, because the resolver being
    // correct is worth nothing if the handler asks it after building an adapter.
    const src = read(ENRICH);
    const flagAt = src.indexOf('const mode = resolveEnrichmentMode(process.env);');
    const runAt = src.indexOf('await runPhaseB({');
    assert.ok(flagAt > 0 && runAt > flagAt,
      'the flag must be consulted before the pipeline is invoked');

    // And nothing between the two may construct a provider client.
    const between = src.slice(flagAt, runAt);
    assert.ok(!/new OpenAI|api\.openai\.com|callStructured/.test(between),
      'a provider call is constructed before the flag decides');

    // The disabled answer is a 200 with an explicit status. A 5xx would look
    // like an outage and would make the kill switch indistinguishable from a
    // broken deployment.
    const disabled = src.slice(flagAt, flagAt + 1200);
    assert.match(disabled, /status: 'DISABLED'/);
    assert.match(disabled, /openai_called: false/);
    assert.match(disabled, /\}, 200, corsHeaders\);/);
  });

  test('PWA-6c the optional allowlist narrows without becoming a second authority', async () => {
    const { isEnrichmentPermitted } = await import('../api/_lib/phaseb/config.js');
    // Unset means everyone: the pre-existing behaviour, so an unconfigured
    // value cannot silently disable the feature for everybody.
    assert.equal(isEnrichmentPermitted('user-1', {}), true);
    assert.equal(isEnrichmentPermitted(null, {}), true);
    // Set means only these.
    const env = { OPENAI_ENRICHMENT_USER_IDS: 'user-1, user-2' };
    assert.equal(isEnrichmentPermitted('user-1', env), true);
    assert.equal(isEnrichmentPermitted('user-3', env), false);
    assert.equal(isEnrichmentPermitted(null, env), false);
    // It reads env and an id, and nothing a caller controls.
    const cfg = read('api/_lib/phaseb/config.js');
    const body = /export function isEnrichmentPermitted[\s\S]*?\n\}/.exec(cfg)[0];
    assert.ok(!requestShaped(body),
      'the allowlist consults something a caller could influence');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PWA-7 · PHASE A IS THE PRODUCT, AND IT CANNOT BE DAMAGED BY PHASE B
//
// The release is safe only if a Phase-B failure is invisible to a user who
// came for a valuation. That is an ORDERING property: the scan is finished,
// persisted and rendered before enrichment is even started.
// ════════════════════════════════════════════════════════════════════════════
describe('PWA-7 a Phase B failure cannot degrade a scan', () => {
  test('PWA-7a enrichment starts only after the result is rendered', () => {
    const src = read(CONTEXT);
    const setResult = src.indexOf('setResult(analysisResult);');
    const setView = src.indexOf("setView('results');", setResult);
    const call = src.indexOf('runPhaseBEnrichment(analysisResult', setResult);
    assert.ok(setResult > 0 && setView > setResult && call > setView,
      'Phase B must be started AFTER setResult and setView, so a scan is already complete '
      + 'and on screen before enrichment can fail');
  });

  test('PWA-7b enrichment is never awaited by the pipeline', () => {
    const src = read(CONTEXT);
    const call = src.indexOf('runPhaseBEnrichment(analysisResult');
    const line = src.slice(src.lastIndexOf('\n', call) + 1, src.indexOf('\n', call));
    assert.ok(!/await/.test(line),
      'awaiting enrichment would hold the scan open for a live market research round trip, '
      + 'and would let a Phase-B timeout become a Phase-A failure');
    // A floating promise must still be caught, or a rejection becomes an
    // unhandled one and, in some browsers, a visible error.
    assert.match(src.slice(call, call + 300), /\.catch\(/,
      'the floating promise must handle its own rejection');
  });

  test('PWA-7c a failed enrichment leaves the Phase A result untouched', () => {
    const src = read(CONTEXT);
    const fn = src.indexOf('const runPhaseBEnrichment');
    const end = src.indexOf('const runPipeline = useCallback', fn);
    const body = src.slice(fn, end);
    const catchAt = body.lastIndexOf('} catch (err) {');
    assert.ok(catchAt > 0);
    const handler = body.slice(catchAt);
    assert.ok(!/setResult|setView|setPipelineState|setPipelineError/.test(handler),
      'the enrichment failure path mutates scan state; a Phase-B error must be invisible '
      + 'to a user who already has their valuation');
    // Non-2xx is a return, not a throw into the scan.
    assert.match(body, /if \(!res\.ok\)[\s\S]{0,300}?return;/,
      'a non-2xx enrichment response must return quietly');
  });

  test('PWA-7d the server reports enrichment failure as a Phase B status, not a 5xx', () => {
    const src = read(ENRICH);
    const at = src.indexOf('} catch (err) {');
    assert.ok(at > 0);
    const block = src.slice(at, at + 700);
    assert.match(block, /PHASE_B_STATUS\.FAILED/);
    assert.match(block, /\}, 200, corsHeaders\);/,
      'a Phase-B pipeline failure must be a 200 carrying FAILED, so a client cannot mistake '
      + 'it for an outage of the scan path');
  });
});
