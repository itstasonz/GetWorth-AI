// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — THE PROVIDER CONTRACT
//
//   supports(identity, market, evidenceClass)   may this provider help here?
//   search(identity, ctx)                        ONE retrieval; total; never throws
//   normalize(raw, ctx)                          pure; the raw record -> observations
//
// A provider is a place prices come from, not a search query: the same
// provider asked twice is two RETRIEVALS of one provider, and the dedupe
// module counts providers, retrievals and origins separately.
//
// `runProvider` is the only way a provider is executed. It gives the provider
// a deadline and an abort signal, measures it, classifies its failure, and
// returns a report in every case — a provider that throws, hangs or returns
// garbage is a report with a status, never a failed scan.
// ══════════════════════════════════════════════════════════════════════════════

export const PROVIDER_CLASS = Object.freeze({
  LOCAL_USED: 'LOCAL_USED', LOCAL_RETAIL: 'LOCAL_RETAIL',
  INTERNATIONAL_USED: 'INTERNATIONAL_USED', INTERNATIONAL_RETAIL: 'INTERNATIONAL_RETAIL',
  SEARCH_DISCOVERY: 'SEARCH_DISCOVERY', HISTORICAL: 'HISTORICAL_CALIBRATION',
});
export const PROVIDER_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED', EMPTY: 'EMPTY', TIMED_OUT: 'TIMED_OUT', ABORTED: 'ABORTED', FAILED: 'FAILED',
  NOT_CONFIGURED: 'NOT_CONFIGURED', SKIPPED: 'SKIPPED',
});
export const ERROR_CLASS = Object.freeze({
  TIMEOUT: 'timeout', ABORT: 'abort', NETWORK: 'network', HTTP: 'http', AUTH: 'auth', PARSE: 'parse', CONTRACT: 'contract', UNKNOWN: 'unknown',
});
/** The classes that can only ever produce evidence below tier A. */
export const LOWER_TIER_CLASSES = Object.freeze(new Set([
  PROVIDER_CLASS.INTERNATIONAL_USED, PROVIDER_CLASS.INTERNATIONAL_RETAIL, PROVIDER_CLASS.HISTORICAL,
]));

const REQUIRED = ['id', 'classes', 'supports', 'search', 'normalize'];

/** Validate a provider object. Returns it frozen, or throws a contract error. */
export function defineProvider(p) {
  for (const k of REQUIRED) {
    if (p?.[k] === undefined) throw new Error(`[provider] ${p?.id ?? '?'} lacks ${k}`);
  }
  if (!Array.isArray(p.classes) || p.classes.length === 0 || p.classes.some((c) => !Object.values(PROVIDER_CLASS).includes(c))) {
    throw new Error(`[provider] ${p.id} declares no valid class`);
  }
  for (const k of ['supports', 'search', 'normalize']) if (typeof p[k] !== 'function') throw new Error(`[provider] ${p.id}.${k} is not a function`);
  return Object.freeze({
    profile: Object.freeze({ cost_per_call_usd: 0, typical_ms: 1000, max_results: 50, timeout_ms: 4500, ...(p.profile ?? {}) }),
    ...p,
  });
}

/** A failure's class, from what was thrown. */
export function classifyProviderError(err, { timedOut = false, aborted = false } = {}) {
  if (timedOut) return ERROR_CLASS.TIMEOUT;
  if (aborted) return ERROR_CLASS.ABORT;
  const m = String(err?.message ?? err ?? '').toLowerCase();
  if (/timeout|exceeded/.test(m)) return ERROR_CLASS.TIMEOUT;
  if (/abort/.test(m)) return ERROR_CLASS.ABORT;
  if (/401|403|unauthori|credential|token/.test(m)) return ERROR_CLASS.AUTH;
  if (/api \d{3}|http \d{3}|status \d{3}|\b5\d\d\b|\b4\d\d\b/.test(m)) return ERROR_CLASS.HTTP;
  if (/network|fetch failed|econn|enotfound|socket/.test(m)) return ERROR_CLASS.NETWORK;
  if (/json|parse|unexpected token/.test(m)) return ERROR_CLASS.PARSE;
  return ERROR_CLASS.UNKNOWN;
}

/**
 * Run one provider under a deadline.
 *
 * `ctx` carries { market, level, subject, deadlineMs, signal, now, fetchImpl,
 * model, apiKey, profile }. The provider's own `profile.timeout_ms` is capped
 * by `deadlineMs`. Resolves to a report; never rejects.
 */
export async function runProvider(provider, identity, ctx = {}) {
  const now = typeof ctx.now === 'function' ? ctx.now : Date.now;
  const started = now();
  const report = {
    provider: provider.id, profile: ctx.profile ?? null, classes: provider.classes,
    status: PROVIDER_STATUS.SKIPPED, error_class: null, error: null,
    started_at: started, first_result_at: null, completed_at: null, elapsed_ms: 0,
    result_count: 0, normalized_count: 0, billed: false, cost_usd: 0,
    raw: null, observations: [],
  };
  const finish = (status, extra = {}) => {
    report.completed_at = now();
    report.elapsed_ms = report.completed_at - started;
    report.status = status;
    Object.assign(report, extra);
    return report;
  };

  let supported = false;
  try { supported = provider.supports(identity, ctx.market, ctx.evidenceClass ?? null) === true; } catch (err) {
    return finish(PROVIDER_STATUS.FAILED, { error_class: ERROR_CLASS.CONTRACT, error: String(err?.message ?? err).slice(0, 160) });
  }
  if (!supported) return finish(PROVIDER_STATUS.SKIPPED);

  const budget = Math.max(0, Math.min(provider.profile.timeout_ms, ctx.deadlineMs ?? provider.profile.timeout_ms));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, budget);
  const onOuterAbort = () => controller.abort();
  ctx.signal?.addEventListener('abort', onOuterAbort);
  if (ctx.signal?.aborted) controller.abort();

  let result;
  try {
    result = await provider.search(identity, { ...ctx, signal: controller.signal, deadlineMs: budget, onFirstResult: () => { report.first_result_at ??= now(); } });
  } catch (err) {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onOuterAbort);
    const cls = classifyProviderError(err, { timedOut, aborted: controller.signal.aborted });
    return finish(cls === ERROR_CLASS.TIMEOUT ? PROVIDER_STATUS.TIMED_OUT : (cls === ERROR_CLASS.ABORT ? PROVIDER_STATUS.ABORTED : PROVIDER_STATUS.FAILED),
      { error_class: cls, error: String(err?.message ?? err).slice(0, 160) });
  }
  clearTimeout(timer);
  ctx.signal?.removeEventListener('abort', onOuterAbort);

  if (!result || typeof result !== 'object') return finish(PROVIDER_STATUS.FAILED, { error_class: ERROR_CLASS.CONTRACT, error: 'search returned nothing' });
  if (result.status === PROVIDER_STATUS.NOT_CONFIGURED) return finish(PROVIDER_STATUS.NOT_CONFIGURED, { error: result.error ?? null });
  if (timedOut) return finish(PROVIDER_STATUS.TIMED_OUT, { error_class: ERROR_CLASS.TIMEOUT, raw: result.raw ?? null, billed: result.billed === true });
  if (controller.signal.aborted) return finish(PROVIDER_STATUS.ABORTED, { error_class: ERROR_CLASS.ABORT, raw: result.raw ?? null, billed: result.billed === true });
  if (result.status === PROVIDER_STATUS.FAILED) return finish(PROVIDER_STATUS.FAILED, { error_class: result.error_class ?? ERROR_CLASS.UNKNOWN, error: result.error ?? null, raw: result.raw ?? null, billed: result.billed === true });
  if (result.status === PROVIDER_STATUS.SKIPPED) return finish(PROVIDER_STATUS.SKIPPED, { raw: result.raw ?? null });

  let observations = [];
  try { observations = provider.normalize(result.raw, ctx) ?? []; } catch (err) {
    return finish(PROVIDER_STATUS.FAILED, { error_class: ERROR_CLASS.PARSE, error: String(err?.message ?? err).slice(0, 160), raw: result.raw ?? null, billed: result.billed === true });
  }
  const resultCount = Number(result.result_count ?? observations.length) || 0;
  return finish(resultCount === 0 && observations.length === 0 ? PROVIDER_STATUS.EMPTY : PROVIDER_STATUS.COMPLETED, {
    raw: result.raw ?? null, observations, result_count: resultCount, normalized_count: observations.length,
    billed: result.billed === true, cost_usd: Number(result.cost_usd ?? provider.profile.cost_per_call_usd) || 0,
    request_id: result.request_id ?? null, timings: result.timings ?? null,
  });
}
