// ══════════════════════════════════════════════════════════════════════════════
// SOURCE SITE — WHAT "AN INDEPENDENT SOURCE" MEANS
//
// THE DEFECT. Source diversity counted HOSTNAMES. A marketplace and its mobile
// subdomain are two hostnames and one marketplace, so three listings from one
// site could present themselves as evidence from two. The first live benchmark
// returned exactly that pair.
//
// Diversity is a claim about independent SITES. A site is the registrable
// domain: the label a registrant actually bought, plus the public suffix it
// was bought under. `m.shop.co.il` and `www.shop.co.il` are one site,
// `shop.co.il`. `shop.co.uk` is a site; `co.uk` is not, and neither is `co.il`.
//
// ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
//
// It is NOT the full Public Suffix List. That list is ~10,000 rules, changes
// weekly, and the only copy in this repository belongs to a transitive
// dependency that could disappear in any install. This module holds the two
// rules that cover how country-code domains are actually structured, and it
// is written so that every error it can make is in the SAFE direction:
//
//   - a two-letter country code under a recognised second-level label
//     (co, com, org, net, ac, gov, edu, …) is a public suffix: `co.il`,
//     `co.uk`, `com.au`, `org.il`, `ac.jp`;
//   - anything else is registered directly under its top-level domain.
//
// SAFE DIRECTION: when this is wrong it COLLAPSES sites that were in fact
// independent (two tenants of one hosting suffix count as one source). It
// does not split one site into two. Under-counting diversity costs evidence;
// over-counting it grants authority, and only the first is acceptable here.
//
// Nothing in this file knows a country, a marketplace, or a product.
// ══════════════════════════════════════════════════════════════════════════════

// Second-level labels that registries use as public suffixes under a
// country-code domain. A closed list: a label that is not on it is treated as
// a name somebody registered.
const SECOND_LEVEL_SUFFIX = new Set([
  'co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'mil', 'muni', 'k12', 'idf',
  'ne', 'or', 'go', 'gob', 'nom', 'sch', 'ltd', 'plc', 'me', 'info', 'biz', 'int',
]);

/** A hostname: lowercased, without scheme, credentials, port, path or a trailing dot. */
export function hostnameOf(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0]
    .replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.+$/, '');
  if (!host.includes('.') || /\s/.test(host) || /\.\./.test(host)) return null;
  return host;
}

/**
 * The registrable domain of a hostname or URL, or null.
 *
 * An IP address has no registrable domain and is returned whole: two
 * addresses are two hosts, and nothing here can say more than that.
 */
export function sourceSite(raw) {
  const host = hostnameOf(raw);
  if (!host) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  if (labels.some((l) => !l)) return null;
  if (labels.length <= 2) {
    // `co.uk` on its own is a suffix, not a site: nobody can be a source there.
    const bareSuffix = labels.length === 2 && labels[1].length === 2 && SECOND_LEVEL_SUFFIX.has(labels[0]);
    return bareSuffix ? null : host;
  }
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const suffixLabels = tld.length === 2 && SECOND_LEVEL_SUFFIX.has(second) ? 2 : 1;
  return labels.slice(-(suffixLabels + 1)).join('.');
}
