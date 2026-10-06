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
    similarNote: 'No listing was found for this exact model, so this is a range from similar models.',
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
    notSure: 'Not sure',
    takePhoto: 'Take the photo',
    uploadPhoto: 'Upload a photo',
    insufficient: (name) => `I identified this as ${name}, but I don't have enough reliable current second-hand evidence to give you a confident Israeli market price.`,
    retailContext: (price) => `New, it currently sells for about ${price} in Israel.`,
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
    confidenceLine: 'Confidence',
    similarWhy: 'No listing was found for this exact model; the price is from similar models of the same family.',
    approximateWhy: 'The exact model is not confirmed, so the listings are for the product family.',
    dispersedWhy: 'The listings are far apart in price, so the range is wide and the confidence is low.',
    intlAdjusted: (scale) => `Prices from abroad were scaled to Israeli price level (×${scale}), using the item's new price in both markets.`,
    intlUnadjusted: 'Prices from abroad were converted to shekels but could not be adjusted to Israeli price level, so they count for little.',
    how: 'The price is calculated from these listings, not chosen. Listings from Israel count most, then how exact, how recent and how reliable each one is. Asking prices are lowered by an assumed 10% for negotiation.',
    conditionsHow: 'Prices for other conditions are a standard adjustment from Good condition, not separate market findings.',
    abroadUnused: (n) => `The Israeli listings were enough to price this, so ${n === 1 ? '1 price from abroad was' : `${n} prices from abroad were`} not used.`,
    setAside: (n) => `${n} other ${n === 1 ? 'result was' : 'results were'} set aside (a different model, an accessory, a part, or a price out of line).`,
    searchedOn: (date) => `Market searched on ${date}`,
    sources: 'Sources',
    kinds: { used_listing: 'Used', sold: 'Sold', refurbished: 'Refurbished', new_retail: 'New', price_guide: 'Price guide', other: 'Other' },
    matches: { exact: 'exact', close_comparable: 'comparable', sibling_model: 'similar model' },
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
    similarNote: 'לא נמצאה מודעה לדגם המדויק, ולכן זהו טווח לפי דגמים דומים.',
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
    notSure: 'לא בטוח/ה',
    takePhoto: 'לצלם',
    uploadPhoto: 'להעלות תמונה',
    insufficient: (name) => `זיהיתי את הפריט כ־${name}, אבל אין לי מספיק ראיות אמינות ועדכניות ממכירות יד שנייה כדי לתת מחיר שוק בטוח בישראל.`,
    retailContext: (price) => `חדש, הוא נמכר היום בישראל בכ־${ltr(price)}.`,
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
    confidenceLine: 'רמת ביטחון',
    similarWhy: 'לא נמצאה מודעה לדגם המדויק; המחיר מבוסס על דגמים דומים מאותה משפחה.',
    approximateWhy: 'הדגם המדויק לא אומת, ולכן המודעות הן של משפחת המוצר.',
    dispersedWhy: 'המודעות רחוקות זו מזו במחיר, ולכן הטווח רחב והביטחון נמוך.',
    intlAdjusted: (scale) => `מחירים מחו״ל הותאמו לרמת המחירים בישראל (×${scale}), לפי מחיר המוצר החדש בשני השווקים.`,
    intlUnadjusted: 'מחירים מחו״ל הומרו לשקלים אך לא ניתן היה להתאים אותם לרמת המחירים בישראל, ולכן משקלם קטן.',
    how: 'המחיר מחושב מהמודעות האלה ולא נבחר. מודעות מישראל שוקלות הכי הרבה, ואחריהן עד כמה כל מודעה מדויקת, עדכנית ואמינה. מחירי מודעות מופחתים ב־10% למיקוח, כהנחה ולא כמדידה.',
    conditionsHow: 'המחירים למצבים האחרים הם התאמה קבועה ממצב "טוב", ולא ממצאי שוק נפרדים.',
    abroadUnused: (n) => (n === 1 ? 'המודעות מישראל הספיקו לקביעת המחיר, ולכן מחיר אחד מחו״ל לא נכלל.' : `המודעות מישראל הספיקו לקביעת המחיר, ולכן ${n} מחירים מחו״ל לא נכללו.`),
    setAside: (n) => (n === 1 ? 'תוצאה אחת נוספת לא נכללה (דגם אחר, אביזר, חלק או מחיר חריג).' : `${n} תוצאות נוספות לא נכללו (דגם אחר, אביזר, חלק או מחיר חריג).`),
    searchedOn: (date) => `השוק נבדק בתאריך ${date}`,
    sources: 'מקורות',
    kinds: { used_listing: 'משומש', sold: 'נמכר', refurbished: 'מחודש', new_retail: 'חדש', price_guide: 'מחירון', other: 'אחר' },
    matches: { exact: 'מדויק', close_comparable: 'דומה', sibling_model: 'דגם דומה' },
    places: { IL: 'ישראל', INTL: 'חו״ל' },
    freshness: { current: 'עדכני', recent: 'מהחודשים האחרונים', older: 'ישן', archived: 'מודעה ישנה' },
    approx: (price) => `≈ ${price}`,
    noSources: 'לא נמצאו מקורות מחיר שמישים.',
  },
};

export const scanCopy = (lang) => SCAN_COPY[lang === 'he' ? 'he' : 'en'];
