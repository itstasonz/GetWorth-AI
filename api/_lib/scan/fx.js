// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — EXCHANGE RATES, FROM THE BANK OF ISRAEL
//
// A used price found abroad is in dollars, euros or pounds. The rate that turns
// it into shekels is the Bank of Israel's published representative rate, read
// from its free public feed and kept for a day per server instance.
//
// The conversion is done by the server, on the price exactly as the page showed
// it. The model never converts, so no figure rests on a rate it remembered.
//
// When the feed cannot be reached there is no rate: foreign prices are then
// shown in their own currency and take no part in the checks. Never a default.
// ══════════════════════════════════════════════════════════════════════════════

const BOI_RATES_URL = 'https://www.boi.org.il/PublicApi/GetExchangeRates';
export const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const FX_TIMEOUT_MS = 2_500;
/** The currencies a second-hand price abroad is realistically quoted in. */
export const FX_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP']);

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** The bank's JSON as { rate_date, rates: { USD: shekels-per-one } }. Total. */
export function parseBoiRates(json) {
  const rates = {};
  let latest = null;
  for (const r of Array.isArray(json?.exchangeRates) ? json.exchangeRates : []) {
    const key = String(r?.key ?? '').toUpperCase();
    const rate = positive(r?.currentExchangeRate);
    const unit = positive(r?.unit) ?? 1;
    if (!/^[A-Z]{3}$/.test(key) || !rate) continue;
    rates[key] = rate / unit;
    const d = r?.lastUpdate ? new Date(r.lastUpdate) : null;
    const iso = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    if (iso && (!latest || iso > latest)) latest = iso;
  }
  return { source: 'bank_of_israel', rate_date: latest, rates };
}

let cached = null; // { table, at }

/**
 * Today's table, or null. Never throws and never fabricates a rate.
 */
export async function getFxTable({ fetchImpl = fetch, now = Date.now, timeoutMs = FX_TIMEOUT_MS } = {}) {
  if (cached && now() - cached.at < FX_CACHE_TTL_MS) return cached.table;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(BOI_RATES_URL, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = parseBoiRates(await res.json());
    if (!FX_CURRENCIES.some((c) => table.rates[c])) throw new Error('no usable rate');
    cached = { table, at: now() };
    return table;
  } catch (err) {
    console.warn(`[Scan] fx unavailable: ${String(err?.message ?? err).slice(0, 80)}`);
    // A table from earlier today is still today's money; older than that is not kept.
    return cached && now() - cached.at < 2 * FX_CACHE_TTL_MS ? cached.table : null;
  } finally { clearTimeout(timer); }
}

/** For the suites. */
export function resetFxCache() { cached = null; }

/** Shekels for an amount in `currency`, or null when there is no rate for it. */
export function toIls(amount, currency, table) {
  const value = positive(amount);
  const code = String(currency ?? '').toUpperCase();
  if (!value) return null;
  if (code === 'ILS' || code === 'NIS') return value;
  const rate = positive(table?.rates?.[code]);
  return rate ? value * rate : null;
}

