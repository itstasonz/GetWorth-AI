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
    likeNew: 'bg-blue-500',
    used: 'bg-amber-500',
    poor: 'bg-red-500',
  };
  return map[condition] || 'bg-slate-500';
};

export const getConditionColorAlpha = (condition) => {
  const map = {
    newSealed: 'bg-emerald-500/90',
    likeNew: 'bg-blue-500/90',
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
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    border: 'border-blue-500/30',
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
  blue: { icon: 'text-blue-400', value: 'text-blue-400' },
  green: { icon: 'text-green-400', value: 'text-green-400' },
  red: { icon: 'text-red-400', value: 'text-red-400' },
};

// Seller badge styles
export const getSellerBadgeStyle = (badge) => {
  const map = {
    eliteSeller: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', gradient: 'from-yellow-500 to-amber-600', shadow: 'shadow-yellow-500/30' },
    topSeller: { bg: 'bg-purple-500/20', text: 'text-purple-400', gradient: 'from-purple-500 to-pink-600', shadow: 'shadow-purple-500/30' },
    trustedSeller: { bg: 'bg-blue-500/20', text: 'text-blue-400', gradient: 'from-blue-500 to-blue-600', shadow: 'shadow-blue-500/30' },
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

// ─── Seller trust — computed client-side from profile data ───
export const computeSellerTrust = (seller, listingsCount = 0) => {
  if (!seller) return { badge: 'newSeller', trustScore: 0 };
  let score = 0;
  // Has listings
  if (listingsCount >= 5) score += 25; else if (listingsCount >= 1) score += 10;
  // Is verified
  if (seller.is_verified) score += 25;
  // Has rating
  if (seller.rating >= 4.5) score += 25; else if (seller.rating >= 3.5) score += 15;
  // Has profile info
  if (seller.full_name && seller.full_name.length > 2) score += 10;
  if (seller.avatar_url) score += 5;
  if (seller.bio) score += 10;

  let badge = 'newSeller';
  if (score >= 70) badge = 'topSeller';
  else if (score >= 40) badge = 'trustedSeller';

  return { badge, trustScore: Math.min(100, score) };
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