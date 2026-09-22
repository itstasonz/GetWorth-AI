// ══════════════════════════════════════════════════════════════════════════════
// DEV-ONLY API PLUGIN — serves api/*.js inside the Vite dev server
//
// `vite dev` serves the frontend and nothing else. `/api/analyze` and
// `/api/enrich` are Vercel functions, so in local development every scan
// request 404s and the PWA cannot reach Phase B at all. This mounts the REAL
// handler modules as Connect middleware on the dev server, so the phone talks
// to one origin on one port and the browser never learns that /api is special.
//
// ── WHY NOT A SECOND PROCESS AND A PROXY ───────────────────────────────────
//
// A separate API server plus `server.proxy` also works, and it costs a second
// port, a second origin, a CORS conversation the production allowlist would
// have to be widened for, and a second thing to remember to start. Mounting in
// process makes every request SAME-ORIGIN, which is why `ALLOWED_ORIGINS` in
// api/enrich.js needed no change: a same-origin fetch is never CORS-checked,
// so the phone's `http://192.168.x.x:5173` origin does not have to be trusted
// anywhere. Loosening a production allowlist to run a local test is exactly
// the kind of change that outlives the test.
//
// ── THIS FILE CANNOT REACH PRODUCTION ──────────────────────────────────────
//
// `apply: 'serve'` means Vite never invokes it for `vite build`. It is not
// imported by any module under src/, so it is not in the client graph and
// nothing here is bundled. The handlers it mounts are the SAME files Vercel
// deploys — this is a transport, not a reimplementation. If it contained its
// own idea of what /api/enrich does, a green local test would say nothing
// about production.
//
// ── SECRETS STAY ON THIS SIDE OF THE PROCESS ───────────────────────────────
//
// Server env is loaded into `process.env`, which Vite does not expose to the
// client. Only `VITE_`-prefixed names ever reach `import.meta.env`, and
// OPENAI_API_KEY is not one — so the key is readable by the handler in this
// Node process and by nothing the browser can see. There is deliberately no
// `define` of it, no injection into the client graph, and the startup banner
// below prints presence as a boolean and never a value.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Parse a dotenv file without adding a dependency. Values are never logged. */
function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// What each endpoint needs to do its job. Missing entries are REPORTED AT
// STARTUP rather than discovered as an opaque 500 in the middle of a scan on a
// phone, where there is no console to read.
const REQUIRED = {
  '/api/analyze': ['SUPABASE_URL', 'ANTHROPIC_API_KEY'],
  '/api/enrich': ['OPENAI_ENRICHMENT_ENABLED', 'OPENAI_API_KEY'],
};
const OPTIONAL = ['GOOGLE_VISION_API_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET', 'VOYAGE_API_KEY', 'OPENAI_ENRICHMENT_MODEL'];

const ROUTES = [
  ['/api/analyze', '../api/analyze.js'],
  ['/api/enrich', '../api/enrich.js'],
  ['/api/confirm-identity', '../api/confirm-identity.js'],
  ['/api/submit-candidate', '../api/submit-candidate.js'],
];

export default function devApi({ envFile = '.env.local' } = {}) {
  return {
    name: 'getworth-dev-api',
    // NOT 'build'. This is the structural half of "development only".
    apply: 'serve',

    configResolved(config) {
      const loaded = parseEnvFile(resolve(config.root, envFile));
      for (const [k, v] of Object.entries(loaded)) {
        // An already-set shell variable wins, so `OPENAI_ENRICHMENT_ENABLED=true
        // npm run dev:phone` overrides the file without editing it.
        if (process.env[k] === undefined) process.env[k] = v;
      }

      const has = (k) => typeof process.env[k] === 'string' && process.env[k].length > 0;
      const lines = ['', '  ── GetWorth dev API (local only) ──'];
      for (const [route, keys] of Object.entries(REQUIRED)) {
        const missing = keys.filter((k) => !has(k));
        lines.push(`  ${route.padEnd(16)} ${missing.length === 0 ? 'ready' : `MISSING ${missing.join(', ')}`}`);
      }
      const optMissing = OPTIONAL.filter((k) => !has(k));
      if (optMissing.length) lines.push(`  optional absent: ${optMissing.join(', ')}`);
      // PRESENCE, NEVER VALUE. A dev banner that echoes a key is a key in a
      // terminal scrollback, a screenshot and a support thread.
      lines.push(`  OPENAI_API_KEY   ${has('OPENAI_API_KEY') ? 'present (value never printed)' : 'ABSENT'}`);
      lines.push(`  Phase B flag     ${process.env.OPENAI_ENRICHMENT_ENABLED === 'true' ? 'ON' : 'off'}`);
      lines.push('');
      config.logger.info(lines.join('\n'));
    },

    configureServer(server) {
      // Modules are loaded ONCE, lazily, on first request to their route.
      // Eager loading would make `vite dev` fail to start when an unrelated
      // endpoint has a bad import, and api/analyze.js is a large module whose
      // load cost belongs on the first scan, not on every dev-server restart.
      const loaded = new Map();
      const load = async (specifier) => {
        if (!loaded.has(specifier)) {
          loaded.set(specifier, import(new URL(specifier, import.meta.url).href));
        }
        return loaded.get(specifier);
      };

      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        const route = ROUTES.find(([p]) => p === path);
        if (!route) return next();

        const t0 = Date.now();
        try {
          const mod = await load(route[1]);
          const handler = mod.default;
          if (typeof handler !== 'function') throw new Error(`${route[0]} has no default export`);

          // (req, res) — the Node convention. Both api/analyze.js and
          // api/enrich.js detect it and adapt; confirm-identity and
          // submit-candidate are Edge handlers, so they are given a Request
          // built from the same Node objects and their Response is written back.
          if (mod.config?.runtime === 'edge') {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const url = `http://${req.headers.host || 'localhost'}${req.url}`;
            const webReq = new Request(url, {
              method: req.method,
              headers: req.headers,
              body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks),
            });
            const webRes = await handler(webReq);
            res.statusCode = webRes.status;
            webRes.headers.forEach((v, k) => res.setHeader(k, v));
            res.end(await webRes.text());
          } else {
            await handler(req, res);
          }
          server.config.logger.info(`  ${route[0]} → ${res.statusCode} in ${Date.now() - t0}ms`);
        } catch (err) {
          // A dev-server failure must look like a failure. No canned response,
          // no empty 200 — the whole point of this integration is that a phone
          // scan reaches the real engine or says why it did not.
          server.config.logger.error(`  ${route[0]} FAILED after ${Date.now() - t0}ms: ${err?.stack || err}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({
              error: 'dev_api_error',
              // Local only, and the message is scrubbed of anything key-shaped
              // in case an upstream 4xx body echoed a request header back.
              detail: String(err?.message ?? err).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]').slice(0, 300),
            }));
          }
        }
      });
    },
  };
}
