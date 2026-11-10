// ══════════════════════════════════════════════════════════════════════════════
// STABLE AUTH USER — an auth event that does not change who is signed in must not reload the account's data
//
// supabase-js emits TOKEN_REFRESHED / SIGNED_IN (session recovery on focus) / INITIAL_SESSION with a NEW user object
// each time. AppContext keys its loaders on that object, so every such event re-ran loadUserData (listings, saved
// items, conversations, orders) — measured in Production on 2026-11-10 as bursts that overlapped a scan.
//
// The user object is kept when the account and its server-side record are unchanged (same id, same updated_at, same
// email): a real change (sign-in as someone else, USER_UPDATED) still produces a new object and reloads as before.
// ══════════════════════════════════════════════════════════════════════════════

const sameAccount = (a, b) => !!a && !!b && a.id === b.id && a.updated_at === b.updated_at && a.email === b.email;

/** The user object to keep after an auth event: `prev` when nothing about the account changed, otherwise `next`. */
export function nextAuthUser(prev, next) {
  if (!next) return null;
  return sameAccount(prev, next) ? prev : next;
}

/** Should this auth event re-read the account's profile? Not for a token refresh of the same, unchanged account. */
export function profileRefetchNeeded(event, prev, next) {
  if (!next) return false;
  if (event === 'USER_UPDATED') return true;
  return !sameAccount(prev, next);
}
