export const config = {
  runtime: 'edge',
};

// ═══════════════════════════════════════════════════════
// Stage A+C Combined Prompt — OCR-first identification + Israeli market pricing
// ═══════════════════════════════════════════════════════

function buildPrompt(lang, hints = []) {
  const isHebrew = lang === 'he';

  const hintsBlock = hints.length > 0
    ? `\nPAST CORRECTIONS (learn from these — users corrected previous misidentifications):
${hints.map(h => `- "${h.original}" was actually "${h.corrected}" (corrected ${h.count}x)`).join('\n')}
If you see a similar item, prefer the corrected identification.\n`
    : '';

  return `You are an expert item identification and valuation system with OCR capability, specializing in the ISRAELI MARKET.

TASK: Analyze this image using a 2-step process: FIRST identify, THEN price.

═══ STEP 1: FORENSIC IDENTIFICATION ═══

1. OCR FIRST — Before identifying the item, read ALL visible text in the image:
   - Brand logos (embossed, printed, engraved, stamped)
   - Model numbers / serial numbers / part numbers
   - Tags, stickers, labels, packaging text
   - Any Hebrew text (תוויות, מדבקות)
   Report EXACTLY what you can read. Do NOT guess text you cannot see clearly.

2. VISUAL FEATURES — Describe:
   - Materials (metal, plastic, glass, wood, fabric, etc.)
   - Colors and finish
   - Distinctive design elements, shape, size clues
   - Visible wear, damage, or condition indicators

3. IDENTIFICATION — Based on OCR text + visual features:
   - Generic category (what TYPE of item is this)
   - Brand: ONLY state a brand if text/logo confirms it. Otherwise say "unidentified"
   - Model: ONLY state a model if text confirms it. Otherwise say "unidentified"
   - If you RECOGNIZE the item visually but cannot read confirming text, say:
     "Visually resembles [Brand X] but no readable text confirms this"

4. CONFIDENCE RULES — you MUST follow these strictly:
   - 90-100%: Brand AND model clearly readable in text/logo on the item
   - 75-89%:  Brand readable/confirmed, model inferred from visual features
   - 50-74%:  Item type clear, brand GUESSED from visual similarity (NOT confirmed by text)
   - 30-49%:  Generic identification only, no brand confirmation at all
   - Below 30%: Cannot identify reliably
   ⚠️ NEVER report 90%+ unless you can cite specific readable text from the image.
   ⚠️ If brand is "unidentified", confidence MUST be below 65%.

═══ STEP 2: ISRAELI MARKET PRICING ═══

${isHebrew ? 'כל המחירים בשקלים חדשים (₪).' : 'All prices in Israeli New Shekel (₪).'}
- Base valuations on Israeli market: Yad2, Facebook Marketplace Israel, KSP, Zap, Bug
- Electronics are typically 20-40% more expensive in Israel than US
- Consider Israeli import taxes and local availability
- Used items: typically 40-70% of new retail price in Israel
- If brand is "unidentified": give a WIDE price range (±50% from mid)
- If brand is confirmed by text: give a NARROW range (±20% from mid)
${hintsBlock}
Respond ONLY with valid JSON (no markdown, no backticks, no explanation outside the JSON):
{
  "identification": {
    "generic_name": "Item type in English (e.g., Hookah, Smartphone, Wristwatch)",
    "generic_name_hebrew": "שם סוג הפריט בעברית",
    "brand": "Brand name OR 'unidentified'",
    "model": "Model name/number OR 'unidentified'",
    "full_name": "Brand + Model if known, otherwise just generic name",
    "full_name_hebrew": "שם מלא בעברית"
  },
  "ocr": {
    "text_found": ["exact text 1", "exact text 2"],
    "logos_found": ["logo description 1"],
    "readable_text_on_item": true
  },
  "visual_features": {
    "materials": ["material 1"],
    "colors": ["color 1"],
    "distinctive_features": ["feature 1"],
    "condition_visual": "New/Like New/Good/Fair/Poor"
  },
  "classification": {
    "category": "Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Smoking/Home/Beauty/Books/Toys/Tools/Food/Other",
    "subcategory": "specific subcategory",
    "identification_method": "ocr_confirmed/visual_match/pattern_recognition/generic_only",
    "brand_confidence": "confirmed_by_text/inferred_from_visuals/unidentified",
    "needs_more_info": false,
    "suggested_followup": "null OR a specific question like 'Can you photograph the label on the bottom?'"
  },
  "confidence": 0.72,
  "confidence_reasoning": "1-2 sentence explanation citing what text/features led to this confidence level",
  "name": "Full item name in English",
  "nameHebrew": "שם הפריט בעברית",
  "category": "Category",
  "isSellable": true,
  "condition": "${isHebrew ? 'מצב בעברית' : 'Condition in English'}",
  "marketValue": {
    "low": 0,
    "mid": 0,
    "high": 0,
    "currency": "ILS",
    "newRetailPrice": 0,
    "price_method": "comp_based OR ai_estimate"
  },
  "details": {
    "description": "${isHebrew ? 'תיאור קצר' : 'Brief description'}",
    "brand": "Brand or unidentified",
    "model": "Model or unidentified",
    "additionalInfo": "${isHebrew ? 'מידע נוסף' : 'Additional info'}"
  },
  "priceFactors": [
    {"factor": "Factor", "impact": "+/-₪X"}
  ],
  "marketTrend": "up/down/stable/not-applicable",
  "demandLevel": "high/moderate/low/not-applicable",
  "sellingTips": "${isHebrew ? 'טיפ למכירה בישראל' : 'Selling tip for Israel'}",
  "whereToBuy": "Yad2, KSP, etc.",
  "israeliMarketNotes": "${isHebrew ? 'הערות לשוק הישראלי' : 'Israeli market notes'}"
}`;
}

// ═══════════════════════════════════════════════════════
// Confidence calibration — hard rules enforced server-side
// ═══════════════════════════════════════════════════════

function calibrateConfidence(result) {
  let confidence = result.confidence ?? 0.5;
  const id = result.identification || {};
  const ocr = result.ocr || {};
  const cls = result.classification || {};

  const brandConf = cls.brand_confidence || 'unidentified';
  const brand = id.brand || result.details?.brand || 'unidentified';
  const model = id.model || result.details?.model || 'unidentified';
  const idMethod = cls.identification_method || 'generic_only';

  if (brand.toLowerCase() === 'unidentified' || brand.toLowerCase() === 'unknown' || brandConf === 'unidentified') {
    confidence = Math.min(confidence, 0.60);
  }
  if (brandConf === 'inferred_from_visuals') {
    confidence = Math.min(confidence, 0.75);
  }
  if (!ocr.readable_text_on_item && (!ocr.text_found || ocr.text_found.length === 0)) {
    confidence = Math.max(confidence - 0.15, 0.10);
  }
  if (idMethod === 'generic_only') {
    confidence = Math.min(confidence, 0.50);
  }
  if (brandConf === 'confirmed_by_text' && model.toLowerCase() !== 'unidentified') {
    confidence = Math.max(confidence, 0.80);
  }

  confidence = Math.min(confidence, 0.95);
  confidence = Math.max(confidence, 0.10);
  confidence = Math.round(confidence * 100) / 100;

  return { ...result, raw_confidence: result.confidence, confidence, confidence_calibrated: true };
}

// ═══════════════════════════════════════════════════════
// Normalize result for backward-compatible UI
// ═══════════════════════════════════════════════════════

function normalizeResult(result) {
  const id = result.identification || {};
  const ocr = result.ocr || {};
  const cls = result.classification || {};

  const recognition = {
    identifiedBy: cls.identification_method === 'ocr_confirmed' ? 'ocr'
      : cls.identification_method === 'visual_match' ? 'visual'
      : cls.identification_method === 'pattern_recognition' ? 'both'
      : 'generic',
    ocrText: (ocr.text_found || []).join(' | '),
    modelNumber: id.model !== 'unidentified' ? id.model : null,
    brandConfidence: cls.brand_confidence || 'unidentified',
    alternatives: result.alternatives || [],
  };

  const needsConfirmation = result.confidence < 0.80;

  const displayName = id.full_name && id.full_name !== id.generic_name
    ? id.full_name : (result.name || id.generic_name || 'Unknown Item');

  const displayNameHebrew = id.full_name_hebrew && id.full_name_hebrew !== id.generic_name_hebrew
    ? id.full_name_hebrew : (result.nameHebrew || id.generic_name_hebrew || '');

  return {
    ...result,
    name: displayName,
    nameHebrew: displayNameHebrew,
    category: result.category || cls.category || 'Other',
    recognition,
    needsConfirmation,
    identification: id,
    ocr,
    classification: cls,
  };
}

// ═══════════════════════════════════════════════════════
// Retry helper — exponential backoff for transient errors
// Retries on 529 (overloaded), 500, 502, 503
// ═══════════════════════════════════════════════════════

async function fetchWithRetry(url, options, maxRetries = 3) {
  const delays = [1000, 2500, 5000];
  let lastResponse;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      console.log(`[analyze] Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      lastResponse = await fetch(url, options);

      if (lastResponse.ok) return lastResponse;

      if ([529, 500, 502, 503].includes(lastResponse.status)) {
        lastError = await lastResponse.json().catch(() => ({}));
        console.warn(`[analyze] Attempt ${attempt + 1} got ${lastResponse.status}:`, lastError.error?.message || '');
        if (attempt < maxRetries) continue;
      } else {
        return lastResponse;
      }
    } catch (err) {
      lastError = { error: { message: err.message } };
      console.warn(`[analyze] Attempt ${attempt + 1} network error:`, err.message);
      if (attempt < maxRetries) continue;
    }
  }

  console.error('[analyze] All retries exhausted:', lastError);
  return new Response(JSON.stringify({
    error: 'Service temporarily overloaded. Please try again in a moment.',
    retryable: true,
  }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

// ═══════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { imageData, images, lang = 'he', hints = [] } = await req.json();
    const imageList = images && images.length > 0 ? images : (imageData ? [imageData] : []);

    if (imageList.length === 0) {
      return new Response(JSON.stringify({ error: 'No image data provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const prompt = buildPrompt(lang, hints);

    const content = [
      ...imageList.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: img },
      })),
      {
        type: 'text',
        text: imageList.length > 1
          ? `${prompt}\n\nNOTE: ${imageList.length} images provided. Use ALL images together for identification.`
          : prompt,
      },
    ];

    // ── Call Anthropic with automatic retry on overload ──
    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Anthropic API error after retries:', response.status, errorData);
      return new Response(JSON.stringify({
        error: errorData.error?.message || errorData.error || `API error: ${response.status}`,
        retryable: [529, 500, 502, 503].includes(response.status),
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await response.json();

    let parsed = null;
    const textContent = data.content?.find(c => c.type === 'text')?.text || '';

    try {
      parsed = JSON.parse(textContent.trim());
    } catch {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch {}
      }
    }

    if (!parsed) {
      return new Response(JSON.stringify({
        error: 'Failed to parse AI response',
        raw: textContent.slice(0, 500),
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    const calibrated = calibrateConfidence(parsed);
    const normalized = normalizeResult(calibrated);

    return new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(normalized) }],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });

  } catch (error) {
    console.error('Server error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}