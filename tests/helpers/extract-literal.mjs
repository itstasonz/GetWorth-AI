// ══════════════════════════════════════════════════════════════════════════════
// Source-region extraction — for testing expressions that have no seam.
//
// Some of the most consequential code in this repo is an object literal buried
// inside a 4400-line serverless handler or a React `useCallback`. The UI-003
// Wave 0 persistence rows are the example: `valuationRow` in api/analyze.js and
// `row` in src/contexts/AppContext.jsx decide, for every scan, whether an
// unpriced valuation is stored as NULL or as ₪0. Neither is reachable without
// running the whole handler or mounting the whole provider.
//
// The available options were:
//   1. assert over the SOURCE TEXT with a regex — proves the characters are
//      present, not that the behaviour holds. That is exactly the weakness of
//      PB-09, and a regex passes against code that has been gutted.
//   2. re-implement the row in the test — the M21 mistake, verbatim: a test
//      that re-implements its subject passes no matter what ships.
//   3. change the source to create a seam.
//   4. EXECUTE the real source region against controlled inputs.
//
// This module is option 4. It lifts the exact characters that ship out of the
// file and evaluates them, so the assertions run the real expression with the
// real dependencies bound. Nothing is copied, so nothing can drift.
//
// Extraction failure is LOUD and fatal, deliberately — same reasoning as the
// mutation harness's MALFORMED state. A refactor that moves one of these blocks
// must break the test rather than silently leave it asserting over nothing.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scan forward from `start` (which must index an opening `{`, `(` or `[`) to its
 * match, ignoring anything inside strings, template literals or comments.
 *
 * The string/comment awareness is not decoration: these blocks carry prose
 * comments and quoted labels, and a mutation under test may introduce a brace
 * inside either. A naive depth counter would then mis-slice and the test would
 * fail for a reason that has nothing to do with the invariant.
 */
function matchDelimiter(src, start) {
  const OPEN = { '{': '}', '(': ')', '[': ']' };
  const open = src[start];
  const close = OPEN[open];
  if (!close) throw new Error(`matchDelimiter: index ${start} is ${JSON.stringify(open)}, not an opener`);

  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '/' && next === '*') { i = src.indexOf('*/', i + 2) + 1; if (i === 0) break; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === c) break;
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error('matchDelimiter: unbalanced — the region does not close');
}

/** The index of `anchor`, asserted to occur EXACTLY once. */
function pin(src, anchor, where) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) {
    throw new Error(
      `extract: anchor ${JSON.stringify(anchor)} matched ${n}x in ${where} (expected exactly 1).\n` +
      'The code moved or was duplicated. Re-pin the anchor — do NOT relax this test, ' +
      'a test that cannot find its subject is asserting nothing.'
    );
  }
  return src.indexOf(anchor);
}

/**
 * The source text of the balanced `{ … }` that begins at the last `{` of
 * `anchor`. `anchor` must end with that brace, e.g. `'const row = {'`.
 */
export function objectLiteralAt(src, anchor, where = 'source') {
  const at = pin(src, anchor, where);
  const brace = at + anchor.length - 1;
  if (src[brace] !== '{') throw new Error(`extract: anchor ${JSON.stringify(anchor)} must end with '{'`);
  return src.slice(brace, matchDelimiter(src, brace) + 1);
}

/**
 * The source text of the expression between `anchor` and the first `;` that is
 * not inside a nested region, string or comment — i.e. the right-hand side of a
 * single statement such as `const priced = isPricedVerdict(verdict);`.
 */
export function expressionAt(src, anchor, where = 'source') {
  const at = pin(src, anchor, where) + anchor.length;
  for (let i = at; i < src.length; i++) {
    const c = src[i], next = src[i + 1];
    if (c === '/' && next === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue; }
    if (c === '/' && next === '*') { i = src.indexOf('*/', i + 2) + 1; if (i === 0) break; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === c) break;
      }
      continue;
    }
    if (c === '{' || c === '(' || c === '[') { i = matchDelimiter(src, i); continue; }
    if (c === ';') return src.slice(at, i).trim();
  }
  throw new Error(`extract: no statement terminator after ${JSON.stringify(anchor)} in ${where}`);
}

/**
 * Compile an extracted region into a callable, with its free identifiers bound
 * as parameters. `params` must name every identifier the region references —
 * an unbound one throws a ReferenceError at call time, which is the correct
 * loud failure rather than a silent `undefined`.
 */
export function compileRegion(params, body, label = 'region') {
  try {
    return new Function(...params, body);
  } catch (e) {
    throw new Error(`extract: ${label} did not parse as JS — ${e.message}\n---\n${body}\n---`);
  }
}
