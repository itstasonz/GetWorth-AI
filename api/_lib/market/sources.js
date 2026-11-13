// ══════════════════════════════════════════════════════════════════════════════
// MARKET SOURCES — WHO WE MAY READ, AND WHAT WE MAY DO WITH IT
//
// Every price GetWorth keeps comes from a source, and every source has an
// explicit permission state. Being publicly reachable is NOT a permission: a
// site's terms decide whether its content may be collected automatically and
// used commercially, and until that is verified the answer is "no".
//
//   authorized             written permission / licence / own data: automated
//                          retrieval and long-term history are allowed
//   authorized_restricted  an official API or feed with terms (e.g. eBay Browse
//                          API): automated retrieval only through that channel
//   public_research_only   readable by a person or a search engine, but the
//                          site's terms forbid robots or commercial reuse: seen
//                          only in a search a person's scan asked for, kept no
//                          longer than the scan's own research window
//   not_authorized         the operator forbids or actively pursues collection:
//                          never retrieved, never kept
//   unknown                terms not reviewed: treated as public_research_only
//                          for a scan, never retrieved by a background job
//
// The states below come from docs/partnerships/israeli-market-data.md (terms
// read 2026-11-12) and are the ONLY place a state is set. Changing one is a
// business decision, recorded here with its date and evidence.
// ══════════════════════════════════════════════════════════════════════════════
import { sourceSite } from '../source-site.js';

export const PERMISSION = Object.freeze({
  AUTHORIZED: 'authorized',
  RESTRICTED: 'authorized_restricted',
  PUBLIC_RESEARCH: 'public_research_only',
  NOT_AUTHORIZED: 'not_authorized',
  UNKNOWN: 'unknown',
});
export const PERMISSIONS = Object.freeze(Object.values(PERMISSION));

/** What a source sells: second-hand, new in shops, or GetWorth's own marketplace. */
export const SOURCE_KIND = Object.freeze({ SECONDHAND: 'secondhand', RETAIL: 'retail', INTERNAL: 'internal', INTERNATIONAL: 'international', OTHER: 'other' });

const S = (id, sites, kind, permission, note, reviewed = null) => Object.freeze({ id, sites: Object.freeze(sites), kind, permission, note, reviewed });

export const SOURCES = Object.freeze([
  S('getworth', ['getworth'], SOURCE_KIND.INTERNAL, PERMISSION.AUTHORIZED,
    'GetWorth marketplace: completed sales qualified by marketplace_sale_evidence (buyer-confirmed, genuine accounts, seller-set price). Never GetWorth estimates.', '2026-11-08'),
  S('homeless', ['homeless.co.il'], SOURCE_KIND.SECONDHAND, PERMISSION.PUBLIC_RESEARCH,
    'Infotip Ltd. terms forbid robots and commercial use without written permission. Read only inside a scan\'s search results.', '2026-11-12'),
  S('ad_co_il', ['ad.co.il'], SOURCE_KIND.SECONDHAND, PERMISSION.PUBLIC_RESEARCH,
    'Terms forbid copying or using site content without prior written permission. Archive ads are history, never current.', '2026-11-12'),
  S('yad2', ['yad2.co.il'], SOURCE_KIND.SECONDHAND, PERMISSION.NOT_AUTHORIZED,
    'No public API; bot wall; acted against unauthorised collection (Keyz, 2026-06). Licence by agreement only.', '2026-11-12'),
  S('facebook', ['facebook.com', 'fb.com'], SOURCE_KIND.SECONDHAND, PERMISSION.NOT_AUTHORIZED,
    'Meta terms prohibit automated collection; no Marketplace API.', '2026-11-12'),
  S('zuzz', ['zuzz.co.il'], SOURCE_KIND.SECONDHAND, PERMISSION.UNKNOWN, 'Terms not reviewed.'),
  S('doskatv', ['doskatv.co.il'], SOURCE_KIND.SECONDHAND, PERMISSION.UNKNOWN, 'Terms not reviewed.'),
  S('zap', ['zap.co.il'], SOURCE_KIND.RETAIL, PERMISSION.UNKNOWN, 'Price comparison. Terms not reviewed.'),
  S('ksp', ['ksp.co.il'], SOURCE_KIND.RETAIL, PERMISSION.UNKNOWN, 'Retailer. Terms not reviewed; no feed agreement.'),
  S('bug', ['bug.co.il'], SOURCE_KIND.RETAIL, PERMISSION.UNKNOWN, 'Retailer. Terms not reviewed; no feed agreement.'),
  S('ivory', ['ivory.co.il'], SOURCE_KIND.RETAIL, PERMISSION.UNKNOWN, 'Retailer. Terms not reviewed; no feed agreement.'),
  S('ebay', ['ebay.com', 'ebay.co.uk', 'ebay.de'], SOURCE_KIND.INTERNATIONAL, PERMISSION.RESTRICTED,
    'Official Browse API permitted under eBay API terms (no keys configured). Abroad: context only, never an Israeli price.', '2026-11-12'),
]);

const BY_SITE = new Map(SOURCES.flatMap((s) => s.sites.map((site) => [site, s])));
const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/** The registered source for a URL, a host or an internal reference; an unregistered site is an UNKNOWN source of its own. */
export function sourceOf(urlOrHost) {
  const raw = String(urlOrHost ?? '').trim();
  if (/^getworth:/i.test(raw) || raw.toLowerCase() === 'getworth') return BY_ID.get('getworth');
  const site = sourceSite(raw);
  if (!site) return null;
  return BY_SITE.get(site) ?? Object.freeze({ id: `site:${site}`, sites: [site], kind: SOURCE_KIND.OTHER, permission: PERMISSION.UNKNOWN, note: 'Unregistered site.', reviewed: null });
}
export const sourceById = (id) => BY_ID.get(id) ?? null;

// ── WHAT EACH STATE ALLOWS ──────────────────────────────────────────────────
/** May a background job fetch this source by itself (crawl, feed, API)? Only with verified permission. */
export const mayRetrieveAutomatically = (source) => source?.permission === PERMISSION.AUTHORIZED || source?.permission === PERMISSION.RESTRICTED;
/** May a price this source showed in a scan's own search be used for that scan? Everything but an operator that forbids it. */
export const mayUseInScan = (source) => !!source && source.permission !== PERMISSION.NOT_AUTHORIZED;
/** May an observation from it enter the market index at all? */
export const mayIndex = (source) => mayUseInScan(source);
/**
 * May it be kept as long-term price history? Only with full permission: a restricted source (an official API with terms)
 * permits ITS channel, and a price of it seen in an ordinary web search did not come through that channel.
 */
export const mayKeepHistory = (source) => source?.permission === PERMISSION.AUTHORIZED;

/** How long an observation from this source may be kept, in ms: history for permitted sources, the scan's research window otherwise. */
export const HISTORY_RETENTION_MS = 365 * 86_400_000;
export function retentionMs(source, researchWindowMs) {
  if (!mayIndex(source)) return 0;
  return mayKeepHistory(source) ? HISTORY_RETENTION_MS : researchWindowMs;
}

/** Throws unless a background job may fetch this source. Every automated fetch path calls this first. */
export function assertRetrievable(urlOrHost) {
  const s = sourceOf(urlOrHost);
  if (!mayRetrieveAutomatically(s)) {
    const err = new Error(`source_not_authorized:${s?.id ?? 'unknown'}:${s?.permission ?? 'unknown'}`);
    err.code = 'source_not_authorized';
    throw err;
  }
  return s;
}

/** The registry as a table, for the admin view and the report. */
export const registrySummary = () => SOURCES.map(({ id, sites, kind, permission, reviewed }) => ({
  id, sites: [...sites], kind, permission, reviewed,
  automated: mayRetrieveAutomatically({ permission }), history: mayKeepHistory({ permission }), in_scan: mayUseInScan({ permission }),
}));
