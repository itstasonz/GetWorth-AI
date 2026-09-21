// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — MARKET RESEARCH ADAPTER, NORMALISATION AND EVIDENCE QUALITY
//
// §14 asks that the rest of GetWorth never couple to a particular hosted search
// tool. The contract is one function:
//
//   marketResearch.search(query) -> { observations, provenance, mechanism }
//
// Everything above this file sees that shape and nothing else. Swapping the
// OpenAI web tool for a marketplace API, or for a cached corpus, is a change to
// this file alone.
//
// ── THE HARD RULES, AND WHY EACH ONE IS HERE ────────────────────────────────
//
// §15/§17  CURRENCY IS EXPLICIT OR THE OBSERVATION IS EXCLUDED. Not defaulted,
//          not inferred from the search geography. "$500" read as "₪500" is a
//          3.7x error that produces a confident wrong price, and no downstream
//          layer can detect it because the number looks reasonable.
//
// §17      NO MODEL-AUTHORED FX. If a verified conversion mechanism is absent —
//          and in this phase it is — a foreign-currency observation is kept as
//          CONTEXT and excluded from the authoritative distribution. That is
//          the fail-closed direction and §17 states it explicitly.
//
// §16      REJECTED EVIDENCE IS PRESERVED WITH ITS REASON, and never influences
//          the candidate. A filter whose decisions are invisible is a filter
//          nobody can audit — the same argument that made `unknownHosts` an
//          out-of-band record on the Phase-A side.
//
// §13/§40  THE MODEL NEVER CONSTRUCTS A FETCH TARGET. `search()` takes a
//          structured intent; there is no field in MARKET_QUERY_SCHEMA that can
//          carry a URL, and nothing here requests one.
// ══════════════════════════════════════════════════════════════════════════════
import { callStructured } from './openai-client.js';
import { MARKET_EVIDENCE_SCHEMA } from './schemas.js';
import { buildMarketEvidencePrompt } from './prompts.js';
import { STAGE_TIMEOUT_MS, STAGE_MAX_OUTPUT_TOKENS } from './config.js';

export const MARKET_MECHANISM = Object.freeze({
  OPENAI_WEB_SEARCH: 'openai_web_search',
  UNAVAILABLE: 'unavailable',
  MOCK: 'mock',
});

/** ILS unless proven otherwise — and "proven" means the listing said so. */
export const AUTHORITATIVE_CURRENCY = 'ILS';

// A currency we can act on without conversion. Everything else is context.
const CURRENCY_ALIASES = new Map([
  ['ils', 'ILS'], ['nis', 'ILS'], ['shekel', 'ILS'], ['₪', 'ILS'], ['שח', 'ILS'], ['ש"ח', 'ILS'],
  ['usd', 'USD'], ['$', 'USD'], ['eur', 'EUR'], ['€', 'EUR'], ['gbp', 'GBP'], ['£', 'GBP'],
]);

export function normalizeCurrency(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  return CURRENCY_ALIASES.get(s) || (/^[a-z]{3}$/.test(s) ? s.toUpperCase() : null);
}

export const REJECTION = Object.freeze({
  NO_PRICE: 'no_price',
  NO_CURRENCY: 'currency_ambiguous',
  FOREIGN_NO_FX: 'foreign_currency_no_verified_fx',
  NOT_USED: 'not_a_used_listing',
  PARTS_OR_BROKEN: 'parts_or_broken',
  ACCESSORY: 'accessory_not_product',
  WRONG_MATCH: 'match_confidence_below_floor',
  DUPLICATE: 'duplicate_listing',
  OUTLIER: 'implausible_outlier',
});

/** Below this, the listing is not about our product. */
export const MATCH_CONFIDENCE_FLOOR = 0.6;

/**
 * Normalise and filter raw observations.
 *
 * Returns { accepted, rejected, context } — `context` is the foreign-currency
 * evidence §17 permits us to DISPLAY but not to price from.
 *
 * Deliberately total: any shape of input yields three arrays and never throws.
 */
export function normalizeObservations(raw, { matchFloor = MATCH_CONFIDENCE_FLOOR } = {}) {
  const accepted = [];
  const rejected = [];
  const context = [];
  const seen = new Set();

  for (const o of Array.isArray(raw) ? raw : []) {
    const price = typeof o?.observed_price === 'number' && Number.isFinite(o.observed_price) && o.observed_price > 0
      ? o.observed_price : null;
    const currency = normalizeCurrency(o?.currency);
    const kind = String(o?.listing_kind ?? 'unknown');
    const matchConf = typeof o?.match?.confidence === 'number' ? o.match.confidence : 0;

    const obs = {
      source: o?.source ?? null,
      source_domain: o?.source_domain ?? null,
      listing_id_or_reference: o?.listing_id_or_reference ?? null,
      title: o?.title ?? null,
      observed_price: price,
      currency,
      normalized_ils_price: currency === AUTHORITATIVE_CURRENCY ? price : null,
      condition: o?.condition ?? null,
      location: o?.location ?? null,
      observed_at: o?.observed_at ?? null,
      listing_kind: kind,
      match: {
        brand: o?.match?.brand ?? null,
        model: o?.match?.model ?? null,
        variant: o?.match?.variant ?? null,
        confidence: matchConf,
      },
    };

    const reject = (reason) => rejected.push({ observation: obs, reason });

    if (price === null) { reject(REJECTION.NO_PRICE); continue; }
    // §15: currency ambiguity is a rejection, never a default.
    if (!currency) { reject(REJECTION.NO_CURRENCY); continue; }

    if (kind === 'parts_only' || kind === 'broken') { reject(REJECTION.PARTS_OR_BROKEN); continue; }
    if (kind === 'accessory') { reject(REJECTION.ACCESSORY); continue; }
    if (kind === 'new_retail') { reject(REJECTION.NOT_USED); continue; }
    if (matchConf < matchFloor) { reject(REJECTION.WRONG_MATCH); continue; }

    // DEDUPE before currency triage, so a repeated foreign listing does not
    // appear twice in the context bucket either. Identity is the listing
    // reference when there is one, else domain+title+price — which is what
    // makes "same seller, reposted" collapse.
    const key = obs.listing_id_or_reference
      ? `ref:${String(obs.listing_id_or_reference).toLowerCase()}`
      : `t:${String(obs.source_domain ?? '').toLowerCase()}|${String(obs.title ?? '').toLowerCase().slice(0, 80)}|${price}|${currency}`;
    if (seen.has(key)) { reject(REJECTION.DUPLICATE); continue; }
    seen.add(key);

    // §17: no verified FX mechanism exists in this phase, so a foreign price is
    // CONTEXT. It is not rejected — it is real evidence about the world — but it
    // may not enter an ILS calculation, and the distinction is kept in the data
    // rather than in a comment.
    if (currency !== AUTHORITATIVE_CURRENCY) {
      context.push({ observation: obs, reason: REJECTION.FOREIGN_NO_FX });
      continue;
    }

    accepted.push(obs);
  }

  return { accepted, rejected, context };
}

/**
 * Remove implausible outliers from an already-normalised ILS set.
 *
 * MEDIAN ABSOLUTE DEVIATION, not standard deviation: a single ₪95,000 typo in a
 * set of ₪300 listings moves a mean and its standard deviation so far that the
 * typo ends up inside the accepted band. MAD is unmoved by it.
 *
 * Below 4 observations no outlier rejection happens at all — with three points
 * there is no distribution to be an outlier from, and dropping one is as likely
 * to remove the only correct listing as the wrong one.
 */
export function rejectOutliers(observations, { threshold = 3.5, minSample = 4 } = {}) {
  const kept = [...observations];
  if (kept.length < minSample) return { kept, dropped: [] };

  const prices = kept.map((o) => o.normalized_ils_price).sort((a, b) => a - b);
  const median = (arr) => (arr.length % 2
    ? arr[(arr.length - 1) / 2]
    : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  const med = median(prices);
  const deviations = prices.map((p) => Math.abs(p - med)).sort((a, b) => a - b);
  const mad = median(deviations);
  // Every price identical: MAD is 0 and nothing is an outlier.
  if (mad === 0) return { kept, dropped: [] };

  const out = [];
  const survivors = [];
  for (const o of kept) {
    // 0.6745 makes MAD a consistent estimator of sigma for normal data.
    const score = (0.6745 * Math.abs(o.normalized_ils_price - med)) / mad;
    if (score > threshold) out.push({ observation: o, reason: REJECTION.OUTLIER });
    else survivors.push(o);
  }
  return { kept: survivors, dropped: out };
}

/**
 * The adapter. `search(query)` is the whole contract above this file.
 *
 * `mechanism` is recorded on every result so a reader can tell model reasoning
 * from retrieved evidence — §13's "model reasoning only as a fallback, clearly
 * labelled as such" is not a comment, it is a field.
 */
export function createMarketResearch({
  mechanism = MARKET_MECHANISM.UNAVAILABLE,
  model,
  apiKey,
  ledger = null,
  language = 'en',
  fetchImpl = fetch,
  mockSearch = null,
} = {}) {
  return {
    mechanism,
    async search(query) {
      if (mechanism === MARKET_MECHANISM.MOCK) {
        const r = (await mockSearch?.(query)) || { observations: [], search_performed: false };
        return {
          mechanism,
          observations: r.observations ?? [],
          search_performed: r.search_performed ?? false,
          provenance: r.provenance ?? { tool: 'mock', sources: [] },
          notes: r.notes ?? null,
        };
      }

      if (mechanism !== MARKET_MECHANISM.OPENAI_WEB_SEARCH) {
        // No research mechanism configured. This is a real state and it has a
        // name: §22 requires PENDING_MARKET rather than a number the model
        // invented, so we return nothing and say why.
        return {
          mechanism: MARKET_MECHANISM.UNAVAILABLE,
          observations: [],
          search_performed: false,
          provenance: { tool: null, sources: [] },
          notes: 'no market research mechanism configured',
        };
      }

      // The search tool is attached to the call; this module never builds a
      // URL and never fetches one (§13, §40).
      const { data, meta } = await callStructured({
        stage: 'market_research',
        prompt: buildMarketEvidencePrompt({ query, snippets: [], language }),
        schema: MARKET_EVIDENCE_SCHEMA,
        schemaName: 'getworth_market_evidence',
        model,
        apiKey,
        timeoutMs: STAGE_TIMEOUT_MS.market_research,
        maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.market_research,
        reasoningEffort: 'low',
        tools: [{ type: 'web_search' }],
        ledger,
        fetchImpl,
      });

      // Attribution: which sources the tool actually consulted. Kept separate
      // from the model's prose so provenance survives even when the extraction
      // is poor (§14: "every returned market observation must retain source").
      const sources = [];
      for (const item of meta.output || []) {
        if (item?.type !== 'web_search_call') continue;
        for (const a of item?.action?.sources || item?.results || []) {
          const url = typeof a === 'string' ? a : (a?.url ?? null);
          if (url) sources.push(url);
        }
      }

      return {
        mechanism,
        observations: data?.observations ?? [],
        search_performed: data?.search_performed ?? false,
        provenance: { tool: 'web_search', sources: [...new Set(sources)].slice(0, 40) },
        notes: data?.notes ?? null,
      };
    },
  };
}
