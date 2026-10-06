// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHICH PRICE BELONGS TO WHICH PRODUCT
//
// The first Production scan priced a mouse from "₪300" read off a category
// page that listed many mice. The search had reached the page and the number
// was on it; nothing showed that the number stood beside THAT mouse. A page
// that says
//
//     Logitech G703 … ₪300          Logitech G Pro Wireless … ₪450
//
// contains the product and contains ₪300, and they are different listings.
//
// So a price counts only when the text the SEARCH PROVIDER returned for the
// page — not the model's account of it — shows the product and the price as
// one listing:
//
//   STRONG        a page for one listing or one product, whose own title or
//                 text names the product beside the price
//   VERIFIED_ROW  a page that lists many things, where the product and the
//                 price sit in the same row, card or snippet, and that row
//                 shows no other price. One row, one price: "A ₪300 B ₪450"
//                 run together does not say which price is whose
//   WEAK          the page was reached, but its text does not show the product
//                 beside the price (or there is no text to check)
//   UNBOUND       the text shows a reason NOT to join them: a second price in
//                 the row, another model in the row, a thing sold FOR the
//                 product rather than the product, a price without VAT
//
// Only STRONG and VERIFIED_ROW may reach the valuation. WEAK and UNBOUND are
// kept and counted as found-but-unused; they never move a price.
//
// A claim that a listing is THIS EXACT ITEM needs the item's own name in the
// row. A listing's title that does not name it — in any language — proves a
// listing has a price, not that the listing is this item.
//
// A refusal here costs real evidence, on purpose: thin evidence is an honest
// answer and a price taken from the wrong listing is not.
//
// Pure functions over text. Nothing is fetched.
// ══════════════════════════════════════════════════════════════════════════════
import { pricedNumbers, MAX_DISTANCE } from '../phaseb/content-binding.js';

export const BOUND = Object.freeze({ STRONG: 'strong', VERIFIED_ROW: 'verified_row', WEAK: 'weak', UNBOUND: 'unbound' });
export const BIND_REASON = Object.freeze({
  ONE_LISTING: 'product_and_price_are_one_listing',
  NO_TEXT: 'no_page_text_to_check',
  PRICE_ABSENT: 'price_not_shown_with_its_currency',
  PRODUCT_ABSENT: 'product_not_named_beside_the_price',
  OTHER_PRICE: 'another_price_between_product_and_price',
  AMBIGUOUS: 'product_sits_between_two_prices',
  OTHER_MODEL: 'row_names_another_model',
  NO_VAT_PRICE: 'price_is_the_one_without_vat',
  FOR_THE_PRODUCT: 'row_sells_something_for_the_product',
  VARIANT: 'row_names_a_variant',
  OTHER_SIZE: 'row_states_another_size',
  LEGACY: 'kept_from_before_binding_was_checked',
});
const UNBOUND_REASONS = new Set([BIND_REASON.OTHER_PRICE, BIND_REASON.AMBIGUOUS, BIND_REASON.OTHER_MODEL, BIND_REASON.NO_VAT_PRICE, BIND_REASON.FOR_THE_PRODUCT]);

/** May this evidence take part in a valuation? */
export const isBound = (e) => e?.binding === BOUND.STRONG || e?.binding === BOUND.VERIFIED_ROW;

// A page for one thing; every other page type lists many.
const SINGLE_ITEM_PAGES = new Set(['listing', 'shop_product', 'price_guide']);
// What separates one listing from the next in a provider's text.
const SEPARATOR = /\.{3,}|…|[\r\n]+|#{2,}|\s\|\s|•|\s[–—]\s/gu;
// Words that, straight after a product's name, make it a different product.
const VARIANT_WORDS = new Set([
  'pro', 'max', 'plus', 'mini', 'ultra', 'lite', 'air', 'se', 'fe', 'xl', 'xs', 'xr', 'neo', 'slim', 'oled', 'ti', 'super', 'superlight',
  'x', 'digital', 'ii', 'iii', 'iv', 'gen', 'generation', 'mk', 'פרו', 'מקס', 'פלוס', 'מיני', 'אולטרה', 'דור',
]);
// A price that ends its clause: "…₪300, …", "…300 ש"ח. …". What follows is another listing.
const PRICE_CLOSES = /^\s{0,2}(?:₪|ש"ח|ש״ח|שח|ils|nis|\$|usd|€|eur|£|gbp)?\s{0,2}[,;.](?=\s|$)/;
const PRICE_LABELS = ['מחיר', 'במחיר', 'רק', 'price', 'only', 'for', 'ils', 'nis', 'usd', 'eur', 'gbp', 'שח', 'ש', 'ח'];
// "… for <product>": the row sells an accessory, a part or a case, and names the product it fits.
const FOR_WORDS = new Set(['for', 'fits', 'compatible', 'ל', 'עבור', 'תואם', 'מתאים']);
const MARKER = '(?:₪|ש"ח|ש״ח|שח|ils|nis|\\$|usd|€|eur|£|gbp)';
const SIGN_BEFORE = new RegExp(`${MARKER}\\s{0,2}$`);
const SIGN_AFTER = new RegExp(`^\\s{0,2}${MARKER}`);
const UNIT_WORD = /^(gb|tb|mb|ml|mm|cm|kg|mah|inch|pack|pcs|יח)$/;
const CODE = /^([a-z]+)(\d+)([a-z]*)$/;                    // g703, tb301, a7iii
const SIZE = /(\d+(?:\.\d+)?)\s?(gb|tb|mb|ml|mm|cm|kg|mah|inch|אינץ|ליטר|"|״)(?![\p{L}\p{N}])/giu;
// A shop's second price: without VAT (Eilat). It labels the price that follows it, or else the one just before.
const NO_VAT = /(אילת|eilat|ללא מע"?מ|לפני מע"?מ|without vat|ex\.? ?vat)/gi;

const norm = (v) => String(v ?? '').normalize('NFKC').replace(/''|׳׳/g, '"').toLowerCase();
const words = (text) => [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ t: m[0], at: m.index, end: m.index + m[0].length }));
const tokens = (v) => words(norm(v)).map((w) => w.t);
const unit = (u) => (u === 'אינץ' || u === '"' || u === '״' ? 'inch' : u);
const sizesIn = (text) => [...text.matchAll(SIZE)].map((m) => `${Number(m[1])}${unit(m[2].toLowerCase())}`);
const nearest = (list, at) => [...list].sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0] ?? null;

/**
 * The ways this item may be named in a listing: its model (with its variant),
 * another name it is sold under, or its model number. Each is a run of words
 * that must appear together, in order. The brand alone names a catalogue.
 */
export function namesOf(identity) {
  const i = identity ?? {};
  const brand = new Set(tokens(i.brand));
  const strip = (v) => tokens(v).filter((t) => !brand.has(t));
  const telling = (run) => run.length > 0 && (run.join('').length >= 4 || run.some((t) => /\d/.test(t)));
  const model = strip(i.model ?? i.product_family ?? i.canonical_name);
  const variant = strip(i.variant).filter((t) => !model.includes(t));
  const runs = [[...model, ...variant], ...(i.search?.aliases ?? []).map(strip)];
  for (const n of [i.model_number, ...(i.search?.model_numbers ?? [])]) runs.push(tokens(n));
  const seen = new Set();
  return runs.filter((r) => telling(r) && !seen.has(r.join(' ')) && seen.add(r.join(' ')));
}

/** Every place a run of words occurs in order: where, and the two words that follow it. */
function runsIn(row, run) {
  const out = [];
  for (let k = 0; k + run.length <= row.length; k += 1) {
    if (run.every((t, j) => row[k + j].t === t)) out.push({ at: row[k].at, index: k, next: row[k + run.length] ?? null, then: row[k + run.length + 1] ?? null });
  }
  return out;
}

/**
 * Every number the text shows as a price. A currency sign between two numbers
 * belongs to the one it touches: in "AirPods Pro 2 ₪300" the price is 300, and
 * the 2 is part of a name.
 */
function pricesIn(text) {
  const all = pricedNumbers(text).map((p) => ({ ...p, at: p.start }));
  return all.filter((p, k) => {
    const q = all[k + 1]; const o = all[k - 1];
    const between = (a, b) => text.slice(a.end, b.start);
    // "2 ₪300": the only sign near the 2 touches the next number. "₪300 ₪450" is two prices: each has its own.
    if (q && /^\s+\S{1,3}$/.test(between(p, q)) && !SIGN_BEFORE.test(text.slice(Math.max(0, p.start - 6), p.start))) return false;
    // "300₪ 2": the same, the other way round.
    if (o && /^\S{1,3}\s+$/.test(between(o, p)) && !SIGN_AFTER.test(text.slice(p.end, p.end + 6))) return false;
    return true;
  });
}

/** The prices a "without VAT" label on the page belongs to. */
function withoutVat(text, priced) {
  const marked = new Set();
  for (const m of text.matchAll(NO_VAT)) {
    const end = m.index + m[0].length;
    const after = priced.filter((p) => p.start >= end && p.start - end <= 24).sort((a, b) => a.start - b.start)[0];
    const before = priced.filter((p) => p.end <= m.index && m.index - p.end <= 12).sort((a, b) => b.end - a.end)[0];
    if (after ?? before) marked.add((after ?? before).start);
  }
  return marked;
}

/**
 * Does the provider's text show this product and this price as one listing?
 *
 * `claim`  what the model reported: { price, currency, title, match, shipping }
 * `page`   what the search returned for that page: { type, title, text } —
 *          `text` is every result title and snippet for the page, one per line
 * Returns { level, reason, match }: `match` is the claim's, or a weaker one
 * when the row itself shows the listing is a variant or another size.
 */
export function bindPrice(claim, page, identity, answer = null) {
  const refuse = (reason) => ({ level: UNBOUND_REASONS.has(reason) ? BOUND.UNBOUND : BOUND.WEAK, reason, match: claim?.match ?? null });
  const text = norm(page?.text);
  if (!text.trim()) return refuse(BIND_REASON.NO_TEXT);

  const same = (a, b) => Math.round(a) === Math.round(b);
  const priced = pricesIn(text);
  const shown = priced.filter((p) => same(p.value, claim.price) && p.currency === claim.currency);
  if (shown.length === 0) return refuse(BIND_REASON.PRICE_ABSENT);

  const noVat = withoutVat(text, priced);
  // Not competing prices: this listing's own shipping, and a shop's price without VAT.
  const rivals = priced.filter((p) => !same(p.value, claim.price) && !(claim.shipping && same(p.value, claim.shipping)) && !noVat.has(p.start));
  const names = namesOf(identity);
  const own = new Set(names.flat());
  const brand = new Set(tokens(identity?.brand));
  const title = [...new Set(tokens(claim.title).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !brand.has(t)))].slice(0, 12);
  const exact = claim.match === 'exact';
  const single = SINGLE_ITEM_PAGES.has(page?.type);
  const level = single ? BOUND.STRONG : BOUND.VERIFIED_ROW;
  const mine = sizesIn(norm(`${identity?.size_or_capacity ?? ''} ${answer?.text ?? ''}`));

  /** Who a stretch of text names: the item itself, or (for a listing not claimed to be it) the listing by its own title. */
  const whoIn = (row, at) => {
    const named = nearest(names.flatMap((run) => runsIn(row, run)), at);
    if (named) return named;
    const titled = !exact && title.length >= 2 && title.every((t) => row.some((w) => w.t === t));
    return titled ? { at: nearest(row.filter((w) => title.includes(w.t)), at).at, next: null, then: null } : null;
  };
  /**
   * An exact claim has to survive the text that names it. A sibling's model code beside the name means
   * the row is not (only) this item, and "… for <the product>" means it sells something else: refused.
   * A variant word after the name, or another size, means the listing is this product in another
   * version: it counts, as a comparable, and says so.
   */
  const verdict = (row, who, stretch) => {
    if (!exact) return { level, reason: BIND_REASON.ONE_LISTING, match: claim.match };
    const sibling = row.some((w) => {
      const c = CODE.exec(w.t);
      if (!c || own.has(w.t)) return false;
      return own.has(c[1]) || [...own].some((t) => { const o = CODE.exec(t); return o && (o[1] === c[1] || (o[1].length === c[1].length && o[2].length === c[2].length)); });
    });
    if (sibling) return { refused: BIND_REASON.OTHER_MODEL };
    // "<something> for <the product>": the price is the something's.
    let before = who.index == null ? null : who.index - 1;
    while (before != null && before >= 0 && brand.has(row[before].t)) before -= 1;
    if (before != null && before >= 0 && FOR_WORDS.has(row[before].t)) return { refused: BIND_REASON.FOR_THE_PRODUCT };
    const generation = who.next && /^[2-9]$/.test(who.next.t) && !(who.then && UNIT_WORD.test(who.then.t));
    if (who.next && (VARIANT_WORDS.has(who.next.t) || generation)) return { level, reason: BIND_REASON.VARIANT, match: 'close_comparable' };
    const theirs = sizesIn(stretch);
    const unitOf = (s) => s.replace(/^[\d.]+/, '');
    const clash = mine.some((m) => { const u = theirs.filter((s) => unitOf(s) === unitOf(m)); return u.length > 0 && !u.includes(m); });
    return clash ? { level, reason: BIND_REASON.OTHER_SIZE, match: 'close_comparable' } : { level, reason: BIND_REASON.ONE_LISTING, match: 'exact' };
  };

  const all = words(text);
  // WHERE ONE LISTING ENDS: at a separator, and at a price that closes its clause ("A ₪300, B …").
  const cuts = [...text.matchAll(SEPARATOR)].map((m) => [m.index, m.index + m[0].length]);
  for (const p of priced) {
    const m = PRICE_CLOSES.exec(text.slice(p.end, p.end + 12));
    if (m) cuts.push([p.end + m[0].length - 1, p.end + m[0].length]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  // Words that may stand before a price without being another listing: the product's own, and a price label.
  const explained = new Set([...own, ...brand, ...tokens(claim.title), ...PRICE_LABELS]);

  let reason = BIND_REASON.PRODUCT_ABSENT;
  for (const price of shown) {
    if (noVat.has(price.start)) { reason = BIND_REASON.NO_VAT_PRICE; continue; }
    // THE ROW: the stretch of text this price sits in.
    let from = 0; let to = text.length;
    for (const [a, b] of cuts) { if (b <= price.at) from = b; else if (a >= price.at) { to = a; break; } }
    const row = all.filter((w) => w.at >= from && w.end <= to && Math.abs(w.at - price.at) <= MAX_DISTANCE);
    const who = whoIn(row, price.at);
    if (!who) continue;
    // ONE ROW, ONE PRICE. A second price in the row is a second listing, or something the row does not explain:
    // "A ₪300 B ₪450" and "A B ₪300 ₪450" do not say which price is A's.
    const others = rivals.filter((p) => p.at >= from && p.end <= to && (Math.abs(p.at - price.at) <= MAX_DISTANCE || Math.abs(p.at - who.at) <= MAX_DISTANCE));
    if (others.length > 0) {
      const lo = Math.min(who.at, price.at); const hi = Math.max(who.at, price.end);
      reason = others.some((p) => p.at >= lo && p.end <= hi) ? BIND_REASON.OTHER_PRICE : BIND_REASON.AMBIGUOUS;
      continue;
    }
    // A PRICE BEFORE ITS PRODUCT is read that way only at the start of the row ("₪900 - Product"). After other
    // words — "Other thing ₪300, Product" — the price belongs to what came before it.
    if (price.at < who.at && row.some((w) => w.end <= price.at && !explained.has(w.t))) { reason = BIND_REASON.AMBIGUOUS; continue; }
    const v = verdict(row, who, text.slice(from, to));
    if (!v.refused) return v;
    reason = v.refused;
  }

  // A PAGE FOR ONE LISTING: its own title names the product, and this is the only price the page shows.
  // The title and the price may then sit in different lines and still be one listing.
  if (single && rivals.length === 0 && shown.some((p) => !noVat.has(p.start))) {
    const head = words(norm(page?.title));
    const who = whoIn(head, 0);
    const v = who ? verdict(head, who, text) : null;
    if (v && !v.refused) return v;
    if (v) reason = v.refused;
  }
  return refuse(reason);
}
