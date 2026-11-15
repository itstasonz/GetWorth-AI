// ══════════════════════════════════════════════════════════════════════════════
// MARKETPLACE PRICE PROVENANCE — the client side of migration
// 20261108120000_marketplace_price_provenance.sql
//
//   • The buyer states the final amount paid when completing an order. It is
//     sent as transition_order's p_meta.final_price and recorded as
//     'buyer_confirmed' — the buyer's word, not a verified payment. Left empty,
//     nothing is recorded: the asking price is never assumed.
//   • Admins mark internal/test accounts, whose sales never become evidence.
//
// Both appear only once the database has the migration: the client asks the
// database (a column it may read, an admin function it may call) and shows
// nothing new until then. Deploying this before the migration changes nothing.
// ══════════════════════════════════════════════════════════════════════════════

export const FINAL_PRICE_MAX = 100_000_000;

/**
 * The buyer's typed final price → { value } (a whole number of shekels) | { empty: true } | { error }.
 * The server applies the same rule (transition_order); this only spares a round trip.
 */
export function parseFinalPrice(input) {
  const s = String(input ?? '').replace(/[₪,\s]/g, '');
  if (s === '') return { empty: true };
  if (!/^[0-9]{1,9}$/.test(s)) return { error: 'whole_shekels' };
  const n = Number(s);
  if (n < 1 || n > FINAL_PRICE_MAX) return { error: 'range' };
  return { value: n };
}

/** transition_order's p_meta for a completion: the final price when the buyer gave one, nothing otherwise. */
export function completionMeta(input) {
  const p = parseFinalPrice(input);
  return p.value ? { final_price: p.value } : {};
}

/** Does this database record final prices yet? A party may read its own order's columns; a missing column is an error. */
export async function finalPriceSupported(supabase, orderId) {
  if (!orderId) return false;
  try {
    const { error } = await supabase.from('orders').select('final_price').eq('id', orderId).maybeSingle();
    return !error;
  } catch { return false; }
}

/** Does this database record a listing's price source yet? Checked once per page load; a missing column is an error. */
let provenanceSupport = null;
export async function listingProvenanceSupported(supabase) {
  if (provenanceSupport !== null) return provenanceSupport;
  try {
    const { error } = await supabase.from('listings').select('price_source').limit(1);
    provenanceSupport = !error;
  } catch { provenanceSupport = false; }
  return provenanceSupport;
}

/**
 * WHERE A LISTING PRICE CAME FROM (migration 20261115120000): 'getworth_prefilled' — GetWorth's number left as filled;
 * 'after_suggestion' — the seller typed a price after a GetWorth price was shown (influenced, whatever the amount);
 * 'after_reference' — only an Israeli NEW retail price was shown (migration 20261115140000); 'independent' — no GetWorth
 * price of any kind was shown. The database derives its own answer and keeps the stricter of the two.
 */
export function listingPriceOrigin(listingData) {
  if (listingData?.priceOrigin === 'suggestion') return 'getworth_prefilled';
  if (listingData?.suggestionSeen) return 'after_suggestion';
  return listingData?.referenceSeen ? 'after_reference' : 'independent';
}

/** Does this database record a listing's price origin yet? Checked once per page load; a missing column is an error. */
let originSupport = null;
export async function listingOriginSupported(supabase) {
  if (originSupport !== null) return originSupport;
  try {
    const { error } = await supabase.from('listings').select('price_origin').limit(1);
    originSupport = !error;
  } catch { originSupport = false; }
  return originSupport;
}

/**
 * A party states the final price of a COMPLETED order (record_sale_price, once per side). Both sides equal = mutually
 * reported — still not a verified payment. Resolves to { ok } or { error }.
 */
export async function recordSalePrice(supabase, orderId, input) {
  const p = parseFinalPrice(input);
  if (!p.value) return { error: p.error ?? 'empty' };
  try {
    const { error } = await supabase.rpc('record_sale_price', { p_order_id: orderId, p_price: p.value });
    return error ? { error: error.message } : { ok: true };
  } catch (err) { return { error: err?.message ?? 'failed' }; }
}

/**
 * WHAT A COMPLETED ORDER'S PRICE IS (2026-11-15). Only three things may be said, from what is actually recorded:
 *   • 'listing'     — the listing's asking price: all that is known until both parties state the same final price;
 *   • 'agreed'      — buyer and seller each stated the same final price: the parties' word, not a payment record;
 *   • 'verified'    — an independently verified transaction price: GetWorth has no such source (it processes no
 *                     payments), so this is never produced today.
 * The note never says or implies that GetWorth took or processed a payment.
 */
export function completedPriceLine({ listingPrice, buyer = null, seller = null, role = null, lang = 'en' } = {}) {
  const he = lang === 'he';
  const agreed = Number(buyer) > 0 && Number(buyer) === Number(seller);
  if (agreed) {
    return {
      kind: 'agreed', amount: Number(buyer),
      label: he ? 'מחיר סופי מוסכם' : 'Final agreed price',
      note: he ? 'כפי שדיווחו הקונה והמוכר. התשלום נעשה ישירות ביניהם — GetWorth לא מעבדת תשלומים.'
        : 'As reported by both buyer and seller. Payment was made directly between them — GetWorth does not process payments.',
    };
  }
  return {
    kind: 'listing', amount: Number(listingPrice) || 0,
    label: he ? 'מחיר המודעה' : 'Listing price',
    note: role === 'seller'
      ? (he ? 'המחיר שפרסמת. התשלום נעשה ישירות מול הקונה — GetWorth לא מעבדת תשלומים.' : 'The price you listed. Payment is made directly with the buyer — GetWorth does not process payments.')
      : (he ? 'המחיר שפרסם המוכר. התשלום נעשה ישירות מול המוכר — GetWorth לא מעבדת תשלומים.' : 'The price the seller listed. Payment is made directly with the seller — GetWorth does not process payments.'),
  };
}

/** The ids of accounts marked as test, or null when the database has no such function yet (or the caller is no admin). */
export async function loadTestAccountIds(supabase) {
  try {
    const { data, error } = await supabase.rpc('admin_test_account_ids');
    if (error) return null;
    return new Set((data ?? []).map((row) => (typeof row === 'string' ? row : row?.admin_test_account_ids ?? row?.id)).filter(Boolean));
  } catch { return null; }
}

/** Mark or unmark a test account. Resolves to true when the server recorded it. */
export async function setTestAccount(supabase, userId, isTest) {
  try {
    const { error } = await supabase.rpc('admin_set_test_account', { p_user_id: userId, p_is_test: !!isTest });
    return !error;
  } catch { return false; }
}
