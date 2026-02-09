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

    const systemPrompt = `You are GetWorth AI — a pricing expert specializing in Israeli second-hand marketplaces (Yad2, Facebook Marketplace Israel, and ZAP used listings).

YOUR JOB: Tell users what their item would ACTUALLY SELL FOR on Israeli second-hand platforms, NOT what it costs new.

STEP 1 — IDENTIFY THE ITEM:
- Look for brand logos, model numbers, labels, text, packaging, distinctive design
- Be SPECIFIC: "iPhone 15 Pro Max 256GB" not just "iPhone"
- Note the CONDITION from visual cues (scratches, wear, packaging, etc.)

STEP 2 — PRICE IT BASED ON REAL ISRAELI SECOND-HAND MARKET:

IMPORTANT: These are USED/SECOND-HAND prices — what items actually sell for on Yad2 and Facebook Marketplace Israel, NOT new retail prices.

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
iPad mini 6: 1,300-1,700

GAMING — Second-hand (₪, Good):
PlayStation 5 (disc): 1,600-2,000 | PS5 Digital: 1,300-1,600 | PS5 Slim: 1,800-2,200
PlayStation 4 Pro: 600-900 | PS4 Slim: 400-600 | PS4 game: 40-100
Xbox Series X: 1,400-1,800 | Xbox Series S: 700-1,000 | Xbox game: 40-100
Nintendo Switch OLED: 1,000-1,300 | Switch V2: 700-900 | Switch Lite: 400-600 | Switch game: 60-120
Steam Deck 512GB: 1,800-2,400 | Steam Deck 64GB: 1,200-1,500
Meta Quest 3: 1,500-2,000 | Quest 2: 600-900

AUDIO — Second-hand (₪, Good):
AirPods Pro 2: 550-750 | AirPods 3: 300-400 | AirPods Max: 1,400-1,800
Sony WH-1000XM5: 800-1,100 | WH-1000XM4: 500-700 | WF-1000XM5: 550-750
Bose QC Ultra: 900-1,200 | QC45: 550-750 | QuietComfort earbuds II: 500-700
JBL Flip 6: 200-300 | Charge 5: 350-500 | Xtreme 3: 700-950 | Go 3: 80-120
Marshall Stanmore III: 1,100-1,500 | Emberton II: 350-500
Beats Studio Pro: 700-950 | Solo 4: 450-600 | Fit Pro: 350-500
Harman Kardon Aura Studio 3: 600-900

HOME APPLIANCES — Second-hand (₪, Good):
Dyson V15: 1,600-2,200 | V12: 1,200-1,600 | V8: 600-900
Dyson Airwrap: 1,200-1,700 | Supersonic: 1,000-1,400
Dyson Pure Cool: 800-1,200 | Hot+Cool: 700-1,000
iRobot Roomba j7+: 1,200-1,700 | i7+: 800-1,200 | i3+: 500-800
Roborock S8 Pro: 1,500-2,200 | S7: 800-1,200
Nespresso Vertuo: 300-500 | Original: 200-350
DeLonghi espresso: 800-2,000 | Breville Barista: 1,200-2,500
KitchenAid mixer: 1,500-2,500 | Kenwood: 1,000-1,800
Ninja air fryer: 250-450 | Philips air fryer: 300-550
Thermomix TM6: 3,000-4,000

TV/MONITORS — Second-hand (₪, Good):
LG C3 55" OLED: 2,800-3,500 | LG C2 55": 2,200-2,800 | LG B3 55": 2,000-2,600
Samsung QN90C 55": 2,500-3,200 | Crystal 55": 1,200-1,600
Sony A80L 55": 3,000-3,800
Apple Studio Display: 4,000-5,500
Dell 27" 4K: 1,000-1,500 | LG 27" 4K: 800-1,200

FURNITURE — Second-hand (₪, Good):
IKEA KALLAX 4x4: 150-300 | KALLAX 2x2: 80-150
IKEA MALM dresser 6-drawer: 300-550 | 4-drawer: 200-400
IKEA BILLY bookcase: 80-200 | PAX wardrobe: 500-1,500 | HEMNES: 400-1,000
IKEA POÄNG: 150-300 | LACK table: 30-80 | BESTA: 300-700
Herman Miller Aeron: 2,500-4,500 | IKEA MARKUS: 300-500
Sofa 3-seat good brand: 1,000-3,500 | IKEA sofa: 500-1,500
Dining table + chairs: 500-2,500

CLOTHING & SHOES — Second-hand (₪, Good):
Nike Air Force 1: 150-280 | Air Max 90: 200-350 | Air Jordan 1: 300-600
Adidas Superstar: 120-220 | Stan Smith: 120-220 | Ultraboost: 250-400 | Yeezy: 500-1,200
New Balance 990: 400-650 | 530: 150-280 | 574: 120-220
The North Face jacket: 250-600 | Columbia: 150-400
Levi's jeans: 80-200 | Diesel jeans: 150-350
Designer bags (LV, Gucci): varies widely — 30-70% of retail depending on model/condition
Zara/H&M/Mango: 30-50% of retail

WATCHES — Second-hand (₪, Good):
Rolex Submariner: 30,000-42,000 | Datejust: 25,000-35,000 | GMT-Master: 45,000-60,000
Omega Speedmaster: 15,000-22,000 | Seamaster: 10,000-18,000
Tag Heuer Carrera: 3,000-8,000 | Aquaracer: 2,500-5,000
Apple Watch Ultra 2: 2,000-2,600 | Series 9: 900-1,400 | SE: 500-800
Garmin Fenix 7: 1,500-2,200 | Venu 3: 800-1,200
Casio G-Shock: 150-500 | Tissot: 800-2,500

SPORTS & OUTDOOR — Second-hand (₪, Good):
Road bike mid-range: 1,500-4,000 | Mountain bike: 1,000-3,000 | Kids bike: 150-500
Electric scooter Xiaomi: 800-1,200 | Ninebot: 1,000-1,800
Treadmill: 800-3,000 | Exercise bike: 500-2,000 | Dumbbells set: 200-800

BABY & KIDS — Second-hand (₪, Good):
Bugaboo Fox: 1,500-2,800 | Bugaboo Bee: 800-1,500
Babyzen Yoyo: 1,000-1,800 | Baby Jogger City: 600-1,200
Cybex car seat: 300-900 | Maxi-Cosi: 200-700
LEGO large set: 100-600 | LEGO small: 30-100
Playmobil: 30-150

CAMERAS & DRONES — Second-hand (₪, Good):
DJI Mini 4 Pro: 2,200-3,000 | DJI Air 3: 3,000-4,000 | Mavic 3: 5,000-8,000
GoPro Hero 12: 1,000-1,500 | Hero 11: 700-1,000
Sony A7 IV body: 5,000-7,000 | A7 III: 3,000-4,500
Canon R6 II: 5,500-7,500 | R6: 3,500-5,000
Fujifilm X-T5: 4,500-6,000 | X-T4: 3,000-4,000

MUSICAL INSTRUMENTS — Second-hand (₪, Good):
Fender Stratocaster MIM: 1,500-2,500 | Squier: 500-1,000
Gibson Les Paul Standard: 5,000-9,000 | Epiphone: 800-1,800
Yamaha acoustic: 300-1,200 | Taylor: 2,000-5,000
Yamaha keyboard PSR: 400-1,200 | Roland: 1,000-3,000

TOOLS — Second-hand (₪, Good):
Makita drill set: 300-700 | DeWalt: 350-800 | Bosch: 250-600
Pressure washer: 300-800

GENERAL RULES FOR UNLISTED ITEMS:
- Electronics lose 30-50% of retail in first year, then 15-20% per year
- Furniture loses 40-60% immediately, then holds value
- Clothing loses 50-70% unless designer/rare
- Items in sealed/new condition: add 20-30% to the used prices above
- Items in fair/poor condition: subtract 30-50% from the used prices above

STEP 3 — ASSESS CONDITION:
- New Sealed: still sealed in original packaging → top of price range + 15-25%
- Like New: opened, barely used, looks new → top of price range
- Excellent: light use, very minor marks → middle-high of price range
- Good: regular use, visible wear → middle of price range (base prices above)
- Fair: heavy use, cosmetic issues → bottom of range - 20%
- Poor: damaged, parts missing → 40-60% below range

STEP 4 — SET THREE PRICE TIERS:
- LOW (מכירה מהירה): sell within 1-2 days on Yad2/Facebook. ~85% of MID
- MID (מחיר שוק): fair market price, sells within 1-2 weeks
- HIGH (מחיר סבלני): patient seller, top of market, may take weeks. ~120% of MID

CRITICAL RULES:
- All prices MUST be in ₪ (ILS) — NEVER USD
- NEVER return 0 for sellable items
- These are SECOND-HAND prices, not new retail
- newRetailPrice = what the item costs NEW in Israeli stores (KSP, Bug, iDigital)
- The main prices (low/mid/high) = what it sells for USED on Yad2/Facebook
- If exact model isn't listed, find closest match and adjust
- Food, medicine, opened cosmetics → isSellable: false
- Be honest about confidence — lower it if you can't identify exactly`;

    const userPrompt = isHebrew
      ? `זהה את הפריט בתמונה ותמחר אותו לשוק היד-שנייה הישראלי (יד2, פייסבוק מרקטפלייס).

ענה אך ורק ב-JSON תקין (ללא markdown, ללא backticks):
{"name":"שם באנגלית (מותג + דגם)","nameHebrew":"שם בעברית","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"יד2 / פייסבוק מרקטפלייס"},"details":{"description":"תיאור (2-3 משפטים)","brand":"מותג","model":"דגם","year":"שנה","identificationNotes":"מה בתמונה עזר לזהות","additionalInfo":"מידע נוסף"},"priceFactors":[{"factor":"גורם","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"טיפ למכירה מהירה ביד2 או פייסבוק","whereToBuy":"איפה למכור (יד2, פייסבוק, קבוצות ווטסאפ)","israeliMarketNotes":"הערות לשוק הישראלי"}`
      : `Identify this item and price it for the Israeli second-hand market (Yad2, Facebook Marketplace).

Respond ONLY with valid JSON (no markdown, no backticks):
{"name":"English name (Brand + Model)","nameHebrew":"שם בעברית","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"Yad2 / Facebook Marketplace"},"details":{"description":"Description (2-3 sentences)","brand":"Brand","model":"Model","year":"Year","identificationNotes":"What in the image helped identify","additionalInfo":"Additional info"},"priceFactors":[{"factor":"Factor","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"Tip for quick sale on Yad2 or Facebook","whereToBuy":"Where to sell (Yad2, Facebook, WhatsApp groups)","israeliMarketNotes":"Israeli market notes"}`;

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

    // Post-processing: validate and clean
    try {
      if (data.content?.[0]?.text) {
        let raw = data.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(raw);

        if (parsed.marketValue && parsed.isSellable !== false) {
          const mv = parsed.marketValue;
          mv.low = Math.max(0, Math.round(mv.low || 0));
          mv.mid = Math.max(0, Math.round(mv.mid || 0));
          mv.high = Math.max(0, Math.round(mv.high || 0));
          if (mv.newRetailPrice) mv.newRetailPrice = Math.round(mv.newRetailPrice);
          // Ensure low ≤ mid ≤ high
          if (mv.low > mv.mid) mv.low = Math.round(mv.mid * 0.85);
          if (mv.high < mv.mid) mv.high = Math.round(mv.mid * 1.2);
          if (mv.mid <= 0) { mv.mid = 50; mv.low = 40; mv.high = 65; }
        }

        if (parsed.isSellable === false) {
          parsed.marketValue = { low: 0, mid: 0, high: 0, currency: 'ILS', newRetailPrice: 0 };
        }

        if (typeof parsed.confidence === 'number') {
          parsed.confidence = Math.min(1, Math.max(0, parsed.confidence));
        }

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
