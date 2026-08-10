import T from './translations.js';

// [CRITICAL FIX #4] Sanitize search input to prevent PostgREST filter injection
// Strips characters that could manipulate .ilike filters: %, _, (, ), ., ,
export const sanitizeSearch = (input) => {
  if (!input) return '';
  return input
    .replace(/[%_().,\\]/g, '') // Remove PostgREST special chars
    .trim()
    .slice(0, 100); // Limit length
};

// formatPrice — renders exactly the number it is given.
//
// UI-003 Wave 0: this was `p ? … : ''`, which rendered ANY falsy price as an
// empty string. That made ₪0 invisible by accident and quietly promoted a
// display helper into the app's only defence against a zero valuation — a
// defence every consumer that doesn't route through it (a template literal, an
// aggregate, a chart, a persisted row) bypassed. Hiding a zero is not fixing a
// zero. It renders ₪0 now, so a zero that reaches a render site is visible as
// the bug it is; deciding whether a price EXISTS belongs to the caller, via
// hasRealPrice() or calcPrice() (which returns null, not 0).
//
// Absent input — null / undefined / '' / non-numeric — still renders '': there
// is nothing to format, which is a different statement from "the value is 0".
export const formatPrice = (p) => {
  if (p === null || p === undefined || p === '') return '';
  const n = Number(p);
  return Number.isFinite(n) ? `₪${n.toLocaleString()}` : '';
};

// hasRealPrice — the CLIENT half of the VAL-001 priced/unpriced boundary.
//
// MIRRORS isPricedMarketValue() in api/_lib/valuation-guard.js; the contract
// suite compares the two bodies and fails on drift (same arrangement as
// CONDITION_LADDER / test C-10). It is duplicated rather than imported because
// the guard is a serverless module carrying the whole envelope table, and the
// client needs one predicate, not 40 price buckets.
//
// The numeric half is NOT redundant with the status check. A result cached in
// localStorage or read back from `valuations.ai_raw_response` may have been
// produced by a deploy that predates the server-side fix, and will carry
// `pricing_status: 'ai_estimate'` over a 0 mid. This rejects it locally,
// without waiting for that data to be rewritten.
export const hasRealPrice = (mv) => {
  if (!mv) return false;
  if (mv.pricing_status === 'manual_required') return false;
  const mid = Number(mv.mid), low = Number(mv.low), high = Number(mv.high);
  if (!Number.isFinite(mid) || mid <= 0) return false;
  if (!Number.isFinite(low) || low <= 0) return false;
  if (!Number.isFinite(high) || high < mid) return false;
  return true;
};

// observedPriceMid — the ONLY way an AI-derived price may enter an observation.
//
// UI-003 Wave 0 (observations sink). `marketValue.mid` is `guardPrices.mid`
// (api/analyze.js:2710), which is a literal 0 on a degraded verdict — the guard
// emits 0/0/0 precisely so a caller that ignores `action` fails loudly. Three
// GW-005A call sites wrote that number straight into `event_payload`, so a
// REJECTED valuation was recorded as an OBSERVED market price of ₪0. The
// observations table is the declared substrate for future pricing intelligence
// (its migration says it "only COLLECTS" today), so a zero there is a landmine
// with no present symptom.
//
// Returns null — NOT 0 — for anything unpriced, because cleanPayload() in
// src/lib/observations.js DROPS null/undefined keys entirely (`if (v === null ||
// v === undefined) continue`). So the price key is simply ABSENT from the row
// while every other signal in the payload survives. That is the existing
// architecture's own encoding for "no value"; nothing new is invented here, and
// no numeric sentinel (0, -1) is written that a future AVG() could pick up.
//
// It delegates to hasRealPrice and defines NO price rule of its own. It exists
// so the rule has exactly one call site per payload rather than three inline
// ternaries — a fourth observation added later fails review by not using it,
// and the mutation suite kills any attempt to route around it.
export const observedPriceMid = (mv) => (hasRealPrice(mv) ? Number(mv.mid) : null);

// positivePriceOrNull — the CLIENT half of the Gap B reference-price rule.
//
// MIRRORS positivePriceOrNull() in api/_lib/valuation-guard.js; test PB-12
// compares the two across a generated corpus and fails on drift, the same
// arrangement as hasRealPrice / PB-08 and CONDITION_LADDER / C-10. Duplicated
// rather than imported for the same reason: the guard is a serverless module
// carrying the whole envelope table.
//
// Used for `new_retail` ONLY — a lone reference figure, normalized to a real
// number or null. It is NOT a band predicate: whether an item is priced is
// hasRealPrice's question and stays hasRealPrice's question. A degraded
// valuation may still carry a known retail price, and that fact is kept.
export const positivePriceOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// FRONTEND-005 (UX-1): normalize an Israeli phone for wa.me links.
// Returns '972XXXXXXXXX' digits (no '+') or null — FAIL CLOSED on anything
// that can't be confidently normalized, so callers can gate the WhatsApp
// action on a non-null result and never emit wa.me/972 or a malformed URL.
// Accepts: 052-123-4567, (052) 1234567, +972 52 1234567, 972521234567, 0521234567.
// This is format normalization only — it does NOT verify the number exists.
export const normalizeIsraeliPhone = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, ''); // strips +, spaces, dashes, parens
  if (!digits) return null;
  let national;
  if (digits.startsWith('972')) national = digits.slice(3);      // +972 / 972 prefix
  else if (digits.startsWith('0')) national = digits.slice(1);   // local 0-prefix
  else return null;                                              // unknown shape — fail closed
  // Israeli national significant numbers are 8–9 digits (mobile 9, starting 5).
  if (!/^[2-9]\d{7,8}$/.test(national)) return null;
  return `972${national}`;
};

export const timeAgo = (d, t) => {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (!t) return `${days}d`;
  return days === 0 ? (t.today || 'today') : days === 1 ? (t.yesterday || 'yesterday') : `${days}${t.daysAgo || 'd ago'}`;
};

// ═══════════════════════════════════════════════════════
// CONDITION PRICING (VAL-001 / decision D1)
// ═══════════════════════════════════════════════════════

// Mirrors CONDITION_LADDER in api/_lib/valuation-guard.js. The server sends its
// own versioned copy on marketValue.condition_ladder; this local constant is
// the fallback for responses that predate that field (e.g. a client running
// against an older deploy, or a cached result).
export const CONDITION_LADDER = Object.freeze({
  newSealed: 0,
  likeNew:   0.15,
  used:      0.30,
  poor:      0.70,
});

// Maps free-text / legacy condition strings onto the four ladder rungs.
// Returns null for anything unrecognized — callers MUST treat null as
// "no condition information", never as a rung.
export const normalizeConditionBasis = (s) => {
  const k = String(s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!k) return null;
  if (k === 'newsealed' || k === 'new' || k === 'sealed' || k === 'brandnew') return 'newSealed';
  if (k === 'likenew' || k === 'excellent' || k === 'mint' || k === 'openbox') return 'likeNew';
  if (k === 'used' || k === 'good' || k === 'fair') return 'used';
  if (k === 'poor' || k === 'damaged' || k === 'forparts' || k === 'broken') return 'poor';
  return null;
};

// A ladder that arrived over the wire is untrusted input: it must be a plain
// object whose four rungs are all finite numbers, or we ignore it entirely.
// A partially-valid ladder is rejected rather than merged — mixing a server
// rung with a local one would silently produce a delta neither side intended.
const resolveLadder = (wire) => {
  if (!wire || typeof wire !== 'object') return CONDITION_LADDER;
  const keys = Object.keys(CONDITION_LADDER);
  const ok = keys.every((k) => Number.isFinite(wire[k]));
  return ok ? wire : CONDITION_LADDER;
};

// conditionDelta — RESIDUAL adjustment, never an absolute discount.
// Stage 2 already prices the item AT its observed condition (condition_basis),
// so applying the absolute ladder on top of that marked the same wear down
// twice (a used item took the model's used-price AND another 30%).
// The residual is ladder[userCond] - ladder[basis]: re-picking the basis
// condition is a no-op, and only the user's DISAGREEMENT with the model moves
// the price.
// FAIL-SAFE (binding, VAL-001 D1): an absent or unmappable basis yields 0.
// Condition is applied exactly once — by the server, or here — never twice.
// There is deliberately no fallback to the old absolute discount.
export const conditionDelta = (basis, userCond, ladder = CONDITION_LADDER) => {
  const b = normalizeConditionBasis(basis);
  const u = normalizeConditionBasis(userCond);
  if (!b || !u) return 0;
  const from = ladder[b];
  const to = ladder[u];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return to - from;
};

// calcPrice — the listing flow's suggested price.
//
// Returns `null` — NOT 0 — when there is no computable price. 0 is a real
// price and rendering it reads as "this item is worth nothing"; null means
// "the user has to tell us", which is what manual_required actually is.
//
// `mv` is the whole marketValue object (it carries mid/low/high, the basis and
// the ladder). A bare number is still accepted and treated as `{ mid }`, which
// degrades to delta 0 — that keeps the fail-safe intact if a call site is
// updated later than this function.
export const calcPrice = (mv, cond, ans = {}, category) => {
  const m = (mv && typeof mv === 'object') ? mv : { mid: mv };

  // UI-003 Wave 0: "does a price exist?" is decided in ONE place. The bare
  // number form carries no band, so it cannot satisfy the object gate and is
  // checked on mid alone — preserving the documented degrade-to-delta-0 path.
  const priced = (mv && typeof mv === 'object')
    ? hasRealPrice(m)
    : Number.isFinite(Number(m.mid)) && Number(m.mid) > 0;
  if (!priced) return null;

  const base = Number(m.mid);

  const ladder = resolveLadder(m.condition_ladder);
  const delta = conditionDelta(m.condition_basis, cond, ladder);

  // Answer-driven wear extras stay ABSOLUTE. They encode what the user can see
  // and the model could not, so they are independent of the basis and apply
  // even when the delta fails safe to 0.
  let extra = 0;
  if (cond === 'used' || cond === 'poor') {
    if (ans.scratches === 'yes') extra += 0.02;
    if (ans.issues === 'yes') extra += 0.03;
    // Battery penalty ONLY for electronics with battery (phone/laptop/tablet)
    const hasBattery = category === 'Electronics' && ['devicePhone', 'deviceLaptop', 'deviceTablet'].includes(ans.deviceType);
    if (hasBattery && ans.battery === 'poor') extra += 0.02;
    if (hasBattery && ans.battery === 'degraded') extra += 0.01;
  }

  const price = Math.round(base * (1 - delta - extra));

  // UPSIDE clamp only (lead ruling, VAL-001 D1). An inverted delta — basis
  // 'poor' + user 'newSealed' = -0.70 — would otherwise inflate the suggested
  // price 70% above the server's own estimate on nothing but client input, so
  // the validated `high` caps it.
  //
  // There is deliberately NO downside clamp. `low` is the server's band at the
  // BASIS condition, and a user reporting worse-than-observed condition is
  // giving us information the model did not have: basis 'newSealed' + user
  // 'poor' should reach base*0.30 even though `low` is typically base*0.75.
  // Clamping there would swallow the markdown and quietly re-introduce the
  // "condition barely moves the price" bug from the other direction.
  const high = Number(m.high);
  const price2 = (Number.isFinite(high) && high > 0) ? Math.min(price, high) : price;

  // UI-003 Wave 0: null, not 0 — the same rule this function already applies to
  // its INPUT now applies to its OUTPUT. At maximum markdown the factor bottoms
  // out at 1 - 0.70 (newSealed basis, poor user condition) - 0.07 (scratches +
  // issues + battery) = 0.23, so a ₪2 mid rounds to 0. Callers branch on
  // `=== null` alone (SellViews: null renders "set your own price", anything
  // else renders a celebratory green "Your Price" card and prefills the field),
  // so a 0 would have shown "₪0" as a suggested price and prefilled a value
  // publishListing then silently rejects as a missing field.
  return price2 > 0 ? price2 : null;
};

// CHAT-002: image messages are stored as `__chat_img__<url>` (see ChatViews).
// Previews (inbox rows, notification banners) must never show the raw marker.
export const CHAT_IMG_PREFIX = '__chat_img__';
export const formatMessagePreview = (content, lang) =>
  typeof content === 'string' && content.startsWith(CHAT_IMG_PREFIX)
    ? (lang === 'he' ? '📷 תמונה' : '📷 Photo')
    : content;

export const formatMessageTime = (date, lang) => {
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return lang === 'he' ? 'אתמול' : 'Yesterday';
  return d.toLocaleDateString();
};

// [IMPORTANT FIX #2] Condition label lookup - uses translations instead of hardcoded English
export const getConditionLabel = (condition, lang) => {
  const t = T?.[lang] || T?.he || {};
  const labels = {
    newSealed: { text: t?.newSealed || 'New', emoji: '✨' },
    likeNew: { text: t?.likeNew || 'Like New', emoji: '' },
    used: { text: t?.used || 'Used', emoji: '' },
    poor: { text: t?.poor || 'Poor', emoji: '' },
  };
  const entry = labels[condition];
  if (!entry) return '';
  return entry.emoji ? `${entry.emoji} ${entry.text}` : entry.text;
};

export const getConditionColor = (condition) => {
  const map = {
    newSealed: 'bg-emerald-500',
    likeNew: 'bg-[#6FEEE1]',
    used: 'bg-amber-500',
    poor: 'bg-red-500',
  };
  return map[condition] || 'bg-slate-500';
};

export const getConditionColorAlpha = (condition) => {
  const map = {
    newSealed: 'bg-emerald-500/90',
    likeNew: 'bg-[#6FEEE1]/90',
    used: 'bg-amber-500/90',
    poor: 'bg-red-500/90',
  };
  return map[condition] || 'bg-slate-500/90';
};

// [IMPORTANT FIX #3] Badge color lookup - replaces dynamic Tailwind class generation
// Dynamic classes like `bg-${color}-500/20` get purged by Tailwind JIT.
// Use explicit class maps instead.
export const BADGE_COLORS = {
  blue: {
    bg: 'bg-[#6FEEE1]/10',
    text: 'text-[#6FEEE1]',
    border: 'border-[#6FEEE1]/30',
  },
  green: {
    bg: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500/30',
  },
  red: {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500/30',
  },
  yellow: {
    bg: 'bg-yellow-500/20',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
  },
  purple: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    border: 'border-purple-500/30',
  },
  slate: {
    bg: 'bg-slate-500/20',
    text: 'text-slate-400',
    border: 'border-slate-500/30',
  },
};

// Profile stat color lookup (same fix - avoids dynamic tailwind)
export const STAT_COLORS = {
  blue: { icon: 'text-[#6FEEE1]', value: 'text-[#6FEEE1]' },
  green: { icon: 'text-green-400', value: 'text-green-400' },
  red: { icon: 'text-red-400', value: 'text-red-400' },
};

// Seller badge styles
export const getSellerBadgeStyle = (badge) => {
  const map = {
    eliteSeller: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', gradient: 'from-yellow-500 to-amber-600', shadow: 'shadow-yellow-500/30' },
    topSeller: { bg: 'bg-purple-500/20', text: 'text-purple-400', gradient: 'from-purple-500 to-pink-600', shadow: 'shadow-purple-500/30' },
    trustedSeller: { bg: 'bg-[#6FEEE1]/10', text: 'text-[#6FEEE1]', gradient: 'from-[#6FEEE1] to-[#4FD1C5]', shadow: 'shadow-[#6FEEE1]/20' },
    newSeller: { bg: 'bg-slate-500/20', text: 'text-slate-400', gradient: 'from-slate-500 to-slate-600', shadow: 'shadow-slate-500/30' },
  };
  return map[badge] || map.newSeller;
};

// UI-002 PHASE 0 / trust fix 1 — "verified" is reserved for facts an operator checked.
//
// `trustedSeller` is a SCORE-DERIVED tier: computeTrustScore can cross its
// threshold from profile completeness + account age alone, with zero completed
// sales and no identity check (see computeTrustScore below). Its Hebrew label
// used to read "מוכר מאומת" — the exact string AuthProfileView renders for a
// seller who actually passed operator identity review. In English the two read
// "Trusted" vs "Verified Seller" and are clearly distinct; in Hebrew — the app's
// DEFAULT language — they were identical, so the tier silently claimed a
// verification the user did not have, and simultaneously made the real badge
// worthless by being indistinguishable from the free one.
//
// מהימן (reliable) is now used for the earned-by-score tier; מאומת (verified)
// is reserved exclusively for `is_verified` — a flag an operator sets by hand
// after reviewing a selfie (AdminPanel), which is a real check by a real person.
// Do not reintroduce מאומת into any formula-derived label.
//
// UI-003 Wave 0 CORRECTION: this comment used to bless `serial_verified` too.
// That was wrong, and because this comment is the rule future readers cite, the
// error propagated — a buyer-facing 'מספר סידורי אומת' chip shipped on its back.
// `serial_verified` is NOT operator-checked: it is true when a regex saw "S/N"
// beside six characters in OCR (extractSerialFromOCR below), or when a seller
// TYPED eight or more characters (AppContext submitSerialText). It is a
// self-asserted string. Nothing derived from it may use מאומת / אומת / Verified
// or a checkmark. The flag itself is unchanged pending a data-model decision.
export const getSellerBadgeLabel = (badge, lang) => {
  const labels = {
    eliteSeller: lang === 'he' ? '⭐ מוכר עילית' : '⭐ Elite Seller',
    topSeller: lang === 'he' ? '🏆 מוכר מוביל' : '🏆 Top Seller',
    // The ✓ is dropped along with the wording: a checkmark glyph IS the
    // credential signal, so keeping it would have preserved the "the platform
    // vouches for this person" reading that the label change exists to remove.
    trustedSeller: lang === 'he' ? 'מוכר מהימן' : 'Trusted',
    newSeller: lang === 'he' ? '🆕 מוכר חדש' : '🆕 New Seller',
  };
  return labels[badge] || labels.newSeller;
};

// ─── Listing quality score (0–100) ───
// Computed at publish time and stored in DB
export const computeQualityScore = ({ title, description, images, condition, price, category }) => {
  let score = 0;
  if (title && title.length > 8) score += 20; else if (title) score += 8;
  if (description && description.length > 30) score += 20; else if (description && description.length > 0) score += 8;
  if (images && images.length >= 2) score += 20; else if (images && images.length === 1) score += 10;
  if (condition) score += 15;
  if (price && price > 0) score += 15;
  if (category && category !== 'Other') score += 10; else if (category) score += 5;
  return Math.min(100, score);
};

// UI-002A / trust fix 4 — listing-COPY quality is not a credential.
//
// This scores how well the SELLER wrote the ad (title length, description
// length, photo count). It says nothing about the item, the seller's identity,
// or whether anyone checked anything. It was nonetheless rendered to buyers as
// a green pill with a ✓ glyph — the same shape and the same checkmark the app
// uses for operator-verified identity — so a well-written ad for a dubious item
// out-signalled a terse ad from a verified seller.
//
// The ✓ is removed here because a checkmark IS the credential signal; the
// remaining tiers keep their glyphs because they are only ever shown to the
// seller who wrote the copy, where "~" and "!" read as editing feedback.
// Buyer-facing render sites are gone entirely — see ListingCard and
// BrowseDetailView.
export const getQualityBadge = (score, lang) => {
  if (score >= 75) return { label: lang === 'he' ? 'איכות גבוהה' : 'High Quality', color: 'green', icon: '' };
  if (score >= 45) return { label: lang === 'he' ? 'סביר' : 'Fair', color: 'yellow', icon: '~' };
  return { label: lang === 'he' ? 'שפר מודעה' : 'Improve', color: 'red', icon: '!' };
};

// ═══════════════════════════════════════════════════════
// TRUST + RATING SYSTEM
// ═══════════════════════════════════════════════════════

// ─── computeTrustScore — canonical trust engine ───
// Accepts a rich metrics object. All fields are optional (safe defaults to 0/false).
// Returns { score: 0-100, badge, buyerBadge }
export const computeTrustScore = (metrics = {}) => {
  const {
    hasFullName = false,
    hasAvatar = false,
    hasBio = false,
    isVerified = false,
    isPhoneVerified = false,
    listingsCount = 0,
    salesCount = 0,
    purchasesCount = 0,
    sellerRating = 0,
    sellerRatingCount = 0,
    buyerRating = 0,
    buyerRatingCount = 0,
    accountAgeDays = 0,
  } = metrics;

  let score = 0;

  // Profile completeness — up to 20 pts
  if (hasFullName)    score += 5;
  if (hasAvatar)      score += 5;
  if (hasBio)         score += 5;
  if (isPhoneVerified) score += 5;

  // Identity verification — up to 15 pts
  if (isVerified) score += 15;

  // Seller activity — up to 25 pts (salesCount preferred over listingsCount)
  if (salesCount >= 20)       score += 25;
  else if (salesCount >= 10)  score += 20;
  else if (salesCount >= 3)   score += 14;
  else if (salesCount >= 1)   score += 8;
  else if (listingsCount >= 10) score += 15;
  else if (listingsCount >= 5)  score += 10;
  else if (listingsCount >= 1)  score += 5;

  // Seller ratings — up to 30 pts
  if (sellerRating >= 4.7 && sellerRatingCount >= 10) score += 30;
  else if (sellerRating >= 4.5 && sellerRatingCount >= 5) score += 25;
  else if (sellerRating >= 4.0 && sellerRatingCount >= 3) score += 17;
  else if (sellerRating >= 3.5 && sellerRatingCount >= 1) score += 10;
  else if (sellerRatingCount >= 1)                        score += 5;

  // Account age — up to 10 pts
  if (accountAgeDays >= 365)      score += 10;
  else if (accountAgeDays >= 180) score += 8;
  else if (accountAgeDays >= 90)  score += 5;
  else if (accountAgeDays >= 30)  score += 3;
  else if (accountAgeDays >= 7)   score += 1;

  const finalScore = Math.min(100, score);

  // Seller badge thresholds
  let badge = 'newSeller';
  if (finalScore >= 85)      badge = 'eliteSeller';
  else if (finalScore >= 65) badge = 'topSeller';
  else if (finalScore >= 40) badge = 'trustedSeller';

  // Buyer badge (separate axis — based on purchases + buyer ratings)
  let buyerBadge = 'newBuyer';
  const buyerPts = (purchasesCount >= 10 ? 40 : purchasesCount >= 3 ? 25 : purchasesCount >= 1 ? 10 : 0)
    + (buyerRating >= 4.5 && buyerRatingCount >= 3 ? 40 : buyerRating >= 4.0 && buyerRatingCount >= 1 ? 25 : buyerRatingCount >= 1 ? 10 : 0);
  if (buyerPts >= 60)      buyerBadge = 'topBuyer';
  else if (buyerPts >= 25) buyerBadge = 'trustedBuyer';

  return { score: finalScore, badge, buyerBadge };
};

// ─── computeSellerTrust — backward-compatible wrapper ───
// Old call: computeSellerTrust(seller, listingsCount)
// Now delegates to computeTrustScore internally.
export const computeSellerTrust = (seller, listingsCount = 0) => {
  if (!seller) return { badge: 'newSeller', trustScore: 0 };
  const result = computeTrustScore({
    hasFullName:     !!(seller.full_name && seller.full_name.length > 2),
    hasAvatar:       !!seller.avatar_url,
    hasBio:          false, // bio column removed from live schema
    isVerified:      !!seller.is_verified,
    // SECURITY-002: the live column is is_phone_verified (server-controlled);
    // phone_verified never existed, so this trust input was always 0.
    isPhoneVerified: !!(seller.is_phone_verified ?? seller.phone_verified),
    listingsCount,
    // FRONTEND-008B: the live schema's fields are total_sales/review_count —
    // the old names (sales_count/rating_count) don't exist on profiles, so
    // these inputs were silently 0 and the trust score undercounted every
    // seller with sales or ratings. Old names kept as fallback for callers
    // passing legacy shapes.
    salesCount:      seller.total_sales  ?? seller.sales_count  ?? 0,
    sellerRating:    seller.rating             || 0,
    sellerRatingCount: seller.review_count ?? seller.rating_count ?? 0,
    accountAgeDays:  seller.created_at
      ? Math.floor((Date.now() - new Date(seller.created_at)) / 86400000)
      : 0,
  });
  return { badge: result.badge, trustScore: result.score };
};

// ─── Buyer badge styles ───
export const getBuyerBadgeStyle = (badge) => {
  const map = {
    topBuyer:     { bg: 'bg-purple-500/20', text: 'text-purple-400', gradient: 'from-purple-500 to-pink-600',     shadow: 'shadow-purple-500/30' },
    trustedBuyer: { bg: 'bg-[#6FEEE1]/10',  text: 'text-[#6FEEE1]',  gradient: 'from-[#6FEEE1] to-[#4FD1C5]',   shadow: 'shadow-[#6FEEE1]/20' },
    newBuyer:     { bg: 'bg-slate-500/20',   text: 'text-slate-400',  gradient: 'from-slate-500 to-slate-600',    shadow: 'shadow-slate-500/30' },
  };
  return map[badge] || map.newBuyer;
};

export const getBuyerBadgeLabel = (badge, lang) => {
  const labels = {
    topBuyer:     lang === 'he' ? '🏆 קונה מוביל'   : '🏆 Top Buyer',
    // ✓ dropped for the same reason as `trustedSeller` above: `trustedBuyer` is
    // reached from purchase count and rating alone, with no identity check, so
    // a checkmark asserts a verification that nobody performed.
    trustedBuyer: lang === 'he' ? 'קונה מהימן'      : 'Trusted Buyer',
    newBuyer:     lang === 'he' ? '🆕 קונה חדש'     : '🆕 New Buyer',
  };
  return labels[badge] || labels.newBuyer;
};

// ─── Trust level label (for 0-100 score display) ───
export const getTrustLevelLabel = (score, lang) => {
  if (score >= 85) return lang === 'he' ? 'עילית'      : 'Elite';
  if (score >= 65) return lang === 'he' ? 'מוביל'      : 'Top Rated';
  if (score >= 40) return lang === 'he' ? 'מהימן'      : 'Trusted';
  if (score >= 20) return lang === 'he' ? 'מוכר חדש'   : 'New Seller';
  return                lang === 'he' ? 'מתחיל'        : 'Starter';
};

// ─── Rating display helpers ───

// formatUserRating — "4.8 ★ (23 ביקורות)" / "No reviews yet"
export const formatUserRating = (avg, count, lang) => {
  if (!count || count === 0) return lang === 'he' ? 'אין ביקורות עדיין' : 'No reviews yet';
  const formatted = Number(avg).toFixed(1);
  const countLabel = lang === 'he' ? `(${count} ביקורות)` : `(${count} review${count === 1 ? '' : 's'})`;
  return `${formatted} ★ ${countLabel}`;
};

// getRatingStars — returns array of 'full' | 'half' | 'empty' for rendering 5 stars
export const getRatingStars = (rating, maxStars = 5) => {
  const stars = [];
  for (let i = 1; i <= maxStars; i++) {
    const diff = rating - (i - 1);
    if (diff >= 0.75)      stars.push('full');
    else if (diff >= 0.25) stars.push('half');
    else                   stars.push('empty');
  }
  return stars;
};

// getReviewSummary — compute avg/distribution from a reviews array
// reviews: [{ rating, reviewer_role }]
export const getReviewSummary = (reviews = []) => {
  const seller = reviews.filter(r => r.reviewer_role === 'buyer');   // buyer reviewed the seller
  const buyer  = reviews.filter(r => r.reviewer_role === 'seller');  // seller reviewed the buyer

  const avg = (arr) => arr.length ? arr.reduce((s, r) => s + r.rating, 0) / arr.length : 0;
  const dist = reviews.reduce((acc, r) => {
    acc[r.rating] = (acc[r.rating] || 0) + 1;
    return acc;
  }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

  return {
    asSellerAvg:   parseFloat(avg(seller).toFixed(1)),
    asSellerCount: seller.length,
    asBuyerAvg:    parseFloat(avg(buyer).toFixed(1)),
    asBuyerCount:  buyer.length,
    overall:       parseFloat(avg(reviews).toFixed(1)),
    total:         reviews.length,
    distribution:  dist,
  };
};

// Pagination constants
export const PAGE_SIZE = 20;

// ═══════════════════════════════════════════════════════
// SERIAL / IMEI VERIFICATION HELPERS
// ═══════════════════════════════════════════════════════

// Categories where serial/IMEI verification adds buyer trust
const SERIAL_ELIGIBLE = new Set([
  'electronics', 'watches', 'tools',
]);
const SERIAL_SUBCATEGORIES = new Set([
  'smartphone', 'tablet', 'laptop', 'camera', 'smartwatch',
  'gaming console', 'vr headset', 'drone', 'monitor', 'tv',
  'e-reader', 'action camera', 'digital piano', 'electric guitar',
  'speaker', 'headphones',
]);
// Keyword fallback — catches items where category is generic but name reveals electronics
const SERIAL_KEYWORDS = /\b(iphone|ipad|macbook|galaxy|pixel|xbox|playstation|ps5|nintendo|switch|airpods|gopro|dji|sony|canon|nikon|fuji|garmin|apple watch|meta quest)\b/i;

export const isSerialEligible = (category, subcategory, itemName) => {
  const cat = (category || '').toLowerCase();
  const sub = (subcategory || '').toLowerCase();
  if (SERIAL_ELIGIBLE.has(cat)) return true;
  if (sub && SERIAL_SUBCATEGORIES.has(sub)) return true;
  if (itemName && SERIAL_KEYWORDS.test(itemName)) return true;
  return false;
};

// Mask serial for public display: "ABCD1234EFGH" → "AB••••••GH"
export const maskSerial = (serial) => {
  if (!serial || serial.length < 6) return serial || '';
  const show = Math.max(2, Math.floor(serial.length * 0.2));
  return serial.slice(0, show) + '•'.repeat(serial.length - show * 2) + serial.slice(-show);
};

// Validate serial format per category/brand
export const validateSerialFormat = (serial, category = '', brand = '') => {
  if (!serial || serial.trim().length < 5) return false;
  const s = serial.trim().toUpperCase().replace(/[\s-]/g, '');
  const cat = category.toLowerCase();
  const br = brand.toLowerCase();

  if (br.includes('apple') || /\b(iphone|ipad|macbook|airpods)\b/.test(br)) {
    // Apple IMEI (15 digits) or serial (12 alphanumeric)
    if (/^\d{15}$/.test(s)) return true; // IMEI — Luhn checked at submit
    return s.length === 12 && /^[A-Z0-9]{12}$/.test(s);
  }
  if (br.includes('samsung')) {
    if (/^\d{15}$/.test(s)) return true;
    return s.length >= 11 && s.length <= 15 && /^[A-Z0-9]+$/.test(s);
  }
  if (cat === 'cars' || cat === 'vehicles') {
    // VIN: 17 chars, no I/O/Q
    return s.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(s);
  }
  // Generic: 5-30 alphanumeric with optional dashes/slashes
  return s.length >= 5 && s.length <= 30 && /^[A-Z0-9\-\/]+$/.test(s);
};

// Basic IMEI validation (15 digits, Luhn check)
export const validateIMEI = (str) => {
  const digits = str.replace(/\D/g, '');
  if (digits.length !== 15) return false;
  // Luhn algorithm
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = parseInt(digits[i], 10);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

// Extract likely serial/IMEI/model patterns from OCR text
export const extractSerialFromOCR = (text) => {
  if (!text) return null;
  // IMEI: 15 consecutive digits (may have spaces/dashes)
  const imeiMatch = text.match(/\b(\d[\d\s-]{13,17}\d)\b/);
  if (imeiMatch) {
    const clean = imeiMatch[1].replace(/[\s-]/g, '');
    if (clean.length === 15 && /^\d+$/.test(clean)) {
      return { type: 'imei', value: clean, verified: validateIMEI(clean) };
    }
  }
  // Serial: alphanumeric 6-30 chars (common patterns: S/N, SN, Serial, IMEI label)
  const serialMatch = text.match(/(?:S\/?N|Serial|IMEI|SN)[:\s]*([A-Z0-9]{6,30})/i);
  if (serialMatch) {
    return { type: 'serial', value: serialMatch[1].toUpperCase(), verified: true };
  }
  // Fallback: longest alphanumeric string that looks like a serial
  const candidates = text.match(/\b[A-Z0-9]{8,30}\b/g);
  if (candidates?.length) {
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    return { type: 'serial', value: best, verified: false };
  }
  return null;
};