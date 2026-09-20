// ══════════════════════════════════════════════════════════════════════════════
// ONE SOURCE READER FOR EVERY MUTATION HARNESS  ·  N-3
//
// THE PROPERTY
//   A mutant's `find` string matches the source on every platform and in every
//   checkout, or the harness says why — and never confuses "this checkout has
//   CRLF" with "the code was refactored".
//
// THE FINDING, AND WHY IT IS HERE AND NOT IN THREE PLACES.
// Round 9 diagnosed exactly this defect in tests/mutations/run.mjs: a CRLF
// working tree against LF `find` strings made every multi-line mutant match
// zero times, and the harness reported "the guard was refactored; re-pin these"
// — a false accusation against correct mutants and correct code. The fix was
// applied to run.mjs, `.gitattributes` was added, and the OTHER TWO HARNESSES
// WERE LEFT READING RAW.
//
//   tests/mutations/run.mjs            normalised at the source read   ✅
//   tests/mutations/ui-run.mjs         raw                             ❌ 27 MALFORMED
//   tests/mutations/sanitizer-run.mjs  raw                             ❌ green by accident
//
// sanitizer-run.mjs passed only because its two targets happen to be LF on
// disk. That is an accident of file history, not a property, and it would have
// broken the first time anyone touched those files from an editor that writes
// CRLF. `.gitattributes` did not save it either: the attribute was added
// WITHOUT renormalising the working tree, so `git ls-files --eol` read
// `i/lf w/crlf attr/text eol=lf` — the index LF, the attribute LF, the file on
// disk CRLF.
//
// That is the tenth instance of this project's recurring pattern: a rule stated
// in general terms and applied to one of the places it names. So the reader is
// a module with one implementation and three callers, and the EOL policy is
// enforced by a test rather than by remembering to renormalise.
//
// NORMALISATION IS FOR MATCHING ONLY. The mutant is written from the normalised
// text, to a mutant PATH beside the original; no harness writes back over a
// real source file, so no checkout's line endings are changed by running one.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/** CRLF and lone CR both collapse to LF. Idempotent. */
export function normalizeEol(text) {
  return text.split(CR + LF).join(LF).split(CR).join(LF);
}

/** Read a source file for mutation matching, line endings normalised to LF. */
export function readSource(path) {
  return normalizeEol(readFileSync(path, 'utf8'));
}
