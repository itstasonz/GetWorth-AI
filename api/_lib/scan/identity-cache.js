// THE SAME PHOTOGRAPH, AGAIN (2026-11-15). A scan of the very same photo bytes by the same account, in the same language,
// within a day, is answered with the identity this instance already made for it: no second vision call, no ~5-6 s wait.
// Only a first identification is reused — never a correction or a re-identification — and the quota is charged as for any
// scan. Kept in this instance's memory only: nothing about the photograph is stored anywhere, and a miss costs nothing.
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const entries = new Map();

/** The cache key: account, language and the SHA-256 of every photograph, in order. Never the photograph itself. */
export async function identityCacheKey(userId, lang, images) {
  if (!userId || !Array.isArray(images) || images.length === 0) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}|${lang}|${images.join('|')}`));
  return Buffer.from(digest).toString('hex');
}

/** A remembered identification for this key, or null when there is none or it is older than a day. */
export function recallIdentity(key, now = Date.now()) {
  const hit = key ? entries.get(key) : null;
  if (!hit) return null;
  if (now - hit.at > TTL_MS) { entries.delete(key); return null; }
  return hit.result;
}

/** Remember a successful first identification. The oldest entry goes when the cache is full. */
export function rememberIdentity(key, result, now = Date.now()) {
  if (!key || result?.status !== 'identified' || !result.identity) return;
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
  entries.set(key, { at: now, result: { status: result.status, identity: result.identity, followups: result.followups ?? 0, default_condition: result.default_condition ?? null, model: result.call?.model ?? null } });
}

export function resetIdentityCache() { entries.clear(); }
