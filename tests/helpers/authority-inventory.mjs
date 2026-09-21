// ══════════════════════════════════════════════════════════════════════════════
// THE SECURITY-AUTHORITY INVENTORY, DERIVED FROM SOURCE  ·  S-1
//
// THE PROPERTY
//   UNOBSERVED SECURITY AUTHORITY = TEST FAILURE.
//
// THE FINDING. The provider mutation harness carried eight mutants and reported
// "8/8 killed — all provider controls are observed". Both halves were true and
// the sentence was false: eight was the number of rules SOMEBODY HAD WRITTEN A
// MUTANT FOR. The scanner holds two dozen decision sites, and the rest were
// unobserved — not failing, not passing, simply outside the frame. A score
// computed over a hand-chosen selection measures the selection.
//
// ── AND THE FIRST VERSION OF THIS FILE HAD THE SAME DEFECT, ONE LEVEL UP ────
//
// An independent security reviewer found it before it shipped. The deriver
// recognised three syntactic shapes — `const|let|var NAME =`, `function NAME(`,
// and `shape: 'single-quoted'` — so a rule written in any OTHER shape produced
// NO mechanism id, nothing claimed it, and PC-6a stayed green over it:
//
//   export default function auditEverything(mod) { … }   ->  nothing derived
//   export class SecretScanner { scan(mod) { … } }       ->  nothing derived
//   const { compile: RULE } = require('x')               ->  nothing derived
//   globalThis.HIDDEN_RULE = /secret/                    ->  nothing derived
//   let LATE_RULE; LATE_RULE = (m) => 1                  ->  nothing derived
//   const FIRST = 1, HIDDEN_RULE = /secret/              ->  only FIRST
//   push({ shape: "double-quoted-rule" })                ->  no detector
//
// A gate that only sees the shapes its author happened to write is the
// enumeration failure this whole round exists to stop repeating. Widening the
// three patterns to seven would have been the same move again.
//
// TWO MECHANISMS INSTEAD, AND NEITHER IS A LIST OF SHAPES:
//
//   1. THE MODULE'S REAL SURFACE, READ AT RUNTIME. `deriveRuntimeMechanisms`
//      imports the module and enumerates its actual export namespace, plus the
//      function-valued members of exported objects and the prototype methods of
//      exported classes. A namespace is SHAPE-PROOF: a default export, a class,
//      a destructured re-export and a computed name all appear in it, because
//      by then they are bindings rather than syntax. Anything EXPORTED is
//      therefore seen however it was written.
//
//   2. REFUSE EVERY STATEMENT THAT IS NOT A KNOWN INERT FORM. Not "every line
//      that binds something" — that was the SECOND version's mistake, and a
//      second reviewer broke it with `Object.defineProperty(globalThis, …)`,
//      which binds a rule and contains no `=`. A list of what a binding looks
//      like is an enumeration wearing the word "fail-closed". So the polarity is
//      inverted: a module-scope statement is inert only if it is an import, a
//      re-export, a directive, a recognised declaration or the tail of a
//      construct. Anything else is `unclassified` and fails the gate BY NAME.
//      That is the doctrine the provider scanner already applies to a host it
//      cannot resolve: detect the shape and refuse it, never report clean about
//      a region you did not read.
//
// WHAT A MECHANISM IS
//   BINDING       a module-scope name — a policy table, a recogniser, a
//                 predicate, a delimiter constant. If it is at module scope in a
//                 module whose only job is refusal, it is load-bearing or it
//                 should not be there. Deliberately unforgiving: it has no
//                 taste, and taste is what let sixteen rules go unobserved.
//   DETECTOR      a distinct `shape:` a scan can emit — one rule about what the
//                 scanner refuses to call clean, in any quoting style. A shape
//                 assembled at runtime is refused rather than guessed at.
//   MEMBER        a function reachable through an exported object or class, so a
//                 rule hidden as a property of an existing table is still a
//                 mechanism of its own.
//   ENTRY         one key of an exported MAP. A map is a policy keyed by
//                 subject, and each key is a separate decision about a separate
//                 thing — see the note at the enumeration itself for the
//                 allowlist witness that forced this. Arrays and Sets stay one
//                 mechanism, because emptying a homogeneous list genuinely is
//                 the observation.
//   UNCLASSIFIED  a module-scope statement this deriver could not read, or a
//                 `shape:` assembled at runtime. Always a finding.
//
// WHAT THIS IS NOT. It is not a claim that every binding matters equally, or
// that killing a mutant of `BACKSLASH` proves something deep. It is a claim that
// no decision site in the module is INVISIBLE to the verification system —
// which is the specific thing that was false three times, each time in a
// narrower place than the last.
// ══════════════════════════════════════════════════════════════════════════════

// ONE LEXER, AND IT IS NOT THIS FILE'S.
//
// The statement scan below needs a view of the source in which comments,
// strings, templates AND REGEX LITERALS are blanked, because it locates
// statements by brace depth. My first version blanked only comments and
// strings, and the depth count drifted: `/(?!\s*\()/g` contributes an unmatched
// `(` to a naive character walk, provider-scan.mjs is full of such patterns,
// and after the first few the depth never returned to zero — so SEVEN
// statement-level shapes were silently never examined. The witness was that the
// probe reported them invisible while the control was clean.
//
// `lex` already solves regex-vs-division, including the keyword-position case
// that caused the round-9 runaway. Writing a second one here is the "two
// implementations of one predicate" defect this repository has recorded three
// times. The lexer is a TOOL, not the subject: this import is deliberately
// static, so analysing a MUTATED provider-scan still uses the real one.
import { spawnSync } from 'node:child_process';
import { lex } from './provider-scan.mjs';

const NL = String.fromCharCode(10);
const BACKTICK = String.fromCharCode(96);

/** 1-based line number of an index into `src`. */
const lineAt = (src, i) => src.slice(0, i).split(NL).length;

// Module scope means column zero. A binding indented inside a function is a
// local, and mutating one is a statement about that function's internals rather
// than about the module's policy.
//
// `(.*)` after the keyword is the whole BINDING LIST, parsed below, so
// `const A = 1, B = 2` and `const { a: B } = x` both yield every name they bind
// rather than only the first identifier that happens to follow the keyword.
const MODULE_DECLARATION = /^(?:export\s+)?(?:const|let|var)\s+([^;\n]*)/gm;
const MODULE_FUNCTION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/gm;
const MODULE_CLASS = /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)?/gm;
// `globalThis.X = …`, `LATE_RULE = …` — a binding created without a keyword.
const MODULE_ASSIGNMENT = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=[^=>]/gm;
// A finding shape, in ANY quoting style. The VALUE is captured whole and then
// classified, rather than matched by a pattern that tries to say "quoted" and
// "not quoted" in one breath — my first version wrote the second as a negative
// lookahead after `\s*`, and `\s*` simply backtracked to zero width so every
// quoted shape ALSO reported as computed. A regex that can satisfy itself two
// ways is not a classifier.
const DETECTOR_SHAPE = /\bshape:([^,\n}]+)/g;
const QUOTED_VALUE = new RegExp(
  String.raw`^\s*(['"` + BACKTICK + String.raw`])([^'"` + BACKTICK + String.raw`]*)\1\s*$`);
// ── THE INERT FORMS. EVERYTHING ELSE IS A FINDING. ──────────────────────────
//
// A SECOND reviewer broke the previous version of this file, and the witness is
// worth stating because the mistake is the one this whole round is about.
// My refusal only fired on a module-scope line that contained a top-level `=`:
//
//   Object.defineProperty(globalThis, '__gwHostAllow',
//     { value: (h) => h.endsWith('.trusted.example'), enumerable: false });
//
// has no `=` at all, so neither MODULE_ASSIGNMENT nor the refusal matched, and
// the whole control suite ran 21/21 GREEN while `fetch('https://exfil.trusted.example/v1')`
// went from a reported host literal to nothing. Ten more shapes did the same —
// an IIFE, a top-level `if`, a top-level loop, a labelled statement, a
// destructuring assignment with no keyword, a Symbol-keyed property, a
// non-enumerable property, a getter.
//
// I had written a list of what a binding LOOKS LIKE and called it a refusal.
// That is an enumeration wearing the word "fail-closed", and eleven shapes walked
// past it.
//
// SO THE POLARITY IS INVERTED. A module-scope statement is inert only if it is
// one of the forms below; anything else is `unclassified` and fails the gate by
// name. A call expression at column zero is not a line of prose.
const INERT_STATEMENT = [
  /^import\s/,                       // an import — its target joins the closure
  /^export\s*\{/,                    // a re-export list — the names are bindings already
  /^export\s*\*/,                    // a star re-export, likewise
  /^['"]use strict['"];?\s*$/,       // a directive prologue
];
// Pure structure: the tail of a multi-line construct that began at depth 0.
const CLOSER_ONLY = /^[\s)\]};,]*$/;

/**
 * Every TOP-LEVEL statement in a lexed skeleton, as { index, text }.
 *
 * Split on `;` and on the boundaries of depth-0 blocks, counting only
 * separators at brace depth zero — so `for (a; b; c)` is one statement and
 * `const A = 1; Object.defineProperty(...)` is two. The skeleton has comments,
 * strings, templates and regex literals blanked, so no `;` inside one of those
 * can split anything.
 *
 * A block that CLOSES at depth 0 also ends a statement, which is what makes a
 * labelled block (`rules: { … }`) and a bare `if (…) { … }` visible as
 * statements of their own rather than as the tail of whatever preceded them.
 */
function topLevelStatements(skeleton) {
  const out = [];
  let depth = 0;
  let start = 0;
  // Whether the brace that took us from depth 0 to 1 was a BLOCK (`if (x) {`,
  // `function f() {`, `label: {`) rather than an object or import brace
  // (`= {`, `import {`, `(… , {`). Only a block ENDS a statement when it
  // closes. My first version pushed on every depth-0 `}` and split
  // `import { readFileSync } from 'node:fs';` in half, leaving `from …;` as a
  // statement nothing could classify — a false positive on the untouched
  // module, which is the noisy-deriver failure PC-6e exists to catch.
  let openerIsBlock = false;
  const push = (end) => {
    const text = skeleton.slice(start, end);
    if (text.trim()) out.push({ index: start + (text.length - text.trimStart().length), text });
    start = end;
  };
  for (let i = 0; i < skeleton.length; i++) {
    const c = skeleton[i];
    if ('{[('.includes(c)) {
      if (depth === 0 && c === '{') {
        const before = skeleton.slice(start, i).replace(/\s+$/, '');
        const last = before.slice(-1);
        openerIsBlock = last === ')' || last === '}' || last === ''
          || /(^|[;}])\s*[A-Za-z_$][\w$]*\s*:$/.test(before);   // a labelled block
      }
      depth++;
      continue;
    }
    if ('}])'.includes(c)) {
      depth--;
      if (depth === 0 && c === '}' && openerIsBlock) push(i + 1);
      continue;
    }
    if (c === ';' && depth === 0) push(i + 1);
  }
  push(skeleton.length);
  return out;
}

/**
 * Every name a declarator list binds.
 *
 * `A = 1, B = 2`          -> A, B
 * `{ a, b: c } = x`       -> a, c      (the RENAMED name is the binding)
 * `[ , second ] = x`      -> second
 *
 * Deliberately OVER-captures rather than under-captures: an extra mechanism
 * costs a mutant somebody has to write, while a missing one is a rule nothing
 * can observe. The asymmetry is the whole point.
 */
function boundNames(declaratorList) {
  const names = [];
  // Only the binding side of each declarator — everything before the first
  // top-level `=`. Depth tracking so `= { a: 1 }` on the value side is skipped.
  let depth = 0;
  let head = '';
  for (let i = 0; i < declaratorList.length; i++) {
    const c = declaratorList[i];
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === '=' && depth === 0 && declaratorList[i + 1] !== '=' && declaratorList[i + 1] !== '>') {
      // Skip to the next top-level comma, which starts the next declarator.
      let d = 0;
      let j = i + 1;
      for (; j < declaratorList.length; j++) {
        const k = declaratorList[j];
        if ('{[('.includes(k)) d++;
        else if ('}])'.includes(k)) d--;
        else if (k === ',' && d === 0) break;
      }
      i = j;
      head += ',';
      continue;
    }
    head += c;
  }
  // `{ a, b: c }` — a rename binds the name AFTER the colon.
  for (const part of head.split(',')) {
    const renamed = /:\s*([A-Za-z_$][\w$]*)/.exec(part);
    if (renamed) { names.push(renamed[1]); continue; }
    const plain = /([A-Za-z_$][\w$]*)/.exec(part.replace(/^[\s{[\]}]+/, ''));
    if (plain) names.push(plain[1]);
  }
  return names.filter(Boolean);
}

/**
 * Every security-authority mechanism in one module, derived from its text.
 *
 * Returns [{ id, kind, name, file, line }] sorted by id. `id` names the BINDING
 * rather than a line, so it is stable across edits that move code.
 */
export function deriveMechanisms(source, file) {
  const src = String(source ?? '');
  const out = new Map();
  const put = (kind, name, index) => {
    const id = `${file}::${kind}:${name}`;
    if (!out.has(id)) out.set(id, { id, kind, name, file, line: lineAt(src, index) });
  };

  // Comments are stripped first, so a name MENTIONED in prose is not a
  // mechanism. The scanners in this repo are more comment than code, and an
  // inventory that counted prose would be noise with a number on it.
  const code = stripComments(src);
  const statements = topLevelStatements(lex(src).code);
  const claimedStatements = new Set();
  // A declaration claims the STATEMENT that contains it — not its line, and not
  // the rest of the file. `import … ; Object.defineProperty(…)` is two
  // statements, so claiming the first leaves the second to be classified.
  const claim = (index) => {
    let owner = null;
    for (const s of statements) {
      if (s.index > index) break;
      owner = s;
    }
    if (owner) claimedStatements.add(owner.index);
  };

  for (const m of code.matchAll(MODULE_DECLARATION)) {
    claim(m.index);
    for (const name of boundNames(m[1])) put('binding', name, m.index);
  }
  for (const m of code.matchAll(MODULE_FUNCTION)) {
    claim(m.index);
    put('binding', m[1] || 'default', m.index);
  }
  for (const m of code.matchAll(MODULE_CLASS)) {
    claim(m.index);
    put('binding', m[1] || 'default', m.index);
  }
  for (const m of code.matchAll(MODULE_ASSIGNMENT)) {
    claim(m.index);
    put('binding', m[1].replace(/\s+/g, ''), m.index);
  }
  for (const m of code.matchAll(DETECTOR_SHAPE)) {
    const quoted = QUOTED_VALUE.exec(m[1]);
    if (quoted) { put('detector', quoted[2], m.index); continue; }
    // Assembled at runtime. REFUSED, not resolved. The id carries the LINE
    // because there is no name to carry — which also means moving it re-opens
    // the claim, correctly: a computed shape is a site somebody has to look at,
    // not a stable rule.
    put('unclassified', `computed-shape@${lineAt(src, m.index)}`, m.index);
  }

  // ── AND THE REFUSAL, INVERTED ───────────────────────────────────────────
  //
  // Every module-scope STATEMENT must be a recognised declaration or one of the
  // inert forms. Anything else is a construct this deriver could not read, and
  // is reported rather than skipped.
  //
  // A statement is located by BRACE DEPTH over a skeleton in which comments AND
  // string/template bodies are blanked — not by "starts at column zero". A line
  // at column zero inside a multi-line object literal or template is a
  // continuation, not a statement, and depth is the only thing that knows the
  // difference. Getting that wrong in either direction is fatal: too loose and
  // the refusal is noise nobody can act on; too tight and it is the hole that
  // let `Object.defineProperty` through.
  // ── A LINE IS NOT A STATEMENT, AND THAT WAS THE THIRD REPETITION ────────
  //
  // The previous version examined LINES, exempting any line that began with an
  // inert keyword or that a declaration had already claimed. A reviewer broke
  // both halves with one idea — a line holds as many statements as you like:
  //
  //   import { x } from 'node:url'; Object.defineProperty(globalThis, …);
  //   const TRANSPORT_SET = (Object.defineProperty(globalThis, …), new Set(…));
  //
  // Both ran the control suite 21/21 GREEN while deleting a host literal from
  // the scan. `/^import\s/` tested the whole line, and `claimedLines` exempted
  // a claimed line for its entire length — each treating "this line has a
  // recognised thing on it" as "this line has nothing else on it".
  //
  // So the unit is the STATEMENT: the skeleton is split on top-level `;` and
  // each piece is classified on its own. The comma operator, the labelled
  // block and the import-prefixed piggyback all fall out generically, because
  // none of them was ever a property of lines.
  for (const stmt of statements) {
    const text = stmt.text.trim();
    if (!text) continue;
    if (claimedStatements.has(stmt.index)) continue;
    if (CLOSER_ONLY.test(text)) continue;
    if (INERT_STATEMENT.some((re) => re.test(text))) continue;
    const line = lineAt(src, stmt.index);
    const id = `${file}::unclassified:line-${line}`;
    if (out.has(id)) continue;
    out.set(id, {
      id, kind: 'unclassified', name: `line-${line}`, file, line,
      snippet: src.slice(stmt.index, stmt.index + 90).split(NL)[0].trim(),
    });
  }

  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every mechanism reachable through the module's REAL export namespace.
 *
 * SHAPE-PROOF, and that is the entire reason it exists. By the time a module is
 * evaluated, `export default function`, `export class`, a destructured
 * re-export and a computed export name are all just bindings in a namespace
 * object — so this sees them without anyone having predicted how they were
 * written.
 *
 * Function-valued members of exported objects and prototype methods of exported
 * classes are enumerated too, so a RULE HIDDEN AS A PROPERTY of an existing
 * table is a mechanism of its own rather than an invisible addition to one.
 *
 * `namespace` is the result of `await import(...)`.
 */
export function deriveRuntimeMechanisms(namespace, file) {
  const out = new Map();
  const put = (kind, name) => {
    const id = `${file}::${kind}:${name}`;
    if (!out.has(id)) out.set(id, { id, kind, name, file, line: 0 });
  };
  if (!namespace || typeof namespace !== 'object') return [];

  for (const key of Object.keys(namespace)) {
    put('binding', key);
    const value = namespace[key];
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;

    // A class: its prototype methods are rules.
    if (typeof value === 'function' && value.prototype) {
      for (const name of Object.getOwnPropertyNames(value.prototype)) {
        if (name === 'constructor') continue;
        if (typeof value.prototype[name] === 'function') put('member', `${key}.${name}`);
      }
    }
    // ── A MAP'S ENTRIES ARE ITS POLICY ──────────────────────────────────────
    //
    // This used to enumerate only FUNCTION-valued entries, on the reasoning
    // that "data entries are covered by the mutant that empties the table".
    // A reviewer showed that sentence is FALSE for an allowlist, and the
    // witness is exact: adding one line to SPECIFIER_DISPOSITION —
    //
    //     '@vendor/telemetry-beacon': 'no-network',
    //
    // turns `import x from '@vendor/telemetry-beacon'` from
    // ["undeclared-dependency"] into [], and the control suite ran 21/21 GREEN.
    // Emptying that table makes MORE things findings, so the emptying mutant
    // fails LOUD and can never observe an ADDED entry that makes a finding
    // disappear. H-8's whole point is that this table is the allowlist, and an
    // allowlist is the one place an attacker adds a line.
    //
    // So every own key of an exported MAP is a mechanism. An array or a Set
    // stays one mechanism: it is a homogeneous list, and emptying it genuinely
    // is the observation. Reflect.ownKeys, not Object.keys, because a
    // non-enumerable or Symbol-keyed rule is still a rule.
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Set)
        && !(value instanceof Map)) {
      for (const name of Reflect.ownKeys(value)) {
        const label = typeof name === 'symbol' ? name.toString() : name;
        let entry;
        try { entry = value[name]; } catch { entry = '<threw>'; }
        put(typeof entry === 'function' ? 'member' : 'entry', `${key}.${label}`);
      }
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Blank comments, preserving length and newlines so indices still line up.
 *
 * String bodies are SKIPPED rather than blanked: a `//` inside a literal must
 * not open a comment, and blanking a literal could only ever REMOVE a mechanism
 * from the inventory — a silent narrowing, which is the failure mode this file
 * exists to eliminate.
 */
function stripComments(src, { blankStrings = false } = {}) {
  const out = Array.from(src);
  const blank = (k) => { if (out[k] !== NL) out[k] = ' '; };
  const BACKSLASH = String.fromCharCode(92);
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf(NL, i);
      const end = j === -1 ? src.length : j;
      for (let k = i; k < end; k++) blank(k);
      i = end; continue;
    }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? src.length : j + 2;
      for (let k = i; k < end; k++) blank(k);
      i = end; continue;
    }
    if (c === "'" || c === '"' || c === BACKTICK) {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === BACKSLASH) { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (c !== BACKTICK && src[j] === NL) break;   // a quote may not cross a line
        j++;
      }
      // TWO VIEWS OF ONE SOURCE. The mechanism scan needs string BODIES intact,
      // because `shape: 'x'` lives inside one. The statement scan needs them
      // BLANKED, because a brace inside a string is not a brace and a
      // multi-line template would otherwise throw the depth count — and the
      // depth count is what distinguishes a statement from a continuation.
      if (blankStrings) for (let k = i + 1; k < Math.min(j, src.length) - 1; k++) blank(k);
      i = j; continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * The inventory's SCOPE: the roots plus everything they relatively import.
 *
 * A reviewer's eleventh shape was "put the rule in a NEW module and import it"
 * — invisible, because the inventory was a fixed list of two files and an
 * `import` line is an inert statement. A fixed list of modules is the same
 * enumeration failure as a fixed list of shapes, one level out.
 *
 * So the scope is CLOSED under relative import. A module that a root pulls in
 * is part of that root's behaviour and joins the inventory the moment somebody
 * writes the import; its mechanisms then have no claim and the gate fails by
 * name. Bare specifiers are NOT followed: a dependency's internals are governed
 * by SPECIFIER_DISPOSITION, which is a different rule with its own mechanism.
 *
 * `roots` is [{ name, file }] — `name` is the id prefix, `file` the path on
 * disk (which differs from `name` under a mutation run). A module discovered
 * through the closure is named by its location relative to the root that
 * imported it, so an id stays stable whether the tree is real or a temp copy.
 */
export function inventoryClosure(roots, { readFile, resolve }) {
  const out = [];
  const seen = new Set();
  const queue = roots.map((r) => ({ ...r, depth: 0 }));
  while (queue.length) {
    const mod = queue.shift();
    if (seen.has(mod.file)) continue;
    seen.add(mod.file);
    let source;
    try { source = readFile(mod.file); } catch { continue; }
    out.push({ ...mod, source });
    for (const m of source.matchAll(RELATIVE_IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const file = resolve(mod.file, spec);
      if (!file || seen.has(file)) continue;
      // Named by the DIRECTORY of the root that imported it, so a module added
      // beside provider-scan.mjs reads as tests/helpers/<name>.
      const dir = mod.name.slice(0, mod.name.lastIndexOf('/') + 1);
      queue.push({ name: dir + spec.replace(/^\.\//, ''), file, depth: mod.depth + 1 });
    }
  }
  return out;
}

const RELATIVE_IMPORT =
  /(?:^|[^\w$])(?:import|export)[\s\S]{0,400}?from\s*['"](\.[^'"\n]*)['"]|(?:^|[^\w$])(?:import|require)\s*\(\s*['"](\.[^'"\n]*)['"]\s*\)/g;

/**
 * Compare a derived inventory against the mutants that claim to observe it.
 *
 * `mutants` is any array whose entries carry `{ id, mechanism }`. Returns
 * { unobserved, orphaned, observed } — `orphaned` is a mutant naming a
 * mechanism that no longer exists, which is the stale half of the same
 * property and fails the gate for the same reason.
 */
export function reconcile(mechanisms, mutants) {
  const known = new Map(mechanisms.map((m) => [m.id, m]));
  const claimed = new Map();
  for (const mut of mutants) {
    if (!mut.mechanism) continue;
    if (!claimed.has(mut.mechanism)) claimed.set(mut.mechanism, []);
    claimed.get(mut.mechanism).push(mut.id);
  }
  const unobserved = mechanisms.filter((m) => !claimed.has(m.id));
  const orphaned = [...claimed.keys()]
    .filter((id) => !known.has(id))
    .map((id) => ({ mechanism: id, mutants: claimed.get(id) }));
  const observed = mechanisms.filter((m) => claimed.has(m.id));
  return { unobserved, orphaned, observed };
}

/**
 * Every global this module INSTALLS when it is imported.
 *
 * ── WHY AN EFFECT CHECK, WHEN EVERYTHING ELSE HERE IS SYNTACTIC ─────────────
 *
 * A reviewer hid a rule inside an already-observed declaration:
 *
 *   const TRANSPORT_SET = (Object.defineProperty(globalThis, '__gwHostAllow',
 *     { value: (h) => h.endsWith('.trusted.example') }), new Set(UNSUPPORTED_TRANSPORTS));
 *
 * Statement splitting does not reach it — the comma operator is INSIDE the
 * initializer, at paren depth, and `binding:TRANSPORT_SET` still exists with
 * its mutant still attached, so `reconcile` is satisfied. Chasing that
 * syntactically means recognising the comma operator, then `Object.assign`,
 * then a getter, then whatever is next: the enumeration treadmill again.
 *
 * So this asks a different question. Not "what shape is it written in" but
 * "what did importing it DO". A verification module has no business installing
 * anything on the global object, whatever syntax it uses to get there, and a
 * rule that reaches its consumer through a global is a rule by any definition.
 * The check is blind to syntax by construction, which is the only way it stays
 * closed against a shape nobody has thought of.
 *
 * Cache-busted, so a module already imported by the caller is still measured.
 */
export function deriveGlobalEffects(href, file) {
  // ── IN A FRESH PROCESS, BECAUSE THIS PROCESS IS ALREADY CONTAMINATED ──────
  //
  // Measuring in-process does not work, and both ways it fails are subtle
  // enough that I got each of them wrong once:
  //
  //   · A caller that has ALREADY imported the module — and the suite imports
  //     the scanner at the top of the file — installed the global long before
  //     any snapshot here. A cache-busted re-import gives a fresh MODULE but
  //     not a fresh GLOBAL, so the key is in `before` and the module reads
  //     clean. That is exactly how the comma-operator witness kept passing the
  //     real gate while an isolated probe caught it every time.
  //   · Measuring several candidates in one process, the first to install `__x`
  //     poisons every later `before` set.
  //
  // A child process has neither problem, and needs no cleanup afterwards: the
  // contamination exits with it. Synchronous so callers stay simple.
  const probe = [
    'const before = new Set(Reflect.ownKeys(globalThis));',
    `await import(${JSON.stringify(href)});`,
    'const added = Reflect.ownKeys(globalThis)',
    '  .filter((k) => !before.has(k))',
    '  .map((k) => (typeof k === "symbol" ? k.toString() : k));',
    'process.stdout.write(JSON.stringify(added));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe],
    { encoding: 'utf8', timeout: 30000 });
  // A module that refuses to load is loud everywhere else; nothing to add here.
  if (r.status !== 0) return [];
  let added = [];
  try { added = JSON.parse(r.stdout || '[]'); } catch { return []; }
  return added.map((name) => ({
    id: `${file}::global:${name}`, kind: 'global', name, file, line: 0,
    snippet: 'installed on globalThis at import',
  }));
}

// ── WHERE A RULE LIVES IS THE WRONG QUESTION ────────────────────────────────
//
// Six fixes into this file, a reviewer defeated it twice more, and the two
// witnesses are the same fact from opposite sides:
//
//   a7  the rule installs on `Math` instead of `globalThis`, so a check that
//       diffs globalThis's own keys sees nothing. Object.prototype, JSON,
//       Reflect and every other intrinsic work equally well.
//   a8  the rule installs LAZILY, on first call, from inside a function body.
//       Nothing changes at module scope at all — and every mechanism this file
//       derives (bindings, entries, members, detectors, unclassified
//       statements, global effects) is about module scope.
//
// Each previous fix recognised one more place a rule can hide. That is the
// enumeration treadmill with better vocabulary, and a8 ends it: a rule inside a
// function body is outside the frame no matter how many shapes the frame knows.
//
// So this asks nothing about where the rule is. It runs the module over a
// corpus and records WHAT IT ANSWERS. A rule that changes no answer is not a
// rule; a rule that changes one shows up as drift, whether it lives in a
// binding, a prototype, a closure, a Proxy, or a file read at call time.
//
// THE HONEST LIMIT, stated because it is the same defect one level out: this
// catches a rule the CORPUS TRIGGERS. The corpus below is therefore derived and
// systematic rather than a list of known attacks — production's own modules,
// plus a cross-product of host shapes, so a rule keyed to some suffix is likely
// to meet it. It is not a proof, and a rule keyed to something the corpus never
// produces is still invisible. What makes that survivable is that it fails
// LOUD: such a rule is a mutant nothing kills.
//
// In a CHILD PROCESS, so a candidate that pollutes `Math` or `Object.prototype`
// cannot contaminate the measurement of the next one.
const CORPUS_LABELS = ['a', 'b', 'api', 'cdn', 'exfil'];
const CORPUS_MIDS = ['trusted', 'vendor', 'internal', 'market'];
const CORPUS_TLDS = ['example', 'test', 'local'];

/** A derived corpus of sources: systematic host shapes plus real production modules. */
export function behaviourCorpus(extraSources = []) {
  const out = [];
  for (const l of CORPUS_LABELS) {
    for (const m of CORPUS_MIDS) {
      for (const t of CORPUS_TLDS) {
        const host = `${l}.${m}.${t}`;
        out.push({ path: `gen/${host}.mjs`, source: `export const f = () => fetch('https://${host}/v1');` });
      }
    }
    out.push({ path: `gen/${l}.mjs`, source: `export const f = () => fetch('https://${l}.example/v1');` });
  }
  // Shapes that exercise the other detectors, so drift in any of them is visible.
  out.push({ path: 'gen/capture.mjs', source: 'const F = globalThis.fetch;\nexport const f = (q) => F(q);' });
  out.push({ path: 'gen/transport.mjs', source: "import x from 'node:https';\nexport const f = (o) => x(o);" });
  out.push({ path: 'gen/undeclared.mjs', source: "import x from 'some-unclassified-pkg';\nexport const f = (o) => x(o);" });
  out.push({ path: 'gen/concat.mjs', source: "export const f = () => fetch('https://api.' + v + '.example/v1');" });
  return [...out, ...extraSources];
}

/**
 * What this module ANSWERS over a corpus, as a stable string.
 *
 * Two modules with the same fingerprint are indistinguishable to every caller;
 * two with different fingerprints differ in a way somebody can observe. Returns
 * null when the module cannot be loaded or run, which callers treat as "no
 * comparison available" rather than as agreement.
 */
export function behaviourFingerprint(href, corpus = behaviourCorpus()) {
  const probe = [
    `const M = await import(${JSON.stringify(href)});`,
    `const corpus = ${JSON.stringify(corpus)};`,
    'const out = corpus.map((m) => {',
    '  try { const r = M.scanModule(m);',
    '    return [m.path, r.literals.map((l) => l.host).sort(),',
    '            [...new Set(r.dynamic.map((d) => d.shape))].sort()]; }',
    '  catch (e) { return [m.path, "threw", String(e && e.message).slice(0, 80)]; }',
    '});',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return r.stdout || null;
}
