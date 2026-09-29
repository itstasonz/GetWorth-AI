// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — CONTENT BINDING
//
// URL binding proves the search RETURNED a page. It does not prove the price
// was on it: the model writes the price, and the model is the thing being
// checked. The provider also returns the text it showed the model for each
// result (`web_search_call.results`), and that text is not model-authored. So
// a claim can be checked against it, deterministically, without fetching
// anything (§13, §40 — GetWorth still requests no URL).
//
//   DOMAIN_BOUND    the search reached the site
//   URL_BOUND       the search returned that page
//   CONTENT_BOUND   the provider's text for that page shows THIS identity
//                   beside THIS price in THIS currency
//
// ── WHY CO-OCCURRENCE IS NOT ENOUGH ─────────────────────────────────────────
//
// Most results are category pages: one snippet, many listings. "Product A …
// ₪500 … Product B … ₪900" contains Product A and contains ₪900, and they
// belong to different listings. A rule that accepted both being SOMEWHERE in
// the text would bind A to B's price with the provider's own words as proof.
//
// So the claim has to hold locally:
//
//   1. the price occurs with its currency marker attached;
//   2. an identity token occurs in the same SEGMENT — listings in a snippet
//      are separated by ellipses, line breaks and headings, and nothing binds
//      across one;
//   3. no OTHER price lies between the token and the price; and
//   4. the token is not also flanked, on its far side, by a different price.
//      "₪500 A ₪900" does not say which price is A's, and an ambiguity is
//      resolved as a refusal.
//
// Rule 4 costs real evidence: in a run-on list it binds the first listing and
// refuses the rest. That is the intended direction. A refusal here leaves the
// observation URL_BOUND, exactly where it was before this file existed.
//
// STRENGTH, NOT PERMISSION. Nothing in the evidence engine reads this level.
// ══════════════════════════════════════════════════════════════════════════════
import { canonicalCurrency } from '../market-evidence.js';

export const CONTENT = Object.freeze({
  BOUND: 'content_bound',
  NO_RESULT_TEXT: 'no_provider_text_for_this_url',
  NO_PRICE: 'claim_has_no_price',
  NO_CURRENCY: 'claim_has_no_currency',
  NO_IDENTITY: 'claim_has_no_identity_token',
  PRICE_ABSENT: 'price_with_currency_not_in_provider_text',
  IDENTITY_ABSENT: 'identity_not_in_the_same_segment_as_the_price',
  TOO_FAR: 'identity_too_far_from_price',
  PRICE_BETWEEN: 'another_price_lies_between_identity_and_price',
  AMBIGUOUS: 'identity_is_flanked_by_a_different_price',
});

/** How far apart an identity token and its price may be, in characters. */
export const MAX_DISTANCE = 240;
/** How close a currency marker must be to a number to belong to it. */
const MARKER_REACH = 4;

// Spellings, keyed by the canonical code the evidence engine uses. The shekel
// forms are decided THERE; these strings are only how to find one in text.
const MARKERS = [
  ['₪', 'ILS'], ['ש"ח', 'ILS'], ['ש״ח', 'ILS'], ['שח', 'ILS'],
  ['ils', 'ILS'], ['nis', 'ILS'],
  ['$', 'USD'], ['usd', 'USD'], ['€', 'EUR'], ['eur', 'EUR'], ['£', 'GBP'], ['gbp', 'GBP'],
];

const NUMBER = /(?<![\p{L}\p{N}.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\p{N}]|[.,]\d)/gu;
const SEPARATOR = /\.{3,}|…|[\r\n]+|#{2,}|\s\|\s|•|\s[–—]\s/gu;

const tokensOf = (text) => String(text ?? '').normalize('NFKC').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every number in the text that carries a currency marker. */
export function pricedNumbers(text) {
  const s = String(text ?? '');
  const lower = s.toLowerCase();
  const out = [];
  for (const m of s.matchAll(NUMBER)) {
    const start = m.index;
    const end = start + m[0].length;
    const value = Number(`${m[1].replace(/,/g, '')}${m[2] ? `.${m[2]}` : ''}`);
    if (!Number.isFinite(value)) continue;
    const before = lower.slice(Math.max(0, start - MARKER_REACH - 3), start);
    const after = lower.slice(end, end + MARKER_REACH + 3);
    let currency = null;
    for (const [mark, code] of MARKERS) {
      const word = /^[a-z]+$/.test(mark);
      const a = after.replace(/^\s{0,2}/, '');
      const b = before.replace(/\s{0,2}$/, '');
      const hitAfter = a.startsWith(mark) && (!word || !/^[a-z]/.test(a.slice(mark.length)));
      const hitBefore = b.endsWith(mark) && (!word || !/[a-z]$/.test(b.slice(0, -mark.length)));
      if (hitAfter || hitBefore) { currency = code; break; }
    }
    if (currency) out.push({ value, currency, start, end });
  }
  return out;
}

/** [start, end) of the segment containing `at`. */
function segmentAround(text, at) {
  let from = 0;
  let to = text.length;
  for (const m of text.matchAll(SEPARATOR)) {
    if (m.index + m[0].length <= at) from = m.index + m[0].length;
    else if (m.index >= at) { to = m.index; break; }
  }
  return [from, to];
}

/**
 * The tokens that would identify this claim in text.
 *
 * The listing's own MODEL, and only that: a title is a separate witness with
 * a higher bar (titleTokens). The brand alone identifies a catalogue, not a
 * listing, so it is excluded; so is anything too short to be told apart from
 * noise, and any bare number, which could be a price.
 */
export function identityTokens(observation) {
  const brand = new Set(tokensOf(observation?.match?.brand));
  const keep = (t) => t.length >= 3 && !/^\d+$/.test(t) && !brand.has(t);
  return [...new Set(tokensOf(observation?.match?.model).filter(keep))];
}

/**
 * The words of the listing's own TITLE.
 *
 * THE FIRST REAL BENCHMARK NEEDED THIS. A listing was titled in Hebrew, the
 * model named its product in Latin letters, and no Latin token occurs in a
 * Hebrew title — so a claim whose title and price the provider showed word for
 * word could not be bound. What is being bound is the CLAIM: "a listing titled
 * X asks Y". Whether X is the right product is qualification's question, asked
 * separately and unchanged.
 *
 * A title is mostly ordinary words, and ordinary words appear in every listing
 * on a category page: two listings can share "for sale in <city>" and differ in
 * one word. So the bar is the whole title. EVERY word of it has to be in the
 * segment, because the one word that is missing is the one that would have
 * told the two listings apart. The brand is left out for the reason it always
 * is, and at least two words must remain.
 */
export function titleTokens(observation) {
  const brand = new Set(tokensOf(observation?.match?.brand));
  const keep = (t) => t.length >= 3 && !/^\d+$/.test(t) && !brand.has(t);
  return [...new Set(tokensOf(observation?.title).filter(keep))].slice(0, 12);
}

/** Every position at which a whole token occurs. */
function positionsOf(text, token) {
  const out = [];
  const lower = text.normalize('NFKC').toLowerCase();
  let at = lower.indexOf(token);
  while (at !== -1) {
    const pre = at === 0 ? '' : lower[at - 1];
    const post = lower[at + token.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(pre) && !/[\p{L}\p{N}]/u.test(post)) out.push(at);
    at = lower.indexOf(token, at + 1);
  }
  return out;
}

/**
 * Does the provider's text support this claim?
 *
 * Returns { bound, reason }. Total: any input yields an answer.
 */
export function contentSupports(observation, resultText) {
  const text = typeof resultText === 'string' ? resultText : '';
  if (!text.trim()) return { bound: false, reason: CONTENT.NO_RESULT_TEXT };

  const price = observation?.observed_price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return { bound: false, reason: CONTENT.NO_PRICE };
  }
  const currency = canonicalCurrency(observation?.currency);
  if (!currency) return { bound: false, reason: CONTENT.NO_CURRENCY };
  // Two ways to recognise the listing, either of which is enough: its model
  // name (two tokens when it has two — one word of a name is a weak witness),
  // or the whole of its own title.
  const model = identityTokens(observation);
  const title = titleTokens(observation);
  const witnesses = [
    { tokens: model, need: Math.min(2, model.length) },
    { tokens: title, need: Math.max(2, title.length) },
  ].filter((w) => w.tokens.length > 0 && w.need <= w.tokens.length);
  if (witnesses.length === 0) return { bound: false, reason: CONTENT.NO_IDENTITY };

  const priced = pricedNumbers(text);
  const claims = priced.filter((p) => p.value === price && p.currency === currency);
  if (claims.length === 0) return { bound: false, reason: CONTENT.PRICE_ABSENT };

  let reason = CONTENT.IDENTITY_ABSENT;
  for (const claim of claims) {
    const [from, to] = segmentAround(text, claim.start);
    const others = priced.filter((p) => p.start >= from && p.end <= to && p.value !== price);
    const hitsFor = (tokens) => tokens
      .map((t) => positionsOf(text, t).filter((at) => at >= from && at < to)
        .sort((a, b) => Math.abs(a - claim.start) - Math.abs(b - claim.start))[0])
      .filter((at) => at !== undefined);
    const hits = witnesses.map((w) => ({ found: hitsFor(w.tokens), need: w.need }))
      .find((w) => w.found.length >= w.need)?.found;
    if (!hits) continue;

    const anchor = hits.sort((a, b) => Math.abs(a - claim.start) - Math.abs(b - claim.start))[0];
    if (Math.abs(anchor - claim.start) > MAX_DISTANCE) { reason = CONTENT.TOO_FAR; continue; }

    const lo = Math.min(anchor, claim.start);
    const hi = Math.max(anchor, claim.end);
    if (others.some((p) => p.start >= lo && p.end <= hi)) { reason = CONTENT.PRICE_BETWEEN; continue; }

    // The far side of the identity: the side the claimed price is NOT on.
    const priceIsAfter = claim.start > anchor;
    const farSide = others.filter((p) => (priceIsAfter ? p.end <= anchor : p.start >= anchor)
      && Math.abs(p.start - anchor) <= MAX_DISTANCE);
    if (farSide.length > 0) { reason = CONTENT.AMBIGUOUS; continue; }

    return { bound: true, reason: CONTENT.BOUND };
  }
  return { bound: false, reason };
}
