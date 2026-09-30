// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — DETERMINISTIC LISTING EXTRACTION
//
// Turns the search tool's own results (title, URL, snippet) into candidate
// observations WITHOUT a model. Measured on saved research responses, this
// reproduced every listing the model-written answer got admitted and admitted
// nothing the model path did not, in a few milliseconds.
//
// ── A NUMBER IS NOT A PRICE, AND A PRICE IS NOT A LISTING ───────────────────
//
// `pricedNumbers` (content-binding.js) already refuses a number with no
// currency marker. This file adds the rest of what a reader would refuse:
//
//   a price standing alone                 nothing says what it is the price of
//   a delivery or collection fee           a price, of something else
//   what the seller once paid              a price, of another day
//   several prices in one listing          a bundle, a range or an upsell; which
//                                          one is the asking price is a guess
//   a row of a results table               the price is in one cell and a
//                                          category name is in another, so the
//                                          row can "name" a product it is not
//
// Every refusal is RETURNED with its reason. Nothing is dropped silently, and
// a refusal here is never repaired later: qualification only ever sees what
// survived, and applies every rule it always applied.
//
// WHAT "ADMISSIBLE" MEANS. An observation is handed to the evidence gate as a
// second-hand listing only when its own sentence carries the price AND the
// page or the sentence says something is for sale second-hand. Everything else
// is kept as context, labelled, and cannot be priced from.
//
// The vocabulary below is the market's. It is data, in one place, and the
// structure around it knows no language.
// ══════════════════════════════════════════════════════════════════════════════
import { pricedNumbers } from '../phaseb/content-binding.js';
import { hostOf } from '../phaseb/search-provenance.js';

export const REFUSED = Object.freeze({
  NAKED_PRICE: 'price_with_no_listing_text',
  FEE: 'delivery_or_service_fee',
  NOT_ASKING: 'not_an_asking_price',
  SEVERAL_PRICES: 'several_prices_in_one_listing_block',
  OVER_BUDGET: 'over_observation_budget',
});
export const SHAPE = Object.freeze({ SENTENCE: 'sentence', TABLE_ROW: 'table_row' });

export const MAX_PER_RESULT = 12;
export const MAX_OBSERVATIONS = 60;
const MAX_TITLE = 220;
/** How far before a price a word can be and still describe that price. */
const BEFORE = 28;

// A listing ends at any of these. A pipe does NOT end one: it separates the
// cells of a table row or the parts of a page title. So does a run of spaces,
// which is what a results table becomes when its markup is flattened to text:
// "800 ₪ <seller>     <category> for sale  <section>" is three cells, and the
// category in the second is not a description of the item in the first.
const HARD = /\.{3,}|…|[\r\n]+|#{2,}|•|\s[–—]\s/gu;
const CELL = /\s\|(?=\s|$)|[^\S\r\n]{2,}/gu;
// What the search tool prepends to a snippet. Metadata, not page text.
const PREAMBLE = /^\s*\S*cite\S*\s*(\[wordlim:[^\]]*\])?\s*((Published|Crawled|Updated):[^;]*;\s*)*/u;

const LEXICON = Object.freeze({
  fee: /משלוח|שילוח|דמי\s|איסוף|בעלות של|עלות של|shipping|delivery|postage|handling/iu,
  history: /נקנה|נקנתה|נרכש|קניתי|שילמתי|עלה לי|במקום|מחיר מקורי|מחיר מחירון|bought|paid|purchased|instead of|original price|retail price|rrp|\bwas\b/iu,
  sale: /למכירה|(?<!\p{L})מוכרת?(?!\p{L})|for sale|selling/iu,
  secondHand: /יד\s?שני[יה]ה?|יד\s?2|משומש|second.?hand|\bused\b|pre.?owned/iu,
  retail: /השוואת מחירים|משלוח חינם|הוסף לסל|הוספה לסל|במלאי|אחריות יבואן|יבואן רשמי|add to cart|in stock|free shipping|buy now|price comparison/iu,
});

const wordTokens = (s) => String(s).normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter((t) => t && !/^\d+$/.test(t));
const CURRENCY_WORDS = /[₪$€£]|ש["״]?ח|\b(ils|nis|usd|eur|gbp)\b/giu;

function blocksOf(text) {
  const out = [];
  let from = 0;
  for (const m of text.matchAll(HARD)) { out.push(text.slice(from, m.index)); from = m.index + m[0].length; }
  out.push(text.slice(from));
  return out.map((b) => b.trim()).filter(Boolean);
}

/** Why this number is not the asking price, or null when nothing says so. */
function notAsking(block, price) {
  const before = block.slice(Math.max(0, price.start - BEFORE), price.start);
  if (LEXICON.fee.test(before)) return REFUSED.FEE;
  if (LEXICON.history.test(before)) return REFUSED.NOT_ASKING;
  return null;
}

/**
 * Candidate observations from provider results.
 *
 * `results` is `provenance.results`: [{ url, domain, title, text }]. Returns
 * { entries, refused } where each entry is
 *   { observation, shape, kind, sale_intent, admissible, note }.
 *
 * Total: any input yields two arrays and never throws.
 */
export function extractListings(results) {
  const entries = [];
  const refused = [];
  const seen = new Set();

  for (const r of Array.isArray(results) ? results : []) {
    const url = typeof r?.url === 'string' ? r.url : null;
    const domain = hostOf(url);
    if (!url || !domain) continue;
    const pageTitle = typeof r?.title === 'string' ? r.title : '';
    const lines = [pageTitle, typeof r?.text === 'string' ? r.text.replace(PREAMBLE, '') : null].filter(Boolean);
    const pageSecondHand = LEXICON.secondHand.test(pageTitle);
    const pageRetail = LEXICON.retail.test(pageTitle);
    let taken = 0;

    for (const block of lines.flatMap(blocksOf)) {
      const prices = pricedNumbers(block).filter((p) => p.value > 0);
      if (prices.length === 0) continue;
      const refuse = (reason, extra = {}) => refused.push({ url, reason, text: block.slice(0, 160), ...extra });

      // Which of these numbers is somebody ASKING for the item?
      const flagged = prices.map((p) => ({ p, why: notAsking(block, p) }));
      const asking = flagged.filter((f) => !f.why).map((f) => f.p);
      if (asking.length === 0) { refuse(flagged[0].why); continue; }
      const distinct = [...new Set(asking.map((p) => `${p.value}|${p.currency}`))];
      if (distinct.length > 1) { refuse(REFUSED.SEVERAL_PRICES, { prices: distinct }); continue; }
      const price = asking[0];

      // The cell holding the price. With words beside it, that cell is the
      // listing's own sentence. Alone, it is one cell of a table row.
      const cells = block.split(CELL).map((c) => c.trim()).filter(Boolean);
      const own = cells.find((c) => pricedNumbers(c).some((p) => p.value === price.value)) ?? block;
      const tableRow = wordTokens(own.replace(CURRENCY_WORDS, ' ')).length < 2;
      const title = (tableRow ? cells.filter((c) => c !== own).join(' | ') : own).slice(0, MAX_TITLE);
      if (wordTokens(title.replace(CURRENCY_WORDS, ' ')).length < 2) { refuse(REFUSED.NAKED_PRICE); continue; }

      const key = `${url}|${price.value}|${price.currency}`;
      if (seen.has(key)) continue;                 // one observation per page and price
      if (taken >= MAX_PER_RESULT || entries.length >= MAX_OBSERVATIONS) { refuse(REFUSED.OVER_BUDGET); continue; }
      seen.add(key);
      taken += 1;

      const retail = pageRetail || LEXICON.retail.test(block);
      const saleIntent = !retail && (pageSecondHand || LEXICON.sale.test(block) || LEXICON.secondHand.test(block));
      const kind = retail ? 'new_retail' : (saleIntent ? 'used_listing' : 'unknown');
      const shape = tableRow ? SHAPE.TABLE_ROW : SHAPE.SENTENCE;
      const admissible = kind === 'used_listing' && shape === SHAPE.SENTENCE;
      entries.push({
        observation: {
          source: url,
          source_domain: domain,
          listing_id_or_reference: null,
          title,
          observed_price: price.value,
          currency: price.currency,
          condition: null,
          location: null,
          observed_at: null,
          listing_kind: kind,
          // No model read this listing, so there is no model opinion of it.
          match: { brand: null, model: null, variant: null, confidence: null },
        },
        page_title: pageTitle.slice(0, MAX_TITLE),
        shape,
        kind,
        sale_intent: saleIntent,
        admissible,
        note: admissible ? null
          : (shape === SHAPE.TABLE_ROW ? 'table_row_identity_is_not_beside_the_price'
            : (kind === 'new_retail' ? 'retail_page' : 'nothing_says_this_is_for_sale')),
      });
    }
  }
  return { entries, refused };
}
