// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — A SHOP'S OWN PRICE, PRINTED WITHOUT ITS CURRENCY
//
// THE CAPTURE. The one Israeli page that priced the exact product beside its
// model number read "החל מ- 569 569   NINJA בלנדר ושייקר TB301 משלוח חינם": a
// retail category row, the price printed as the market prints it ("from 569",
// and the number twice, as the page's markup flattens to text), and no shekel
// sign anywhere in the excerpt. It was refused as money of unknown currency,
// and the scan ended with one shop's price instead of two.
//
// The currency of a number on a shop inside the market is not unknown. It is
// the market's. What IS unknown is whether a bare number is a price at all —
// so this file reads only the two forms the market uses for one: a price word
// before the number ("מחיר", "החל מ-"), or the number printed twice.
//
// ── WHAT THIS MAY AND MAY NOT BECOME ────────────────────────────────────────
//
// A locale-priced number is a RETAIL ANCHOR candidate and nothing else. It is
// never a second-hand observation, never handed to the evidence gate, and it
// carries `currency_basis: 'site_locale'` so a reader can see the currency was
// inferred from the host and not read off the page. It must stand beside this
// product's own name or number (relationOf → EXACT or REGIONAL_VARIANT), on a
// host inside the market, in a retail context.
//
// A promotion prints two prices for one product — the current and the old,
// "448 448 799 799 בתוקף עד": the higher is the old price, and it is refused
// as one.
// ══════════════════════════════════════════════════════════════════════════════
import { relationOf, RELATION } from './market-identity.js';

export const CURRENCY_BASIS = Object.freeze({ MARKER: 'marker', SITE_LOCALE: 'site_locale' });

const PRICE_FORM = /(?<![\p{L}\p{N}.,])(\d{2,3}(?:,\d{3})|\d{2,6})(?:\s+\1)(?![\p{N}])|(?:מחיר|החל מ-?|price|from)\s{0,3}:?\s{0,3}(\d{2,3}(?:,\d{3})|\d{2,6})(?![\p{N}%])/giu;
const CELL = /\s\|(?=\s|$)|[^\S\r\n]{2,}/u;
const MAX_SCANNED = 60;
const NAME_REACH = 160;

/** Every bare number in a text that is printed in one of the market's price forms. */
export function unmarkedPrices(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(PRICE_FORM)) {
    const value = Number(String(m[1] ?? m[2]).replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) {
      out.push({ value, at: m.index, end: m.index + m[0].length, after: text.slice(m.index + m[0].length, m.index + m[0].length + NAME_REACH) });
    }
    if (out.length >= MAX_SCANNED) break;
  }
  return out;
}

/**
 * The retail-anchor candidates among a local page's bare numbers.
 *
 * `market` is the market-identity report (what names this product); `region`
 * the market region (which currency). Returns { candidates, refused }: each
 * candidate has the name it stood beside and the currency basis; everything
 * else keeps its refusal, with the relation of what it stood beside.
 */
export function localePriceCandidates(text, { market = null, region = null, local = false, retail = false } = {}) {
  const found = unmarkedPrices(text).map((u) => {
    // The row's name: the first cell after the number that has words in it,
    // without the price (printed again, or an old price beside it).
    const cells = u.after.split(CELL).map((c) => c.trim()).filter((c) => /\p{L}/u.test(c));
    const name = (cells[0] ?? '').replace(PRICE_FORM, ' ').replace(/^[\d.,\s]+/, '').replace(/\s+/g, ' ').trim();
    return { ...u, name, relation: relationOf(name || u.after, market) };
  });
  const ours = found.filter((u) => u.relation === RELATION.EXACT || u.relation === RELATION.REGIONAL_VARIANT);
  const candidates = [];
  const refused = [];
  const eligible = local && retail && region?.currency && ours.length > 0;
  if (eligible) {
    // One product, two prices: a promotion. The lower is asked today.
    const byName = new Map();
    for (const u of ours) { const k = u.name.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(u); }
    for (const group of byName.values()) {
      const sorted = [...group].sort((a, b) => a.value - b.value);
      const current = sorted[0];
      candidates.push({ value: current.value, currency: region.currency, currency_basis: CURRENCY_BASIS.SITE_LOCALE, name: current.name, relation: current.relation, at: current.at });
      for (const old of sorted.slice(1)) {
        if (old.value !== current.value) refused.push({ ...old, reason: 'not_an_asking_price', note: 'the higher of two prices printed for one product is the old price' });
      }
    }
  }
  const taken = new Set(candidates.map((c) => c.at));
  for (const u of found) {
    if (taken.has(u.at) || refused.some((r) => r.at === u.at)) continue;
    refused.push({ ...u, reason: 'price_without_currency_marker', note: !eligible && ours.includes(u) ? (local ? 'not_a_retail_context' : 'host_is_outside_the_market') : null });
  }
  return { candidates, refused };
}
