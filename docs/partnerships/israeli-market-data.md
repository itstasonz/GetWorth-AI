# Israeli Market Data Partnerships — findings and draft inquiries (2026-11-12)

Status: prepared for the founder. **Nothing has been sent, no form submitted, no service activated, nothing purchased.**

## Why structured data matters (measured, not assumed)

20-item fixed evaluation (`scripts/il-coverage-eval.mjs`, recorded searches replayed offline): 10/20 priced.
Of the 10 unpriced items, the research reached Israeli ads it could not use because the search snippet did not
carry an item-level price or date beside the ad (Yad2 collection pages, ad.co.il list/archive pages), or reached
only old/archived ads:

| Item | What the search reached in Israel | What a structured feed would have to supply |
|---|---|---|
| Bugaboo Fox 3 | Yad2 ad (₪1,500) and ad.co.il ad (₪3,700) — price not tied to the ad in the snippet | item-level price + date + title |
| Galaxy S23 128 GB | Homeless ads for 256 GB (₪870, ₪1,200) and one capacity-unstated ad (₪2,000) | a capacity field per ad |
| Xiaomi Mi Scooter Pro 2 | Homeless ad ₪600 (own page), ad.co.il ad ₪1,000 — named only in Hebrew | brand/model fields, not free text |
| IKEA KALLAX, IKEA POÄNG, Squier CV | ad.co.il archive ads only (old) | current ads, with dates |
| G Pro Wireless | one archived ad | current ads |
| DualSense, Nespresso Essenza Mini | no Israeli private ad reached | coverage of the board where these sell |
| Philips Airfryer XXL | other models only | model field |

**Conservative estimate:** structured, current, item-level Homeless + Yad2 data would plausibly make 2–4 more of the
20 priceable (Bugaboo, Galaxy S23, and the furniture items if current ads exist) → about 12–14/20. **This is an
estimate.** It cannot be verified without trial access to a provider's data. The earlier "70–80%" figure is an
unverified hypothesis and is not repeated here.

## Providers

| Provider | Official API / feed | Rights for commercial use | Cost | Verified facts | Unknowns |
|---|---|---|---|---|---|
| **Yad2** | None public (confirmed: no developer programme found; third parties state Yad2 "has no public developer API") | Only by agreement with Yad2 | Unknown | Largest Israeli classifieds; historically sold data to advertising agencies (Wikipedia); ownership moving KKR → Apax Partners (reported $950M, Dec 2025; closing not confirmed); Yad2 acted against unauthorised collection of its listings (Keyz dispute, June 2026) | Whether a marketplace (יד שנייה) data licence exists; fields; price; retention/display terms |
| **Homeless (Infotip Ltd.)** | None found | Site terms forbid automated collection ("רובוטים") and commercial use → requires written permission | Unknown | Our main readable source today (prices in ad titles and board tables); contact form at homeless.co.il/shared/contactus.aspx | Whether Infotip licenses data at all |
| **ad.co.il** | None found | Terms forbid copying/using site content without the operator's prior written permission | Unknown | Has a large archive (old ads — useful only as history, never as current price) | Licensing willingness; current-ad volume per category |
| Happy Endpoint "Yad2 API" (RapidAPI) | Unofficial REST API | **None from Yad2** — "not affiliated with, endorsed by" Yad2; users responsible for compliance | Free trial tier; paid tiers not published | Covers real estate, vehicles, "marketplace" listings | Collection method; marketplace field set |
| Apify Yad2 actors (several) | Scrapers | **None from Yad2** | ~$1.20–$4 per 1,000 results | Several actors target Yad2 second-hand market | — |
| Facebook Marketplace | No API | Meta terms prohibit automated collection | — | — | — |
| eBay Browse API | Official, free developer keys | Permitted under eBay API terms | Free tier | Abroad only: can give price-level context, can never make an Israeli price (engine rule) | — |

**Recommendation:** do not use the unofficial Yad2 APIs or scrapers for a commercial product. Approach Yad2 and
Infotip (Homeless) for a data licence; ad.co.il third. Ask each for a small trial dataset (e.g. one week of
second-hand listings in 3 categories) so the coverage gain can be measured on the 20-item set before any commitment.

## Founder decisions required

1. Approve sending the inquiries below (and to whom — Yad2 business development has no public address; Homeless
   via its contact form; ad.co.il via its contact page).
2. What GetWorth may offer in return (fee, attribution/link-back to the ad, traffic).
3. Budget ceiling for a data licence, if any.

---

## Draft 1 — Yad2 (פיתוח עסקי / שותפויות)

**נושא:** בקשה לשיתוף פעולה — גישה מורשית לנתוני מודעות יד שנייה (GetWorth AI)

שלום רב,

שמי [שם], מייסד GetWorth AI — אפליקציה ישראלית שמאפשרת לאנשים לצלם פריט ולקבל הערכת שווי לשוק היד השנייה בישראל, ולפרסם אותו למכירה.

ההערכה שלנו מבוססת על ראיות שוק בלבד: מודעות יד שנייה עדכניות לאותו דגם בדיוק (מותג, דגם, נפח/גודל, מצב). כיום אנו נשענים על תוצאות חיפוש פומביות, ואיננו אוספים מידע מיד2 באופן אוטומטי — ולכן אנו פונים לבקש גישה מורשית.

אנו מבקשים לבחון אפשרות לרישיון נתונים או API עבור מודעות יד שנייה (מוצרים, לא נדל״ן ורכב), הכולל לכל מודעה: כותרת, קטגוריה, מותג ודגם (אם קיימים), מחיר מבוקש, מצב המוצר, תאריך פרסום/עדכון וסטטוס (פעילה/הוסרה).

השימוש המיועד: חישוב טווח מחירים מצטבר למוצר מסוים והצגת מספר המודעות שעליהן ההערכה מבוססת, עם קישור למודעה המקורית ביד2 ככל שתרצו. איננו מפרסמים מחדש מודעות ואיננו מציגים פרטי מפרסמים.

נשמח לקבל מידע על: תנאי רישוי ושימוש מסחרי, תמחור והתחייבויות מינימום, תיעוד טכני, מגבלות קצב ושמירת נתונים, ודרישות ייחוס. נשמח גם לתקופת ניסיון מצומצמת (למשל שבוע נתונים בשלוש קטגוריות) כדי למדוד את התועלת לפני התקשרות.

בתודה,
[שם]
GetWorth AI · [טלפון] · [דוא״ל]

## Draft 2 — Homeless (אינפוטיפ בע״מ)

**נושא:** בקשה לאישור ולרישיון שימוש בנתוני לוח יד שניה — GetWorth AI

שלום רב,

שמי [שם], מייסד GetWorth AI — אפליקציה ישראלית להערכת שווי פריטי יד שנייה ולפרסומם למכירה.

תקנון האתר אוסר איסוף מידע באמצעים אוטומטיים ושימוש מסחרי, ואנו מכבדים זאת — ולכן אנו פונים מראש לבקש אישור והסדר מסודר.

נשמח לבחון רישיון לנתוני לוח היד השנייה (פיד או API) הכולל לכל מודעה: כותרת, קטגוריה, מחיר, אזור, תאריך עדכון, ומצב המוצר אם צוין.

השימוש: חישוב טווח מחירים מצטבר לדגם מסוים והפניה למודעה המקורית בהומלס (קישור ישיר, עם ייחוס). לא נפרסם מחדש מודעות ולא נציג פרטי קשר של מפרסמים.

נשמח לשמוע על תנאי שימוש מסחרי, תמחור, אופן אספקה ודרישות ייחוס, ועל אפשרות לתקופת ניסיון קצרה.

בתודה,
[שם]
GetWorth AI · [טלפון] · [דוא״ל]

## Draft 3 — ad.co.il

**נושא:** בקשה לאישור בכתב לשימוש בנתוני מודעות יד שנייה — GetWorth AI

שלום רב,

שמי [שם], מייסד GetWorth AI — אפליקציה ישראלית להערכת שווי פריטי יד שנייה.

תנאי השימוש באתר אוסרים שימוש בתכנים ללא אישור מראש ובכתב, ולכן אנו פונים לבקש הסדר מורשה לגישה למודעות יד שנייה עדכניות (כותרת, קטגוריה, מחיר, מצב, תאריך), לצורך חישוב טווחי מחיר מצטברים והפניה למודעה המקורית באתר עם ייחוס.

נשמח לקבל פרטים על תנאים, תמחור ואופן אספקה, ועל אפשרות לתקופת ניסיון.

בתודה,
[שם]
GetWorth AI · [טלפון] · [דוא״ל]
