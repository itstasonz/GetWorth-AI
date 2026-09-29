// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — THE MARKET REPORT
//
// What the market stage found, laid out so a reader can audit it: what the
// model extracted, what bound to a source the search really reached, what each
// gate did with the rest, and the record of the search itself.
//
// NOTHING HERE DECIDES ANYTHING. Binding happened in the research adapter,
// normalisation and qualification happen in their own modules, and this file
// only counts and labels their results. It is separate from pipeline.js so the
// orchestration stays readable, not because it holds a rule.
// ══════════════════════════════════════════════════════════════════════════════
import { MARKET_MECHANISM, normalizeCurrency } from './market-research.js';
import { classifyMarketEvidence, MARKET_CLASS } from './search-provenance.js';

// ── WHAT THE MARKET STAGE CONCLUDED, IN ONE WORD ────────────────────────────
//
// Separate from PHASE_B_STATUS on purpose. That vocabulary describes the whole
// candidate and consumers already switch on it; this one answers the narrower
// question a reader of the market panel actually has — was there a live
// search, and did it find enough — without adding a word to a closed set.
export const MARKET_OUTCOME = Object.freeze({
  VERIFIED_MARKET: 'VERIFIED_MARKET',
  VERIFIED_COMPARABLE: 'VERIFIED_COMPARABLE',
  // A real search ran and the market it found was too thin to price from.
  INSUFFICIENT_MARKET_EVIDENCE: 'INSUFFICIENT_MARKET_EVIDENCE',
  // The research call returned, and the platform recorded no search.
  NO_LIVE_SEARCH: 'NO_LIVE_SEARCH',
  // The research stage did not run, or did not return.
  NOT_RESEARCHED: 'NOT_RESEARCHED',
});

/**
 * The text the provider returned, per result: title and snippet, by URL.
 *
 * What the evidence gate reads to decide whether a localized spelling of a
 * name is in real use. It is the provider's text and never the model's.
 */
export function providerTextOf(research) {
  return (research?.provenance?.results ?? [])
    .map((r) => ({ url: r.url, text: [r.title, r.text].filter(Boolean).join('\n') }))
    .filter((r) => r.text);
}

/**
 * Assemble the market-evidence record.
 *
 * UNBOUND OBSERVATIONS ARE REJECTED, VISIBLY. They sit in `rejected` with their
 * reason so the panel's arithmetic still closes (returned = accepted +
 * rejected + context), and they are absent from `research.observations`, so
 * neither normalisation nor qualification ever saw them.
 */
export function buildMarketReport({
  research = null, normalized, kept = [], dropped = [], query = null, marketRegion,
  identityContext = null,
} = {}) {
  const unbound = research?.unbound ?? [];
  const byClass = Object.fromEntries(Object.values(MARKET_CLASS).map((k) => [k, 0]));
  for (const o of research?.observations ?? []) {
    byClass[classifyMarketEvidence(o, {
      currency: normalizeCurrency(o?.currency), marketCurrency: marketRegion.currency,
    })] += 1;
  }

  return {
    mechanism: research?.mechanism ?? MARKET_MECHANISM.UNAVAILABLE,
    // DERIVED from the platform's record of the call. Never the model's word.
    search_performed: research?.search_performed === true,
    search_required: research?.search_required === true,
    model_claimed_search: research?.model_claimed_search ?? null,
    market: {
      id: marketRegion.id, country: marketRegion.country,
      timezone: marketRegion.timezone, currency: marketRegion.currency,
    },
    // The provider's result text is what content binding was CHECKED against;
    // a reader gets the head of each, not a second copy of the web.
    provenance: research?.provenance
      ? {
        ...research.provenance,
        results: (research.provenance.results ?? []).map((r) => ({
          url: r.url, domain: r.domain, title: r.title,
          text: r.text ? r.text.slice(0, 240) : null, text_chars: r.text ? r.text.length : 0,
        })),
      }
      : { tool: null, sources: [] },
    // One entry per bound observation, in order. Strength, not permission:
    // no evidence gate reads it.
    bindings: research?.bindings ?? null,
    binding_levels: (research?.binding_levels ?? []).map((l, i) => ({
      source: research?.observations?.[i]?.source ?? null,
      title: research?.observations?.[i]?.title ?? null,
      level: l.level,
      content_reason: l.content_reason,
    })),
    query,
    // What was known about the subject when the search was written, and what
    // the results then called it. Both are for a reader and for the next
    // search. Neither is evidence, and neither is read by any gate.
    identity_context: identityContext,
    identity_discovery: research?.identity_discovery ?? null,
    accepted: kept,
    rejected: [...unbound, ...normalized.rejected, ...dropped],
    context_only: normalized.context,
    // New-retail prices, kept for a reader and for nothing else: they were
    // refused as comparables and are never priced from.
    retail_context: normalized.rejected
      .filter((r) => r.observation?.listing_kind === 'new_retail')
      .map((r) => r.observation),
    counts: {
      returned: research?.extracted ?? 0,
      provenance_bound: research?.observations?.length ?? 0,
      unbound: unbound.length,
      accepted: kept.length,
      rejected: unbound.length + normalized.rejected.length + dropped.length,
      context_only: normalized.context.length,
      by_class: byClass,
    },
  };
}

/**
 * Add the outcome and the diagnostic record, once qualification has answered.
 *
 * Every diagnostic is a count, a domain, a query the tool ran, or a class
 * name. No key, no header, no photograph, no user identifier: this object is
 * returned to a caller.
 */
export function concludeMarketReport(report, { research = null, qualification } = {}) {
  const admitted = qualification?.counts?.admitted ?? 0;
  const authority = qualification?.qualified ? MARKET_OUTCOME.VERIFIED_MARKET
    : (qualification?.comparable_qualified ? MARKET_OUTCOME.VERIFIED_COMPARABLE : null);

  report.outcome = !research ? MARKET_OUTCOME.NOT_RESEARCHED
    : !report.search_performed ? MARKET_OUTCOME.NO_LIVE_SEARCH
      : (authority ?? MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);

  const extracted = report.counts.returned;
  const foreign = report.counts.by_class[MARKET_CLASS.FOREIGN_CONTEXT];
  report.diagnostics = {
    WEB_SEARCH_CONFIGURED: research?.search_configured === true,
    WEB_SEARCH_REQUIRED: research?.search_required === true,
    WEB_SEARCH_CALLED: report.search_performed,
    WEB_SEARCH_CALL_COUNT: research?.provenance?.search_call_count ?? 0,
    SEARCH_QUERIES: research?.provenance?.queries ?? [],
    SOURCE_COUNT_RETURNED: research?.provenance?.sources?.length ?? 0,
    SOURCE_DOMAINS: research?.provenance?.source_domains ?? [],
    OBSERVATIONS_EXTRACTED: extracted,
    OBSERVATIONS_PROVENANCE_BOUND: report.counts.provenance_bound,
    OBSERVATIONS_DOMAIN_BOUND: research?.bindings?.domain ?? 0,
    OBSERVATIONS_URL_BOUND: research?.bindings?.url ?? 0,
    OBSERVATIONS_CONTENT_BOUND: research?.bindings?.content ?? 0,
    OBSERVATIONS_ADMITTED: admitted,
    // Everything that is neither admitted nor foreign context, so the three
    // always sum to what was extracted.
    OBSERVATIONS_REJECTED: Math.max(0, extracted - admitted - foreign),
    FOREIGN_CURRENCY_COUNT: foreign,
    FINAL_MARKET_AUTHORITY: authority ?? 'NONE',
    MARKET_OUTCOME: report.outcome,
  };
  return report;
}
