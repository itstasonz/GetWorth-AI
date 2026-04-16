import T from './translations';

// [CRITICAL FIX #4] Sanitize search input to prevent PostgREST filter injection
// Strips characters that could manipulate .ilike filters: %, _, (, ), ., ,
export const sanitizeSearch = (input) => {
  if (!input) return '';
  return input
    .replace(/[%_().,\\]/g, '') // Remove PostgREST special chars
    .trim()
    .slice(0, 100); // Limit length
};

export const formatPrice = (p) => p ? `₪${p.toLocaleString()}` : '';

export const timeAgo = (d, t) => {
  if (!d) return '';
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (!t) return `${days}d`;
  return days === 0 ? (t.today || 'today') : days === 1 ? (t.yesterday || 'yesterday') : `${days}${t.daysAgo || 'd ago'}`;
};

export const calcPrice = (base, cond, ans, category) => {
  if (!base) return 0;
  const disc = { newSealed: 0, likeNew: 0.15, used: 0.3, poor: 0.7 }[cond] || 0;
  let extra = 0;
  if (cond === 'used' || cond === 'poor') {
    if (ans.scratches === 'yes') extra += 0.02;
    if (ans.issues === 'yes') extra += 0.03;
    // Battery penalty ONLY for electronics with battery (phone/laptop/tablet)
    const hasBattery = category === 'Electronics' && ['devicePhone', 'deviceLaptop', 'deviceTablet'].includes(ans.deviceType);
    if (hasBattery && ans.battery === 'poor') extra += 0.02;
    if (hasBattery && ans.battery === 'degraded') extra += 0.01;
  }
  return Math.round(base * (1 - disc - extra));
};

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

export const getSellerBadgeLabel = (badge, lang) => {
  const labels = {
    eliteSeller: lang === 'he' ? '⭐ מוכר עילית' : '⭐ Elite Seller',
    topSeller: lang === 'he' ? '🏆 מוכר מוביל' : '🏆 Top Seller',
    trustedSeller: lang === 'he' ? '✓ מוכר מאומת' : '✓ Trusted',
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

export const getQualityBadge = (score, lang) => {
  if (score >= 75) return { label: lang === 'he' ? 'איכות גבוהה' : 'High Quality', color: 'green', icon: '✓' };
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
    hasBio:          !!seller.bio,
    isVerified:      !!seller.is_verified,
    isPhoneVerified: !!seller.phone_verified,
    listingsCount,
    salesCount:      seller.sales_count        || 0,
    sellerRating:    seller.rating             || 0,
    sellerRatingCount: seller.rating_count     || 0,
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
    trustedBuyer: lang === 'he' ? '✓ קונה מהימן'    : '✓ Trusted Buyer',
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