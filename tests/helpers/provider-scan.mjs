// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER DISCOVERY  ·  HIGH-2
//
// THE PROPERTY
//   Every production module capable of initiating a billable external provider
//   call is DISCOVERABLE by this scanner, or EXPLICITLY REJECTED by it.
//
// The previous scanner could not deliver that, and its comment said it could.
// Three holes, all the same mistake — searching only for what we already know:
//
//   1. It looked for FOUR KNOWN HOST STRINGS. A fifth provider, with a host
//      nobody had thought of, matched nothing and was reported as "no new
//      provider sites". The guard could only ever confirm its own list.
//   2. It read `.js` and `.mjs`. A provider in `.cjs` or `.ts` was not scanned
//      at all — while the discovery comment claimed every module was found.
//   3. A host assembled at runtime — `'https://api.' + vendor`, a template with
//      an interpolated authority, an imported constant — is not a literal, so
//      no lexical scanner can resolve it. That is a real limit of static
//      analysis. The answer is to DETECT THE SHAPE AND REFUSE IT, not to
//      pretend the shape cannot occur.
//
// So this scanner finds hosts it has never heard of, and fails on construction
// it cannot resolve. What it cannot see at all is caught at runtime by the
// harness's out-of-band unknown-host record (HIGH-1). Which layer catches which
// mutation is stated per case in tests/provider-discovery.test.mjs — not left
// as an implication.
//
// LEXING, NOT REGEX, AND THE MIRROR IMAGE OF THE OTHER SCANNER. A host literal
// lives INSIDE a string, so the comment-and-string mask used for reachability
// analysis is exactly wrong here: it would blank the thing being looked for.
// This lexer keeps string bodies and drops comments.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);

// Every extension the platform will execute. `.cjs` and `.ts` are here because
// their absence was the finding; the rest are here so the next one is not.
export const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];

/** Every production module under `dir`, discovered rather than listed. */
export function discoverModules(dir, acc = [], rootPrefix = null) {
  const root = rootPrefix ?? dir;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) { discoverModules(child, acc, root); continue; }
    if (!SCANNED_EXTENSIONS.some((e) => entry.name.endsWith(e))) continue;
    if (entry.name.includes('__mutant__')) continue;          // mutation scratch copies
    const abs = fileURLToPath(child).split(BACKSLASH).join('/');
    const base = fileURLToPath(root).split(BACKSLASH).join('/');
    acc.push({ path: abs.slice(base.length), abs, source: readFileSync(child, 'utf8') });
  }
  return acc;
}

/**
 * Split source into tokens: comments dropped, string and template bodies KEPT
 * with their offsets.
 *
 * Returns { strings, code } where `code` is the source with every comment AND
 * every literal body blanked to spaces — length and newlines preserved, so
 * indices into `code` are still indices into the original.
 */
export function lex(src) {
  const out = Array.from(src);
  const strings = [];
  const blank = (k) => { if (out[k] !== NL) out[k] = ' '; };
  const lineAt = (i) => src.slice(0, i).split(NL).length;

  // A MODE STACK, not a flag or a local depth counter. The first draft of this
  // consumed a template with a single `depth` integer and treated a nested
  // backtick as "depth++", so ``  `${ `x` }`  `` never balanced: it ran off the
  // end of api/analyze.js's prompt builders and blanked every provider literal
  // after line 1010 — including all four `api.anthropic.com` sites. The scanner
  // then reported "no provider hosts in analyze.js" and would have PASSED.
  // The identical runaway, found the identical way, as the one recorded in
  // tests/refund-crossproduct.test.mjs. Hence the same containment: a real
  // stack, and a quoted string that may not cross a newline.
  const modes = [{ kind: 'code', depth: 0, interp: false }];
  let prev = '';
  let i = 0;

  while (i < src.length) {
    const m = modes[modes.length - 1];
    const c = src[i], d = src[i + 1];

    if (m.kind === 'template') {
      if (c === BACKSLASH) { m.text += src[i + 1] ?? ''; blank(i); blank(i + 1); i += 2; continue; }
      if (c === BACKTICK) {
        modes.pop(); blank(i);
        strings.push({ text: m.text, index: m.start, line: lineAt(m.start), kind: 'template', hasExpr: m.hasExpr, len: i + 1 - m.start });
        prev = 'x'; i++; continue;
      }
      if (c === '$' && d === '{') {
        m.hasExpr = true; m.text += '${}';
        blank(i); blank(i + 1);
        modes.push({ kind: 'code', depth: 0, interp: true });
        i += 2; continue;
      }
      m.text += c; blank(i); i++; continue;
    }

    // code
    if (c === '/' && d === '/') {
      const j = src.indexOf(NL, i); const end = j === -1 ? src.length : j;
      for (let k = i; k < end; k++) blank(k);
      i = end; continue;
    }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2); const end = j === -1 ? src.length : j + 2;
      for (let k = i; k < end; k++) blank(k);
      i = end; continue;
    }
    if (c === "'" || c === '"') {
      const start = i; let j = i + 1; let text = '';
      while (j < src.length && src[j] !== NL) {           // a quote may not cross a line
        if (src[j] === BACKSLASH) { text += src[j + 1] ?? ''; j += 2; continue; }
        if (src[j] === c) break;
        text += src[j]; j++;
      }
      const end = Math.min(j + 1, src.length);
      strings.push({ text, index: start, line: lineAt(start), kind: 'string', hasExpr: false, len: end - start });
      for (let k = start; k < end; k++) blank(k);
      prev = 'x'; i = end; continue;
    }
    if (c === BACKTICK) {
      modes.push({ kind: 'template', start: i, text: '', hasExpr: false });
      blank(i); i++; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev)) {
      let j = i + 1, inClass = false;
      while (j < src.length && src[j] !== NL) {
        if (src[j] === BACKSLASH) { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      const end = Math.min(j + 1, src.length);
      for (let k = i; k < end; k++) blank(k);
      prev = 'x'; i = end; continue;
    }
    if (c === '{') { m.depth++; prev = c; i++; continue; }
    if (c === '}') {
      if (m.depth > 0) { m.depth--; prev = c; i++; continue; }
      if (m.interp) { modes.pop(); blank(i); i++; continue; }   // end of ${…}
      prev = c; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { strings, code: out.join('') };
}

// -- §2  ONE DECLARED SOURCE OF TRUTH FOR "WHAT REACHES THE NETWORK" ---------
//
// N-2. The target scan recognised exactly three call shapes, and the RUNTIME
// layer patches `globalThis.fetch` and nothing else. So a provider reached
// through any other transport was invisible to BOTH layers, which is the one
// thing the security invariant forbids outright. Reproduced:
//
//   import https from 'node:https';
//   export function f(o) { https.request(o); }    STATIC: nothing  RUNTIME: nothing
//
// A literal host in an options object has no `//` either, so even that case is
// invisible: `{ host: 'api.vendor.example' }` carries no scheme for the literal
// scan to anchor on.
//
// Static analysis cannot be made complete and this does not pretend to. It makes
// the INCOMPLETENESS FAIL CLOSED: the entrypoints this scanner can follow are
// declared, the transports it cannot are declared, and importing one of the
// latter is a finding REPORTED BY NAME rather than a silent pass. Adding a
// transport then costs either teaching the scanner to follow it or removing it
// from the list deliberately -- which is the point. A guard whose blind spots
// are enumerated is a guard; one whose blind spots are unknown is a decoration.
export const NETWORK_ENTRYPOINTS = Object.freeze(['fetch', 'fetchWithRetry', 'new URL']);

const ENTRYPOINT_CALL = /\b(?:new\s+URL|fetch|fetchWithRetry)\s*\(/;

// Routes to the network whose DESTINATIONS this verification layer cannot see.
// Not a judgement about the libraries -- `undici` is what `fetch` is built on.
export const UNSUPPORTED_TRANSPORTS = Object.freeze([
  'node:http', 'node:https', 'node:net', 'node:dgram', 'node:dns',
  'http', 'https', 'net', 'dgram', 'dns',
  'axios', 'undici', 'got', 'node-fetch', 'request', 'superagent',
  'needle', 'phin', 'ky', 'bent', 'wreck',
]);

const TRANSPORT_SET = new Set(UNSUPPORTED_TRANSPORTS);

/**
 * Every module specifier this file imports or requires.
 *
 * Read from the STRING table the lexer already built, so a specifier mentioned
 * in a comment or inside a prompt is not one. The preceding CODE text decides
 * whether the string sits in import position -- the same discipline the
 * request-target scan uses, and for the same reason.
 */
function importedSpecifiers(mod, strings, code) {
  const out = [];
  for (const s of strings) {
    const before = code.slice(Math.max(0, s.index - 80), s.index);
    if (!/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)$/.test(before)) continue;
    out.push({ spec: s.text, line: s.line });
  }
  return out;
}

const SCHEME = /(?:https?:)?\/\//;
const HOST_AFTER_SCHEME = /^(?:https?:)?\/\/([A-Za-z0-9._-]+)/;
// A hostname, not a fragment: alphanumeric ends, and either a dotted name or
// the bare development host. Anything else is an authority under construction.
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const WELL_FORMED_HOST = new RegExp(`^(?:localhost|${LABEL}(?:\\.${LABEL})+)$`);
const AUTHORITY_TAIL = /(?:https?:)?\/\/[A-Za-z0-9._-]*$/;

/**
 * Every outbound host literal in one module, plus every site where a host is
 * built in a way this scanner cannot resolve.
 *
 *   literals — { host, file, line, via }
 *   dynamic  — { file, line, shape, snippet }  UNRESOLVABLE; must be registered
 */
export function scanModule(mod) {
  const { strings, code } = lex(mod.source);
  const literals = [];
  const dynamic = [];
  const lineAt = (i) => mod.source.slice(0, i).split(NL).length;

  for (const s of strings) {
    if (!SCHEME.test(s.text)) continue;

    // `https://${vendor}/v1` — the authority itself is a runtime value.
    if (s.kind === 'template' && /(?:https?:)?\/\/[A-Za-z0-9._-]*\$\{\}/.test(s.text)) {
      dynamic.push({ file: mod.path, line: s.line, shape: 'interpolated-authority', snippet: s.text.slice(0, 90) });
      continue;
    }
    for (const m of s.text.matchAll(/(?:https?:)?\/\/[A-Za-z0-9._-]*/g)) {
      const host = HOST_AFTER_SCHEME.exec(m[0])?.[1];
      if (!host) continue;
      // A FRAGMENT IS NOT A HOST. `'https://api.' + region + '.example'` leaves
      // the literal `https://api.`, and reporting that as the host `api.` is a
      // false resolution — worse than no resolution, because it looks like an
      // answer. A truncated authority is an unresolvable site, by definition.
      if (!WELL_FORMED_HOST.test(host)) {
        dynamic.push({ file: mod.path, line: s.line, shape: 'partial-authority', snippet: s.text.slice(0, 90) });
        continue;
      }
      literals.push({ host, file: mod.path, line: s.line, via: s.kind });
    }
  }

  // Concatenation. `'https://api.' + vendor + '.com'` yields a host that exists
  // in no literal — precisely the mutation the old scanner could not see.
  for (const s of strings) {
    if (!SCHEME.test(s.text) || !AUTHORITY_TAIL.test(s.text)) continue;
    const after = code.slice(s.index + s.len, s.index + s.len + 40);
    if (/^\s*\+/.test(after)) {
      dynamic.push({ file: mod.path, line: s.line, shape: 'concatenated-authority', snippet: s.text.slice(0, 90) });
    }
  }

  // ── REQUEST TARGETS ──────────────────────────────────────────────────────
  // Every call site is located in `code`, so a mention inside a comment or
  // inside a prompt string is not a call site. The ARGUMENT is then classified
  // against the ORIGINAL source.
  //
  // Reading the argument out of `code` was wrong, and quietly so: literals
  // there are blanked, so `fetch(` followed by a blanked template ran on into
  // that template's own `${…}` and reported `fetch(apiKey)` at a line whose
  // target is an ordinary literal.
  const literalAt = new Map(strings.map((s) => [s.index, s]));
  for (const m of code.matchAll(new RegExp(ENTRYPOINT_CALL.source, 'g'))) {
    // -- N-1. A DECLARATION IS NOT A CALL SITE -- BUT AN ARROW BODY IS. -------
    //
    // This read /(?:function|=>)\s*$/. The `=>` was there to skip a declaration
    // like `const fetchWithRetry = (url) => ...`, and it could never have done
    // that: in THAT shape the name is followed by ` = `, not by `(`, so the
    // entrypoint pattern never matches it in the first place. What `=>` actually
    // matched was the CONCISE ARROW BODY of a real call:
    //
    //   export const f = (q) => fetch(H + '/v1');            reported NOTHING
    //   export function f(q) { return fetch(H + '/v1'); }    non-literal-target
    //
    // The same call with the same unresolvable target, and opposite verdicts --
    // and the first is how a Phase-B adapter would be written. An `await`
    // between the arrow and the call happened to save that one case, which is
    // why nothing noticed. The round-2 record claimed the imported-constant
    // mutant was caught "STATIC -- unresolvable target at the consumer"; for an
    // arrow body that was simply false.
    //
    // Only the `function` KEYWORD immediately before the name is a declaration.
    const head = mod.source.slice(Math.max(0, m.index - 30), m.index);
    if (/\bfunction\s+$/.test(head)) continue;

    let k = m.index + m[0].length;
    while (k < mod.source.length && /\s/.test(mod.source[k])) k++;
    const lit = literalAt.get(k);

    if (lit) {
      // A template whose authority is a runtime value. Two shapes, and the
      // second one is the Supabase pattern: `${base}/rest/v1/...` carries NO
      // scheme in the literal at all, so a scheme-anchored test skips it
      // entirely and the host is invisible. Any template that BEGINS with an
      // interpolation is a variable base by definition.
      if (lit.kind === 'template' && /^\$\{\}/.test(lit.text)) {
        dynamic.push({ file: mod.path, line: lit.line, shape: 'variable-base-target', snippet: lit.text.slice(0, 90) });
      }
      continue;    // otherwise the literal scan above already has its host
    }

    const ident = /^[A-Za-z_$][\w$.]*/.exec(mod.source.slice(k, k + 60))?.[0];
    if (!ident) continue;
    dynamic.push({
      file: mod.path, line: lineAt(m.index),
      shape: 'non-literal-target', snippet: `${m[0].replace(/\s+/g, '')}${ident}`, ident,
    });
  }

  // -- UNSUPPORTED TRANSPORT ------------------------------------------------
  // Reported as a DYNAMIC (unresolvable) site rather than as a literal, because
  // that is precisely what it is: a route to a host this scanner cannot resolve
  // and the runtime harness cannot observe. It carries the module name, so the
  // report says WHICH transport rather than merely that something is wrong.
  for (const { spec, line } of importedSpecifiers(mod, strings, code)) {
    if (!TRANSPORT_SET.has(spec)) continue;
    dynamic.push({
      file: mod.path, line, shape: 'unsupported-transport', snippet: spec, transport: spec,
    });
  }

  return { literals, dynamic };
}

export function scanAll(modules) {
  const literals = [];
  const dynamic = [];
  for (const mod of modules) {
    const r = scanModule(mod);
    literals.push(...r.literals);
    dynamic.push(...r.dynamic);
  }
  return { literals, dynamic };
}

/** The enclosing `function NAME` for a 1-based line, searching backwards. */
export function enclosingFunction(source, line, limit = 400) {
  const lines = source.split(NL);
  for (let j = line - 1; j >= 0 && j > line - 1 - limit; j--) {
    const m = /^(?:export )?(?:async )?function (\w+)/.exec(lines[j]);
    if (m) return m[1];
  }
  return null;
}
