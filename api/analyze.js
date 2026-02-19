export const config = {
  runtime: 'edge',
};

// ═══════════════════════════════════════════════════════
// Stage A+C Combined Prompt — OCR-first identification + Israeli market pricing
// Week 1: Single call. Week 3 will split into separate Stage A → Stage B (DB) → Stage C calls.
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
// Overrides the model's self-reported confidence based on
// what it actually found (OCR text, brand status, etc.)
// ═══════════════════════════════════════════════════════

function calibrateConfidence(result) {
  let confidence = result.confidence ?? 0.5;
  const id = result.identification || {};
  const ocr = result.ocr || {};
  const cls = result.classification || {};

  // Access brand_confidence from classification (primary) or identification
  const brandConf = cls.brand_confidence || 'unidentified';
  const brand = id.brand || result.details?.brand || 'unidentified';
  const model = id.model || result.details?.model || 'unidentified';
  const idMethod = cls.identification_method || 'generic_only';

  // RULE 1: No brand identified → cap at 60%
  if (brand.toLowerCase() === 'unidentified' || brand.toLowerCase() === 'unknown' || brandConf === 'unidentified') {
    confidence = Math.min(confidence, 0.60);
  }

  // RULE 2: Brand inferred visually (not from readable text) → cap at 75%
  if (brandConf === 'inferred_from_visuals') {
    confidence = Math.min(confidence, 0.75);
  }

  // RULE 3: No OCR text found at all → reduce by 15 percentage points
  if (!ocr.readable_text_on_item && (!ocr.text_found || ocr.text_found.length === 0)) {
    confidence = Math.max(confidence - 0.15, 0.10);
  }

  // RULE 4: Generic-only identification → cap at 50%
  if (idMethod === 'generic_only') {
    confidence = Math.min(confidence, 0.50);
  }

  // RULE 5: Brand AND model confirmed by OCR text → floor at 80%
  if (brandConf === 'confirmed_by_text' && model.toLowerCase() !== 'unidentified') {
    confidence = Math.max(confidence, 0.80);
  }

  // RULE 6: Hard ceiling at 95% (always leave room for error)
  confidence = Math.min(confidence, 0.95);

  // RULE 7: Hard floor at 10%
  confidence = Math.max(confidence, 0.10);

  // Round to 2 decimals
  confidence = Math.round(confidence * 100) / 100;

  return {
    ...result,
    raw_confidence: result.confidence,
    confidence,
    confidence_calibrated: true,
  };
}

// ═══════════════════════════════════════════════════════
// Derive backward-compatible fields + recognition object
// so existing UI code doesn't break
// ═══════════════════════════════════════════════════════

function normalizeResult(result) {
  const id = result.identification || {};
  const ocr = result.ocr || {};
  const cls = result.classification || {};

  // Build the recognition object that CameraResultsView expects
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

  // Determine needsConfirmation based on calibrated confidence
  const needsConfirmation = result.confidence < 0.80;

  // Use full_name if available, fallback to name
  const displayName = id.full_name && id.full_name !== id.generic_name
    ? id.full_name
    : (result.name || id.generic_name || 'Unknown Item');

  const displayNameHebrew = id.full_name_hebrew && id.full_name_hebrew !== id.generic_name_hebrew
    ? id.full_name_hebrew
    : (result.nameHebrew || id.generic_name_hebrew || '');

  return {
    ...result,
    name: displayName,
    nameHebrew: displayNameHebrew,
    category: result.category || cls.category || 'Other',
    recognition,
    needsConfirmation,
    // Keep identification/ocr/classification for new UI features
    identification: id,
    ocr,
    classification: cls,
  };
}

// ═══════════════════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════════════════

export default async function handler(req) {
  // CORS preflight
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
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { imageData, images, lang = 'he', hints = [] } = await req.json();

    // Support both single imageData and images[] array
    const imageList = images && images.length > 0 ? images : (imageData ? [imageData] : []);

    if (imageList.length === 0) {
      return new Response(JSON.stringify({ error: 'No image data provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build prompt with optional recognition hints (past corrections)
    const prompt = buildPrompt(lang, hints);

    // Build message content: all images + prompt text
    const content = [
      // All images (supports multi-photo — Week 2 will add UI for this)
      ...imageList.map((img) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: img,
        },
      })),
      // Prompt text
      {
        type: 'text',
        text: imageList.length > 1
          ? `${prompt}\n\nNOTE: ${imageList.length} images provided. Use ALL images together for identification. Look for brand/model text in each image.`
          : prompt,
      },
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
      console.error('Anthropic API error:', response.status, errorData);
      return new Response(JSON.stringify({
        error: errorData.error?.message || `API error: ${response.status}`,
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();

    // Extract and parse the JSON from the response
    let parsed = null;
    const textContent = data.content?.find(c => c.type === 'text')?.text || '';

    try {
      // Try direct parse first
      parsed = JSON.parse(textContent.trim());
    } catch {
      // Try extracting JSON from possible markdown wrapper
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Fall through to error
        }
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

    // Apply confidence calibration (hard rules override model self-report)
    const calibrated = calibrateConfidence(parsed);

    // Normalize for backward compatibility with existing UI
    const normalized = normalizeResult(calibrated);

    // Return the processed result wrapped in Anthropic-like format
    // (so the client-side parsing in AppContext still works)
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
      headers: { 'Content-Type': 'application/json' },
    });
  }
}