// ══════════════════════════════════════════════════════════════════════════════
// PROVIDER-CONTROL MUTANTS  ·  S-1
//
// Each entry DELETES one provider rule, restoring the behaviour that existed
// before it was added. All five round-4 rules shipped with NO test at all, and a
// security reviewer proved it by deleting each one and watching the whole gate
// stay green — the three existing harnesses mutate PRODUCTION modules, and these
// rules live in a test helper, so nothing could reach them. "100% mutation
// score" was a statement about a set of files that excluded the security
// controls entirely.
//
// `kills` names the tests that must go red. The runner checks it rather than
// printing it: a mutant whose named tests stay green while others fail means the
// invariant is protected by something other than the test that claims to.
//
// `find` strings are whole LINES, located at build time by an escape-free
// substring, because every attempt to write a regex-bearing pattern through this
// toolchain produced literal control characters instead.
// ══════════════════════════════════════════════════════════════════════════════
export const PROVIDER_MUTANTS = [
  {
    id: "PM1-CAPTURED-GLOBALTHIS-FETCH",
    invariant: "A read of globalThis.fetch outside call position is a captured entrypoint.",
    kills: ["PC-1a","PC-1c"],
    find: "  for (const m of code.matchAll(/(?:globalThis|window|self)\\s*\\.\\s*fetch\\b(?!\\s*\\()/g)) {",
    replace: "  for (const m of []) {",
  },
  {
    id: "PM2-CAPTURED-BARE-FETCH",
    invariant: "A read of bare `fetch` into a binding is a captured entrypoint.",
    kills: ["PC-1a"],
    find: "  for (const m of code.matchAll(/\\b(?:const|let|var)\\s+\\w+\\s*=\\s*fetch\\b(?!\\s*\\()/g)) {",
    replace: "  for (const m of []) {",
  },
  {
    id: "PM3-UNTERMINATED-IS-SILENT",
    invariant: "A construct still open at EOF means a region was blanked, and must be reported.",
    kills: ["PC-2a","PC-2c"],
    find: "  const unterminated = modes.length > 1 ? modes[modes.length - 1].kind : null;",
    replace: "  const unterminated = null;",
  },
  {
    id: "PM4-UNDECLARED-DEPENDENCY-ALLOWED",
    invariant: "A bare specifier with no declared disposition is a finding by default.",
    kills: ["PC-3a","PC-3d"],
    find: "    if (disposition === null) {",
    replace: "    if (false) {",
  },
  {
    id: "PM5-REGEX-KEYWORDS-GUTTED",
    invariant: "After a keyword, a slash begins a regex — otherwise a backtick inside it blanks the file.",
    kills: ["PC-4a"],
    find: "const REGEX_KEYWORDS = new Set([",
    replace: "const REGEX_KEYWORDS = new Set([]); const UNUSED_KEYWORDS = ([",
  },
  {
    id: "PM6-TRANSPORT-DENYLIST-EMPTIED",
    invariant: "A known-unfollowable transport is refused BY NAME.",
    kills: ["PC-3a"],
    find: "const TRANSPORT_SET = new Set(UNSUPPORTED_TRANSPORTS);",
    replace: "const TRANSPORT_SET = new Set();",
  },
  {
    id: "PM7-EXTENSION-SET-NARROWED",
    invariant: "Every executable extension is discovered, not just .js and .mjs.",
    kills: ["NO-1g"],
    find: "export const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];",
    replace: "export const SCANNED_EXTENSIONS = ['.js', '.mjs'];",
  },
  {
    id: "PM8-ARROW-BODY-IS-A-DECLARATION",
    invariant: "An arrow body is a CALL SITE; only the function keyword marks a declaration.",
    kills: ["NO-1b"],
    find: "    if (/\\bfunction\\s+$/.test(head)) continue;",
    replace: "    if (head.trimEnd().endsWith(String.fromCharCode(61, 62))) continue;",
  },
];
