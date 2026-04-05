// ═══════════════════════════════════════════════════════════════════════════
// GetWorth V2 Pipeline — Vision + Retrieval + Verification
// ═══════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE:
//
//   ┌─────────────┐     ┌──────────────┐     ┌────────────────┐
//   │   IMAGE(S)   │────▶│  STAGE 1:    │────▶│  EMBEDDING     │
//   │  (base64)    │     │  RECOGNIZE   │     │  GENERATION    │
//   └─────────────┘     │  Claude      │     │  (Voyage AI)   │
//                       │  Sonnet      │     └───────┬────────┘
//                       └──────┬───────┘             │
//                              │                     │
//                     Recognition Result      text + image
//                     (OCR, brand, model,      embeddings
//                      visual features)              │
//                              │                     ▼
//                              │            ┌────────────────┐
//                     ┌────────▼───────┐    │  SUPABASE      │
//                     │  CONFIDENCE    │    │  VECTOR SEARCH │
//                     │  GATE          │    │  (pgvector)    │
//                     │  calibrate()   │    └───────┬────────┘
//                     └────────┬───────┘            │
//                              │              Top K candidates
//                              │            with price data
//                              │                    │
//                              ▼                    ▼
//                     ┌─────────────────────────────────────┐
//                     │         STAGE 2: VERIFY + PRICE     │
//                     │         Claude Sonnet                │
//                     │                                      │
//                     │  Inputs:                              │
//                     │  • Recognition result                 │
//                     │  • DB candidates + real prices        │
//                     │  • Past user corrections              │
//                     │  • Israeli market context             │
//                     │                                      │
//                     │  Output:                              │
//                     │  • Verified identity                  │
//                     │  • Price range (ILS)                  │
//                     │  • Confidence (calibrated)            │
//                     │  • Price method (comp/ai)             │
//                     └──────────┬──────────────────────────┘
//                                │
//                                ▼
//                     ┌─────────────────────┐
//                     │  NORMALIZE + TIER   │
//                     │  Map to UI format   │
//                     │  Set confidence     │
//                     │  tier behavior      │
//                     └──────────┬──────────┘
//                                │
//                                ▼
//                     ┌─────────────────────┐
//                     │  WRITE-BACK         │
//                     │  Auto-learn:        │
//                     │  • Upsert product   │
//                     │  • Store embedding  │
//                     │  • Price observation │
//                     └─────────────────────┘
//
// CONFIDENCE TIERS → UI BEHAVIOR:
//   ≥80%  →  Green bar, show result normally
//   60-79 →  Amber bar, "Is this correct?" prompt
//   40-59 →  Orange bar, request another photo or brand input
//   <40   →  Red bar, broad "rough estimate", auto-open help modal
//
// ═══════════════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════
// RETRY HELPER — exponential backoff for 529/500/502/503
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
        return lastResponse; // Non-retryable
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
    category:            { type: 'string', description: 'Primary item category' },
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
          evidence:   { type: 'string', description: 'How brand was identified: readable_text | logo_match | design_pattern | packaging' },
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
        raw_texts:         { type: 'array', items: { type: 'string' }, description: 'Every piece of text found on the item' },
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
    embedding_text: { type: 'string', description: 'Concatenated text for embedding generation: brand + model + category + features' },
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
    price_factors:         { type: 'array', items: { type: 'object', properties: { factor: { type: 'string' }, impact: { type: 'string' } } } },
    comparable_items:      { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' }, source: { type: 'string' } } } },
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
   - Key indicators: clean studio-quality product render, cardboard/glossy box edges visible, retail shelf-ready appearance, cellophane wrap, barcode/label areas
   - If YES → identify the PRODUCT INSIDE the box, not "a box"
   - Common packaging you MUST recognize by visual design alone:
     • Apple products: Minimalist white/dark box with centered product silhouette = iPhone/iPad/MacBook/AirPods (infer generation from device shape: camera layout, bezels, notch vs Dynamic Island)
     • Samsung Galaxy: Device photo on dark gradient = Galaxy phone/tablet/watch
     • Sony PlayStation: Blue/white angular box = PS5/PS4 console or controller
     • Nintendo Switch: Red/white box with product shot
     • Dyson: Purple/grey clean box = vacuum/hair tool
   - For packaging: set brand_confidence evidence to "packaging_design" and confidence 0.60-0.80 (you're sure it's the brand but may be uncertain about exact model)
   - IMPORTANT: Even a partial/corner view of iconic packaging is enough if the design language is unmistakable (e.g., corner of iPhone box with titanium phone silhouette = iPhone 15 Pro or 16 Pro)
   - If you can see the product marketing image but NO text → still identify the product, set evidence to "packaging_visual"
   - suggested_followup: "Photograph the back of the box or the label for exact model confirmation"

1. OCR SCAN — Read every piece of visible text:
   - Brand names (printed, embossed, engraved, stamped, on tags/labels)
   - Model numbers, serial numbers, part numbers
   - Any Hebrew text (תוויות, מדבקות, כיתוב)
   - Packaging text, stickers, receipts visible
   - Report EXACT text as-is. If partially visible, report what you can read + "[partial]"

2. VISUAL ATTRIBUTES — Describe what you see:
   - Materials (metal, plastic, glass, wood, leather, fabric, ceramic, etc.)
   - Colors and finish (matte, glossy, brushed, polished)
   - Shape, proportions, approximate dimensions
   - Distinctive design elements (patterns, textures, hardware, knobs, buttons)
   - Wear indicators (scratches, patina, fading, stains, dents, cracks)

3. BRAND CANDIDATES — List possible brands (max 5):
   - If text/logo CLEARLY confirms brand → confidence 0.85-1.0 + evidence "readable_text"
   - If visual design STRONGLY suggests brand → confidence 0.50-0.84 + evidence "logo_match" or "design_pattern"
   - If guessing from category/style → confidence 0.20-0.49 + evidence "style_inference"
   - If unknown → empty array
   - NEVER fabricate brand text that isn't visible

4. MODEL CANDIDATES — List possible models (max 5):
   - Same rules as brand. Only report what you can cite evidence for.

5. CATEGORY — Classify the item (one of: Electronics, Furniture, Vehicles, Watches, Clothing, Sports, Smoking, Home, Beauty, Books, Toys, Tools, Food, Other)

6. CONDITION — Assess from visual evidence only (New, Like New, Good, Fair, Poor)

7. EMBEDDING TEXT — Produce a single string that captures the item's identity for vector search:
   Format: "[brand] [model] [category] [subcategory] [material] [color] [distinctive features]"
   Example: "Amy Deluxe hookah smoking stainless steel silver ornate engravings wide base"

CONFIDENCE RULES:
- 0.90-1.00: Brand AND model text clearly readable
- 0.75-0.89: Brand text readable OR logo confirmed, model inferred
- 0.65-0.79: Product packaging recognized by visual design (no readable text required if design is iconic/unmistakable)
- 0.50-0.64: Visual match only, no confirming text, non-iconic design
- 0.30-0.49: Generic category, no brand clues
- 0.10-0.29: Uncertain even about category
- NEVER output 0.90+ without citing specific readable text
- Packaging with recognizable design language should be 0.65-0.79 even without text

Language: ${language === 'he' ? 'Include Hebrew names where relevant' : 'English only'}

Respond ONLY with valid JSON matching this structure (no markdown, no backticks):
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


function buildVerificationPrompt(recognition, candidates, corrections, language = 'he') {
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

  return `You are a product verification and Israeli market pricing expert.
You are the second stage of a pipeline. Stage 1 extracted visual attributes. Your job is to:
1) Verify the identity using Stage 1 data + database matches
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
${correctionBlock}

VERIFICATION RULES:
- If a DB candidate matches with >70% similarity AND brand/model aligns with Stage 1 → use its pricing → price_method = "comp_based"
- If DB candidates exist but weak match → use as loose anchor, widen range → price_method = "ai_estimate"
- If no DB match → pure AI estimate → flag clearly → price_method = "ai_estimate"
- If Stage 1 and DB disagree on brand → prefer OCR text evidence over everything
- If brand evidence is "packaging_design" or "packaging_visual" → the item is in retail packaging. Identify the product inside. Set identification_method = "packaging_recognized" and brand_confidence = "packaging_recognized". Price should reflect NEW/SEALED condition since it's in a box.
- NEVER exceed 95% final confidence
- NEVER fabricate a brand that wasn't found in OCR or DB

ISRAELI MARKET PRICING RULES:
- All prices in Israeli New Shekel (₪)
- Electronics typically 20-40% more than US retail
- Import taxes, VAT (17%), and availability factor in
- Used items: 40-70% of new Israeli retail depending on condition
  New/Like New: 70-85% | Good: 50-65% | Fair: 35-50% | Poor: 20-35%
- Price sources to consider: KSP, Zap, Yad2, Facebook Marketplace IL
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
  "comparable_items": [{"name":"Similar Item","price":400,"source":"Yad2"}]
}`;
}


// ═══════════════════════════════════════════════════════
// §3  STAGE 1 — RECOGNITION (Claude Vision)
// ═══════════════════════════════════════════════════════

/**
 * Send image(s) to Claude Sonnet for forensic visual extraction.
 * Returns structured recognition data with brand/model candidates.
 *
 * @param {string[]}  images   Base64-encoded JPEG images (1-3)
 * @param {string}    language 'he' or 'en'
 * @param {string}    apiKey   Anthropic API key
 * @returns {object}  RecognitionOutput matching RECOGNITION_SCHEMA
 */
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
// §4  EMBEDDING GENERATION
// ═══════════════════════════════════════════════════════

/**
 * Generate text embedding using Voyage AI (voyage-3) via their API.
 * Voyage is recommended by Anthropic for use with Claude.
 *
 * If VOYAGE_API_KEY is not set, falls back to a simple text-based
 * Supabase lookup (no vector search). This lets the pipeline work
 * without embeddings during early development.
 *
 * @param {string} text  The embedding_text from recognition
 * @returns {number[]|null} 1024-dim embedding vector, or null if unavailable
 */
async function generateEmbedding(text) {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) {
    // No embedding provider — return null, fall back to text search
    return null;
  }

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

    if (!res.ok) {
      console.warn(`[Embedding] Voyage API ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn('[Embedding] Generation failed:', err.message);
    return null;
  }
}

/**
 * Generate embedding optimized for search queries (shorter input).
 */
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

/**
 * Three-strategy retrieval:
 * 1) Vector search using embedding (if available)
 * 2) Text-based fallback using brand/model/category ILIKE + full-text search
 * 3) OCR keyword match using match_products_by_ocr RPC (Phase 2)
 *
 * Returns merged, deduplicated candidates sorted by relevance.
 */
async function retrieveCandidates(recognition, queryEmbedding) {
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

  // ── Strategy 2: Text search (always runs as supplement) ──
  try {
    // 2a. Exact brand + model
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

    // 2b. Full-text search on name
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

    // 2c. Category fallback (for price anchoring even without brand)
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

  // ── Strategy 3: OCR keyword match (Phase 2 — uses product intelligence columns) ──
  try {
    const ocrTexts = recognition.ocr_text?.raw_texts || [];
    const modelCandidates = recognition.model_candidates?.map(m => m.model) || [];
    // Build keyword array: lowercase OCR fragments + model numbers + brand
    const keywords = [
      ...ocrTexts.flatMap(t => t.toLowerCase().split(/[\s,;|]+/).filter(w => w.length >= 2)),
      ...modelCandidates.map(m => m.toLowerCase()),
      ...(topBrand && topBrand.toLowerCase() !== 'unidentified' ? [topBrand.toLowerCase()] : []),
    ].filter(Boolean);

    if (keywords.length > 0) {
      // Deduplicate and limit
      const uniqueKeywords = [...new Set(keywords)].slice(0, 20);
      const { data, error } = await supa.rpc('match_products_by_ocr', {
        p_keywords: uniqueKeywords,
        p_limit: 5,
      });
      if (!error && data?.length) {
        ocrResults = data.map((r) => ({
          ...r,
          _source: 'ocr_' + r.match_type,
          // OCR matches are high-trust: model_number match is strongest signal
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

  // ── Merge + deduplicate (OCR matches first, then vector, then text) ──
  const seen = new Set();
  const merged = [];

  for (const r of [...ocrResults, ...vectorResults, ...textResults]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      // Apply confidence_weight from product intelligence (Phase 2)
      const weight = r.confidence_weight ?? 1.0;
      merged.push({ ...r, similarity: Math.min((r.similarity || 0) * weight, 1.0) });
    }
  }

  // Sort by weighted similarity descending
  merged.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

  return merged.slice(0, 10);
}

/**
 * Fetch past user corrections from the misidentifications table.
 */
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
// §6  STAGE 2 — VERIFICATION + PRICING (Claude)
// ═══════════════════════════════════════════════════════

/**
 * Call Claude Sonnet with recognition data + DB candidates for final verdict.
 */
async function verifyAndPrice(recognition, candidates, corrections, language, apiKey) {
  const prompt = buildVerificationPrompt(recognition, candidates, corrections, language);

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

/**
 * Hard-coded rules that override model self-reported confidence.
 * The model can be overconfident — these rules enforce honesty.
 */
function calibrateRecognition(recognition) {
  let conf = recognition.category_confidence ?? 0.5;
  const topBrand = recognition.brand_candidates?.[0];
  const topModel = recognition.model_candidates?.[0];
  const ocr = recognition.ocr_text || {};
  const isPackaging = topBrand?.evidence === 'packaging_design' || topBrand?.evidence === 'packaging_visual';

  // RULE 1: No brand candidates → cap at 55%
  if (!recognition.brand_candidates?.length) conf = Math.min(conf, 0.55);

  // RULE 2: Top brand low confidence → cap at 65%
  if (topBrand && topBrand.confidence < 0.50) conf = Math.min(conf, 0.65);

  // RULE 3: No readable text → reduce by 15% UNLESS packaging was recognized
  // Packaging detection bypasses the OCR penalty because iconic box designs are reliable
  if (!ocr.has_readable_text && !ocr.raw_texts?.length && !isPackaging) {
    conf = Math.max(conf - 0.15, 0.10);
  }

  // RULE 3b: Packaging recognized → floor at 60%, allow up to 79%
  if (isPackaging && topBrand?.confidence >= 0.60) {
    conf = Math.max(conf, 0.60);
    conf = Math.min(conf, 0.79); // Cap below text-confirmed tier
  }

  // RULE 4: Brand + model both high confidence → floor at 80%
  if (topBrand?.confidence >= 0.85 && topModel?.confidence >= 0.75) conf = Math.max(conf, 0.80);

  // RULE 5: Hard ceiling 95%, floor 10%
  conf = Math.min(Math.max(conf, 0.10), 0.95);

  return { ...recognition, raw_category_confidence: recognition.category_confidence, category_confidence: round(conf), confidence_calibrated: true };
}

function calibrateVerification(verification, recognition, dbMatches) {
  let conf = verification.match_confidence ?? 0.5;
  const brand = verification.final_brand || '';
  const model = verification.final_model || '';
  const brandConf = verification.brand_confidence || 'unidentified';
  const method = verification.identification_method || 'generic_only';
  const isPackaging = brandConf === 'packaging_recognized' || method === 'packaging_recognized';

  // RULE 1: Brand unidentified → cap 60%
  if (brand.toLowerCase() === 'unidentified' || brandConf === 'unidentified') conf = Math.min(conf, 0.60);

  // RULE 2: Visual inference only → cap 75%
  if (brandConf === 'inferred_from_visuals') conf = Math.min(conf, 0.75);

  // RULE 2b: Packaging recognized → allow up to 79% (stronger than generic visual, weaker than text)
  if (isPackaging && brand.toLowerCase() !== 'unidentified') {
    conf = Math.max(conf, 0.60);
    conf = Math.min(conf, 0.79);
  }

  // RULE 3: Generic-only → cap 50%
  if (method === 'generic_only') conf = Math.min(conf, 0.50);

  // RULE 4: DB match found → boost by 10% (max 90%)
  if (dbMatches.length > 0 && (method === 'db_match' || brandConf === 'db_matched')) conf = Math.min(conf + 0.10, 0.90);

  // RULE 4b: Packaging + DB match → strong signal, allow up to 85%
  if (isPackaging && dbMatches.length > 0) conf = Math.min(conf + 0.10, 0.85);

  // RULE 5: OCR confirmed + model known → floor at 80%
  if (brandConf === 'confirmed_by_text' && model.toLowerCase() !== 'unidentified') conf = Math.max(conf, 0.80);

  // RULE 6 (Phase 2): OCR keyword match from product intelligence → boost
  // GUARD: only boost if brand is NOT unidentified (don't override RULE 1)
  const ocrMatch = dbMatches.find(m => m._source?.startsWith('ocr_'));
  if (ocrMatch && brand.toLowerCase() !== 'unidentified' && brandConf !== 'unidentified') {
    if (ocrMatch._source === 'ocr_model_number') {
      // Model number exact match is very strong — floor at 82%
      conf = Math.max(conf, 0.82);
      console.log(`[Calibrate] OCR model_number match boost → ${round(conf * 100)}%`);
    } else {
      // Keyword/alias match — boost by 8%
      conf = Math.min(conf + 0.08, 0.88);
    }
  }

  // RULE 7 (Phase 2): Apply product confidence_weight from learning loop
  const topMatch = dbMatches[0];
  if (topMatch?.confidence_weight && topMatch.confidence_weight !== 1.0) {
    // Trusted products (confirmed often) nudge confidence up; suspicious ones down
    const weightFactor = topMatch.confidence_weight > 1.0
      ? Math.min(topMatch.confidence_weight, 1.15)  // max +15% boost
      : Math.max(topMatch.confidence_weight, 0.85);  // max -15% penalty
    conf *= weightFactor;
  }

  // Hard bounds
  conf = Math.min(Math.max(conf, 0.10), 0.95);

  return { ...verification, raw_match_confidence: verification.match_confidence, match_confidence: round(conf), confidence_calibrated: true };
}

/**
 * Determine UI behavior based on final confidence.
 */
function getConfidenceTier(confidence) {
  if (confidence >= 0.80) return { tier: 'high',      needsConfirmation: false, color: 'green',  behavior: 'Show normally' };
  if (confidence >= 0.60) return { tier: 'moderate',   needsConfirmation: true,  color: 'amber',  behavior: 'Ask "Is this correct?"' };
  if (confidence >= 0.40) return { tier: 'low',        needsConfirmation: true,  color: 'orange', behavior: 'Request photo/brand input' };
  return                         { tier: 'very_low',   needsConfirmation: true,  color: 'red',    behavior: 'Broad estimate + help modal' };
}


// ═══════════════════════════════════════════════════════
// §8  WRITE-BACK — Auto-learn from scans
// ═══════════════════════════════════════════════════════

/**
 * After a successful pipeline run:
 * 1) Upsert product into catalog (so future scans find it)
 * 2) Store embedding for vector search
 * 3) Record price observation
 */
async function writeBack(recognition, verification, embedding) {
  const supa = getSupabase();
  if (!supa) return;

  const brand = verification.final_brand;
  const model = verification.final_model;

  // Skip fully generic results
  if (!brand || brand.toLowerCase() === 'unidentified') return;

  try {
    // Upsert product
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
        // Phase 2: learning loop counters
        scan_count: (existing.scan_count || 0) + 1,
        last_scanned_at: new Date().toISOString(),
      };
      // Update embedding if we have one and column exists
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

    // Record price observation
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
// §9  NORMALIZE — Map to UI-compatible format
// ═══════════════════════════════════════════════════════

function normalizeForUI(recognition, verification, tierInfo) {
  const ocr = recognition.ocr_text || {};
  return {
    // Legacy fields (backward compat with AppContext)
    name: verification.full_name || (verification.final_brand !== 'unidentified'
      ? `${verification.final_brand} ${verification.final_model}`.trim()
      : recognition.category),
    nameHebrew: verification.full_name_hebrew || recognition.category_hebrew || '',
    category: verification.final_category || recognition.category,
    confidence: verification.match_confidence,
    isSellable: verification.is_sellable ?? true,
    condition: verification.condition || recognition.visual_features?.condition || 'unknown',
    marketValue: {
      low: verification.price_estimate_low,
      mid: verification.price_estimate_mid,
      high: verification.price_estimate_high,
      currency: 'ILS',
      newRetailPrice: verification.new_retail_price_ils || 0,
      price_method: verification.price_method || 'ai_estimate',
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

    // New structured fields
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

    // Comparables (if DB provided them)
    comparable_items: verification.comparable_items || [],

    // Pipeline metadata
    _pipeline: {
      version: 'v2',
      stage1_confidence: recognition.category_confidence,
      stage2_confidence: verification.match_confidence,
      db_matches: verification.matched_product_ids?.length || 0,
      tier: tierInfo.tier,
      embedding_used: !!recognition._embedding_used,
    },
  };
}


// ═══════════════════════════════════════════════════════
// §10  MAIN HANDLER — Orchestrates the full pipeline
// ═══════════════════════════════════════════════════════

export default async function handler(req) {
  // CORS
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
    const { imageData, images: imagesArr, lang = 'he', hints = [], corrections: clientCorrections = [] } = await req.json();
    // Frontend sends 'corrections', older clients may send 'hints' — accept both
    const clientHints = clientCorrections.length > 0 ? clientCorrections : hints;
    const imageList = imagesArr?.length > 0 ? imagesArr : imageData ? [imageData] : [];
    if (!imageList.length) return json({ error: 'No image data provided' }, 400, cors);

    const t0 = Date.now();

    // ── STAGE 1: RECOGNIZE ──
    let recognition;
    try {
      recognition = await recognize(imageList, lang, apiKey);
      recognition = calibrateRecognition(recognition);
    } catch (stage1Err) {
      console.error('[Pipeline] Stage 1 failed:', stage1Err.message);
      // Minimal fallback recognition so Stage 2 can still attempt pricing
      recognition = {
        category: 'Other', category_hebrew: 'אחר', category_confidence: 0.20,
        brand_candidates: [], model_candidates: [],
        ocr_text: { raw_texts: [], logos_detected: [], has_readable_text: false },
        visual_features: {}, subcategory: '', embedding_text: '',
      };
    }

    const t1 = Date.now();
    console.log(`[Pipeline] Stage 1 done in ${t1 - t0}ms — ${recognition.brand_candidates?.[0]?.brand || 'no brand'} (${round(recognition.category_confidence * 100)}%)`);

    // ── GENERATE EMBEDDING ──
    const embeddingText = recognition.embedding_text
      || [recognition.brand_candidates?.[0]?.brand, recognition.model_candidates?.[0]?.model, recognition.category, ...(recognition.visual_features?.materials || [])].filter(Boolean).join(' ');

    const queryEmbedding = await generateQueryEmbedding(embeddingText);
    recognition._embedding_used = !!queryEmbedding;

    const t2 = Date.now();
    if (queryEmbedding) console.log(`[Pipeline] Embedding generated in ${t2 - t1}ms (${embeddingText.slice(0, 60)}...)`);

    // ── RETRIEVE CANDIDATES ──
    const candidates = await retrieveCandidates(recognition, queryEmbedding);

    const t3 = Date.now();
    console.log(`[Pipeline] Retrieved ${candidates.length} candidates in ${t3 - t2}ms`);

    // ── FETCH CORRECTIONS ──
    let corrections = clientHints;
    if (!corrections.length) {
      corrections = await fetchCorrections().catch(() => []);
    }

    // ── STAGE 2: VERIFY + PRICE ──
    let verification;
    try {
      verification = await verifyAndPrice(recognition, candidates, corrections, lang, apiKey);
    } catch (err) {
      console.error('[Pipeline] Stage 2 failed:', err.message);
      verification = buildFallback(recognition, lang);
    }

    verification = calibrateVerification(verification, recognition, candidates);
    const tierInfo = getConfidenceTier(verification.match_confidence);

    const t4 = Date.now();
    console.log(`[Pipeline] Stage 2 done in ${t4 - t3}ms — ${verification.full_name || verification.final_brand} ₪${verification.price_estimate_mid} (${round(verification.match_confidence * 100)}% ${tierInfo.tier})`);
    console.log(`[Pipeline] Total: ${t4 - t0}ms`);

    // ── WRITE-BACK (fully non-blocking — embedding + DB updates happen after response) ──
    const writeBackAsync = async () => {
      const docEmbedding = queryEmbedding
        ? await generateEmbedding(embeddingText).catch(() => null)
        : null;
      await writeBack(recognition, verification, docEmbedding);
    };
    writeBackAsync().catch((e) => console.warn('[WriteBack]', e.message));

    // ── NORMALIZE + RESPOND (no longer blocked by embedding generation) ──
    const result = normalizeForUI(recognition, verification, tierInfo);

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