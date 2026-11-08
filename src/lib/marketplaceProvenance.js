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
