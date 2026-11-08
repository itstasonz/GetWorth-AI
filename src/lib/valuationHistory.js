// ══════════════════════════════════════════════════════════════════════════════
// THE SCAN HISTORY SHOWS A PRICE ONLY WHERE THE ENGINE CAN STAND BEHIND IT
//
// The history list read `price_mid` from every stored row and showed it as a
// confident price. The database audit of 2026-11-08 found what that meant: 291
// rows priced by the older engine's model estimate (`ai_estimate`), and the five
// core-scan prices from 6–11 October that rested on evidence today's engine
// rejects (list pages tied to no ad, a 2022 sale abroad, a 1.5-year-old ad).
//
// A row's price is shown when it is a core-scan price whose row carries the
// calculation's inputs — reproducible (persist.js reproduceValuation), so made
// by the current rules. Any other priced row shows that it is an older estimate
// and that a new scan gives a current one. No row is changed or deleted.
// ══════════════════════════════════════════════════════════════════════════════

/** The history list's columns: `reproducible` is the stored calculation inputs (null on older rows). */
export const HISTORY_COLUMNS = 'id, ai_name, ai_name_hebrew, ai_category, ai_confidence, price_mid, price_method, user_confirmed, user_correction, created_at, reproducible:ai_raw_response->valuation->inputs';

/** { price } for a current evidence-based price; { older: true } for a stored number the engine does not stand behind; {} for none. */
export function historyPriceOf(v) {
  const mid = Number(v?.price_mid);
  if (!(mid > 0)) return {};
  if (v.price_method === 'core_scan_web' && v.reproducible && typeof v.reproducible === 'object') return { price: mid };
  return { older: true };
}
