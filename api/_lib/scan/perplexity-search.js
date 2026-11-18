// ══════════════════════════════════════════════════════════════════════════════
// PERPLEXITY SEARCH API (POST /search, 2026-11-18): ranked web results, no model. Off unless configured.
//
// This is NOT perplexity.js (the Agent API, POST /v1/agent, where a model reads the search and reports evidence). The
// Search API returns only {title, url, snippet, date, last_updated} per page. Nothing here asks a model anything: the
// prices are read off the snippet text by the same currency reader the binding step uses (content-binding.js), each
// becomes a claim, and every claim then passes the checks an OpenAI-reported price passes (evidence.js verifyEvidence →
// binding.js bindPrice): the page must be one the search returned, the snippet must show THIS product beside THAT price
// with no other price or model in the row, another size, a bundle or an archive ad is set aside, and a source whose
// operator forbids collection is dropped (../market/sources.js). A claim made here is never more generous than the text:
//   - a page whose address is not a known one-listing shape is claimed as a LIST page, so only a row that holds the
//     product and one price can bind (VERIFIED_ROW), never the page as a whole;
//   - "wanted" ads are skipped; bundles and parts are claimed as such;
//   - the result `date` is the page's PUBLICATION date and is passed as the provider's note, which verifyEvidence uses
//     only for a one-listing page. `last_updated` is never used: a re-crawl does not show that an ad is still for sale.
//
// TERMS (docs/audits/GW-PERPLEXITY-SEARCH-2026-11-18.md): under the Search Service addendum the customer does NOT own
// Search API output, unlike Agent API output. Until the founder decides otherwise this path is experimental and
// transient: snippets are never stored (the research record keeps derived price facts and URLs, as for every provider),
// and the flag is off in Production.
//
// Enabled only when CORE_SCAN_PERPLEXITY_SEARCH is exactly 'true' AND PERPLEXITY_API_KEY is set (server-side only).
// ══════════════════════════════════════════════════════════════════════════════
import { pricedNumbers } from '../phaseb/content-binding.js';
import { transliterates } from '../script-normalization.js';
import { searchNames } from './market.js';
import { pageTypeOf } from './evidence.js';
import { SOURCES, SOURCE_KIND, mayUseInScan, sourceOf } from '../market/sources.js';

export const PPLX_SEARCH_URL = 'https://api.perplexity.ai/search';
export const PPLX_SEARCH_FLAG_ENV = 'CORE_SCAN_PERPLEXITY_SEARCH';
export const PPLX_SEARCH_KEY_ENV = 'PERPLEXITY_API_KEY';
export const PPLX_SEARCH_TYPE_ENV = 'PERPLEXITY_SEARCH_TYPE';
export const PPLX_SEARCH_TYPES = Object.freeze(['web', 'fast']);
export const PPLX_SEARCH_TYPE_DEFAULT = 'fast';
// Published prices (docs.perplexity.ai/docs/getting-started/pricing, read 2026-11-18): per successful request, not per query.
export const PPLX_SEARCH_PRICE_USD = Object.freeze({ web: 0.005, fast: 0.001 });
export const PPLX_SEARCH_TIMEOUT_MS = 8_000;
// The API accepts up to 5 queries per request; web search returns up to 20 results.
export const PPLX_MAX_QUERIES = 5;
const MAX_RESULTS = 20;
// Results the provider ranks, but from which GetWorth may not take a price (sources.js NOT_AUTHORIZED) or which never
// carry one (forums): excluded from the open request so the 20 places go to pages that can count.
const DENY = ['-yad2.co.il', '-facebook.com', '-reddit.com', '-youtube.com', '-tiktok.com', '-instagram.com'];
// The Israeli second-hand boards a scan may read inside search results (sources.js, permission ≠ not_authorized).
export const BOARD_DOMAINS = Object.freeze(SOURCES.filter((s) => s.kind === SOURCE_KIND.SECONDHAND && mayUseInScan(s)).flatMap((s) => s.sites).filter((d) => d.includes('.')).slice(0, 20));

/** { key, searchType } when switched on and configured; otherwise null. The key never leaves the server. */
export function resolvePerplexitySearch(env = process.env) {
  if (String(env?.[PPLX_SEARCH_FLAG_ENV] ?? '').trim().toLowerCase() !== 'true') return null;
  const key = String(env?.[PPLX_SEARCH_KEY_ENV] ?? '').trim();
  if (!key) return null;
  const t = String(env?.[PPLX_SEARCH_TYPE_ENV] ?? '').trim().toLowerCase();
  return { key, searchType: PPLX_SEARCH_TYPES.includes(t) ? t : PPLX_SEARCH_TYPE_DEFAULT };
}

const uniq = (list) => { const seen = new Set(); return list.filter((q) => { const k = q.toLowerCase(); return q && !seen.has(k) && seen.add(k); }); };

/**
 * The queries, plain text (the Search API documents no `site:` or `OR` operators; domains go in the filter): the exact
 * name with its capacity, the model number, the Hebrew name, an alias, in the words of an Israeli second-hand ad; and one
 * new-price query. Built only from the identity's names (market.js searchNames): no owner free text, no personal data
 * (Search Service addendum §2.3).
 */
// An owner's answer reaches a query only when it reads as a configuration ("256 GB", "דור 2"): short, a number in it, no
// run of digits a phone number or an ID is written with. Anything else stays out of the search service's hands.
export const configurationAnswer = (answer) => {
  const t = String(answer?.text ?? '').trim();
  return t && t.length <= 24 && /\d/.test(t) && !/\d[\d\s-]{5,}\d/.test(t) && !/[@:/]/.test(t) && t.split(/\s+/).length <= 4 ? answer : null;
};

export function perplexitySearchQueries(identity, answer = null) {
  const { name, codes, aliases, hebrew } = searchNames(identity, configurationAnswer(answer));
  if (!name) return { open: [], boards: [] };
  const open = uniq([
    `${name} יד שנייה למכירה`,
    hebrew ? `${hebrew} יד שנייה` : `${name} משומש`,
    codes[0] ? `${codes[0]} יד שנייה` : null,
    aliases[0] ? `${aliases[0]} יד שנייה` : null,
    `${codes[0] ?? name} מחיר`,
  ].filter(Boolean)).slice(0, PPLX_MAX_QUERIES);
  const boards = uniq([
    `${name} למכירה`,
    hebrew ? `${hebrew} למכירה` : null,
    hebrew ? `${hebrew} משומש` : `${name} used`,
    codes[0] ?? null,
  ].filter(Boolean)).slice(0, PPLX_MAX_QUERIES);
  return { open, boards };
}

/** The two request bodies: the open search held to Israel without forbidden sources, and the permitted boards only. */
export function perplexitySearchRequests({ identity, answer = null, searchType = PPLX_SEARCH_TYPE_DEFAULT }) {
  const { open, boards } = perplexitySearchQueries(identity, answer);
  const common = { country: 'IL', max_results: MAX_RESULTS, search_type: searchType };
  return [
    open.length ? { name: 'open', body: { ...common, query: open, search_domain_filter: DENY } } : null,
    boards.length && BOARD_DOMAINS.length ? { name: 'boards', body: { ...common, query: boards, search_domain_filter: [...BOARD_DOMAINS] } } : null,
  ].filter(Boolean);
}

// ── FROM SNIPPET TO CLAIM ───────────────────────────────────────────────────
const WANTED = /(^|[^\p{L}])(קונה|קונים|מחפש|מחפשת|דרוש|דרושה|wanted|wtb|looking for)([^\p{L}]|$)/iu;
const BUNDLE = /(\+\s*\d*\s*(משחק|משחקים|games?|בקר|בקרים|controllers?|אביזרים)|באנדל|bundle|כולל\s+\d+\s+משחקים)/iu;
const PARTS = /(לחלקים|לא עובד|לא עובדת|תקול|תקולה|for parts|not working|broken)/iu;
// A board's own articles are not its ads: /guides/, /blog/, /magazine/ … (shukshuk.co.il/en/guides/sell-old-phone).
const EDITORIAL = /\/(guides?|blog|articles?|magazine|news|help|faq|tips|מדריך|מדריכים|כתבות)(\/|$)/iu;
const CLASSIFIED = (url) => sourceOf(url)?.kind === SOURCE_KIND.SECONDHAND && !EDITORIAL.test(String(url).replace(/^https?:\/\/[^/]+/i, ''));
const SHOP = (url) => sourceOf(url)?.kind === SOURCE_KIND.RETAIL;
const USED_WORDS = /(יד שני|יד 2|יד2|משומש|מחודש|refurbished|renewed|used|second.?hand|pre.?owned|כמו חדש|like new)/iu;
const IL = /\.il$/i;
const hostOf = (url) => (String(url ?? '').match(/^https?:\/\/(?:www\.|m\.)?([^/?#:]+)/i)?.[1] ?? '').toLowerCase();
const DAY_MS = 86_400_000;

/** The result's publication date as the provider's note verifyEvidence reads ("published: 12 days ago;"), or ''. */
export function publishedNote(date, today) {
  const d = Date.parse(`${String(date ?? '').slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${String(today ?? '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d) || !Number.isFinite(t) || d > t) return '';
  const days = Math.round((t - d) / DAY_MS);
  return `published: ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}; `;
}

/**
 * Every currency-marked price in a result's title and snippet, as a claim in the market evidence shape. One claim per
 * distinct (price, currency) on a page. Claims say only what the address and the words show; binding decides the rest.
 */
// Storage written on a page: "256GB", "1 TB", "128 גיגה".
const CAPACITY = /(\d{2,4}|[12])\s?(gb|tb|גיגה|ג'יגה|ג׳יגה|טרה)(?![\p{L}\p{N}])/giu;
const capacitiesIn = (text) => [...String(text ?? '').matchAll(CAPACITY)].map((m) => `${Number(m[1])}${/^(tb|טרה)$/i.test(m[2]) ? 'tb' : 'gb'}`);

// What a thing sold by description is NAMED, beyond its brand and its kind: POÄNG, KALLAX. Words of four letters or more.
const fold = (v) => String(v ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (v) => fold(v).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export function modelWords(identity) {
  const i = identity ?? {};
  const generic = new Set([...wordsOf(i.brand), ...wordsOf(i.item_type), ...wordsOf(i.category), 'armchair', 'chair', 'shelf', 'shelving', 'unit', 'table', 'sofa', 'bed', 'desk', 'cabinet', 'lamp']);
  return [...new Set(wordsOf(i.model ?? i.product_family))].filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !generic.has(w) && !/^\d+x\d+$/.test(w));
}
/** Does the text name the item's model word, in either alphabet? */
const namesModel = (text, words) => { const t = wordsOf(text); return words.some((w) => t.some((x) => x === w || transliterates(x, w, { minLength: 3 }))); };

export function claimsOf(result, identity = null) {
  const url = typeof result?.url === 'string' && /^https?:\/\//i.test(result.url) ? result.url : null;
  if (!url) return [];
  const title = typeof result.title === 'string' ? result.title.slice(0, 300) : '';
  const snippet = typeof result.snippet === 'string' ? result.snippet : '';
  const text = `${title}\n${snippet}`;
  if (WANTED.test(title)) return [];
  // THE EILAT PAGE (no VAT): Zap serves it at its own address (iseilat=true) and names it in the title ("… באילת"), not
  // beside the price, where binding looks (2026-11-18: Galaxy S23 "new ₪2,045" from it). No price of it is a price here.
  if (/[?&]iseilat=(true|1)\b/i.test(url) || /(^|[^\p{L}])(באילת|אילת|eilat)([^\p{L}]|$)/iu.test(title)) return [];
  // A THING SOLD BY DESCRIPTION binds on the words of its kind and its brand (binding.js namesOf), on the understanding
  // that a model has already set aside other things. Nothing here reads like a model: an IKEA crib (₪290) and an IKEA
  // display cabinet (₪450) bound as an exact POÄNG and KALLAX (replay 2026-11-18). So the result must carry the model's
  // own name; an item with no such name gets no claim from this provider.
  if (identity?.identity_precision === 'descriptive') {
    const words = modelWords(identity);
    if (!words.length || !namesModel(text, words)) return [];
  }
  // ANOTHER CAPACITY IN THE TITLE (2026-11-18: "Galaxy S23 SM-S911B/DS 256GB" on Zap claimed as the 128 GB item's new
  // price; the snippet line with the price did not repeat the size, so binding could not see it). A page titled with
  // storage, none of it the item's, is another product's page.
  const own = capacitiesIn(identity?.size_or_capacity);
  const titled = capacitiesIn(title).filter((c) => !/^(4|6|8|12|16)gb$/.test(c)); // RAM sizes are not storage
  if (own.length && titled.length && !titled.some((c) => own.includes(c))) return [];
  const known = pageTypeOf(url, null);
  const prices = pricedNumbers(text).filter((p) => p.value >= 10);
  const distinct = [...new Map(prices.map((p) => [`${p.value}|${p.currency}`, p])).values()];
  // A page whose address is not a one-listing shape is a list as far as a claim goes; so is one whose text has several prices.
  const page = known !== 'other' ? known : 'search_or_category';
  // A private ad only on a registered second-hand board: "used" in a snippet is also how a guide, a review or a trade-in
  // page reads (replay 2026-11-18: a Shukshuk guide "how to sell an old iPhone … ₪759" bound as an exact ad). A shop
  // page that speaks of used units is a business reselling (`refurbished`), never a private ad.
  // A shop or comparison page whose snippet also speaks of used or refurbished units mixes new and used offers (Zap's
  // iPhone 14 page, 2026-11-18: lowest offer ₪1,149 beside new ones): which price is new cannot be told, so none is claimed.
  if (SHOP(url) && !CLASSIFIED(url) && USED_WORDS.test(text)) return [];
  const kind = CLASSIFIED(url) ? 'used_listing' : (SHOP(url) ? 'new_retail' : 'other');
  const match = PARTS.test(text) ? 'part' : (BUNDLE.test(text) ? 'bundle' : 'exact');
  return distinct.slice(0, 8).map((p) => ({
    url, title: title || snippet.slice(0, 120), price: p.value, currency: p.currency, kind, match,
    market: IL.test(hostOf(url)) ? 'IL' : 'INTL', condition: 'unknown', page, listed: null, stock: 'unknown', shipping: null,
  }));
}

/**
 * The answer as the price step reads every stage's: `raw` (claims), `provenance` (pages returned, each with its snippet as
 * page text, the publication date as the provider's note) and `meta`.
 */
export function parsePerplexitySearch(bodies, { today, queries = [], identity = null } = {}) {
  const results = [];
  for (const body of bodies) for (const r of Array.isArray(body?.results) ? body.results.flat() : []) {
    if (!r || typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url)) continue;
    results.push(r);
  }
  const evidence = results.flatMap((r) => claimsOf(r, identity));
  return {
    raw: { evidence },
    provenance: {
      tool: 'perplexity_search', search_performed: results.length > 0, queries: [...new Set(queries)],
      sources: [...new Set(results.map((r) => r.url))],
      results: results.map((r) => ({ url: r.url, title: typeof r.title === 'string' ? r.title.slice(0, 300) : null, text: typeof r.snippet === 'string' ? `${publishedNote(r.date, today)}${r.snippet.slice(0, 4000)}` : null })),
    },
  };
}

/**
 * What of a verified Search API stage may join the pool: prices the snippet tied to the product (binding.js isBound),
 * and from a page that is not a known list page, ONE price at most. A snippet of one ad that shows two prices (DoskaTV
 * AirPods Pro 2, 2026-11-18: "450 ₪" in the title, "400" in the text) does not say which is asked: neither is kept.
 */
export function searchApiKeep(evidence, isBound) {
  const bound = (Array.isArray(evidence) ? evidence : []).filter(isBound);
  const byPage = new Map();
  for (const e of bound) { const k = String(e.url); byPage.set(k, [...(byPage.get(k) ?? []), e]); }
  return [...byPage.entries()].flatMap(([url, list]) => (list.length > 1 && pageTypeOf(url, null) !== 'search_or_category' ? [] : list));
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** HTTP statuses worth one retry: rate limit and transient server errors. 401/403/422 are not retried. */
const RETRY = new Set([429, 500, 502, 503, 504]);

/** One POST /search, retried once on a rate limit or transient failure while time remains. Throws a classified error. */
async function post({ body, key, fetchImpl, signal, deadline }) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(PPLX_SEARCH_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal?.aborted) throw new Error('perplexity_search timeout');
      if (attempt === 0 && Date.now() + 600 < deadline) { await sleep(250 + Math.random() * 250); continue; }
      throw new Error(`perplexity_search network ${String(err?.message ?? err).slice(0, 80)}`);
    }
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (!json || !Array.isArray(json.results)) throw new Error('perplexity_search unreadable answer');
      return json;
    }
    if (RETRY.has(res.status) && attempt === 0 && Date.now() + 1200 < deadline) {
      const after = Number(res.headers?.get?.('retry-after'));
      await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 400 + Math.random() * 400, Math.max(0, deadline - Date.now() - 800)));
      continue;
    }
    // The status only: an error body may echo the request, and the request header carries the key.
    throw new Error(`perplexity_search HTTP ${res.status}${res.status === 401 ? ' (key rejected)' : res.status === 429 ? ' (rate limited)' : ''}`);
  }
}

/**
 * The Search API stage: both requests at once, within one deadline. Either one alone is an answer; both failing throws.
 * `meta.cost_usd` is the published price of the requests that succeeded (the API charges successful requests only).
 */
export async function researchPerplexitySearch({ identity, answer = null, key, searchType = PPLX_SEARCH_TYPE_DEFAULT, fetchImpl = fetch, today = null, timeoutMs = PPLX_SEARCH_TIMEOUT_MS, signal = null }) {
  const requests = perplexitySearchRequests({ identity, answer, searchType });
  if (!requests.length) throw new Error('perplexity_search: nothing to search for');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const t0 = Date.now();
  try {
    const settled = await Promise.allSettled(requests.map((r) => post({ body: r.body, key, fetchImpl, signal: ctrl.signal, deadline: t0 + timeoutMs })));
    const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    if (!ok.length) throw settled[0].reason;
    const parsed = parsePerplexitySearch(ok, { today, identity, queries: requests.flatMap((r) => r.body.query) });
    const per = PPLX_SEARCH_PRICE_USD[searchType] ?? PPLX_SEARCH_PRICE_USD.web;
    return {
      ...parsed,
      meta: {
        model: null, usage: null, queries_planned: requests.reduce((n, r) => n + r.body.query.length, 0),
        search_type: searchType, requests: requests.length, succeeded: ok.length,
        failed: settled.filter((s) => s.status === 'rejected').map((s) => String(s.reason?.message ?? s.reason).slice(0, 80)),
        cost_usd: Math.round(ok.length * per * 1e5) / 1e5, ms: Date.now() - t0,
      },
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}
