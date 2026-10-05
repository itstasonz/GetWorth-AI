// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — WHAT KIND OF PLACE A RESULT CAME FROM
//
// THE LIVE PROBE. An eBay Israel row read "Apple iPhone 13 - 128 GB … ILS
// 622.13 Used": eBay's own conversion of a foreign seller's price into the
// market's currency. Classed by its currency it is a LOCAL used listing. It is
// not. Where a price was asked is a fact about the SITE, not about the symbol
// beside the number, so locale is decided here, from the host, and never from
// the currency.
//
// Source type is a LABEL that weighs evidence; it admits nothing by itself.
// The lists below are kinds of site, not an allowlist of the acceptable
// Internet: a host on none of them is typed by what its page says. A market's
// own hosts are those under its site suffixes (phaseb/config.js), and nothing
// here names a marketplace of this market.
// ══════════════════════════════════════════════════════════════════════════════
import { sourceSite } from '../source-site.js';

export const SOURCE_TYPE = Object.freeze({
  LOCAL_USED_MARKETPLACE: 'LOCAL_USED_MARKETPLACE',
  LOCAL_RETAIL: 'LOCAL_RETAIL',
  INTERNATIONAL_USED_MARKETPLACE: 'INTERNATIONAL_USED_MARKETPLACE',
  INTERNATIONAL_RETAIL: 'INTERNATIONAL_RETAIL',
  MANUFACTURER: 'MANUFACTURER',
  PRICE_COMPARISON: 'PRICE_COMPARISON',
  FORUM: 'FORUM',
  SOCIAL: 'SOCIAL',
  EDITORIAL: 'EDITORIAL',
  DOCUMENTATION: 'DOCUMENTATION',
  IRRELEVANT: 'IRRELEVANT',
  UNKNOWN: 'UNKNOWN',
});
export const LOCALE = Object.freeze({ LOCAL: 'local', INTERNATIONAL: 'international' });

// Registrable sites of one KIND, wherever they are hosted. Membership says
// what the site is for; it grants nothing.
const USED_MARKETPLACE_SITES = /^(ebay|craigslist|swappa|mercari|vinted|depop|olx|opensooq|gumtree|leboncoin|kleinanzeigen|subito|wallapop|marktplaats|backmarket|reverb|grailed|stockx|poshmark|offerup|facebook)\./i;
const SOCIAL_SITES = /^(facebook|instagram|tiktok|x|twitter|threads|pinterest|youtube)\./i;
const FORUM_SITES = /^(reddit|quora|stackexchange)\./i;
const IRRELEVANT_SITES = /^(wikipedia|wikimedia|wiktionary|arxiv|apps\.apple|play\.google|github)\./i;
const FORUM_URL = /\/(forums?|threads?|comments|community|discussions?)\//i;
const DOC_URL = /\.pdf(\?|$)|\/(manuals?|support|user-guide|downloads?)\//i;
const DOC_TEXT = /\b(user manual|user guide|owner'?s manual|instruction manual|quick start)\b|מדריך למשתמש|הוראות הפעלה|הוראות שימוש/iu;
const COMPARISON_TEXT = /price comparison|compare prices|השוואת מחירים|השוואת מחיר/iu;
const EDITORIAL_TEXT = /\b(review|reviewed|hands-on|we tested|i tested|best .{1,30} of 20\d\d|vs\.?|versus|buying guide)\b|ביקורת|סקירה|המלצות|מדריך קנייה/iu;
const RETAIL_TEXT = /add to cart|buy now|in stock|free shipping|הוסף לסל|הוספה לסל|במלאי|משלוח חינם|יבואן רשמי|יבוא רשמי|יבוא מקביל|מוכר חיצוני|נמכר ע["״]?י|אחריות/iu;
const USED_TEXT = /second.?hand|pre.?owned|\bused\b|for sale|by owner|classifieds?|יד\s?שנייה|יד\s?שניה|יד\s?2|למכירה|משומש|לוח מודעות|מודעות/iu;

const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Is this host inside the market? Decided by its suffix, never by its content. */
export function isLocalHost(domain, region) {
  const host = String(domain ?? '').toLowerCase();
  const suffixes = Array.isArray(region?.site_suffixes) ? region.site_suffixes : [];
  return host.length > 0 && suffixes.some((s) => host.endsWith(String(s).toLowerCase()));
}

/**
 * Type one result. `kind` is the provider's own index for the result ("search",
 * "reddit", "news"); `brand` lets a brand's own host be recognised generically.
 *
 * Total: any input yields a type and a locale.
 */
export function classifySource({ url = null, domain = null, title = '', text = '', kind = 'search', brand = null, region = null } = {}) {
  const site = sourceSite(domain ?? url) ?? '';
  const host = String(domain ?? '').toLowerCase();
  const locale = isLocalHost(host, region) ? LOCALE.LOCAL : LOCALE.INTERNATIONAL;
  const page = `${title ?? ''}\n${text ?? ''}`;
  const address = String(url ?? '');
  const type = (() => {
    if (IRRELEVANT_SITES.test(host) || IRRELEVANT_SITES.test(site)) return SOURCE_TYPE.IRRELEVANT;
    if (kind === 'reddit' || FORUM_SITES.test(site) || FORUM_URL.test(address)) return SOURCE_TYPE.FORUM;
    if (SOCIAL_SITES.test(site)) return SOURCE_TYPE.SOCIAL;
    if (DOC_URL.test(address) || DOC_TEXT.test(page)) return SOURCE_TYPE.DOCUMENTATION;
    if (USED_MARKETPLACE_SITES.test(site)) return locale === LOCALE.LOCAL ? SOURCE_TYPE.LOCAL_USED_MARKETPLACE : SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE;
    // The maker's own site: its registrable label contains the brand's word.
    const brandToks = tokens(brand).filter((t) => t.length >= 4);
    if (brandToks.length > 0 && brandToks.some((t) => site.split('.')[0].includes(t))) return SOURCE_TYPE.MANUFACTURER;
    if (COMPARISON_TEXT.test(page)) return SOURCE_TYPE.PRICE_COMPARISON;
    if (kind === 'news' || (EDITORIAL_TEXT.test(title ?? '') && !RETAIL_TEXT.test(page))) return SOURCE_TYPE.EDITORIAL;
    if (USED_TEXT.test(title ?? '') && !RETAIL_TEXT.test(title ?? '')) return locale === LOCALE.LOCAL ? SOURCE_TYPE.LOCAL_USED_MARKETPLACE : SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE;
    if (RETAIL_TEXT.test(page)) return locale === LOCALE.LOCAL ? SOURCE_TYPE.LOCAL_RETAIL : SOURCE_TYPE.INTERNATIONAL_RETAIL;
    if (USED_TEXT.test(page)) return locale === LOCALE.LOCAL ? SOURCE_TYPE.LOCAL_USED_MARKETPLACE : SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE;
    return SOURCE_TYPE.UNKNOWN;
  })();
  return { source_type: type, locale, site: site || null };
}

/** Types that are places where things are sold, as opposed to written about. */
export const SELLING_TYPES = Object.freeze(new Set([
  SOURCE_TYPE.LOCAL_USED_MARKETPLACE, SOURCE_TYPE.LOCAL_RETAIL, SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE,
  SOURCE_TYPE.INTERNATIONAL_RETAIL, SOURCE_TYPE.PRICE_COMPARISON, SOURCE_TYPE.MANUFACTURER, SOURCE_TYPE.UNKNOWN,
]));
