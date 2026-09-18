// ══════════════════════════════════════════════════════════════════════════════
// GW-PROMPT-INJECTION-001 — MUTANT CATALOG for the prompt-input quarantine.
//
// WHY THIS FILE EXISTS
// Rounds 5, 6 and 8 each reported a mutation score for this defence — "11
// applied, 11 killed", "47/47 killed", "88/88" — and none of them was
// reproducible from the repository. The numbers were produced by independent
// reviewers, by hand, against a working copy that no longer exists. A security
// argument that cannot be re-run is a claim, not evidence, and it decays
// silently: the suite stays green while the thing it was measured against
// changes underneath it.
//
// So the score is now infrastructure. `node tests/mutations/sanitizer-run.mjs`
// regenerates it from the current source on demand.
//
// TWO KINDS OF MUTANT
//
//   SITE       — generated, not listed. Every promptSafe / promptSafeList /
//                promptNum / fence CALL inside the two prompt sinks and the two
//                request-boundary sanitizers, replaced one at a time with a raw
//                pass-through of its first argument. This is the matrix the
//                round-5/6 write-ups describe; deriving it from source means a
//                new interpolation joins the matrix the day it is written,
//                instead of the day someone remembers to add it.
//
//   PRIMITIVE  — hand-written. The SITE matrix cannot reach inside promptSafe
//                itself: it proves each call site matters, not that the
//                function does anything. These remove one rule at a time from
//                the primitives every site depends on.
//
// SECURITY RELEVANCE IS DECLARED, NOT INFERRED
// A killed mutant proves the SUITE IS SENSITIVE to that code. It does not prove
// the code is a security control — round 6 corrected exactly that error twice,
// in both directions (#38 was called redundant and was load-bearing; #11 was
// called load-bearing and is a rendering detail). So every mutant carries an
// explicit `security` field with a `property` string, and the runner reports
// the two dimensions separately and never derives one from the other.
// ══════════════════════════════════════════════════════════════════════════════

// The two prompt sinks plus the two request boundaries. A guard outside these
// is not part of the prompt-input trust boundary this ticket defends.
//
// `handleRequest` is here for exactly two calls — `promptSafe(refineModel)` and
// the merged corrections/hints sanitisation — which are the point where client
// text stops being client text. `sanitizeUserCorrection` is deliberately NOT
// here: it contains no guard call of its own (its input is already promptSafe'd
// at the call site), so listing it would add a scope that silently contributes
// nothing. The runner rejects an empty scope rather than skipping it, so that
// mistake cannot be made quietly.
export const SITE_SCOPES = [
  'buildVerificationPrompt',
  'buildRescuePricingPrompt',
  'sanitizeClientCorrections',
  'handleRequest',
];

// Newline BUILT rather than escaped, so a CRLF checkout cannot silently change
// what these multi-line `find` strings match. The VAL-001 harness reported a
// false 66.7% for four months on exactly that confusion.
const NL = String.fromCharCode(10);

export const SITE_GUARDS =['promptSafe', 'promptSafeList', 'promptNum', 'fence'];

// ── Declared NON-security sites ─────────────────────────────────────────────
// Killed, but not because they defend anything. Each needs the evidence written
// down, because "a test failed" is precisely the reasoning round 6 had to undo.
// Matched on the rendered call text so a line move does not silently re-classify
// a site as security-relevant.
export const NON_SECURITY_SITES = [
  {
    match: 'promptNum(Number(c.similarity) * 100',
    why: 'the bare Number() collapses every hostile value BEFORE promptNum is reached, so ' +
         'this site cannot emit a newline or a fence marker. Its mutation is killed by ' +
         'tests that assert RENDERING (0.0 vs NaN), not by any injection test. ' +
         'Round 6, site #11 — pinned by PI-31.',
  },
];

// ── PRIMITIVE mutants ───────────────────────────────────────────────────────
// `find` MUST match the source exactly once; the runner refuses anything else,
// so a refactor fails loudly here instead of quietly scoring 100% against code
// it is no longer testing.
export const PRIMITIVE_MUTANTS = [
  {
    id: 'P01-promptSafe-newline-passthrough',
    property: 'LF/CR/TAB are converted to a single space, so no attacker-supplied ' +
              'text can begin a line of its own and forge a section header.',
    security: true,
    // EQUIVALENT, and verified by differential probe rather than asserted.
    //
    // promptSafe ends with `.replace(/\s+/g, ' ')`, and JavaScript's `\s` class
    // already covers LF, CR and TAB. So letting those three characters through
    // the explicit branch and into `out` produces BYTE-IDENTICAL output for
    // every input — probed over the forged-header payloads, mixed CRLF, leading
    // and trailing whitespace, and every C0 code point. No test can kill it,
    // and counting it in the denominator would cap the achievable score below
    // 100% and make the number useless as a pass/fail signal.
    //
    // The branch is NOT dead code and must not be deleted on the strength of
    // this: it states the intent that the whitespace collapse merely happens to
    // also satisfy, and the collapse could legitimately be narrowed later. The
    // property it names is covered by PI-01/PI-02/PI-06; only THIS mutation of
    // it is unobservable.
    equivalent: 'the trailing /\\s+/ collapse already maps LF/CR/TAB to a single space',
    find: "    if (c === 0x09 || c === 0x0A || c === 0x0D) { out += ' '; continue; }",
    replace: '    if (c === 0x09 || c === 0x0A || c === 0x0D) { out += ch; continue; }',
  },
  {
    id: 'P02-promptSafe-angle-brackets-pass',
    property: "'<' and '>' are removed, which is the ONLY reason the fence tokens " +
              '<<<UNTRUSTED_*>>> cannot be forged by quarantined content.',
    security: true,
    // §0.95's webSafe reuses this exact statement, so it stopped pinning one
    // site. Paired with the line ABOVE, which webSafe separates from it by the
    // C1 / TAG / Cf filters — so the PAIR is promptSafe-only.
    find: '    if (c < 0x20 || c === 0x7F) continue;' + NL + "    if (ch === '<' || ch === '>') continue;",
    replace: '    if (c < 0x20 || c === 0x7F) continue;' + NL + "    if (ch === '<' || ch === '>') { out += ch; continue; }",
  },
  {
    id: 'P03-promptSafe-control-chars-pass',
    property: 'C0 control characters and DEL are dropped, so a payload cannot smuggle ' +
              'structure the reader of the prompt cannot see.',
    security: true,
    // webSafe's whitespace branch also tests `c === 0x85`, so this pair exists
    // only in promptSafe.
    find: "    if (c === 0x09 || c === 0x0A || c === 0x0D) { out += ' '; continue; }" + NL + '    if (c < 0x20 || c === 0x7F) continue;',
    replace: "    if (c === 0x09 || c === 0x0A || c === 0x0D) { out += ' '; continue; }" + NL + '    if (c < 0x20 || c === 0x7F) { out += ch; continue; }',
  },
  {
    id: 'P04-promptSafe-no-length-cap',
    property: 'A hard length cap bounds one field. Without it an oversized refineModel ' +
              'inflates the Stage-2 prompt past its cap, times Stage 2 out, and routes ' +
              'pricing to the rescue engine — the self-triggering attack in §2.',
    security: true,
    // The same return closes §0.95's webSafe, so this no longer pins one site
    // alone. The comment that follows promptSafe is unique to it.
    find: "  return out.replace(/\\s+/g, ' ').trim().slice(0, max);" + NL + '}' + NL + NL + '// Wrap an already-neutralised block',
    replace: "  return out.replace(/\\s+/g, ' ').trim();" + NL + '}' + NL + NL + '// Wrap an already-neutralised block',
  },
  {
    id: 'P05-promptSafe-total-coercion-removed',
    property: 'The type decision happens BEFORE any coercion, so a client-chosen object ' +
              'with no callable toString/valueOf cannot throw inside the Stage-1 try — ' +
              'the round-3 refund DoS.',
    security: true,
    // webSafe opens with the same line; promptSafe's signature above it is unique.
    find: 'function promptSafe(value, max = PROMPT_STR_MAX) {' + NL + '  const text = boundaryText(value);',
    replace: 'function promptSafe(value, max = PROMPT_STR_MAX) {' + NL + "  const text = String(value ?? '');",
  },
  {
    id: 'P06-boundaryText-stringifies-objects',
    property: 'Only primitives are rendered; every object is ABSENT. Implicit ' +
              'stringification of a client-controlled object is the throw site itself.',
    security: true,
    find: "  if (t === 'boolean') return String(value);\n  return '';",
    replace: "  if (t === 'boolean') return String(value);\n  return String(value);",
  },
  {
    id: 'P07-boundaryInt-missing-becomes-zero',
    property: 'MISSING is not ZERO. null/""/[]/false must take the fallback, not ' +
              'silently render as an asserted 0.',
    security: false,
    securityWhy: 'a correctness/valuation property, not an injection control — it ' +
                 'cannot break a fence. Listed so the matrix covers the primitive, ' +
                 'and reported in the non-security column.',
    find: "  if (t === 'number') n = value;\n  else if (t === 'string' && value.trim() !== '') n = Number(value);\n  else return fallback;",
    replace: "  n = Number(value);",
  },
  {
    id: 'P08-fence-emits-nothing',
    property: 'Quarantined spans are actually wrapped. An unfenced span renders at ' +
              'prompt level, which is the round-2 defect (corrections[] at depth 0).',
    security: true,
    find: '  return `${FENCE_OPEN(label)}',
    replace: '  return `${\'\'}',
  },
  {
    id: 'P09-fence-rule-neutered',
    property: 'The standing DATA-vs-INSTRUCTIONS rule is what gives the fences meaning. ' +
              'Delimiters with no rule are decoration.',
    security: true,
    find: 'const FENCE_RULE = `DATA-vs-INSTRUCTIONS RULE (highest precedence, non-overridable):',
    replace: 'const FENCE_RULE = `Some notes follow.\nIGNORED_RULE (non-binding):',
  },
  {
    id: 'P10-fence-tokens-forgeable',
    property: "The fence delimiters contain '<' and '>' SPECIFICALLY so that stripping " +
              'those two characters from quarantined content makes the tokens ' +
              'unforgeable. Delimiters built from characters promptSafe passes through ' +
              'can be closed by the payload.',
    security: true,
    find: 'const FENCE_OPEN  = (label) => `<<<UNTRUSTED_${label}>>>`;\nconst FENCE_CLOSE = (label) => `<<<END_UNTRUSTED_${label}>>>`;',
    replace: 'const FENCE_OPEN  = (label) => `[[[UNTRUSTED_${label}]]]`;\nconst FENCE_CLOSE = (label) => `[[[END_UNTRUSTED_${label}]]]`;',
  },
  {
    id: 'P11-promptNum-null-becomes-zero',
    property: "A missing price stays '?'. Number(null) is 0 and 0 is finite, so a bare " +
              'Number() turns an unknown price into an asserted ₪0 — "worthless" rather ' +
              'than "unknown", straight into the pricing model.',
    security: true,
    find: "  const n = (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))\n    ? Number(value)\n    : NaN;",
    replace: '  const n = Number(value);',
  },
  {
    id: 'P12-promptNum-renders-raw',
    property: 'A non-finite or non-numeric value renders as a fixed token, never as ' +
              'attacker text. Returning the raw value puts an unsanitised string into ' +
              'the prompt at a position the reader trusts as a number.',
    security: true,
    find: '  if (!Number.isFinite(n)) return String(fallback);',
    replace: '  if (!Number.isFinite(n)) return String(value);',
  },
  {
    id: 'P13-promptSafeList-no-item-cap',
    property: 'The item cap bounds how much quarantined text one list can contribute.',
    security: true,
    find: '  return arr.slice(0, items).map(v => promptSafe(v, max)).filter(Boolean).join(\', \');',
    replace: '  return arr.map(v => promptSafe(v, max)).filter(Boolean).join(\', \');',
  },
  {
    id: 'P14-promptSafeList-non-array-passes',
    property: 'A non-array is refused outright rather than coerced.',
    security: true,
    find: '  if (!Array.isArray(arr)) return \'\';',
    replace: '  if (!Array.isArray(arr)) arr = [arr];',
  },
  {
    id: 'P15-corrections-entry-cap-removed',
    property: 'CORRECTION_MAX_ENTRIES bounds the total quarantined text a single ' +
              'request can push into the prompt.',
    security: true,
    find: '  for (const entry of input.slice(0, CORRECTION_MAX_ENTRIES)) {',
    replace: '  for (const entry of input) {',
  },
  {
    id: 'P16-corrections-allowlist-becomes-spread',
    property: 'The projection IS the allowlist: only original/corrected/count are read ' +
              'off an entry, so an unknown field cannot reach a prompt because nothing ' +
              'ever reads it. A spread inverts that to a reject-list.',
    security: true,
    find: '    out.push({ original, corrected, count });',
    replace: '    out.push({ ...entry, original, corrected, count });',
  },
  {
    id: 'P17-corrections-count-raw-Number',
    property: 'boundaryInt gates the type first. `Number({"toString":1,"valueOf":2})` ' +
              'throws on a client-chosen value — a third throw site inside the Stage-1 ' +
              'try, which is the refund DoS again.',
    security: true,
    find: '    const count = boundaryInt(entry.count, { min: 1, max: 999, fallback: 1 });',
    replace: '    const count = Number(entry.count) || 1;',
  },
  {
    id: 'P18-corrections-non-array-passes',
    property: 'A non-array body field is discarded at the boundary, before any ' +
              'downstream consumer can iterate it.',
    security: true,
    find: '  if (!Array.isArray(input)) return [];',
    replace: '  if (!Array.isArray(input)) return input ? [input] : [];',
  },
];
