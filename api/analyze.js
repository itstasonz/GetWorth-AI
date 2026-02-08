export const config = {
  maxDuration: 60,
};

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
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { imageData, lang = 'he' } = await req.json();

    if (!imageData) {
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

    const isHebrew = lang === 'he';

    // ══════════════════════════════════════════════════════════
    // STEP 1: VISION — Identify the item from the image
    // ══════════════════════════════════════════════════════════

    const identifySystemPrompt = `You are an expert product identifier. Your ONLY job is to identify the exact item in the image.

RULES:
- Be as SPECIFIC as possible: brand, model, variant, size, color, generation
- Look for logos, labels, model numbers, barcodes, distinctive design features
- If you see text on the item or packaging — READ IT and use it
- If it's electronics, identify the exact model (e.g., "iPhone 15 Pro Max 256GB" not just "iPhone")
- If it's clothing, identify brand + type + any visible style/collection info
- If it's furniture, identify brand (IKEA, etc.) + product line if visible
- If you cannot identify the exact model, give your best guess and note uncertainty
- Respond ONLY with valid JSON, no markdown, no backticks`;

    const identifyPrompt = `Identify this item. Be as specific as possible.

Respond ONLY with JSON:
{"item":"exact item name in English (Brand Model Variant)","itemHebrew":"שם הפריט בעברית","brand":"brand name or Unknown","model":"specific model or Unknown","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","conditionNotes":"what you see - scratches, wear, packaging, etc.","confidence":0.85,"isSellable":true,"identificationClues":"what visual clues helped you identify this (logo, shape, label, color, text on packaging)","searchQuery":"the best search query to find this item's price on Israeli shopping sites (be specific, include brand and model)","searchQueryHebrew":"שאילתת חיפוש בעברית למציאת מחיר באתרים ישראליים"}`;

    const step1Response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.1,
        system: identifySystemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
            { type: 'text', text: identifyPrompt }
          ]
        }]
      }),
    });

    if (!step1Response.ok) {
      const err = await step1Response.json().catch(() => ({}));
      console.error('Step 1 failed:', step1Response.status, err);
      return new Response(JSON.stringify({ error: err.error?.message || 'Identification failed' }), {
        status: step1Response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const step1Data = await step1Response.json();
    let identification;
    try {
      const raw = step1Data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
      identification = JSON.parse(raw);
    } catch (e) {
      console.error('Step 1 parse error:', e);
      return new Response(JSON.stringify({ error: 'Failed to parse identification' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If item is not sellable (food, medicine, etc.), skip pricing and return early
    if (!identification.isSellable) {
      const earlyResult = {
        name: identification.item,
        nameHebrew: identification.itemHebrew,
        category: identification.category || 'Other',
        confidence: identification.confidence || 0.5,
        isSellable: false,
        condition: identification.condition || 'Unknown',
        marketValue: { low: 0, mid: 0, high: 0, currency: 'ILS', newRetailPrice: 0 },
        details: {
          description: isHebrew ? 'פריט זה אינו מתאים למכירה יד שנייה' : 'This item is not suitable for resale',
          brand: identification.brand || 'Unknown',
          model: identification.model || 'Unknown',
          identificationNotes: identification.identificationClues || '',
        },
        priceFactors: [],
        marketTrend: 'stable',
        demandLevel: 'low',
        sellingTips: isHebrew ? 'פריט זה לא מתאים למכירה' : 'This item is not suitable for selling',
        whereToBuy: '',
        israeliMarketNotes: '',
      };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(earlyResult) }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ══════════════════════════════════════════════════════════
    // STEP 2: LIVE PRICE SEARCH — Search Israeli sites for real prices
    // Uses Claude's web_search tool to find actual market prices
    // ══════════════════════════════════════════════════════════

    const searchQuery = identification.searchQuery || identification.item;
    const searchQueryHe = identification.searchQueryHebrew || identification.itemHebrew;

    const pricingSystemPrompt = `You are a pricing expert for the Israeli second-hand market. You have just identified an item and now need to find its REAL price in Israel.

THE ITEM IDENTIFIED:
- Name: ${identification.item}
- Hebrew: ${identification.itemHebrew || 'N/A'}
- Brand: ${identification.brand || 'Unknown'}
- Model: ${identification.model || 'Unknown'}
- Category: ${identification.category}
- Condition: ${identification.condition}
- Condition notes: ${identification.conditionNotes || 'N/A'}
- Confidence: ${identification.confidence}

YOUR TASK:
1. Search for THIS SPECIFIC item's price on Israeli sites (KSP, Bug, Zap, Ivory, iDigital, Amazon.co.il)
2. Search for second-hand prices on Yad2 and Facebook Marketplace Israel
3. Calculate realistic second-hand pricing based on REAL data you find

SEARCH STRATEGY:
- Search in both English and Hebrew
- Use specific model names for accurate results
- Look for the NEW retail price first, then calculate second-hand from that
- If you find actual Yad2/Facebook listings for the same item, use those as reference

PRICING CALCULATION (after finding real retail price):
- New Sealed: 75-90% of Israeli retail
- Like New: 60-75% of Israeli retail
- Excellent: 45-60% of Israeli retail
- Good: 30-45% of Israeli retail
- Fair: 15-30% of Israeli retail
- Poor: 5-15% of Israeli retail

After searching, respond ONLY with valid JSON (no markdown, no backticks):
{"name":"${identification.item}","nameHebrew":"${identification.itemHebrew || ''}","category":"${identification.category}","confidence":${identification.confidence || 0.7},"isSellable":true,"condition":"${identification.condition}","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"actual source with price found (e.g., KSP: ₪X, Yad2: ₪Y)"},"details":{"description":"${isHebrew ? 'תיאור מפורט' : 'detailed description'}","brand":"${identification.brand}","model":"${identification.model}","year":"year if found","identificationNotes":"${identification.identificationClues || ''}","additionalInfo":"relevant market info found during search"},"priceFactors":[{"factor":"factor","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"${isHebrew ? 'טיפ למכירה מבוסס על הממצאים' : 'selling tip based on findings'}","whereToBuy":"${isHebrew ? 'איפה למכור' : 'where to sell'}","israeliMarketNotes":"${isHebrew ? 'הערות לשוק הישראלי' : 'Israeli market notes'}"}`;

    const step2Response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        temperature: 0.1,
        system: pricingSystemPrompt,
        messages: [{
          role: 'user',
          content: `Search for the real price of "${searchQuery}" in Israel. Also search "${searchQueryHe}" in Hebrew.

Find:
1. The NEW retail price in Israeli stores (search KSP, Zap, Bug, iDigital)
2. Second-hand listings on Yad2 or Facebook Marketplace Israel
3. Calculate a fair second-hand price based on real data

Use web search to find actual current prices. Be thorough — search multiple sites.

After searching, respond with the JSON pricing result.`
        }],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5,
          }
        ],
      }),
    });

    if (!step2Response.ok) {
      // If web search fails, fall back to Step 1 data with estimated pricing
      console.warn('Step 2 failed, falling back to estimated pricing');
      return buildFallbackResponse(identification, isHebrew);
    }

    const step2Data = await step2Response.json();

    // Extract the final text response from Step 2 (may contain tool_use + text blocks)
    let pricingResult;
    try {
      const textBlocks = step2Data.content?.filter(b => b.type === 'text') || [];
      const lastText = textBlocks[textBlocks.length - 1]?.text || '';
      const jsonMatch = lastText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        pricingResult = JSON.parse(jsonMatch[0].replace(/```json\n?|\n?```/g, '').trim());
      }
    } catch (e) {
      console.warn('Step 2 parse failed:', e.message);
    }

    // If we couldn't parse Step 2, fall back
    if (!pricingResult || !pricingResult.marketValue) {
      console.warn('No pricing result from Step 2, using fallback');
      return buildFallbackResponse(identification, isHebrew);
    }

    // ══════════════════════════════════════════════════════════
    // POST-PROCESSING: Validate and sanitize final result
    // ══════════════════════════════════════════════════════════

    // Merge identification data into pricing result (Step 1 has better identification)
    pricingResult.confidence = identification.confidence || pricingResult.confidence;
    if (!pricingResult.details) pricingResult.details = {};
    pricingResult.details.identificationNotes = identification.identificationClues || pricingResult.details?.identificationNotes || '';

    // Validate prices
    const mv = pricingResult.marketValue;
    if (mv) {
      mv.low = Math.max(0, Math.round(mv.low || 0));
      mv.mid = Math.max(0, Math.round(mv.mid || 0));
      mv.high = Math.max(0, Math.round(mv.high || 0));
      if (mv.newRetailPrice) mv.newRetailPrice = Math.round(mv.newRetailPrice);

      // Ensure low <= mid <= high
      if (mv.low > mv.mid) mv.low = Math.round(mv.mid * 0.7);
      if (mv.high < mv.mid) mv.high = Math.round(mv.mid * 1.3);

      // Sellable items must have non-zero price
      if (pricingResult.isSellable && mv.mid <= 0) {
        mv.mid = 50; mv.low = 30; mv.high = 80;
      }
    }

    // Clamp confidence
    if (typeof pricingResult.confidence === 'number') {
      pricingResult.confidence = Math.min(1, Math.max(0, pricingResult.confidence));
    }

    // Return in the same format the frontend expects
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(pricingResult) }]
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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

// ─── Fallback: If web search fails, use AI estimation only ───
function buildFallbackResponse(identification, isHebrew) {
  const item = identification.item || 'Unknown Item';
  const result = {
    name: item,
    nameHebrew: identification.itemHebrew || item,
    category: identification.category || 'Other',
    confidence: Math.min((identification.confidence || 0.5) * 0.8, 0.7), // Lower confidence since no real data
    isSellable: identification.isSellable !== false,
    condition: identification.condition || 'Good',
    marketValue: {
      low: 0,
      mid: 0,
      high: 0,
      currency: 'ILS',
      newRetailPrice: 0,
      priceSource: isHebrew ? 'הערכה (לא נמצאו מחירים בזמן אמת)' : 'Estimated (live prices unavailable)',
    },
    details: {
      description: isHebrew ? 'לא הצלחנו למצוא מחירים בזמן אמת. ההערכה מבוססת על ידע כללי.' : 'Could not fetch live prices. Estimate based on general knowledge.',
      brand: identification.brand || 'Unknown',
      model: identification.model || 'Unknown',
      identificationNotes: identification.identificationClues || '',
    },
    priceFactors: [],
    marketTrend: 'stable',
    demandLevel: 'moderate',
    sellingTips: isHebrew ? 'בדוק מחירים ביד2 ובפייסבוק מרקטפלייס לפני שתקבע מחיר' : 'Check Yad2 and Facebook Marketplace for comparable prices before listing',
    whereToBuy: isHebrew ? 'יד2, פייסבוק מרקטפלייס' : 'Yad2, Facebook Marketplace',
    israeliMarketNotes: isHebrew ? 'המחירים הם הערכה בלבד. מומלץ לבדוק מחירים עדכניים.' : 'Prices are estimates only. Check current listings for accurate pricing.',
  };

  return new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(result) }]
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
