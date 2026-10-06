// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHAT A PRICE IS, BEFORE IT IS WORTH ANYTHING
//
// The market step's model returns prices it found and how it classified each.
// This file QUALIFIES them, with nothing taken on the model's word that the
// search record or the address itself can settle:
//
//   REAL        a price counts only if the search tool's own record shows the
//               page was reached.
//   WHOSE       and only if the text the search returned for that page shows
//               the price beside the product it is claimed for (binding.js).
//               A number that is merely somewhere on the page is not evidence.
//   WHERE       Israel or abroad. A global marketplace is abroad even when it
//               shows shekels on an Israel-facing storefront; an .il site is
//               Israel.
//   WHAT PAGE   one seller's listing, or a search / category page that lists
//               many things. A price read off a list is weaker evidence.
//   WHEN        the LISTING's own date, which is not the day we looked. A date
//               is kept only when the page's text bears it out; otherwise the
//               listing's age is UNKNOWN. Nothing is ever dated by retrieval.
//               An ad its own site files as archive is old, dated or not.
//
// Pure functions, no network. How much each price then counts is valuation.js.
// ══════════════════════════════════════════════════════════════════════════════
import { hostOf } from '../phaseb/search-provenance.js';
import { toIls } from './fx.js';
import { EVIDENCE_KINDS, EVIDENCE_MATCHES, EVIDENCE_CONDITIONS, EVIDENCE_PAGES, EVIDENCE_STOCK } from './market.js';
import { bindPrice, BOUND, BIND_REASON } from './binding.js';

export const FRESHNESS = Object.freeze(['current', 'recent', 'older', 'archived', 'unknown']);
/** A listing's age, in days, at which it stops being each class. */
export const FRESHNESS_DAYS = Object.freeze({ current: 45, recent: 180, older: 730 });

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const text = (v, max) => (typeof v === 'string' && v.replace(/\s+/g, ' ').trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);

/** Host and path of a page, without the visit's own decoration. */
export function pageKey(raw) {
  const m = /^https?:\/\/([^\s/?#]+)([^\s?#]*)/i.exec(String(raw ?? '').trim());
  const host = m ? hostOf(m[1]) : null;
  return host ? `${host}${m[2].replace(/\/+$/, '')}`.toLowerCase() : null;
}

// ── WHERE ───────────────────────────────────────────────────────────────────
// Marketplaces that sell from everywhere. Their Israel-facing storefronts
// (il.ebay.com) show overseas listings in shekels: that is a currency display,
// not an Israeli seller.
const GLOBAL_MARKETPLACE = /(^|\.)(ebay\.[a-z.]+|amazon\.[a-z.]+|aliexpress\.[a-z.]+|etsy\.com|swappa\.com|backmarket\.[a-z.]+|mercari\.com|stockx\.com|pricecharting\.com|walmart\.com|bestbuy\.com|temu\.com|reverb\.com|poshmark\.com|vinted\.[a-z.]+)$/i;

/** Israel or abroad, from the address first and the model's word only when the address does not say. */
export function localityOf(domain, claimed) {
  const host = String(domain ?? '').toLowerCase();
  if (GLOBAL_MARKETPLACE.test(host)) return 'INTL';
  if (/\.il$/.test(host)) return 'IL';
  return claimed === 'IL' ? 'IL' : 'INTL';
}

// ── WHAT PAGE ───────────────────────────────────────────────────────────────
// Address shapes that say what a page is, for the sites this market keeps
// returning (each shape was seen on the public web, 2026-10-06). The first
// that fits wins; anything not listed keeps the model's classification.
const PAGE_SHAPES = [
  // eBay: /itm/ is one listing; a product page (/p/) and every browse or search page list many.
  [/(^|\.)ebay\.[a-z.]+$/i, /^\/itm\//i, 'listing'],
  [/(^|\.)ebay\.[a-z.]+$/i, /^\/(b|sch|str|e|p|shop)\//i, 'search_or_category'],
  // Yad2's second-hand market lives on two hosts with different shapes.
  [/^market\.yad2\.co\.il$/i, /^\/products\//i, 'listing'],
  [/^market\.yad2\.co\.il$/i, /^\/(collections|search)(\/|$)/i, 'search_or_category'],
  [/(^|\.)yad2\.co\.il$/i, /^\/market\/item\//i, 'listing'],
  [/(^|\.)yad2\.co\.il$/i, /^\/(market\/collections|products)(\/|$)/i, 'search_or_category'],
  // Homeless: one ad is viewad,<id>.aspx; everything else under its second-hand board is a list.
  [/(^|\.)homeless\.co\.il$/i, /viewad/i, 'listing'],
  [/(^|\.)homeless\.co\.il$/i, /^\/yad2(\/|$)/i, 'search_or_category'],
  [/(^|\.)ad\.co\.il$/i, /^\/ad\//i, 'listing'],
  [/(^|\.)ad\.co\.il$/i, /^\/(archive\/)?c\//i, 'search_or_category'],
  [/(^|\.)facebook\.com$/i, /^\/marketplace\/item\//i, 'listing'],
  [/(^|\.)facebook\.com$/i, /^\/marketplace(\/|$)/i, 'search_or_category'],
];

/** What kind of page a price was read from. A known address shape wins over the model's word. */
export function pageTypeOf(url, claimed) {
  const m = /^https?:\/\/([^\s/?#]+)([^\s?#]*)/i.exec(String(url ?? ''));
  if (m) {
    const host = hostOf(m[1]) ?? '';
    let path = m[2] || '/';
    try { path = decodeURIComponent(path); } catch { /* keep as is */ }
    for (const [h, p, type] of PAGE_SHAPES) if (h.test(host) && p.test(path)) return type;
  }
  return EVIDENCE_PAGES.includes(claimed) ? claimed : 'other';
}

// ── WHEN ────────────────────────────────────────────────────────────────────
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;
// "3 days ago", "לפני שבועיים", "posted today": each as the age in days it states.
const UNIT_DAYS = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365, דקה: 0, דקות: 0, שעה: 0, שעות: 0, שעתיים: 0, יום: 1, ימים: 1, יומיים: 2, שבוע: 7, שבועות: 7, שבועיים: 14, חודש: 30, חודשים: 30, חודשיים: 60, שנה: 365, שנים: 365, שנתיים: 730 };
const AGO_EN = /(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago/gi;
const AGO_HE = /לפני\s+(?:(\d+)\s+)?(דקות|דקה|שעתיים|שעות|שעה|יומיים|ימים|יום|שבועיים|שבועות|שבוע|חודשיים|חודשים|חודש|שנתיים|שנים|שנה)/g;
const POSTED_TODAY = /((posted|listed|updated|added)\s+today|(פורסם|פורסמה|עודכן|עודכנה|הועלה|נוסף)\s+היום)/i;
const YESTERDAY = /(\byesterday\b|אתמול)/i;

/** Every age, in days, that a page's text states in relative words. */
function statedAges(pageText) {
  const ages = [];
  for (const m of pageText.matchAll(AGO_EN)) ages.push((/^\d+$/.test(m[1]) ? Number(m[1]) : 1) * UNIT_DAYS[m[2].toLowerCase()]);
  for (const m of pageText.matchAll(AGO_HE)) ages.push((m[1] ? Number(m[1]) : 1) * UNIT_DAYS[m[2]]);
  if (POSTED_TODAY.test(pageText)) ages.push(0);
  if (YESTERDAY.test(pageText)) ages.push(1);
  return ages;
}

/**
 * The listing's own date as YYYY-MM-DD, or null.
 *
 * The model reports a date only when the page shows one, and that is checked:
 * the date must be a real past date AND the page's text must bear it out —
 * that day and month written on the page, or an age in words ("3 days ago",
 * "לפני שבועיים") that comes to that date. A year alone proves nothing: every
 * footer has one. With no page text to check against, there is no date. An
 * invented date is worse than an unknown one.
 */
export function listedDate(raw, pageText, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim());
  if (!m || !pageText) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  const now = Date.parse(`${String(today ?? '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(now) || t > now + DAY_MS || Number(m[1]) < 2005) return null;
  const age = (now - t) / DAY_MS;
  const [d, mo, y2] = [String(Number(m[3])), String(Number(m[2])), m[1].slice(2)];
  const sep = '[./-]';
  const full = new RegExp(`(^|[^\\d])(0?${d}${sep}0?${mo}${sep}(${m[1]}|${y2})|${m[1]}${sep}0?${mo}${sep}0?${d})([^\\d]|$)`);
  // A day and month with no year on the page can only mean the last twelve months.
  const short = new RegExp(`(^|[^\\d./-])0?${d}${sep}0?${mo}([^\\d./-]|$)`);
  const month = MONTHS[Number(m[2]) - 1];
  const named = new RegExp(`(${month}[a-z]*\\.?\\s+0?${d}(\\D|$)|(^|\\D)0?${d}\\s+${month})`, 'i');
  if (full.test(pageText) || ((short.test(pageText) || named.test(pageText)) && age <= 365)) return iso;
  // An age in words must come to the claimed date, within two days or a quarter of the age.
  return statedAges(pageText).some((stated) => Math.abs(age - stated) <= Math.max(2, stated * 0.25)) ? iso : null;
}

// An ad the site itself keeps as history: an archive address, or the archive notice on the page.
const ARCHIVE_ADDRESS = /\/archive\//i;
const ARCHIVE_NOTICE = /(מודעת ארכיון|archived (ad|listing)|this (ad|listing) (has|is) (expired|ended|no longer))/i;
/** Does the site itself say this ad is no longer live? */
export function isArchived(url, pageText) {
  return ARCHIVE_ADDRESS.test(String(url ?? '')) || ARCHIVE_NOTICE.test(String(pageText ?? ''));
}

/**
 * How old a listing is today. With no listing date it is UNKNOWN, whenever it
 * was retrieved — unless its own site files it as archive, and then it is
 * ARCHIVED: old by the site's word, with no date invented for it.
 */
export function freshnessOf(listed, today, archived = false) {
  const t = Date.parse(`${String(listed ?? '').slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${String(today ?? '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(now)) return archived === true ? 'archived' : 'unknown';
  const days = (now - t) / 86_400_000;
  if (days <= FRESHNESS_DAYS.current) return 'current';
  if (days <= FRESHNESS_DAYS.recent) return 'recent';
  if (days <= FRESHNESS_DAYS.older) return 'older';
  return 'archived';
}

// ── REAL ────────────────────────────────────────────────────────────────────
/**
 * Bind each claimed price to the search record and qualify it.
 *
 * Returns the evidence that stands and how many claims named a page the search
 * never reached. `seen` is the day of retrieval; `listed` is the listing's own
 * date. They are separate fields and one never becomes the other.
 *
 * `item` is { identity, answer }: what the price has to belong to. Each record
 * carries how well the page's own text ties its price to that product
 * (`binding`); only a tied price may later be priced from.
 */
export function verifyEvidence(rawEvidence, provenance, fx = null, seen = null, item = null) {
  const reached = new Map();
  for (const url of Array.isArray(provenance?.sources) ? provenance.sources : []) {
    const key = pageKey(url);
    if (key && !reached.has(key)) reached.set(key, url);
  }
  const pageText = new Map();
  const pageTitle = new Map();
  for (const r of Array.isArray(provenance?.results) ? provenance.results : []) {
    const key = pageKey(r?.url);
    // The title and the snippet each on a line of their own: two lines are two rows.
    const body = [r?.title, r?.text].filter((v) => typeof v === 'string').join('\n');
    if (key && body) pageText.set(key, `${pageText.get(key) ?? ''}\n${body}`);
    if (key && typeof r?.title === 'string' && r.title.trim() && !pageTitle.has(key)) pageTitle.set(key, r.title);
  }

  const evidence = [];
  const dedupe = new Set();
  let unverified = 0;
  for (const e of Array.isArray(rawEvidence) ? rawEvidence : []) {
    const price = finite(e?.price);
    const key = pageKey(e?.url);
    if (!price || !key || !provenance?.search_performed || !reached.has(key)) { unverified += 1; continue; }
    const currency = /^(ils|nis|₪|ש"?ח|שקל.*)$/i.test(String(e?.currency ?? '').trim()) ? 'ILS' : String(e?.currency ?? '').trim().toUpperCase().slice(0, 3);
    if (!/^[A-Z]{3}$/.test(currency)) { unverified += 1; continue; }
    const id = `${key}|${price}|${currency}`;
    if (dedupe.has(id)) continue;
    dedupe.add(id);
    const url = reached.get(key);
    const domain = hostOf(url);
    const ils = toIls(price, currency, fx);
    const page = pageTypeOf(url, e?.page);
    const claimed = EVIDENCE_MATCHES.includes(e?.match) ? e.match : 'irrelevant';
    const shipping = finite(e?.shipping);
    const bound = bindPrice({ price, currency, title: e?.title, match: claimed, shipping }, { type: page, title: pageTitle.get(key), text: pageText.get(key) }, item?.identity, item?.answer);
    evidence.push({
      url,
      domain,
      title: text(e?.title, 120),
      price,
      currency,
      price_ils: ils ? Math.round(ils) : null,
      kind: EVIDENCE_KINDS.includes(e?.kind) ? e.kind : 'other',
      // What the row itself shows wins over what was claimed for it: "exact" beside another size is a comparable.
      match: bound.match ?? claimed,
      ...(bound.match && bound.match !== claimed ? { match_claimed: claimed } : {}),
      market: localityOf(domain, e?.market),
      condition: EVIDENCE_CONDITIONS.includes(e?.condition) ? e.condition : 'unknown',
      page,
      binding: bound.level,
      binding_reason: bound.reason,
      // A shop's stock, and a listing's shipping, as the page states them. Kept with the price they qualify.
      stock: EVIDENCE_STOCK.includes(e?.stock) ? e.stock : 'unknown',
      shipping,
      shipping_ils: shipping ? Math.round(toIls(shipping, currency, fx) ?? 0) || null : null,
      listed: listedDate(e?.listed, pageText.get(key), seen),
      archived: isArchived(url, pageText.get(key)),
      seen,
    });
  }
  return { evidence, unverified };
}

/**
 * Evidence kept from an earlier search, read by today's rules: where it is from
 * and what kind of page it was are settled from its address again, so research
 * gathered before a rule existed is not exempt from it. Its prices, its
 * classification and its listing date are left exactly as they were verified,
 * and so is whether its price was ever tied to its product: that can only be
 * shown from the page text of the day, which is not kept.
 */
export function requalify(e) {
  if (!e || typeof e !== 'object' || !e.url) return e;
  const domain = e.domain ?? hostOf(e.url);
  // Research kept from before a price had to be tied to its product holds no proof that it was: it does not count.
  const proven = Object.values(BOUND).includes(e.binding);
  return {
    ...e, market: localityOf(domain, e.market), page: pageTypeOf(e.url, e.page), listed: e.listed ?? null, archived: e.archived === true || isArchived(e.url, null),
    binding: proven ? e.binding : BOUND.WEAK, binding_reason: proven ? e.binding_reason ?? null : BIND_REASON.LEGACY,
  };
}

/**
 * Earlier evidence for the same item joined with what this search found: the
 * newer sighting of a page wins, and the pool is bounded. A valuation that
 * rests on more references moves less with whichever listings happened to
 * appear today. A listing's own date travels with it, so pooled evidence ages.
 */
export function mergeEvidence(fresh, earlier, max = 20) {
  const byPage = new Map();
  for (const e of [...(Array.isArray(fresh) ? fresh : []), ...(Array.isArray(earlier) ? earlier : [])]) {
    const id = `${pageKey(e?.url)}|${e?.price}|${e?.currency}`;
    if (e?.url && !byPage.has(id)) byPage.set(id, e);
  }
  return [...byPage.values()].slice(0, max);
}
