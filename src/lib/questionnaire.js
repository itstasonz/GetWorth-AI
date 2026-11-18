// ══════════════════════════════════════════════════════════════════════════════
// PRODUCT QUESTIONS AFTER THE SCAN (2026-11-18): a few short, product-specific questions whose answers change the price
// the screen shows, or the listing the owner publishes. Pure data and functions: the screen renders them
// (components/ProductQuestions.jsx), the scan store keeps the answers (coreScan.js), and nothing here calls a server.
//
// What an answer may do, and nothing else:
//   - set or limit the CONDITION. The valuation already carries a price for each condition (valuation.js conditionPrices,
//     retail-estimate.js), so the price on screen changes at once, with no request. "Does not work" is "faulty", which is
//     never priced like a working unit.
//   - add a FACT to the listing (box and charger, warranty, papers, purity, weight). Facts never move the price: there is
//     no evidence for a premium, so none is invented. The screen says so.
// Questions about WHICH product it is (model, storage, generation, connectivity) are not here: they change the search,
// so the server asks them before the price (identify.js selectQuestion).
// ══════════════════════════════════════════════════════════════════════════════

export const CONDITION_ORDER = Object.freeze(['new_sealed', 'like_new', 'good', 'fair', 'poor']);
const worse = (a, b) => (CONDITION_ORDER.indexOf(a) >= CONDITION_ORDER.indexOf(b) ? a : b);

const text = (s) => String(s ?? '').toLowerCase();
const SMARTWATCH = /(smart ?watch|apple watch|galaxy watch|pixel watch|fitbit|garmin|amazfit|שעון חכם)/;
const WATCH = /(watch|שעון)/;
const JEWELRY = /(ring|necklace|bracelet|earring|pendant|chain|jewel|טבעת|שרשרת|צמיד|עגיל|תליון|תכשיט)/;
const PHONE = /(smartphone|phone|iphone|galaxy s|galaxy a|pixel|טלפון|סמארטפון)/;
const TABLET = /(tablet|ipad|טאבלט)/;
const LAPTOP = /(laptop|notebook|macbook|מחשב נייד)/;

/** Which question set fits this product. Read from what identification established, never from a price. */
export function productKind(identity) {
  const i = identity ?? {};
  const words = text([i.item_type, i.product_family, i.model, i.display_name, i.canonical_name, i.category].filter(Boolean).join(' '));
  const mc = i.market_class;
  if (SMARTWATCH.test(words)) return 'smartwatch';
  if (WATCH.test(words)) return mc === 'luxury_watch_jewelry' || mc === 'collectible' ? 'luxury_watch' : 'fashion_watch';
  if (JEWELRY.test(words) || (mc === 'luxury_watch_jewelry')) return 'jewelry';
  if (mc === 'vehicle' || mc === 'collectible' || mc === 'handmade_vintage' || mc === 'fragrance_cosmetics') return null;
  if (PHONE.test(words)) return 'phone';
  if (TABLET.test(words)) return 'tablet';
  if (LAPTOP.test(words)) return 'laptop';
  if (mc === 'furniture') return 'furniture';
  if (mc === 'household' || mc === 'tools') return 'appliance';
  if (mc === 'consumer_electronics') return 'electronics';
  return 'other';
}

// ── THE QUESTIONS ─────────────────────────────────────────────────────────────
// Each option says what it does: `condition` sets it, `cap` limits it ("no better than"), `fact` goes into the listing.
const o = (id, he, en, effect = {}) => ({ id, he, en, ...effect });
const NOT_SURE = o('unsure', 'לא בטוח/ה', 'Not sure');

const WORKS = {
  id: 'works', he: 'הכול עובד כמו שצריך?', en: 'Does everything work properly?',
  options: [o('yes', 'כן, הכול עובד', 'Yes, everything works'), o('fault', 'יש תקלה', 'There is a fault', { condition: 'poor', fact: { he: 'יש תקלה', en: 'Has a fault' } }), NOT_SURE],
};
const LOOKS = {
  id: 'looks', he: 'איך המוצר נראה?', en: 'How does it look?',
  options: [
    o('like_new', 'כמו חדש', 'Like new', { condition: 'like_new' }),
    o('light', 'שריטות קלות', 'Light scratches', { condition: 'good' }),
    o('worn', 'סימני שימוש בולטים', 'Visible wear', { condition: 'fair' }),
    o('broken', 'סדוק או שבור', 'Cracked or broken', { condition: 'poor', fact: { he: 'יש נזק גלוי', en: 'Visible damage' } }),
  ],
};
const BATTERY = {
  id: 'battery', he: 'מה מצב הסוללה?', en: 'What is the battery health?', optional: true,
  note: { he: 'אפשר לבדוק בהגדרות, תחת סוללה.', en: 'You can check it in Settings, under Battery.' },
  options: [
    o('high', '90% ומעלה', '90% or more', { fact: { he: 'בריאות סוללה 90% ומעלה', en: 'Battery health 90% or more' } }),
    o('mid', '80%–89%', '80%–89%', { cap: 'good', fact: { he: 'בריאות סוללה 80%–89%', en: 'Battery health 80%–89%' } }),
    o('low', 'פחות מ־80%', 'Below 80%', { cap: 'fair', fact: { he: 'בריאות סוללה מתחת ל־80%', en: 'Battery health below 80%' } }),
    o('unknown', 'לא יודע/ת', 'Not sure'),
  ],
};
const BOX = (he, en, factHe, factEn) => ({
  id: 'box', he, en, optional: true, neutral: true,
  options: [o('yes', 'כן', 'Yes', { fact: { he: factHe, en: factEn } }), o('partial', 'חלק', 'Some', { fact: { he: 'חלק מהאביזרים המקוריים', en: 'Some original accessories' } }), o('no', 'לא', 'No')],
});
const WARRANTY = {
  id: 'warranty', he: 'יש עדיין אחריות?', en: 'Is it still under warranty?', optional: true, neutral: true,
  options: [o('yes', 'כן', 'Yes', { fact: { he: 'עדיין באחריות', en: 'Still under warranty' } }), o('no', 'לא', 'No'), NOT_SURE],
};
const MISSING = {
  id: 'missing', he: 'כל החלקים והאביזרים קיימים?', en: 'Are all parts and accessories there?',
  options: [o('yes', 'כן', 'Yes'), o('no', 'חסר משהו', 'Something is missing', { cap: 'fair', fact: { he: 'חסרים חלקים או אביזרים', en: 'Some parts or accessories missing' } }), NOT_SURE],
};
const AGE = {
  id: 'age', he: 'בן כמה המוצר?', en: 'How old is it?', optional: true, neutral: true,
  options: [o('lt1', 'פחות משנה', 'Under a year', { fact: { he: 'בן פחות משנה', en: 'Under a year old' } }), o('1to3', 'שנה עד שלוש', '1 to 3 years', { fact: { he: 'בן שנה עד שלוש', en: '1 to 3 years old' } }), o('gt3', 'יותר משלוש שנים', 'Over 3 years', { fact: { he: 'בן יותר משלוש שנים', en: 'Over 3 years old' } })],
};
const STRUCTURE = {
  id: 'structure', he: 'יש נזק במבנה? למשל רגל רופפת או חלק שבור', en: 'Any structural damage, like a loose leg or a broken part?',
  options: [o('no', 'לא', 'No'), o('yes', 'כן', 'Yes', { condition: 'poor', fact: { he: 'יש נזק במבנה', en: 'Structural damage' } }), NOT_SURE],
};
const FURNITURE_LOOKS = {
  id: 'looks', he: 'איך הרהיט נראה?', en: 'How does it look?',
  options: [
    o('like_new', 'כמו חדש', 'Like new', { condition: 'like_new' }),
    o('light', 'סימני שימוש קלים', 'Light wear', { condition: 'good' }),
    o('worn', 'כתמים או שריטות בולטים', 'Stains or visible scratches', { condition: 'fair' }),
  ],
};
const ASSEMBLY = {
  id: 'assembly', he: 'הרהיט מורכב או מפורק?', en: 'Is it assembled?', optional: true, neutral: true,
  options: [o('assembled', 'מורכב', 'Assembled', { fact: { he: 'מגיע מורכב', en: 'Comes assembled' } }), o('flat', 'מפורק', 'Taken apart', { fact: { he: 'מגיע מפורק', en: 'Comes taken apart' } })],
};
const WIDTH = { id: 'width', he: 'מה הרוחב, בס״מ?', en: 'How wide is it, in cm?', kind: 'number', unit: 'cm', optional: true, neutral: true, fact: (n) => ({ he: `רוחב ${n} ס״מ`, en: `${n} cm wide` }) };
const MATERIAL = {
  id: 'material', he: 'ממה התכשיט עשוי?', en: 'What is it made of?', neutral: true,
  options: [o('gold', 'זהב', 'Gold'), o('silver', 'כסף', 'Silver', { fact: { he: 'כסף', en: 'Silver' } }), o('platinum', 'פלטינה', 'Platinum', { fact: { he: 'פלטינה', en: 'Platinum' } }), o('other', 'אחר או ציפוי', 'Other or plated'), NOT_SURE],
};
const PURITY = {
  id: 'purity', he: 'מה הטוהר של הזהב?', en: 'What is the gold purity?', neutral: true, when: (a) => a.material === 'gold',
  note: { he: 'בדרך כלל מוטבע בפנים, למשל 585 או 14K.', en: 'Usually stamped inside, e.g. 585 or 14K.' },
  options: [o('14k', '14K (585)', '14K (585)', { fact: { he: 'זהב 14K', en: '14K gold' } }), o('18k', '18K (750)', '18K (750)', { fact: { he: 'זהב 18K', en: '18K gold' } }), o('22k', '22K ומעלה', '22K or higher', { fact: { he: 'זהב 22K ומעלה', en: '22K gold or higher' } }), o('unknown', 'לא יודע/ת', 'Not sure', { fact: { he: 'זהב, טוהר לא ידוע', en: 'Gold, purity unknown' } })],
};
const WEIGHT = { id: 'weight', he: 'כמה הוא שוקל, בגרמים?', en: 'How much does it weigh, in grams?', kind: 'number', unit: 'g', optional: true, neutral: true, fact: (n) => ({ he: `משקל ${n} גרם`, en: `${n} g` }) };
const CERTIFICATE = {
  id: 'certificate', he: 'יש תעודה או חשבונית?', en: 'Is there a certificate or receipt?', optional: true, neutral: true,
  options: [o('yes', 'כן', 'Yes', { fact: { he: 'יש תעודה או חשבונית', en: 'Certificate or receipt included' } }), o('no', 'לא', 'No')],
};
const BOX_PAPERS = {
  id: 'box_papers', he: 'יש קופסה ותעודות מקוריות?', en: 'Are the original box and papers included?', neutral: true,
  options: [o('both', 'גם וגם', 'Both', { fact: { he: 'עם קופסה ותעודות מקוריות', en: 'Original box and papers' } }), o('box', 'רק קופסה', 'Box only', { fact: { he: 'עם קופסה מקורית', en: 'Original box' } }), o('papers', 'רק תעודות', 'Papers only', { fact: { he: 'עם תעודות מקוריות', en: 'Original papers' } }), o('none', 'אין', 'Neither')],
};
const SERVICE = {
  id: 'service', he: 'השעון עבר טיפול בחמש השנים האחרונות?', en: 'Was it serviced in the last five years?', optional: true, neutral: true,
  options: [o('yes', 'כן', 'Yes', { fact: { he: 'עבר טיפול בחמש השנים האחרונות', en: 'Serviced in the last five years' } }), o('no', 'לא', 'No'), NOT_SURE],
};

/** The questions for each kind of product, most useful first. Two to four for ordinary products. */
export const QUESTION_SETS = Object.freeze({
  phone: [WORKS, LOOKS, BATTERY, BOX('יש קופסה ומטען מקוריים?', 'Original box and charger?', 'עם קופסה ומטען מקוריים', 'Original box and charger')],
  tablet: [WORKS, LOOKS, BATTERY, BOX('יש מטען מקורי?', 'Original charger?', 'עם מטען מקורי', 'Original charger')],
  laptop: [WORKS, LOOKS, BATTERY, BOX('יש מטען מקורי?', 'Original charger?', 'עם מטען מקורי', 'Original charger')],
  smartwatch: [WORKS, LOOKS, BATTERY, BOX('יש מטען מקורי?', 'Original charger?', 'עם מטען מקורי', 'Original charger')],
  electronics: [WORKS, LOOKS, BOX('יש קופסה וכבלים מקוריים?', 'Original box and cables?', 'עם קופסה וכבלים מקוריים', 'Original box and cables'), WARRANTY],
  appliance: [WORKS, MISSING, LOOKS, AGE, WARRANTY],
  furniture: [STRUCTURE, FURNITURE_LOOKS, WIDTH, ASSEMBLY],
  fashion_watch: [WORKS, LOOKS, BOX('יש קופסה מקורית?', 'Original box?', 'עם קופסה מקורית', 'Original box')],
  luxury_watch: [BOX_PAPERS, WORKS, LOOKS, SERVICE],
  jewelry: [MATERIAL, PURITY, WEIGHT, CERTIFICATE],
  other: [WORKS, LOOKS],
});

/** The questions to ask now, in order: those that apply to what was already answered. */
export function questionsFor(identity, answers = {}) {
  const kind = productKind(identity);
  if (!kind) return [];
  return (QUESTION_SETS[kind] ?? []).filter((q) => !q.when || q.when(answers));
}

/**
 * The condition the answers lead to, and why. The owner's own answers decide; the photograph is the starting point when
 * the appearance was not answered. A fault or structural damage makes it faulty; a weak battery or a missing part limits
 * it ("no better than"). null when nothing was answered that bears on condition.
 */
export function conditionFromAnswers(identity, answers = {}) {
  const qs = QUESTION_SETS[productKind(identity)] ?? [];
  const pick = (q) => q.options?.find((x) => x.id === answers[q.id]) ?? null;
  let condition = null;
  const why = [];
  for (const q of qs) { const a = pick(q); if (a?.condition && q.id === 'looks') { condition = a.condition; why.push(a); } }
  const photo = CONDITION_ORDER.includes(identity?.visible_condition) && identity.visible_condition !== 'new_sealed' ? identity.visible_condition : null;
  for (const q of qs) {
    const a = pick(q);
    if (!a || q.id === 'looks') continue;
    if (a.condition) { condition = condition ? worse(condition, a.condition) : a.condition; why.push(a); }
    if (a.cap) { condition = worse(condition ?? photo ?? 'good', a.cap); why.push(a); }
  }
  return condition ? { condition, why: why.map((a) => a.id) } : null;
}

/** The facts the answers add to the listing, in the screen's language. Never a price. */
export function factsFromAnswers(identity, answers = {}, lang = 'he') {
  const l = lang === 'en' ? 'en' : 'he';
  const out = [];
  for (const q of questionsFor(identity, answers)) {
    const v = answers[q.id];
    if (v == null || v === '') continue;
    if (q.kind === 'number') { const n = Number(v); if (Number.isFinite(n) && n > 0) out.push(q.fact(n)[l]); continue; }
    const a = q.options?.find((x) => x.id === v);
    if (a?.fact) out.push(a.fact[l]);
  }
  return [...new Set(out)];
}

/** Whether the answers changed anything the price rests on, or only what the listing says. */
export const NEUTRAL_NOTE = {
  he: 'קופסה, אחריות ומסמכים נכנסים למודעה. אין לנו נתונים שמראים כמה הם מוסיפים למחיר, לכן הם לא משנים אותו.',
  en: 'Box, warranty and documents go into the listing. We have no data on how much they add, so they do not change the price.',
};
