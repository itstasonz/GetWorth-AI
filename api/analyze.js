// ═══════════════════════════════════════════════════════════════════════════
// GetWorth V2 Pipeline — Vision + Retrieval + Verification
// + Phase 3: Google Vision fallback (cost-protected)
// ═══════════════════════════════════════════════════════════════════════════
//
// COST PROTECTION (Phase 3):
//   1. Vision only called when Stage 1 identity (brand/model) or category confidence < 60%
//   2. Image hash cache (24h TTL) — same image never costs twice
//   3. Daily hard limit (1500 calls/day) — synced with Google Quota
//   4. Rate limit per IP (5 scans/minute)
//   5. API key restricted to Cloud Vision in Google Console
//
// ═══════════════════════════════════════════════════════════════════════════

// Node.js serverless runtime (not Edge): Edge is wall-capped at 25s and ignores
// maxDuration; Sonnet 4.6 Vision (Stage 1) can exceed the 12s that the Edge wall
// allowed. Node honors maxDuration (up to 60s here), giving Stage 1 real headroom
// without changing the model/prompt/images. The handler already uses Web-standard
// Request/Response + global crypto.subtle/fetch/atob/AbortController, all available
// on Node 20 — no handler I/O rewrite required.
export const config = { maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// MODEL CONFIG — single source of truth for Anthropic model IDs
// ═══════════════════════════════════════════════════════
// MODEL_VISION drives Stage 1 (recognition) and Stage 2 (verify + pricing).
// Was 'claude-sonnet-4-20250514' (Sonnet 4), which is deprecated and now returns
// 404 for this account. 'claude-sonnet-4-6' is the current, active Sonnet — the
// canonical migration target, vision-capable, and a strict capability upgrade
// that preserves/improves scan quality. Use the bare alias (no date suffix).
const MODEL_VISION = 'claude-sonnet-4-6';
const MODEL_OCR    = 'claude-haiku-4-5-20251001'; // serial-label OCR (unchanged)
const MODEL_PRICING = 'claude-haiku-4-5-20251001'; // SCAN-009: PRE v1 rescue pricing — small structured call, latency-optimized

// GW-000: version stamped on every valuation so future pricing engines stay
// historically comparable. Bump when the pricing pipeline changes materially.
const VALUATION_VERSION = 1;

// GW-000: pluggable server-side error sink. Structured log today; full Sentry
// emission is wired in GW-000.5 (guarded by SENTRY_DSN). Never throws.
function reportError(err, context = {}) {
  try {
    console.error('[reportError]', JSON.stringify({ message: err?.message || String(err), ...context }));
    // GW-000.5: if (process.env.SENTRY_DSN) { /* emit to Sentry */ }
  } catch { /* telemetry must never throw */ }
}

// ═══════════════════════════════════════════════════════
// SECURITY HELPERS
// ═══════════════════════════════════════════════════════

// CORS — echo origin back only if it is in the allow-list.
// Set ALLOWED_ORIGIN=https://yourapp.com (comma-separated) in Vercel env vars.
function getCorsHeaders(requestOrigin) {
  const configured = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const devOrigins = process.env.NODE_ENV !== 'production'
    ? ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173']
    : [];
  const allowed = new Set([...configured, ...devOrigins]);
  const headers = {
    // TEMPORARY build marker — confirms the browser hit the Node-runtime preview
    // build (maxDuration 60 / 45s budget / 28s Stage 1 cap). Remove after validation.
    'X-GetWorth-Build': '774e6e9-node-budget',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Vary': 'Origin',
  };
  if (requestOrigin && allowed.has(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

// ── JWT VERIFICATION ──────────────────────────────────────────────────────
//
// Fast path  (SUPABASE_JWT_SECRET configured — server-only env var):
//   HMAC-SHA256 local verify via Web Crypto — zero network, ~1 ms.
//   Expired token  → sentinel { _expired: true }  → 401 SESSION_EXPIRED.
//   Invalid sig    → null  (fail closed, no fallback — forged token stays rejected).
//
// Fallback path (secret absent — local dev / bootstrap):
//   Supabase auth.getUser() with 5 s cap.
//   Slower, but only used until SUPABASE_JWT_SECRET is set in Vercel.
// ──────────────────────────────────────────────────────────────────────────

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

// Module-scoped JWKS cache — shared across warm Edge invocations. Supabase
// projects that use asymmetric JWT signing keys (alg ES256/RS256) publish their
// public keys here; the first request fetches (~50-200ms), the rest are local.
let _jwksCache = { keys: null, exp: 0 };

async function fetchJwks(supabaseUrl) {
  const now = Date.now();
  if (_jwksCache.keys && _jwksCache.exp > now) return _jwksCache.keys;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`JWKS fetch ${res.status}`);
    const data = await res.json();
    _jwksCache = { keys: data.keys || [], exp: now + 10 * 60 * 1000 }; // 10 min TTL
    return _jwksCache.keys;
  } finally {
    clearTimeout(tid);
  }
}

// Verifies a Supabase access token without a network round-trip to auth.getUser().
//   • HS256 tokens → symmetric verify with SUPABASE_JWT_SECRET.
//   • ES256 tokens → asymmetric verify against the project's public JWKS key
//     (JWS uses raw R||S signatures, which is exactly the IEEE-P1363 format
//      Web Crypto's ECDSA verify expects — no DER conversion needed).
async function verifyJWTLocally(token, { secret, supabaseUrl }) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [hB64, pB64, sB64] = parts;

  const header  = JSON.parse(new TextDecoder().decode(b64urlDecode(hB64)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(pB64)));

  // Check expiry before touching crypto (cheap, scheme-independent early exit)
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec) {
    const e = new Error('Token expired');
    e.code = 'TOKEN_EXPIRED';
    throw e;
  }

  const signed = new TextEncoder().encode(`${hB64}.${pB64}`);
  const sig    = b64urlDecode(sB64);

  let ok = false;
  if (header.alg === 'HS256') {
    if (!secret) throw new Error('No HS256 secret configured');
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    ok = await crypto.subtle.verify('HMAC', key, sig, signed);
  } else if (header.alg === 'ES256') {
    if (!supabaseUrl) throw new Error('No Supabase URL for JWKS');
    const jwks = await fetchJwks(supabaseUrl);
    const jwk = jwks.find(k => k.kid === header.kid) || jwks.find(k => k.alg === 'ES256');
    if (!jwk) throw new Error(`No JWKS key for kid=${header.kid}`);
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, signed);
  } else {
    throw new Error(`Unsupported alg: ${header.alg}`);
  }

  if (!ok) throw new Error('Invalid signature');
  if (!payload.sub) throw new Error('Missing sub claim');
  return payload;
}

async function verifyJWT(authHeader) {
  const hasBearer = !!authHeader?.startsWith('Bearer ');
  const token = hasBearer ? authHeader.slice(7).trim() : '';
  // Safe diagnostics — never logs the token or secret value.
  console.log(`[Auth] hasAuthHeader=${hasBearer} tokenPresent=${!!token}`);
  if (!token) return null;

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  const url       = process.env.SUPABASE_URL     || process.env.VITE_SUPABASE_URL;
  const anonKey   = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  // ── Fast path: local verify (HS256 via secret, OR ES256 via cached JWKS) ──
  // Always attempt — ES256 verification needs only the public JWKS, not a secret.
  {
    const t0 = Date.now();
    try {
      const payload = await verifyJWTLocally(token, { secret: jwtSecret, supabaseUrl: url });
      console.log(`[Auth] local-verify OK ${Date.now() - t0}ms method=local sub=${payload.sub}`);
      return { id: payload.sub, email: payload.email, role: payload.role, _authMethod: 'local' };
    } catch (err) {
      // Expired is definitive — Supabase would reject it too. Short-circuit.
      if (err.code === 'TOKEN_EXPIRED') {
        console.warn(`[Auth] local-verify EXPIRED ${Date.now() - t0}ms`);
        return { _expired: true };
      }
      // Local verify could NOT confirm the token (e.g. JWKS fetch hiccup or a
      // signing scheme we don't handle). Do NOT fail closed — fall through to
      // the authoritative network check below. A forged token still fails there.
      console.warn(`[Auth] local-verify could not confirm (${err.message}) — falling back to network`);
    }
  }

  // ── Network verify: Supabase auth.getUser() (authoritative, any signing scheme) ──
  if (!url || !anonKey) {
    console.error('[Auth] network verify unavailable — SUPABASE_URL/ANON_KEY missing');
    return null;
  }
  const t0 = Date.now();
  console.log('[Auth] network verify auth.getUser start');
  try {
    const client = createClient(url, anonKey);
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) {
      console.warn(`[Auth] network verify FAILED ${Date.now() - t0}ms: ${error?.message}`);
      return null;
    }
    console.log(`[Auth] network verify OK ${Date.now() - t0}ms method=network sub=${user.id}`);
    return { ...user, _authMethod: 'network' };
  } catch (err) {
    console.warn(`[Auth] network verify exception ${Date.now() - t0}ms: ${err.message}`);
    return null;
  }
}

// Image validation — magic-byte check + 5 MB cap.
// Client strips the data URI prefix before sending (raw base64 only).
const IMAGE_MAX_DECODED_BYTES = 5 * 1024 * 1024;

function validateImages(imageList) {
  if (!Array.isArray(imageList) || imageList.length === 0) return 'No image data provided';
  if (imageList.length > 5) return 'Too many images (max 5)';

  for (let i = 0; i < imageList.length; i++) {
    const img = imageList[i];
    if (typeof img !== 'string' || img.length < 24) return `Image ${i + 1} is invalid or empty`;

    // Strip data URI prefix if it slipped through
    const base64 = img.includes(',') ? img.split(',')[1] : img;

    // Approximate decoded size: base64_length * 0.75 ≈ bytes
    if (base64.length * 0.75 > IMAGE_MAX_DECODED_BYTES) {
      return `Image ${i + 1} exceeds the 5 MB size limit`;
    }

    // Magic byte check — first 24 base64 chars decode to 18 bytes
    try {
      const h = atob(base64.slice(0, 24));
      const b = [...h].map(c => c.charCodeAt(0));
      const isJpeg = b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
      const isPng  = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
      const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
                  && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
      // HEIC: 'ftyp' box starts at byte offset 4
      const isHeic = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
      if (!isJpeg && !isPng && !isWebp && !isHeic) {
        return `Image ${i + 1} is not a supported format (jpeg, png, webp, or heic)`;
      }
    } catch {
      return `Image ${i + 1} contains invalid base64 data`;
    }
  }
  return null; // null = all images valid
}

// ═══════════════════════════════════════════════════════
// TIMEOUT HELPER
// ═══════════════════════════════════════════════════════

// Races a promise against a hard deadline.
// On timeout: rejects with a labelled Error so callers can distinguish
// a real failure from a budget overrun and decide whether to skip gracefully.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`[Timeout] ${label} exceeded ${ms}ms`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); }
    );
  });
}

// ═══════════════════════════════════════════════════════
// PHASE 3: COST PROTECTION CONSTANTS
// ═══════════════════════════════════════════════════════
const VISION_DAILY_LIMIT = 1500;             // Hard cap per day across all users
const VISION_RATE_PER_MIN = 5;               // Per-IP scan rate limit
const VISION_CACHE_TTL_HOURS = 24;           // Re-use Vision result for same image
const VISION_TRIGGER_THRESHOLD = 0.60;       // Vision fires when Stage 1 identity (brand/model) or category confidence is below this

const USER_RATE_PER_MIN = 5;                 // Per-user per-minute scan limit
const USER_DAILY_LIMIT   = 50;               // Per-user daily scan quota (beta)

// ═══════════════════════════════════════════════════════
// AUTHENTICITY — high-risk brands / categories
// ═══════════════════════════════════════════════════════
const AUTHENTICITY_HIGH_RISK_BRANDS = /\b(rolex|omega|cartier|audemars piguet|ap royal oak|patek philippe|richard mille|jaeger|iwc|breitling|tag heuer|hublot|chanel|louis vuitton|lv|gucci|prada|hermes|herm[eè]s|dior|versace|burberry|balenciaga|off-white|supreme|yeezy|bape|comme des gar[cç]ons|cdg|givenchy|bottega veneta|celine|saint laurent|ysl|goyard|rimowa|tiffany|van cleef|bulgari|chopard|a. lange|lange|montblanc|tudor|zenith|girard-perregaux|jordan|travis scott|fragment|nike sb|nike dunk|adidas yeezy|air jordan|limited edition collab)\b/i;
const AUTHENTICITY_HIGH_RISK_CATEGORIES = new Set(['watches', 'jewelry', 'bags', 'handbags', 'perfumes', 'collectibles', 'sneakers', 'clothing', 'accessories']);

// ═══════════════════════════════════════════════════════
// RETRY HELPER
// ═══════════════════════════════════════════════════════

// maxRetries reduced from 3 → 1: with no per-attempt timeout guard, 3 retries
// meant Claude hangs could consume 3 × (hang time) before falling back.
// Each attempt gets its own AbortController capped at attemptTimeoutMs so a
// stalled upstream never blocks the full pipeline budget.
async function fetchWithRetry(url, options, maxRetries = 1, attemptTimeoutMs = 12000) {
  const delays = [1000, 2500, 5000];
  let lastResponse, lastError, lastWasAbort = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      console.log(`[Pipeline] Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }

    const attemptCtrl = new AbortController();
    const timeoutId = setTimeout(() => attemptCtrl.abort(), attemptTimeoutMs);

    try {
      lastResponse = await fetch(url, { ...options, signal: attemptCtrl.signal });
      clearTimeout(timeoutId);
      if (lastResponse.ok) return lastResponse;
      if ([529, 500, 502, 503].includes(lastResponse.status)) {
        lastWasAbort = false;
        lastError = await lastResponse.json().catch(() => ({}));
        console.warn(`[Pipeline] Attempt ${attempt + 1} got ${lastResponse.status}:`, lastError.error?.message || '');
        if (attempt < maxRetries) continue;
      } else {
        return lastResponse;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = { error: { message: err.message } };
      lastWasAbort = err.name === 'AbortError';
      const tag = lastWasAbort ? 'timed out' : 'network error';
      console.warn(`[Pipeline] Attempt ${attempt + 1} ${tag}:`, err.message);
      if (attempt < maxRetries) continue;
    }
  }
  console.error('[Pipeline] All retries exhausted:', lastError);
  // X-Upstream-Failure lets callers log WHY the synthetic 503 was produced
  // (per-attempt AbortController timeout vs real upstream 5xx). Diagnostic only —
  // body and status are unchanged and no caller branches on this header.
  return new Response(JSON.stringify({
    error: 'Service temporarily overloaded. Please try again.',
    retryable: true,
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'X-Upstream-Failure': lastWasAbort ? 'attempt-timeout' : 'upstream-error',
    },
  });
}

// ═══════════════════════════════════════════════════════
// §1  JSON SCHEMAS
// ═══════════════════════════════════════════════════════

export const RECOGNITION_SCHEMA = {
  $id: 'RecognitionOutput',
  type: 'object',
  required: ['category', 'category_confidence', 'brand_candidates', 'model_candidates', 'ocr_text', 'visual_features'],
  properties: {
    category:            { type: 'string' },
    category_hebrew:     { type: 'string' },
    category_confidence: { type: 'number', minimum: 0, maximum: 1 },
    subcategory:         { type: 'string' },
    brand_candidates: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        required: ['brand', 'confidence', 'evidence'],
        properties: {
          brand:      { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence:   { type: 'string' },
        },
      },
    },
    model_candidates: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object',
        required: ['model', 'confidence'],
        properties: {
          model:      { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence:   { type: 'string' },
        },
      },
    },
    ocr_text: {
      type: 'object',
      required: ['raw_texts', 'has_readable_text'],
      properties: {
        raw_texts:         { type: 'array', items: { type: 'string' } },
        logos_detected:    { type: 'array', items: { type: 'string' } },
        labels_detected:   { type: 'array', items: { type: 'string' } },
        serial_numbers:    { type: 'array', items: { type: 'string' } },
        has_readable_text: { type: 'boolean' },
      },
    },
    visual_features: {
      type: 'object',
      required: ['materials', 'colors', 'condition'],
      properties: {
        materials:            { type: 'array', items: { type: 'string' } },
        colors:               { type: 'array', items: { type: 'string' } },
        finish:               { type: 'string' },
        shape:                { type: 'string' },
        distinctive_elements: { type: 'array', items: { type: 'string' } },
        wear_level:           { type: 'string' },
        condition:            { type: 'string', enum: ['New', 'Like New', 'Good', 'Fair', 'Poor'] },
        size_estimate:        { type: 'string' },
      },
    },
    embedding_text: { type: 'string' },
    needs_more_info: { type: 'boolean' },
    suggested_followup: { type: ['string', 'null'] },
  },
};

export const VERIFICATION_SCHEMA = {
  $id: 'VerificationOutput',
  type: 'object',
  required: ['final_category', 'final_brand', 'final_model', 'match_confidence', 'price_estimate_low', 'price_estimate_mid', 'price_estimate_high', 'price_method'],
  properties: {
    final_category:        { type: 'string' },
    final_category_hebrew: { type: 'string' },
    final_brand:           { type: 'string' },
    final_model:           { type: 'string' },
    full_name:             { type: 'string' },
    full_name_hebrew:      { type: 'string' },
    match_confidence:      { type: 'number', minimum: 0, maximum: 1 },
    confidence_reasoning:  { type: 'string' },
    matched_product_ids:   { type: 'array', items: { type: 'string' } },
    identification_method: { type: 'string', enum: ['ocr_confirmed', 'visual_match', 'packaging_recognized', 'db_match', 'generic_only'] },
    brand_confidence:      { type: 'string', enum: ['confirmed_by_text', 'inferred_from_visuals', 'packaging_recognized', 'db_matched', 'unidentified'] },
    price_estimate_low:    { type: 'number' },
    price_estimate_mid:    { type: 'number' },
    price_estimate_high:   { type: 'number' },
    new_retail_price_ils:  { type: 'number' },
    price_method:          { type: 'string', enum: ['comp_based', 'ai_estimate'] },
    currency:              { type: 'string', const: 'ILS' },
    condition:             { type: 'string' },
    is_sellable:           { type: 'boolean' },
    market_demand:         { type: 'string', enum: ['high', 'moderate', 'low'] },
    selling_tips:          { type: 'string' },
    israeli_market_notes:  { type: 'string' },
    price_factors:         { type: 'array', items: { type: 'object' } },
    // GW-004: comparable_items removed — AI-fabricated comps are never generated or surfaced.
  },
};


// ═══════════════════════════════════════════════════════
// §2  PROMPTS
// ═══════════════════════════════════════════════════════

function buildRecognitionPrompt(language = 'he') {
  return `You are an image understanding model that extracts visual attributes with forensic precision.
You are part of a product identification pipeline for an Israeli marketplace app.

TASK: Extract ALL identifying information from this image. Do NOT guess — report only what you can see.

EXTRACTION STEPS (follow in order):

0. PACKAGING / BOX DETECTION — Check FIRST before anything else:
   - Is this a RETAIL BOX, product packaging, or marketing photo on a box?
   - Key indicators: clean studio-quality product render, cardboard/glossy box edges visible, retail shelf-ready appearance
   - If YES → identify the PRODUCT INSIDE the box, not "a box"
   - Common packaging you MUST recognize: Apple boxes, Samsung Galaxy, Sony PlayStation, Nintendo Switch, Dyson
   - For packaging: set brand_confidence evidence to "packaging_design" and confidence 0.60-0.80
   - Even partial/corner views of iconic packaging are enough
   - suggested_followup: "Photograph the back of the box or the label for exact model confirmation"

1. OCR SCAN — Read every piece of visible text:
   - Brand names, model numbers, serial numbers, Hebrew text, packaging text
   - Report EXACT text as-is

2. VISUAL ATTRIBUTES — Materials, colors, shape, distinctive elements, wear level

3. BRAND CANDIDATES — List possible brands (max 5) with confidence + evidence

4. MODEL CANDIDATES — List possible models (max 5) with confidence + evidence

   DISAMBIGUATION RULES (apply when multiple similar models exist in a family):
   - Gaming mice (Logitech G-series, Razer, SteelSeries, etc.): G502/G500/G900/G903/G502X/G305/G603/G703 are nearly indistinguishable by shape alone. SHAPE-ONLY photo (no visible text on label/sticker) → list ALL plausible models at max 0.50 each. LABEL/STICKER EXCEPTION: If you directly read a model string from a label or sticker via OCR (e.g. "G900" is printed on a sticker), that is text-confirmed — assign that model ≥0.85 confidence. Text evidence always overrides shape ambiguity. Label photos are NOT subject to the 0.50 cap.
   - Smartphones: iPhone 13/14/15 rear panels look near-identical. Count rear camera lenses and note ring thickness + color as clues. Without visible text/logo, cap each model at 0.55.
   - Gaming controllers: PS4 DualShock vs PS5 DualSense differ in touchpad width and share-button position. Xbox One vs Series X controllers differ mainly in Share/Menu button layout.
   - Laptops/MacBooks: Notch presence (2021+), port count, and trackpad size visible from above. Cap at 0.60 without visible text.
   - Headphones: WH-1000XM3/XM4/XM5, QC35/QC45/QC35II look very similar. Ear-cup shape and headband stitching are key. Cap at 0.55 without brand text.
   - HARD RULE: NEVER assign >0.70 model confidence from silhouette/shape alone. Text or logo OCR confirmation is required to reach ≥0.75.

5. CATEGORY — Classify (Electronics, Furniture, Vehicles, Watches, Clothing, Sports, Smoking, Home, Beauty, Books, Toys, Tools, Food, Other)

6. CONDITION — New, Like New, Good, Fair, Poor

7. EMBEDDING TEXT — Single string for vector search

CONFIDENCE RULES:
- 0.90-1.00: Brand AND model text clearly readable
- 0.75-0.89: Brand text readable OR logo confirmed
- 0.65-0.79: Iconic packaging recognized
- 0.50-0.64: Visual match only, no text
- 0.30-0.49: Generic category, no brand clues
- 0.10-0.29: Uncertain even about category
- NEVER fabricate brand text

Language: ${language === 'he' ? 'Include Hebrew names where relevant' : 'English only'}

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "category": "string",
  "category_hebrew": "string",
  "category_confidence": 0.85,
  "subcategory": "string",
  "brand_candidates": [{"brand":"string","confidence":0.82,"evidence":"readable_text"}],
  "model_candidates": [{"model":"string","confidence":0.65,"evidence":"string"}],
  "ocr_text": {
    "raw_texts": ["exact text found"],
    "logos_detected": ["logo description"],
    "labels_detected": ["label text"],
    "serial_numbers": [],
    "has_readable_text": true
  },
  "visual_features": {
    "materials": ["stainless steel"],
    "colors": ["silver"],
    "finish": "brushed",
    "shape": "cylindrical",
    "distinctive_elements": ["ornate engravings"],
    "wear_level": "minimal",
    "condition": "Good",
    "size_estimate": "60cm tall"
  },
  "embedding_text": "brand model category features...",
  "needs_more_info": false,
  "suggested_followup": null
}`;
}


function buildVerificationPrompt(recognition, candidates, corrections, language = 'he', visionData = null) {
  const isHe = language === 'he';

  const candidateBlock = candidates.length > 0
    ? `\nMATCHED PRODUCTS FROM DATABASE (${candidates.length} results):
${candidates.map((c, i) => `${i + 1}. [ID:${c.id}] ${c.brand} ${c.model || ''} — Category: ${c.category}
     Retail: ₪${c.retail_price_ils ?? '?'} | Used avg: ₪${c.avg_used_price_ils ?? '?'} | Range: ₪${c.price_low_ils ?? '?'}-${c.price_high_ils ?? '?'}
     Similarity: ${(c.similarity * 100).toFixed(1)}% | Scans: ${c.popularity_score || 0}
     Aliases: ${(c.aliases || []).join(', ') || 'none'}
     Keywords: ${(c.keywords || []).join(', ') || 'none'}`).join('\n')}`
    : '\nNo matching products found in database. Use your own knowledge of Israeli market prices.';

  const correctionBlock = corrections.length > 0
    ? `\nPAST USER CORRECTIONS (learn from these):
${corrections.map(c => `- AI said "${c.original}" → user corrected to "${c.corrected}" (happened ${c.count}x)`).join('\n')}`
    : '';

  // User correction — mandatory identity override when present
  const userCorrectionBlock = recognition._user_correction
    ? `\nUSER CORRECTION — MANDATORY OVERRIDE (HIGHEST PRIORITY):
The user has explicitly identified this product as: "${recognition._user_correction}"
- You MUST set final_brand and final_model to match this identity exactly.
- This overrides Stage 1 vision, OCR, and DB candidates.
- Use your knowledge of this product for Israeli used-goods market pricing.
- Set identification_method = "user_correction".`
    : '';

  // Phase 3: Google Vision findings as a 3rd opinion
  const visionBlock = visionData
    ? `\nGOOGLE VISION ANALYSIS (independent second opinion — use to confirm/reject Stage 1):
- Labels: ${(visionData.labels || []).slice(0, 8).map(l => `${l.description} (${Math.round(l.score * 100)}%)`).join(', ') || 'none'}
- Text/OCR: ${(visionData.text || []).slice(0, 5).join(' | ') || 'none'}
- Logos detected: ${(visionData.logos || []).map(l => `${l.description} (${Math.round((l.score || 0) * 100)}%)`).join(', ') || 'none'}
- Web entities (similar items found online): ${(visionData.webEntities || []).slice(0, 5).join(', ') || 'none'}

VISION USAGE RULES:
- If Vision logo detection confirms Stage 1 brand → boost confidence
- If Vision OCR contains a model number that matches Stage 1 → very strong signal, identification_method = "ocr_confirmed"
- If Vision strongly disagrees with Stage 1 brand → trust Vision (it's more focused on text/logo)
- If both agree on a model number that's in the database → highest possible confidence`
    : '';

  return `You are a product verification and Israeli market pricing expert.
You are the second stage of a pipeline. Stage 1 extracted visual attributes. Your job is to:
1) Verify the identity using Stage 1 data + database matches${visionData ? ' + Google Vision findings' : ''}
2) Price the item for the Israeli used-goods market

RECOGNITION DATA FROM STAGE 1:
- Category: ${recognition.category} (${Math.round(recognition.category_confidence * 100)}% confident)
- Top brand: ${recognition.brand_candidates?.[0]?.brand || 'unidentified'} (${Math.round((recognition.brand_candidates?.[0]?.confidence || 0) * 100)}%, evidence: ${recognition.brand_candidates?.[0]?.evidence || 'none'})
- Model candidates: ${recognition.model_candidates?.length > 0
    ? recognition.model_candidates.map((m, i) =>
        `${i === 0 ? '[top]' : `[#${i + 1}]`} ${m.model} (${Math.round(m.confidence * 100)}%${m.evidence ? ', evidence: ' + m.evidence : ''})`
      ).join(' | ')
    : 'unidentified'}
- OCR text: ${recognition.ocr_text?.raw_texts?.join(', ') || 'none'}
- Logos: ${recognition.ocr_text?.logos_detected?.join(', ') || 'none'}
- Brand evidence: ${recognition.brand_candidates?.[0]?.evidence || 'none'}${recognition.brand_candidates?.[0]?.evidence?.includes('packaging') ? ' (RETAIL PACKAGING DETECTED — identify the product inside the box)' : ''}
- Condition: ${recognition.visual_features?.condition || 'unknown'}
- Materials: ${recognition.visual_features?.materials?.join(', ') || 'unknown'}
- Colors: ${recognition.visual_features?.colors?.join(', ') || 'unknown'}
${candidateBlock}
${visionBlock}
${correctionBlock}
${userCorrectionBlock}

VERIFICATION RULES:
- If a DB candidate matches with >70% similarity AND brand/model aligns with Stage 1 → use its pricing → price_method = "comp_based"
- If DB candidates exist but weak match → use as loose anchor, widen range → price_method = "ai_estimate"
- If no DB match → pure AI estimate → flag clearly → price_method = "ai_estimate"
- If Stage 1 and DB disagree on brand → prefer OCR text evidence over everything
- If brand evidence is "packaging_design" or "packaging_visual" → identify the product inside the box, set identification_method = "packaging_recognized"
- NEVER exceed 95% final confidence
- NEVER fabricate a brand that wasn't found in OCR or DB

AUTHENTICITY FORENSICS (required for watches, designer bags, sneakers, jewelry, perfumes, collectibles, high-value electronics):
Apply to: Rolex, Omega, Cartier, Patek Philippe, Audemars Piguet, IWC, Breitling, Tag Heuer, Hublot, Tudor, Chanel, Louis Vuitton, Gucci, Prada, Hermès, Dior, Balenciaga, Off-White, Supreme, Yeezy, Air Jordan, and similar luxury/limited brands.
DEFAULT status is "unknown" for ALL high-risk items — never assume authentic without clear evidence.

Answer these questions in authenticity_assessment:
1. visual_signals — What specific details in the image support OR undermine authenticity? Be precise: "Dial text spacing consistent with authentic Submariner" or "Logo proportions cannot be verified at this resolution". List up to 5 short observations.
2. missing_evidence — What photos/information are missing for proper verification? e.g. "Caseback photo", "Serial/reference number", "Clasp engraving", "Box & papers", "Dial macro photo".
3. signal_conflict — Are there contradictions? has_conflict: true if: brand identified as luxury name but no brand OCR text confirmed; claimed model doesn't match visible details; high-end brand but materials/finishing quality appears inconsistent; category details contradict claimed price point.
4. replica_tier — Classify: "none" (not replica-risk), "unknown" (insufficient evidence), "low_quality_fake" (obvious markers: wrong font/proportions/materials), "mid_replica" (some details off, not definitive), "high_end_replica" (visually accurate but zero verifiable proof).
5. evidence_score — Integer 0–100. Start at 0, add only what you can directly observe:
   +15 brand/logo clearly visible in correct position and style
   +20 OCR confirms model/reference/caliber matching known authentic
   +20 serial/reference number visible and format-correct for claimed brand
   +20 category-specific detail present (dial macro, caseback, clasp)
   +15 box/papers/documentation visible
   +10 zero contradiction between visual and claimed identity
   Do NOT give credit for what you assume. Do NOT exceed 85 for single-photo luxury items.

STATUS RULES:
- "unknown" — default for all high-risk items with insufficient evidence
- "likely_original" — requires at least 3 consistent authentic details confirmed visually (NOT logo alone)
- "possible_replica" — some suspicious elements but not conclusive
- "suspected_fake" — clear counterfeit markers: wrong font/spacing, misaligned logo, obviously wrong proportions, cheap materials
- For Rolex/Omega/Cartier/Patek/AP: ALWAYS "unknown" unless both serial+caseback are clearly visible and format-correct

WORDING RULES: NEVER write "This is authentic", "Guaranteed original", "Verified [brand]". Use: "Authenticity not verified", "Requires expert inspection", "Looks like [brand]-style item".

ISRAELI MARKET PRICING RULES:
- All prices in Israeli New Shekel (₪)
- Electronics typically 20-40% more than US retail
- Used items: 40-70% of new Israeli retail depending on condition
- Price sources: KSP, Zap, Yad2, Facebook Marketplace IL
- If brand unidentified: WIDE range (±50% from mid)
- If brand confirmed by text: NARROW range (±20% from mid)

Respond ONLY with valid JSON:
{
  "final_category": "string",
  "final_category_hebrew": "string",
  "final_brand": "string or 'unidentified'",
  "final_model": "string or 'unidentified'",
  "full_name": "Brand Model Name",
  "full_name_hebrew": "${isHe ? 'שם מלא' : ''}",
  "match_confidence": 0.78,
  "confidence_reasoning": "explanation",
  "matched_product_ids": ["uuid-if-matched"],
  "identification_method": "ocr_confirmed|visual_match|db_match|generic_only",
  "brand_confidence": "confirmed_by_text|inferred_from_visuals|db_matched|unidentified",
  "price_estimate_low": 200,
  "price_estimate_mid": 350,
  "price_estimate_high": 500,
  "new_retail_price_ils": 700,
  "price_method": "comp_based|ai_estimate",
  "currency": "ILS",
  "condition": "Good",
  "is_sellable": true,
  "market_demand": "moderate",
  "selling_tips": "${isHe ? 'טיפ' : 'tip'}",
  "israeli_market_notes": "notes",
  "price_factors": [{"factor":"condition","impact":"-₪100"}],
  "authenticity_assessment": {
    "status": "not_required|unknown|likely_original|possible_replica|suspected_fake",
    "confidence": 0.0,
    "evidence_score": 0,
    "replica_tier": "none|unknown|low_quality_fake|mid_replica|high_end_replica",
    "visual_signals": ["specific observation about what you can/cannot see"],
    "missing_evidence": ["Caseback photo", "Serial/reference number"],
    "signal_conflict": {
      "has_conflict": false,
      "reasons": ["e.g. brand identified but no brand OCR text confirmed"]
    },
    "red_flags": ["e.g. dial font spacing irregular"],
    "green_flags": ["e.g. case finishing consistent with authentic"]
  }
}`;
}


// ═══════════════════════════════════════════════════════
// §3  STAGE 1 — RECOGNITION (Claude Vision)
// ═══════════════════════════════════════════════════════

async function recognize(images, language, apiKey, attemptTimeoutMs = 12000) {
  const prompt = buildRecognitionPrompt(language);

  const content = [
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: img },
    })),
    {
      type: 'text',
      text: images.length > 1
        ? `${prompt}\n\n[${images.length} images provided. Cross-reference ALL images for text/brand/model identification.]`
        : prompt,
    },
  ];

  // Stage 1 is already guarded by the caller's withTimeout(stage1Cap). Align the
  // inner fetch abort just under that cap (single source of truth = budget clock)
  // and disable the inner retry: a second attempt can never fit Stage 1's budget
  // and only risks a dangling upstream fetch. On STAGE1_TIMEOUT the client shows
  // a manual Retry button — there is NO automatic client retry (maxRetries=0).
  const innerAttemptMs = Math.max(attemptTimeoutMs - 500, 3000);
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_VISION,
      max_tokens: 1500,
      messages: [{ role: 'user', content }],
    }),
  }, 0, innerAttemptMs);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Synthetic 503 from fetchWithRetry after the per-attempt AbortController
    // fired: surface it as a timeout so Stage 1 logs don't mislabel an inner
    // abort as a real Anthropic 503 ("Recognition API 503: Unknown").
    if (res.headers.get('x-upstream-failure') === 'attempt-timeout') {
      throw new Error(`[Timeout] Recognition inner fetch aborted at ${innerAttemptMs}ms`);
    }
    throw new Error(`Recognition API ${res.status}: ${err.error?.message || 'Unknown'}`);
  }

  const data = await res.json();
  const raw = data.content?.find((c) => c.type === 'text')?.text || '';
  return parseJSON(raw, 'recognition');
}


// ═══════════════════════════════════════════════════════
// §3.5  GOOGLE VISION FALLBACK (Phase 3)
// ═══════════════════════════════════════════════════════

async function imageHash(base64) {
  // F13 (SCAN-005): hash the FULL image. The old 4 KB prefix covered little
  // more than the JPEG header + first scanlines, which two different photos
  // from the same camera can share — a collision served a WRONG cached Vision
  // result for 24h. SHA-256 over a few MB is milliseconds; existing cache
  // entries keyed by prefix hashes simply miss once and repopulate.
  const data = new TextEncoder().encode(base64);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function checkVisionDailyLimit(supa) {
  if (!supa) return { count: 0, allowed: true };

  const today = new Date().toISOString().slice(0, 10);

  try {
    const { data } = await supa
      .from('vision_daily_counter')
      .select('count')
      .eq('date', today)
      .maybeSingle();

    const count = data?.count || 0;
    return { count, allowed: count < VISION_DAILY_LIMIT };
  } catch (err) {
    console.warn('[Vision] Daily counter check failed (allowing):', err.message);
    return { count: 0, allowed: true };
  }
}

async function incrementVisionDailyCounter(supa) {
  if (!supa) return;

  const today = new Date().toISOString().slice(0, 10);

  try {
    await supa.rpc('increment_vision_counter', { p_date: today });
  } catch {
    try {
      const { data: existing } = await supa
        .from('vision_daily_counter')
        .select('count')
        .eq('date', today)
        .maybeSingle();

      if (existing) {
        await supa.from('vision_daily_counter').update({ count: existing.count + 1 }).eq('date', today);
      } else {
        await supa.from('vision_daily_counter').insert({ date: today, count: 1 });
      }
    } catch (err) {
      console.warn('[Vision] Counter increment failed:', err.message);
    }
  }
}

// Seconds remaining until the next UTC midnight (when the daily quota resets).
function secondsUntilUtcMidnight() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

// Returns { allowed, limitType, retryAfter, charged }.
//   limitType : 'ip_rate' | 'user_rate' | 'user_daily' | 'quota_error' | null
//   retryAfter: seconds the client should wait before retrying
//   charged   : true only when the daily quota was incremented for a request that
//               WILL proceed to the AI pipeline. The caller MUST refund (via
//               decrement_user_daily_scan) if that scan then fails, so a failed
//               scan never permanently consumes the user's daily allowance.
// Safe logs only — no tokens, secrets, or image data.
async function checkRateLimit(supa, ip, userId) {
  // No DB client = fail closed: we cannot verify the rate, so deny
  if (!supa || !ip) return { allowed: false, limitType: 'quota_error', retryAfter: 30, charged: false };

  try {
    // ── Single round trip: IP + user burst guards, atomic daily increment, and
    // the per-minute attempt log all run inside check_and_increment_scan_rate()
    // (SECURITY DEFINER). Replaces 3 sequential Edge→Supabase round trips (~6.3s)
    // with one (~1 RTT) so Stage 1 keeps its time budget. Semantics unchanged.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const { data, error } = await supa.rpc('check_and_increment_scan_rate', {
      p_ip:          ip,
      p_user_id:     userId || null,
      p_date:        today,
      p_ip_limit:    VISION_RATE_PER_MIN,
      p_user_limit:  USER_RATE_PER_MIN,
      p_daily_limit: USER_DAILY_LIMIT,
    });
    if (error) {
      console.error('[RateLimit] denied source=db reason=rpc_failed charged=false:', error.message);
      return { allowed: false, limitType: 'quota_error', retryAfter: 30, charged: false };
    }
    // RETURNS TABLE → supabase-js yields an array of rows.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.error('[RateLimit] denied source=db reason=empty_result charged=false');
      return { allowed: false, limitType: 'quota_error', retryAfter: 30, charged: false };
    }
    if (!row.allowed) {
      const retryAfter = row.limit_type === 'user_daily' ? secondsUntilUtcMidnight() : 60;
      console.warn(`[RateLimit] denied source=db limitType=${row.limit_type} dailyCount=${row.daily_count} retryAfter=${retryAfter}s charged=false`);
      return { allowed: false, limitType: row.limit_type, retryAfter, charged: false };
    }
    console.log(`[RateLimit] allowed uid=${userId ? 'present' : 'anon'} dailyCount=${row.daily_count} charged=${row.charged}`);
    return { allowed: true, limitType: null, retryAfter: 0, charged: !!row.charged };
  } catch (err) {
    // DB check failed — deny rather than allow (fail closed)
    console.error('[RateLimit] denied source=db reason=check_failed charged=false:', err.message);
    return { allowed: false, limitType: 'quota_error', retryAfter: 30, charged: false };
  }
}

// Refund a previously-charged daily scan after a failed scan. Best-effort.
async function refundDailyQuota(supa, userId) {
  if (!supa || !userId) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supa.rpc('decrement_user_daily_scan', { p_user_id: userId, p_date: today });
    if (error) { console.error('[RateLimit] refund failed:', error.message); return; }
    console.log(`[RateLimit] refunded daily quota after failed scan newCount=${data}`);
  } catch (err) {
    console.error('[RateLimit] refund exception:', err.message);
  }
}


async function getCachedVisionResult(supa, hash) {
  if (!supa) return null;

  const cutoff = new Date(Date.now() - VISION_CACHE_TTL_HOURS * 3600_000).toISOString();

  try {
    const { data } = await supa
      .from('vision_cache')
      .select('result, created_at')
      .eq('image_hash', hash)
      .gte('created_at', cutoff)
      .maybeSingle();

    if (data?.result) {
      console.log(`[Vision] Cache HIT for hash ${hash.slice(0, 8)}...`);
      return data.result;
    }
  } catch (err) {
    console.warn('[Vision] Cache read failed:', err.message);
  }
  return null;
}

async function setCachedVisionResult(supa, hash, result) {
  if (!supa) return;

  try {
    await supa.from('vision_cache').upsert({
      image_hash: hash,
      result,
      created_at: new Date().toISOString(),
    }, { onConflict: 'image_hash' });
  } catch (err) {
    console.warn('[Vision] Cache write failed:', err.message);
  }
}

async function fallbackVision(imageBase64, supa) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    console.log('[Vision] GOOGLE_VISION_API_KEY not set — skipping fallback');
    return null;
  }

  // Layer 1: image hash cache
  const hash = await imageHash(imageBase64);
  const cached = await getCachedVisionResult(supa, hash);
  if (cached) return cached;

  // Layer 2: daily limit
  const { count, allowed } = await checkVisionDailyLimit(supa);
  if (!allowed) {
    console.warn(`[Vision] Daily limit reached (${count}/${VISION_DAILY_LIMIT}) — skipping`);
    return null;
  }

  console.log(`[Vision] Calling Google Vision API (today: ${count + 1}/${VISION_DAILY_LIMIT})`);

  try {
    const res = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [
              { type: 'LABEL_DETECTION', maxResults: 10 },
              { type: 'TEXT_DETECTION', maxResults: 10 },
              { type: 'LOGO_DETECTION', maxResults: 5 },
              { type: 'WEB_DETECTION', maxResults: 5 },
            ],
          }],
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[Vision] API ${res.status}:`, errBody.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const response = data.responses?.[0];
    if (!response) return null;

    if (response.error) {
      console.warn('[Vision] API returned error:', response.error.message);
      return null;
    }

    const result = {
      labels: (response.labelAnnotations || []).map(l => ({
        description: l.description,
        score: l.score,
      })),
      text: (response.textAnnotations || [])
        .slice(1)
        .map(t => t.description)
        .filter(t => t && t.length > 1 && t.length < 80),
      logos: (response.logoAnnotations || []).map(l => ({
        description: l.description,
        score: l.score,
      })),
      webEntities: (response.webDetection?.webEntities || [])
        .filter(e => e.description && e.score > 0.5)
        .map(e => e.description),
    };

    incrementVisionDailyCounter(supa).catch(() => {});
    setCachedVisionResult(supa, hash, result).catch(() => {});

    console.log(`[Vision] Got ${result.labels.length} labels, ${result.text.length} text fragments, ${result.logos.length} logos`);
    return result;

  } catch (err) {
    console.warn('[Vision] Call failed:', err.message);
    return null;
  }
}


// ═══════════════════════════════════════════════════════
// §4  EMBEDDING GENERATION
// ═══════════════════════════════════════════════════════

async function generateEmbedding(text) {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) return null;

  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-3',
        input: [text],
        input_type: 'document',
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn('[Embedding] Generation failed:', err.message);
    return null;
  }
}

async function generateQueryEmbedding(text) {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) return null;

  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${voyageKey}`,
      },
      body: JSON.stringify({
        model: 'voyage-3',
        input: [text],
        input_type: 'query',
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════════════
// §5  RETRIEVAL — Supabase Vector Search + Text Fallback
// ═══════════════════════════════════════════════════════

let _supabaseClient = null;
function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _supabaseClient = createClient(url, key);
  return _supabaseClient;
}

// ── F3 (SCAN-003): OCR token hygiene ──────────────────────────────────────
// Generic OCR words ("wireless", "gaming", "mouse", "black", "usb", "pro"…)
// used to reach match_products_by_ocr and return WRONG products at 0.80
// similarity via name-column ILIKE, polluting Stage 2's candidate block.
// Rule: model-shaped identifiers (letter+digit mix or a 3+ digit run — G502,
// WH-1000XM5, A2251, M185) always pass; anything else must be a 3+ char word
// that is not in the generic-token list. Brand names, Stage 1 model-candidate
// strings, and Vision logos bypass this filter entirely (added unsplit below).
const OCR_GENERIC_TOKENS = new Set([
  // connectivity / interfaces
  'wireless', 'wired', 'bluetooth', 'wifi', 'usb', 'usbc', 'hdmi', 'nfc',
  // product-type words
  'gaming', 'game', 'mouse', 'mice', 'keyboard', 'headset', 'headphone',
  'headphones', 'earbuds', 'speaker', 'charger', 'cable', 'adapter',
  'laptop', 'phone', 'tablet', 'watch', 'camera', 'controller', 'console',
  // colors
  'black', 'white', 'blue', 'red', 'green', 'gray', 'grey', 'silver',
  'gold', 'rose', 'pink', 'purple', 'yellow', 'orange',
  // marketing / variant suffixes (full model strings are added unsplit, so
  // dropping these as lone tokens loses nothing)
  'pro', 'max', 'mini', 'plus', 'lite', 'slim', 'ultra', 'air', 'edition',
  'series', 'new', 'original', 'genuine', 'official', 'premium', 'classic',
  // label boilerplate
  'model', 'serial', 'number', 'made', 'china', 'vietnam', 'taiwan',
  'warranty', 'battery', 'power', 'input', 'output', 'volt', 'volts',
  'charging', 'rechargeable', 'certified', 'designed', 'assembled',
  // filler
  'the', 'and', 'for', 'with', 'from', 'this', 'item', 'product',
  'size', 'color', 'colour', 'type', 'version', 'quality',
]);
const isModelShapedToken = (w) => /[a-z][0-9]|[0-9][a-z]|[0-9]{3,}/i.test(w);
const isUsefulOcrToken   = (w) => isModelShapedToken(w) || (w.length >= 3 && !OCR_GENERIC_TOKENS.has(w));

// ── Strategy execution order ──────────────────────────────────────────────
// 1  Exact brand + exact model         (most specific, highest confidence)
// 2  OCR exact tokens                  (brand/model/name from OCR + Vision)
// 3  Brand + normalized model          (strip Hero/X/v2/Pro/RGB/etc.)
//    Brand + model in name column      (model stored as part of product name)
// 4  Brand + all model_candidates      (every Stage 1 candidate)
// 5  Brand + category                  (when model unknown)
// 6  Full-text search                  (name column websearch)
// 7  Vector similarity                 (LAST for products — semantic only)
// 8  Category fallback                 (brand-unknown, last resort)
// 9  Approved product_candidates       (community-learned; pending never)
// ─────────────────────────────────────────────────────────────────────────
async function retrieveCandidates(recognition, queryEmbedding, visionData = null) {
  const supa = getSupabase();

  const strategyLog = {
    supabase_client: !!supa,
    products_table_accessible: null,
    // [{ strategy_name, elapsed_ms, candidate_count, success, query, error,
    //    parallel_group, started_ms, finished_ms, skipped?, reason? }]  (SCAN-010)
    strategies: [],
    final_candidates: 0,
    group_a_wall_ms: null,       // SCAN-010: wall time of the parallel group
    group_a_sequential_ms: null, // sum of individual durations (= old serial cost)
  };

  if (!supa) return { candidates: [], strategyLog };

  // SCAN-010: the probe is launched inside parallel Group A below — it is a
  // pure diagnostic and was serially costing ~0.3–1s before any strategy ran.

  // ── Inputs ───────────────────────────────────────────────────────────────
  const topBrand     = recognition.brand_candidates?.[0]?.brand;
  const topModel     = recognition.model_candidates?.[0]?.model;
  const category     = recognition.category;
  const allModels    = (recognition.model_candidates || [])
                         .map(m => m.model)
                         .filter(m => m && m.toLowerCase() !== 'unidentified');
  const ocrTexts     = recognition.ocr_text?.raw_texts || [];
  const visionText   = visionData?.text  || [];
  const visionLogos  = (visionData?.logos || []).map(l => l.description);

  const brand_ok = !!(topBrand && topBrand.toLowerCase() !== 'unidentified');
  const model_ok = !!(topModel && topModel.toLowerCase() !== 'unidentified');

  console.log(`[Retrieve] brand="${topBrand}" model="${topModel}" cat="${category}" ocr=[${ocrTexts.join('|')}] models=[${allModels.join(',')}]`);

  // ── SCAN-007 (B-13): retrieval-token provenance ──────────────────────────
  // Scan #1 proved the pipeline can confirm itself: Stage 1's guessed model
  // string retrieved its own catalog row, and calibration treated that hit as
  // independent OCR corroboration (+boosts → 88% for a wrong sibling).
  // Every token now carries its origin. Retrieval still uses ALL tokens
  // (recall unchanged — same tokens, same order, same 25-token cap); only
  // calibration's corroboration boosts are gated on evidence-grade matches.
  // BARCODE is reserved: no barcode source exists in the pipeline yet.
  const EVIDENCE_ORIGINS = new Set(['OCR', 'VISION', 'MODEL_NUMBER', 'BARCODE', 'USER_CORRECTION']);
  const tokenOrigins = new Map(); // token -> Set<origin>; insertion order preserved
  const addTok = (tok, origin) => {
    if (!tok) return;
    if (!tokenOrigins.has(tok)) tokenOrigins.set(tok, new Set());
    tokenOrigins.get(tok).add(origin);
  };
  // Same construction order as before (OCR → model candidates → brand → Vision)
  // so uniqueKw is byte-identical to the pre-SCAN-007 list.
  ocrTexts.flatMap(t => t.toLowerCase().split(/[\s,;|]+/).filter(isUsefulOcrToken))
    .forEach(t => addTok(t, 'OCR'));
  (recognition.model_candidates || []).forEach(m => {
    if (m.model && m.model.toLowerCase() !== 'unidentified') {
      addTok(m.model.toLowerCase(), m.evidence === 'user_correction' ? 'USER_CORRECTION' : 'STAGE1_GUESS');
    }
  });
  if (brand_ok) {
    addTok(topBrand.toLowerCase(),
      recognition.brand_candidates?.[0]?.evidence === 'user_correction' ? 'USER_CORRECTION' : 'STAGE1_GUESS');
  }
  visionText.flatMap(t => t.toLowerCase().split(/[\s,;|]+/).filter(isUsefulOcrToken))
    .forEach(t => addTok(t, 'VISION'));
  visionLogos.forEach(l => addTok(l.toLowerCase(), 'VISION'));

  const uniqueKw = [...tokenOrigins.keys()].slice(0, 25);
  const evidenceTokens = uniqueKw.filter(t => [...tokenOrigins.get(t)].some(o => EVIDENCE_ORIGINS.has(o)));

  // A row is independently corroborated only when an evidence-origin token
  // matches its visible identity fields (model/name/keywords/aliases — brand
  // deliberately excluded: a brand hit is not model-level corroboration).
  // Source-agnostic on purpose: a row found by a guess-driven strategy still
  // counts as corroborated if OCR/Vision text independently matches it.
  const rowEvidenceGrade = (r) => {
    if (evidenceTokens.length === 0) return false;
    const fields = [r.model, r.name, ...(r.keywords || []), ...(r.aliases || [])]
      .filter(Boolean).map(f => String(f).toLowerCase());
    if (evidenceTokens.some(tok => fields.some(f => f.includes(tok)))) return true;
    if (r.match_type === 'model_number') {
      // Tier-1 hit not explained by visible fields ⇒ it came from the
      // model_numbers equality (column not returned by the RPC). Attribute it
      // to evidence only when a model-shaped evidence token exists AND no
      // unexplained model-shaped guess token could have been the source —
      // ambiguity resolves to "no boost" (fail-safe).
      const shaped = (t) => /[a-z][0-9]|[0-9][a-z]|[0-9]{3,}/i.test(t);
      const evShaped = evidenceTokens.some(shaped);
      const guessShapedUnexplained = uniqueKw.some(t =>
        !evidenceTokens.includes(t) && shaped(t) && !fields.some(f => f.includes(t)));
      return evShaped && !guessShapedUnexplained;
    }
    return false;
  };

  // ── Dedup accumulator ────────────────────────────────────────────────────
  const seen    = new Set();
  const results = [];

  // baseSim=null → use r.similarity already set on the row (e.g. vector / OCR RPC)
  const addRows = (rows, source, baseSim) => {
    let n = 0;
    for (const r of (rows || [])) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        const weight  = r.confidence_weight ?? 1.0;
        const rawSim  = baseSim ?? r.similarity ?? 0.5;
        // SCAN-007 (B-13): stamp evidence provenance on every candidate row.
        results.push({ ...r, _source: source, similarity: Math.min(rawSim * weight, 1.0), _evidence_grade: rowEvidenceGrade(r) });
        n++;
      }
    }
    return n;
  };

  // Per-strategy log. SCAN-010: optional meta adds parallel_group + start/finish
  // offsets (ms from retrieval start) so future audits can see the timeline.
  const tRetr0 = Date.now();
  const logS = (name, query, rows, error, t0, meta = {}) => {
    const elapsed = meta.elapsed_ms ?? (Date.now() - t0);
    // GW-001: structured per-strategy log — strategy_name, elapsed_ms, candidate_count, success/failure
    strategyLog.strategies.push({
      strategy_name:   name,
      elapsed_ms:      elapsed,
      candidate_count: rows,
      success:         error == null,
      query:           String(query).slice(0, 120),
      error:           error ?? null,
      parallel_group:  meta.parallel_group || 'B_sequential',
      started_ms:      meta.started_ms ?? (t0 - tRetr0),
      finished_ms:     meta.finished_ms ?? (Date.now() - tRetr0),
    });
    console.log(`[Retrieve] ${name}: ${error ? `FAILURE err=${String(error).slice(0, 80)}` : `success ${rows}r`} ${elapsed}ms${meta.parallel_group === 'A_parallel' ? ` [∥ ${meta.started_ms}→${meta.finished_ms}ms]` : ''}`);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // SCAN-010: GROUP A — independent strategies fetched in PARALLEL
  // ═══════════════════════════════════════════════════════════════════════
  // Dependency audit: probe, S1, S2, S3a, S3b read only Stage-1/OCR inputs —
  // never the accumulated `results` — so their FETCHES run concurrently.
  // S4–S9 gate on results.length built up by earlier strategies, so they stay
  // sequential (Group B) — their entry conditions are order-dependent by design.
  //
  // Identity guarantee: rows are APPLIED via addRows in the ORIGINAL order
  // (1 → 2 → 3a → 3b), so dedup ownership, per-row _source/similarity, the
  // per-strategy dedup counts in logs, and the final sorted candidate list are
  // byte-identical to sequential execution whenever all fetches complete.
  // Only wall-clock timing changes. The single order-dependent branch inside
  // S2 — brand-only runs only when the ilike batches added 0 rows AFTER dedup
  // against S1 — is preserved by deferring that query to apply time.

  // Runners FETCH only (no addRows). Shape:
  //   { name, q, t0, started, finished, error, batches:[{rows,source,baseSim}] }
  const mkRec = (name, q) => ({ name, q, t0: Date.now(), started: Date.now() - tRetr0, finished: null, error: null, batches: [] });
  const finish = (rec) => { rec.finished = Date.now() - tRetr0; return rec; };

  const fetchProbe = async () => {
    try {
      const { error: pe } = await supa.from('products').select('id').limit(1);
      strategyLog.products_table_accessible = !pe;
      if (pe) console.warn('[Retrieve] products probe failed:', pe.message);
    } catch { strategyLog.products_table_accessible = false; }
  };

  const fetchS1 = async () => {
    const rec = mkRec('1_exact_brand_model', `brand~"${topBrand}" model~"${topModel}"`);
    try {
      const { data, error } = await supa.from('products').select('*')
        .ilike('brand', `%${topBrand}%`).ilike('model', `%${topModel}%`).limit(5);
      rec.error = error?.message ?? null;
      rec.batches.push({ rows: data, source: 'exact_brand_model', baseSim: 0.92 });
    } catch (e) { rec.error = e.message; }
    return finish(rec);
  };

  const fetchS2 = async () => {
    const rec = mkRec('2_ocr_rpc', `kw=[${uniqueKw.slice(0,5).join(',')}]`);
    rec.deferredBrandOnly = false;
    // GW-001: wrap the whole OCR strategy so one failure never aborts retrieval.
    // Supabase builders are thenables WITHOUT .catch — await + destructure { data, error }.
    try {
      // Try OCR RPC first (Supabase returns DB errors in `error`, does not reject).
      const { data: rpcD, error: rpcE } = await supa
        .rpc('match_products_by_ocr', { p_keywords: uniqueKw, p_limit: 6 });

      if (!rpcE && rpcD?.length) {
        // F7 (SCAN-005): similarity follows match specificity — brand-only rows
        // (0.55) rank below FTS (0.68) and brand+category (0.60).
        const OCR_MATCH_SIM = {
          model_number: 0.92,  // model column or model_numbers array hit
          ocr_keyword:  0.80,  // product name contains an OCR token
          alias:        0.78,  // curated alias (full product names, Hebrew names)
          keyword:      0.72,  // keywords / ocr_keywords array token
          brand:        0.55,  // brand-only — weakest evidence class
        };
        const mapped = rpcD.map(r => ({
          ...r,
          // F1 (SCAN-003): expose the RPC's model-column match as a flag that
          // survives addRows() — calibrateVerification keys its OCR-confirmed
          // boost off this.
          _ocr_model_confirmed: r.match_type === 'model_number',
          similarity: OCR_MATCH_SIM[r.match_type] ?? 0.55,
        }));
        rec.batches.push({ rows: mapped, source: 'ocr_rpc', baseSim: null });
      } else {
        // Direct ILIKE on model-like tokens
        rec.name = '2_ocr_ilike';
        rec.error = rpcE?.message ?? null;
        const modelTokens = ocrTexts
          .flatMap(tx => tx.split(/\s+/))
          .filter(w => /[A-Za-z][0-9]|[0-9]{3,}/.test(w) && w.length >= 3)
          .slice(0, 6);
        rec.q = `tokens=[${modelTokens.join(',')}]`;
        for (const tok of modelTokens) {
          let q = supa.from('products').select('*');
          if (brand_ok) q = q.ilike('brand', `%${topBrand}%`);
          q = q.or(`model.ilike.%${tok}%,name.ilike.%${tok}%`).limit(3);
          const { data: fd } = await q;
          rec.batches.push({ rows: fd, source: 'ocr_ilike', baseSim: 0.80 });
        }
        // Original semantics: brand-only runs only if the ilike loop COMPLETED
        // and added 0 post-dedup rows — decidable only at apply time.
        rec.deferredBrandOnly = brand_ok;
      }
    } catch (e) {
      // Batches fetched before the exception are kept — matches the original,
      // where addRows had already run for them.
      rec.name = rec.name === '2_ocr_ilike' ? '2_ocr_ilike' : '2_ocr';
      rec.error = e.message;
    }
    return finish(rec);
  };

  const normModel = (brand_ok && model_ok) ? normalizeModelKey(topModel) : null; // strips Hero/X/v2/Pro/RGB/etc.
  const runS3a = !!(normModel && normModel.toLowerCase() !== topModel.toLowerCase());
  const fetchS3a = async () => {
    const rec = mkRec('3a_normalized_model', `brand~"${topBrand}" model~"${normModel}"`);
    try {
      const { data, error } = await supa.from('products').select('*')
        .ilike('brand', `%${topBrand}%`).ilike('model', `%${normModel}%`).limit(5);
      rec.error = error?.message ?? null;
      rec.batches.push({ rows: data, source: 'normalized_model', baseSim: 0.85 });
    } catch (e) { rec.error = e.message; }
    return finish(rec);
  };

  const fetchS3b = async () => {
    const rec = mkRec('3b_name_col', `brand~"${topBrand}" name~"${topModel}"`);
    try {
      const { data, error } = await supa.from('products').select('*')
        .ilike('brand', `%${topBrand}%`).ilike('name', `%${topModel}%`).limit(5);
      rec.error = error?.message ?? null;
      rec.batches.push({ rows: data, source: 'name_col', baseSim: 0.82 });
    } catch (e) { rec.error = e.message; }
    return finish(rec);
  };

  // ── Launch Group A concurrently (runners never reject) ──────────────────
  const [ , recS1, recS2, recS3a, recS3b] = await Promise.all([
    fetchProbe(),
    (brand_ok && model_ok) ? fetchS1() : null,
    (uniqueKw.length > 0)  ? fetchS2() : null,
    runS3a                 ? fetchS3a() : null,
    (brand_ok && model_ok) ? fetchS3b() : null,
  ]);

  // ── Apply in CANONICAL order — this is what makes results identical ─────
  const applyRec = (rec) => {
    if (!rec) return;
    let n = 0;
    for (const b of rec.batches) n += addRows(b.rows, b.source, b.baseSim);
    logS(rec.name, rec.q, n, rec.error, rec.t0,
      { parallel_group: 'A_parallel', started_ms: rec.started, finished_ms: rec.finished, elapsed_ms: rec.finished - rec.started });
    return n;
  };
  applyRec(recS1);
  if (recS2) {
    let n2 = 0;
    for (const b of recS2.batches) n2 += addRows(b.rows, b.source, b.baseSim);
    if (recS2.deferredBrandOnly && n2 === 0) {
      // Brand-only if still nothing (post-dedup, exactly as the serial code)
      try {
        const { data: bd } = await supa.from('products').select('*')
          .ilike('brand', `%${topBrand}%`)
          .order('popularity_score', { ascending: false }).limit(4);
        n2 += addRows(bd, 'ocr_brand_only', 0.60);
      } catch (e) { recS2.error = recS2.error || e.message; }
    }
    logS(recS2.name, recS2.q, n2, recS2.error, recS2.t0,
      { parallel_group: 'A_parallel', started_ms: recS2.started, finished_ms: recS2.finished, elapsed_ms: recS2.finished - recS2.started });
  }
  applyRec(recS3a);
  applyRec(recS3b);

  // SCAN-010 budget accounting: wall vs sequential-equivalent time
  const groupARecs = [recS1, recS2, recS3a, recS3b].filter(Boolean);
  strategyLog.group_a_wall_ms = Date.now() - tRetr0;
  strategyLog.group_a_sequential_ms = groupARecs.reduce((s, r) => s + (r.finished - r.started), 0);
  console.log(`[Retrieve] groupA: wall=${strategyLog.group_a_wall_ms}ms sequential-equivalent=${strategyLog.group_a_sequential_ms}ms recovered≈${Math.max(0, strategyLog.group_a_sequential_ms - strategyLog.group_a_wall_ms)}ms`);

  // ── 4. Brand + ALL model candidates sweep ────────────────────────────────
  // Skip top model (already tried in 1); try remaining candidates.
  if (brand_ok && allModels.length > 1 && results.length < 3) {
    const t = Date.now();
    let n = 0;
    const tried = [];
    try {
      for (const cand of allModels.slice(1, 5)) {
        tried.push(cand);
        const { data } = await supa.from('products').select('*')
          .ilike('brand', `%${topBrand}%`).ilike('model', `%${cand}%`).limit(2);
        n += addRows(data, 'model_candidates', 0.72);
      }
      logS('4_model_candidates', `brand="${topBrand}" tried=[${tried.join(',')}]`, n, null, t);
    } catch (e) { logS('4_model_candidates', `brand="${topBrand}" tried=[${tried.join(',')}]`, n, e.message, t); }
  }

  // ── 5. Brand + category lookup ───────────────────────────────────────────
  if (brand_ok && category && results.length < 3) {
    const t = Date.now(), q = `brand~"${topBrand}" cat~"${category}"`;
    try {
      const { data, error } = await supa.from('products').select('*')
        .ilike('brand', `%${topBrand}%`).ilike('category', `%${category}%`)
        .order('popularity_score', { ascending: false }).limit(5);
      logS('5_brand_category', q, addRows(data, 'brand_category', 0.60), error?.message, t);
    } catch (e) { logS('5_brand_category', q, 0, e.message, t); }
  }

  // ── 6. Full-text search on name ──────────────────────────────────────────
  if (results.length < 3) {
    const terms = [topBrand, topModel]
      .filter(x => x && x.toLowerCase() !== 'unidentified').join(' ').trim();
    if (terms) {
      const t = Date.now();
      try {
        const { data, error } = await supa.from('products').select('*')
          .textSearch('name', terms, { type: 'websearch' }).limit(5);
        logS('6_fts', `"${terms}"`, addRows(data, 'fts', 0.68), error?.message, t);
      } catch (e) { logS('6_fts', `"${terms}"`, 0, e.message, t); }
    }
  }

  // ── 7. Vector similarity — LAST for products ────────────────────────────
  if (queryEmbedding && results.length < 3) {
    const t = Date.now();
    try {
      const { data, error } = await supa.rpc('match_products', {
        query_embedding: queryEmbedding, similarity_threshold: 0.60, match_limit: 10,
      });
      logS('7_vector', 'sim≥0.60', addRows(data, 'vector', null), error?.message, t);
    } catch (e) { logS('7_vector', 'sim≥0.60', 0, e.message, t); }
  }

  // ── 8. Category fallback — brand-unknown path ────────────────────────────
  if (results.length === 0 && category) {
    const t = Date.now();
    let q = supa.from('products').select('*').ilike('category', `%${category}%`);
    const ql = brand_ok ? `brand~"${topBrand}" cat~"${category}"` : `cat~"${category}"`;
    if (brand_ok) q = q.ilike('brand', `%${topBrand}%`);
    try {
      const { data, error } = await q.order('popularity_score', { ascending: false }).limit(5);
      logS('8_category_fallback', ql, addRows(data, 'category_fallback', 0.28), error?.message, t);
    } catch (e) { logS('8_category_fallback', ql, 0, e.message, t); }
  }

  // ── 9. Approved product_candidates (community-learned; pending never) ────
  // Products first → approved candidates second. Pending rows never participate.
  if ((brand_ok || model_ok) && results.length < 5) {
    const t = Date.now();
    let q = supa.from('product_candidates')
      .select('id,name,brand,model,category,subcategory,confidence,occurrence_count')
      .eq('status', 'approved');
    if (brand_ok) q = q.ilike('brand', `%${topBrand}%`);
    if (model_ok) q = q.ilike('model', `%${topModel}%`);
    try {
      const { data, error } = await q.limit(3);
      const mapped = (data || []).map(r => ({
        ...r,
        // Pad with null pricing — Stage 2 uses AI estimate for these
        retail_price_ils: null, avg_used_price_ils: null,
        price_low_ils: null, price_high_ils: null,
        popularity_score: r.occurrence_count || 0,
        keywords: [], aliases: [],
        confidence_weight: 0.90,  // slight discount vs confirmed products
        _from_approved_candidate: true,
      }));
      logS('9_approved_candidates', `status=approved brand/model`, addRows(mapped, 'approved_candidate', 0.65), error?.message, t);
    } catch (e) { logS('9_approved_candidates', 'approved_candidates', 0, e.message, t); }
  }

  // ── SCAN-010 observability: record strategies that never ran ────────────
  // (early-exit via the results.length gates, or inputs missing). Future
  // audits see skipped-vs-ran at a glance instead of inferring from absence.
  {
    const ran = new Set(strategyLog.strategies.map(s => s.strategy_name.split('_')[0]));
    const KNOWN = [
      ['1_exact_brand_model', 'A_parallel'], ['2_ocr_rpc', 'A_parallel'],
      ['3a_normalized_model', 'A_parallel'], ['3b_name_col', 'A_parallel'],
      ['4_model_candidates', 'B_sequential'], ['5_brand_category', 'B_sequential'],
      ['6_fts', 'B_sequential'], ['7_vector', 'B_sequential'],
      ['8_category_fallback', 'B_sequential'], ['9_approved_candidates', 'B_sequential'],
    ];
    for (const [name, group] of KNOWN) {
      if (!ran.has(name.split('_')[0])) {
        strategyLog.strategies.push({
          strategy_name: name, skipped: true, parallel_group: group,
          reason: group === 'A_parallel' ? 'inputs_missing' : 'enough_candidates_or_inputs_missing',
          elapsed_ms: 0, candidate_count: 0, success: true, query: '', error: null,
        });
      }
    }
  }

  // ── Finalise: sort → take top 10 ────────────────────────────────────────
  results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  const top = results.slice(0, 10);
  strategyLog.final_candidates = top.length;

  const summary = strategyLog.strategies.map(s => `${s.strategy_name}:${s.candidate_count}r/${s.elapsed_ms}ms/${s.success ? 'ok' : 'fail'}`).join(' ');
  console.log(`[Retrieve] Summary: ${summary}`);
  if (top.length > 0) {
    console.log(`[Retrieve] Top: ${top[0].brand} ${top[0].model} src=${top[0]._source} sim=${top[0].similarity?.toFixed(2)} ev=${top[0]._evidence_grade ? 'evidence' : 'guess'}`);
  } else {
    console.log('[Retrieve] 0 candidates');
  }
  return { candidates: top, strategyLog };
}

async function fetchCorrections() {
  const supa = getSupabase();
  if (!supa) return [];

  try {
    const { data } = await supa
      .from('misidentifications')
      .select('ai_name, corrected_name')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!data?.length) return [];

    const counts = {};
    for (const row of data) {
      const key = `${row.ai_name}|||${row.corrected_name}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).map(([key, count]) => {
      const [original, corrected] = key.split('|||');
      return { original, corrected, count };
    });
  } catch {
    return [];
  }
}


// ═══════════════════════════════════════════════════════
// §6  STAGE 2 — VERIFICATION + PRICING
// ═══════════════════════════════════════════════════════

async function verifyAndPrice(recognition, candidates, corrections, language, apiKey, visionData = null, attemptTimeoutMs = 12000) {
  const prompt = buildVerificationPrompt(recognition, candidates, corrections, language, visionData);

  // GW-002: single attempt (maxRetries=0) with the caller's Stage-2 budget as the
  // per-attempt timeout. Previously used the fetchWithRetry defaults
  // (attemptTimeoutMs=12000, maxRetries=1), which aborted every Stage-2 request at
  // 12s then retried — so Stage 2 could never complete regardless of the outer
  // withTimeout cap. A retry inside a tight budget only doubles latency.
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_VISION,
      max_tokens: 1500,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  }, 0, attemptTimeoutMs);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Verification API ${res.status}: ${err.error?.message || 'Unknown'}`);
  }

  const data = await res.json();
  const raw = data.content?.find((c) => c.type === 'text')?.text || '';
  return parseJSON(raw, 'verification');
}


// ═══════════════════════════════════════════════════════
// §7  CONFIDENCE CALIBRATION
// ═══════════════════════════════════════════════════════

function calibrateRecognition(recognition) {
  let conf = recognition.category_confidence ?? 0.5;
  const topBrand = recognition.brand_candidates?.[0];
  const topModel = recognition.model_candidates?.[0];
  const ocr = recognition.ocr_text || {};
  const isPackaging = topBrand?.evidence === 'packaging_design' || topBrand?.evidence === 'packaging_visual';

  if (!recognition.brand_candidates?.length) conf = Math.min(conf, 0.55);
  if (topBrand && topBrand.confidence < 0.50) conf = Math.min(conf, 0.65);
  if (!ocr.has_readable_text && !ocr.raw_texts?.length && !isPackaging) {
    conf = Math.max(conf - 0.15, 0.10);
  }
  if (isPackaging && topBrand?.confidence >= 0.60) {
    conf = Math.max(conf, 0.60);
    conf = Math.min(conf, 0.79);
  }
  if (topBrand?.confidence >= 0.85 && topModel?.confidence >= 0.75) conf = Math.max(conf, 0.80);
  conf = Math.min(Math.max(conf, 0.10), 0.95);

  return { ...recognition, raw_category_confidence: recognition.category_confidence, category_confidence: round(conf), confidence_calibrated: true };
}

function calibrateVerification(verification, recognition, dbMatches, visionData = null) {
  let conf = verification.match_confidence ?? 0.5;
  const brand = verification.final_brand || '';
  const model = verification.final_model || '';
  const brandConf = verification.brand_confidence || 'unidentified';
  const method = verification.identification_method || 'generic_only';
  const isPackaging = brandConf === 'packaging_recognized' || method === 'packaging_recognized';

  if (brand.toLowerCase() === 'unidentified' || brandConf === 'unidentified') conf = Math.min(conf, 0.60);
  if (brandConf === 'inferred_from_visuals') conf = Math.min(conf, 0.75);
  if (isPackaging && brand.toLowerCase() !== 'unidentified') {
    conf = Math.max(conf, 0.60);
    conf = Math.min(conf, 0.79);
  }
  if (method === 'generic_only') conf = Math.min(conf, 0.50);

  // SCAN-007 (B-13): retrieval counts as INDEPENDENT corroboration only when a
  // match is evidence-grade (its identity fields were hit by an OCR / Vision /
  // model-number / barcode / user-correction token). Rows found solely via
  // Stage 1's own guessed strings still flow to Stage 2 for reasoning and
  // ranking, but they must never raise confidence or suppress confirmation
  // prompts — that is the self-confirmation loop that produced Scan #1's 88%.
  const hasEvidenceMatch = dbMatches.some(m => m._evidence_grade);
  if (dbMatches.length > 0 && !hasEvidenceMatch) {
    console.log('[Calibrate] retrieval matches are guess-derived only — corroboration boosts suppressed');
  }
  if (hasEvidenceMatch && dbMatches.length > 0 && (method === 'db_match' || brandConf === 'db_matched')) conf = Math.min(conf + 0.10, 0.90);
  if (hasEvidenceMatch && isPackaging && dbMatches.length > 0) conf = Math.min(conf + 0.10, 0.85);
  if (brandConf === 'confirmed_by_text' && model.toLowerCase() !== 'unidentified') conf = Math.max(conf, 0.80);

  // RULE 6 (Phase 2): OCR keyword match boost
  // F1 (SCAN-003): the 0.82 floor fires only for rows whose MODEL column matched
  // an OCR token (_ocr_model_confirmed, set from the RPC's match_type) AND whose
  // brand aligns with the final brand — a wrong-product keyword match must never
  // inherit the floor. Generic OCR matches keep the mild +0.08 boost only.
  // SCAN-007 (B-13): only evidence-grade rows are eligible for RULE 6 —
  // guess-derived ocr_* matches get no boost of any kind.
  const ocrRows  = dbMatches.filter(m => m._source?.startsWith('ocr_') && m._evidence_grade);
  const ocrMatch = ocrRows.find(m => m._ocr_model_confirmed) || ocrRows[0];
  if (ocrMatch && brand.toLowerCase() !== 'unidentified' && brandConf !== 'unidentified') {
    const brandHead  = brand.toLowerCase().split(' ')[0];
    const matchBrand = (ocrMatch.brand || '').toLowerCase();
    const brandAligned = !!brandHead && !!matchBrand
      && (matchBrand.includes(brandHead) || brandHead.includes(matchBrand));
    if (ocrMatch._ocr_model_confirmed && brandAligned) {
      // At least the generic +0.08 boost, and never below the 0.82 floor —
      // model-number evidence must never calibrate lower than a keyword match.
      conf = Math.max(Math.min(conf + 0.08, 0.88), 0.82);
      console.log(`[Calibrate] OCR model_number match boost → ${round(conf * 100)}%`);
    } else {
      conf = Math.min(conf + 0.08, 0.88);
    }
  }

  // RULE 7 (Phase 2): confidence_weight from learning loop
  const topMatch = dbMatches[0];
  if (topMatch?.confidence_weight && topMatch.confidence_weight !== 1.0) {
    const weightFactor = topMatch.confidence_weight > 1.0
      ? Math.min(topMatch.confidence_weight, 1.15)
      : Math.max(topMatch.confidence_weight, 0.85);
    conf *= weightFactor;
  }

  // RULE 8 (Phase 3): Google Vision agreement boost
  if (visionData && brand.toLowerCase() !== 'unidentified') {
    const visionLogos = (visionData.logos || []).map(l => (l.description || '').toLowerCase());
    const visionText = (visionData.text || []).join(' ').toLowerCase();
    const brandLower = brand.toLowerCase();
    const modelLower = model.toLowerCase();

    let visionBoost = 0;
    if (visionLogos.some(l => l && (l.includes(brandLower) || brandLower.includes(l)))) {
      visionBoost += 0.07;
      console.log(`[Calibrate] Vision logo confirmed brand "${brand}" → +0.07`);
    }
    if (model.toLowerCase() !== 'unidentified' && visionText.includes(modelLower)) {
      visionBoost += 0.10;
      console.log(`[Calibrate] Vision OCR confirmed model "${model}" → +0.10`);
    }
    if (visionBoost > 0) {
      conf = Math.min(conf + visionBoost, 0.92);
    }
  }

  // RULE 9: Authenticity penalty — high-risk items
  const authAssessment = verification.authenticity_assessment;
  if (authAssessment && brand.toLowerCase() !== 'unidentified') {
    const repTier = authAssessment.replica_tier || '';
    const hasConflict = authAssessment.signal_conflict?.has_conflict;
    const status = authAssessment.status || '';
    if (status === 'unknown' && AUTHENTICITY_HIGH_RISK_BRANDS.test(brand)) {
      conf = Math.min(conf, 0.72);
      console.log(`[Calibrate] Auth: high-risk "${brand}" unverified → cap 0.72`);
    }
    if (hasConflict) {
      conf = Math.min(conf, 0.65);
      console.log(`[Calibrate] Auth: signal conflict → cap 0.65`);
    }
    if (status === 'possible_replica' || repTier === 'mid_replica' || repTier === 'high_end_replica') {
      conf = Math.min(conf, 0.55);
      console.log(`[Calibrate] Auth: possible_replica / high_end_replica → cap 0.55`);
    }
    if (status === 'suspected_fake' || repTier === 'low_quality_fake') {
      conf = Math.min(conf, 0.35);
      console.log(`[Calibrate] Auth: suspected_fake / low_quality_fake → cap 0.35`);
    }
  }

  conf = Math.min(Math.max(conf, 0.10), 0.95);

  return { ...verification, raw_match_confidence: verification.match_confidence, match_confidence: round(conf), confidence_calibrated: true };
}

function getConfidenceTier(confidence) {
  if (confidence >= 0.80) return { tier: 'high',      needsConfirmation: false, color: 'green',  behavior: 'Show normally' };
  if (confidence >= 0.60) return { tier: 'moderate',   needsConfirmation: true,  color: 'amber',  behavior: 'Ask "Is this correct?"' };
  if (confidence >= 0.40) return { tier: 'low',        needsConfirmation: true,  color: 'orange', behavior: 'Request photo/brand input' };
  return                         { tier: 'very_low',   needsConfirmation: true,  color: 'red',    behavior: 'Broad estimate + help modal' };
}


// ═══════════════════════════════════════════════════════
// §8  WRITE-BACK
// ═══════════════════════════════════════════════════════

async function writeBack(recognition, verification) {
  const supa = getSupabase();
  if (!supa) return;

  const brand = verification.final_brand;
  const model = verification.final_model;

  if (!brand || brand.toLowerCase() === 'unidentified') return;

  try {
    const { data: existing } = await supa
      .from('products')
      .select('id, popularity_score, scan_count')
      .ilike('brand', brand)
      .ilike('model', model || '')
      .limit(1)
      .maybeSingle();

    let productId;

    if (existing) {
      // ── Update-only: raw AI scan output NEVER creates new product rows.
      // New products enter via product_candidates → admin approval → promotion.
      // Updating existing rows (popularity_score, embedding) is safe — the
      // product identity was already human-curated when it was inserted.
      productId = existing.id;
      const updates = {
        popularity_score: (existing.popularity_score || 0) + 1,
        scan_count: (existing.scan_count || 0) + 1,
        last_scanned_at: new Date().toISOString(),
      };
      // F17 (SCAN-005): scan estimates NEVER overwrite catalog pricing.
      // "comp_based" usually means "Stage 2 saw a DB candidate", so writing
      // price_estimate_mid back into avg_used_price_ils re-anchored the catalog
      // on an estimate derived from the catalog — a self-reinforcing loop.
      // Scan prices still land in price_observations (append-only history,
      // source-tagged) below; curated catalog prices stay curated.
      //
      // F4 (SCAN-005): text_embedding is no longer written here. The previous
      // code stored the scan's QUERY-type Voyage embedding over the product's
      // curated DOCUMENT-type embedding (the two are intentionally asymmetric),
      // silently degrading vector search with every matched scan. Re-embedding,
      // if ever needed, must use input_type 'document' via a seeding script.
      await supa.from('products').update(updates).eq('id', existing.id);
    } else {
      // ── No existing product: do NOT auto-insert into products.
      // The user-confirmation flow (product_candidate_needed → submit-candidate)
      // will save this to product_candidates for admin review.
      // This is the data-model boundary: trusted products ≠ raw AI guesses.
      console.log(`[WriteBack] No existing product for "${brand} ${model}" — skipping auto-insert (goes via product_candidates flow)`);
    }

    if (productId && verification.price_method === 'comp_based' && verification.price_estimate_mid > 0) {
      await supa.from('price_observations').insert({
        product_id: productId,
        price: verification.price_estimate_mid,
        condition: verification.condition || 'unknown',
        source: 'getworth_scan',
      });
    }
  } catch (err) {
    console.warn('[WriteBack] Failed:', err.message);
  }
}


// ═══════════════════════════════════════════════════════
// §8.5  GW-000 — SCAN PERSISTENCE (server-authoritative)
// ═══════════════════════════════════════════════════════
// record_scan() is the ONLY critical transaction: it writes the valuation and
// commits. Derived data (product stats / popularity / price_observations) is
// updated AFTERWARD and best-effort — it can never block or roll back the
// valuation. Every outcome is logged to scan_events for lifecycle reconstruction
// and surfaced via reportError on final failure.

// Append a lifecycle event. Best-effort — never throws, never blocks the scan.
async function logScanEvent(supa, scanUuid, eventType, stage, payload = {}) {
  if (!supa || !scanUuid) return;
  try {
    await supa.from('scan_events').insert({ scan_uuid: scanUuid, event_type: eventType, stage, payload });
  } catch (e) {
    console.warn(`[scan_events] log failed (${eventType}): ${e.message}`);
  }
}

// CRITICAL: persist the valuation via the record_scan RPC, with bounded retries.
// Returns true if the valuation is durably stored, false otherwise (→ client backup).
async function recordScanWithRetry(supa, valuationRow, scanUuid, maxAttempts = 3) {
  if (!supa) return false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { error } = await supa.rpc('record_scan', { p_valuation: valuationRow });
      if (error) throw new Error(error.message);
      await logScanEvent(supa, scanUuid, 'valuation_recorded', 'persist', { valuation_id: valuationRow.id, attempt });
      return true;
    } catch (err) {
      console.warn(`[record_scan] attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      if (attempt === maxAttempts) {
        await logScanEvent(supa, scanUuid, 'persistence_failed', 'valuation', { valuation_id: valuationRow.id, error: err.message, attempts: attempt });
        reportError(err, { scan_uuid: scanUuid, stage: 'record_scan', valuation_id: valuationRow.id });
        return false;
      }
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
  return false;
}

// SECONDARY: derived data. Runs only AFTER the valuation is committed. Failures
// are logged + reported but are non-fatal by construction (caller ignores them).
async function updateDerivedWithRetry(supa, recognition, verification, scanUuid, maxAttempts = 2) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await withTimeout(writeBack(recognition, verification), 8_000, 'writeBack');
      await logScanEvent(supa, scanUuid, 'derived_updated', 'writeback', { attempt });
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        await logScanEvent(supa, scanUuid, 'derived_failed', 'writeback', { error: err.message, attempts: attempt });
        reportError(err, { scan_uuid: scanUuid, stage: 'derived_writeback' });
        return;
      }
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
}


// ═══════════════════════════════════════════════════════
// §9  NORMALIZE
// ═══════════════════════════════════════════════════════

function assessAuthenticity(recognition, verification) {
  const cat = (verification.final_category || recognition.category || '').toLowerCase();
  const brand = (verification.final_brand || '').toLowerCase();
  const brandDisplay = verification.final_brand || '';
  const subcategory = (recognition.subcategory || '').toLowerCase();
  const ocr = recognition.ocr_text || {};

  const isBrandHighRisk = brand !== 'unidentified' && AUTHENTICITY_HIGH_RISK_BRANDS.test(brand);
  const isCategoryHighRisk = AUTHENTICITY_HIGH_RISK_CATEGORIES.has(cat)
    || cat.includes('watch') || cat.includes('bag') || cat.includes('jewel');
  const isLuxuryWatch = (cat.includes('watch') || subcategory.includes('watch')) && isBrandHighRisk;
  const isDesignerBag = (cat.includes('bag') || subcategory.includes('bag') || subcategory.includes('handbag')) && isBrandHighRisk;
  const isLimitedSneaker = (cat.includes('sneak') || cat.includes('shoe') || subcategory.includes('sneak')) && isBrandHighRisk;

  let authenticityRisk = 'low';
  if (isBrandHighRisk || isLuxuryWatch || isDesignerBag || isLimitedSneaker) authenticityRisk = 'high';
  else if (isCategoryHighRisk) authenticityRisk = 'medium';

  const aiAuth = verification.authenticity_assessment || {};
  const authenticityStatus = aiAuth.status || (authenticityRisk === 'low' ? 'not_required' : 'unknown');
  const authenticityConfidence = typeof aiAuth.confidence === 'number' ? aiAuth.confidence : (authenticityRisk === 'low' ? 1.0 : 0.0);

  // ── New fields from forensics ──
  const visual_authenticity_signals = Array.isArray(aiAuth.visual_signals) ? aiAuth.visual_signals : [];
  const replicaTier = aiAuth.replica_tier || (authenticityRisk === 'low' ? 'none' : 'unknown');

  // Signal conflict: combine AI detection + our own structural rule
  const aiConflict = aiAuth.signal_conflict || {};
  const ourConflictReasons = [];
  if (isBrandHighRisk) {
    const brandFirst = brand.split(' ')[0];
    const ocrAll = (ocr.raw_texts || []).concat(ocr.logos_detected || []).join(' ').toLowerCase();
    if (!ocrAll.includes(brandFirst)) {
      ourConflictReasons.push(`${brandDisplay} identified visually but no brand text/logo confirmed in OCR`);
    }
  }
  const signalConflict = {
    hasConflict: !!(aiConflict.has_conflict || ourConflictReasons.length > 0),
    reasons: [...(aiConflict.reasons || []), ...ourConflictReasons],
  };

  // Missing evidence — prefer AI-provided list, fall back to category defaults
  let missingEvidence = Array.isArray(aiAuth.missing_evidence) && aiAuth.missing_evidence.length > 0
    ? aiAuth.missing_evidence
    : [];
  if (missingEvidence.length === 0) {
    if (isLuxuryWatch) missingEvidence = ['Dial close-up', 'Caseback photo', 'Clasp & bracelet', 'Serial/reference number', 'Box & papers'];
    else if (isDesignerBag) missingEvidence = ['Logo close-up', 'Stitching detail', 'Hardware', 'Date code / serial tag', 'Dust bag & box'];
    else if (isLimitedSneaker) missingEvidence = ['Label/tag inside tongue', 'Sole photo', 'Box with barcode', 'Stitching detail'];
    else if (isBrandHighRisk) missingEvidence = ['Brand label', 'Serial number', 'Packaging'];
  }

  // Evidence score: start from AI score, apply caps
  let authenticityEvidenceScore = typeof aiAuth.evidence_score === 'number' ? aiAuth.evidence_score : 0;
  if (signalConflict.hasConflict) authenticityEvidenceScore = Math.min(authenticityEvidenceScore, 40);
  const missingSerial = missingEvidence.some(e => /serial|reference|imei/i.test(e));
  if (missingSerial && authenticityRisk === 'high') authenticityEvidenceScore = Math.min(authenticityEvidenceScore, 55);
  if (authenticityRisk === 'low') authenticityEvidenceScore = 100;
  else authenticityEvidenceScore = Math.min(Math.max(authenticityEvidenceScore, 0), 85);

  // Required verification photos = missing evidence (same list, different label in UI)
  const requiredVerificationPhotos = missingEvidence;

  // Pricing mode
  let pricingMode = 'normal';
  const isReplicaStatus = authenticityStatus === 'suspected_fake' || authenticityStatus === 'possible_replica';
  const isReplicaTier = replicaTier === 'low_quality_fake' || replicaTier === 'mid_replica' || replicaTier === 'high_end_replica';
  if (isReplicaStatus || isReplicaTier) {
    pricingMode = 'replica_adjusted';
  } else if (authenticityRisk === 'high' && (authenticityStatus === 'unknown' || authenticityStatus === 'not_required' || !authenticityStatus)) {
    pricingMode = 'verification_required';
  } else if (authenticityRisk === 'medium' && authenticityStatus === 'unknown') {
    pricingMode = 'conditional';
  } else if (signalConflict.hasConflict) {
    pricingMode = 'conditional';
  }

  const authenticityNotes = [...(aiAuth.red_flags || []), ...(aiAuth.green_flags || [])];

  return {
    authenticityRisk,
    authenticityStatus,
    authenticityConfidence,
    requiredVerificationPhotos,
    authenticityNotes,
    pricingMode,
    visual_authenticity_signals,
    missingEvidence,
    authenticityEvidenceScore,
    replicaTier,
    signalConflict,
  };
}


// Strip trailing variant suffixes so G502/G502 Hero/G502X all collapse to "g502"
function normalizeModelKey(model) {
  return (model || '')
    .toLowerCase()
    .replace(/\s+(hero\d?|x\s*plus|x\+|x\d?|\+|se|lite|rgb|gaming|wireless|lightspeed|edition|v\d|gen\d|mk\d|plus|pro)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── SCAN-IDENTITY-001: canonical product title ──────────────────────────────
// Hebrew labels for common item descriptors (Stage 1 subcategory). Brand and
// model names are NEVER translated — Latin product names are the norm in
// Israeli commerce; only the generic descriptor gets a Hebrew label.
const HEBREW_DESCRIPTORS = {
  'gaming mouse': 'עכבר גיימינג',
  'wireless mouse': 'עכבר אלחוטי',
  'mouse': 'עכבר',
  'mechanical keyboard': 'מקלדת מכנית',
  'gaming keyboard': 'מקלדת גיימינג',
  'keyboard': 'מקלדת',
  'wireless headphones': 'אוזניות אלחוטיות',
  'gaming headset': 'אוזניות גיימינג',
  'headphones': 'אוזניות',
  'earbuds': 'אוזניות אלחוטיות',
  'smartphone': 'סמארטפון',
  'laptop': 'מחשב נייד',
  'tablet': 'טאבלט',
  'smartwatch': 'שעון חכם',
  'monitor': 'מסך מחשב',
  'bluetooth speaker': "רמקול בלוטות'",
  'speaker': 'רמקול',
  'camera': 'מצלמה',
  'game console': 'קונסולת משחק',
  'game controller': 'בקר משחק',
  'controller': 'בקר משחק',
  'drone': 'רחפן',
  'router': 'ראוטר',
  'webcam': 'מצלמת רשת',
  'microphone': 'מיקרופון',
  'power bank': 'סוללת גיבוי',
  'watch': 'שעון',
  'sneakers': 'נעלי ספורט',
  'backpack': 'תיק גב',
  'bicycle': 'אופניים',
};

function hebrewDescriptor(descriptor) {
  return HEBREW_DESCRIPTORS[(descriptor || '').toLowerCase().trim()] || null;
}

function titleCaseDescriptor(s) {
  return (s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// A category ("Electronics") is never used as the product title. Fallback
// ladder: brand+model → brand+descriptor → descriptor. recognition.category
// survives only as an emergency guard against an empty title (no brand, no
// subcategory, no usable full_name).
function composeTitles(recognition, verification) {
  const brand = (verification.final_brand || '').trim();
  const model = (verification.final_model || '').trim();
  const brandOk = !!brand && brand.toLowerCase() !== 'unidentified';
  const modelOk = !!model && model.toLowerCase() !== 'unidentified';
  const descriptor = (recognition.subcategory || '').trim();
  const fullName = (verification.full_name || '').trim();
  const category = recognition.category || '';

  let name;
  if (brandOk && modelOk) {
    // Canonical identity — always "<Brand> <Model>", regardless of language.
    // Guard: some models arrive with the brand already prefixed.
    name = model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
  } else if (brandOk) {
    // Accept Stage 2's full_name only when it actually carries the brand —
    // an unguarded generic full_name ("Gaming Mouse") must not win here.
    name = fullName.toLowerCase().includes(brand.toLowerCase())
      ? fullName
      : `${brand} ${titleCaseDescriptor(descriptor)}`.trim();
  } else {
    name = titleCaseDescriptor(descriptor)
      || (fullName && fullName !== category ? fullName : '')
      || category; // emergency only
  }

  // Hebrew title: identical Latin brand+model when identified; Hebrew is used
  // only for generic descriptors. Never falls back to category_hebrew.
  let nameHebrew;
  if (brandOk && modelOk) {
    nameHebrew = name;
  } else if (brandOk) {
    const heb = hebrewDescriptor(descriptor);
    nameHebrew = heb ? `${brand} ${heb}` : name;
  } else {
    nameHebrew = hebrewDescriptor(descriptor) || name;
  }

  return { name, nameHebrew };
}

function normalizeForUI(recognition, verification, tierInfo, visionUsed = false) {
  const ocr = recognition.ocr_text || {};
  const auth = assessAuthenticity(recognition, verification);

  // Price multiplier — replica tier takes precedence over status
  const priceMultiplier =
    (auth.authenticityStatus === 'suspected_fake' || auth.replicaTier === 'low_quality_fake') ? 0.07
    : (auth.authenticityStatus === 'possible_replica' || auth.replicaTier === 'mid_replica') ? 0.15
    : auth.replicaTier === 'high_end_replica' ? 0.28
    : 1.0;

  // SCAN-IDENTITY-001: title composed from structured identity fields;
  // category is kept fully separate from the product title.
  const titles = composeTitles(recognition, verification);

  return {
    name: titles.name,
    nameHebrew: titles.nameHebrew,
    category: verification.final_category || recognition.category,
    confidence: verification.match_confidence,
    isSellable: verification.is_sellable ?? true,
    condition: verification.condition || recognition.visual_features?.condition || 'unknown',
    marketValue: {
      low: Math.round((verification.price_estimate_low || 0) * priceMultiplier),
      mid: Math.round((verification.price_estimate_mid || 0) * priceMultiplier),
      high: Math.round((verification.price_estimate_high || 0) * priceMultiplier),
      currency: 'ILS',
      newRetailPrice: verification.new_retail_price_ils || 0,
      price_method: verification.price_method || 'ai_estimate',
      pricingMode: auth.pricingMode,
      // Populated when Stage 2 fallback is used; null means Stage 2 ran normally
      pricing_status:  verification._pricing_meta?.pricing_status  || (verification.price_method === 'comp_based' ? 'db_based' : 'ai_estimate'),
      pricing_warning: verification._pricing_meta?.pricing_warning || null,
      // SCAN-008: internal pricing grade — decoupled from identity confidence.
      // HIGH = Stage 2 comp-based · MEDIUM = Stage 2 AI estimate or curated
      // db_fallback · LOW = category bucket · MANUAL_REQUIRED = no evidence.
      // Not rendered anywhere; persisted inside ai_raw_response for learning.
      pricing_confidence: verification._pricing_meta?.pricing_confidence
        || (verification.price_method === 'comp_based' ? 'HIGH' : 'MEDIUM'),
      // SCAN-009: PRE provenance — which rescue source priced this (internal).
      pricing_reason: verification._pricing_meta?.pricing_reason || null,
      pre_source:     verification._pricing_meta?.pre_source || null,
    },
    details: {
      description: verification.israeli_market_notes || '',
      brand: verification.final_brand || 'unidentified',
      model: verification.final_model || 'unidentified',
      additionalInfo: '',
    },
    priceFactors: verification.price_factors || [],
    marketTrend: 'stable',
    demandLevel: verification.market_demand || 'moderate',
    sellingTips: verification.selling_tips || '',
    israeliMarketNotes: verification.israeli_market_notes || '',
    recognition: {
      identifiedBy: mapMethod(verification.identification_method),
      ocrText: (ocr.raw_texts || []).join(' | '),
      modelNumber: verification.final_model !== 'unidentified' ? verification.final_model : null,
      brandConfidence: verification.brand_confidence || 'unidentified',
      alternatives: (() => {
        const topBrand = recognition.brand_candidates?.[0]?.brand || '';
        const brandOk = topBrand && topBrand.toLowerCase() !== 'unidentified';
        // Dedupe by normalized model family — prevents G502 / G502 Hero / G502X all appearing
        const seenKeys = new Set([normalizeModelKey(verification.final_model || '')]);
        return (recognition.model_candidates || [])
          .filter(c => {
            if ((c.confidence ?? 0) < 0.25) return false;
            const key = normalizeModelKey(c.model);
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
          })
          .slice(0, 3)
          .map(c => ({
            name: brandOk ? `${topBrand} ${c.model}`.trim() : c.model,
            confidence: c.confidence,
          }));
      })(),
    },
    identification: {
      // SCAN-IDENTITY-001: descriptor-first — the very_low UI title path and
      // "looks like a …" strings consume these; a subcategory ("gaming mouse")
      // beats a broad category ("Electronics"). Category remains the last resort.
      generic_name: titleCaseDescriptor(recognition.subcategory) || recognition.category,
      generic_name_hebrew: hebrewDescriptor(recognition.subcategory)
        || recognition.category_hebrew || '',
      brand: verification.final_brand,
      model: verification.final_model,
      full_name: verification.full_name || '',
      full_name_hebrew: verification.full_name_hebrew || '',
    },
    ocr: {
      text_found: ocr.raw_texts || [],
      logos_found: ocr.logos_detected || [],
      readable_text_on_item: ocr.has_readable_text || false,
    },
    classification: {
      category: verification.final_category || recognition.category,
      subcategory: recognition.subcategory || '',
      identification_method: verification.identification_method || 'generic_only',
      brand_confidence: verification.brand_confidence || 'unidentified',
    },
    confidence_reasoning: verification.confidence_reasoning || '',
    confidence_calibrated: true,
    raw_confidence: verification.raw_match_confidence ?? verification.match_confidence,
    needsConfirmation: tierInfo.needsConfirmation,
    authenticity: auth,
    // GW-004: never surface AI-fabricated comparables. Real DB comps are still
    // used internally for pricing (retrieval -> Stage 2) but are NOT displayed as
    // external evidence. Only real DB-backed records may populate this later.
    comparable_items: [],
    _pipeline: {
      version: 'v2',
      stage1_confidence: recognition.category_confidence,
      stage2_confidence: verification.match_confidence,
      db_matches: verification.matched_product_ids?.length || 0,
      tier: tierInfo.tier,
      embedding_used: !!recognition._embedding_used,
      vision_fallback_used: visionUsed,
    },
  };
}


// ═══════════════════════════════════════════════════════
// §9.5  SERIAL OCR — lightweight label text extraction
// ═══════════════════════════════════════════════════════

async function ocrSerialLabel(imageBase64, apiKey) {
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_OCR,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: 'Extract all text from this image, focusing on serial numbers, IMEI numbers, and S/N labels. Return ONLY the raw text you see, no commentary.' },
        ],
      }],
    }),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.content?.find(c => c.type === 'text')?.text?.trim() || '';
}


// ═══════════════════════════════════════════════════════
// §10  MAIN HANDLER
// ═══════════════════════════════════════════════════════

async function handleRequest(req) {
  // CORS: reflect origin only when it is in the allow-list
  const cors = getCorsHeaders(req.headers.get('origin') || '');

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  // ── GLOBAL BUDGET CLOCK ──
  // Starts before auth so every ms of overhead is accounted for.
  // rem() = how many ms we have left before we must respond.
  // All stage decisions and timeouts are derived from this single source of truth.
  const TREQ      = Date.now();
  const BUDGET_MS = 50_000;   // hard ceiling — must respond before this
  // SCAN-009: raised 45s → 50s (maxDuration 60 keeps a 10s margin) to fund the
  // Pricing Rescue Engine after a Stage-2 timeout without shrinking Stage 2's cap.
  // Raised 22 s → 45 s after moving off Edge to the Node runtime (maxDuration 60 s,
  // ~15 s safety margin). Edge's 25 s wall forced an 8–12 s Stage 1 cap, which
  // Sonnet 4.6 Vision routinely exceeded; the larger budget lets Stage 1 use up to
  // 28 s (ALPHA-005) while reserving 12 s for embedding + retrieval + Stage 2 +
  // persistence + response write.
  const rem  = () => BUDGET_MS - (Date.now() - TREQ);
  const blog = (msg) => console.log(`[rem=${rem()}ms total=${Date.now() - TREQ}ms] ${msg}`);

  // ── SCAN-008 (B-3): reclaim serial overhead for Stage 2's budget ──────────
  // Production scans showed Stage 2 consistently needs 18–20s (output-token
  // bound), while cold-start overhead ate its cap: auth (JWKS ~1.8–3.1s) ran
  // serially BEFORE the body parse, and the rate-limit RPC paid ~2–3s of cold
  // Supabase TLS/pool setup. Both are independent of auth, so they now start
  // concurrently with it. Semantics unchanged: the body is only USED after
  // auth succeeds, and a parse failure surfaces exactly where it used to.
  const bodyPromise = (async () => {
    try { return await req.json(); }
    catch (e) { return { __parse_error: e?.message || 'invalid JSON' }; }
  })();
  try {
    // Fire-and-forget pool warmup — result ignored, errors swallowed.
    getSupabase()?.from('products').select('id').limit(1).then(() => {}, () => {});
  } catch { /* warmup must never block or throw */ }

  // ── AUTH — local HMAC-SHA256 (fast path) or network fallback ──
  // Local verify: ~1 ms, zero network. Fallback: up to 5 s (only when
  // SUPABASE_JWT_SECRET is not set — configure it in Vercel to eliminate fallback).
  const authUser = await withTimeout(
    verifyJWT(req.headers.get('authorization')),
    5_000,
    'JWT verification'
  ).catch(err => { blog(`[Auth] verify timed out: ${err.message}`); return null; });

  if (!authUser) return json({ error: 'Unauthorized — valid session required' }, 401, cors);
  if (authUser._expired) return json({ error: 'Session expired — please sign in again', code: 'SESSION_EXPIRED' }, 401, cors);
  blog(`[Auth] OK method=${authUser._authMethod} uid=${authUser.id}`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'API key not configured' }, 500, cors);

  // Hoisted so both the Stage 1 catch and the outer fatal catch can refund.
  let quotaCharged = false;

  try {
    // Reject oversized bodies before JSON parsing (5 images × 5 MB + envelope).
    // Content-Length may be absent on chunked transfers; skip the check if so.
    const bodyLen = parseInt(req.headers.get('content-length') || '0', 10);
    if (bodyLen > 26_214_400) {
      return json({ error: 'Request body too large' }, 413, cors);
    }

    // SCAN-008 (B-3): body was parsed concurrently with auth (above). A parse
    // failure throws here — same catch path and 500 status as before.
    const parsedBody = await bodyPromise;
    if (parsedBody?.__parse_error) throw new Error(`Body parse failed: ${parsedBody.__parse_error}`);
    const { imageData, images: imagesArr, lang = 'he', hints = [], corrections: clientCorrections = [], serialOCR = false, refineModel = null, scan_uuid: clientScanUuid = null } = parsedBody;
    // TIMING: req.json() blocks until the full request body has uploaded. On Edge
    // this upload time is inside the budget clock — this log isolates it.
    blog(`[Timing] body read+parsed (req.json) bodyLen=${bodyLen}B`);
    const clientHints = clientCorrections.length > 0 ? clientCorrections : hints;
    const imageList = imagesArr?.length > 0 ? imagesArr : imageData ? [imageData] : [];

    // ── IMAGE VALIDATION — magic bytes + 5 MB cap ──
    const imgErr = validateImages(imageList);
    if (imgErr) return json({ error: imgErr }, 400, cors);
    blog(`[Timing] images validated count=${imageList.length}`);

    // ── PHASE 3: RATE LIMITING — fail closed on DB error ──
    const supa = getSupabase();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || req.headers.get('x-real-ip')
            || 'unknown';

    blog('[Timing] rate-limit check start');
    const rl = await checkRateLimit(supa, ip, authUser.id);
    blog(`[Timing] rate-limit check done allowed=${rl.allowed}`);
    // Tracks whether THIS request charged the daily quota, so we can refund it if
    // the scan later fails (Stage 1 / fatal). Set false again once refunded.
    quotaCharged = rl.charged;
    if (!rl.allowed) {
      const message = rl.limitType === 'user_daily'
        ? 'Daily scan limit reached. Try again tomorrow.'
        : 'Too many scans. Please wait a moment and try again.';
      blog(`[RateLimit] 429 limitType=${rl.limitType} retryAfter=${rl.retryAfter}s (no AI call — cost-free)`);
      return json({
        error: message,                       // legacy field — kept for back-compat
        code: 'RATE_LIMITED',
        message,
        retryAfterSeconds: rl.retryAfter,
        limitType: rl.limitType,
        retryable: rl.limitType !== 'user_daily',
        rateLimited: true,
      }, 429, { ...cors, 'Retry-After': String(rl.retryAfter) });
    }

    // ── SERIAL OCR EARLY EXIT — skip full pipeline (rate-limited above) ──
    if (serialOCR) {
      const ocrText = await ocrSerialLabel(imageList[0], apiKey);
      return json({ ocrText, raw_texts: [ocrText] }, 200, cors);
    }

    // ── PIPELINE STAGES ──
    // Every stage reads rem() before starting and uses Math.min(ideal, rem()-reserve)
    // as its timeout cap. Stages are skipped — not timed out — when budget is tight.
    // Rule of thumb for reserves:
    //   Stage 2 needs at least 8 s  → reserve 8 s before starting Stage 2
    //   Embed+retrieve need ~2 s typical → reserve 9 s (8 + 1 buffer) before them
    //   Vision can use up to 5 s → requires 12 s remaining (5 vision + 7 embed/retrieve/stage2)

    const plog = (stage, extra = '') =>
      blog(`[Pipeline] ${stage}${extra ? ' — ' + extra : ''}`);

    // ── STAGE 1: RECOGNIZE (Claude Vision) — REQUIRED ──
    // Cap shrinks with budget so Stage 1 never starves the rest of the pipeline.
    // Floor: 8 s — Claude Vision typically needs 5-10 s; 3 s was always timing out.
    // Formula: up to 28 s, reserving 12 s for embedding + retrieval + Stage 2
    // (8 s minimum) + persistence + response write. ALPHA-005: raised from 20 s —
    // Sonnet Vision generating the full recognition JSON routinely needs 15-25 s,
    // and the 45 s budget leaves this headroom unused.
    // With 45 s budget and ~2 s auth+parse → ~42 s remaining → cap = 28 s.
    const stage1Cap = Math.max(Math.min(28_000, rem() - 12_000), 8_000);
    const imgByteEst = imageList.reduce((sum, b64) => sum + Math.round(b64.length * 0.75), 0);
    plog('Stage 1 start', `images=${imageList.length} ~bytes=${imgByteEst} lang=${lang} cap=${stage1Cap}ms rem=${rem()}ms`);

    let recognition;
    try {
      recognition = await withTimeout(
        recognize(imageList, lang, apiKey, stage1Cap),
        stage1Cap,
        'Stage 1 recognition'
      );
      recognition = calibrateRecognition(recognition);

      // ── USER CORRECTION INJECTION — highest-priority signal ──
      // When the user explicitly selects an alternative or types a correction,
      // refineModel carries their intent (e.g. "Logitech G900").
      // Override Stage 1 so Stage 2 treats this as a mandatory identity.
      if (refineModel) {
        const corrText = refineModel.trim();
        const spaceIdx = corrText.indexOf(' ');
        const corrBrand = spaceIdx > 0
          ? corrText.slice(0, spaceIdx)
          : (recognition.brand_candidates?.[0]?.brand || null);
        const corrModel = spaceIdx > 0 ? corrText.slice(spaceIdx + 1) : corrText;

        recognition.brand_candidates = [
          { brand: corrBrand || 'Unknown', confidence: 0.96, evidence: 'user_correction' },
          ...(recognition.brand_candidates || []),
        ];
        recognition.model_candidates = [
          { model: corrModel, confidence: 0.96, evidence: 'user_correction' },
          ...(recognition.model_candidates || []),
        ];
        recognition._user_correction = corrText;
        recognition._correction_source = 'user_selected';
        console.log(`[Analyze correction received] refineModel="${corrText}" → brand="${corrBrand}" model="${corrModel}"`);
      }
    } catch (stage1Err) {
      // Stage 1 failure is NOT a product classification — it is a retryable error.
      // Return 503 so the client shows "please retry" instead of a fake "Other" result.
      // Classify for LOGS ONLY — the client response below is identical for every kind.
      //   stage1_timeout          → outer withTimeout or inner fetch AbortController
      //   anthropic_auth_error    → 401/403 from the Anthropic API (key problem)
      //   anthropic_rate_limited  → 429 from the Anthropic API
      //   anthropic_upstream_error→ 5xx/529 from the Anthropic API (or exhausted retries)
      //   anthropic_api_error     → any other non-2xx Anthropic status
      //   other_failure           → parse errors, network errors, unexpected throws
      const msg = stage1Err.message || '';
      const failureKind =
        (stage1Err.name === 'AbortError' || msg.includes('[Timeout]')) ? 'stage1_timeout'
        : /Recognition API (401|403)/.test(msg)           ? 'anthropic_auth_error'
        : /Recognition API 429/.test(msg)                 ? 'anthropic_rate_limited'
        : /Recognition API (500|502|503|529)/.test(msg)   ? 'anthropic_upstream_error'
        : /Recognition API \d+/.test(msg)                 ? 'anthropic_api_error'
        : 'other_failure';
      // Refund the daily quota — a failed scan must not consume the user's allowance.
      if (quotaCharged) { await refundDailyQuota(supa, authUser.id); quotaCharged = false; }
      blog(`[Pipeline] Stage 1 FAILED (${failureKind}) — returning 503 (quota refunded): ${msg}`);
      return json({
        error: lang === 'he'
          ? 'הזיהוי נכשל — אנא נסה שוב'
          : 'Recognition timed out — please try again',
        retryable: true,
        code: 'STAGE1_TIMEOUT',
        reason: stage1Err.message,
        stage1_cap_ms: stage1Cap,
        rem_at_failure: rem(),
      }, 503, cors);
    }
    plog('Stage 1 end', `brand=${recognition.brand_candidates?.[0]?.brand || 'none'}(${round((recognition.brand_candidates?.[0]?.confidence || 0)*100)}%) model=${recognition.model_candidates?.[0]?.model || 'none'}(${round((recognition.model_candidates?.[0]?.confidence || 0)*100)}%) cat=${recognition.category} catConf=${round(recognition.category_confidence * 100)}% ocr=[${(recognition.ocr_text?.raw_texts || []).join('|')}] rem=${rem()}ms`);

    // embeddingText is computed once and reused by embedding + writeBack
    const embeddingText = recognition.embedding_text
      || [recognition.brand_candidates?.[0]?.brand, recognition.model_candidates?.[0]?.model, recognition.category, ...(recognition.visual_features?.materials || [])].filter(Boolean).join(' ');

    // ── VISION FALLBACK — OPTIONAL, requires >= 12 s remaining ──
    // Skip when: confidence is sufficient, OR budget too tight.
    // Timeout cap = rem - 10 s (preserve 10 s for embed+retrieve+Stage2).
    let visionData = null;
    // F2 (SCAN-003): gate Vision on IDENTITY confidence, not just category
    // confidence. "Electronics 90%" with an unreadable label used to skip Vision
    // — exactly the scan Vision exists for. Identity is weak when the top brand
    // OR top model candidate is below the trigger threshold (shape-only photos,
    // generic-only recognition, and no-OCR scans all land here because the Stage 1
    // prompt caps their candidate confidence). Text-confirmed scans (brand AND
    // model ≥ threshold, incl. user corrections at 0.96) still skip. All cost
    // protections (24h image cache, daily hard cap, per-IP rate limit) are
    // unchanged inside fallbackVision.
    const topBrandConf = recognition.brand_candidates?.[0]?.confidence || 0;
    const topModelConf = recognition.model_candidates?.[0]?.confidence || 0;
    const identityWeak = topBrandConf < VISION_TRIGGER_THRESHOLD || topModelConf < VISION_TRIGGER_THRESHOLD;
    const needsVision  = recognition.category_confidence < VISION_TRIGGER_THRESHOLD || identityWeak;
    if (needsVision && rem() >= 12_000) {
      const visionCap = Math.min(5_000, rem() - 10_000);
      // F14 (SCAN-005): inspect the NEWEST image, not imageList[0]. In a
      // multi-photo scan the client appends photos (label/model-plate close-ups
      // requested by the help flow) at the END of the array — exactly the
      // OCR-richest evidence, which Vision previously never saw. Single-photo
      // scans are unchanged. The 24h cache keys off this same image.
      const visionImage = imageList[imageList.length - 1];
      plog('Vision start', `conf=${round(recognition.category_confidence * 100)}% img=${imageList.length}/${imageList.length} cap=${visionCap}ms rem=${rem()}ms`);
      visionData = await withTimeout(fallbackVision(visionImage, supa), visionCap, 'Vision fallback')
        .catch(err => { blog(`[Vision] SKIPPED — ${err.message}`); return null; });
      plog('Vision end', visionData ? `labels=${visionData.labels?.length} text=${visionData.text?.length} rem=${rem()}ms` : `no data rem=${rem()}ms`);
    } else if (!needsVision) {
      plog('Vision skip', `identity sufficient (cat=${round(recognition.category_confidence * 100)}% brand=${round(topBrandConf * 100)}% model=${round(topModelConf * 100)}%) rem=${rem()}ms`);
    } else {
      plog('Vision SKIPPED — budget', `rem=${rem()}ms < 12000ms required`);
    }

    // ── EMBEDDING + CORRECTIONS — OPTIONAL, requires >= 9 s remaining ──
    // Both are non-critical — Stage 2 works without them, just produces a broader estimate.
    let queryEmbedding = null;
    let corrections    = clientHints.length > 0 ? clientHints : [];
    if (rem() >= 9_000) {
      const embCap  = Math.min(3_500, rem() - 8_000);
      const corrCap = Math.min(2_500, rem() - 8_000);
      plog('Embedding start', `embCap=${embCap}ms corrCap=${corrCap}ms rem=${rem()}ms`);
      [queryEmbedding, corrections] = await Promise.all([
        withTimeout(generateQueryEmbedding(embeddingText), embCap, 'query embedding')
          .catch(err => { blog(`[Embedding] SKIPPED — ${err.message}`); return null; }),
        clientHints.length > 0
          ? Promise.resolve(clientHints)
          : withTimeout(fetchCorrections(), corrCap, 'corrections').catch(() => []),
      ]);
      recognition._embedding_used = !!queryEmbedding;
      plog('Embedding end', `embedding=${!!queryEmbedding} corrections=${corrections.length} rem=${rem()}ms`);
    } else {
      plog('Embedding/Corrections SKIPPED — budget', `rem=${rem()}ms < 9000ms`);
    }

    // ── RETRIEVAL — OPTIONAL, requires >= 9 s remaining (same gate as embedding) ──
    let candidates = [];
    let retrievalStrategyLog = null;
    if (rem() >= 9_000) {
      const retrievalCap = Math.min(4_500, rem() - 8_000);
      plog('Retrieval start', `cap=${retrievalCap}ms rem=${rem()}ms`);
      const retrievalResult = await withTimeout(
        retrieveCandidates(recognition, queryEmbedding, visionData),
        retrievalCap,
        'DB retrieval'
      ).catch(err => { blog(`[Retrieval] SKIPPED — ${err.message}`); return null; });
      if (retrievalResult) {
        candidates = retrievalResult.candidates || [];
        retrievalStrategyLog = retrievalResult.strategyLog || null;
      }
      plog('Retrieval end', `${candidates.length} candidates rem=${rem()}ms`);
    } else {
      plog('Retrieval SKIPPED — budget', `rem=${rem()}ms < 9000ms`);
    }

    // ── STAGE 2: VERIFY + PRICE — REQUIRED but skippable ──
    // GW-002: budget-aware cap. The old hardcoded 9s ceiling was an Edge-era
    // leftover that killed Stage 2 with ~9s of budget still unused (Node
    // maxDuration 60 / BUDGET_MS 45 leave ample headroom). Reserve time AFTER
    // Stage 2 for calibration + normalise + GW-000 awaited persistence
    // (record_scan + derived write-back) + JSON encode + response write.
    // Stage 2 needs >= 8s of usable time; if rem() - reserve < 8s we fall back
    // rather than force an unsafe sub-8s cap. A rough result in time beats a 504.
    // SCAN-009: reserve = 4s persistence/response + 3.5s Pricing Rescue Engine.
    // If Stage 2 succeeds the PRE slice simply returns to the margin.
    const STAGE2_RESERVE_MS = 7_500;
    let stage2FallbackUsed = false;
    let stage2FallbackReason = null;
    let verification;

    // SCAN-009: Stage 2 failure → Pricing Rescue Engine (catalog → Haiku →
    // category anchor → manual). AI slice funded by STAGE2_RESERVE_MS; 4s is
    // always preserved for persistence + response write.
    const runPricingRescue = async (reason) => {
      const capMs = Math.max(0, Math.min(3_500, rem() - 4_000));
      plog('PRE start', `cap=${capMs}ms rem=${rem()}ms`);
      const quote = await pricingRescueEngine({
        recognition, candidates, identity: assessFallbackIdentity(recognition),
        failReason: reason, apiKey, capMs, lang,
      }).catch(err => { blog(`[PRE] engine error — manual pricing: ${err.message}`); return null; });
      plog('PRE end', quote ? `source=${quote.pre_source} ₪${quote.price_estimate_mid} grade=${quote.pricing_confidence} rem=${rem()}ms` : `no quote rem=${rem()}ms`);
      return buildFallback(recognition, lang, reason, candidates, quote);
    };

    if (rem() - STAGE2_RESERVE_MS < 8_000) {
      stage2FallbackUsed = true;
      stage2FallbackReason = `budget_too_low rem=${rem()}ms`;
      blog(`[Pipeline] Stage 2 SKIPPED — rescue pricing (rem=${rem()}ms, need >= ${8_000 + STAGE2_RESERVE_MS}ms)`);
      verification = await runPricingRescue(stage2FallbackReason);
    } else {
      // SCAN-008 (B-3): ceiling raised 20s → 24s. Stage 2 empirically needs
      // 18–20s (4/4 production scans); a 20s ceiling left zero headroom even
      // when the budget clock had 24s+ genuinely available. Still bounded by
      // rem() − reserve and floored at 8s — slow-Stage-1 scans are unchanged.
      const stage2Cap = Math.max(8_000, Math.min(24_000, rem() - STAGE2_RESERVE_MS));
      plog('Stage 2 start', `cap=${stage2Cap}ms rem=${rem()}ms`);
      try {
        verification = await withTimeout(
          verifyAndPrice(recognition, candidates, corrections, lang, apiKey, visionData, stage2Cap),
          stage2Cap,
          'Stage 2 verification'
        );
      } catch (err) {
        stage2FallbackUsed = true;
        stage2FallbackReason = err.message;
        blog(`[Pipeline] Stage 2 FAILED — rescue pricing: ${err.message}`);
        verification = await runPricingRescue(stage2FallbackReason);
      }
    }

    verification = calibrateVerification(verification, recognition, candidates, visionData);
    const tierInfo = getConfidenceTier(verification.match_confidence);
    plog('Stage 2 end', `${verification.full_name || verification.final_brand} ₪${verification.price_estimate_mid} conf=${round(verification.match_confidence * 100)}% tier=${tierInfo.tier} rem=${rem()}ms`);

    // ── NORMALIZE + RESPOND ──
    const result  = normalizeForUI(recognition, verification, tierInfo, !!visionData);

    // ── DB LEARNING FLAGS + PRICING FLAGS ──
    // db_match_found: were any product rows retrieved?
    // product_candidate_needed: no DB match but Stage 1 has useful recognition data
    // stage2_timeout: Stage 2 was skipped/timed out — pricing came from category fallback
    const dbMatchFound = candidates.length > 0;
    const _brand = recognition.brand_candidates?.[0]?.brand;
    const _model = recognition.model_candidates?.[0]?.model;
    const hasUsefulRecognition = !!(
      (_brand && _brand.toLowerCase() !== 'unidentified') ||
      (_model && _model.toLowerCase() !== 'unidentified') ||
      recognition.ocr_text?.has_readable_text
    );
    // ── Source-table detection ──
    // Track whether the top retrieval match came from `products` (trusted)
    // or `product_candidates` (approved learned items).  This surfaces in
    // the UI so users see "Matched from learned catalog" and in the debug
    // panel so source_table is always visible.
    const topCand = candidates[0] || null;
    const matchedFromCandidate = !!(topCand?._from_approved_candidate);
    const candidateSourceTable = matchedFromCandidate ? 'product_candidates'
      : (candidates.length > 0 ? 'products' : 'none');

    result.db_match_found          = dbMatchFound;
    result.matched_from_candidate  = matchedFromCandidate;  // true → "Learned catalog" UI
    result.candidate_source_table  = candidateSourceTable;  // 'products' | 'product_candidates' | 'none'
    result.product_candidate_needed = !dbMatchFound && hasUsefulRecognition;
    result.stage2_timeout = stage2FallbackUsed && (stage2FallbackReason || '').includes('exceeded');

    // User correction passthrough — frontend uses these for display + debug
    if (recognition._user_correction) {
      result.user_correction   = recognition._user_correction;
      result.correction_source = recognition._correction_source;
    }

    result.recognition_source = (() => {
      // When there is no DB match, always tag source as 'db_missing' so the
      // submit_product_candidate RPC receives the correct CHECK constraint value.
      if (!dbMatchFound) return 'db_missing';
      const m = verification.identification_method || 'generic_only';
      if (m === 'ocr_confirmed')                        return 'ocr_label';
      if (m === 'visual_match' || m === 'packaging_recognized') return 'visual';
      return 'ocr_label';
    })();

    // candidate_payload: pre-filled data the frontend sends to /api/submit-candidate
    if (result.product_candidate_needed) {
      let cpBrand = verification.final_brand && verification.final_brand.toLowerCase() !== 'unidentified'
        ? verification.final_brand : null;
      let cpModel = verification.final_model && verification.final_model.toLowerCase() !== 'unidentified'
        ? verification.final_model : null;

      // User correction takes priority over Stage 2 output — parse the corrected text directly
      if (recognition._user_correction) {
        const corrText = recognition._user_correction.trim();
        const spaceIdx = corrText.indexOf(' ');
        if (spaceIdx > 0) {
          cpBrand = corrText.slice(0, spaceIdx);
          cpModel = corrText.slice(spaceIdx + 1);
        } else {
          cpModel = corrText;
        }
      }

      result.candidate_payload = {
        brand:        cpBrand,
        model:        cpModel,
        name:         recognition._user_correction
                        || verification.full_name
                        || [cpBrand, cpModel].filter(Boolean).join(' ')
                        || null,
        category:     verification.final_category || recognition.category || null,
        subcategory:  recognition.subcategory || null,
        product_type: null,
        ocr_text:     (recognition.ocr_text?.raw_texts || []).join(' | ') || null,
        confidence:   recognition._user_correction ? 0.96 : verification.match_confidence,
        source:       recognition._user_correction ? 'manual_correction' : result.recognition_source,
      };
    }

    const totalMs = Date.now() - TREQ;
    blog(`[Pipeline] Response sent — total=${totalMs}ms budget_used=${round(totalMs / BUDGET_MS * 100)}%${totalMs > 16_000 ? ' ⚠ SLOW' : ''}`);

    // ── DEBUG DATA — always attached, safe to remove in prod ──
    result._debug = {
      stage1: {
        category: recognition.category,
        category_confidence: round(recognition.category_confidence),
        brand: recognition.brand_candidates?.[0]?.brand || 'none',
        brand_conf: round((recognition.brand_candidates?.[0]?.confidence || 0)),
        brand_evidence: recognition.brand_candidates?.[0]?.evidence || '',
        model: recognition.model_candidates?.[0]?.model || 'none',
        model_conf: round((recognition.model_candidates?.[0]?.confidence || 0)),
        model_evidence: recognition.model_candidates?.[0]?.evidence || '',
        model_candidates: (recognition.model_candidates || []).map(m => `${m.model}(${round(m.confidence*100)}%)`).join(', '),
        ocr: (recognition.ocr_text?.raw_texts || []).join(' | '),
        logos: (recognition.ocr_text?.logos_detected || []).join(', '),
        has_readable_text: recognition.ocr_text?.has_readable_text,
        failed: !recognition.brand_candidates?.length && !recognition.ocr_text?.has_readable_text,
        user_correction: recognition._user_correction || null,
        correction_source: recognition._correction_source || null,
      },
      retrieval: {
        db_match_found:       dbMatchFound,
        source_table:         candidateSourceTable,
        matched_from_candidate: matchedFromCandidate,
        candidates_count:     candidates.length,
        top3: candidates.slice(0, 3).map(c =>
          `${c.brand} ${c.model}(src=${c._source}${c._from_approved_candidate ? ' LEARNED' : ''} sim=${round((c.similarity||0)*100)}% ev=${c._evidence_grade ? 'evidence' : 'guess'})`
        ).join(', '),
        strategy_log:         retrievalStrategyLog,
      },
      pricing: {
        stage2_fallback_used:   stage2FallbackUsed,
        stage2_fallback_reason: stage2FallbackReason,
        stage2_timeout:         stage2FallbackUsed && (stage2FallbackReason || '').includes('exceeded'),
        pricing_status:         result.marketValue.pricing_status,
        pricing_warning:        result.marketValue.pricing_warning,
        pricing_confidence:     result.marketValue.pricing_confidence,
        pricing_reason:         result.marketValue.pricing_reason,
        pre_source:             result.marketValue.pre_source,
        fallback_key:           verification._pricing_meta?.fallback_key || null,
        price_method:           verification.price_method || 'ai_estimate',
        price_low:              verification.price_estimate_low,
        price_mid:              verification.price_estimate_mid,
        price_high:             verification.price_estimate_high,
        price_zero:             verification.price_estimate_mid === 0,
        db_candidate_used: dbMatchFound
          ? `${candidates[0]?.brand} ${candidates[0]?.model} (${candidates[0]?._source}${matchedFromCandidate ? ' · learned_candidate' : ''})`
          : 'none — db_missing',
        silent_fail: !stage2FallbackUsed && verification.price_estimate_mid === 0,
      },
      stage2: {
        final_brand: verification.final_brand,
        final_model: verification.final_model,
        final_category: verification.final_category,
        identification_method: verification.identification_method,
        brand_confidence: verification.brand_confidence,
        raw_confidence: verification.raw_match_confidence ?? verification.match_confidence,
        calibrated_confidence: verification.match_confidence,
        reasoning: verification.confidence_reasoning,
      },
      pipeline: {
        images_count: imageList.length,
        vision_used: !!visionData,
        total_ms: totalMs,
        budget_ms: BUDGET_MS,
      },
    };

    // ── GW-000: SERVER-AUTHORITATIVE PERSISTENCE ──
    // scan_uuid = whole-scan lifecycle id (client-generated; server backfills if
    // absent). valuation_id is decided HERE and returned even on failure, so the
    // client backup can upsert the SAME row idempotently (no duplicates).
    const scanUuid     = clientScanUuid || crypto.randomUUID();
    const valuationId  = crypto.randomUUID();
    result.scan_uuid          = scanUuid;
    result.valuation_id       = valuationId;
    result.valuation_version  = VALUATION_VERSION;

    // Lifecycle breadcrumb — lets any scan_uuid be reconstructed for debugging.
    await logScanEvent(supa, scanUuid, 'scan_analyzed', 'pipeline', {
      category: result.category,
      brand: verification.final_brand,
      model: verification.final_model,
      price_mid: result.marketValue?.mid,
      confidence: result.confidence,
      stage2_fallback: stage2FallbackUsed,
      vision_used: !!visionData,
      total_ms: totalMs,
    });

    // 1) CRITICAL transaction — persist the valuation and commit.
    let persisted = false;
    if (authUser?.id) {
      const valuationRow = {
        id:                valuationId,
        user_id:           authUser.id,
        scan_uuid:         scanUuid,
        valuation_version: VALUATION_VERSION,
        product_id:        candidates[0]?.id || null,
        ai_name:           result.name || 'Unknown',
        ai_name_hebrew:    result.nameHebrew || '',
        ai_category:       result.category || 'Other',
        ai_confidence:     result.confidence || 0,
        ai_raw_response:   result,
        ocr_text:          result.recognition?.ocrText || null,
        model_number:      result.recognition?.modelNumber || null,
        identified_by:     result.recognition?.identifiedBy || 'visual',
        alternatives:      result.recognition?.alternatives || [],
        price_low:         result.marketValue?.low ?? null,
        price_mid:         result.marketValue?.mid ?? null,
        price_high:        result.marketValue?.high ?? null,
        new_retail:        result.marketValue?.newRetailPrice ?? null,
        price_method:      result.marketValue?.price_method || 'ai_estimate',
        comp_count:        candidates.length,
        lang,
      };
      persisted = await recordScanWithRetry(supa, valuationRow, scanUuid);
    }
    result.persisted = persisted;

    // 2) DERIVED data — only AFTER the valuation committed; best-effort, never
    //    blocks the response or affects valuation durability.
    if (persisted) {
      await updateDerivedWithRetry(supa, recognition, verification, scanUuid).catch(() => {});
    }

    return json({ content: [{ type: 'text', text: JSON.stringify(result) }] }, 200, cors);

  } catch (error) {
    // Refund daily quota on any fatal failure so a broken scan isn't charged.
    // No-op if already refunded or never charged.
    if (quotaCharged) { await refundDailyQuota(getSupabase(), authUser?.id); quotaCharged = false; }
    console.error('[Pipeline] Fatal:', error);
    return json({ error: 'Internal server error' }, 500, cors);
  }
}


// ═══════════════════════════════════════════════════════
// NODE SERVERLESS ADAPTER
// ═══════════════════════════════════════════════════════
// Vercel's Node runtime invokes (req, res) with a Node IncomingMessage — not a
// Web Request — so req.headers.get()/req.json() don't exist and we must write to
// res instead of returning a Response. This thin adapter wraps the Node request
// into a Web-Request-like object and pipes handleRequest()'s Web Response back to
// res, so the entire handleRequest() body above stays unchanged. It also still
// works if invoked with a real Web Request (Edge), for safety.

function toWebRequest(nodeReq) {
  let _bodyPromise;
  return {
    method: nodeReq.method,
    headers: {
      get: (name) => {
        const v = nodeReq.headers[String(name).toLowerCase()];
        return Array.isArray(v) ? v.join(', ') : (v ?? null);
      },
    },
    json: () => {
      if (_bodyPromise) return _bodyPromise;       // memoize — body is read once
      _bodyPromise = (async () => {
        // Vercel may have already parsed a JSON body into nodeReq.body.
        if (nodeReq.body !== undefined && nodeReq.body !== null && nodeReq.body !== '') {
          return typeof nodeReq.body === 'string' ? JSON.parse(nodeReq.body) : nodeReq.body;
        }
        // Otherwise read the raw request stream.
        const chunks = [];
        for await (const chunk of nodeReq) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        return raw ? JSON.parse(raw) : {};
      })();
      return _bodyPromise;
    },
  };
}

async function writeWebResponse(nodeRes, webRes) {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => nodeRes.setHeader(key, value));
  const text = await webRes.text();
  nodeRes.end(text);
}

export default async function handler(req, res) {
  // Edge path (single Web Request arg, no res): return the Response directly.
  if (!res || typeof req?.headers?.get === 'function') {
    return handleRequest(req);
  }
  // Node serverless path: adapt (req, res).
  try {
    const webRes = await handleRequest(toWebRequest(req));
    await writeWebResponse(res, webRes);
  } catch (err) {
    console.error('[Handler] adapter fatal:', err?.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}


// ═══════════════════════════════════════════════════════
// §11  UTILITIES
// ═══════════════════════════════════════════════════════

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function mapMethod(m) {
  switch (m) {
    case 'ocr_confirmed':        return 'ocr';
    case 'visual_match':         return 'visual';
    case 'packaging_recognized': return 'visual';
    case 'db_match':             return 'both';
    default:                     return 'generic';
  }
}

function parseJSON(raw, stage) {
  try {
    return JSON.parse(raw.trim());
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Failed to parse ${stage} JSON response`);
  }
}

// ── Category fallback price map (ILS, used goods, Israeli market) ──────────
// Prices are ROUGH category-level estimates only. Used when Stage 2 fails.
// null → manual_required (too variable to estimate from category alone).
const FALLBACK_PRICE_MAP = {
  'electronics:iphone':         { low: 400,  mid: 1200, high: 3000 },
  'electronics:macbook':        { low: 800,  mid: 2500, high: 5000 },
  'electronics:ipad':           { low: 200,  mid: 700,  high: 2000 },
  'electronics:smartwatch':     { low: 80,   mid: 350,  high: 1200 },
  'electronics:smartphone':     { low: 150,  mid: 450,  high: 1200 },
  'electronics:cordless phone': { low: 30,   mid: 60,   high: 150  },
  'electronics:home phone':     { low: 20,   mid: 50,   high: 120  },
  'electronics:laptop':         { low: 400,  mid: 1200, high: 3000 },
  'electronics:tablet':         { low: 150,  mid: 450,  high: 1500 },
  'electronics:headphones':     { low: 50,   mid: 200,  high: 600  },
  'electronics:earbuds':        { low: 30,   mid: 150,  high: 500  },
  'electronics:gaming console': { low: 400,  mid: 900,  high: 1800 },
  'electronics:gaming mouse':   { low: 50,   mid: 150,  high: 400  },
  'electronics:keyboard':       { low: 30,   mid: 100,  high: 400  },
  'electronics:monitor':        { low: 200,  mid: 600,  high: 1500 },
  'electronics:tv':             { low: 200,  mid: 700,  high: 2500 },
  'electronics:camera':         { low: 200,  mid: 700,  high: 2500 },
  'electronics:speaker':        { low: 50,   mid: 200,  high: 800  },
  'electronics:printer':        { low: 50,   mid: 150,  high: 500  },
  'electronics:drone':          { low: 200,  mid: 600,  high: 2000 },
  'electronics':                { low: 50,   mid: 200,  high: 800  },
  'watches:luxury':             { low: 500,  mid: 2500, high: 10000 },
  'watches':                    { low: 50,   mid: 200,  high: 800  },
  'home:kitchen appliance':     { low: 50,   mid: 200,  high: 600  },
  'home:cleaning':              null,
  'home':                       { low: 30,   mid: 150,  high: 600  },
  'furniture':                  { low: 100,  mid: 500,  high: 2000 },
  'sports':                     { low: 30,   mid: 150,  high: 600  },
  'clothing':                   { low: 20,   mid: 100,  high: 400  },
  'bags':                       { low: 30,   mid: 150,  high: 600  },
  'jewelry':                    null,
  'books':                      { low: 5,    mid: 20,   high: 60   },
  'toys':                       { low: 20,   mid: 80,   high: 300  },
  'tools':                      { low: 30,   mid: 150,  high: 600  },
  'beauty':                     { low: 10,   mid: 50,   high: 200  },
  'smoking':                    { low: 20,   mid: 80,   high: 300  },
  'vehicles':                   null,
  'food':                       null,
};

// Returns { price_estimate_low, price_estimate_mid, price_estimate_high,
//           pricing_status, pricing_warning, fallback_key }
function getCategoryFallbackPricing(recognition, failReason) {
  const cat  = (recognition.category    || '').toLowerCase();
  const sub  = (recognition.subcategory || '').toLowerCase();
  const pt   = (recognition.product_type || '').toLowerCase();
  const mdl  = (recognition.model_candidates?.[0]?.model || '').toLowerCase();
  const brnd = (recognition.brand_candidates?.[0]?.brand  || '').toLowerCase();
  const ocr  = (recognition.ocr_text?.raw_texts || []).join(' ').toLowerCase();
  const sig  = `${sub} ${pt} ${mdl} ${ocr}`;

  // Ordered matchers — first match wins
  const MATCHERS = [
    ['electronics:iphone',         () => cat.includes('electron') && (brnd.includes('apple') || sig.includes('iphone'))],
    ['electronics:macbook',        () => cat.includes('electron') && sig.includes('macbook')],
    ['electronics:ipad',           () => cat.includes('electron') && sig.includes('ipad')],
    ['electronics:smartwatch',     () => cat.includes('electron') && (sig.includes('smartwatch') || /garmin|fitbit|apple watch|galaxy watch/.test(sig))],
    ['electronics:smartphone',     () => cat.includes('electron') && (sub.includes('phone') || sub.includes('mobile') || sub.includes('smartphone') || pt.includes('smartphone') || /galaxy|pixel|oneplus/.test(sig))],
    ['electronics:cordless phone', () => cat.includes('electron') && (sig.includes('cordless') || /kx-t|kx-p|dect/.test(sig) || (brnd.includes('panasonic') && sig.includes('phone')))],
    ['electronics:home phone',     () => cat.includes('electron') && (sig.includes('home phone') || sig.includes('landline') || sig.includes('telephone'))],
    ['electronics:laptop',         () => cat.includes('electron') && (sub.includes('laptop') || sub.includes('notebook') || /thinkpad|latitude|elitebook|ideapad|zenbook/.test(sig))],
    ['electronics:tablet',         () => cat.includes('electron') && (sub.includes('tablet') || pt.includes('tablet'))],
    ['electronics:headphones',     () => cat.includes('electron') && (sub.includes('headphone') || sub.includes('earphone') || /wh-|qc\d|airpods|earbuds/.test(sig))],
    ['electronics:earbuds',        () => cat.includes('electron') && (sig.includes('earbuds') || sig.includes('tws') || sig.includes('in-ear'))],
    ['electronics:gaming console', () => cat.includes('electron') && /playstation|xbox|nintendo|ps4|ps5/.test(sig)],
    ['electronics:gaming mouse',   () => cat.includes('electron') && ((sig.includes('gaming') && sig.includes('mouse')) || /g502|g pro|g305|razer deathadder|steelseries/.test(sig))],
    ['electronics:keyboard',       () => cat.includes('electron') && (sub.includes('keyboard') || pt.includes('keyboard'))],
    ['electronics:monitor',        () => cat.includes('electron') && (sub.includes('monitor') || sub.includes('display') || pt.includes('monitor'))],
    ['electronics:tv',             () => cat.includes('electron') && (sub.includes('tv') || sub.includes('television') || pt.includes('television'))],
    ['electronics:camera',         () => cat.includes('electron') && (sub.includes('camera') || /canon|nikon|sony a\d|fuji/.test(sig))],
    ['electronics:speaker',        () => cat.includes('electron') && (sub.includes('speaker') || /sonos|jbl|bose/.test(sig))],
    ['electronics:printer',        () => cat.includes('electron') && (sub.includes('printer') || pt.includes('printer'))],
    ['electronics:drone',          () => cat.includes('electron') && (sig.includes('drone') || sig.includes('dji'))],
    ['electronics',                () => cat.includes('electron')],
    ['watches:luxury',             () => (cat.includes('watch') || sub.includes('watch')) && /rolex|omega|cartier|patek|audemars|breitling|tag heuer|hublot|iwc|tudor/.test(brnd)],
    ['watches',                    () => cat.includes('watch') || sub.includes('watch')],
    ['home:cleaning',              () => (cat.includes('home') || cat.includes('clean')) && (/ajax|fairy|ariel|persil|sano/.test(brnd) || /clean|detergent|soap|bleach|disinfect/.test(sig))],
    ['home:kitchen appliance',     () => (cat.includes('home') || cat.includes('kitchen')) && /blender|mixer|toaster|coffee|espresso|microwave|oven/.test(sig)],
    ['home',                       () => cat.includes('home') || cat.includes('household')],
    ['furniture',                  () => cat.includes('furni') || cat.includes('sofa') || cat.includes('chair') || cat.includes('table')],
    ['sports',                     () => cat.includes('sport') || cat.includes('fitness') || cat.includes('outdoor')],
    ['clothing',                   () => cat.includes('cloth') || cat.includes('fashion') || cat.includes('apparel')],
    ['bags',                       () => cat.includes('bag') || sub.includes('bag') || sub.includes('backpack')],
    ['jewelry',                    () => cat.includes('jewel') || sub.includes('jewel') || /ring|necklace|bracelet/.test(sub)],
    ['books',                      () => cat.includes('book')],
    ['toys',                       () => cat.includes('toy') || (cat.includes('game') && !cat.includes('gaming'))],
    ['tools',                      () => cat.includes('tool') || cat.includes('hardware')],
    ['beauty',                     () => cat.includes('beauty') || cat.includes('cosmetic')],
    ['smoking',                    () => cat.includes('smoking') || cat.includes('tobacco') || cat.includes('vape')],
    ['vehicles',                   () => cat.includes('vehicle') || cat.includes('car') || cat.includes('motor')],
    ['food',                       () => cat.includes('food') || cat.includes('beverage')],
  ];

  let matchedKey = null;
  for (const [key, test] of MATCHERS) {
    if (test()) { matchedKey = key; break; }
  }

  const prices = matchedKey ? FALLBACK_PRICE_MAP[matchedKey] : undefined;
  const reason = failReason ? `Stage 2 failed (${failReason}). ` : '';

  if (!prices) {
    return {
      price_estimate_low:  0,
      price_estimate_mid:  0,
      price_estimate_high: 0,
      pricing_status:   'manual_required',
      pricing_warning:  `${reason}Cannot estimate price from category alone. Please enter a price manually.`,
      fallback_key:     matchedKey || cat || 'unknown',
      pricing_confidence: 'MANUAL_REQUIRED', // SCAN-008: internal pricing grade
    };
  }

  return {
    price_estimate_low:  prices.low,
    price_estimate_mid:  prices.mid,
    price_estimate_high: prices.high,
    pricing_status:   'category_fallback',
    pricing_warning:  `${reason}Rough estimate based on category "${matchedKey}". Confirm item for accurate pricing.`,
    fallback_key:     matchedKey,
    pricing_confidence: 'LOW', // SCAN-008: internal pricing grade
  };
}

// ── Shared identity assessment for the fallback path ────────────────────────
// F4 (SCAN-003): Stage 2 failing is a PRICING failure — it must not demote a
// confident Stage 1 identification into the "Possibly" tier. Identity
// confidence is derived from Stage 1 candidate evidence; the brand_confidence
// label lets calibrateVerification apply its normal caps. confirmed_by_text is
// only emitted when the model side is ALSO strong (Stage 1's hard rule means
// modelC ≥ 0.75 requires text/OCR confirmation). Used by both buildFallback
// and the Pricing Rescue Engine — identity is assessed once, priced separately.
function assessFallbackIdentity(recognition) {
  const topBrand = recognition.brand_candidates?.[0];
  const topModel = recognition.model_candidates?.[0];
  const brand = topBrand?.brand || 'unidentified';
  const model = topModel?.model || 'unidentified';
  const brandOk = brand.toLowerCase() !== 'unidentified';
  const modelOk = model.toLowerCase() !== 'unidentified';
  const brandC = topBrand?.confidence || 0;
  const modelC = topModel?.confidence || 0;
  let identityConf;
  if (brandOk && modelOk && modelC > 0) identityConf = Math.min((brandC + modelC) / 2, 0.88);
  else if (brandOk)                     identityConf = Math.min(brandC, 0.70);
  else                                  identityConf = Math.min(recognition.category_confidence, 0.45);
  const brandEvidence = (topBrand?.evidence || '').toLowerCase();
  const brandTextRead = brandC >= 0.75 && /text|ocr|label|sticker|readable/.test(brandEvidence);
  const brandConfLabel = !brandOk ? 'unidentified'
    : /packaging/.test(brandEvidence) ? 'packaging_recognized'
    : (brandTextRead && (!modelOk || modelC >= 0.75)) ? 'confirmed_by_text'
    : 'inferred_from_visuals';
  const identityHigh = identityConf >= 0.80 || brandConfLabel === 'confirmed_by_text';
  const brandHead = brandOk ? brand.toLowerCase().split(' ')[0] : '';
  return { brand, model, brandOk, modelOk, brandC, modelC, identityConf, brandConfLabel, identityHigh, brandHead };
}

// ═══════════════════════════════════════════════════════
// §6.5  PRICING RESCUE ENGINE — PRE v1 (SCAN-009)
// ═══════════════════════════════════════════════════════
// Activates ONLY when Stage 2 cannot produce a reliable price (timeout,
// provider failure, budget skip). Responsibility: PRICING ONLY — it never
// re-runs recognition/OCR/Vision/retrieval and never touches identity,
// confidence calibration, or authenticity.
//
// Architecture: ordered source chain, first quote wins. Every source receives
// the same ctx built from data already collected during the scan. Future
// sources (price_observations, listings history, eBay/marketplace feeds,
// retailer pricing) plug in by adding one function to PRE_SOURCES — no
// architectural change required.
//
// Quote shape: { price_estimate_low/mid/high, pricing_status,
//   pricing_confidence ('MEDIUM'|'LOW'|'MANUAL_REQUIRED'), pricing_reason,
//   pricing_warning, fallback_key, pre_source, _db_retail? }

// Source 1 — catalog anchor (deterministic, 0ms, rows already in memory).
// Evidence-corroborated brand-aligned rows → MEDIUM. Guess-derived rows are
// acceptable for PRICING at high similarity (sibling products price close to
// each other, unlike identity) but always graded LOW.
function preQuoteFromCatalog(ctx) {
  const { candidates, identity, failReason } = ctx;
  if (!identity.brandOk || !identity.brandHead) return null;
  const rows = (candidates || []).filter(c =>
    (c.avg_used_price_ils > 0) &&
    (c.brand || '').toLowerCase().includes(identity.brandHead));
  if (!rows.length) return null;
  rows.sort((a, b) =>
    ((b._evidence_grade === true) - (a._evidence_grade === true)) ||
    ((b.similarity || 0) - (a.similarity || 0)));
  const row = rows[0];
  if (!row._evidence_grade && (row.similarity || 0) < 0.80) return null;
  return {
    price_estimate_low:  row.price_low_ils  || Math.round(row.avg_used_price_ils * 0.75),
    price_estimate_mid:  row.avg_used_price_ils,
    price_estimate_high: row.price_high_ils || Math.round(row.avg_used_price_ils * 1.25),
    pricing_status:      'db_fallback',
    pricing_confidence:  row._evidence_grade ? 'MEDIUM' : 'LOW',
    pricing_reason:      `Catalog pricing for ${row.brand} ${row.model || row.name}${row._evidence_grade ? '' : ' (closest match, unverified)'}.`,
    pricing_warning:     `Pricing stage failed (${failReason || 'unknown'}). Using catalog pricing.`,
    fallback_key:        'db_row',
    pre_source:          'catalog',
    _db_retail:          row.retail_price_ils || 0,
  };
}

// Source 2 — AI estimator (Claude Haiku, budget-gated, ≤3.5s).
// Dedicated ~300-token pricing prompt. Sends ONLY minimal structured context —
// never the scan. Output clamped: AI rescue quotes never exceed MEDIUM.
function buildRescuePricingPrompt(ctx) {
  const { recognition, candidates, identity } = ctx;
  const condition = recognition.visual_features?.condition || 'unknown';
  const certainty = identity.identityHigh ? 'high' : identity.brandOk ? 'moderate' : 'low';
  const anchors = (candidates || [])
    .filter(c => c.avg_used_price_ils > 0)
    .slice(0, 3)
    .map(c => `- ${c.brand} ${c.model || c.name}: used avg ₪${c.avg_used_price_ils}, range ₪${c.price_low_ils ?? '?'}-${c.price_high_ils ?? '?'}, new ₪${c.retail_price_ils ?? '?'}`)
    .join('\n');
  return `You are a pricing engine for second-hand goods in ISRAEL. Estimate the current Israeli used-market price in ILS for ONE item. Respond with ONLY JSON.

ITEM:
- Product: ${identity.brandOk ? identity.brand : 'unknown brand'} ${identity.modelOk ? identity.model : ''}
- Category: ${recognition.category || 'unknown'}${recognition.subcategory ? ' / ' + recognition.subcategory : ''}
- Condition: ${condition}
- Identity certainty: ${certainty}

MARKET ANCHORS (possibly unrelated items — use only if relevant):
${anchors || '- none'}

RULES:
- Israeli second-hand market (Yad2, Facebook Marketplace IL). Electronics retail is typically 20-40% above US prices.
- Used items typically sell at 40-70% of Israeli new retail depending on condition.
- Widen the range when identity certainty is not high.
- If you do not know this exact product, price the closest equivalent and say so in "reason".

JSON: {"low":0,"mid":0,"high":0,"confidence":"MEDIUM|LOW","reason":"one short sentence"}`;
}

async function preQuoteFromAI(ctx) {
  const { apiKey, capMs, failReason } = ctx;
  if (!apiKey || !capMs || capMs < 1_800) return null; // not enough budget for a safe call
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_PRICING,
      max_tokens: 200,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildRescuePricingPrompt(ctx) }] }],
    }),
  }, 0, Math.min(capMs, 3_500));
  if (!res.ok) return null;
  const data = await res.json();
  const raw = data.content?.find(c => c.type === 'text')?.text || '';
  let q;
  try { q = parseJSON(raw, 'rescue-pricing'); } catch { return null; }
  const low = Number(q.low), mid = Number(q.mid), high = Number(q.high);
  // Sanity gates — a malformed or absurd quote is worse than manual pricing.
  if (!Number.isFinite(mid) || mid <= 0 || mid > 500_000) return null;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || low > mid || high < mid) return null;
  return {
    price_estimate_low:  Math.round(low),
    price_estimate_mid:  Math.round(mid),
    price_estimate_high: Math.round(high),
    pricing_status:      'rescue_estimate',
    pricing_confidence:  q.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW',
    pricing_reason:      String(q.reason || 'AI market estimate.').slice(0, 160),
    pricing_warning:     `Pricing stage failed (${failReason || 'unknown'}). Quick AI market estimate — verify before selling.`,
    fallback_key:        'rescue_ai',
    pre_source:          'ai_haiku',
  };
}

// Source 3 — category anchor (deterministic, 0ms). WEAK IDENTITY ONLY:
// B-15 policy stands — a confidently identified product is never priced from
// a category bucket (that is how a ₪1,100 fragrance became ₪50).
function preQuoteFromCategory(ctx) {
  if (ctx.identity.identityHigh) return null;
  const fp = getCategoryFallbackPricing(ctx.recognition, ctx.failReason);
  if (fp.pricing_status === 'manual_required') return null; // null bucket → no quote
  return { ...fp, pricing_reason: `Category-level estimate (${fp.fallback_key}).`, pre_source: 'category_anchor' };
}

function preManualQuote(ctx) {
  return {
    price_estimate_low:  0,
    price_estimate_mid:  0,
    price_estimate_high: 0,
    pricing_status:      'manual_required',
    pricing_confidence:  'MANUAL_REQUIRED',
    pricing_reason:      'No pricing evidence available.',
    pricing_warning:     `Pricing stage failed (${ctx.failReason || 'unknown'}). ${ctx.identity.identityHigh
      ? 'The product was identified confidently, but insufficient pricing evidence was available — please set the price manually.'
      : 'Please set the price manually.'}`,
    fallback_key:        ctx.identity.identityHigh ? 'identity_high_no_price_evidence' : 'no_price_evidence',
    pre_source:          'none',
  };
}

const PRE_SOURCES = [preQuoteFromCatalog, preQuoteFromAI, preQuoteFromCategory];

async function pricingRescueEngine(ctx) {
  const t0 = Date.now();
  for (const source of PRE_SOURCES) {
    try {
      const quote = await source(ctx);
      if (quote) {
        console.log(`[PRE] quote from ${quote.pre_source}: ₪${quote.price_estimate_mid} conf=${quote.pricing_confidence} ${Date.now() - t0}ms`);
        return quote;
      }
    } catch (err) {
      console.warn(`[PRE] source ${source.name} failed (continuing): ${err.message}`);
    }
  }
  console.log(`[PRE] no source produced a quote — manual pricing (${Date.now() - t0}ms)`);
  return preManualQuote(ctx);
}

function buildFallback(recognition, lang, failReason = null, candidates = [], rescueQuote = null) {
  const isHe = lang === 'he';
  const identity = assessFallbackIdentity(recognition);
  const { brand, model, brandOk, modelOk, identityConf, brandConfLabel } = identity;

  // SCAN-009: pricing comes from the Pricing Rescue Engine (caller awaits it —
  // async sources incl. the Haiku estimator). Defensive synchronous path when
  // called without a quote: deterministic sources only, same B-15 policy.
  const preCtx = { recognition, candidates, identity, failReason };
  const fp = rescueQuote
    || preQuoteFromCatalog(preCtx)
    || preQuoteFromCategory(preCtx)
    || preManualQuote(preCtx);

  return {
    final_category: recognition.category,
    final_category_hebrew: recognition.category_hebrew || '',
    final_brand: brand,
    final_model: model,
    // Never emit "Brand unidentified" as a display name — brand-only fallbacks
    // carry just the brand; composeTitles appends the subcategory descriptor.
    full_name: brandOk ? [brand, modelOk ? model : ''].filter(Boolean).join(' ') : recognition.category,
    full_name_hebrew: recognition.category_hebrew || '',
    match_confidence: identityConf,
    confidence_reasoning: isHe ? 'שלב התמחור נכשל — הערכה ראשונית בלבד' : 'Pricing stage failed — rough estimate only',
    matched_product_ids: [],
    identification_method: brandOk ? 'visual_match' : 'generic_only',
    brand_confidence: brandConfLabel,
    price_estimate_low:  fp.price_estimate_low,
    price_estimate_mid:  fp.price_estimate_mid,
    price_estimate_high: fp.price_estimate_high,
    new_retail_price_ils: fp._db_retail || 0,
    price_method: 'ai_estimate',
    _pricing_meta: fp,   // consumed by normalizeForUI
    currency: 'ILS',
    condition: recognition.visual_features?.condition || 'unknown',
    is_sellable: true,
    market_demand: 'moderate',
    selling_tips: '', israeli_market_notes: '',
    price_factors: [], comparable_items: [],
  };
}