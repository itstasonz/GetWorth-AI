// ══════════════════════════════════════════════════════════════════════════════
// CANONICAL CATEGORY BOUNDARY  ·  api/_lib/category.js
//
// HIGH-3. A model may SUGGEST a category. It may not INVENT one.
//
// THE FINDING
// `final_category` was `{ type: 'string' }` with no enum, and it reached the
// client verbatim. The Ninja scan displayed "Footwear" for a blender. Worse, the
// taxonomy existed in FOUR places that disagreed:
//
//   api/_lib/openai-recognition-contract.js  16 values, enforced as a JSON enum
//   api/analyze.js Stage-1 prompt            14 values, in PROSE, enforced by
//                                            nothing — Bags and Jewelry missing
//   api/_lib/valuation-guard.js              substring matchers over the raw
//                                            string, which decide the PRICE
//   src/contexts/AppContext.jsx              14 values including "Music", which
//                                            is in no server list at all
//
// So one engine was constrained by a schema, the other by a sentence; the price
// was chosen by `String.includes`; and the client relabelled the result against
// a fifth list. A category could be trusted by one of those and unknown to the
// next, with nothing comparing them.
//
// THE RULE
//   canonical name   → accepted unchanged
//   known alias      → mapped, deterministically, in ONE table
//   anything else    → 'Other', which owns no pricing bucket
//
// WHY THE ALIASES ARE WRITTEN AS THE MATCHERS THEY MIRROR
// The alias table is not a fresh invention. Each pattern below is the same test
// `resolveEnvelopeKeyFrom` already applies to `recognition.category` when it
// chooses an envelope — `cat.includes('electron')`, `cat.includes('furni')`,
// and so on. Canonicalising through the SAME predicates means normalisation
// cannot disagree with pricing: any string that used to select a bucket still
// selects it, and any string that selected none still selects none. A table
// invented independently would have been a second taxonomy, which is the defect.
//
// `category_raw` is kept beside the canonical value as EVIDENCE. It is never a
// trust input, and it is never displayed.
// ══════════════════════════════════════════════════════════════════════════════

export const CANONICAL_CATEGORIES = Object.freeze([
  'Electronics', 'Furniture', 'Vehicles', 'Watches', 'Clothing', 'Sports',
  'Smoking', 'Home', 'Beauty', 'Books', 'Toys', 'Tools', 'Food',
  'Bags', 'Jewelry',
  'Other',
]);

const CANONICAL_SET = new Set(CANONICAL_CATEGORIES);

// The literal vocabulary this table matches on, exported so the narrow-only
// property can generate its corpus from the table rather than from memory.
// Deriving it here, from ALIASES itself, means a word added below cannot be
// left untested by forgetting to add it somewhere else too.
export function aliasVocabulary() {
  const words = new Set();
  const BACKSLASH = String.fromCharCode(92);
  for (const [pattern] of ALIASES) {
    for (const alt of pattern.source.split('|')) {
      // Strip regex syntax to the bare word: `\bcars?\b` -> `cars`, and also
      // emit the singular so `car` is exercised as well as `cars`.
      const bare = alt.split(BACKSLASH + 'b').join('').replace(/[()^$]/g, '');
      const withOptional = bare.replace(/\?/g, '');
      if (withOptional) words.add(withOptional);
      const withoutOptional = bare.replace(/(.)\?/g, '');
      if (withoutOptional && withoutOptional !== withOptional) words.add(withoutOptional);
    }
  }
  return [...words];
}

// The unknown bucket. It is a real canonical value — an item IS sometimes
// "Other" — but it owns no envelope, so it can never become a pricing bucket.
export const UNKNOWN_CATEGORY = 'Other';

// ORDERED. First match wins, exactly as in resolveEnvelopeKeyFrom, because the
// order is itself load-bearing: 'gaming' must not fall into Toys via 'game',
// and 'kitchen' must reach Home before anything else claims it.
// AN ALIAS IS ANOTHER NAME FOR A CATEGORY. IT IS NOT A PRODUCT NOUN.
//
// The first draft aliased 'footwear' to Clothing and 'appliance' to Home, and
// both are wrong in the way this finding is about. "Footwear" and "Luxury
// Gaming Appliance" are the reviewer's own witnesses for a model inventing a
// taxonomy, and mapping them WIDENS trust: "Footwear" owned no envelope before
// and would have acquired the Clothing one. Unknown must narrow, never expand —
// the same rule the global-envelope inversion established for identity.
//
// So each pattern below names a CATEGORY as a person would write it, and every
// one of them is a predicate `resolveEnvelopeKeyFrom` already applies to
// `recognition.category`. Nothing here selects a bucket that the raw string did
// not already select, and nothing here refuses one it did — verified as a
// property, not by inspection, in tests/category-boundary.test.mjs.
//
// FOUR ALIASES WERE REMOVED BY THAT PROPERTY, not by review: 'backpack',
// 'automotive', 'kitchen' and 'gadget'. None of those strings selects an
// envelope today — the guard matches `cat.includes('bag')`, `'motor'`, `'home'`
// and `'electron'`, and none of the four words contains its match — so mapping
// them would have HANDED each an envelope it did not have. More correct,
// probably. Still a pricing change, and a pricing change does not belong inside
// a normalisation boundary. Each remains reachable through a string that names
// the category outright ('Home & Kitchen' → Home).
//
// 'gadget' was found by an INDEPENDENT REVIEWER, not by the property — because
// the corpus the property ran against was HAND-LISTED, and a hand-listed corpus
// contains only the words somebody thought of. That is the same shape as every
// other finding in this work: the artefact claimed a guarantee its inputs could
// not deliver. The corpus is generated now, from `aliasVocabulary()` above
// crossed with the envelope matchers' own substrings read out of
// api/_lib/valuation-guard.js, so an alias added below is tested by the very
// words it introduces.
const ALIASES = [
  [/electron/, 'Electronics'],
  [/furni|sofa|chair|table/, 'Furniture'],
  [/vehicle|\bcars?\b|motor/, 'Vehicles'],
  [/watch/, 'Watches'],
  [/cloth|fashion|apparel/, 'Clothing'],
  [/sport|fitness|outdoor/, 'Sports'],
  [/smoking|tobacco|vape/, 'Smoking'],
  [/home|household/, 'Home'],
  [/beauty|cosmetic/, 'Beauty'],
  [/book/, 'Books'],
  [/toy|\bgames?\b/, 'Toys'],
  [/tool|hardware/, 'Tools'],
  [/food|beverage/, 'Food'],
  [/bag/, 'Bags'],
  [/jewel/, 'Jewelry'],
];

/**
 * Normalise one category string to the canonical taxonomy.
 *
 * TOTAL. Every input produces a canonical value; nothing throws, and nothing
 * passes through. `basis` records HOW the value was reached so a refusal, a
 * mapping and an accepted name are distinguishable after the fact — a displayed
 * category that was guessed should be auditable as guessed.
 *
 *   'canonical' — the model returned a registered name
 *   'alias'     — mapped deterministically from a recognised variant
 *   'unknown'   — free-form; became Other, and owns no pricing bucket
 *   'absent'    — nothing was supplied at all
 */
export function canonicalCategory(raw) {
  // Total coercion, same contract as boundaryText: decide on typeof first, and
  // never let an object reach an implicit conversion.
  const t = typeof raw;
  const text = t === 'string' ? raw : '';
  const trimmed = text.trim();
  if (!trimmed) return { category: UNKNOWN_CATEGORY, basis: 'absent', raw: '' };

  if (CANONICAL_SET.has(trimmed)) return { category: trimmed, basis: 'canonical', raw: trimmed };

  // Case-insensitive exact match before alias matching: 'electronics' is the
  // canonical name in different clothes, not an alias.
  const lower = trimmed.toLowerCase();
  for (const c of CANONICAL_CATEGORIES) {
    if (c.toLowerCase() === lower) return { category: c, basis: 'canonical', raw: trimmed };
  }

  for (const [pattern, canonical] of ALIASES) {
    if (pattern.test(lower)) return { category: canonical, basis: 'alias', raw: trimmed };
  }

  return { category: UNKNOWN_CATEGORY, basis: 'unknown', raw: trimmed };
}

/** The canonical name alone, for call sites that do not need the basis. */
export function canonicalCategoryName(raw) {
  return canonicalCategory(raw).category;
}

// `envelopeAgreesWithCategory` USED TO LIVE HERE, AND ITS DELETION IS THE POINT.
//
// It was written to detect a displayed category disagreeing with the priced
// envelope. It was imported by api/analyze.js and NEVER CALLED — `grep -c`
// returned 1, the import line — while the same commit introduced exactly the
// disagreement it was written to catch. A detector that ships dead beside its
// own defect is the fourth "rule with no reachable input" in this work, and
// keeping it would preserve the appearance of a control without the control.
//
// It comes back when something calls it. The finding it was meant to close is
// recorded as open in docs/GW-OPENAI-INTELLIGENCE-002-PHASE3-REV4.md §4d.
