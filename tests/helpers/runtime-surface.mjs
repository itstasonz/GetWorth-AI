// ══════════════════════════════════════════════════════════════════════════════
// THE RUNTIME SURFACE, DERIVED FROM THE DEPLOYMENT CONTRACT  ·  S-2
//
// THE PROPERTY
//   Every module that can execute on the server in production is discoverable
//   from the repository's OWN deployment configuration — not from a path a test
//   author typed.
//
// THE FINDING. Provider discovery began with
//
//   const API = new URL('../api/', import.meta.url);
//
// and every guarantee built on it inherited that sentence as an axiom. It is
// not an axiom; it is a guess that happens to be true today. The moment a
// provider call moves into a module the scan was not pointed at — a helper
// under src/ imported by a handler, a second function directory, a route added
// to vercel.json — the scan reports clean, and says so with confidence. That is
// the same defect as searching for four known hosts, one level up: the
// verification could only ever confirm the shape it already assumed.
//
// WHAT THE DEPLOYMENT CONTRACT ACTUALLY SAYS. Read here rather than summarised:
//
//   vercel.json   `rewrites` name the request paths that reach the server, and
//                 their destinations name where the code for them lives.
//                 `functions` (absent today) would name globs directly.
//                 `outputDirectory` names the STATIC build, which is not server
//                 code whatever a rewrite says, and is excluded.
//
// THE PLATFORM'S OWN DEFAULT is applied on top: Vercel turns `api/` into
// functions with no configuration at all, so a repo that deletes its rewrites
// does not thereby acquire zero server code.
//
// AND THEN THE IMPORT CLOSURE. A function directory is an ENTRYPOINT set, not
// the surface. `api/analyze.js` importing `../src/lib/market.js` would put that
// file on the server just as surely as if it had been written inside api/. So
// every relative import is followed, transitively, out of the roots and
// wherever it leads. This is the half that makes the derivation general: a
// provider planted in a directory nobody named is still reached, because
// production reaches it.
//
// WHAT IT REFUSES TO PRETEND. Vercel also executes .py/.go/.rb functions. Those
// are reported as UNSCANNABLE — a finding with a name — rather than skipped, so
// the incompleteness is on the record instead of in the silence. The same goes
// for a relative import that resolves to nothing on disk: an import this walk
// cannot follow is a region of the surface it did not see, and it is reported.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, extname } from 'node:path';
// ONE LEXER. A second comment-and-string scanner written here would be a second
// implementation of one predicate, which is the defect this repository has
// recorded three times (`/watch/` vs `includes('watch')`, two evidence
// serialisers, two confidence parsers).
import { lex } from './provider-scan.mjs';

const BACKSLASH = String.fromCharCode(92);
const slash = (p) => p.split(BACKSLASH).join('/');

/** Extensions this toolchain can lex. Kept in step with SCANNED_EXTENSIONS. */
export const JS_RUNTIME_EXTENSIONS = Object.freeze(
  ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);

/**
 * Extensions the PLATFORM will execute that this toolchain cannot read.
 *
 * Declared so their presence is a finding rather than an omission. Adding a
 * Python function tomorrow must break the gate by name, not widen a blind spot.
 */
export const UNSCANNABLE_RUNTIME_EXTENSIONS = Object.freeze(
  ['.py', '.go', '.rb', '.rs', '.php']);

const NEVER_RUNTIME = new Set(['node_modules', '.git', '.vercel', 'dist', 'build', 'coverage']);

/**
 * The deployment contract, read from the repository's own configuration.
 *
 * Returns { roots, outputDirectory, framework, sources } — `roots` are
 * repo-relative directories whose files the platform turns into functions.
 * `sources` names every file the answer was read from, so a reader can check
 * the derivation rather than trust it.
 */
export function deploymentContract(repoRoot) {
  const sources = [];
  const roots = new Set();
  let outputDirectory = null;
  let framework = null;

  const vercelPath = join(repoRoot, 'vercel.json');
  if (existsSync(vercelPath)) {
    sources.push('vercel.json');
    const cfg = JSON.parse(readFileSync(vercelPath, 'utf8'));
    outputDirectory = cfg.outputDirectory ?? null;
    framework = cfg.framework ?? null;

    // `functions` names globs directly — the most explicit statement there is.
    for (const glob of Object.keys(cfg.functions || {})) {
      const dir = glob.split('/').filter((s) => !s.includes('*')).join('/');
      if (dir) roots.add(dir);
    }

    // A rewrite DESTINATION that is not the SPA fallback names where the code
    // for that path lives. `/api/:path*` -> the `api` directory.
    for (const rw of (cfg.rewrites || [])) {
      const dest = String(rw?.destination ?? '');
      if (!dest.startsWith('/')) continue;              // an external proxy, not our code
      const head = dest.slice(1).split('/')[0];
      if (!head || head.includes(':') || head.includes('*')) continue;  // '/' — the SPA fallback
      roots.add(head);
    }
  }

  const pkgPath = join(repoRoot, 'package.json');
  if (existsSync(pkgPath)) sources.push('package.json');

  // The platform's zero-config function directory.
  if (existsSync(join(repoRoot, 'api'))) roots.add('api');

  // The static build output is not server code, whatever a rewrite says.
  if (outputDirectory) roots.delete(outputDirectory.replace(/^\.?\//, ''));

  return {
    roots: [...roots].filter((r) => existsSync(join(repoRoot, r))).sort(),
    outputDirectory, framework, sources,
  };
}

function walkDir(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (NEVER_RUNTIME.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walkDir(full, out); continue; }
    if (entry.name.includes('__mutant__')) continue;     // mutation scratch copies
    out.push(full);
  }
  return out;
}

// Two shapes: `... from './x'` (import/export) and `import('./x')` /
// `require('./x')`. Both anchored on a non-identifier character so a word
// ENDING in "import" does not open one.
const RELATIVE_SPEC = new RegExp(
  String.raw`(?:^|[^\w$])(?:import|export)[\s\S]{0,400}?from\s*['"](\.[^'"\n]*)['"]` +
  String.raw`|(?:^|[^\w$])(?:import|require)\s*\(\s*['"](\.[^'"\n]*)['"]\s*\)`,
  'g');

// ── A SPECIFIER CHOSEN AT RUNTIME IS A REGION THIS WALK CANNOT ENTER ────────
//
// Found by this round's own adversarial pass, against the first version of this
// module. A handler containing
//
//   const n = 'vendor';
//   await import('../lib/hidden/' + n + '.js');
//
// reaches a provider that the surface never lists, and — worse — `unresolved`
// came back EMPTY, so the report was clean about a region it had not seen. That
// is the same failure as the old four-known-hosts scan, one level up.
//
// Static resolution of a computed specifier is not possible, and this does not
// pretend otherwise. It DETECTS THE SHAPE AND REFUSES IT, exactly as the
// provider scanner refuses a concatenated authority: the site is reported by
// name, and PD-11c fails until somebody either makes it a literal or writes
// down what covers it instead.
const DYNAMIC_LOAD = /\b(?:import|require)\s*\(/g;

function computedLoads(mod) {
  const { code, strings } = lex(mod.source);
  const literalAt = new Map(strings.map((s) => [s.index, s]));
  const out = [];
  for (const m of code.matchAll(DYNAMIC_LOAD)) {
    // `import(` in code position only — the lexer has already blanked comments
    // and literal bodies, so a mention inside a prompt is not a call site.
    let k = m.index + m[0].length;
    while (k < mod.source.length && /\s/.test(mod.source[k])) k++;
    const lit = literalAt.get(k);
    // A LITERAL IN FIRST POSITION IS NOT THE SAME AS A LITERAL SPECIFIER.
    // My first version stopped here, and the attack walked straight through it:
    // `import('../lib/hidden/' + n + '.js')` BEGINS with a literal, so the
    // check passed and the computed half was never looked at — the same
    // "a fragment is not a host" mistake the provider scanner already records.
    // The specifier is a literal only if the call ENDS right after it.
    if (lit && (lit.kind === 'string' || !lit.hasExpr)) {
      const after = code.slice(lit.index + lit.len, lit.index + lit.len + 40);
      if (/^\s*[),]/.test(after)) continue;                  // a plain literal: followed above
    }
    out.push({
      from: mod.path,
      spec: null,
      shape: 'computed-specifier',
      line: mod.source.slice(0, m.index).split(String.fromCharCode(10)).length,
      snippet: mod.source.slice(m.index, m.index + 60).split(String.fromCharCode(10))[0],
    });
  }
  return out;
}

/** Resolve a relative specifier to a file on disk, trying the usual endings. */
function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const tries = [base];
  if (!extname(base)) {
    for (const e of JS_RUNTIME_EXTENSIONS) tries.push(base + e);
    for (const e of JS_RUNTIME_EXTENSIONS) tries.push(join(base, 'index' + e));
  }
  for (const t of tries) {
    try { if (statSync(t).isFile()) return t; } catch { /* keep trying */ }
  }
  return null;
}

/**
 * Every module that can execute on the server, discovered from the contract.
 *
 * Returns { contract, entrypoints, modules, unscannable, unresolved }.
 *   modules      — { path, abs, source, origin } in the shape `scanModule` takes.
 *                  `path` is repo-relative, so a module OUTSIDE the function
 *                  roots is still named unambiguously.
 *   unscannable  — files the platform executes and this toolchain cannot read.
 *   unresolved   — relative imports that resolved to nothing on disk.
 */
export function discoverRuntimeSurface(repoRoot) {
  const contract = deploymentContract(repoRoot);
  const entrypoints = [];
  const unscannable = [];
  const unresolved = [];
  const seen = new Map();

  const add = (abs, origin) => {
    const key = slash(resolve(abs));
    if (seen.has(key)) return null;
    const ext = extname(abs);
    if (UNSCANNABLE_RUNTIME_EXTENSIONS.includes(ext)) {
      unscannable.push({ path: slash(relative(repoRoot, abs)), ext, origin });
      return null;
    }
    if (!JS_RUNTIME_EXTENSIONS.includes(ext)) return null;
    const mod = {
      path: slash(relative(repoRoot, abs)),
      abs: slash(abs),
      source: readFileSync(abs, 'utf8'),
      origin,
    };
    seen.set(key, mod);
    return mod;
  };

  for (const root of contract.roots) {
    for (const file of walkDir(join(repoRoot, root), [])) {
      const mod = add(file, `entrypoint-root:${root}`);
      if (mod) entrypoints.push(mod.path);
    }
  }

  // THE CLOSURE. Follow every relative import out of what we already have, for
  // as long as it keeps producing files — including out of the roots entirely.
  const queue = [...seen.values()];
  while (queue.length) {
    const mod = queue.shift();
    unresolved.push(...computedLoads(mod));
    for (const m of mod.source.matchAll(RELATIVE_SPEC)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const abs = resolveSpec(mod.abs, spec);
      if (!abs) { unresolved.push({ from: mod.path, spec }); continue; }
      const next = add(abs, `imported-by:${mod.path}`);
      if (next) queue.push(next);
    }
  }

  return {
    contract,
    entrypoints: entrypoints.sort(),
    modules: [...seen.values()].sort((a, b) => a.path.localeCompare(b.path)),
    unscannable,
    unresolved,
  };
}
