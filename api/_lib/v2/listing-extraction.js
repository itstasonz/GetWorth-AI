// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — DETERMINISTIC PRICE EXTRACTION
//
// Turns the search tool's own results (title, URL, snippet) into candidate
// observations WITHOUT a model, and accounts for every result and every number
// on the way. Nothing is dropped silently: a number that is not used says why.
//
// ── A NUMBER HAS A ROLE BEFORE IT HAS A MEANING ─────────────────────────────
//
// THE PRODUCTION WITNESS. One shop page for the right product carried four
// shekel amounts: three delivery fees and "price including delivery to a
// pickup point: 608". The first version of this file looked 28 characters to
// the left of each number for a fee word. It kept the express-delivery fee as
// the asking price, and refused the product price because the word "delivery"
// stood beside it.
//
// So each number is first given a ROLE from the label that introduces it —
// the text between the previous number and this one — and only a PRODUCT PRICE
// can become an observation.
//
// ── WHERE A PRICE MAY BE BOUND TO A PRODUCT ─────────────────────────────────
//
//   STRICT (the default)   the price and the words naming the item are in the
//                          same sentence of the same listing. A table row, a
//                          category page, a forum thread: all strict.
//   RESULT LEVEL           the result is ONE product's page in a shop — its
//                          TITLE names the product, its text names no other
//                          model, its address is not a category or a search —
//                          so the product price on it is that product's price
//                          even when the name is three hundred characters away.
//
// Result-level binding yields a RETAIL price and nothing else. It is never
// applied to a second-hand board, a category page, a forum or a review, and it
// is refused when the page shows two different product prices.
//
// The vocabulary below is the market's. It is data, in one place.
// ══════════════════════════════════════════════════════════════════════════════
import { pricedNumbers } from '../phaseb/content-binding.js';
import { hostOf } from '../phaseb/search-provenance.js';
import { resolveMarketRegion } from '../phaseb/config.js';
import { relationOf, rootsIn, tokens, RELATION } from './market-identity.js';
import { classifyConfiguration } from './configuration.js';
import { classifySource, SOURCE_TYPE, LOCALE } from './source-type.js';
import { localePriceCandidates, CURRENCY_BASIS } from './locale-price.js';

export const ROLE = Object.freeze({
  PRODUCT_PRICE: 'PRODUCT_PRICE',
  PRODUCT_PRICE_WITH_DELIVERY: 'PRODUCT_PRICE_WITH_DELIVERY',
  DELIVERY_FEE: 'DELIVERY_FEE',
  INSTALLMENT: 'INSTALLMENT',
  DISCOUNT: 'DISCOUNT',
  OLD_PRICE: 'OLD_PRICE',
  ACCESSORY_PRICE: 'ACCESSORY_PRICE',
  UNKNOWN: 'UNKNOWN',
});
export const REFUSED = Object.freeze({
  NAKED_PRICE: 'price_with_no_listing_text',
  FEE: 'delivery_or_service_fee',
  NOT_ASKING: 'not_an_asking_price',
  INSTALLMENT: 'installment_amount',
  DISCOUNT: 'discount_amount',
  ACCESSORY: 'accessory_or_addon_price',
  SEVERAL_PRICES: 'several_prices_in_one_listing_block',
  SEVERAL_ON_PAGE: 'several_product_prices_on_one_product_page',
  NO_CURRENCY: 'price_without_currency_marker',
  OVER_BUDGET: 'over_observation_budget',
});
const REFUSAL_FOR = Object.freeze({
  [ROLE.DELIVERY_FEE]: REFUSED.FEE, [ROLE.INSTALLMENT]: REFUSED.INSTALLMENT, [ROLE.DISCOUNT]: REFUSED.DISCOUNT,
  [ROLE.OLD_PRICE]: REFUSED.NOT_ASKING, [ROLE.ACCESSORY_PRICE]: REFUSED.ACCESSORY, [ROLE.UNKNOWN]: REFUSED.NAKED_PRICE,
});
export const PAGE = Object.freeze({
  SINGLE_PRODUCT: 'single_product', CATEGORY: 'category_or_search', FORUM: 'forum', REVIEW: 'review', OTHER: 'other',
});
export const BINDING = Object.freeze({ SENTENCE: 'sentence', RESULT_TITLE: 'result_title', TABLE_ROW: 'table_row' });
export const SHAPE = Object.freeze({ SENTENCE: BINDING.SENTENCE, TABLE_ROW: BINDING.TABLE_ROW });

export const MAX_PER_RESULT = 12;
export const MAX_OBSERVATIONS = 60;
const MAX_TITLE = 220;
const MAX_LABEL = 90;

// A listing ends at any of these. A pipe does NOT end one: it separates the
// cells of a table row or the parts of a page title. So does a run of spaces,
// which is what a results table becomes when its markup is flattened to text.
const HARD = /\.{3,}|…|[\r\n]+|#{2,}|•|\s[–—]\s/gu;
const CELL = /\s\|(?=\s|$)|[^\S\r\n]{2,}/gu;
// What the search tool prepends to a snippet. Metadata, not page text — and it
// says which index the result came from.
const PREAMBLE = /^\s*\S*cite\S*\s*(\[wordlim:[^\]]*\])?\s*((Published|Crawled|Updated):[^;]*;\s*)*/u;
const PROVIDER_KIND = /turn\d+([a-z]+)\d+/;
const MARKER = /^\s{0,2}(?:₪|ש["״]?ח|שח|nis|ils|\$|usd|€|eur|£|gbp)/iu;
const LEADING_MARKER = /(?:₪|\$|€|£)\s{0,2}$/u;
const CURRENCY_WORDS = /[₪$€£]|ש["״]?ח|\b(ils|nis|usd|eur|gbp)\b/giu;
// An address that lists things rather than showing one.
const CATEGORY_URL = /(^|[/?&])(c|category|categories|collections?|search|brand|tag|archive)([/=?]|$)|models\.aspx|[?&](q|query|page|pageinfo|pagenumber)=/i;
const FORUM_URL = /\/(forums?|threads?|comments)\//i;

const LEXICON = Object.freeze({
  // Words that say delivery COSTS NOTHING carry no amount and label nothing.
  neutral: /משלוח חינם|ללא עלות נוספת|ללא עלות|free shipping|free delivery/giu,
  withDelivery: /כולל משלוח|כולל הובלה|incl(?:uding|\.)?\s+(?:delivery|shipping)/iu,
  delivery: /משלוח|שילוח|איסוף|הובלה|התקנה|דמי\s|תוספת של|בעלות של|delivery|shipping|postage|pickup|handling/iu,
  installment: /תשלומים|תשלום חודשי|לחודש|per month|monthly|\/mo\b/iu,
  discount: /הנחה|חיסכון|חסכון|קופון|discount|coupon|\bsave\b|\boff\b/iu,
  old: /במקום|מחיר קודם|מחיר מחירון|מחיר מקורי|נקנה|נקנתה|נרכש|קניתי|שילמתי|עלה לי|bought|paid|purchased|instead of|original price|list price|rrp|\bwas\b/iu,
  accessory: /בנוסף|אביזר|חלקי חילוף|חלק חילוף|accessor|replacement|spare part|add-on/iu,
  priceWord: /מחיר|החל מ|price|from/iu,
  sale: /למכירה|(?<!\p{L})מוכרת?(?!\p{L})|for sale|selling/iu,
  secondHand: /יד\s?שני[יה]ה?|יד\s?2|משומש|second.?hand|\bused\b|pre.?owned/iu,
  // "מוכר חיצוני" (an external seller ON a shop) and "נמכר ע״י" (sold by) are
  // retail-platform phrases. The word "מוכר" inside them is not a person
  // selling their own blender, and it must not read as sale intent.
  retail: /השוואת מחירים|הוסף לסל|הוספה לסל|במלאי|אחריות יבואן|יבואן רשמי|יבוא רשמי|יבוא מקביל|מוכר חיצוני|נמכר ע["״]?י|add to cart|in stock|buy now|price comparison|sold by|ships from|fulfilled by/iu,
  refurbished: /מוחדש|מחודש|refurbished|renewed|open.?box/iu,
});

const words = (s) => tokens(String(s).replace(CURRENCY_WORDS, ' ')).filter((t) => !/^\d+$/.test(t));

function blocksOf(text) {
  const out = [];
  let from = 0;
  for (const m of text.matchAll(HARD)) { out.push(text.slice(from, m.index)); from = m.index + m[0].length; }
  out.push(text.slice(from));
  return out.map((b) => b.trim()).filter(Boolean);
}

/**
 * Every currency-marked number in a block, with the role its label gives it.
 *
 * The LABEL is the text between the previous number and this one: the words
 * that introduce it. The tail is the little that follows it, read only for the
 * roles that are written after an amount ("a month", "off").
 */
export function classifyNumbers(block) {
  const prices = pricedNumbers(block).filter((p) => p.value > 0);
  const out = [];
  let prevEnd = 0;
  prices.forEach((p, i) => {
    const trailing = MARKER.exec(block.slice(p.end));
    const end = p.end + (trailing ? trailing[0].length : 0);
    const rawLabel = block.slice(Math.max(prevEnd, p.start - MAX_LABEL), p.start).replace(LEADING_MARKER, '');
    const nextStart = prices[i + 1]?.start ?? block.length;
    const rawTail = block.slice(end, Math.min(nextStart, end + 28)).replace(LEADING_MARKER, '');
    const label = rawLabel.replace(LEXICON.neutral, ' ');
    const tail = rawTail.replace(LEXICON.neutral, ' ');
    let role;
    if (LEXICON.old.test(label)) role = ROLE.OLD_PRICE;
    else if (LEXICON.withDelivery.test(label)) role = ROLE.PRODUCT_PRICE_WITH_DELIVERY;
    else if (LEXICON.delivery.test(label)) role = ROLE.DELIVERY_FEE;
    else if (LEXICON.installment.test(label) || LEXICON.installment.test(tail)) role = ROLE.INSTALLMENT;
    else if (LEXICON.discount.test(label) || /^\s*(?:%|הנחה|off\b)/iu.test(tail)) role = ROLE.DISCOUNT;
    else if (LEXICON.accessory.test(label)) role = ROLE.ACCESSORY_PRICE;
    else role = words(`${rawLabel} ${rawTail}`).length >= 1 ? ROLE.PRODUCT_PRICE : ROLE.UNKNOWN;
    out.push({ value: p.value, currency: p.currency, start: p.start, end, role, label: rawLabel.trim(), tail: rawTail.trim() });
    prevEnd = end;
  });
  return out;
}

/**
 * The product price inside a "price including delivery" amount — only when the
 * page itself says which delivery, and states that delivery's fee exactly once.
 */
function withoutDelivery(number, all) {
  const m = LEXICON.withDelivery.exec(number.label);
  if (!m) return null;
  const option = tokens(number.label.slice(m.index + m[0].length)).slice(0, 3);
  if (option.length === 0) return null;
  const fees = all.filter((n) => n.role === ROLE.DELIVERY_FEE && n.currency === number.currency
    && (() => { const t = tokens(n.label); return t.some((_, i) => option.every((o, j) => t[i + j] === o)); })());
  const distinct = [...new Set(fees.map((f) => f.value))];
  if (distinct.length !== 1 || distinct[0] >= number.value) return null;
  return { product_price: number.value - distinct[0], delivery_fee: distinct[0], delivery_option: option.join(' ') };
}

// Relations that say a text is about this product or its line. An unmarked
// price beside one of these is listed before the rest, so a reader sees it.
const NAMED = new Set([RELATION.EXACT, RELATION.REGIONAL_VARIANT, RELATION.SIBLING, RELATION.FAMILY]);

/** What kind of page a result is. Decided from its address, its index, its title and its model numbers. */
export function pageTypeOf({ url, kind, titleRelation, roots }) {
  if (kind === 'reddit' || FORUM_URL.test(url)) return PAGE.FORUM;
  if (kind === 'news') return PAGE.REVIEW;
  if (CATEGORY_URL.test(url.replace(/^https?:\/\/[^/]+/i, '')) || roots.length >= 2) return PAGE.CATEGORY;
  if ([RELATION.EXACT, RELATION.REGIONAL_VARIANT, RELATION.SIBLING].includes(titleRelation)) return PAGE.SINGLE_PRODUCT;
  return PAGE.OTHER;
}

/**
 * Candidate observations from provider results.
 *
 * `results` is `provenance.results`; `market` is assessMarketIdentity's report
 * (or null, in which case nothing is a single-product page and every binding is
 * strict). Returns { pages, entries, refused }: one page per result, one entry
 * per observation, one refusal per number that did not become one.
 *
 * Total: any input yields three arrays and never throws.
 */
export function extractListings(results, { market = null, region = resolveMarketRegion() } = {}) {
  const pages = [];
  const entries = [];
  const refused = [];
  const seenUrl = new Set();
  const seenPrice = new Set();
  const list = Array.isArray(results) ? results : [];

  // THE SAME PAGE, RETURNED TWICE, IS ONE SOURCE WITH MORE TEXT. Two queries
  // often return one address with two different excerpts. The repeats are
  // counted as duplicates, and their text is read with the first: what a page
  // says does not depend on which query found it.
  const excerpts = new Map();
  for (const r of list) {
    if (typeof r?.url !== 'string' || typeof r?.text !== 'string') continue;
    const body = r.text.replace(PREAMBLE, '');
    if (!excerpts.has(r.url)) excerpts.set(r.url, []);
    if (body && !excerpts.get(r.url).includes(body)) excerpts.get(r.url).push(body);
  }

  list.forEach((r, index) => {
    const url = typeof r?.url === 'string' ? r.url : null;
    const domain = hostOf(url);
    const page = {
      index, url, domain, title: typeof r?.title === 'string' ? r.title.slice(0, MAX_TITLE) : '',
      duplicate: false, page_type: PAGE.OTHER, title_relation: 'UNKNOWN', result_level: false,
      source_type: SOURCE_TYPE.UNKNOWN, locale: LOCALE.INTERNATIONAL,
      priced_numbers: 0, unmarked_prices: 0, observations: 0, refusals: 0,
    };
    pages.push(page);
    if (!url || !domain) return;
    if (seenUrl.has(url)) { page.duplicate = true; return; }
    seenUrl.add(url);

    const pageTitle = page.title;
    const snippet = typeof r?.text === 'string' ? r.text : '';
    const kind = PROVIDER_KIND.exec(snippet)?.[1] ?? 'search';
    const body = (excerpts.get(url) ?? []).join('\n');
    const whole = `${pageTitle}\n${body}`;
    page.title_relation = relationOf(pageTitle, market);
    page.page_type = pageTypeOf({ url, kind, titleRelation: page.title_relation, roots: rootsIn(whole) });
    const source = classifySource({ url, domain, title: pageTitle, text: body, kind, brand: market?.brand ?? null, region });
    page.source_type = source.source_type;
    page.locale = source.locale;
    // A marketplace for second-hand goods is a second-hand page whatever its
    // title says: its listings are bound strictly, and its prices are asked by
    // sellers, not shops.
    const usedMarketplace = page.source_type === SOURCE_TYPE.LOCAL_USED_MARKETPLACE || page.source_type === SOURCE_TYPE.INTERNATIONAL_USED_MARKETPLACE;
    const secondHandPage = LEXICON.secondHand.test(pageTitle) || LEXICON.sale.test(pageTitle) || usedMarketplace;
    const retailPage = !usedMarketplace && LEXICON.retail.test(pageTitle);
    page.result_level = page.page_type === PAGE.SINGLE_PRODUCT && !secondHandPage && kind === 'search';
    const refurbished = LEXICON.refurbished.test(pageTitle);

    const blocks = [pageTitle, body].filter(Boolean).flatMap(blocksOf);
    const refusedHere = new Set();
    const refuse = (n, reason, block) => {
      // One refusal per amount and reason: a page that prints its delivery fee
      // in two excerpts has one delivery fee.
      const key = `${n?.value}|${n?.currency}|${reason}`;
      if (refusedHere.has(key)) return;
      refusedHere.add(key);
      page.refusals += 1;
      refused.push({ url, reason, role: n?.role ?? null, value: n?.value ?? null, currency: n?.currency ?? null, text: String(block).slice(0, 160) });
    };
    const emit = (n, { title, binding, relation, kindOf, block = '', extra = {} }) => {
      const key = `${url}|${n.value}|${n.currency}`;
      if (seenPrice.has(key)) return;               // the same amount, printed again on the same page
      if (page.observations >= MAX_PER_RESULT || entries.length >= MAX_OBSERVATIONS) { refuse(n, REFUSED.OVER_BUDGET, title); return; }
      seenPrice.add(key);
      page.observations += 1;
      // WHAT IS BEING SOLD: the whole product, or a base, a box, a part. Read
      // off the listing's own words; UNKNOWN when it says nothing.
      // The page's own title speaks for a single listing's page ("… - BASE
      // ONLY | eBay"); on a page that lists many products it speaks for none.
      const configuration = classifyConfiguration(`${page.page_type === PAGE.CATEGORY ? '' : pageTitle}\n${title}\n${block}`);
      entries.push({
        observation: {
          source: url, source_domain: domain, listing_id_or_reference: null, title,
          observed_price: extra.product_price ?? n.value, currency: n.currency,
          condition: null, location: null, observed_at: null, listing_kind: kindOf,
          // No model read this listing, so there is no model opinion of it.
          match: { brand: null, model: null, variant: null, confidence: null },
        },
        page_index: index, page_title: pageTitle, page_type: page.page_type,
        source_type: page.source_type, locale: page.locale,
        binding, shape: binding, role: n.role, relation, kind: kindOf, refurbished,
        configuration: configuration.configuration, configuration_marker: configuration.marker,
        // Was the currency read off the page, or inferred from the host?
        currency_basis: extra.currency_basis ?? CURRENCY_BASIS.MARKER,
        // A category-page row that names the product: an anchor candidate, bound to its row.
        row_bound: extra.row_bound === true,
        stated_price: n.value, includes_delivery: n.role === ROLE.PRODUCT_PRICE_WITH_DELIVERY && !extra.product_price,
        delivery_fee: extra.delivery_fee ?? null, delivery_option: extra.delivery_option ?? null,
        sale_intent: kindOf === 'used_listing',
        // Only a second-hand listing, bound to its own sentence, may reach the
        // evidence gate. (A locale-inferred price is always new_retail and
        // row-bound, so it fails this twice over.)
        admissible: kindOf === 'used_listing' && binding === BINDING.SENTENCE,
        note: null,
      });
    };

    // ── RESULT LEVEL: ONE PRODUCT'S PAGE IN A SHOP ─────────────────────────
    if (page.result_level) {
      const all = blocks.flatMap((block) => classifyNumbers(block).map((n) => ({ ...n, block })));
      page.priced_numbers = all.length;
      let product = all.filter((n) => n.role === ROLE.PRODUCT_PRICE || n.role === ROLE.PRODUCT_PRICE_WITH_DELIVERY);
      // A price under a heading has no label at all. On a page about one
      // product, the only unexplained amount is the price.
      if (product.length === 0) {
        const bare = all.filter((n) => n.role === ROLE.UNKNOWN);
        if (new Set(bare.map((n) => n.value)).size === 1) product = bare.map((n) => ({ ...n, role: ROLE.PRODUCT_PRICE }));
      }
      const chosen = new Set(product);
      const priced = product.map((n) => ({ n, extra: n.role === ROLE.PRODUCT_PRICE_WITH_DELIVERY ? (withoutDelivery(n, all) ?? {}) : {} }));
      const distinct = [...new Set(priced.map(({ n, extra }) => extra.product_price ?? n.value))];
      for (const n of all) {
        if (chosen.has(n) || product.some((p) => p.start === n.start && p.block === n.block)) continue;
        // The product price printed again under a heading is the same price, not a second number.
        if (n.role === ROLE.UNKNOWN && product.some((p) => p.value === n.value && p.currency === n.currency)) continue;
        refuse(n, REFUSAL_FOR[n.role] ?? REFUSED.NAKED_PRICE, n.block);
      }
      if (distinct.length > 1) {
        for (const { n } of priced) refuse(n, REFUSED.SEVERAL_ON_PAGE, n.block);
      } else {
        for (const { n, extra } of priced) {
          emit(n, { title: pageTitle, binding: BINDING.RESULT_TITLE, relation: page.title_relation, kindOf: 'new_retail', block: n.block, extra });
        }
      }
    } else {
      // ── STRICT: THE PRICE AND THE NAME IN ONE SENTENCE ────────────────────
      for (const block of blocks) {
        const numbers = classifyNumbers(block);
        if (numbers.length === 0) continue;
        page.priced_numbers += numbers.length;
        const asking = numbers.filter((n) => n.role === ROLE.PRODUCT_PRICE || n.role === ROLE.PRODUCT_PRICE_WITH_DELIVERY);
        for (const n of numbers) if (!asking.includes(n)) refuse(n, REFUSAL_FOR[n.role] ?? REFUSED.NAKED_PRICE, block);
        if (asking.length === 0) continue;
        if (new Set(asking.map((n) => `${n.value}|${n.currency}`)).size > 1) {
          for (const n of asking) refuse(n, REFUSED.SEVERAL_PRICES, block);
          continue;
        }
        const n = asking[0];
        // The cell holding the price. With words beside it, that cell is the
        // listing's own sentence. Alone, it is one cell of a table row.
        const cells = block.split(CELL).map((c) => c.trim()).filter(Boolean);
        const own = cells.find((c) => pricedNumbers(c).some((p) => p.value === n.value)) ?? block;
        const tableRow = words(own).length < 2;
        const title = (tableRow ? cells.filter((c) => c !== own).join(' | ') : own).slice(0, MAX_TITLE);
        if (words(title).length < 2) { refuse({ ...n, role: ROLE.UNKNOWN }, REFUSED.NAKED_PRICE, block); continue; }
        const retail = retailPage || (!usedMarketplace && LEXICON.retail.test(block));
        const saleIntent = !retail && (secondHandPage || LEXICON.sale.test(block) || LEXICON.secondHand.test(block));
        const kindOf = retail ? 'new_retail' : (saleIntent ? 'used_listing' : 'unknown');
        const before = entries.length;
        const relation = relationOf(title, market);
        // A shop's category or comparison page lists many products, one price
        // beside each name. A retail row on such a page is bound to its row;
        // whether the row names THIS product is the relation beside it, and
        // the anchor rule (evidence.js) reads both.
        const rowBound = kindOf === 'new_retail' && page.page_type === PAGE.CATEGORY;
        emit(n, { title, binding: tableRow ? BINDING.TABLE_ROW : BINDING.SENTENCE, relation, kindOf, block, extra: { row_bound: rowBound } });
        if (entries.length > before) {
          const e = entries[entries.length - 1];
          e.note = e.admissible ? null
            : (tableRow ? 'table_row_identity_is_not_beside_the_price'
              : (kindOf === 'new_retail' ? 'retail_page' : 'nothing_says_this_is_for_sale'));
        }
      }
    }

    // A page with no marked amount may still print one. On a shop INSIDE the
    // market, in the market's own price form, beside this product's own name
    // or number, it is that shop's price for the product and the currency is
    // the market's: a retail-anchor candidate, never a used listing, labelled
    // as inferred (locale-price.js). Everywhere else it is reported and not
    // used — nothing says what currency it is in — and it is not hidden.
    if (page.priced_numbers === 0) {
      const retailContext = !secondHandPage && (retailPage || LEXICON.retail.test(whole)
        || [SOURCE_TYPE.LOCAL_RETAIL, SOURCE_TYPE.PRICE_COMPARISON, SOURCE_TYPE.MANUFACTURER].includes(page.source_type));
      const { candidates, refused: bare } = localePriceCandidates(whole, {
        market, region, local: page.locale === LOCALE.LOCAL, retail: retailContext,
      });
      for (const c of candidates) {
        emit({ value: c.value, currency: c.currency, role: ROLE.PRODUCT_PRICE }, {
          title: c.name, binding: BINDING.TABLE_ROW, relation: c.relation, kindOf: 'new_retail', block: c.name,
          extra: { currency_basis: c.currency_basis, row_bound: true },
        });
      }
      // Those printed beside THIS product's line are listed first: they are
      // the ones a reader would want to know were seen and not used.
      const ours = bare.filter((u) => NAMED.has(u.relation));
      for (const u of [...ours, ...bare.filter((x) => !ours.includes(x))].slice(0, MAX_PER_RESULT)) {
        const key = `${u.value}|unmarked`;
        if (refusedHere.has(key)) continue;
        refusedHere.add(key);
        page.unmarked_prices += 1;
        page.refusals += 1;
        refused.push({
          url, reason: u.reason === 'not_an_asking_price' ? REFUSED.NOT_ASKING : REFUSED.NO_CURRENCY, role: ROLE.UNKNOWN,
          value: u.value, currency: null, relation: u.relation, note: u.note ?? null, text: `${u.value} ${u.after}`.slice(0, 160),
        });
      }
    }
  });
  return { pages, entries, refused };
}
