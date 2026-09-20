// ══════════════════════════════════════════════════════════════════════════════
// A VISION FIXTURE THAT MATCHES WHAT THE PARSER ACTUALLY EMITS
//
// WHY THIS EXISTS
// Round 4 fixed compatibility-text laundering and the fix was INERT in
// production, because every test wrote `visionData` by hand as
//
//   { text: ['Compatible with Rolex'] }          <- one phrase, one entry
//
// and `parseVisionResponse` cannot produce that. Google Vision returns
// `textAnnotations[0]` as the whole block with newlines, and `[1..]` as
// INDIVIDUAL WORDS; the parser maps `[1..]` into the flat `text` array and keeps
// the block in `ocr_context.full_text`. The repo says so in two places. So the
// real array was
//
//   ['Compatible', 'with', 'Rolex']
//
// the compatibility token sat alone in its own entry, was dropped alone, and
// every other word survived as a clean single-word "line". A replacement strap
// established BRAND_TEXT + PRODUCT_TEXT and reached a ₪250,000 ceiling.
//
// An independent reviewer found it by reading the parser. The suite could not,
// because the suite and the parser disagreed about the shape of the data and
// nothing compared them.
//
// So fixtures are built HERE, from a printed block, by the same tokenisation the
// parser performs — and `VISION_FIXTURE_IS_FAITHFUL` in
// tests/round5-properties.test.mjs asserts this helper's output equals
// `parseVisionResponse`'s for the same input. A fixture that cannot drift from
// the parser is the only kind worth writing.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a Vision response as Google actually shapes it.
 *
 * `block` is the text as PRINTED ON THE ITEM, newlines and all — which is what a
 * person writing a test is actually thinking about.
 */
export function visionResponse(block, { labels = [], logos = [], webEntities = [] } = {}) {
  const words = String(block ?? '').split(/\s+/).filter(Boolean);
  return {
    textAnnotations: block
      ? [{ description: block }, ...words.map((w) => ({ description: w }))]
      : [],
    labelAnnotations: labels.map((l) =>
      (typeof l === 'string' ? { description: l, score: 0.95 } : l)),
    logoAnnotations: logos.map((l) =>
      (typeof l === 'string' ? { description: l, score: 0.95 } : l)),
    webDetection: { webEntities: webEntities.map((e) =>
      (typeof e === 'string' ? { description: e, score: 0.9 } : e)) },
  };
}

/**
 * The parsed `visionData` a test should pass to deriveEvidence / the guard.
 *
 * Takes the parser itself, so the fixture is produced by production code rather
 * than by a second implementation of it:
 *
 *   const { parseVisionResponse } = await import('../api/analyze.js');
 *   const vd = visionData(parseVisionResponse, 'ROLEX\nSUBMARINER');
 */
export function visionData(parseVisionResponse, block, opts = {}) {
  return parseVisionResponse(visionResponse(block, opts));
}
