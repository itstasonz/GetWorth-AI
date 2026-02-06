export const config = {
  runtime: 'edge',
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

    // ─── SYSTEM PROMPT: Expert appraiser with structured methodology ───
    const systemPrompt = `You are GetWorth AI — a senior item appraiser with 15 years of experience in the Israeli second-hand market.

YOUR EXPERTISE:
- Israeli retail pricing (KSP, Bug, Zap, iDigital, Ivory, Amazon.co.il)
- Israeli second-hand platforms (Yad2, Facebook Marketplace Israel, WinWin)
- Import taxes and gray market pricing in Israel
- Seasonal demand patterns in the Israeli market

YOUR METHODOLOGY (follow this STEP BY STEP for every item):
1. IDENTIFY: What is the exact item? Look for brand logos, model numbers, labels, barcodes, distinctive design features. Be as specific as possible.
2. ASSESS CONDITION: Based ONLY on what you can see — scratches, dents, wear, yellowing, dust, packaging present, accessories visible.
3. ESTIMATE ISRAELI RETAIL PRICE: What this item costs NEW in Israeli stores today.
4. CALCULATE SECOND-HAND VALUE using these depreciation guidelines:
   - New Sealed: 75-90% of Israeli retail
   - Like New (opened, barely used): 60-75% of Israeli retail
   - Excellent (light use, minor signs): 45-60% of Israeli retail
   - Good (normal use, visible wear): 30-45% of Israeli retail
   - Fair (heavy use, cosmetic damage): 15-30% of Israeli retail
   - Poor (damaged, parts missing): 5-15% of Israeli retail
5. SET THREE PRICE TIERS:
   - LOW: Quick sale (sell within 1-2 days)
   - MID: Fair market value (sell within 1-2 weeks)
   - HIGH: Patient seller (premium price, may take a month)

ISRAEL-SPECIFIC PRICING RULES:
- All prices in ₪ (ILS)
- Electronics retail: +15-40% vs US MSRP (import tax + VAT + distributor margins)
- Apple products: +10-20% vs US (official Israeli importers)
- Samsung/Chinese brands: +15-30% vs US
- Gaming (PS5, Switch, Xbox): high demand, hold value well
- IKEA furniture: check IKEA.co.il prices, second-hand = 30-50% of retail
- Baby/kids items: depreciate fast (30-50% of retail)
- Luxury watches (Rolex, Omega): hold/appreciate (80-120% of retail)
- Fashion watches (Fossil, Daniel Wellington): depreciate fast (20-40%)
- Food/medicine/opened consumables: NOT sellable, isSellable = false, all prices = 0

CONFIDENCE SCORING:
- 0.90-1.0: Exact model identified with certainty (can see label/model number)
- 0.75-0.89: Brand and approximate model clear from design
- 0.55-0.74: Category clear, brand likely, model estimated
- 0.35-0.54: General item type identified, specific details uncertain
- Below 0.35: Very uncertain, blurry image, or unidentifiable

CRITICAL RULES:
- Be SPECIFIC: "iPhone 15 Pro Max 256GB Natural Titanium" not just "iPhone"
- If you see a barcode, model number, or label — USE IT for identification
- NEVER return mid price of 0 for sellable items
- For items you truly cannot identify, set confidence below 0.3 and give wide price range
- priceFactors should list 2-4 concrete factors that affect THIS specific item's price`;

    // ─── USER PROMPT ───
    const userPrompt = isHebrew
      ? `נתח את התמונה וזהה את הפריט. עקוב אחרי השלבים:

שלב 1 — זיהוי: מה הפריט? מותג? דגם? גרסה? מה ראית בתמונה שעזר לך לזהות?
שלב 2 — מצב: מה נראה? שריטות? בלאי? אריזה? אביזרים?
שלב 3 — מחיר חדש בישראל: כמה עולה היום בחנויות (KSP, באג, זאפ)?
שלב 4 — מחיר יד שנייה: בהתבסס על יד2 ופייסבוק מרקטפלייס

ענה אך ורק ב-JSON תקין (ללא markdown, ללא backticks, ללא טקסט נוסף):
{"name":"שם באנגלית (מותג + דגם ספציפי)","nameHebrew":"שם בעברית","category":"Food/Electronics/Vehicles/Watches/Clothing/Furniture/Sports/Beauty/Books/Toys/Home/Tools/Music/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"מקור (למשל: KSP ₪X, יד2 ₪Y)"},"details":{"description":"תיאור מפורט (2-3 משפטים)","brand":"מותג","model":"דגם","year":"שנה/דור","identificationNotes":"מה בתמונה עזר לזהות (לוגו, צורה, תווית, וכו׳)","additionalInfo":"מידע נוסף"},"priceFactors":[{"factor":"גורם","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"טיפ קונקרטי למכירה","whereToBuy":"איפה למכור (יד2, פייסבוק, וכו׳)","israeliMarketNotes":"הערות לשוק הישראלי"}`
      : `Analyze this image and identify the item. Follow the steps:

Step 1 — IDENTIFY: What is this? Brand? Model? Variant? What visual clues helped you identify it?
Step 2 — CONDITION: What do you see? Scratches? Wear? Packaging? Accessories?
Step 3 — ISRAELI RETAIL: What does it cost new today in stores (KSP, Bug, Zap)?
Step 4 — SECOND-HAND PRICE: Based on Yad2 and Facebook Marketplace Israel listings

Respond ONLY with valid JSON (no markdown, no backticks, no extra text):
{"name":"English name (Brand + specific model)","nameHebrew":"שם בעברית","category":"Food/Electronics/Vehicles/Watches/Clothing/Furniture/Sports/Beauty/Books/Toys/Home/Tools/Music/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"Source (e.g., KSP ₪X, Yad2 ₪Y)"},"details":{"description":"Detailed description (2-3 sentences)","brand":"Brand","model":"Model","year":"Year/generation","identificationNotes":"What in the image helped identify this (logo, shape, label, etc.)","additionalInfo":"Additional info"},"priceFactors":[{"factor":"Factor","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"Concrete tip for selling in Israel","whereToBuy":"Where to sell (Yad2, Facebook, etc.)","israeliMarketNotes":"Israel market notes"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageData
              }
            },
            {
              type: 'text',
              text: userPrompt
            }
          ]
        }]
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Anthropic API error:', response.status, errorData);
      return new Response(JSON.stringify({
        error: errorData.error?.message || `API error: ${response.status}`
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();

    // ─── POST-PROCESSING: Validate and sanitize ───
    try {
      if (data.content?.[0]?.text) {
        let raw = data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(raw);

        if (parsed.marketValue) {
          const mv = parsed.marketValue;
          // Ensure low <= mid <= high
          if (mv.low > mv.mid) mv.low = Math.round(mv.mid * 0.7);
          if (mv.high < mv.mid) mv.high = Math.round(mv.mid * 1.3);
          // Ensure positive for sellable items
          if (parsed.isSellable && mv.mid <= 0) {
            mv.mid = 50; mv.low = 30; mv.high = 80; // fallback minimum
          }
          // Round all prices
          mv.low = Math.max(0, Math.round(mv.low));
          mv.mid = Math.max(0, Math.round(mv.mid));
          mv.high = Math.max(0, Math.round(mv.high));
          if (mv.newRetailPrice) mv.newRetailPrice = Math.round(mv.newRetailPrice);
        }

        // Non-sellable = zero prices
        if (parsed.isSellable === false) {
          parsed.marketValue = { low: 0, mid: 0, high: 0, currency: 'ILS', newRetailPrice: 0 };
        }

        // Clamp confidence
        if (typeof parsed.confidence === 'number') {
          parsed.confidence = Math.min(1, Math.max(0, parsed.confidence));
        }

        data.content[0].text = JSON.stringify(parsed);
      }
    } catch (e) {
      console.warn('Post-processing skipped:', e.message);
    }

    return new Response(JSON.stringify(data), {
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
