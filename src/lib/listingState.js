// ══════════════════════════════════════════════════════════════════════════════
// THE LISTING FORM'S PRICE, AS STATE TRANSITIONS (2026-11-19). Pure functions the provider (AppContext) calls, so every
// transition is tested on its own (tests/listing-consistency.test.mjs). One rule above all: a price the seller typed is
// theirs — no condition change, no price arriving from the scan and no return to the scan replaces it. GetWorth's own
// suggestion fills an empty box, or replaces its own earlier suggestion.
// ══════════════════════════════════════════════════════════════════════════════

/** The seller typed this price (an empty box is nobody's price). */
export const ownPrice = (d) => !!d && d.priceOrigin === 'seller' && d.price !== '' && d.price != null;

/**
 * Sell, from a scan. A return to the same scan's listing keeps what the seller wrote — their own price, a title or
 * description they edited, their phone and area — and refreshes only GetWorth's own suggestions.
 * `scan` = { scanUuid, priced, referenceSeen }; `last` = the seller's latest listing (phone and area), or null.
 */
export function listingOnSell(prev, draft, scan, last = null) {
  const same = !!prev?.scanUuid && prev.scanUuid === scan.scanUuid;
  const keep = same && ownPrice(prev);
  return {
    title: same && prev.title !== prev.draftTitle ? prev.title : draft.title,
    desc: same && prev.desc !== prev.draftDesc ? prev.desc : draft.desc,
    price: keep ? prev.price : draft.price,
    priceOrigin: keep || draft.price === '' ? 'seller' : 'suggestion',
    suggestionSeen: (same && !!prev.suggestionSeen) || draft.price !== '' || !!scan.priced,
    referenceSeen: (same && !!prev.referenceSeen) || !!scan.referenceSeen,
    phone: same ? prev.phone : (last?.contact_phone || ''),
    location: same ? prev.location : (last?.location || ''),
    scanUuid: scan.scanUuid, draftTitle: draft.title, draftDesc: draft.desc,
  };
}

/**
 * A condition was chosen; `suggested` is GetWorth's price for it ('' when it has none). The seller's own price stays; a
 * condition GetWorth has no evidence for empties its own suggestion rather than leave another condition's number.
 */
export function listingOnCondition(prev, suggested) {
  if (ownPrice(prev)) return prev;
  return { ...prev, price: suggested, priceOrigin: suggested === '' ? 'seller' : 'suggestion', suggestionSeen: !!prev.suggestionSeen || suggested !== '' };
}

/** The scan's price arrived while the listing was open: it fills an empty box only. Shown either way. */
export function listingOnScanPrice(prev, price, referenceSeen) {
  if (!prev) return prev;
  const seen = { suggestionSeen: true, referenceSeen: !!prev.referenceSeen || !!referenceSeen };
  return prev.price === '' && prev.priceOrigin === 'seller' && price !== '' ? { ...prev, ...seen, price, priceOrigin: 'suggestion' } : { ...prev, ...seen };
}
