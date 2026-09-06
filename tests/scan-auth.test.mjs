// ══════════════════════════════════════════════════════════════════════════════
// AUTH-001 — the scan request must never leave the client unauthenticated.
//
// Preview evidence: POST /api/analyze -> 401 with
// "[Auth] hasAuthHeader=false tokenPresent=false" (api/analyze.js:218), twice,
// and no [Waterfall] line — the pipeline never started because auth rejected
// the request first.
//
// Two independent defects produced that:
//   1. runPipeline had an in-flight guard and a cooldown guard but NO auth
//      guard. Every other user action gates on `if (!user)` — contact
//      (AppContext:1229), save (:1663), list (startListing). Scanning did not,
//      so a tap while signed out (or before the session finished restoring)
//      entered the scanning state and POSTed with no Authorization header.
//   2. analyzeWithRetry attached the header only `if (_accessToken)` and sent
//      the request either way, so a null token produced a guaranteed 401.
//
// And one that made it unrecoverable: runPipeline's catch returned early on
// AbortError WITHOUT clearing pipelineState. clearUserState() aborts the
// pipeline on every sign-in / sign-out / account switch, so signing in mid-scan
// stranded the UI on "Scanning..." — the reported symptom.
//
// These are structural assertions over source. AppContext is a ~4,000-line
// provider whose scan path needs React, a camera, Supabase auth and two
// Anthropic calls; the properties that actually matter here are ORDERINGS and
// the absence of an unguarded fetch, both visible in source and both exactly
// what a careless edit would undo.
//
//   node --test tests/scan-auth.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CTX_PATH = process.env.AUTH001_CONTEXT_PATH || `${ROOT}src/contexts/AppContext.jsx`;
const APP_PATH = process.env.AUTH001_APP_PATH || `${ROOT}src/App.jsx`;
const T_PATH = process.env.AUTH001_TRANSLATIONS_PATH || `${ROOT}src/lib/translations.js`;

const ctx = readFileSync(CTX_PATH, 'utf8');
const app = readFileSync(APP_PATH, 'utf8');
const translations = readFileSync(T_PATH, 'utf8');

// Index of an anchor asserted to occur exactly once — a moved or duplicated
// anchor fails loudly instead of silently testing the wrong region.
const at = (src, needle, where) => {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `anchor ${JSON.stringify(needle)} occurs ${n}x in ${where}, expected exactly 1`);
  return src.indexOf(needle);
};

// The body of runPipeline, from its definition to its dependency array.
const runPipeline = () => ctx.slice(
  at(ctx, 'const runPipeline = useCallback(', 'AppContext'),
  at(ctx, 'playSound, lang, getFreshToken]);', 'AppContext'),
);
// The body of analyzeWithRetry.
const analyzeWithRetry = () => ctx.slice(
  at(ctx, 'const analyzeWithRetry = useCallback(', 'AppContext'),
  at(ctx, '}, [lang, getFreshToken]);', 'AppContext'),
);

// ══════════════════════════════════════════════════════════════════════════════
// NO REQUEST WITHOUT A TOKEN
// ══════════════════════════════════════════════════════════════════════════════

test('SA-01 the analyze fetch is never reached without an access token', () => {
  // THE defect. The header used to be conditional and the request unconditional.
  const body = analyzeWithRetry();
  const tokenCheck = body.indexOf('if (!_accessToken)');
  const fetchCall = body.indexOf("fetch('/api/analyze'");

  assert.notEqual(tokenCheck, -1, 'analyzeWithRetry must refuse a null token');
  assert.notEqual(fetchCall, -1, 'the analyze fetch must exist');
  assert.ok(tokenCheck < fetchCall, 'the token check must precede the fetch');
});

test('SA-02 the Authorization header is unconditional, not "if (token)"', () => {
  // `if (_accessToken) headers['Authorization'] = ...` is what allowed a
  // headerless POST. The header must now be built as a required field.
  const body = analyzeWithRetry();
  assert.equal(/if \(_accessToken\)\s*analyzeHeaders\['Authorization'\]/.test(body), false,
    'the Authorization header must not be conditionally attached');
  assert.match(body, /Authorization: `Bearer \$\{_accessToken\}`/,
    'the header must be built unconditionally after the token is proven present');
});

test('SA-03 a missing token raises a typed, recoverable auth error', () => {
  // Typed so runPipeline can distinguish "sign in" from a generic failure and
  // offer a way forward instead of a dead end.
  const body = analyzeWithRetry();
  assert.match(body, /authErr\.authRequired = true/);
});

// ══════════════════════════════════════════════════════════════════════════════
// THE SCAN ACTION IS AUTH-GATED
// ══════════════════════════════════════════════════════════════════════════════

test('SA-04 runPipeline proves a session BEFORE any state mutation', () => {
  // Ordering is the property. A guard placed after pipelineActiveRef or after
  // setPipelineState would still enter — and could strand — a scanning state.
  const body = runPipeline();
  const guard = body.indexOf('const preflightToken = await getFreshToken();');
  const inflight = body.indexOf('pipelineActiveRef.current = true;');
  const firstState = body.indexOf("setPipelineState('compressing')");

  assert.notEqual(guard, -1, 'runPipeline must have an auth pre-flight');
  assert.ok(guard < inflight, 'the auth guard must precede the in-flight flag');
  assert.ok(guard < firstState, 'the auth guard must precede the first scanning state');
});

test('SA-05 the guard awaits the session rather than reading React state', () => {
  // `user` is populated asynchronously by the auth bootstrap, so it is null
  // during exactly the window this bug lives in. supabase.auth.getSession()
  // resolves only after the persisted session is restored, so awaiting it IS
  // the "auth initialization complete" signal — and it returns the very token
  // the request will carry.
  const body = runPipeline();
  assert.match(body, /await getFreshToken\(\)/,
    'the guard must await the real token, not infer readiness from `user`');
});

test('SA-06 a blocked scan prompts sign-in and does NOT enter a scanning state', () => {
  const body = runPipeline();
  const guardStart = body.indexOf('if (!preflightToken) {');
  const guardEnd = body.indexOf('pipelineActiveRef.current = true;');
  const block = body.slice(guardStart, guardEnd);

  assert.match(block, /setPipelineState\('idle'\)/, 'must land on idle, never a loading state');
  assert.match(block, /setShowSignInModal\(true\)/, 'must offer a way forward');
  assert.match(block, /return;/, 'must not fall through into the scan');
  assert.equal(/setPipelineState\('(compressing|identifying|pricing)'\)/.test(block), false,
    'a blocked scan must never show a scanning state');
});

test('SA-07 the scan gate matches how every other action gates on auth', () => {
  // Scanning was the only user action without a gate; this pins the parity.
  for (const action of ["setSignInAction('save')", "setSignInAction('contact')", "setSignInAction('scan')"]) {
    assert.ok(ctx.includes(action), `${action} must exist — auth gating parity`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// NEVER STUCK ON "Scanning..."
// ══════════════════════════════════════════════════════════════════════════════

test('SA-08 a 401 exits the scanning state and offers sign-in', () => {
  const body = runPipeline();
  const handler = body.indexOf('if (e.authRequired) {');
  assert.notEqual(handler, -1, 'runPipeline must handle a typed auth failure');

  const block = body.slice(handler, handler + 500);
  assert.match(block, /setPipelineState\('idle'\)/, 'a 401 must leave the scanning state');
  assert.match(block, /setShowSignInModal\(true\)/, 'a 401 must be recoverable');
});

test('SA-09 an abort clears the scanning state instead of stranding it', () => {
  // clearUserState() aborts the pipeline on sign-in/sign-out/account switch.
  // The early return used to leave pipelineState at 'identifying' forever.
  const body = runPipeline();
  const abortBlock = body.slice(body.indexOf("if (e.name === 'AbortError'"), body.indexOf('if (e.authRequired)'));
  assert.match(abortBlock, /setPipelineState\('idle'\)/,
    'an abort must not leave the UI on "Scanning..."');
});

test('SA-10 the abort reset cannot race a newer scan back to idle', () => {
  // A newer scan aborts the previous controller and then sets its own state.
  // Resetting unconditionally would clobber it, so the reset is guarded on
  // this controller still being the active one.
  const body = runPipeline();
  const abortBlock = body.slice(body.indexOf("if (e.name === 'AbortError'"), body.indexOf('if (e.authRequired)'));
  assert.match(abortBlock, /pipelineAbortRef\.current === abortCtrl/,
    'the reset must only apply when this controller is still current');
});

test('SA-11 every terminal path releases the in-flight guard', () => {
  // Without this a failed scan would block all further scans with
  // "Ignored — a scan is already running".
  const body = runPipeline();
  assert.match(body, /finally \{[\s\S]*pipelineActiveRef\.current = false;[\s\S]*\}/,
    'the in-flight flag must be released in a finally');
});

// ══════════════════════════════════════════════════════════════════════════════
// NO DUPLICATE SCAN AFTER LOGIN
// ══════════════════════════════════════════════════════════════════════════════

test('SA-12 signing in does not auto-resume a pending scan', () => {
  // Deliberate choice: reset cleanly and let the user scan again (option b),
  // rather than resume (option a). Resume would need a pending-scan buffer
  // surviving an OAuth redirect, and a replay bug there re-bills a scan against
  // the user's daily quota. `signInAction` drives only modal copy — no resume
  // is keyed off it — so there is nothing to fire twice.
  const buyResume = ctx.includes('resumeBuyIntent');
  assert.ok(buyResume, 'sanity: the buy flow does resume, so this is a real distinction');
  assert.equal(/resumeScan|pendingScan|takePendingScan|resumeScanIntent/.test(ctx), false,
    'no scan-resume mechanism may exist — a duplicate scan costs the user quota');
});

test('SA-13 the scan sign-in prompt has its own copy in both languages', () => {
  // Without a 'scan' case the modal fell through to "Sign in to list items",
  // which tells the user to do something they were not doing.
  assert.match(app, /signInAction === 'scan' \? t\.signInScan/);
  assert.equal(translations.split('signInScan:').length - 1, 2,
    'signInScan must be defined in exactly two languages (en + he)');
});

// ══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════════════

test('SA-14 a Preview-visible boot diagnostic reports session restore', () => {
  // Every other auth log is behind import.meta.env.DEV or the hostname-based
  // DEV flag — both false on a Vercel Preview production build, which is why
  // the 401 had server evidence and no client evidence. This line must NOT be
  // gated: it is what distinguishes "session never restored" (infrastructure)
  // from "restored but not attached" (client).
  const i = at(ctx, "console.log('[Auth] boot'", 'AppContext');
  const line = ctx.slice(i, i + 420);
  for (const f of ['sessionPresent', 'userIdPresent', 'accessTokenPresent']) {
    assert.ok(line.includes(f), `the boot diagnostic must report ${f}`);
  }
  // Not wrapped in a DEV guard.
  const before = ctx.slice(Math.max(0, i - 160), i);
  assert.equal(/if \(import\.meta\.env\.DEV\)\s*\{?\s*$/.test(before), false,
    'the boot diagnostic must not be gated behind DEV');
});

test('SA-15 no diagnostic logs a token, email or user id', () => {
  // Booleans and timestamps only. A leaked access token in a browser console is
  // a session-hijack primitive.
  const diagnostics = [
    ctx.slice(at(ctx, "console.log('[Auth] boot'", 'AppContext'), at(ctx, "console.log('[Auth] boot'", 'AppContext') + 420),
    ctx.slice(at(ctx, "console.warn('[Pipeline] scan blocked", 'AppContext'), at(ctx, "console.warn('[Pipeline] scan blocked", 'AppContext') + 320),
    ctx.slice(at(ctx, "console.warn('[Analyze] blocked", 'AppContext'), at(ctx, "console.warn('[Analyze] blocked", 'AppContext') + 240),
  ];
  // The check is on what is LOGGED, not what is mentioned: a presence flag has
  // to reference access_token in order to test it. What matters is that every
  // such reference is boolean-coerced, so the value on the wire is true/false.
  for (const d of diagnostics) {
    for (const secret of ['access_token', '.email', 'user?.id', 'user.id']) {
      let from = 0;
      for (;;) {
        const i = d.indexOf(secret, from);
        if (i === -1) break;
        // Walk back over the optional-chaining expression to its start and
        // require a `!!` coercion in front of it.
        const prefix = d.slice(Math.max(0, i - 90), i);
        assert.match(prefix, /!!\s*[\w.?[\]]*$/,
          `"${secret}" is logged raw rather than as a boolean:\n...${prefix}${secret}`);
        from = i + secret.length;
      }
    }
    // And nothing may interpolate a token into a template string.
    assert.equal(/\$\{[^}]*(token|Token)[^}]*\}/.test(d), false, 'a token must never be interpolated into a log');
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// THE SERVER CONTRACT IS UNCHANGED
// ══════════════════════════════════════════════════════════════════════════════

test('SA-16 /api/analyze auth was not weakened to make this pass', () => {
  // The fix belongs entirely on the client. The server must still reject an
  // unauthenticated scan, and there must be no anonymous path.
  const api = readFileSync(`${ROOT}api/analyze.js`, 'utf8');
  assert.match(api, /if \(!authUser\) return json\(\{ error: 'Unauthorized/,
    'the server must still fail closed on a missing session');
  assert.match(api, /authUser\._expired/, 'expired sessions must still be rejected');
  assert.equal(/allowAnonymous|skipAuth|ANON_SCAN/.test(api), false,
    'no anonymous scanning path may exist');
});
