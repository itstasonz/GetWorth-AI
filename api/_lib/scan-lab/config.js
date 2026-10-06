// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — ACTIVATION, ALLOWLIST, STORAGE AND LIMITS
//
// Scan Lab is the private benchmark capture surface inside the PWA. It has its
// OWN flag and its OWN allowlist: turning Scan Engine V2 on for an account does
// not open Scan Lab for it, and the reverse.
//
// ── THE ALLOWLIST FAILS CLOSED EVERYWHERE ───────────────────────────────────
//
// V2's allowlist admits any signed-in user outside production when it is unset,
// because a scan path has to be testable. Scan Lab holds photographs and human
// ground truth, so an unset list admits NOBODY in any environment. There is no
// request field that turns the lab on or enrols a user.
//
// ── THE SERVICE KEY IS REQUIRED, AND THE ANON KEY IS NOT A SUBSTITUTE ───────
//
// The bucket and the table carry no policy for `anon` or `authenticated`: the
// only door is this server holding the service-role key. A deployment that has
// only the anon key is DISABLED_NO_STORAGE rather than a lab that half works.
// ══════════════════════════════════════════════════════════════════════════════

/** Scan Lab is ON only when this is exactly 'true'. */
export const LAB_FLAG = 'SCAN_LAB_ENABLED';
/** Comma-separated user ids. Required everywhere; empty admits nobody. */
export const LAB_ALLOWLIST_ENV = 'SCAN_LAB_USER_IDS';
export const LAB_SERVICE_KEY_ENV = 'SUPABASE_SERVICE_KEY';
export const LAB_URL_ENVS = Object.freeze(['SUPABASE_URL', 'VITE_SUPABASE_URL']);
const ANON_KEY_ENVS = ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];

/** The private bucket and the table. Named once, here. */
export const LAB_BUCKET = 'scan-lab';
export const LAB_TABLE = 'scan_lab_items';

export const LAB_MODE = Object.freeze({
  ENABLED: 'enabled',
  DISABLED_FLAG: 'disabled_flag',
  DISABLED_NO_STORAGE: 'disabled_no_storage',
});

// ── LIMITS ──────────────────────────────────────────────────────────────────
/** An original as the phone made it. The bucket enforces the same ceiling. */
export const LAB_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
/** The PWA-prepared derivative is 1280 px JPEG: a few hundred KB. */
export const LAB_MAX_PREPARED_BYTES = 4 * 1024 * 1024;
export const LAB_MIN_IMAGE_BYTES = 512;
/** How long a preview link to a stored photograph lives. */
export const LAB_SIGNED_URL_SECONDS = 60;
/** No photograph passes through this function; a request is a few KB of JSON. */
export const LAB_MAX_BODY_BYTES = 64 * 1024;

/** Is this a service-role credential, as far as its own shape can say? */
export function isServiceRoleKey(key, env = process.env) {
  const k = String(key ?? '').trim();
  if (k.length < 20) return false;
  if (ANON_KEY_ENVS.some((name) => env?.[name] && env[name] === k)) return false;
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch { return false; }
}

/** Where the lab stores things, or null when this deployment cannot. */
export function resolveLabStorage(env = process.env) {
  const url = LAB_URL_ENVS.map((name) => String(env?.[name] ?? '').trim()).find(Boolean) ?? '';
  const serviceKey = String(env?.[LAB_SERVICE_KEY_ENV] ?? '').trim();
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url.replace(/\/$/, '')) || !isServiceRoleKey(serviceKey, env)) return null;
  return { url: url.replace(/\/$/, ''), serviceKey };
}

/** May Scan Lab run at all? Reads the environment and nothing else. */
export function resolveLabMode(env = process.env) {
  if (String(env?.[LAB_FLAG] ?? '').trim().toLowerCase() !== 'true') return LAB_MODE.DISABLED_FLAG;
  if (!resolveLabStorage(env)) return LAB_MODE.DISABLED_NO_STORAGE;
  return LAB_MODE.ENABLED;
}

/** May THIS account use Scan Lab? Takes an id and the environment, no request. */
export function isLabPermitted(userId, env = process.env) {
  if (!userId) return false;
  const allowed = String(env?.[LAB_ALLOWLIST_ENV] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(userId));
}
