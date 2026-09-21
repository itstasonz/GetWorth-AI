// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — /api/enrich: AUTH, FLAG, ISOLATION AND READ-ONLY GUARANTEES
//
// §42's endpoint list, plus the guarantees §23 and §47 require to be FACTS
// rather than intentions: no trusted DB write, no memory promotion, no catalog
// insert, no production activation.
//
// ── WHY THE READ-ONLY CHECK IS STRUCTURAL, NOT A PROMISE ───────────────────
//
// "I did not write any writes" is exactly the kind of claim this repository has
// learned to distrust — round 4 shipped a correct module wired to nothing, and
// three rounds shipped a refund defect past a green suite because every
// assertion was indirect. So PB-9 walks the endpoint's own IMPORT CLOSURE and
// fails if any module in it can reach a mutating Supabase call. A future author
// who adds a promotion path breaks this test without having to remember it
// exists.
//
//   node --test tests/phaseb-endpoint.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintJWT } from './helpers/analyze-harness.mjs';
import { IMG } from './fixtures/phaseb/benchmarks.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const UUID = '11111111-2222-3333-4444-555555555555';

// The env the handler reads. Saved and restored around every test, because a
// flag left on would silently change every later assertion in the file.
const ENV_KEYS = ['OPENAI_ENRICHMENT_ENABLED', 'OPENAI_API_KEY', 'OPENAI_ENRICHMENT_MODEL',
  'SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];

async function callEnrich(body, { env = {}, headers = {} } = {}) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.SUPABASE_JWT_SECRET = 'test-secret';
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.OPENAI_ENRICHMENT_ENABLED;
  delete process.env.OPENAI_API_KEY;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }

  const logs = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => logs.push(a.map(String).join(' '));
  console.warn = console.log; console.error = console.log;

  try {
    const mod = await import('../api/enrich.js');
    const res = await mod.default(new Request('https://getworth.ai/api/enrich', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://get-worth-ai.vercel.app',
        authorization: `Bearer ${mintJWT()}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }));
    let payload = null;
    try { payload = await res.clone().json(); } catch { /* non-json */ }
    return { status: res.status, payload, logs };
  } finally {
    Object.assign(console, orig);
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PB-8 · THE ENDPOINT
// ════════════════════════════════════════════════════════════════════════════
describe('PB-8 /api/enrich', () => {
  test('PB-8a an unauthenticated request is refused BEFORE anything else', async () => {
    const r = await callEnrich({ scan_uuid: UUID, images: [IMG] }, { headers: { authorization: '' } });
    assert.equal(r.status, 401);
    assert.equal(r.payload.error, 'unauthorized');
  });

  test('PB-8b a garbage scan_uuid is refused', async () => {
    const r = await callEnrich({ scan_uuid: 'not-a-uuid', images: [IMG] });
    assert.equal(r.status, 400);
  });

  test('PB-8c FLAG OFF + KEY ABSENT — disabled, and no OpenAI call', async () => {
    const r = await callEnrich({ scan_uuid: UUID, images: [IMG] });
    assert.equal(r.status, 200);
    assert.equal(r.payload.phase_b.status, 'DISABLED');
    assert.equal(r.payload.phase_b.reason, 'disabled_flag');
    assert.equal(r.payload.phase_b.openai_called, false);
  });

  test('PB-8d FLAG OFF + KEY PRESENT — still disabled', async () => {
    // A key lying around must never be sufficient. §29 lists this case
    // explicitly, and it is the one that would leak spend quietly.
    const r = await callEnrich({ scan_uuid: UUID, images: [IMG] },
      { env: { OPENAI_API_KEY: 'sk-present' } });
    assert.equal(r.payload.phase_b.status, 'DISABLED');
    assert.equal(r.payload.phase_b.reason, 'disabled_flag');
  });

  test('PB-8e FLAG ON + KEY ABSENT — disabled, not a crash', async () => {
    const r = await callEnrich({ scan_uuid: UUID, images: [IMG] },
      { env: { OPENAI_ENRICHMENT_ENABLED: 'true' } });
    assert.equal(r.status, 200, 'a half-configured environment must not 5xx');
    assert.equal(r.payload.phase_b.status, 'DISABLED');
    assert.equal(r.payload.phase_b.reason, 'disabled_no_key');
  });

  test('PB-8f no CLIENT parameter can enable Phase B', async () => {
    // Everything a caller could plausibly try. The flag is read from the
    // environment, so none of these can reach the decision.
    const attempts = [
      { enabled: true }, { enrichment: true }, { phase_b: true },
      { OPENAI_ENRICHMENT_ENABLED: 'true' }, { flags: { OPENAI_ENRICHMENT_ENABLED: 'true' } },
      { config: { enabled: true } }, { force: true }, { debug: { enable_openai: true } },
    ];
    for (const extra of attempts) {
      const r = await callEnrich({ scan_uuid: UUID, images: [IMG], ...extra });
      assert.equal(r.payload.phase_b.status, 'DISABLED',
        `${JSON.stringify(extra)} enabled Phase B from the request body`);
      assert.equal(r.payload.phase_b.openai_called, false);
    }
  });

  test('PB-8g the disabled response never reveals whether a key is configured', async () => {
    const withKey = await callEnrich({ scan_uuid: UUID, images: [IMG] },
      { env: { OPENAI_API_KEY: 'sk-secret-value-here' } });
    const withoutKey = await callEnrich({ scan_uuid: UUID, images: [IMG] });
    assert.deepEqual(withKey.payload.phase_b, withoutKey.payload.phase_b,
      'the flag-off response must be identical either way, or it is a key oracle');
    assert.ok(!JSON.stringify(withKey).includes('sk-secret-value-here'));
  });

  test('PB-8h no image is a 400, not an empty enrichment', async () => {
    const r = await callEnrich({ scan_uuid: UUID, images: [] },
      { env: { OPENAI_ENRICHMENT_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' } });
    assert.equal(r.status, 400);
  });

  test('PB-8i the key never appears in the response or the logs', async () => {
    const KEY = 'sk-do-not-leak-me-0123456789';
    const r = await callEnrich({ scan_uuid: UUID, images: [IMG] },
      { env: { OPENAI_API_KEY: KEY } });
    assert.ok(!JSON.stringify(r.payload).includes(KEY), 'the key reached the response body');
    assert.ok(!r.logs.join('\n').includes(KEY), 'the key reached a log line');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-9 · READ-ONLY (§23, §47)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-9 Phase B writes nothing', () => {
  /** Every module /api/enrich.js can reach by relative import. */
  const closure = () => {
    const seen = new Set();
    const out = [];
    const queue = [resolvePath(REPO, 'api/enrich.js')];
    const RE = /(?:^|[^\w$])(?:import|export)[\s\S]{0,400}?from\s*['"](\.[^'"\n]*)['"]/g;
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      out.push({ path: relative(REPO, file).split(String.fromCharCode(92)).join('/'), src });
      for (const m of src.matchAll(RE)) {
        const spec = m[1];
        for (const cand of [spec, `${spec}.js`, `${spec}.mjs`]) {
          const abs = resolvePath(dirname(file), cand);
          if (existsSync(abs)) { queue.push(abs); break; }
        }
      }
    }
    return out;
  };

  test('PB-9a the endpoint’s import closure contains NO mutating database call', () => {
    // The Supabase mutation verbs. If a promotion path is ever added to this
    // tree, this fails by name rather than being discovered in production.
    const MUTATIONS = ['.insert(', '.upsert(', '.update(', '.delete(', '.rpc('];
    const offenders = [];
    for (const { path, src } of closure()) {
      // api/analyze.js is in the closure only because /api/enrich reuses its
      // JWT verifier. It is the PRODUCTION SCAN PATH and of course writes — the
      // guarantee is that ENRICH never calls those paths, which the absence of
      // any other analyze.js import below establishes.
      if (path === 'api/analyze.js') continue;
      for (const verb of MUTATIONS) {
        if (src.includes(verb)) offenders.push(`${path} -> ${verb}`);
      }
    }
    assert.deepEqual(offenders, [],
      'a module reachable from /api/enrich can mutate the database. Phase B is read-only: ' +
      'no catalog insert, no recognition-memory promotion, no price observation, no correction.');
  });

  test('PB-9b enrich imports exactly one symbol from the production scan path', () => {
    const src = readFileSync(resolvePath(REPO, 'api/enrich.js'), 'utf8');
    const m = /import\s*\{([^}]*)\}\s*from\s*'\.\/analyze\.js'/.exec(src);
    assert.ok(m, 'the auth reuse must be an explicit named import');
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(names, ['verifyJWT'],
      'Phase B reuses authentication and NOTHING else from the scan path; importing more ' +
      'would couple the two paths that §2 requires stay separate');
  });

  test('PB-9c no Supabase client is constructed anywhere in the Phase-B tree', () => {
    for (const { path, src } of closure()) {
      if (path === 'api/analyze.js') continue;
      assert.ok(!src.includes('createClient('),
        `${path} constructs a Supabase client — Phase B has no database access at all`);
    }
  });

  test('PB-9d the response says, in the payload, that it is a candidate', async () => {
    // §23: the separation between CANDIDATE and TRUSTED must be obvious in the
    // data, not inferred from documentation nobody reads at 3am.
    const src = readFileSync(resolvePath(REPO, 'api/enrich.js'), 'utf8');
    assert.match(src, /authority:\s*'none'/);
    assert.match(src, /is_candidate:\s*true/);
    assert.match(src, /promoted:\s*false/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PB-10 · ISOLATION FROM THE PRODUCTION SCAN PATH (§2)
// ════════════════════════════════════════════════════════════════════════════
describe('PB-10 /api/analyze is untouched', () => {
  test('PB-10a the scan path does not import Phase B', () => {
    // A COMMENT IS NOT A CALL SITE. My first version grepped the raw source and
    // failed on two comments that merely NAME api/enrich.js — the exact
    // mistake tests/helpers/provider-scan.mjs exists to avoid, reproduced in a
    // test about it. Comments are stripped before the question is asked.
    const raw = readFileSync(resolvePath(REPO, 'api/analyze.js'), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('phaseb/'),
      'api/analyze.js must not reach into Phase B — a normal scan does not route there');
    assert.ok(!/\benrich\b/.test(code),
      'the production scan path must have no executable reference to the enrichment endpoint');
  });

  test('PB-10b Phase B is not reachable from the scan handler', () => {
    // The direction that matters. enrich -> analyze (auth) is deliberate and
    // asserted above; analyze -> enrich would make Phase B part of every scan.
    const analyze = readFileSync(resolvePath(REPO, 'api/analyze.js'), 'utf8');
    assert.ok(!/from\s*'\.\/enrich/.test(analyze));
    assert.ok(!/from\s*'\.\/_lib\/phaseb/.test(analyze));
  });
});
