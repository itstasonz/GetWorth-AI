// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — PRODUCT CONFIGURATION
//
// THE SAME MODEL IS NOT THE SAME SELLABLE OBJECT. The live probe for the
// production witness returned "Ninja Detect Power Blender Duo Pro … TB301 -
// BASE ONLY" on an international marketplace: the right brand, the right
// name, the right number, and a motor base with no jug. Matched on identity
// alone it is an EXACT used listing, and it is worth a fraction of the thing
// photographed. A charging case is not the earbuds; a controller is not the
// console; an empty bottle is not the perfume; a box is not the shoes.
//
// So every listing, and the photograph itself, is given a CONFIGURATION, and
// only a complete object (or one whose text says nothing either way) may price
// a complete object. The rest are kept: they still corroborate what the product
// is called, and the diagnostics count them.
//
// The vocabulary is the market's, in both of its languages, and names no
// product. "<accessory noun> only" is read generically off the accessory
// vocabulary the evidence gate already uses, so a noun added there is
// understood here the same day.
// ══════════════════════════════════════════════════════════════════════════════
import { ACCESSORY_NOUNS } from '../pricing-authority.js';

export const CONFIGURATION = Object.freeze({
  COMPLETE: 'COMPLETE',
  BASE_ONLY: 'BASE_ONLY',
  ACCESSORY_ONLY: 'ACCESSORY_ONLY',
  BOX_ONLY: 'BOX_ONLY',
  REPLACEMENT_PART: 'REPLACEMENT_PART',
  BUNDLE: 'BUNDLE',
  PARTS: 'PARTS',
  UNKNOWN: 'UNKNOWN',
});
export const CONFIGURATIONS = Object.freeze(Object.values(CONFIGURATION));
/** The configurations a listing may price a complete object from. */
export const PRICEABLE_CONFIGURATIONS = Object.freeze(new Set([CONFIGURATION.COMPLETE, CONFIGURATION.UNKNOWN]));

// Nouns that name a part of a product rather than an accessory to it; "only"
// beside one of these means the main unit without its parts.
const UNIT_NOUNS = ['base', 'motor base', 'motor unit', 'motor', 'unit', 'main unit', 'body', 'head unit', 'tool only', 'bare tool'];
// Accessories the shared vocabulary does not list but a listing sells alone.
const EXTRA_ACCESSORY_NOUNS = ['jug', 'pitcher', 'cup', 'cups', 'lid', 'remote', 'controller', 'bottle', 'earbud', 'earbuds',
  'pod', 'pods', 'tip', 'tips', 'pad', 'pads', 'manual', 'קנקן', 'כוס', 'כוסות', 'מכסה', 'שלט', 'בקר', 'בקבוק', 'אוזניה', 'תיק', 'נרתיק'];
const ACCESSORY_WORDS = [...new Set([...ACCESSORY_NOUNS, ...EXTRA_ACCESSORY_NOUNS])];
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words) => words.map(esc).join('|');

// ORDERED. The first rule that matches decides; a listing that says both
// "complete" and "for parts" is for parts.
const RULES = [
  [CONFIGURATION.PARTS, new RegExp(`\\b(for parts|not working|parts only|spares? or repairs?|faulty|broken)\\b|לחלקים|לא עובד|לא עובדת|תקול|תקולה|שבור|שבורה`, 'iu')],
  [CONFIGURATION.BOX_ONLY, new RegExp(`\\b(box only|empty box|empty bottle|bottle only|packaging only|just the box)\\b|קופסה בלבד|אריזה בלבד|מארז בלבד|בקבוק ריק|קופסה ריקה`, 'iu')],
  [CONFIGURATION.BASE_ONLY, new RegExp(`\\b(?:${alt(UNIT_NOUNS)}) only\\b|\\bwithout (?:jug|pitcher|cups?|blades?|accessories|attachments|controller|remote|charger|cable|box)\\b|\\bno (?:jug|pitcher|cups?|blades?|accessories|attachments)\\b|בסיס בלבד|מנוע בלבד|יחידה בלבד|ללא קנקן|ללא כוסות|ללא אביזרים|ללא שלט|ללא להבים`, 'iu')],
  [CONFIGURATION.ACCESSORY_ONLY, new RegExp(`\\b(?:${alt(ACCESSORY_WORDS.filter((w) => /^[a-z ]+$/i.test(w)))})s? only\\b|(?:${alt(ACCESSORY_WORDS.filter((w) => !/^[a-z ]+$/i.test(w)))}) בלבד`, 'iu')],
  [CONFIGURATION.REPLACEMENT_PART, new RegExp(`\\b(replacement|spare parts?|genuine parts?|compatible with|for use with|fits (?:the|all|most|your))\\b|חלק חילוף|חלקי חילוף|מתאים ל|תואם ל`, 'iu')],
  [CONFIGURATION.BUNDLE, new RegExp(`\\b(bundle|lot of \\d+|set of [2-9]\\d*|[2-9] units|two units|x[2-9]\\b)|מארז של [2-9]|סט של [2-9]|[2-9] יחידות`, 'iu')],
  [CONFIGURATION.COMPLETE, new RegExp(`\\b(complete set|full set|complete system|complete kit|full kit|with all accessories|all accessories included)\\b|סט מלא|מערכת מלאה|ערכה מלאה|כולל כל האביזרים|עם כל האביזרים`, 'iu')],
];

/**
 * The configuration a text describes, and the words that decided it.
 *
 * Read off the words alone, with no knowledge of the subject: what a listing
 * says it is selling. Total: any input yields a configuration; silence is
 * UNKNOWN, never COMPLETE.
 */
export function classifyConfiguration(text) {
  const s = String(text ?? '').normalize('NFKC');
  for (const [configuration, re] of RULES) {
    const m = re.exec(s);
    if (!m) continue;
    return { configuration, marker: m[0].trim().slice(0, 40) };
  }
  return { configuration: CONFIGURATION.UNKNOWN, marker: null };
}

/**
 * May a listing of this configuration price a subject of that one?
 *
 *   a complete (or unspecified) subject    only a complete or unspecified listing
 *   an accessory subject (a case, a strap)  a listing that says "case only", or one
 *                                           that says nothing — the evidence gate
 *                                           then requires the accessory's own noun
 *   a base, a box, a part, a bundle         only a listing of the same kind
 */
export function configurationCompatible(listing, subject = CONFIGURATION.UNKNOWN) {
  const l = CONFIGURATIONS.includes(listing) ? listing : CONFIGURATION.UNKNOWN;
  const s = CONFIGURATIONS.includes(subject) ? subject : CONFIGURATION.UNKNOWN;
  if (PRICEABLE_CONFIGURATIONS.has(s)) return PRICEABLE_CONFIGURATIONS.has(l);
  if (s === CONFIGURATION.ACCESSORY_ONLY) return l === CONFIGURATION.ACCESSORY_ONLY || l === CONFIGURATION.UNKNOWN;
  return l === s;
}
