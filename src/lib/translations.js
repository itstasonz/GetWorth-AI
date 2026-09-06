// ═══════════════════════════════════════════════════════
// GetWorth: Centralized Translation File
// All T[lang].key references resolved here
// Inline lang === 'he' ternaries handle component-specific text
// ═══════════════════════════════════════════════════════

const T = {
  en: {
    // App
    appName: 'GetWorth',
    tagline: 'Discover what your stuff is worth',
    welcome: 'Welcome',

    // Home Hero
    aiPowered: 'AI-Powered',
    heroTitle1: 'Know Your',
    heroTitle2: "Item's Value",
    heroSub: 'Snap or upload any item for instant AI valuation.',
    upload: 'Upload',
    drop: 'Drop image here',
    orButtons: 'or use buttons below',
    hotItems: 'Hot Items',
    seeAll: 'See All',
    sellBanner: 'Have something to sell?',
    sellBannerSub: 'Scan your item and get instant valuation',

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
    signInBuy: 'Sign in to buy — we\'ll bring you right back to this listing',
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
    live: 'Your listing is now live!',

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
    priceEvidLimited:  'Limited pricing evidence',
    priceEvidWeak:     'Weak pricing evidence',
    priceEvidNone:     'No pricing evidence',

    priceFromComps:    'Based on comparable sales',
    priceFromAi:       'AI estimate, no comparable sales',
    priceFromCatalog:  'Based on a similar catalog item',
    priceQuickEst:     'Quick estimate — verify before listing',
    priceFromCategory: 'Estimated from category data',
    priceSetManually:  'Set your own price',
    // UI-003 Wave 0: this used to read "Price subject to authenticity
    // verification", which describes a service that does not exist. Nothing
    // gates the number — `verification_required` is a LABEL, not a hold:
    // analyze.js:2439 sets it and no pricing step reads it, so the same figure
    // ships either way. The honest statement is what the price assumed.
    priceVerificationPending: 'Priced as authentic — authenticity unconfirmed',
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
    analyzing: 'Analyzing...',
    scanAnother: 'Scan Another',
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
    published: 'Published!',
    continue: 'Continue',
    listItem: 'List for Sale',
    myListings: 'My Listings',
    noListings: 'No listings yet. Scan an item to start!',

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
    failed: 'Analysis failed',
    cameraDenied: 'Camera access denied',

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
    sportType: 'Sport / activity type?',
    gym: 'Gym / Fitness',
    cycling: 'Cycling',
    water: 'Water Sports',
    ball: 'Ball Sports',
    outdoor: 'Outdoor / Hiking',
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
    tagline: 'גלו כמה שווים הדברים שלכם',
    welcome: 'ברוכים הבאים',

    // Home Hero
    aiPowered: 'AI',
    heroTitle1: 'גלה את',
    heroTitle2: 'שווי הפריט',
    heroSub: 'צלם או העלה תמונה לקבלת הערכה.',
    upload: 'העלאה',
    drop: 'גרור תמונה',
    orButtons: 'או לחץ למטה',
    hotItems: 'פריטים חמים',
    seeAll: 'הצג הכל',
    sellBanner: 'יש לכם משהו למכור?',
    sellBannerSub: 'סרקו את הפריט וקבלו הערכה מיידית',

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
    signInAccess: 'התחברו כדי לגשת לכל התכונות',
    signInSave: 'התחברו כדי לשמור פריטים',
    signInList: 'התחברו כדי לפרסם פריטים',
    signInScan: 'התחברו כדי לסרוק פריט',
    signInBuy: 'התחברו כדי לקנות — נחזיר אתכם ישר למודעה',
    google: 'המשך עם Google',
    or: 'או',
    password: 'סיסמה',
    haveAcc: 'כבר יש לך חשבון?',
    noAcc: 'אין לך חשבון?',

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
    noSaved: 'אין פריטים שמורים',
    clear: 'נקה',
    view: 'צפייה',
    more: 'פרטים נוספים',
    back: 'חזרה',
    filters: 'סינון',
    results: 'תוצאות',
    trustScore: 'ציון אמון',
    verified: 'מאומת',

    // Conditions
    condition: 'מצב',
    newSealed: 'חדש / אטום',
    likeNew: 'כמו חדש',
    used: 'משומש',
    poor: 'סביר / בלוי',

    // Pricing
    marketValue: 'שווי שוק',
    yourPrice: 'המחיר שלך',
    min: 'מינ׳',
    max: 'מקס׳',
    range: 'טווח',
    live: 'המודעה שלך פורסמה!',

    // Valuation trust (VAL-001) — must carry the SAME claim as the English.
    // The word דיוק (accuracy) is deliberately absent from this whole block:
    // it is what made the old copy read as a promise about the price.
    idConfidence:      'ביטחון בזיהוי',
    idStrong:          'התאמה חזקה',
    idModerate:        'אשר כדי לשפר את הזיהוי',
    idLow:             'דורש אישור',
    idVeryLow:         'לא זוהה בבירור',

    pricingEvidence:   'בסיס התמחור',
    priceEvidStrong:   'בסיס תמחור חזק',
    priceEvidLimited:  'בסיס תמחור מוגבל',
    priceEvidWeak:     'בסיס תמחור חלש',
    priceEvidNone:     'אין בסיס תמחור',

    priceFromComps:    'מבוסס על מכירות דומות',
    priceFromAi:       'הערכת AI, ללא מכירות דומות להשוואה',
    priceFromCatalog:  'מבוסס על פריט דומה בקטלוג',
    priceQuickEst:     'הערכה מהירה — בדוק לפני פרסום',
    priceFromCategory: 'הערכה לפי נתוני קטגוריה',
    priceSetManually:  'קבע מחיר בעצמך',
    // UI-003 Wave 0 — see the English. 'מחיר תלוי אימות אותנטיות' promised an
    // authenticity check that gates the price; no such check exists.
    priceVerificationPending: 'מתומחר כמקורי — האותנטיות לא אושרה',
    priceReplicaAdjusted:     'מחיר מותאם לרפליקה',

    estimateOnly:      'הערכה בלבד — לא מחיר מכירה מובטח.',
    enterPricePrompt:  'הזן מחיר כדי להמשיך',

    // ── אותנטיות (UI-003 Wave 0) — must carry the SAME claim as the English.
    // מאומת / אומת are deliberately absent from this entire block. They are
    // reserved for a fact an operator checked (is_verified — utils.js:271), and
    // a model reading a photograph is not one. In Hebrew, the app's DEFAULT
    // language, מאומת was the single word that made an AI guess and a real
    // credential render identically; do not reintroduce it here.
    authSerialSeen:    'AI קרא מספר סידורי',
    authDocsSeen:      'AI קרא מסמך',
    authSignsSeen:     'AI: סימני מקוריות',
    authIndicators:    'AI זיהה סימני מקוריות',
    authUncertain:     'AI לא הצליח לקבוע אותנטיות',
    authExpertAdvised: 'מומלץ אימות מומחה',
    authFakeSigns:     'AI: סימני זיוף',
    authReplicaSigns:  'AI: סימני רפליקה',
    authNotInPhotos:   'לא נראה בתמונות שלך:',

    // ── קליטת מספר סידורי (UI-003 Wave 0) — see the English.
    // אומת / מאומת are deliberately absent: nothing here was checked. The buyer
    // chip names the SELLER as the source of the claim.
    serialCaptured:    'מספר סידורי נקלט',
    imeiCaptured:      'IMEI נקלט',
    serialProvided:    'מספר סידורי שסופק ע״י המוכר',

    // מספר סידורי — ראה את האנגלית. אין כאן אימות, ולכן אין כאן אומת/מאומת.
    serialAdded:       'מספר סידורי נוסף',
    serialAddedImei:   'IMEI נוסף',
    serialAddAction:   'הוסף',
    serialProvided:    'מספר סידורי סופק',

    // Time
    today: 'היום',
    yesterday: 'אתמול',
    daysAgo: ' ימים',

    // Scan & Analysis
    analyzing: 'מנתח...',
    scanAnother: 'סרוק פריט נוסף',
    desc: 'תיאור',
    review: 'סקירה ופרסום',
    share: 'שתף',
    sales: 'מכירות',

    // Listing Flow
    title: 'כותרת',
    phone: 'טלפון',
    location: 'מיקום',
    publish: 'פרסם מודעה',
    publishing: 'מפרסם...',
    published: 'פורסם!',
    continue: 'המשך',
    listItem: 'פרסם למכירה',
    myListings: 'המודעות שלי',
    noListings: 'אין מודעות עדיין. סרקו פריט כדי להתחיל!',

    // Auth (extended)
    signInReq: 'נדרשת התחברות',
    signInContact: 'התחבר ליצירת קשר',
    name: 'שם',
    email: 'אימייל',
    createAcc: 'צור חשבון',
    join: 'הצטרף',
    cancel: 'ביטול',

    // Contact / Seller
    contact: 'צור קשר',
    call: 'התקשר',
    whatsapp: 'וואטסאפ',
    seller: 'מוכר',
    views: 'צפיות',

    // Sort options
    newest: 'חדש',
    lowHigh: 'מחיר ↑',
    highLow: 'מחיר ↓',

    // Errors
    failed: 'הניתוח נכשל',
    cameraDenied: 'הגישה למצלמה נדחתה',

    // ─── Category-Aware Question Labels ───
    scratches: 'שריטות או נזק חיצוני?',
    issues: 'תקלות בתפקוד?',
    battery: 'מצב סוללה?',
    storage: 'נפח אחסון?',
    deviceType: 'איזה סוג מכשיר אלקטרוני?',
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
    sportType: 'סוג ספורט / פעילות?',
    gym: 'חדר כושר',
    cycling: 'רכיבה',
    water: 'ספורט מים',
    ball: 'ספורט כדור',
    outdoor: 'טיולים / שטח',
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