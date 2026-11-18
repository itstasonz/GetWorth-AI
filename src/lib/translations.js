// ═══════════════════════════════════════════════════════
// GetWorth: Centralized Translation File
// All T[lang].key references resolved here
// Inline lang === 'he' ternaries handle component-specific text
// ═══════════════════════════════════════════════════════

const T = {
  en: {
    // App
    appName: 'GetWorth',
    tagline: 'What is your item worth?',
    welcome: 'Welcome',

    // Home Hero
    aiPowered: 'AI',
    heroTitle1: 'What is your',
    heroTitle2: 'item worth?',
    heroSub: 'Take a photo and see second-hand prices in Israel.',
    upload: 'Upload',
    drop: 'Drop a photo here',
    orButtons: 'or choose below',
    hotItems: 'New listings',
    seeAll: 'See all',
    sellBanner: 'Have something to sell?',
    sellBannerSub: 'Scan it and publish a listing',

    // Nav
    home: 'Home',
    sell: 'Sell',
    profile: 'Profile',

    // Bottom Nav
    browse: 'Browse',
    scan: 'Scan',
    saved: 'Saved',

    // Auth
    signIn: 'Sign In',
    signUp: 'Sign Up',
    signInAccess: 'Sign in to access all features',
    signInSave: 'Sign in to save items',
    signInList: 'Sign in to list items',
    // AUTH-001: /api/analyze requires a session — scanning is gated like
    // save/contact/list, and this is the copy for that prompt.
    signInScan: 'Sign in to scan an item',
    signInBuy: 'Sign in to buy. We will bring you back to this listing.',
    google: 'Continue with Google',
    or: 'or',
    password: 'Password',
    haveAcc: 'Already have an account?',
    noAcc: "Don't have an account?",

    // Browse & Categories
    all: 'All',
    electronics: 'Electronics',
    furniture: 'Furniture',
    watches: 'Watches',
    clothing: 'Clothing',
    sports: 'Sports',
    vehicles: 'Vehicles',
    beauty: 'Beauty',
    books: 'Books',
    toys: 'Toys',
    home: 'Home',
    tools: 'Tools',
    music: 'Music',
    food: 'Food',
    other: 'Other',
    // Legacy alias — old code references t.phones
    phones: 'Electronics',

    // Browse UI
    noResults: 'No results found',
    noSaved: 'No saved items yet',
    clear: 'Clear',
    view: 'View',
    more: 'More Details',
    back: 'Back',
    filters: 'Filters',
    results: 'results',
    trustScore: 'Trust Score',
    verified: 'Verified',

    // Conditions
    condition: 'Condition',
    newSealed: 'New / Sealed',
    likeNew: 'Like New',
    used: 'Used',
    poor: 'Fair / Poor',

    // Pricing
    marketValue: 'Market Value',
    yourPrice: 'Your Price',
    min: 'Min',
    max: 'Max',
    range: 'Range',
    live: 'Your listing is live',

    // Valuation trust (VAL-001)
    // Two SEPARATE axes. Identity = how sure we are WHAT this is (a calibrated
    // score, so a % is legitimate). Pricing = how much evidence backed the
    // PRICE (a 4-level ordinal, so it is verbal — a % would be false precision).
    idConfidence:      'Identification confidence',
    idStrong:          'Strong match',
    idModerate:        'Confirm to improve identification',
    idLow:             'Needs confirmation',
    idVeryLow:         'Not clearly identified',

    pricingEvidence:   'Pricing evidence',
    priceEvidStrong:   'Strong pricing evidence',
    // The basis a shipped price actually rests on. Only the first claims the
    // open-world market search produced it.
    basisVerifiedMarket: 'Based on verified market listings',
    basisComparableMarket: 'Based on comparable items on the market',
    basisMarketEstimate: 'Based on a GetWorth catalog reference',
    basisAiEstimate:     'Computer estimate. No listings found to compare.',
    priceEvidLimited:  'Limited pricing evidence',
    priceEvidWeak:     'Weak pricing evidence',
    priceEvidNone:     'No pricing evidence',

    priceFromComps:    'Based on comparable sales',
    priceFromAi:       'AI estimate, no comparable sales',
    priceFromCatalog:  'Based on a similar catalog item',
    priceQuickEst:     'Quick estimate. Check it before you publish.',
    priceFromCategory: 'Estimated from category data',
    priceSetManually:  'Set your own price',
    // UI-003 Wave 0: this used to read "Price subject to authenticity
    // verification", which describes a service that does not exist. Nothing
    // gates the number — `verification_required` is a LABEL, not a hold:
    // analyze.js:2439 sets it and no pricing step reads it, so the same figure
    // ships either way. The honest statement is what the price assumed.
    priceVerificationPending: 'Priced as authentic. Authenticity was not checked.',
    priceReplicaAdjusted:     'Replica-adjusted estimate',

    estimateOnly:      'An estimate, not a guaranteed sale price.',
    enterPricePrompt:  'Enter a price to continue',

    // ── Authenticity (UI-003 Wave 0) ──
    // Every string here describes what a MODEL saw in a photograph. None of
    // them may read as a credential: no "Verified", no "Authenticated", no
    // trailing checkmark. See the comment block above the badge in
    // CameraResultsView for the full reasoning; the short version is that no
    // third-party verification occurs anywhere in the scan path.
    authSerialSeen:    'AI read a serial',
    authDocsSeen:      'AI read a document',
    authSignsSeen:     'AI: authenticity signs',
    authIndicators:    'AI found authenticity indicators',
    authUncertain:     'AI could not confirm authenticity',
    authExpertAdvised: 'Expert check advised',
    authFakeSigns:     'AI: counterfeit signs',
    authReplicaSigns:  'AI: replica signs',
    authNotInPhotos:   'Not visible in your photos:',

    // ── Serial capture (UI-003 Wave 0) ──
    // These describe an EVENT — a value was captured — never a check. The
    // `verified` flag behind them is set by a regex that saw "S/N" next to six
    // characters, or, for a typed serial, by `length >= 8`. So the seller-facing
    // copy says "captured" and the BUYER-facing chip says the seller provided
    // it, with no checkmark and no shield. See serialProvided below.
    serialCaptured:    'Serial captured',
    imeiCaptured:      'IMEI captured',
    // Buyer-facing. Attributes the claim to the SELLER, which is who made it.
    // It replaced 'Serial verified' / 'מספר סידורי אומת' — `אומת` being the word
    // this app reserves for operator-checked identity, rendered on a green check
    // directly beside the genuine 'Verified ID' chip.
    serialProvided:    'Serial provided by seller',

    // Serial capture. `serialData.verified` is NOT a verification — see the
    // comment at the serial control in CameraResultsView. These strings state
    // only what actually happened: a value was captured, or supplied.
    serialAdded:       'Serial added',
    serialAddedImei:   'IMEI added',
    serialAddAction:   'Add',
    serialProvided:    'Serial provided',

    // Time
    today: 'Today',
    yesterday: 'Yesterday',
    daysAgo: 'd ago',

    // Scan & Analysis
    analyzing: 'Identifying the item...',
    scanAnother: 'Scan another item',
    desc: 'Description',
    review: 'Review & Publish',
    share: 'Share',
    sales: 'Sales',

    // Listing Flow
    title: 'Title',
    phone: 'Phone',
    location: 'Location',
    publish: 'Publish Listing',
    publishing: 'Publishing...',
    published: 'Published',
    continue: 'Continue',
    listItem: 'List for sale',
    myListings: 'My listings',
    noListings: 'No listings yet. Scan an item to start.',

    // Auth (extended)
    signInReq: 'Sign In Required',
    signInContact: 'Sign in to contact',
    name: 'Full Name',
    email: 'Email',
    createAcc: 'Create account',
    join: 'Join GetWorth',
    cancel: 'Cancel',

    // Contact / Seller
    contact: 'Contact',
    call: 'Call',
    whatsapp: 'WhatsApp',
    seller: 'Seller',
    views: 'views',

    // Sort options
    newest: 'Newest',
    lowHigh: 'Low-High',
    highLow: 'High-Low',

    // Errors
    failed: 'We could not identify the item. Try again.',
    cameraDenied: 'No camera access. You can allow it in your browser settings.',

    // ─── Category-Aware Question Labels ───
    // Generic (all categories)
    scratches: 'Any scratches or cosmetic damage?',
    issues: 'Any functional issues?',
    // Electronics
    battery: 'Battery health?',
    storage: 'Storage capacity?',
    deviceType: 'What type of electronic device?',
    devicePhone: 'Phone',
    deviceLaptop: 'Laptop',
    deviceTablet: 'Tablet',
    deviceHeadphones: 'Headphones',
    deviceConsole: 'Console',
    deviceCamera: 'Camera',
    deviceTV: 'TV',
    deviceOther: 'Other',
    // Furniture
    material: 'Material?',
    dimensions: 'Approximate size?',
    assembly: 'Requires assembly?',
    // Watches
    authenticity: 'Authenticity?',
    boxPapers: 'Box & papers included?',
    // Clothing
    size: 'Size?',
    materialType: 'Material type?',
    // Sports
    sportType: 'Which sport?',
    gym: 'Gym and fitness',
    cycling: 'Cycling',
    water: 'Water sports',
    ball: 'Ball sports',
    outdoor: 'Outdoor and hiking',
    // Beauty / Jewelry
    beautyType: 'Item type?',
    jewelry: 'Jewelry',
    cosmetics: 'Cosmetics',
    skincare: 'Skincare',
    accessory: 'Accessory',
    // Vehicles
    vehicleType: 'Vehicle type?',
    car: 'Car',
    motorcycle: 'Motorcycle',
    bicycle: 'Bicycle',
    scooter: 'Scooter',
    // Books
    bookCondition: 'Book condition?',
    worn: 'Worn',

    // Answer options
    yes: 'Yes',
    no: 'No',
    good: 'Good',
    degraded: 'Degraded',
    original: 'Original',
    unknown: 'Unknown',
    replica: 'Replica',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    wood: 'Wood',
    metal: 'Metal',
    fabric: 'Fabric',
    plastic: 'Plastic',
    leather: 'Leather',
    cotton: 'Cotton',
    synthetic: 'Synthetic',
  },

  he: {
    // App
    appName: 'GetWorth',
    tagline: 'כמה שווה המוצר שלכם',
    welcome: 'ברוכים הבאים',

    // Home Hero
    aiPowered: 'AI',
    heroTitle1: 'כמה שווה',
    heroTitle2: 'המוצר שלכם?',
    heroSub: 'מצלמים מוצר ומקבלים מחיר יד שנייה בישראל.',
    upload: 'העלאה',
    drop: 'גררו תמונה לכאן',
    orButtons: 'או בחרו למטה',
    hotItems: 'מודעות חדשות',
    seeAll: 'לכל המודעות',
    sellBanner: 'יש לכם משהו למכור?',
    sellBannerSub: 'סורקים את המוצר ומפרסמים מודעה',

    // Nav
    home: 'בית',
    sell: 'מכירה',
    profile: 'פרופיל',

    // Bottom Nav
    browse: 'גלישה',
    scan: 'סריקה',
    saved: 'שמורים',

    // Auth
    signIn: 'התחברות',
    signUp: 'הרשמה',
    signInAccess: 'צריך להתחבר כדי להמשיך',
    signInSave: 'התחברו כדי לשמור מודעות',
    signInList: 'התחברו כדי לפרסם מודעה',
    signInScan: 'התחברו כדי לסרוק מוצר',
    signInBuy: 'התחברו כדי לקנות. אחרי ההתחברות נחזור למודעה הזו.',
    google: 'כניסה עם Google',
    or: 'או',
    password: 'סיסמה',
    haveAcc: 'כבר יש לכם חשבון?',
    noAcc: 'אין לכם חשבון?',

    // Browse & Categories
    all: 'הכל',
    electronics: 'אלקטרוניקה',
    furniture: 'ריהוט',
    watches: 'שעונים',
    clothing: 'ביגוד',
    sports: 'ספורט',
    vehicles: 'רכבים',
    beauty: 'יופי וטיפוח',
    books: 'ספרים',
    toys: 'צעצועים',
    home: 'בית',
    tools: 'כלים',
    music: 'מוזיקה',
    food: 'מזון',
    other: 'אחר',
    phones: 'אלקטרוניקה',

    // Browse UI
    noResults: 'לא נמצאו תוצאות',
    noSaved: 'עוד לא שמרתם מודעות',
    clear: 'ניקוי',
    view: 'צפייה',
    more: 'פרטים נוספים',
    back: 'חזרה',
    filters: 'סינון',
    results: 'תוצאות',
    trustScore: 'דירוג אמינות',
    verified: 'מאומת',

    // Conditions
    condition: 'מצב המוצר',
    newSealed: 'חדש באריזה',
    likeNew: 'כמו חדש',
    used: 'משומש',
    poor: 'סביר או בלוי',

    // Pricing
    marketValue: 'שווי משוער',
    yourPrice: 'המחיר שלכם',
    min: 'מינ׳',
    max: 'מקס׳',
    range: 'טווח',
    live: 'המודעה פורסמה',

    // Valuation trust (VAL-001) — must carry the SAME claim as the English.
    // The word דיוק (accuracy) is deliberately absent from this whole block:
    // it is what made the old copy read as a promise about the price.
    idConfidence:      'ביטחון בזיהוי',
    idStrong:          'זיהוי ברור',
    idModerate:        'כדאי לאשר את הדגם',
    idLow:             'צריך לאשר את הדגם',
    idVeryLow:         'המוצר לא זוהה בבירור',

    pricingEvidence:   'על מה המחיר מבוסס',
    priceEvidStrong:   'הרבה נתוני מחיר',
    basisVerifiedMarket: 'לפי מודעות יד שנייה שנבדקו',
    basisComparableMarket: 'לפי מוצרים דומים בשוק',
    basisMarketEstimate: 'לפי מוצר דומה בקטלוג GetWorth',
    basisAiEstimate:     'הערכה ממוחשבת. לא נמצאו מודעות להשוואה.',
    priceEvidLimited:  'מעט נתוני מחיר',
    priceEvidWeak:     'נתוני מחיר חלשים',
    priceEvidNone:     'אין נתוני מחיר',

    priceFromComps:    'לפי מכירות דומות',
    priceFromAi:       'הערכה ממוחשבת, בלי מכירות דומות להשוואה',
    priceFromCatalog:  'לפי מוצר דומה בקטלוג',
    priceQuickEst:     'הערכה מהירה. כדאי לבדוק לפני הפרסום.',
    priceFromCategory: 'הערכה לפי הקטגוריה',
    priceSetManually:  'קבעו מחיר בעצמכם',
    // UI-003 Wave 0 — see the English. 'מחיר תלוי אימות אותנטיות' promised an
    // authenticity check that gates the price; no such check exists.
    priceVerificationPending: 'המחיר מניח שהמוצר מקורי. המקוריות לא נבדקה.',
    priceReplicaAdjusted:     'מחיר לרפליקה',

    estimateOnly:      'זו הערכה, לא מחיר מכירה מובטח.',
    enterPricePrompt:  'כדי להמשיך, הזינו מחיר',

    // ── אותנטיות (UI-003 Wave 0) — must carry the SAME claim as the English.
    // מאומת / אומת are deliberately absent from this entire block. They are
    // reserved for a fact an operator checked (is_verified — utils.js:271), and
    // a model reading a photograph is not one. In Hebrew, the app's DEFAULT
    // language, מאומת was the single word that made an AI guess and a real
    // credential render identically; do not reintroduce it here.
    authSerialSeen:    'ה־AI זיהה מספר סידורי בתמונה',
    authDocsSeen:      'ה־AI זיהה מסמך בתמונה',
    authSignsSeen:     'ה־AI זיהה סימני מקוריות',
    authIndicators:    'ה־AI זיהה סימני מקוריות',
    authUncertain:     'ה־AI לא יכול לקבוע מהתמונה אם המוצר מקורי',
    authExpertAdvised: 'כדאי לבדוק אצל מומחה',
    authFakeSigns:     'ה־AI זיהה סימני זיוף',
    authReplicaSigns:  'ה־AI זיהה סימנים של רפליקה',
    authNotInPhotos:   'לא נראה בתמונות:',

    // ── קליטת מספר סידורי (UI-003 Wave 0) — see the English.
    // אומת / מאומת are deliberately absent: nothing here was checked. The buyer
    // chip names the SELLER as the source of the claim.
    serialCaptured:    'מספר סידורי נקלט',
    imeiCaptured:      'IMEI נקלט',
    serialProvided:    'מספר סידורי שסופק ע״י המוכר',

    // מספר סידורי — ראה את האנגלית. אין כאן אימות, ולכן אין כאן אומת/מאומת.
    serialAdded:       'מספר סידורי נוסף',
    serialAddedImei:   'IMEI נוסף',
    serialAddAction:   'הוספה',
    serialProvided:    'מספר סידורי סופק',

    // Time
    today: 'היום',
    yesterday: 'אתמול',
    daysAgo: ' ימים',

    // Scan & Analysis
    analyzing: 'מזהה את המוצר...',
    scanAnother: 'סריקת מוצר נוסף',
    desc: 'תיאור',
    review: 'בדיקה ופרסום',
    share: 'שיתוף',
    sales: 'מכירות',

    // Listing Flow
    title: 'כותרת',
    phone: 'טלפון',
    location: 'מיקום',
    publish: 'פרסום המודעה',
    publishing: 'מפרסם...',
    published: 'המודעה פורסמה',
    continue: 'המשך',
    listItem: 'פרסום למכירה',
    myListings: 'המודעות שלי',
    noListings: 'עוד אין לכם מודעות. סרקו מוצר כדי להתחיל.',

    // Auth (extended)
    signInReq: 'צריך להתחבר',
    signInContact: 'התחברו כדי ליצור קשר',
    name: 'שם',
    email: 'אימייל',
    createAcc: 'יצירת חשבון',
    join: 'הרשמה',
    cancel: 'ביטול',

    // Contact / Seller
    contact: 'יצירת קשר',
    call: 'התקשרות',
    whatsapp: 'וואטסאפ',
    seller: 'מוכר',
    views: 'צפיות',

    // Sort options
    newest: 'החדשות ביותר',
    lowHigh: 'מחיר: מהנמוך לגבוה',
    highLow: 'מחיר: מהגבוה לנמוך',

    // Errors
    failed: 'הזיהוי לא הצליח. נסו שוב.',
    cameraDenied: 'אין גישה למצלמה. אפשר לאשר אותה בהגדרות הדפדפן.',

    // ─── Category-Aware Question Labels ───
    scratches: 'שריטות או נזק חיצוני?',
    issues: 'תקלות בתפקוד?',
    battery: 'מצב סוללה?',
    storage: 'נפח אחסון?',
    deviceType: 'איזה סוג מכשיר?',
    devicePhone: 'טלפון',
    deviceLaptop: 'מחשב נייד',
    deviceTablet: 'טאבלט',
    deviceHeadphones: 'אוזניות',
    deviceConsole: 'קונסולה',
    deviceCamera: 'מצלמה',
    deviceTV: 'טלוויזיה',
    deviceOther: 'אחר',
    material: 'חומר?',
    dimensions: 'גודל משוער?',
    assembly: 'דורש הרכבה?',
    authenticity: 'מקוריות?',
    boxPapers: 'קופסה ותעודות?',
    size: 'מידה?',
    materialType: 'סוג חומר?',
    sportType: 'לאיזה ספורט?',
    gym: 'חדר כושר',
    cycling: 'רכיבה',
    water: 'ספורט מים',
    ball: 'ספורט כדור',
    outdoor: 'טיולים ושטח',
    // Beauty / Jewelry
    beautyType: 'סוג פריט?',
    jewelry: 'תכשיטים',
    cosmetics: 'קוסמטיקה',
    skincare: 'טיפוח',
    accessory: 'אקססורי',
    // Vehicles
    vehicleType: 'סוג רכב?',
    car: 'רכב',
    motorcycle: 'אופנוע',
    bicycle: 'אופניים',
    scooter: 'קורקינט',
    // Books
    bookCondition: 'מצב הספר?',
    worn: 'בלוי',

    // Answer options
    yes: 'כן',
    no: 'לא',
    good: 'טוב',
    degraded: 'ירוד',
    original: 'מקורי',
    unknown: 'לא ידוע',
    replica: 'העתק',
    small: 'קטן',
    medium: 'בינוני',
    large: 'גדול',
    wood: 'עץ',
    metal: 'מתכת',
    fabric: 'בד',
    plastic: 'פלסטיק',
    leather: 'עור',
    cotton: 'כותנה',
    synthetic: 'סינטטי',
  },
};

export default T;