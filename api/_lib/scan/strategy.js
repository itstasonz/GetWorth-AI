// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHAT KIND OF THING, HOW IT IS VALUED, AND WHAT MAKES IT "THE SAME"
//
// Two decisions that follow from what the item IS (identify.js market_class,
// identity_precision, confirmed facts), never from the evidence found:
//
//   STRATEGY   how this kind of item is valued (valuation.js applies it)
//   KEY        which scans share one market research (service.js)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * HOW A KIND OF ITEM IS VALUED.
 *
 *   exact_model      electronics, tools, fashion, fragrance and the like: the
 *                    item's own listings, the new price as a ceiling, the
 *                    condition ladder (the method this engine was built on)
 *   comparable_items furniture, household goods, handmade and vintage things —
 *                    anything identified by description: listings for SIMILAR
 *                    items give a range, always approximate, never confident
 *   specialised      vehicles, luxury watches and jewellery, collectibles:
 *                    markets whose prices turn on year, mileage, reference,
 *                    authentication, grading — methods and data this engine
 *                    does not have. Evidence is verified and SHOWN; no number
 *                    is made from it until a calibrated method exists.
 */
export const STRATEGY = Object.freeze({ EXACT: 'exact_model', COMPARABLE: 'comparable_items', SPECIALISED: 'specialised_market' });
const SPECIALISED_CLASSES = new Set(['vehicle', 'luxury_watch_jewelry', 'collectible']);
const COMPARABLE_CLASSES = new Set(['furniture', 'household', 'handmade_vintage']);
export function strategyFor(identity) {
  const i = identity ?? {};
  if (SPECIALISED_CLASSES.has(i.market_class)) return STRATEGY.SPECIALISED;
  if (i.identity_precision === 'descriptive' || COMPARABLE_CLASSES.has(i.market_class)) return STRATEGY.COMPARABLE;
  return STRATEGY.EXACT;
}

// ── WHAT A CONFIRMED FACT CHANGES ───────────────────────────────────────────
/**
 * THE ATTRIBUTES THAT CHANGE THE SEARCH. A confirmed fact that names WHAT the
 * item is — a car's year, a phone's storage, a trim, an edition — joins the
 * search queries (market.js), so a question about it has to be answered BEFORE
 * the search: its answer decides what is searched for. A fact that describes
 * the unit — mileage, width, whether it works — reaches the research only as
 * context on the item, so it is asked beside the price, never in front of it
 * (identify.js selectQuestion).
 */
export const SEARCHABLE_ATTRIBUTES = /^(year|model year|storage|capacity|generation|trim|edition|model|model number|variant|size|bottle size|volume|engine|reference|followup|detail)$/i;
export const changesSearch = (attribute) => SEARCHABLE_ATTRIBUTES.test(String(attribute ?? ''));

// ── THE MARKET IDENTITY ─────────────────────────────────────────────────────
const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'series', 'model', 'edition']);
const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t && !STOP.has(t));
/** Whether the thing being sold is the whole product or a lesser part of it: what the configuration means for the price. */
const SCOPE = { complete_item: 'complete', bundle: 'complete', unknown: 'complete' };

/**
 * A key for "the same thing on the market".
 *
 * Built from what the item IS — its catalogue name, its capacity, whether it is
 * the whole product, the owner's answer and the facts they confirmed — and from
 * nothing about the photograph: not the image, not the colour, not the
 * language, not the wording of a display name. Two photographs of the same
 * product share one key, and so share one market research; one scan's
 * confirmed facts never read another's.
 */
export function marketKey(identity, answer = null) {
  const i = identity ?? {};
  const name = tokens(i.canonical_name || [i.brand, i.model ?? i.product_family ?? i.item_type, i.variant].filter(Boolean).join(' '));
  const confirmed = (Array.isArray(i.confirmed) ? i.confirmed : []).filter((c) => !c.unsure).map((c) => `${tokens(c.attribute).join('')}=${tokens(c.value).join('')}`).sort();
  return [
    [...new Set(name)].sort().join(' '),
    tokens(i.size_or_capacity).join(''),
    SCOPE[i.configuration] ?? i.configuration ?? 'complete',
    tokens(answer?.text).join(' '),
    confirmed.join(','),
  ].join('|');
}
