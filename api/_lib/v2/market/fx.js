// ══════════════════════════════════════════════════════════════════════════════
// MARKET DATA LAYER — FOREIGN EXCHANGE, FROM THE BANK OF ISRAEL
//
// The approved rate source is the Bank of Israel's published representative
// rate (daily, trading days). A conversion is a PROOF, not an arithmetic
// convenience: it names the source, the rate, both currencies, the rate's date
// and when it was retrieved, and it is the shape api/_lib/market-evidence.js's
// V-FX check re-verifies (original_amount × rate = normalized_amount).
//
// Three refusals, never a silent default:
//   fx_unavailable           no rate table (feed off, failed, or not yet fetched)
//   fx_currency_unsupported  the bank publishes no rate for this currency
//   fx_stale                 the rate's date is older than FX_MAX_AGE_MS
//
// A converted price is reported BESIDE the original, never instead of it, and
// a conversion does not move a listing into this market: locale is decided by
// the host (source-type.js), and the converted number is tier-B context.
//
// No call is made unless the feed is enabled; the feed is a free public JSON
// endpoint, retrieved at most once per FX_CACHE_TTL_MS per server instance.
// ══════════════════════════════════════════════════════════════════════════════

export const FX_SOURCE = 'bank_of_israel';
const BOI_RATES_URL = 'https://www.boi.org.il/PublicApi/GetExchangeRates';
export const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A representative rate older than this is not today's money. */
export const FX_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const FX_TIMEOUT_MS = 2500;
export const FX_ENV = Object.freeze({ ENABLED: 'SCAN_ENGINE_V2_FX_ENABLED' });
export const FX_REFUSAL = Object.freeze({
  UNAVAILABLE: 'fx_unavailable', UNSUPPORTED: 'fx_currency_unsupported', STALE: 'fx_stale', BAD_AMOUNT: 'fx_bad_amount',
});

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * The bank's JSON as a rate table: { source, retrieved_at, rate_date, rates: { USD: { rate, unit, per_unit } } }.
 * `rate` is shekels per `unit` of the currency as published; `per_unit` is per one.
 */
export function parseBoiRates(json, retrievedAt = Date.now()) {
  const rows = Array.isArray(json?.exchangeRates) ? json.exchangeRates : [];
  const rates = {};
  let latest = null;
  for (const r of rows) {
    const key = String(r?.key ?? '').toUpperCase();
    const rate = num(r?.currentExchangeRate);
    const unit = num(r?.unit) ?? 1;
    if (!/^[A-Z]{3}$/.test(key) || !rate) continue;
    const date = r?.lastUpdate ? new Date(r.lastUpdate) : null;
    const rateDate = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    if (rateDate && (!latest || rateDate > latest)) latest = rateDate;
    rates[key] = { rate, unit, per_unit: rate / unit, rate_date: rateDate };
  }
  return { source: FX_SOURCE, retrieved_at: new Date(retrievedAt).toISOString(), rate_date: latest, rates };
}

/** Fetch the bank's table. The only network call in this module; never made unless enabled. */
async function fetchBoiRates({ fetchImpl, timeoutMs = FX_TIMEOUT_MS, now = Date.now }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(BOI_RATES_URL, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`[fx] bank of israel HTTP ${res.status}`);
    return parseBoiRates(await res.json(), now());
  } finally { clearTimeout(timer); }
}

/**
 * The FX source: a cached rate table behind an explicit switch.
 *
 * `rates()` resolves to { status: 'OK', table } or { status: 'NOT_CONFIGURED' |
 * 'FAILED', table: null, error }. It never throws and never fabricates a rate.
 */
export function createFxSource({ enabled = false, fetchImpl = fetch, now = Date.now, ttlMs = FX_CACHE_TTL_MS, seed = null } = {}) {
  let cached = seed ? { table: seed, at: now() } : null;
  return {
    source: FX_SOURCE,
    enabled,
    async rates() {
      if (!enabled) return { status: 'NOT_CONFIGURED', table: cached?.table ?? null, error: null };
      if (cached && now() - cached.at < ttlMs) return { status: 'OK', table: cached.table, error: null, cached: true };
      try {
        const table = await fetchBoiRates({ fetchImpl, now });
        cached = { table, at: now() };
        return { status: 'OK', table, error: null, cached: false };
      } catch (err) {
        return { status: 'FAILED', table: cached?.table ?? null, error: String(err?.message ?? err).slice(0, 120) };
      }
    },
  };
}

/**
 * Convert one amount to shekels with a proof, or refuse with a reason.
 *
 * Returns { ok: true, converted_ils, proof } or { ok: false, reason }. The
 * proof's `normalized_amount` is the exact product `amount × rate`, so the
 * evidence gate's re-check of the arithmetic passes; display rounding is the
 * caller's.
 */
export function convertToIls({ amount, currency }, table, { now = Date.now(), maxAgeMs = FX_MAX_AGE_MS } = {}) {
  const value = num(amount);
  const code = String(currency ?? '').toUpperCase();
  if (!value) return { ok: false, reason: FX_REFUSAL.BAD_AMOUNT };
  if (code === 'ILS') return { ok: true, converted_ils: value, proof: null, identity: true };
  if (!table || !table.rates) return { ok: false, reason: FX_REFUSAL.UNAVAILABLE };
  const row = table.rates[code];
  if (!row) return { ok: false, reason: FX_REFUSAL.UNSUPPORTED };
  const rateDate = row.rate_date ?? table.rate_date;
  const age = rateDate ? now - new Date(rateDate).getTime() : Number.POSITIVE_INFINITY;
  if (!(age <= maxAgeMs)) return { ok: false, reason: FX_REFUSAL.STALE, rate_date: rateDate ?? null };
  const rate = row.per_unit;
  const normalized = value * rate;
  return {
    ok: true,
    converted_ils: normalized,
    proof: {
      original_amount: value, original_currency: code, rate, normalized_amount: normalized, normalized_currency: 'ILS',
      source: FX_SOURCE, base_currency: code, quote_currency: 'ILS', timestamp: rateDate, retrieved_at: table.retrieved_at ?? null,
    },
  };
}

/**
 * Attach a conversion to an observation. The original price and currency
 * stay; `converted` holds the shekel figure and the proof, or the refusal.
 */
export function withConversion(observation, table, opts = {}) {
  if (!observation || !observation.price || !observation.currency) return observation;
  const r = convertToIls({ amount: observation.price, currency: observation.currency }, table, opts);
  return {
    ...observation,
    converted: r.ok
      ? { ils: r.converted_ils, proof: r.proof, identity: r.identity === true }
      : { ils: null, proof: null, refused: r.reason, rate_date: r.rate_date ?? null },
  };
}
