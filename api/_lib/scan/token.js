// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE SIGNED SCAN TOKEN
//
// A scan is two or more requests: the photograph is identified, then the market
// is searched, and a correction or an answer may send it round again. The
// server keeps no session, so what one step established travels to the next in
// a token the client carries and cannot alter.
//
// The token is what makes the price step safe to expose: it can only be reached
// with an identity THIS server produced for THIS account in the last half hour,
// and it counts how many times the scan has gone round, so one scan cannot be
// used as an unmetered search service.
//
// HMAC-SHA256 over a domain-separated payload. There is no unsigned mode.
// ══════════════════════════════════════════════════════════════════════════════
import { resolveTokenSecret, TOKEN_TTL_MS } from './config.js';

const VERSION = 1;
const DOMAIN = 'getworth.core-scan.token.';
const MAX_TOKEN_CHARS = 12_000;
const B64URL = /^[A-Za-z0-9_-]+$/;

export const TOKEN_ERROR = Object.freeze({
  MISSING: 'token_missing',
  MALFORMED: 'token_malformed',
  BAD_SIGNATURE: 'token_signature_invalid',
  EXPIRED: 'token_expired',
  WRONG_USER: 'token_belongs_to_another_user',
  WRONG_SCAN: 'token_belongs_to_another_scan',
  NO_SECRET: 'token_secret_not_configured',
});

const encoder = new TextEncoder();
const toB64url = (bytes) => Buffer.from(bytes).toString('base64url');
const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

/**
 * Sign what a scan has established so far.
 *
 * `started` is when the scan began and never changes across re-signing, so the
 * lifetime of a scan is bounded however many times it goes round.
 */
export async function signScanToken({ userId, scanUuid, identity, counters = {}, started = null }, { env = process.env, now = Date.now() } = {}) {
  const secret = resolveTokenSecret(env);
  if (!secret) throw new Error(TOKEN_ERROR.NO_SECRET);
  const payload = toB64url(encoder.encode(JSON.stringify({
    v: VERSION, uid: String(userId), scan: String(scanUuid), iat: started ?? now, identity,
    revisions: counters.revisions ?? 0, followups: counters.followups ?? 0, identify_ms: counters.identify_ms ?? null,
  })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(DOMAIN + payload));
  return `${payload}.${toB64url(new Uint8Array(signature))}`;
}

/**
 * Verify a token for this user and scan.
 *
 * Resolves to { ok: true, state } or { ok: false, error }. Never rejects, and a
 * token that fails any check yields nothing.
 */
export async function verifyScanToken(token, { userId, scanUuid }, { env = process.env, now = Date.now() } = {}) {
  const fail = (error) => ({ ok: false, error, state: null });
  const secret = resolveTokenSecret(env);
  if (!secret) return fail(TOKEN_ERROR.NO_SECRET);
  if (typeof token !== 'string' || !token) return fail(TOKEN_ERROR.MISSING);
  if (token.length > MAX_TOKEN_CHARS) return fail(TOKEN_ERROR.MALFORMED);
  const dot = token.indexOf('.');
  if (dot < 1 || dot !== token.lastIndexOf('.')) return fail(TOKEN_ERROR.MALFORMED);
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!B64URL.test(payload) || !B64URL.test(signature)) return fail(TOKEN_ERROR.MALFORMED);

  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), new Uint8Array(Buffer.from(signature, 'base64url')), encoder.encode(DOMAIN + payload));
  } catch { valid = false; }
  if (!valid) return fail(TOKEN_ERROR.BAD_SIGNATURE);

  let state;
  try { state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return fail(TOKEN_ERROR.MALFORMED); }
  if (!state || state.v !== VERSION || typeof state.iat !== 'number' || !state.identity) return fail(TOKEN_ERROR.MALFORMED);
  if (now - state.iat > TOKEN_TTL_MS || state.iat - now > 60_000) return fail(TOKEN_ERROR.EXPIRED);
  if (state.uid !== String(userId)) return fail(TOKEN_ERROR.WRONG_USER);
  if (state.scan !== String(scanUuid)) return fail(TOKEN_ERROR.WRONG_SCAN);
  return { ok: true, error: null, state };
}
