// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE SIGNED SCAN STATE
//
// A V2 scan is two or three short requests: identify, perhaps identify again
// with a follow-up photograph, then price. What the first request established
// has to reach the later ones, and the only carrier is the client.
//
// A client is not an authority. So the state travels as a token the server
// SIGNED: the identity, the sufficiency decision and the number of follow-ups
// used, bound to the user and the scan that produced them, with an expiry.
// /api/v2/price searches only for an identity this server established and this
// gate approved — a caller cannot hand it a product to research, skip the gate,
// or reuse another user's scan.
//
// SIGNED, NOT ENCRYPTED. The payload is readable by the client that holds it,
// and holds nothing the client was not already sent.
//
// No database is involved. The state is a few hundred bytes of JSON and an
// HMAC, and it is gone when it expires. The HMAC is the platform's own
// `crypto.subtle`, as the JWT verifier in api/analyze.js uses, so this adds no
// dependency; `subtle.verify` compares in constant time.
// ══════════════════════════════════════════════════════════════════════════════
import { V2_STATE_SECRET_ENV, V2_STATE_TTL_MS, MIN_STATE_SECRET_LENGTH } from './config.js';

const VERSION = 1;
const DOMAIN = 'getworth.scan-v2.state.';
const MAX_TOKEN_CHARS = 16_000;

export const STATE_ERROR = Object.freeze({
  MISSING: 'state_missing',
  MALFORMED: 'state_malformed',
  BAD_SIGNATURE: 'state_signature_invalid',
  EXPIRED: 'state_expired',
  WRONG_USER: 'state_belongs_to_another_user',
  WRONG_SCAN: 'state_belongs_to_another_scan',
  NO_SECRET: 'state_secret_not_configured',
});

const encoder = new TextEncoder();
const toB64url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text) => new Uint8Array(Buffer.from(text, 'base64url'));
const B64URL = /^[A-Za-z0-9_-]+$/;

function secretOf(env) {
  const s = String(env?.[V2_STATE_SECRET_ENV] ?? '');
  return s.length >= MIN_STATE_SECRET_LENGTH ? s : null;
}

const hmacKey = (secret, usage) => crypto.subtle.importKey(
  'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

/** Sign a scan state. Rejects when no secret is configured: there is no unsigned mode. */
export async function signScanState({ userId, scanUuid, identity, sufficiency, followupsUsed = 0 }, { env = process.env, now = Date.now() } = {}) {
  const secret = secretOf(env);
  if (!secret) throw new Error(STATE_ERROR.NO_SECRET);
  const payload = toB64url(encoder.encode(JSON.stringify({
    v: VERSION, uid: String(userId), scan: String(scanUuid), iat: now,
    identity, sufficiency, followups_used: followupsUsed,
  })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(DOMAIN + payload));
  return `${payload}.${toB64url(new Uint8Array(signature))}`;
}

/**
 * Verify a state token for this user and scan.
 *
 * Resolves to { ok: true, state } or { ok: false, error }. Never rejects, and
 * never returns a partially-trusted state: a token that fails any check yields
 * nothing.
 */
export async function verifyScanState(token, { userId, scanUuid }, { env = process.env, now = Date.now() } = {}) {
  const fail = (error) => ({ ok: false, error, state: null });
  const secret = secretOf(env);
  if (!secret) return fail(STATE_ERROR.NO_SECRET);
  if (typeof token !== 'string' || !token) return fail(STATE_ERROR.MISSING);
  if (token.length > MAX_TOKEN_CHARS) return fail(STATE_ERROR.MALFORMED);
  const dot = token.indexOf('.');
  if (dot < 1 || dot !== token.lastIndexOf('.')) return fail(STATE_ERROR.MALFORMED);
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!B64URL.test(payload) || !B64URL.test(signature)) return fail(STATE_ERROR.MALFORMED);

  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromB64url(signature), encoder.encode(DOMAIN + payload));
  } catch { valid = false; }
  if (!valid) return fail(STATE_ERROR.BAD_SIGNATURE);

  let state;
  try { state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return fail(STATE_ERROR.MALFORMED); }
  if (!state || state.v !== VERSION || typeof state.iat !== 'number') return fail(STATE_ERROR.MALFORMED);
  if (now - state.iat > V2_STATE_TTL_MS || state.iat - now > 60_000) return fail(STATE_ERROR.EXPIRED);
  if (state.uid !== String(userId)) return fail(STATE_ERROR.WRONG_USER);
  if (state.scan !== String(scanUuid)) return fail(STATE_ERROR.WRONG_SCAN);
  return { ok: true, error: null, state };
}
