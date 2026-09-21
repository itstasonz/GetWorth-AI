// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER-CONTROL MUTANTS  ·  S-1
//
// Each entry DELETES or BYPASSES one security-authority mechanism in
// tests/helpers/provider-scan.mjs, restoring the behaviour that existed before
// that mechanism was written. `kills` names the tests that must go red; the
// runner checks that rather than printing it.
//
// ── WHY THIS FILE GREW FROM EIGHT ENTRIES TO THIRTY-ONE ─────────────────────
//
// The eight-entry version reported "8/8 killed — all provider controls are
// observed". Both halves were true and the sentence was false: eight was the
// number of rules somebody had written a mutant for. The scanner holds
// thirty-one decision sites; twenty-three were unobserved — not failing, not
// passing, outside the frame entirely. A score computed over a hand-chosen
// selection measures the selection.
//
// So the DENOMINATOR IS NO LONGER CHOSEN BY HAND. `mechanism` binds each mutant
// to an id derived from the scanner's SOURCE by
// tests/helpers/authority-inventory.mjs, and PC-6a fails when any derived
// mechanism has no mutant bound to it. Adding a rule to the scanner tomorrow —
// a new module-scope binding, a new `shape:` — puts a new id in the inventory
// that nothing claims, and the gate fails BY NAME. Deleting one leaves an
// orphaned claim, which fails for the same reason from the other side.
//
// ONE MECHANISM FOUND BY THE INVENTORY ITSELF, on its first run:
// `NETWORK_ENTRYPOINTS` was exported, described in the header as "one declared
// source of truth for what reaches the network", read by nobody, and emptying
// it changed nothing — the list that mattered was transcribed a second time
// inside `ENTRYPOINT_CALL`. It is derived from the declaration now, so PM-NETWORK-ENTRYPOINTS
// is a mutant that can be killed rather than one that could never be.
//
// `find` strings are whole LINES, located at build time by an escape-free
// substring, because every attempt to write a regex-bearing pattern through
// this toolchain produced literal control characters instead.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The modules the inventory is derived from, keyed by the mutant `target`.
 *
 * S-2 added tests/helpers/runtime-surface.mjs. Leaving it out of the inventory
 * would have reproduced the S-1 finding inside the code written to close it: a
 * verification layer with thirteen decision sites that nothing could delete and
 * watch.
 */
export const INVENTORY_MODULES = Object.freeze({
  scan: 'tests/helpers/provider-scan.mjs',
  surface: 'tests/helpers/runtime-surface.mjs',
});
/** Back-compat name for the module the first version of this file targeted. */
export const PROVIDER_SCAN_MODULE = INVENTORY_MODULES.scan;
const M = (name, kind = 'binding') => `${INVENTORY_MODULES.scan}::${kind}:${name}`;
const S = (name, kind = 'binding') => `${INVENTORY_MODULES.surface}::${kind}:${name}`;

// ── §13. THE HARNESS IS AN INSTRUMENT, AND AN INSTRUMENT NEEDS CALIBRATION ──
//
// A mutation harness that kills EVERYTHING is exactly as uninformative as one
// that kills nothing, and it is harder to notice because the number looks
// perfect. The previous concurrency remediation produced precisely that: mutant
// scratch copies written into the working tree were picked up by the design
// linter and by endpoint discovery, so a second run in flight failed every
// suite for reasons unrelated to any mutant, and the score read 100%.
//
// These two entries are not rules and they are not scored with the rules. They
// measure the HARNESS:
//
//   SENSITIVITY  a mutation that MUST be killed. If it survives, the harness is
//                not actually reaching the module under test, and every other
//                "killed" in the run is unexplained.
//   SPECIFICITY  a real, applied code change that NO suite asserts anything
//                about. If it is killed, the suites are failing for reasons
//                that have nothing to do with the mutation, and every other
//                "killed" is unearned.
//
// The specificity control must be a genuine change with no observer, not a
// no-op: `snippet` is a diagnostic string nothing asserts a length for, so
// trimming it by one character is visible to the module and invisible to the
// contract. If a future test ever does assert that length, this control starts
// being killed and the gate says so — which is the correct outcome, because at
// that point it is no longer a control.
export const PROVIDER_CONTROLS = [
  {
    id: 'CTL-SENSITIVITY-MUST-DIE',
    control: 'kill',
    invariant: 'The harness reaches the module under test at all.',
    find: 'export function scanAll(modules) {',
    replace: 'export function scanAll(modules) {\n  if (modules) throw new Error("[control] sensitivity probe");',
  },
  {
    id: 'CTL-SPECIFICITY-MUST-LIVE',
    control: 'survive',
    invariant: 'A real change no suite asserts anything about is NOT killed.',
    find: "      shape: 'non-literal-target', snippet: `${m[0].replace(/\\s+/g, '')}${ident}`, ident,",
    replace: "      shape: 'non-literal-target', snippet: `${m[0].replace(/\\s+/g, '')}${ident}`.slice(0, 89), ident,",
  },
  // ── THE SURFACE HALF WAS NEVER CALIBRATED ─────────────────────────────────
  //
  // A reviewer noticed that thirteen mutants declare `target: 'surface'` while
  // BOTH controls omitted `target` and therefore defaulted to `'scan'`. The
  // banner printed SENSITIVITY PROVEN / SPECIFICITY PROVEN over a run whose
  // surface half no control had ever touched — so if `RUNTIME_SURFACE_PATH`
  // stopped being honoured, all thirteen would report as "SURVIVED ← TEST GAP"
  // and be misdiagnosed as missing tests rather than as a broken instrument,
  // with the calibration still green. An instrument is calibrated per channel
  // or it is not calibrated.
  {
    id: 'CTL-SURFACE-SENSITIVITY-MUST-DIE',
    control: 'kill',
    target: 'surface',
    invariant: 'The harness reaches the runtime-surface module under test at all.',
    find: 'export function discoverRuntimeSurface(repoRoot) {',
    replace: 'export function discoverRuntimeSurface(repoRoot) {\n  if (repoRoot) throw new Error("[control] surface sensitivity probe");',
  },
  {
    id: 'CTL-SURFACE-SPECIFICITY-MUST-LIVE',
    control: 'survive',
    target: 'surface',
    invariant: 'A real change no suite asserts anything about is NOT killed, on the surface side too.',
    // `origin` is a provenance string for the reader; nothing asserts its text.
    find: "      const mod = add(file, `entrypoint-root:${root}`);",
    replace: "      const mod = add(file, `entrypoint-root: ${root}`);",
  },
];

export const PROVIDER_MUTANTS = [
  // ── DETECTORS: the shapes the scanner refuses to call clean ───────────────
  {
    id: "PM1-CAPTURED-GLOBALTHIS-FETCH",
    mechanism: M('captured-entrypoint', 'detector'),
    invariant: "A read of globalThis.fetch outside call position is a captured entrypoint.",
    kills: ["PC-1a","PC-1c"],
    find: "  for (const m of code.matchAll(/(?:globalThis|window|self)\\s*\\.\\s*fetch\\b(?!\\s*\\()/g)) {",
    replace: "  for (const m of []) {",
  },
  {
    id: "PM2-CAPTURED-BARE-FETCH",
    mechanism: M('captured-entrypoint', 'detector'),
    invariant: "A read of bare `fetch` into a binding is a captured entrypoint.",
    kills: ["PC-1a"],
    find: "  for (const m of code.matchAll(/\\b(?:const|let|var)\\s+\\w+\\s*=\\s*fetch\\b(?!\\s*\\()/g)) {",
    replace: "  for (const m of []) {",
  },
  {
    id: "PM3-UNTERMINATED-IS-SILENT",
    mechanism: M('lexer-unterminated', 'detector'),
    invariant: "A construct still open at EOF means a region was blanked, and must be reported.",
    kills: ["PC-2a","PC-2c"],
    find: "  const unterminated = modes.length > 1 ? modes[modes.length - 1].kind : null;",
    replace: "  const unterminated = null;",
  },
  {
    id: "PM4-UNDECLARED-DEPENDENCY-ALLOWED",
    mechanism: M('undeclared-dependency', 'detector'),
    invariant: "A bare specifier with no declared disposition is a finding by default.",
    kills: ["PC-3a"],
    find: "    if (disposition === null) {",
    replace: "    if (false) {",
  },
  {
    id: "PM-INTERPOLATED-AUTHORITY-IGNORED",
    mechanism: M('interpolated-authority', 'detector'),
    invariant: "A template whose AUTHORITY is interpolated is a host chosen at runtime.",
    kills: ["M-INTERP"],
    find: "    if (s.kind === 'template' && /(?:https?:)?\\/\\/[A-Za-z0-9._-]*\\$\\{\\}/.test(s.text)) {",
    replace: "    if (false) {",
  },
  {
    id: "PM-PARTIAL-AUTHORITY-RESOLVED-WRONGLY",
    mechanism: M('partial-authority', 'detector'),
    invariant: "A truncated authority is an unresolvable site, never the host it looks like.",
    kills: ["M-CONCAT"],
    find: "      if (!WELL_FORMED_HOST.test(host)) {",
    replace: "      if (false) {",
  },
  {
    id: "PM-CONCATENATED-AUTHORITY-IGNORED",
    mechanism: M('concatenated-authority', 'detector'),
    invariant: "A host assembled with + exists in no literal and must be refused.",
    kills: ["M-CONCAT"],
    find: "    if (/^\\s*\\+/.test(after)) {",
    replace: "    if (false) {",
  },
  {
    id: "PM-VARIABLE-BASE-TARGET-IGNORED",
    mechanism: M('variable-base-target', 'detector'),
    invariant: "A request target whose template BEGINS with an interpolation has a variable base.",
    kills: ["PD-7"],
    find: "      if (lit.kind === 'template' && /^\\$\\{\\}/.test(lit.text)) {",
    replace: "      if (false) {",
  },
  {
    id: "PM8-ARROW-BODY-IS-A-DECLARATION",
    mechanism: M('non-literal-target', 'detector'),
    invariant: "An arrow body is a CALL SITE; only the function keyword marks a declaration.",
    kills: ["NO-1b"],
    find: "    if (/\\bfunction\\s+$/.test(head)) continue;",
    replace: "    if (head.trimEnd().endsWith(String.fromCharCode(61, 62))) continue;",
  },
  {
    id: "PM-UNSUPPORTED-TRANSPORT-UNNAMED",
    mechanism: M('unsupported-transport', 'detector'),
    invariant: "A known-unfollowable transport is reported AS a transport, by name.",
    kills: ["PC-3e"],
    find: "    if (TRANSPORT_SET.has(spec)) {",
    replace: "    if (false) {",
  },

  // ── POLICY TABLES ─────────────────────────────────────────────────────────
  {
    id: "PM5-REGEX-KEYWORDS-GUTTED",
    mechanism: M('REGEX_KEYWORDS'),
    invariant: "After a keyword, a slash begins a regex — otherwise a backtick inside it blanks the file.",
    kills: ["PC-4a"],
    find: "const REGEX_KEYWORDS = new Set([",
    replace: "const REGEX_KEYWORDS = new Set([]); if (0) ([",
  },
  {
    id: "PM6-TRANSPORT-DENYLIST-EMPTIED",
    mechanism: M('TRANSPORT_SET'),
    invariant: "A known-unfollowable transport is refused BY NAME.",
    kills: ["PC-3e"],
    find: "const TRANSPORT_SET = new Set(UNSUPPORTED_TRANSPORTS);",
    replace: "const TRANSPORT_SET = new Set();",
  },
  {
    id: "PM-UNSUPPORTED-TRANSPORTS-EMPTIED",
    mechanism: M('UNSUPPORTED_TRANSPORTS'),
    invariant: "The declared list of unfollowable transports is the input to the refusal.",
    kills: ["PC-3e"],
    find: "export const UNSUPPORTED_TRANSPORTS = Object.freeze([",
    replace: "export const UNSUPPORTED_TRANSPORTS = Object.freeze([]); if (0) Object.freeze([",
  },
  {
    id: "PM7-EXTENSION-SET-NARROWED",
    mechanism: M('SCANNED_EXTENSIONS'),
    invariant: "Every executable extension is discovered, not just .js and .mjs.",
    kills: ["NO-1g"],
    find: "export const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];",
    replace: "export const SCANNED_EXTENSIONS = ['.js', '.mjs'];",
  },
  {
    id: "PM-SPECIFIER-DISPOSITION-EMPTIED",
    mechanism: M('SPECIFIER_DISPOSITION'),
    invariant: "A dependency's disposition is DECLARED; an empty table makes every import a finding.",
    kills: ["PC-3b","PC-3d"],
    find: "export const SPECIFIER_DISPOSITION = Object.freeze({",
    replace: "export const SPECIFIER_DISPOSITION = Object.freeze({}); if (0) Object.freeze({",
  },
  {
    id: "PM-DISPOSITION-ENTRY-RELABELLED",
    mechanism: M('SPECIFIER_DISPOSITION.@supabase/supabase-js', 'entry'),
    invariant: "Each ENTRY of the dependency allowlist is a separate decision about a separate package.",
    kills: ["PC-3b","PC-3d"],
    // The entry-level mechanism exists because a reviewer added ONE line to this
    // table and made a real finding disappear while the suite stayed green.
    // Emptying the table fails LOUD and therefore cannot observe an ADDED entry;
    // only a per-entry mechanism can. This mutant proves the entry is observed.
    find: "  '@supabase/supabase-js': 'fetch-based',",
    replace: "  '@supabase/supabase-js': 'unsupported',",
  },
  {
    id: "PM-NETWORK-ENTRYPOINTS-EMPTIED",
    mechanism: M('NETWORK_ENTRYPOINTS'),
    invariant: "The declared entrypoint list is what the call-site scan actually follows.",
    kills: ["PC-6b"],
    find: "export const NETWORK_ENTRYPOINTS = Object.freeze(['fetch', 'fetchWithRetry', 'new URL']);",
    replace: "export const NETWORK_ENTRYPOINTS = Object.freeze(['__never_called__']);",
  },

  // ── RECOGNISERS ───────────────────────────────────────────────────────────
  {
    id: "PM-ENTRYPOINT-CALL-NEVER-MATCHES",
    mechanism: M('ENTRYPOINT_CALL'),
    invariant: "The call-site pattern is what locates every request in the code.",
    kills: ["M-IMPORT"],
    find: "const ENTRYPOINT_CALL = new RegExp(",
    replace: "const ENTRYPOINT_CALL = /__never_matches__/; if (0) new RegExp(",
  },
  {
    id: "PM-SCHEME-NEVER-MATCHES",
    mechanism: M('SCHEME'),
    invariant: "A string with a scheme is where a host literal can be.",
    kills: ["PD-4"],
    find: "const SCHEME = /(?:https?:)?\\/\\//;",
    replace: "const SCHEME = /__never_matches__/;",
  },
  {
    id: "PM-HOST-AFTER-SCHEME-CONSTANT",
    mechanism: M('HOST_AFTER_SCHEME'),
    invariant: "The host is EXTRACTED from the literal, not invented.",
    kills: ["PD-4"],
    find: "const HOST_AFTER_SCHEME = /^(?:https?:)?\\/\\/([A-Za-z0-9._-]+)/;",
    replace: "const HOST_AFTER_SCHEME = /^(?:https?:)?\\/\\/[A-Za-z0-9._-]*(x)?/;",
  },
  {
    id: "PM-LABEL-MATCHES-ANYTHING",
    mechanism: M('LABEL'),
    invariant: "A hostname label has alphanumeric ends — that is what makes a fragment detectable.",
    kills: ["M-CONCAT"],
    find: "const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';",
    replace: "const LABEL = '[\\\\s\\\\S]*';",
  },
  {
    id: "PM-WELL-FORMED-HOST-ACCEPTS-ALL",
    mechanism: M('WELL_FORMED_HOST'),
    invariant: "A truncated authority is not a host, and must not be reported as one.",
    kills: ["M-CONCAT"],
    find: "const WELL_FORMED_HOST = new RegExp(`^(?:localhost|${LABEL}(?:\\\\.${LABEL})+)$`);",
    replace: "const WELL_FORMED_HOST = /^[\\s\\S]*$/;",
  },
  {
    id: "PM-AUTHORITY-TAIL-NEVER-MATCHES",
    mechanism: M('AUTHORITY_TAIL'),
    invariant: "A literal ENDING inside an authority is where a concatenation can continue it.",
    kills: ["M-CONCAT"],
    find: "const AUTHORITY_TAIL = /(?:https?:)?\\/\\/[A-Za-z0-9._-]*$/;",
    replace: "const AUTHORITY_TAIL = /__never_matches__/;",
  },
  {
    id: "PM-NL-IS-NOT-A-NEWLINE",
    mechanism: M('NL'),
    invariant: "The line delimiter bounds a line comment and locates every finding.",
    kills: ["PD-10"],
    find: "const NL = String.fromCharCode(10);",
    replace: "const NL = String.fromCharCode(59);",
  },
  {
    id: "PM-BACKSLASH-IS-NOT-AN-ESCAPE",
    mechanism: M('BACKSLASH'),
    invariant: "A backslash escapes the next character, so an escaped quote does not close a string.",
    kills: ["PC-6c"],
    find: "const BACKSLASH = String.fromCharCode(92);",
    replace: "const BACKSLASH = String.fromCharCode(35);",
  },
  {
    id: "PM-BACKTICK-IS-NOT-A-TEMPLATE",
    mechanism: M('BACKTICK'),
    invariant: "A backtick opens a template, whose body is a string and whose ${} is code.",
    kills: ["PC-2a"],
    find: "const BACKTICK = String.fromCharCode(96);",
    replace: "const BACKTICK = String.fromCharCode(35);",
  },

  // ── PREDICATES AND ENTRY POINTS ───────────────────────────────────────────
  {
    id: "PM-DISCOVER-MODULES-FINDS-NOTHING",
    mechanism: M('discoverModules'),
    invariant: "Discovery walks the tree; a scan of nothing is not a clean scan.",
    kills: ["PD-2"],
    find: "export function discoverModules(dir, acc = [], rootPrefix = null) {",
    replace: "export function discoverModules(dir, acc = [], rootPrefix = null) {\n  if (acc) return acc;",
  },
  {
    id: "PM-LEX-RETURNS-NOTHING",
    mechanism: M('lex'),
    invariant: "The lexer is what separates a live string from a comment.",
    kills: ["PD-9"],
    find: "export function lex(src) {",
    replace: "export function lex(src) {\n  if (src) return { strings: [], code: src, unterminated: null };",
  },
  {
    id: "PM-SCAN-MODULE-REPORTS-NOTHING",
    mechanism: M('scanModule'),
    invariant: "The per-module scan is the whole static layer.",
    kills: ["PD-9"],
    find: "export function scanModule(mod) {",
    replace: "export function scanModule(mod) {\n  if (mod) return { literals: [], dynamic: [] };",
  },
  {
    id: "PM-SCAN-ALL-DROPS-MODULES",
    mechanism: M('scanAll'),
    invariant: "The tree-wide scan aggregates EVERY module, not the first one.",
    kills: ["PD-4"],
    find: "export function scanAll(modules) {",
    replace: "export function scanAll(modules) {\n  if (modules) modules = [];",
  },
  {
    id: "PM-ENCLOSING-FUNCTION-UNATTRIBUTED",
    mechanism: M('enclosingFunction'),
    invariant: "A finding is attributed to its function, so a ledger disposition can name it.",
    kills: ["M-CJS"],
    find: "export function enclosingFunction(source, line, limit = 400) {",
    replace: "export function enclosingFunction(source, line, limit = 400) {\n  if (source) return null;",
  },
  {
    id: "PM-BARE-SPECIFIER-NEVER-BARE",
    mechanism: M('isBareSpecifier'),
    invariant: "A non-relative specifier is a dependency, and a dependency needs a disposition.",
    kills: ["PC-3a"],
    find: "function isBareSpecifier(spec) {",
    replace: "function isBareSpecifier(spec) {\n  if (spec) return false;",
  },
  {
    id: "PM-IMPORTED-SPECIFIERS-EMPTY",
    mechanism: M('importedSpecifiers'),
    invariant: "Imports are read from the string table in import position; none read means none checked.",
    kills: ["PC-3a"],
    find: "function importedSpecifiers(mod, strings, code) {",
    replace: "function importedSpecifiers(mod, strings, code) {\n  if (mod) return [];",
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// S-2 · tests/helpers/runtime-surface.mjs
//
// Thirteen decision sites, every one of them derived from the module's own
// source by tests/helpers/authority-inventory.mjs and claimed below. The module
// decides WHICH CODE RUNS ON THE SERVER, so a rule deleted here does not make
// the scan wrong — it makes the scan look at less, and report clean about it.
// ══════════════════════════════════════════════════════════════════════════════
export const SURFACE_MUTANTS = [
  {
    id: 'SM-CONTRACT-NAMES-NO-ROOT',
    target: 'surface', mechanism: S('deploymentContract'),
    invariant: 'The function roots come from the repository’s own deployment configuration.',
    kills: ['PD-11a'],
    find: 'export function deploymentContract(repoRoot) {',
    replace: 'export function deploymentContract(repoRoot) {\n  if (repoRoot) return { roots: [], outputDirectory: null, framework: null, sources: [] };',
  },
  {
    id: 'SM-SURFACE-IS-EMPTY',
    target: 'surface', mechanism: S('discoverRuntimeSurface'),
    invariant: 'The surface is the set of modules that can execute on the server.',
    kills: ['PD-2'],
    find: 'export function discoverRuntimeSurface(repoRoot) {',
    replace: 'export function discoverRuntimeSurface(repoRoot) {\n  if (repoRoot) return { contract: deploymentContract(repoRoot), entrypoints: [], modules: [], unscannable: [], unresolved: [] };',
  },
  {
    id: 'SM-WALK-FINDS-NOTHING',
    target: 'surface', mechanism: S('walkDir'),
    invariant: 'A function root is walked to its leaves, not read one level deep.',
    kills: ['PD-2'],
    find: 'function walkDir(dir, out) {',
    replace: 'function walkDir(dir, out) {\n  if (dir) return out;',
  },
  {
    id: 'SM-CLOSURE-NOT-FOLLOWED',
    target: 'surface', mechanism: S('RELATIVE_SPEC'),
    invariant: 'A module imported by a handler runs on the server, wherever it lives.',
    kills: ['PD-11b'],
    find: 'const RELATIVE_SPEC = new RegExp(',
    replace: 'const RELATIVE_SPEC = /__never_matches__/g; if (0) new RegExp(',
  },
  {
    id: 'SM-SPEC-NEVER-RESOLVES',
    target: 'surface', mechanism: S('resolveSpec'),
    invariant: 'An import is followed to the file it names, or reported as unfollowable.',
    kills: ['PD-11d'],
    find: 'function resolveSpec(fromFile, spec) {',
    replace: 'function resolveSpec(fromFile, spec) {\n  if (fromFile) return null;',
  },
  {
    id: 'SM-EXTENSION-SET-NARROWED',
    target: 'surface', mechanism: S('JS_RUNTIME_EXTENSIONS'),
    invariant: 'Every extension the platform executes and this toolchain can read is scanned.',
    kills: ['PD-11b'],
    find: 'export const JS_RUNTIME_EXTENSIONS = Object.freeze(',
    replace: "export const JS_RUNTIME_EXTENSIONS = Object.freeze(['.js']); if (0) Object.freeze(",
  },
  {
    id: 'SM-UNSCANNABLE-IS-SILENT',
    target: 'surface', mechanism: S('UNSCANNABLE_RUNTIME_EXTENSIONS'),
    invariant: 'A runtime this toolchain cannot read is refused BY NAME, never skipped.',
    kills: ['PD-11b'],
    find: 'export const UNSCANNABLE_RUNTIME_EXTENSIONS = Object.freeze(',
    replace: 'export const UNSCANNABLE_RUNTIME_EXTENSIONS = Object.freeze([]); if (0) Object.freeze(',
  },
  {
    id: 'SM-EXCLUSIONS-SWALLOW-LIB',
    target: 'surface', mechanism: S('NEVER_RUNTIME'),
    invariant: 'The exclusion list names build and tooling directories, not production ones.',
    kills: ['PD-11b'],
    find: "const NEVER_RUNTIME = new Set(['node_modules', '.git', '.vercel', 'dist', 'build', 'coverage']);",
    replace: "const NEVER_RUNTIME = new Set(['node_modules', '.git', '.vercel', 'dist', 'build', 'coverage', '_lib']);",
  },
  {
    id: 'SM-COMPUTED-SPECIFIER-IGNORED',
    target: 'surface', mechanism: S('computed-specifier', 'detector'),
    invariant: 'A specifier chosen at runtime is a region this walk cannot enter, and is refused.',
    kills: ['PD-11c'],
    find: "      shape: 'computed-specifier',",
    replace: "      shape: 'computed-specifier-disabled-by-mutation',",
  },
  {
    id: 'SM-COMPUTED-LOADS-EMPTY',
    target: 'surface', mechanism: S('computedLoads'),
    invariant: 'Every import() and require() site is examined, not only the static ones.',
    kills: ['PD-11c'],
    find: 'function computedLoads(mod) {',
    replace: 'function computedLoads(mod) {\n  if (mod) return [];',
  },
  {
    id: 'SM-DYNAMIC-LOAD-NEVER-MATCHES',
    target: 'surface', mechanism: S('DYNAMIC_LOAD'),
    invariant: 'The pattern that locates a dynamic load is what makes the refusal reachable.',
    kills: ['PD-11c'],
    // `\b` in a JS string literal is a BACKSPACE, not a word boundary. The
    // first version of this entry matched zero times for that reason and was
    // reported INVALID — which is the harness doing its job: a mutation that
    // did not apply tells you nothing in either direction.
    find: "const DYNAMIC_LOAD = /\\b(?:import|require)\\s*\\(/g;",
    replace: 'const DYNAMIC_LOAD = /__never_matches__/g;',
  },
  {
    id: 'SM-PATHS-NOT-NORMALISED',
    target: 'surface', mechanism: S('slash'),
    invariant: 'A module path is reported in one form, so a registry entry means the same thing everywhere.',
    kills: ['PD-2'],
    find: "const slash = (p) => p.split(BACKSLASH).join('/');",
    replace: 'const slash = (p) => String(p).toUpperCase();',
  },
  {
    id: 'SM-SEPARATOR-IS-NOT-A-SEPARATOR',
    target: 'surface', mechanism: S('BACKSLASH'),
    invariant: 'The platform separator is what path normalisation replaces.',
    kills: ['PD-2'],
    find: 'const BACKSLASH = String.fromCharCode(92);',
    replace: 'const BACKSLASH = String.fromCharCode(46);',
  },
];

for (const m of SURFACE_MUTANTS) PROVIDER_MUTANTS.push(m);
