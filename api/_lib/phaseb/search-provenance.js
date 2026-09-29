// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — WHAT THE SEARCH TOOL ACTUALLY DID
//
// THE DEFECT THIS FILE CLOSES. The market stage attached a search tool and then
// asked the MODEL whether a search had happened: `search_performed` was a
// boolean in the model's own JSON. So a response written entirely from memory,
// with `search_performed: true` and a plausible domain beside each price, was
// indistinguishable from a researched one — and was labelled
// `openai_web_search` either way.
//
// A model's account of its own work is a claim. The Responses API returns a
// separate record of what the tool did — `web_search_call` items, written by
// the platform rather than by the model — and that record is the only thing
// read here.
//
//   extractSearchProvenance   what the tool did, from the raw output
//   bindObservations          which observations name a source the tool reached
//   classifyMarketEvidence    what kind of evidence an observation is
//
// ── WHAT BINDING PROVES, AND WHAT IT DOES NOT ───────────────────────────────
//
// Binding proves the claimed source is one the search really consulted. It does
// NOT prove the price was on that page: GetWorth never fetches a URL (§13,
// §40), so the page's contents are not available to check. That limit is
// stated rather than papered over — a bound observation is a CANDIDATE with a
// real source, and everything the qualification gate demands still applies.
//
// No import from the evidence engine, and none the other way. This module
// knows about search; api/_lib/market-evidence.js knows about evidence.
// ══════════════════════════════════════════════════════════════════════════════

import { contentSupports } from './content-binding.js';

export const UNBOUND = Object.freeze({
  NO_SEARCH: 'no_web_search_call',
  NO_SOURCE: 'observation_names_no_source',
  NOT_IN_PROVENANCE: 'source_not_in_search_provenance',
  SOURCE_MISMATCH: 'source_domain_disagrees_with_source_url',
});

export const BINDING = Object.freeze({ CONTENT: 'content', URL: 'url', DOMAIN: 'domain' });

export const MARKET_CLASS = Object.freeze({
  USED_LISTING: 'USED_LISTING',
  NEW_RETAIL: 'NEW_RETAIL',
  MARKETPLACE_LISTING: 'MARKETPLACE_LISTING',
  FOREIGN_CONTEXT: 'FOREIGN_CONTEXT',
  OTHER: 'OTHER',
});

const MAX_SOURCES = 60;
const MAX_QUERIES = 24;
const MAX_URL = 500;
const MAX_TITLE = 200;
const MAX_RESULT_TEXT = 4000;

// PARSED AS TEXT, never with the URL constructor. Nothing here is a request
// target — these strings are compared and displayed, and GetWorth fetches none
// of them (§13, §40) — and the provider scanner rightly treats a constructed
// URL as something that might be fetched. A pattern cannot be.
const HTTP_URL = /^https?:\/\/([^\s/?#]+)([^\s?#]*)(?:\?([^\s#]*))?/i;

// Parameters that say where a visitor came from, not which page this is.
const TRACKING_PARAM = /^(utm_[a-z0-9_]*|fbclid|gclid|msclkid|mc_cid|mc_eid)$/i;

/** An http(s) URL, bounded, or null. Anything else is not a source. */
function cleanUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > MAX_URL || /\s/.test(s) || !HTTP_URL.test(s)) return null;
  return s;
}

/** A host, lowercased, without a leading www. Accepts a URL or a bare domain. */
export function hostOf(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0]
    .replace(/^[^@]*@/, '').replace(/^www\./, '').replace(/:\d+$/, '');
  return host.includes('.') && !/\s/.test(host) ? host : null;
}

/**
 * Host, path and query — minus tracking parameters and the fragment.
 *
 * THE QUERY IS IDENTITY. The first version dropped it, and the first live
 * response showed what that costs: `model.aspx?modelid=1096583` is a product
 * and `?pageNumber=7` is a page, so nineteen sources were recorded as twelve
 * and an observation could bind at URL level to a page that was never reached.
 * Only parameters that describe the VISIT are removed.
 */
function urlKey(raw) {
  const url = cleanUrl(raw);
  const m = url ? HTTP_URL.exec(url) : null;
  const host = m ? hostOf(m[1]) : null;
  if (!host) return null;
  const query = (m[3] ?? '').split('&')
    .filter((pair) => pair && !TRACKING_PARAM.test(pair.split('=')[0]))
    .sort().join('&');
  return `${host}${m[2].replace(/\/+$/, '')}${query ? `?${query}` : ''}`.toLowerCase();
}

const title = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TITLE) : null);

/**
 * Read what the search tool did from a raw Responses-API `output` array.
 *
 * Total: any input yields a record and never throws. An output with no
 * completed `web_search_call` yields `search_performed: false`, whatever the
 * model's message says.
 */
export function extractSearchProvenance(output) {
  const items = Array.isArray(output) ? output : [];
  const calls = items.filter((i) => i?.type === 'web_search_call');
  // ONLY A COMPLETED CALL COUNTS. `failed` and `incomplete` are calls the tool
  // did not finish; counting one would let a search that returned nothing
  // stand behind observations it cannot have produced.
  const completed = calls.filter((c) => c?.status === 'completed');

  const queries = [];
  const opened = [];
  const results = [];
  const details = new Map();
  const note = (raw, via, heading = null) => {
    const url = cleanUrl(raw);
    const domain = hostOf(url);
    if (!url || !domain) return;
    const key = urlKey(url);
    const seen = details.get(key);
    if (seen) { if (!seen.title && heading) seen.title = heading; return; }
    if (details.size < MAX_SOURCES) details.set(key, { url, domain, title: heading, via });
  };

  for (const c of completed) {
    const a = c?.action ?? {};
    // THE TEXT THE PROVIDER SHOWED THE MODEL, per result. Present only when the
    // request asked for it. Kept exactly as returned and never completed: a
    // result with no text is recorded as having none.
    for (const r of Array.isArray(c?.results) ? c.results : []) {
      const url = cleanUrl(r?.url);
      if (!url || results.length >= MAX_SOURCES) continue;
      const text = typeof r?.snippet === 'string' ? r.snippet
        : (typeof r?.text === 'string' ? r.text : null);
      results.push({
        url, domain: hostOf(url), title: title(r?.title),
        text: text ? text.slice(0, MAX_RESULT_TEXT) : null,
      });
      note(url, 'search_result', title(r?.title));
    }
    if (a.type === 'search') {
      for (const q of [a.query, ...(Array.isArray(a.queries) ? a.queries : [])]) {
        const text = typeof q === 'string' ? q.trim().slice(0, 300) : '';
        if (text && !queries.includes(text) && queries.length < MAX_QUERIES) queries.push(text);
      }
      for (const s of Array.isArray(a.sources) ? a.sources : []) {
        note(typeof s === 'string' ? s : s?.url, 'search_source', title(s?.title));
      }
    } else if (a.type === 'open_page' || a.type === 'find_in_page' || a.type === 'find') {
      // Recorded on its own as well as among the sources: a page the search
      // had already returned is still a page that was then OPENED, and that
      // is the stronger fact.
      const url = cleanUrl(a.url);
      if (url && !opened.some((o) => urlKey(o) === urlKey(url)) && opened.length < MAX_SOURCES) opened.push(url);
      note(a.url, 'page_opened');
    }
  }

  // CITATIONS COUNT ONLY BESIDE A REAL CALL. An annotation is attached to the
  // model's message; without a completed call behind it, it is more of the
  // model's text and proves nothing about a search.
  const citations = [];
  if (completed.length > 0) {
    for (const item of items) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        for (const an of Array.isArray(part?.annotations) ? part.annotations : []) {
          if (an?.type !== 'url_citation') continue;
          const url = cleanUrl(an.url);
          if (!url) continue;
          if (citations.length < MAX_SOURCES) citations.push({ url, title: title(an.title) });
          note(url, 'citation', title(an.title));
        }
      }
    }
  }

  const sourceDetails = [...details.values()];
  return {
    tool: 'web_search',
    search_performed: completed.length > 0,
    web_search_call_count: calls.length,
    completed_call_count: completed.length,
    search_call_count: completed.filter((c) => c?.action?.type === 'search').length,
    queries,
    sources: sourceDetails.map((s) => s.url),
    source_domains: [...new Set(sourceDetails.map((s) => s.domain))].sort(),
    source_details: sourceDetails,
    citations,
    pages_opened: opened,
    results,
  };
}

/** Same site: identical, or one is a subdomain of the other. */
function sameSite(a, b) {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Split observations into those whose claimed source the search really
 * reached, and those it did not.
 *
 * THE DOMAIN CHECKED IS THE ONE QUALIFICATION WILL COUNT. The evidence gate
 * reads `source_domain ?? source` for its source-diversity floor, so that is
 * the value bound here. Binding a different field would verify one string and
 * grant on another.
 */
export function bindObservations(observations, provenance) {
  const bound = [];
  const unbound = [];
  const bindings = { [BINDING.CONTENT]: 0, [BINDING.URL]: 0, [BINDING.DOMAIN]: 0 };
  // One entry per BOUND observation, in order: the level it reached and, when
  // it stopped short of content, why. Kept beside the observations rather
  // than on them, so what reaches the evidence gates is unchanged.
  const levels = [];
  const list = Array.isArray(observations) ? observations : [];

  if (!provenance?.search_performed) {
    for (const o of list) unbound.push({ observation: o, reason: UNBOUND.NO_SEARCH });
    return { bound, unbound, bindings, levels };
  }

  const textByUrl = new Map();
  for (const r of Array.isArray(provenance.results) ? provenance.results : []) {
    const key = urlKey(r?.url);
    // THE TITLE IS PROVIDER TEXT TOO, and on a listing page it is where the
    // price is: the provider returned "… for sale in <city> 1,800 ₪" as the
    // title and a description with no price as the snippet. Each goes on its
    // own line, so a title and a snippet are separate segments.
    const text = [r?.title, r?.text].filter((v) => typeof v === 'string' && v.trim()).join('\n');
    if (key && text) textByUrl.set(key, textByUrl.has(key) ? `${textByUrl.get(key)}\n${text}` : text);
  }

  const domains = Array.isArray(provenance.source_domains) ? provenance.source_domains : [];
  const urls = new Set((provenance.sources ?? []).map(urlKey).filter(Boolean));

  for (const o of list) {
    const claimed = hostOf(o?.source_domain ?? o?.source);
    if (!claimed) { unbound.push({ observation: o, reason: UNBOUND.NO_SOURCE }); continue; }

    const sourceUrl = cleanUrl(o?.source);
    if (sourceUrl && !sameSite(hostOf(sourceUrl), claimed)) {
      unbound.push({ observation: o, reason: UNBOUND.SOURCE_MISMATCH }); continue;
    }
    if (!domains.some((d) => sameSite(d, claimed))) {
      unbound.push({ observation: o, reason: UNBOUND.NOT_IN_PROVENANCE }); continue;
    }

    const urlBound = !!(sourceUrl && urls.has(urlKey(sourceUrl)));
    // CONTENT is asked only of the text for the SAME page the claim names. A
    // domain-level match has no page, so it has no text to be checked against.
    const content = urlBound
      ? contentSupports(o, textByUrl.get(urlKey(sourceUrl)) ?? null)
      : { bound: false, reason: null };
    const level = content.bound ? BINDING.CONTENT : (urlBound ? BINDING.URL : BINDING.DOMAIN);
    bindings[level] += 1;
    levels.push({ level, content_reason: content.bound ? null : content.reason });
    bound.push(o);
  }
  return { bound, unbound, bindings, levels };
}

/**
 * What kind of evidence is this observation?
 *
 * A LABEL, NOT A PERMISSION. Nothing is admitted or refused here — the
 * normalisation and qualification gates decide that, exactly as before. This
 * exists so a reader can see that a new-retail price and a used listing were
 * kept apart, instead of inferring it from a rejection reason.
 */
export function classifyMarketEvidence(observation, { currency, marketCurrency } = {}) {
  if (currency && marketCurrency && currency !== marketCurrency) return MARKET_CLASS.FOREIGN_CONTEXT;
  const kind = String(observation?.listing_kind ?? 'unknown');
  if (kind === 'used_listing') return MARKET_CLASS.USED_LISTING;
  if (kind === 'new_retail') return MARKET_CLASS.NEW_RETAIL;
  if (kind === 'unknown') return MARKET_CLASS.MARKETPLACE_LISTING;
  return MARKET_CLASS.OTHER;
}
