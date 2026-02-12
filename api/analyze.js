export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const { imageData, lang = 'he', refineModel = null } = await req.json();

    if (!imageData) {
      return new Response(JSON.stringify({ error: 'No image data provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const isHebrew = lang === 'he';

    const systemPrompt = `You are GetWorth AI — a pricing expert specializing in Israeli second-hand marketplaces (Yad2, Facebook Marketplace Israel, and ZAP used listings).

YOUR JOB: Tell users what their item would ACTUALLY SELL FOR on Israeli second-hand platforms, NOT what it costs new.

STEP 1 — IDENTIFY THE ITEM (Multi-Stage Recognition):

A) OCR PASS — Text Extraction:
- Read ALL visible text: brand names, model numbers, serial numbers, labels, stickers, packaging text
- Extract specific model identifiers (e.g., "A2894" for Apple, "SM-S928B" for Samsung)
- Note any visible specs (storage, RAM, color names, size labels)

B) VISUAL RECOGNITION:
- Identify brand from logos, design language, distinctive features
- Match to specific product line and generation
- Note physical characteristics (color, size, material, form factor)

C) CROSS-REFERENCE:
- Combine OCR text + visual cues to pinpoint exact model
- If model number found, use it as primary identifier
- If only brand visible, narrow down by form factor and era

D) CONFIDENCE ASSESSMENT:
- 0.90-1.0: Exact model confirmed (model number visible or unique design)
- 0.75-0.89: High confidence (brand + generation clear, minor ambiguity)
- 0.50-0.74: Moderate (brand clear but could be multiple models)
- Below 0.50: Low (generic item or unclear image)

E) ALTERNATIVES:
- If confidence < 0.90, provide 2-3 alternative identifications ranked by likelihood
- Each alternative has its own name, confidence, and estimated mid price
- Alternatives should be meaningfully different (not just color variants)
${refineModel ? `\nIMPORTANT: The user has confirmed this is "${refineModel}". Use this to provide accurate pricing. Set confidence to 0.95+.` : ''}

STEP 2 — PRICE IT FOR ISRAELI SECOND-HAND MARKET:

PHONES — Second-hand prices (₪, Good condition, 2026):
iPhone 16 Pro Max: 4,200-5,000 | iPhone 16 Pro: 3,500-4,200 | iPhone 16: 2,800-3,200
iPhone 15 Pro Max: 3,500-4,200 | iPhone 15 Pro: 2,800-3,500 | iPhone 15: 2,200-2,700 | iPhone 15 Plus: 2,500-3,000
iPhone 14 Pro Max: 2,800-3,300 | iPhone 14 Pro: 2,200-2,800 | iPhone 14: 1,600-2,000 | iPhone 14 Plus: 1,800-2,200
iPhone 13 Pro Max: 2,200-2,700 | iPhone 13 Pro: 1,800-2,200 | iPhone 13: 1,300-1,700 | iPhone 13 mini: 1,100-1,400
iPhone 12 Pro Max: 1,600-2,000 | iPhone 12 Pro: 1,300-1,600 | iPhone 12: 1,000-1,300
iPhone 11 Pro Max: 1,200-1,500 | iPhone 11 Pro: 1,000-1,300 | iPhone 11: 800-1,100
iPhone SE (3rd): 900-1,200 | iPhone SE (2nd): 500-700
Samsung S24 Ultra: 3,200-4,000 | S24+: 2,500-3,200 | S24: 2,000-2,600
Samsung S23 Ultra: 2,500-3,200 | S23+: 2,000-2,500 | S23: 1,600-2,000
Samsung S22 Ultra: 1,800-2,400 | S22: 1,200-1,600
Samsung Z Fold5: 4,000-5,000 | Z Flip5: 2,200-2,800 | A54: 700-1,000 | A34: 500-750
Google Pixel 8 Pro: 2,200-2,800 | Pixel 8: 1,600-2,200 | Pixel 7a: 1,000-1,400
Xiaomi 14 Pro: 1,800-2,300 | Xiaomi 13: 1,000-1,400

COMPUTERS — Second-hand (₪, Good):
MacBook Air M3: 3,800-4,800 | MacBook Air M2: 3,000-3,800 | MacBook Air M1: 2,200-2,800
MacBook Pro 14" M3 Pro: 5,500-7,500 | MacBook Pro 14" M2 Pro: 4,500-6,000 | MacBook Pro 16" M3 Pro: 7,000-9,500
MacBook Pro 13" M2: 3,000-3,800 | MacBook Pro 13" M1: 2,200-2,800
iPad Pro M4 11": 3,000-4,000 | iPad Pro M4 13": 4,500-5,500
iPad Air M2: 1,800-2,400 | iPad 10th gen: 1,000-1,400 | iPad 9th gen: 700-1,000

GAMING — Second-hand (₪, Good):
PlayStation 5 (disc): 1,600-2,000 | PS5 Digital: 1,300-1,600 | PS5 Slim: 1,800-2,200
PlayStation 4 Pro: 600-900 | PS4 Slim: 400-600
Xbox Series X: 1,400-1,800 | Xbox Series S: 700-1,000
Nintendo Switch OLED: 1,000-1,300 | Switch V2: 700-900 | Switch Lite: 400-600
Steam Deck 512GB: 1,800-2,400 | Meta Quest 3: 1,500-2,000

AUDIO — Second-hand (₪, Good):
AirPods Pro 2: 550-750 | AirPods 3: 300-400 | AirPods Max: 1,400-1,800
Sony WH-1000XM5: 800-1,100 | WH-1000XM4: 500-700
Bose QC Ultra: 900-1,200 | QC45: 550-750
JBL Flip 6: 200-300 | Charge 5: 350-500 | Xtreme 3: 700-950
Marshall Stanmore III: 1,100-1,500 | Beats Studio Pro: 700-950

HOME APPLIANCES — Second-hand (₪, Good):
Dyson V15: 1,600-2,200 | V12: 1,200-1,600 | V8: 600-900
Dyson Airwrap: 1,200-1,700 | Supersonic: 1,000-1,400
iRobot Roomba j7+: 1,200-1,700 | Roborock S8 Pro: 1,500-2,200
Nespresso Vertuo: 300-500 | DeLonghi espresso: 800-2,000
KitchenAid mixer: 1,500-2,500 | Thermomix TM6: 3,000-4,000

TV/MONITORS — Second-hand (₪, Good):
LG C3 55" OLED: 2,800-3,500 | Samsung QN90C 55": 2,500-3,200
Sony A80L 55": 3,000-3,800 | Apple Studio Display: 4,000-5,500

FURNITURE — Second-hand (₪, Good):
IKEA KALLAX 4x4: 150-300 | MALM dresser: 200-550 | BILLY: 80-200 | PAX: 500-1,500
Herman Miller Aeron: 2,500-4,500 | IKEA MARKUS: 300-500
Sofa 3-seat: 500-3,500 | Dining table + chairs: 500-2,500

CLOTHING & SHOES — Second-hand (₪, Good):
Nike Air Force 1: 150-280 | Air Jordan 1: 300-600 | Adidas Yeezy: 500-1,200
New Balance 990: 400-650 | Designer bags: 30-70% of retail

WATCHES — Second-hand (₪, Good):
Rolex Submariner: 30,000-42,000 | Omega Speedmaster: 15,000-22,000
Apple Watch Ultra 2: 2,000-2,600 | Series 9: 900-1,400
Garmin Fenix 7: 1,500-2,200 | Casio G-Shock: 150-500

CAMERAS & DRONES — Second-hand (₪, Good):
DJI Mini 4 Pro: 2,200-3,000 | GoPro Hero 12: 1,000-1,500
Sony A7 IV: 5,000-7,000 | Canon R6 II: 5,500-7,500

GENERAL RULES:
- Electronics lose 30-50% in first year, then 15-20% per year
- Furniture loses 40-60% immediately, then holds
- Clothing loses 50-70% unless designer/rare
- New Sealed: +15-25% | Fair/Poor: -30-50%

STEP 3 — SET THREE PRICE TIERS:
- LOW: ~85% of MID (quick sale 1-2 days)
- MID: fair market (sells in 1-2 weeks)
- HIGH: ~120% of MID (patient seller)

CRITICAL RULES:
- Prices in ₪ (ILS) only — NEVER USD
- NEVER return 0 for sellable items
- These are SECOND-HAND prices, not new retail
- Be honest about confidence`;

    const alternativesSchema = `,"recognition":{"ocrText":"all visible text extracted","modelNumber":"specific model number if found","identifiedBy":"ocr/visual/both","alternatives":[{"name":"Alternative name","nameHebrew":"שם חלופי","confidence":0.7,"estimatedMid":0}]}`;

    const userPrompt = isHebrew
      ? `זהה את הפריט בתמונה ותמחר אותו לשוק היד-שנייה הישראלי.

חשוב: חפש כל טקסט גלוי — מספרי דגם, תוויות, לוגואים. השתמש בהם לזיהוי מדויק.
${refineModel ? `המשתמש ציין שזה "${refineModel}". תמחר בהתאם.` : 'אם לא בטוח 100%, ציין חלופות אפשריות.'}

ענה אך ורק ב-JSON תקין (ללא markdown, ללא backticks):
{"name":"שם באנגלית (מותג + דגם)","nameHebrew":"שם בעברית","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","subcategory":"Phones/Laptops/Tablets/Consoles/Cameras/TVs/Audio/Sofas/Tables/Luxury/Smart/Shoes/Streetwear/Designer/Jewelry/Fragrances/Cars/Bicycles/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"יד2 / פייסבוק מרקטפלייס"},"details":{"description":"תיאור (2-3 משפטים)","brand":"מותג","model":"דגם מדויק","year":"שנה","identificationNotes":"מה בתמונה עזר לזהות","additionalInfo":"מידע נוסף"},"priceFactors":[{"factor":"גורם","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"טיפ למכירה","whereToBuy":"איפה למכור","israeliMarketNotes":"הערות"${alternativesSchema}}`
      : `Identify this item and price it for the Israeli second-hand market.

IMPORTANT: Read ALL visible text — model numbers, labels, logos, serial numbers. Use them for precise identification.
${refineModel ? `The user confirmed this is "${refineModel}". Price accordingly.` : 'If not 100% certain, provide possible alternatives.'}

Respond ONLY with valid JSON (no markdown, no backticks):
{"name":"English name (Brand + Exact Model)","nameHebrew":"שם בעברית","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","subcategory":"Phones/Laptops/Tablets/Consoles/Cameras/TVs/Audio/Sofas/Tables/Luxury/Smart/Shoes/Streetwear/Designer/Jewelry/Fragrances/Cars/Bicycles/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"Yad2 / Facebook Marketplace"},"details":{"description":"Description (2-3 sentences)","brand":"Brand","model":"Exact Model","year":"Year","identificationNotes":"What in the image helped identify","additionalInfo":"Additional info"},"priceFactors":[{"factor":"Factor","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"Tip for quick sale","whereToBuy":"Where to sell","israeliMarketNotes":"Notes"${alternativesSchema}}`;

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
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
            { type: 'text', text: userPrompt }
          ]
        }]
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API error:', response.status, errorData);
      return Response.json({ error: errorData.error?.message || `API error: ${response.status}` }, { status: response.status });
    }

    const data = await response.json();

    // Post-processing
    try {
      if (data.content?.[0]?.text) {
        let raw = data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(raw);

        // Validate prices
        if (parsed.marketValue && parsed.isSellable !== false) {
          const mv = parsed.marketValue;
          mv.low = Math.max(0, Math.round(mv.low || 0));
          mv.mid = Math.max(0, Math.round(mv.mid || 0));
          mv.high = Math.max(0, Math.round(mv.high || 0));
          if (mv.newRetailPrice) mv.newRetailPrice = Math.round(mv.newRetailPrice);
          if (mv.low > mv.mid) mv.low = Math.round(mv.mid * 0.85);
          if (mv.high < mv.mid) mv.high = Math.round(mv.mid * 1.2);
          if (mv.mid <= 0) { mv.mid = 50; mv.low = 40; mv.high = 65; }
        }

        if (parsed.isSellable === false) {
          parsed.marketValue = { low: 0, mid: 0, high: 0, currency: 'ILS', newRetailPrice: 0 };
        }

        // Clamp confidence
        if (typeof parsed.confidence === 'number') {
          parsed.confidence = Math.min(1, Math.max(0, parsed.confidence));
        }

        // Validate recognition block
        if (parsed.recognition) {
          const rec = parsed.recognition;
          if (!Array.isArray(rec.alternatives)) rec.alternatives = [];
          rec.alternatives = rec.alternatives.slice(0, 3).filter(a => a.name && typeof a.confidence === 'number');
          rec.alternatives.forEach(a => {
            a.confidence = Math.min(1, Math.max(0, a.confidence));
            a.estimatedMid = Math.max(0, Math.round(a.estimatedMid || 0));
          });
          rec.alternatives.sort((a, b) => b.confidence - a.confidence);
        } else {
          parsed.recognition = { ocrText: '', modelNumber: '', identifiedBy: 'visual', alternatives: [] };
        }

        // Flag: should we ask the user to confirm?
        parsed.needsConfirmation = (parsed.confidence < 0.90) && (parsed.recognition.alternatives.length > 0);

        data.content[0].text = JSON.stringify(parsed);
      }
    } catch (e) {
      console.warn('Post-processing skipped:', e.message);
    }

    return Response.json(data, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Server error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}