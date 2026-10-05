// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE GENERALISATION MATRIX
//
// Thirteen kinds of scan (A–M), so that what was learned from one blender is
// tested as a rule about products and not as a rule about that blender.
//
// A is REAL: the one paid search of the production witness, as the API returned
// it (ninja-witness-search.raw.json; one shop e-mail address redacted). Every
// other result here is SYNTHETIC — invented shops, boards, sellers and URLs, in
// the shapes real results have.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';

const f = (value, confidence = 0, evidence = 'NONE') => ({ value, confidence, evidence });
const answer = (o) => ({
  category: 'Other', object_class: null, local_name: null, visible_text: [],
  brand: f(null), model: f(null), variant: f(null), ranked_candidates: [],
  condition: { grade: 'Good', observations: [] }, identity_evidence: [], missing_evidence: 'NONE',
  market_hypotheses: { aliases: [], model_numbers: [] },
  ...o,
});
const result = (url, title, snippet = '') => ({ type: 'text_result', url, title, snippet: `citeturn0search0 [wordlim: 200] Crawled: today; ${snippet}` });
const used = (site, id, title, snippet = '') => result(`https://www.${site}.co.il/ad/${id}`, title, snippet);
const shop = (site, slug, title, snippet = '') => result(`https://www.${site}.co.il/p/${slug}`, title, snippet);

// ── A. THE WITNESS ──────────────────────────────────────────────────────────
export const NINJA_WITNESS = JSON.parse(readFileSync(new URL('./ninja-witness-search.raw.json', import.meta.url), 'utf8'));
/** What the identity call read, with the market names a model would propose. */
export const NINJA = answer({
  category: 'Home', object_class: 'blender', local_name: 'בלנדר',
  visible_text: ['NINJA', 'BLENDSENSE', 'POWER BLENDER DUO PRO'],
  brand: f('Ninja', 1, 'TEXT_READ'), model: f('Power Blender Duo Pro', 0.98, 'TEXT_READ'),
  identity_evidence: ['BRAND_TEXT_READ', 'MODEL_TEXT_READ'],
  market_hypotheses: { aliases: ['Ninja Detect Duo', 'Ninja Detect'], model_numbers: ['TB301', 'TB300'] },
});

// Two independent shops that print the name read off the item beside the model
// number it is sold under: what corroborates an alias.
const CONNECTS_TB301 = [
  result('https://www.makerone.com/products/tb301', 'Ninja Detect Duo Power Blender Duo Pro TB301 | Official', 'The Ninja Power Blender Duo Pro with BlendSense. Model TB301.'),
  result('https://www.reviewtwo.com/ninja-tb301', 'Ninja TB301 Power Blender Duo Pro specifications', 'Ninja Power Blender Duo Pro TB301 1200W'),
];

// ── B. A PHONE: MODEL AND STORAGE READ OFF THE SETTINGS SCREEN ──────────────
export const IPHONE = answer({
  category: 'Electronics', object_class: 'smartphone', local_name: 'טלפון',
  visible_text: ['iPhone 13', '128GB'],
  brand: f('Apple', 0.98, 'LOGO'), model: f('iPhone 13', 0.97, 'TEXT_READ'), variant: f('128GB', 0.95, 'TEXT_READ'),
  identity_evidence: ['MODEL_TEXT_READ'],
});
export const RESULTS_IPHONE = [
  used('boardone', 11, 'Apple iPhone 13 128GB למכירה בתל אביב 1,900 ש"ח | לוח יד שניה'),
  used('boardtwo', 12, 'Apple iPhone 13 128GB למכירה בחיפה 2,000 שח | לוח יד שנייה'),
  used('boardthree', 13, 'Apple iPhone 13 128GB למכירה 1,850 ₪ | יד 2'),
  // Another storage, and another model of the line. Neither is this phone.
  used('boardone', 14, 'Apple iPhone 13 256GB למכירה 2,400 ש"ח | לוח יד שניה'),
  used('boardtwo', 15, 'Apple iPhone 13 Pro 128GB למכירה 2,900 שח | לוח יד שנייה'),
];

// ── E. A PERFUME: THE NAME IS ON THE BOTTLE ─────────────────────────────────
export const PERFUME = answer({
  category: 'Beauty', object_class: 'perfume', local_name: 'בושם',
  visible_text: ['Dior', 'SAUVAGE', 'EAU DE PARFUM'],
  brand: f('Dior', 0.97, 'TEXT_READ'), model: f('Sauvage Eau de Parfum', 0.95, 'TEXT_READ'),
  identity_evidence: ['BRAND_TEXT_READ', 'MODEL_TEXT_READ'],
});
export const RESULTS_PERFUME = [
  used('boardone', 21, 'Dior Sauvage Eau de Parfum למכירה 280 ש"ח | לוח יד שניה', 'כמעט מלא'),
  shop('perfumeone', 'sauvage-edp', 'Dior Sauvage Eau de Parfum | פרפיום וואן', 'מחיר: 420 ₪ משלוח חינם'),
  shop('perfumetwo', 'dior-sauvage-edp', 'Dior Sauvage Eau de Parfum | פרפיום טו', 'מחיר 460 ₪ ... משלוח עד הבית בעלות של ₪25'),
];

// ── F. SHOES: THE FAMILY IS OBVIOUS, THE EXACT SHOE IS NOT ──────────────────
export const JORDAN = answer({
  category: 'Clothing', object_class: 'sneakers', local_name: 'נעלי ספורט',
  visible_text: ['AIR JORDAN'],
  brand: f('Nike', 0.95, 'LOGO'), model: f('Air Jordan 1', 0.85, 'SHAPE'),
  identity_evidence: ['LOGO', 'SHAPE_ONLY'],
});
export const RESULTS_JORDAN = [
  used('boardone', 31, 'Nike Air Jordan 1 למכירה מידה 43 450 ש"ח | לוח יד שניה'),
  used('boardtwo', 32, 'Nike Air Jordan 4 למכירה מידה 42 900 שח | לוח יד שנייה'),
  used('boardthree', 33, 'Nike Air Force 1 למכירה 250 ₪ | יד 2'),
];

// ── G / H. HOW MANY LISTINGS, FROM HOW MANY PLACES ──────────────────────────
export const CONSOLE = answer({
  category: 'Electronics', object_class: 'game console', local_name: 'קונסולת משחקים',
  visible_text: ['SONY'], brand: f('Sony', 0.97, 'TEXT_READ'), model: f('PlayStation 5', 0.95, 'SHAPE'),
  identity_evidence: ['BRAND_TEXT_READ', 'LOGO'],
});
export const RESULTS_ONE_LISTING = [used('boardone', 41, 'Sony PlayStation 5 למכירה בתל אביב 1,800 ש"ח | לוח יד שניה')];
export const RESULTS_THREE_FROM_TWO = [
  used('boardone', 42, 'Sony PlayStation 5 למכירה בתל אביב 1,800 ש"ח | לוח יד שניה'),
  used('boardone', 43, 'Sony PlayStation 5 למכירה בחולון 1,750 ש"ח | לוח יד שניה'),
  used('boardtwo', 44, 'Sony PlayStation 5 למכירה בחיפה 1,700 שח | לוח יד שנייה'),
];

// ── I. RETAIL ONLY, FROM TWO SHOPS ──────────────────────────────────────────
export const RESULTS_RETAIL_TWO_SHOPS = [
  shop('shopone', 'ninja-duo-pro', 'Ninja Power Blender Duo Pro | שופ וואן', 'מחיר: 569 ₪ במלאי'),
  shop('shoptwo', 'ninja-power-blender', 'בלנדר Ninja Power Blender Duo Pro | שופ טו', '599 ₪ משלוח חינם עד 5 ימי עסקים'),
  // The same shop again, on another page: one source, not two.
  shop('shoptwo', 'ninja-power-blender-black', 'בלנדר Ninja Power Blender Duo Pro שחור | שופ טו', 'מחיר 610 ₪'),
];

// ── J. ONLY A SIBLING IS SOLD HERE ──────────────────────────────────────────
export const RESULTS_SIBLING_RETAIL = [
  ...CONNECTS_TB301,
  shop('shopone', 'ninja-tb303', 'Ninja Detect TB303 בלנדר | שופ וואן', 'מחיר: 418 ₪ במלאי'),
  shop('shoptwo', 'tb303', 'בלנדר Ninja TB303 | שופ טו', 'מחיר 389 ₪'),
];

// ── K. A CATEGORY PAGE WITH MANY PRICES ─────────────────────────────────────
export const RESULTS_CATEGORY = [
  result('https://www.shopone.co.il/c/blenders', 'בלנדרים Ninja | שופ וואן',
    'Ninja Power Blender Duo Pro במלאי 599 ₪ ... Ninja Foodi Blender 799 ₪ ... Ninja Blast 249 ₪ ... משלוח בעלות של ₪29'),
  result('https://www.shoptwo.co.il/search?q=ninja', 'Ninja Power Blender Duo Pro - תוצאות חיפוש | שופ טו', '569 ₪ ... 799 ₪ ... 1,299 ₪'),
];

// ── L. ONE PRODUCT'S PAGE: A PRICE AND EVERYTHING THAT IS NOT THE PRICE ─────
export const RESULTS_PRICE_AND_FEES = [
  shop('shopone', 'ninja-duo-pro', 'Ninja Power Blender Duo Pro | שופ וואן',
    '* משלוח אקספרס בעלות של ₪55 ... * משלוח לנקודת איסוף בעלות של ₪9 ... * משלוח רגיל לבית בעלות של ₪29 ... מחיר כולל משלוח לנקודת איסוף: 608 ₪ ... 12 תשלומים של 51 ₪ לחודש ... במקום 799 ₪ ... הנחה של 100 ₪ ... בנוסף כוס נשיאה ב-49 ₪'),
];

// ── M. A NAME NOTHING CORROBORATES ──────────────────────────────────────────
export const NINJA_UNVERIFIED = answer({
  ...NINJA, market_hypotheses: { aliases: ['Ninja Blend Master'], model_numbers: ['ZX900'] },
});
export const RESULTS_UNVERIFIED_ALIAS = [
  used('boardone', 51, 'Ninja ZX900 למכירה בתל אביב 300 ש"ח | לוח יד שניה'),
  used('boardtwo', 52, 'Ninja Blend Master למכירה 320 שח | לוח יד שנייה'),
  shop('shopone', 'zx900', 'Ninja ZX900 בלנדר | שופ וואן', 'מחיר: 450 ₪'),
];
/** The same listings, once two sites have connected the number to the name read off the item. */
export const RESULTS_VERIFIED_ALIAS = [
  ...CONNECTS_TB301,
  used('boardone', 61, 'Ninja TB301 למכירה בתל אביב 350 ש"ח | לוח יד שניה'),
  // The sibling, second-hand: a real listing, for another product.
  used('boardtwo', 62, 'Ninja TB303 למכירה בחיפה 250 שח | לוח יד שנייה'),
  shop('shopone', 'tb303', 'בלנדר Ninja TB303 | שופ וואן', 'מחיר 389 ₪'),
];

// ── FOREIGN MONEY ───────────────────────────────────────────────────────────
export const RESULTS_FOREIGN = [
  result('https://www.shopabroad.com/products/ninja-duo-pro', 'Ninja Power Blender Duo Pro | Shop Abroad', 'Price: $179.99 In stock'),
  result('https://www.boardabroad.com/listing/7', 'Ninja Power Blender Duo Pro for sale - 90 USD | Used', 'Used, works'),
];

export { result, used, shop, CONNECTS_TB301 };

// ── N. THE RIGHT NAME ON THE WRONG OBJECT ───────────────────────────────────
// A base without its jug, a cup, a box: each carries the exact product's name
// and number. One complete set and one shop selling the base alone.
export const RESULTS_WRONG_CONFIGURATION = [
  ...CONNECTS_TB301,
  used('boardone', 71, 'Ninja TB301 Power Blender Duo Pro base only למכירה 150 ש"ח | לוח יד שניה', 'מנוע בלבד ללא קנקן'),
  used('boardtwo', 72, 'Ninja TB301 כוס בלבד למכירה 40 ש"ח | לוח יד שנייה'),
  used('boardthree', 73, 'Ninja TB301 Power Blender Duo Pro קופסה בלבד למכירה 20 ₪ | יד 2'),
  used('boardone', 74, 'Ninja TB301 Power Blender Duo Pro complete set למכירה 350 ש"ח | לוח יד שניה'),
  shop('shopone', 'tb301-base', 'Ninja TB301 Motor Base Only | שופ וואן', 'מחיר: 299 ₪ במלאי'),
];

// ── O. THE SUBJECT IS THE ACCESSORY ─────────────────────────────────────────
export const AIRPODS_CASE = answer({
  category: 'Electronics', object_class: 'charging case', local_name: 'נרתיק טעינה',
  visible_text: ['AirPods Pro 2'],
  brand: f('Apple', 0.95, 'LOGO'), model: f('AirPods Pro 2', 0.9, 'TEXT_READ'),
  identity_evidence: ['LOGO', 'MODEL_TEXT_READ'], configuration: 'ACCESSORY_ONLY',
});
export const RESULTS_AIRPODS_CASE = [
  used('boardone', 81, 'Apple AirPods Pro 2 למכירה 450 ש"ח | לוח יד שניה', 'כמו חדשות'),
  used('boardtwo', 82, 'Apple AirPods Pro 2 charging case only למכירה 150 ש"ח | לוח יד שנייה'),
  used('boardthree', 83, 'Apple AirPods Pro 2 נרתיק טעינה למכירה 140 ₪ | יד 2'),
  shop('shopone', 'airpods-pro-2-case', 'Apple AirPods Pro 2 MagSafe charging case | שופ וואן', 'מחיר: 390 ₪ במלאי'),
  shop('shoptwo', 'airpods-pro-2', 'Apple AirPods Pro 2 | שופ טו', 'מחיר: 899 ₪ במלאי'),
];

// ── P. ANOTHER PRODUCT'S NUMBER, WITH THE ONE DISTINCTIVE WORD ──────────────
export const RESULTS_OTHER_PRODUCT = [
  ...CONNECTS_TB301,
  used('boardone', 91, 'Ninja CB103 Power Nutri Duo למכירה 346 ש"ח | לוח יד שניה'),
  used('boardtwo', 92, 'Ninja TB301 Power Blender Duo Pro למכירה 380 ש"ח | לוח יד שנייה'),
];

// ── Q. A MARKETPLACE ABROAD, SHOWING A CONVERTED PRICE ──────────────────────
export const RESULTS_ABROAD = [
  ...CONNECTS_TB301,
  result('https://il.ebay.com/itm/123456789', 'Ninja TB301 Power Blender Duo Pro | eBay', '* Ninja TB301 Power Blender Duo Pro - Black ... ILS 622.13 Used'),
  result('https://www.craigslist.org/pasadena/1', 'Ninja Detect Duo Power Blender Pro TB301 - Complete Set - $50 (Pasadena) - by owner - sale', 'good used condition'),
  result('https://www.ebay.com/itm/987654321', 'Ninja Detect Power Blender Duo Pro with BlendSense - TB301 - BASE ONLY | eBay', 'US $45.00 Used'),
  // The converted price in the title, and a shop abroad quoting shekels: both still abroad.
  result('https://il.ebay.com/itm/2', 'Ninja TB301 Power Blender Duo Pro למכירה ILS 622 Used | eBay', 'works, light wear'),
  result('https://www.shopabroad.com/p/tb301', 'Ninja TB301 Power Blender Duo Pro | Shop Abroad', 'מחיר: 620 ₪ add to cart ships from abroad'),
];

// ── R. A SHOP'S CATEGORY ROWS, IN THE MARKET'S OWN PRICE FORM ───────────────
export const RESULTS_LOCALE_ROWS = [
  ...CONNECTS_TB301,
  result('https://www.shopone.co.il/c/ninja', 'NINJA | מוצרי חשמל למטבח | שופ וואן',
    'החל מ- 550 550   NINJA בלנדר שייקר Ninja TB303 DETECT (2) משלוח חינם הוספה לסל החל מ- 569 569   NINJA בלנדר ושייקר TB301 משלוח חינם נמכר ע״י מ.   החל מ- 448 448 799 799 בתוקף עד 30.09.2026 NINJA בלנדר Ninja TB301 Detect Duo Pro הוספה לסל'),
  result('https://www.shopabroad.com/c/ninja', 'Ninja blenders | Shop Abroad', 'from 299 299 Ninja TB301 Power Blender Duo Pro add to cart'),
  result('https://www.forumone.co.il/forums/blenders', 'דיון על בלנדרים | פורום', 'קניתי Ninja TB301 ב 569 569 וזה מעולה'),
];
