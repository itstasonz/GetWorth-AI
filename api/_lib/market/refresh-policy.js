// ══════════════════════════════════════════════════════════════════════════════
// MARKET REFRESH POLICY — HOW LONG EVIDENCE FOR A KIND OF ITEM STAYS CURRENT
//
// Not every product moves at the same speed. These are PROPOSED STARTING
// DEFAULTS (founder brief, 2026-11-13), not measured optima: the market index
// records every observation's sighting dates so the intervals can be tuned
// later from observed price movement, demand and cost. Each interval is bounded
// by the scan's research window (config.js MARKET_POOL_MS): no evidence from a
// source without history permission outlives that window anyway.
//
// The policy decides two things:
//   · how old indexed evidence may be and still price a scan WITHOUT a search
//     (the fast path); older evidence still joins a new search's pool;
//   · when the scheduled refresh (prewarm) researches a demanded product again.
// ══════════════════════════════════════════════════════════════════════════════
import { MARKET_POOL_MS } from '../scan/config.js';

const H = 3_600_000;
export const REFRESH_CLASS = Object.freeze({ FAST: 'fast_moving', HOUSEHOLD: 'household', FURNITURE: 'furniture', COLLECTIBLE: 'collectible', DEFAULT: 'default' });
/** Proposed defaults. FAST: phones, consoles, games; HOUSEHOLD: appliances; FURNITURE: furniture; COLLECTIBLE: until activity is measured. */
export const REFRESH_MS = Object.freeze({
  [REFRESH_CLASS.FAST]: 24 * H,
  [REFRESH_CLASS.HOUSEHOLD]: 72 * H,
  [REFRESH_CLASS.FURNITURE]: 168 * H,
  [REFRESH_CLASS.COLLECTIBLE]: 72 * H,
  [REFRESH_CLASS.DEFAULT]: 24 * H,
});

const FAST_TYPES = /(phone|iphone|smartphone|tablet|ipad|laptop|notebook|macbook|console|playstation|xbox|nintendo|switch|controller|gamepad|headphone|earbud|airpods|smartwatch|watch|camera|lens|gpu|graphics card|drone)/i;
const FAST_CATEGORIES = /^(electronics|phones?|computers?|gaming|video games|cameras?|audio)$/i;

/** The refresh class of an identity, from what it is — never from the evidence found for it. */
export function refreshClassOf(identity) {
  const mc = String(identity?.market_class ?? '');
  if (mc === 'furniture') return REFRESH_CLASS.FURNITURE;
  if (mc === 'household') return REFRESH_CLASS.HOUSEHOLD;
  if (mc === 'collectible' || mc === 'handmade_vintage') return REFRESH_CLASS.COLLECTIBLE;
  const type = `${identity?.item_type ?? ''} ${identity?.product_family ?? ''}`;
  if (FAST_TYPES.test(type) || FAST_CATEGORIES.test(String(identity?.category ?? '').trim())) return REFRESH_CLASS.FAST;
  return REFRESH_CLASS.DEFAULT;
}

/** How long evidence for this identity stays current, never beyond the research window. */
export function refreshMsFor(identity, { poolMs = MARKET_POOL_MS } = {}) {
  return Math.min(REFRESH_MS[refreshClassOf(identity)] ?? REFRESH_MS.default, poolMs);
}

/** Is evidence last seen at `lastSeenMs` due for a refresh at `now`? No evidence is always due. */
export function isDue(identity, lastSeenMs, { now = Date.now(), margin = 0.85 } = {}) {
  if (!Number.isFinite(lastSeenMs)) return true;
  return now - lastSeenMs >= refreshMsFor(identity) * margin;
}
