// ══════════════════════════════════════════════════════════════════════════════
// LISTING IDENTITY — WHAT MAKES TWO OBSERVATIONS THE SAME ADVERT
//
// THE DEFECT. A listing was identified, among other things, by its site and
// its price. So two people selling the same console for ₪1,800 on one site
// were one listing, and the second was discarded as a repost. The rule was
// written to stop one advert being counted three times under three titles; it
// could not tell that from three adverts at a round price, and in classifieds
// most prices are round.
//
// PRICE IS AN ATTRIBUTE OF A LISTING. IT IS NOT ITS IDENTITY.
//
// A listing is identified by the strongest thing known about it:
//
//   1. the listing id the source gave it;
//   2. the stable id in its URL (the number in `…/viewad,1101931.aspx`);
//   3. failing both, a FINGERPRINT of several fields together — site, title,
//      price and location. Never one of them alone.
//
// 1 and 2 share a namespace, so a listing reported once by id and once by URL
// is one listing. When an id exists the fingerprint is NOT used: two adverts
// with different ids and identical wording are two adverts.
//
// WHAT THIS GIVES UP, stated rather than hidden. An advert re-posted under a
// NEW id is a new listing here. The old price key would have caught it, along
// with every honest seller who asked the same price.
//
// Nothing in this file knows a site, a product or a country.
// ══════════════════════════════════════════════════════════════════════════════
import { sourceSite, hostnameOf } from './source-site.js';

export const IDENTITY_METHOD = Object.freeze({
  LISTING_ID: 'listing_id',
  URL_ID: 'url_listing_id',
  FINGERPRINT: 'fingerprint',
});

// Parameters that say where a visitor came from, not which page this is.
const TRACKING = /^(utm_[a-z0-9_]*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|srsltid|ref|ref_src|igshid|_ga|gad_[a-z0-9_]*|gclsrc)$/i;
// Hosts that are the same site's front door for a different device.
const DEVICE_LABEL = /^(www\d?|m|mobile|touch|amp)$/;
// Parameters that name one item.
const ID_PARAM = /^((item|ad|listing|product|model|post|offer|article)[_-]?)?id$/i;
const MIN_ID_DIGITS = 5;

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * One spelling of a URL: no scheme, no device subdomain, no tracking, no
 * fragment, no trailing slash. The path and every parameter that identifies
 * the page are kept. Returns null for anything that is not an http(s) URL.
 */
export function canonicalListingUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const m = /^https?:\/\/([^\s/?#]+)([^\s?#]*)(?:\?([^\s#]*))?/i.exec(s);
  if (!m || /\s/.test(s)) return null;
  const host = hostnameOf(m[1]);
  if (!host || !sourceSite(host)) return null;
  const labels = host.split('.');
  while (labels.length > sourceSite(host).split('.').length && DEVICE_LABEL.test(labels[0])) labels.shift();
  const path = decode(m[2]).replace(/\/+$/, '').toLowerCase();
  const query = (m[3] ?? '').split('&')
    .filter((pair) => pair && !TRACKING.test(decode(pair.split('=')[0])))
    .map((pair) => decode(pair).toLowerCase())
    .sort().join('&');
  return `${labels.join('.')}${path}${query ? `?${query}` : ''}`;
}

/**
 * The stable listing id a URL carries, or null.
 *
 * A parameter that names an item, or the last long number in the path. A page
 * number, a category code of a few digits and a bare path are not ids: a
 * category page holds many listings and identifies none of them.
 */
export function listingIdFromUrl(raw) {
  const url = canonicalListingUrl(raw);
  if (!url) return null;
  const [path, query = ''] = url.split('?');
  for (const pair of query.split('&')) {
    const [k, v] = pair.split('=');
    if (k && v && ID_PARAM.test(k) && /^[a-z0-9_-]{3,64}$/i.test(v)) return v;
  }
  const runs = path.match(/\d+/g) || [];
  const long = runs.filter((r) => r.length >= MIN_ID_DIGITS);
  return long.length > 0 ? long[long.length - 1] : null;
}

const norm = (v, max = 80) => String(v ?? '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, max);

/**
 * The identity of one listing, and the keys under which a repeat of it would
 * be recognised.
 *
 * `site` is the registrable site. `explicit` is the id the source reported,
 * `source` the URL, and the rest are the listing's own fields.
 */
export function listingIdentity({ site, explicit = null, source = null, title = null, ils = null, location = null } = {}) {
  const canonicalUrl = canonicalListingUrl(source) ?? canonicalListingUrl(explicit);
  const stated = typeof explicit === 'string' && explicit.trim() && !/^https?:\/\//i.test(explicit.trim())
    ? norm(explicit, 64).replace(/\s+/g, '-') : null;
  const fromUrl = listingIdFromUrl(source) ?? listingIdFromUrl(explicit);

  const keys = [];
  if (stated) keys.push(`id:${site}|${stated}`);
  if (fromUrl && fromUrl !== stated) keys.push(`id:${site}|${fromUrl}`);
  // ACROSS SITES. The same reference at the same price on two sites is one
  // advert syndicated, not two sellers. The price is part of this key and
  // never the whole of it; a short reference is too likely to coincide.
  if (stated && stated.length >= MIN_ID_DIGITS) keys.push(`x:${stated}|${ils}`);

  let method = stated ? IDENTITY_METHOD.LISTING_ID : (fromUrl ? IDENTITY_METHOD.URL_ID : IDENTITY_METHOD.FINGERPRINT);
  if (keys.length === 0) {
    keys.push(`fp:${site}|${norm(title)}|${ils}|${norm(location, 40)}`);
    method = IDENTITY_METHOD.FINGERPRINT;
  }
  return { method, listing_id: stated ?? fromUrl ?? null, canonical_url: canonicalUrl, keys, duplicate_key: keys[0] };
}
