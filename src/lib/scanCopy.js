// ══════════════════════════════════════════════════════════════════════════════
// THE CORE SCAN — WHAT THE SCREEN SAYS
//
// Every sentence the scan screen can show, in both languages, in one place.
// Hebrew is the default language of the app and is written first-hand here,
// not derived from the English. Sentences a person reads on the result are
// plain; how the price was worked out lives under "Why this price?".
// ══════════════════════════════════════════════════════════════════════════════
import { formatPrice } from './utils';

// A price keeps its own left-to-right order inside a Hebrew sentence: ₪290, never 290₪.
const ltr = (s) => `⁦${s}⁩`;
/** ₪240–270: one currency sign for the pair. */
const range = (band) => ltr(band.low === band.high ? formatPrice(band.low) : `${formatPrice(band.low)}–${Number(band.high).toLocaleString()}`);

// Colours as the model may still write them in English, in Hebrew. Brand and
// model names are never translated; a colour is a description, so it is.
const COLORS_HE = {
  black: 'שחור', white: 'לבן', gray: 'אפור', grey: 'אפור', silver: 'כסוף', gold: 'זהב', red: 'אדום', blue: 'כחול', green: 'ירוק',
  yellow: 'צהוב', orange: 'כתום', pink: 'ורוד', purple: 'סגול', brown: 'חום', beige: 'בז׳', navy: 'כחול כהה', cream: 'קרם',
  turquoise: 'טורקיז', bordeaux: 'בורדו', burgundy: 'בורדו', transparent: 'שקוף', clear: 'שקוף', multicolor: 'צבעוני', multicolour: 'צבעוני',
  'rose gold': 'רוז גולד', 'space gray': 'אפור חלל', 'space grey': 'אפור חלל', 'dark gray': 'אפור כהה', 'dark grey': 'אפור כהה',
  'light gray': 'אפור בהיר', 'light grey': 'אפור בהיר', 'dark blue': 'כחול כהה', 'light blue': 'תכלת', 'dark green': 'ירוק כהה',
};
/** A colour in the screen's language. Anything that is not a plain colour name is left exactly as it is. */
export function localColor(color, lang) {
  const text = String(color ?? '').trim();
  if (!text || lang !== 'he') return text;
  return text.split(/\s*(?:\/|,| and | with )\s*/i).map((part) => COLORS_HE[part.trim().toLowerCase()] ?? part.trim()).join(' / ');
}

export const SCAN_COPY = {
  en: {
    close: 'Close',
    analyzing: 'Analyzing photo…',
    lookingAgain: 'Looking again…',
    pricing: 'Checking today\'s market prices…',
    identityConfidence: 'Identity confidence',
    priceConfidence: 'Price confidence',
    levels: { high: 'High', medium: 'Medium', low: 'Low' },
    recommended: 'Recommended listing price',
    expected: 'Expected selling range',
    approxLabel: 'Approximate selling range',
    approxNote: 'The exact model is not confirmed, so this is a range for the product family.',
    thin: (n) => (n === 1 ? 'Rough estimate: based on one second-hand listing.' : `Rough estimate: based on only ${n} second-hand listings.`),
    abroadOnly: 'No Israeli second-hand prices were found; this rests on prices abroad.',
    dispersed: 'The prices found are far apart, so the range is wide.',
    conditionAdjusted: 'The price was adjusted for the condition you chose.',
    range,
    conditionLabel: 'Condition',
    conditions: { new_sealed: 'New / Sealed', like_new: 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' },
    // The five choices side by side on a phone: one or two short words each.
    conditionShort: { new_sealed: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair', poor: 'Poor' },
    appears: (c) => `Visible condition appears ${c}.`,
    sellFor: (price) => `Sell for ${price}`,
    sellAbout: (price) => `Sell for about ${price}`,
    sellOwnPrice: 'Sell at your own price',
    wrongItem: 'Wrong item?',
    whyPrice: 'Why this price?',
    whatFound: 'What I found',
    refine: 'For a more exact price',
    needed: 'One thing before the price',
    needsDetail: (name) => `I can see this is ${name}, but not the exact product. A market price needs that first, so the market was not searched yet.`,
    needsDetailHint: 'Tell me what it is under "Wrong item?", or sell at your own price.',
    notSure: 'Not sure',
    takePhoto: 'Take the photo',
    uploadPhoto: 'Upload a photo',
    insufficient: (name) => `I identified this as ${name}, but I don't have enough reliable current second-hand evidence to give you a confident Israeli market price.`,
    retailContext: (price) => `New, it currently sells for about ${price} in Israel.`,
    retailContextUnavailable: (price) => `New, it was listed at about ${price} in Israel; that shop is currently out of stock.`,
    noItem: 'I couldn\'t find an item to sell in this photo.',
    noItemHint: 'Take a photo with the item filling most of the frame.',
    retry: 'Try again',
    scanAgain: 'Scan another item',
    // "Wrong item?"
    correctTitle: 'What is it?',
    correctHint: 'Tell me in your own words: brand, model, variant.',
    correctPlaceholder: 'Actually this is a Logitech G Pro Wireless',
    correctCouldBe: 'Could it be one of these?',
    correctSubmit: 'Update',
    // "Why this price?"
    whyTitle: 'Why this price?',
    found: (n) => (n === 0 ? 'No second-hand listings were found' : n === 1 ? '1 second-hand listing found' : `${n} second-hand listings found`),
    fromIsrael: (n) => `Israel: ${n}`,
    fromAbroad: (n) => `Abroad: ${n}`,
    relevantRange: 'Price range of these listings',
    newInIsrael: 'New in Israel',
    outOfStock: '(out of stock)',
    unbound: (n) => (n === 1
      ? '1 price was found on a page where it could not be tied to this item for certain, so it was not used.'
      : `${n} prices were found on pages where they could not be tied to this item for certain, so they were not used.`),
    shipping: (amount) => `+ ${amount} shipping`,
    abroadNoShipping: 'Prices from abroad do not include shipping to Israel.',
    confidenceLine: 'Confidence',
    approximateWhy: 'The exact model is not confirmed, so the listings are for the product family.',
    dispersedWhy: 'The listings are far apart in price, so the range is wide and the confidence is low.',
    intlAdjusted: (scale) => `Prices from abroad were scaled to Israeli price level (×${scale}), using the item's new price in both markets.`,
    intlUnadjusted: 'Prices from abroad were converted to shekels but could not be adjusted to Israeli price level, so they count for little.',
    how: 'The price is calculated from these listings, not chosen. Listings from Israel count most, then how exact, how recent and how reliable each one is. Asking prices are lowered by an assumed 10% for negotiation.',
    conditionsHow: 'Prices for other conditions are a standard adjustment from Good condition, not separate market findings.',
    abroadUnused: (n) => `The Israeli listings were enough to price this, so ${n === 1 ? '1 price from abroad was' : `${n} prices from abroad were`} not used.`,
    // Why a found price was not used: one line per reason, so a set-aside price explains itself. `setAside` is for a reason this copy does not know.
    aside: {
      not_comparable: (n) => (n === 1 ? '1 result was a different product or variant, an accessory or a part, so it was not used.' : `${n} results were a different product or variant, an accessory or a part, so they were not used.`),
      above_new_price: (n) => (n === 1 ? '1 price was higher than the item\'s new price, so it is not a second-hand price and was not used.' : `${n} prices were higher than the item's new price, so they are not second-hand prices and were not used.`),
      outlier: (n) => (n === 1 ? '1 price was far out of line with the other listings, so it was not used.' : `${n} prices were far out of line with the other listings, so they were not used.`),
      retail_refurbished_without_private_resale: (n) => (n === 1
        ? '1 refurbished offer from a shop was found. Without a private second-hand listing to support it, it was not used as a used price.'
        : `${n} refurbished offers from shops were found. Without a private second-hand listing to support them, they were not used as used prices.`),
      abroad_without_israeli_reference: (n) => (n === 1
        ? '1 listing from abroad was found. Without an Israeli second-hand listing to compare it with, it is context only: a price abroad does not say what the item sells for in Israel.'
        : `${n} listings from abroad were found. Without an Israeli second-hand listing to compare them with, they are context only: prices abroad do not say what the item sells for in Israel.`),
      israeli_listing_old_or_sealed: (n) => (n === 1
        ? '1 Israeli listing was old or for a sealed unit, so it does not show what a used one sells for today.'
        : `${n} Israeli listings were old or for sealed units, so they do not show what a used one sells for today.`),
      different_model: (n) => (n === 1 ? '1 result was another model of the same brand: a different product, so it was not used.' : `${n} results were other models of the same brand: different products, so they were not used.`),
    },
    // One short reason beside a source that was not used.
    why: {
      above_new_price: 'above the new price',
      outlier: 'far from the other listings',
      different_model: 'another model, not this product',
      not_comparable: 'a different product, accessory or part',
      price_not_tied_to_product: 'price not tied to this item on the page',
      retail_refurbished_without_private_resale: 'a shop\'s refurbished unit, no private listing beside it',
      abroad_without_israeli_reference: 'abroad, no Israeli listing to compare with',
      israeli_listing_old_or_sealed: 'old, or a sealed unit',
      local_evidence_sufficient: 'not needed: the Israeli listings were enough',
    },
    groupUsed: 'Used for the price',
    groupContext: 'Context only, not used for the price',
    groupRejected: 'Not this product, or not usable',
    details: 'How this was worked out',
    // Why there is no price, when there is none.
    noPriceWhy: {
      no_verified_second_hand_reference: 'No second-hand listing for this item could be verified, so there is no price to stand behind.',
      no_verified_israeli_second_hand_reference: 'No current second-hand listing for a used unit of this item was verified in Israel. What was found is shown below as context; none of it says what the item sells for second-hand in Israel.',
      identity_incomplete: 'The exact product was not identified, so the market was not searched: a brand alone brings other products\' prices.',
    },
    retailDisagree: (low, high) => `Shops disagree on the new price: from ${low} to ${high}. The lower price is used as the reference.`,
    olderUsed: (n) => (n === 1 ? '1 of the listings used is old, so it counts for less.' : `${n} of the listings used are old, so they count for less.`),
    refurbishedSupport: (n) => (n === 1 ? 'Also used, with a smaller weight: 1 refurbished offer from a shop, as supporting evidence.' : `Also used, with a smaller weight: ${n} refurbished offers from shops, as supporting evidence.`),
    setAside: (n) => `${n} other ${n === 1 ? 'result was' : 'results were'} set aside.`,
    searchedOn: (date) => `Market searched on ${date}`,
    sources: 'Sources',
    kinds: { used_listing: 'Used', sold: 'Sold', refurbished: 'Refurbished', new_retail: 'New', price_guide: 'Price guide', other: 'Other' },
    matches: { exact: 'exact', close_comparable: 'comparable', sibling_model: 'other model' },
    places: { IL: 'Israel', INTL: 'abroad' },
    // A listing's own age. With no date on the page there is nothing to say, so nothing is said.
    freshness: { current: 'current', recent: 'recent', older: 'older', archived: 'old listing' },
    approx: (price) => `≈ ${price}`,
    noSources: 'No usable price sources were found.',
  },
  he: {
    close: 'סגירה',
    analyzing: 'מנתחים את התמונה…',
    lookingAgain: 'בודקים שוב…',
    pricing: 'בודקים מחירי שוק עדכניים…',
    identityConfidence: 'ביטחון בזיהוי',
    priceConfidence: 'ביטחון במחיר',
    levels: { high: 'גבוה', medium: 'בינוני', low: 'נמוך' },
    recommended: 'מחיר מומלץ לפרסום',
    expected: 'טווח מכירה צפוי',
    approxLabel: 'טווח מכירה משוער',
    approxNote: 'הדגם המדויק לא אומת, ולכן זהו טווח למשפחת המוצר.',
    thin: (n) => (n === 1 ? 'הערכה גסה: מבוססת על מודעת יד שנייה אחת.' : `הערכה גסה: מבוססת על ${n} מודעות יד שנייה בלבד.`),
    abroadOnly: 'לא נמצאו מחירי יד שנייה בישראל; ההערכה נשענת על מחירים בחו״ל.',
    dispersed: 'המחירים שנמצאו רחוקים זה מזה, ולכן הטווח רחב.',
    conditionAdjusted: 'המחיר הותאם למצב הפריט שבחרת.',
    range,
    conditionLabel: 'מצב הפריט',
    conditions: { new_sealed: 'חדש / באריזה', like_new: 'כמו חדש', good: 'טוב', fair: 'סביר', poor: 'גרוע' },
    conditionShort: { new_sealed: 'חדש', like_new: 'כמו חדש', good: 'טוב', fair: 'סביר', poor: 'גרוע' },
    appears: (c) => `לפי התמונה, המצב נראה ${c}.`,
    sellFor: (price) => `למכור ב־${ltr(price)}`,
    sellAbout: (price) => `למכור בכ־${ltr(price)}`,
    sellOwnPrice: 'למכור במחיר שלי',
    wrongItem: 'פריט שגוי?',
    whyPrice: 'למה המחיר הזה?',
    whatFound: 'מה מצאתי',
    refine: 'למחיר מדויק יותר',
    needed: 'דבר אחד לפני המחיר',
    needsDetail: (name) => `זיהיתי שזה ${name}, אבל לא את המוצר המדויק. מחיר שוק צריך אותו קודם, ולכן השוק עוד לא נבדק.`,
    needsDetailHint: 'אפשר לכתוב מה זה תחת "פריט שגוי?", או למכור במחיר שלכם.',
    notSure: 'לא בטוח/ה',
    takePhoto: 'לצלם',
    uploadPhoto: 'להעלות תמונה',
    insufficient: (name) => `זיהיתי את הפריט כ־${name}, אבל אין לי מספיק ראיות אמינות ועדכניות ממכירות יד שנייה כדי לתת מחיר שוק בטוח בישראל.`,
    retailContext: (price) => `חדש, הוא נמכר היום בישראל בכ־${ltr(price)}.`,
    retailContextUnavailable: (price) => `חדש, הוא הוצע בישראל בכ־${ltr(price)}; בחנות הזו הוא כרגע לא במלאי.`,
    noItem: 'לא מצאתי בתמונה פריט למכירה.',
    noItemHint: 'צלמו כך שהפריט ימלא את רוב התמונה.',
    retry: 'לנסות שוב',
    scanAgain: 'לסרוק פריט אחר',
    correctTitle: 'מה זה באמת?',
    correctHint: 'כתבו במילים שלכם: מותג, דגם, גרסה.',
    correctPlaceholder: 'זה בעצם Logitech G Pro Wireless',
    correctCouldBe: 'אולי אחד מאלה?',
    correctSubmit: 'עדכון',
    whyTitle: 'למה המחיר הזה?',
    found: (n) => (n === 0 ? 'לא נמצאו מודעות יד שנייה' : n === 1 ? 'נמצאה מודעת יד שנייה אחת' : `${n} מודעות יד שנייה נמצאו`),
    fromIsrael: (n) => `ישראל: ${n}`,
    fromAbroad: (n) => `חו״ל: ${n}`,
    relevantRange: 'טווח המחירים במודעות',
    newInIsrael: 'מחיר חדש בישראל',
    outOfStock: '(אזל מהמלאי)',
    unbound: (n) => (n === 1
      ? 'נמצא מחיר אחד שלא ניתן היה לשייך בוודאות לפריט הזה, ולכן לא נכלל.'
      : `נמצאו ${n} מחירים שלא ניתן היה לשייך בוודאות לפריט הזה, ולכן לא נכללו.`),
    shipping: (amount) => `+ ${amount} משלוח`,
    abroadNoShipping: 'מחירים מחו״ל אינם כוללים משלוח לישראל.',
    confidenceLine: 'רמת ביטחון',
    approximateWhy: 'הדגם המדויק לא אומת, ולכן המודעות הן של משפחת המוצר.',
    dispersedWhy: 'המודעות רחוקות זו מזו במחיר, ולכן הטווח רחב והביטחון נמוך.',
    intlAdjusted: (scale) => `מחירים מחו״ל הותאמו לרמת המחירים בישראל (×${scale}), לפי מחיר המוצר החדש בשני השווקים.`,
    intlUnadjusted: 'מחירים מחו״ל הומרו לשקלים אך לא ניתן היה להתאים אותם לרמת המחירים בישראל, ולכן משקלם קטן.',
    how: 'המחיר מחושב מהמודעות האלה ולא נבחר. מודעות מישראל שוקלות הכי הרבה, ואחריהן עד כמה כל מודעה מדויקת, עדכנית ואמינה. מחירי מודעות מופחתים ב־10% למיקוח, כהנחה ולא כמדידה.',
    conditionsHow: 'המחירים למצבים האחרים הם התאמה קבועה ממצב "טוב", ולא ממצאי שוק נפרדים.',
    abroadUnused: (n) => (n === 1 ? 'המודעות מישראל הספיקו לקביעת המחיר, ולכן מחיר אחד מחו״ל לא נכלל.' : `המודעות מישראל הספיקו לקביעת המחיר, ולכן ${n} מחירים מחו״ל לא נכללו.`),
    aside: {
      not_comparable: (n) => (n === 1 ? 'תוצאה אחת הייתה מוצר או דגם אחר, אביזר או חלק, ולכן לא נכללה.' : `${n} תוצאות היו מוצר או דגם אחר, אביזר או חלק, ולכן לא נכללו.`),
      above_new_price: (n) => (n === 1 ? 'מחיר אחד היה גבוה ממחיר המוצר החדש, ולכן אינו מחיר יד שנייה ולא נכלל.' : `${n} מחירים היו גבוהים ממחיר המוצר החדש, ולכן אינם מחירי יד שנייה ולא נכללו.`),
      outlier: (n) => (n === 1 ? 'מחיר אחד היה רחוק מאוד משאר המודעות, ולכן לא נכלל.' : `${n} מחירים היו רחוקים מאוד משאר המודעות, ולכן לא נכללו.`),
      retail_refurbished_without_private_resale: (n) => (n === 1
        ? 'נמצאה הצעה אחת למוצר מחודש מחנות. בלי מודעת יד שנייה פרטית שתתמוך בה, היא לא שימשה כמחיר משומש.'
        : `נמצאו ${n} הצעות למוצר מחודש מחנויות. בלי מודעת יד שנייה פרטית שתתמוך בהן, הן לא שימשו כמחירי משומש.`),
      abroad_without_israeli_reference: (n) => (n === 1
        ? 'נמצאה מודעה אחת מחו״ל. בלי מודעת יד שנייה מישראל להשוואה, היא רק הקשר: מחיר בחו״ל לא אומר במה הפריט נמכר בישראל.'
        : `נמצאו ${n} מודעות מחו״ל. בלי מודעת יד שנייה מישראל להשוואה, הן רק הקשר: מחירים בחו״ל לא אומרים במה הפריט נמכר בישראל.`),
      israeli_listing_old_or_sealed: (n) => (n === 1
        ? 'מודעה אחת מישראל הייתה ישנה או למוצר חדש באריזה, ולכן אינה מראה במה נמכר היום מוצר משומש.'
        : `${n} מודעות מישראל היו ישנות או למוצרים חדשים באריזה, ולכן אינן מראות במה נמכר היום מוצר משומש.`),
      different_model: (n) => (n === 1 ? 'תוצאה אחת הייתה דגם אחר של אותו מותג: מוצר אחר, ולכן לא נכללה.' : `${n} תוצאות היו דגמים אחרים של אותו מותג: מוצרים אחרים, ולכן לא נכללו.`),
    },
    why: {
      above_new_price: 'מעל מחיר המוצר החדש',
      outlier: 'רחוק משאר המודעות',
      different_model: 'דגם אחר, לא המוצר הזה',
      not_comparable: 'מוצר אחר, אביזר או חלק',
      price_not_tied_to_product: 'המחיר בעמוד לא משויך בוודאות לפריט',
      retail_refurbished_without_private_resale: 'מוצר מחודש מחנות, בלי מודעה פרטית לצידו',
      abroad_without_israeli_reference: 'חו״ל, בלי מודעה ישראלית להשוואה',
      israeli_listing_old_or_sealed: 'ישנה, או מוצר חדש באריזה',
      local_evidence_sufficient: 'לא נדרש: המודעות מישראל הספיקו',
    },
    groupUsed: 'שימשו לחישוב המחיר',
    groupContext: 'הקשר בלבד, לא שימשו למחיר',
    groupRejected: 'לא המוצר הזה, או לא שמיש',
    details: 'איך זה חושב',
    noPriceWhy: {
      no_verified_second_hand_reference: 'לא ניתן היה לאמת אף מודעת יד שנייה לפריט הזה, ולכן אין מחיר שאפשר לעמוד מאחוריו.',
      no_verified_israeli_second_hand_reference: 'לא אומתה בישראל מודעת יד שנייה עדכנית למוצר משומש מהדגם הזה. מה שנמצא מוצג למטה כהקשר בלבד; שום דבר ממנו לא אומר במה הפריט נמכר יד שנייה בישראל.',
      identity_incomplete: 'המוצר המדויק לא זוהה, ולכן השוק לא נבדק: חיפוש לפי מותג בלבד מביא מחירים של מוצרים אחרים.',
    },
    retailDisagree: (low, high) => `החנויות חלוקות על המחיר החדש: בין ${ltr(low)} ל־${ltr(high)}. המחיר הנמוך משמש כנקודת ייחוס.`,
    olderUsed: (n) => (n === 1 ? 'אחת מהמודעות שנכללו ישנה, ולכן משקלה קטן.' : `${n} מהמודעות שנכללו ישנות, ולכן משקלן קטן.`),
    refurbishedSupport: (n) => (n === 1 ? 'נכללה גם, במשקל קטן יותר: הצעה אחת למוצר מחודש מחנות, כראיה תומכת.' : `נכללו גם, במשקל קטן יותר: ${n} הצעות למוצר מחודש מחנויות, כראיות תומכות.`),
    setAside: (n) => (n === 1 ? 'תוצאה אחת נוספת לא נכללה.' : `${n} תוצאות נוספות לא נכללו.`),
    searchedOn: (date) => `השוק נבדק בתאריך ${date}`,
    sources: 'מקורות',
    kinds: { used_listing: 'משומש', sold: 'נמכר', refurbished: 'מחודש', new_retail: 'חדש', price_guide: 'מחירון', other: 'אחר' },
    matches: { exact: 'מדויק', close_comparable: 'דומה', sibling_model: 'דגם אחר' },
    places: { IL: 'ישראל', INTL: 'חו״ל' },
    freshness: { current: 'עדכני', recent: 'מהחודשים האחרונים', older: 'ישן', archived: 'מודעה ישנה' },
    approx: (price) => `≈ ${price}`,
    noSources: 'לא נמצאו מקורות מחיר שמישים.',
  },
};

export const scanCopy = (lang) => SCAN_COPY[lang === 'he' ? 'he' : 'en'];
