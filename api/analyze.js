// ═══════════════════════════════════════════════════════════════════════════
// GetWorth V2 Pipeline — Vision + Retrieval + Verification
// + Phase 3: Google Vision fallback (cost-protected)
// ═══════════════════════════════════════════════════════════════════════════
//
// COST PROTECTION (Phase 3):
//   1. Vision only called when Stage 1 confidence < 60%
//   2. Image hash cache (24h TTL) — same image never costs twice
//   3. Daily hard limit (1500 calls/day) — synced with Google Quota
//   4. Rate limit per IP (5 scans/minute)
//   5. API key restricted to Cloud Vision in Google Console
//
// ═══════════════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// PHASE 3: COST PROTECTION CONSTANTS
// ═══════════════════════════════════════════════════════
const VISION_DAILY_LIMIT = 1500;             // Hard cap per day across all users
const VISION_RATE_PER_MIN = 5;               // Per-IP scan rate limit
const VISION_CACHE_TTL_HOURS = 24;           // Re-use Vision result for same image
const VISION_TRIGGER_THRESHOLD = 0.60;       // Only call Vision when Stage 1 confidence is below this

// ═══════════════════════════════════════════════════════
// AUTHENTICITY — high-risk brands / categories
// ═══════════════════════════════════════════════════════
const AUTHENTICITY_HIGH_RISK_BRANDS = /\b(rolex|omega|cartier|audemars piguet|ap royal oak|patek philippe|richard mille|jaeger|iwc|breitling|tag heuer|hublot|chanel|louis vuitton|lv|gucci|prada|hermes|herm[eè]s|dior|versace|burberry|balenciaga|off-white|supreme|yeezy|bape|comme des gar[cç]ons|cdg|givenchy|bottega veneta|celine|saint laurent|ysl|goyard|rimowa|tiffany|van cleef|bulgari|chopard|a. lange|lange|montblanc|tudor|zenith|girard-perregaux|jordan|travis scott|fragment|nike sb|nike dunk|adidas yeezy|air jordan|limited edition collab)\b/i;
const AUTHENTICITY_HIGH_RISK_CATEGORIES = new Set(['watches', 'jewelry', 'bags', 'handbags', 'perfumes', 'collectibles', 'sneakers', 'clothing', 'accessories']);

// ═══════════════════════════════════════════════════════
// RETRY HELPER
// ═══════════════════════════════════════════════════════

async function fetchWithRetry(url, options, maxRetries = 3) {
  const delays = [1000, 2500, 5000];
  let lastResponse, lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      console.log(`[Pipeline] Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      lastResponse = await fetch(url, options);
      if (lastResponse.ok) return lastResponse;
      if ([529, 500, 502, 503].includes(lastResponse.status)) {
        lastError = await lastResponse.json().catch(() => ({}));
        console.warn(`[Pipeline] Attempt ${attempt + 1} got ${lastResponse.status}:`, lastError.error?.message || '');
        if (attempt < maxRetries) continue;
      } else {
        return lastResponse;
      }
    } catch (err) {
      lastError = { error: { message: err.message } };
      console.warn(`[Pipeline] Attempt ${attempt + 1} network error:`, err.message);
      if (attempt < maxRetries) continue;
    }
  }
  console.error('[Pipeline] All retries exhausted:', lastError);
  return new Response(JSON.stringify({
    error: 'Service temporarily overloaded. Please try again.',
    retryable: true,
  }), { status: 503, headers: { 'Content-Type': 'application/json' } });
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
    comparable_items:      { type: 'array', items: { type: 'object' } },
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
- Top model: ${recognition.model_candidates?.[0]?.model || 'unidentified'} (${Math.round((recognition.model_candidates?.[0]?.confidence || 0) * 100)}%)
- OCR text: ${recognition.ocr_text?.raw_texts?.join(', ') || 'none'}
- Logos: ${recognition.ocr_text?.logos_detected?.join(', ') || 'none'}
- Brand evidence: ${recognition.brand_candidates?.[0]?.evidence || 'none'}${recognition.brand_candidates?.[0]?.evidence?.includes('packaging') ? ' (RETAIL PACKAGING DETECTED — identify the product inside the box)' : ''}
- Condition: ${recognition.visual_features?.condition || 'unknown'}
- Materials: ${recognition.visual_features?.materials?.join(', ') || 'unknown'}
- Colors: ${recognition.visual_features?.colors?.join(', ') || 'unknown'}
${candidateBlock}
${visionBlock}
${correctionBlock}

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
  "comparable_items": [{"name":"Similar Item","price":400,"source":"Yad2"}],
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

async function recognize(images, language, apiKey) {
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

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
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
  const data = new TextEncoder().encode(base64.slice(0, 4096));
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

async function checkRateLimit(supa, ip) {
  if (!supa || !ip) return true;

  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();

  try {
    const { count } = await supa
      .from('scan_rate_log')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', oneMinAgo);

    if ((count || 0) >= VISION_RATE_PER_MIN) {
      console.warn(`[RateLimit] IP ${ip} exceeded ${VISION_RATE_PER_MIN}/min`);
      return false;
    }

    supa.from('scan_rate_log').insert({ ip, created_at: new Date().toISOString() }).then(() => {}).catch(() => {});
    return true;
  } catch (err) {
    console.warn('[RateLimit] Check failed (allowing):', err.message);
    return true;
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

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function retrieveCandidates(recognition, queryEmbedding, visionData = null) {
  const supa = getSupabase();
  if (!supa) return [];

  const topBrand = recognition.brand_candidates?.[0]?.brand;
  const topModel = recognition.model_candidates?.[0]?.model;
  const category = recognition.category;

  let vectorResults = [];
  let textResults = [];
  let ocrResults = [];

  // ── Strategy 1: Vector search ──
  if (queryEmbedding) {
    try {
      const { data, error } = await supa.rpc('match_products', {
        query_embedding: queryEmbedding,
        similarity_threshold: 0.60,
        match_limit: 10,
      });
      if (!error && data) {
        vectorResults = data.map((r) => ({ ...r, _source: 'vector', similarity: r.similarity }));
      }
    } catch (err) {
      console.warn('[Retrieve] Vector search failed:', err.message);
    }
  }

  // ── Strategy 2: Text search ──
  try {
    if (topBrand && topBrand.toLowerCase() !== 'unidentified') {
      let q = supa.from('products').select('*').ilike('brand', `%${topBrand}%`);
      if (topModel && topModel.toLowerCase() !== 'unidentified') {
        q = q.ilike('model', `%${topModel}%`);
      }
      const { data: exact } = await q.limit(5);
      if (exact?.length) {
        textResults.push(...exact.map((r) => ({ ...r, _source: 'text_exact', similarity: 0.85 })));
      }
    }

    const searchTerms = [topBrand, topModel, category].filter(Boolean).join(' ');
    if (searchTerms.trim()) {
      const { data: fts } = await supa
        .from('products')
        .select('*')
        .textSearch('name', searchTerms, { type: 'websearch' })
        .limit(5);
      if (fts?.length) {
        textResults.push(...fts.map((r) => ({ ...r, _source: 'text_fts', similarity: 0.70 })));
      }
    }

    if (textResults.length === 0 && vectorResults.length === 0 && category) {
      const { data: catFallback } = await supa
        .from('products')
        .select('*')
        .ilike('category', `%${category}%`)
        .order('popularity_score', { ascending: false })
        .limit(5);
      if (catFallback?.length) {
        textResults.push(...catFallback.map((r) => ({ ...r, _source: 'category_fallback', similarity: 0.40 })));
      }
    }
  } catch (err) {
    console.warn('[Retrieve] Text search failed:', err.message);
  }

  // ── Strategy 3: OCR keyword match (Phase 2 + Phase 3 Vision enrichment) ──
  try {
    const ocrTexts = recognition.ocr_text?.raw_texts || [];
    const modelCandidates = recognition.model_candidates?.map(m => m.model) || [];

    // Phase 3: enrich keywords with Google Vision findings
    const visionText = visionData?.text || [];
    const visionLogos = (visionData?.logos || []).map(l => l.description);
    const visionLabels = (visionData?.labels || []).map(l => l.description);

    const keywords = [
      ...ocrTexts.flatMap(t => t.toLowerCase().split(/[\s,;|]+/).filter(w => w.length >= 2)),
      ...modelCandidates.map(m => m.toLowerCase()),
      ...(topBrand && topBrand.toLowerCase() !== 'unidentified' ? [topBrand.toLowerCase()] : []),
      ...visionText.flatMap(t => t.toLowerCase().split(/[\s,;|]+/).filter(w => w.length >= 2)),
      ...visionLogos.map(l => l.toLowerCase()),
      ...visionLabels.slice(0, 3).map(l => l.toLowerCase()),
    ].filter(Boolean);

    if (keywords.length > 0) {
      const uniqueKeywords = [...new Set(keywords)].slice(0, 25);
      const { data, error } = await supa.rpc('match_products_by_ocr', {
        p_keywords: uniqueKeywords,
        p_limit: 5,
      });
      if (!error && data?.length) {
        ocrResults = data.map((r) => ({
          ...r,
          _source: 'ocr_' + r.match_type,
          similarity: r.match_type === 'model_number' ? 0.92
                    : r.match_type === 'ocr_keyword' ? 0.80
                    : 0.75,
        }));
        console.log(`[Retrieve] OCR matched ${ocrResults.length} products (keywords: ${uniqueKeywords.slice(0, 5).join(', ')})`);
      }
    }
  } catch (err) {
    console.warn('[Retrieve] OCR keyword search failed:', err.message);
  }

  // ── Merge + deduplicate ──
  const seen = new Set();
  const merged = [];

  for (const r of [...ocrResults, ...vectorResults, ...textResults]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      const weight = r.confidence_weight ?? 1.0;
      merged.push({ ...r, similarity: Math.min((r.similarity || 0) * weight, 1.0) });
    }
  }

  merged.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  return merged.slice(0, 10);
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

async function verifyAndPrice(recognition, candidates, corrections, language, apiKey, visionData = null) {
  const prompt = buildVerificationPrompt(recognition, candidates, corrections, language, visionData);

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }),
  });

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
  if (dbMatches.length > 0 && (method === 'db_match' || brandConf === 'db_matched')) conf = Math.min(conf + 0.10, 0.90);
  if (isPackaging && dbMatches.length > 0) conf = Math.min(conf + 0.10, 0.85);
  if (brandConf === 'confirmed_by_text' && model.toLowerCase() !== 'unidentified') conf = Math.max(conf, 0.80);

  // RULE 6 (Phase 2): OCR keyword match boost
  const ocrMatch = dbMatches.find(m => m._source?.startsWith('ocr_'));
  if (ocrMatch && brand.toLowerCase() !== 'unidentified' && brandConf !== 'unidentified') {
    if (ocrMatch._source === 'ocr_model_number') {
      conf = Math.max(conf, 0.82);
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

async function writeBack(recognition, verification, embedding) {
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
      productId = existing.id;
      const updates = {
        popularity_score: (existing.popularity_score || 0) + 1,
        avg_used_price_ils: verification.price_estimate_mid,
        price_updated_at: new Date().toISOString(),
        scan_count: (existing.scan_count || 0) + 1,
        last_scanned_at: new Date().toISOString(),
      };
      if (embedding) updates.text_embedding = embedding;
      await supa.from('products').update(updates).eq('id', existing.id);
    } else {
      const row = {
        name: verification.full_name || `${brand} ${model}`.trim(),
        name_hebrew: verification.full_name_hebrew || null,
        brand,
        model: model !== 'unidentified' ? model : null,
        category: verification.final_category,
        retail_price_ils: verification.new_retail_price_ils || null,
        avg_used_price_ils: verification.price_estimate_mid || null,
        price_source: 'getworth_scan',
        price_updated_at: new Date().toISOString(),
        keywords: [
          ...(recognition.ocr_text?.raw_texts || []),
          recognition.category,
          recognition.subcategory,
        ].filter(Boolean),
        popularity_score: 1,
      };
      if (embedding) row.text_embedding = embedding;
      const { data: inserted } = await supa.from('products').insert(row).select('id').maybeSingle();
      productId = inserted?.id;
    }

    if (productId && verification.price_estimate_mid > 0) {
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


function normalizeForUI(recognition, verification, tierInfo, visionUsed = false) {
  const ocr = recognition.ocr_text || {};
  const auth = assessAuthenticity(recognition, verification);

  // Price multiplier — replica tier takes precedence over status
  const priceMultiplier =
    (auth.authenticityStatus === 'suspected_fake' || auth.replicaTier === 'low_quality_fake') ? 0.07
    : (auth.authenticityStatus === 'possible_replica' || auth.replicaTier === 'mid_replica') ? 0.15
    : auth.replicaTier === 'high_end_replica' ? 0.28
    : 1.0;

  return {
    name: verification.full_name || (verification.final_brand !== 'unidentified'
      ? `${verification.final_brand} ${verification.final_model}`.trim()
      : recognition.category),
    nameHebrew: verification.full_name_hebrew || recognition.category_hebrew || '',
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
      alternatives: [],
    },
    identification: {
      generic_name: recognition.category,
      generic_name_hebrew: recognition.category_hebrew || '',
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
    comparable_items: verification.comparable_items || [],
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
      model: 'claude-haiku-4-5-20251001',
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

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'API key not configured' }, 500, cors);

  try {
    const { imageData, images: imagesArr, lang = 'he', hints = [], corrections: clientCorrections = [], serialOCR = false } = await req.json();
    const clientHints = clientCorrections.length > 0 ? clientCorrections : hints;
    const imageList = imagesArr?.length > 0 ? imagesArr : imageData ? [imageData] : [];
    if (!imageList.length) return json({ error: 'No image data provided' }, 400, cors);

    // ── SERIAL OCR EARLY EXIT — skip full pipeline ──
    if (serialOCR) {
      const ocrText = await ocrSerialLabel(imageList[0], apiKey);
      return json({ ocrText, raw_texts: [ocrText] }, 200, cors);
    }

    // ── PHASE 3: RATE LIMITING ──
    const supa = getSupabase();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || req.headers.get('x-real-ip')
            || 'unknown';

    const rateOk = await checkRateLimit(supa, ip);
    if (!rateOk) {
      return json({
        error: 'Too many scans. Please wait a moment and try again.',
        retryable: true,
        rateLimited: true,
      }, 429, cors);
    }

    const t0 = Date.now();

    // ── STAGE 1: RECOGNIZE ──
    let recognition;
    try {
      recognition = await recognize(imageList, lang, apiKey);
      recognition = calibrateRecognition(recognition);
    } catch (stage1Err) {
      console.error('[Pipeline] Stage 1 failed:', stage1Err.message);
      recognition = {
        category: 'Other', category_hebrew: 'אחר', category_confidence: 0.20,
        brand_candidates: [], model_candidates: [],
        ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
        visual_features: {}, subcategory: '', embedding_text: '',
      };
    }

    const t1 = Date.now();
    console.log(`[Pipeline] Stage 1 done in ${t1 - t0}ms — ${recognition.brand_candidates?.[0]?.brand || 'no brand'} (${round(recognition.category_confidence * 100)}%)`);

    // ── PHASE 3: VISION FALLBACK (only if Stage 1 confidence is low) ──
    let visionData = null;
    if (recognition.category_confidence < VISION_TRIGGER_THRESHOLD) {
      console.log(`[Pipeline] Stage 1 confidence ${round(recognition.category_confidence * 100)}% < ${VISION_TRIGGER_THRESHOLD * 100}% → triggering Vision fallback`);
      visionData = await fallbackVision(imageList[0], supa);
    } else {
      console.log(`[Pipeline] Stage 1 confidence sufficient (${round(recognition.category_confidence * 100)}%) — skipping Vision fallback`);
    }

    const t1b = Date.now();
    if (visionData) console.log(`[Pipeline] Vision fallback done in ${t1b - t1}ms`);

    // ── GENERATE EMBEDDING + FETCH CORRECTIONS (parallel) ──
    const embeddingText = recognition.embedding_text
      || [recognition.brand_candidates?.[0]?.brand, recognition.model_candidates?.[0]?.model, recognition.category, ...(recognition.visual_features?.materials || [])].filter(Boolean).join(' ');

    const [queryEmbedding, corrections] = await Promise.all([
      generateQueryEmbedding(embeddingText),
      clientHints.length > 0 ? Promise.resolve(clientHints) : fetchCorrections().catch(() => []),
    ]);
    recognition._embedding_used = !!queryEmbedding;

    const t2 = Date.now();
    if (queryEmbedding) console.log(`[Pipeline] Embedding + corrections fetched in ${t2 - t1b}ms`);

    // ── RETRIEVE CANDIDATES (Phase 3: Vision-enriched) ──
    const candidates = await retrieveCandidates(recognition, queryEmbedding, visionData);

    const t3 = Date.now();
    console.log(`[Pipeline] Retrieved ${candidates.length} candidates in ${t3 - t2}ms`);

    // ── STAGE 2: VERIFY + PRICE (Phase 3: Vision data injected) ──
    let verification;
    try {
      verification = await verifyAndPrice(recognition, candidates, corrections, lang, apiKey, visionData);
    } catch (err) {
      console.error('[Pipeline] Stage 2 failed:', err.message);
      verification = buildFallback(recognition, lang);
    }

    verification = calibrateVerification(verification, recognition, candidates, visionData);
    const tierInfo = getConfidenceTier(verification.match_confidence);

    const t4 = Date.now();
    console.log(`[Pipeline] Stage 2 done in ${t4 - t3}ms — ${verification.full_name || verification.final_brand} ₪${verification.price_estimate_mid} (${round(verification.match_confidence * 100)}% ${tierInfo.tier})`);
    console.log(`[Pipeline] Total: ${t4 - t0}ms ${visionData ? '(with Vision)' : ''}`);

    // ── WRITE-BACK (non-blocking) ──
    const writeBackAsync = async () => {
      const docEmbedding = queryEmbedding
        ? await generateEmbedding(embeddingText).catch(() => null)
        : null;
      await writeBack(recognition, verification, docEmbedding);
    };
    writeBackAsync().catch((e) => console.warn('[WriteBack]', e.message));

    // ── NORMALIZE + RESPOND ──
    const result = normalizeForUI(recognition, verification, tierInfo, !!visionData);

    return json({ content: [{ type: 'text', text: JSON.stringify(result) }] }, 200, cors);

  } catch (error) {
    console.error('[Pipeline] Fatal:', error);
    return json({ error: 'Internal server error' }, 500, cors);
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

function buildFallback(recognition, lang) {
  const isHe = lang === 'he';
  const brand = recognition.brand_candidates?.[0]?.brand || 'unidentified';
  const model = recognition.model_candidates?.[0]?.model || 'unidentified';
  return {
    final_category: recognition.category,
    final_category_hebrew: recognition.category_hebrew || '',
    final_brand: brand,
    final_model: model,
    full_name: brand !== 'unidentified' ? `${brand} ${model}`.trim() : recognition.category,
    full_name_hebrew: recognition.category_hebrew || '',
    match_confidence: Math.min(recognition.category_confidence, 0.45),
    confidence_reasoning: isHe ? 'שלב התמחור נכשל — הערכה ראשונית בלבד' : 'Pricing stage failed — rough estimate only',
    matched_product_ids: [],
    identification_method: brand !== 'unidentified' ? 'visual_match' : 'generic_only',
    brand_confidence: 'unidentified',
    price_estimate_low: 0, price_estimate_mid: 0, price_estimate_high: 0,
    new_retail_price_ils: 0,
    price_method: 'ai_estimate',
    currency: 'ILS',
    condition: recognition.visual_features?.condition || 'unknown',
    is_sellable: true,
    market_demand: 'moderate',
    selling_tips: '', israeli_market_notes: '',
    price_factors: [], comparable_items: [],
  };
}