export const config = {
  maxDuration: 30,
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

    const systemPrompt = `You are GetWorth AI — a senior item appraiser with 15 years of experience in the Israeli second-hand market.

STEP-BY-STEP METHODOLOGY (follow for EVERY item):

STEP 1 — IDENTIFY:
- Look for brand logos, model numbers, labels, barcodes, packaging text, distinctive design
- Be SPECIFIC: "iPhone 15 Pro Max 256GB Natural Titanium" not just "iPhone"
- Read ANY text visible on the item or packaging

STEP 2 — ISRAELI RETAIL PRICE (what it costs NEW in Israeli stores):

ELECTRONICS — Reference prices (₪, as of early 2026):
Apple: iPhone 16 Pro Max: 5,800-6,800 | iPhone 16 Pro: 4,800-5,500 | iPhone 16: 3,800-4,200 | iPhone 15: 3,200-3,600 | iPhone 14: 2,600-3,000 | iPhone SE: 2,100-2,400
Apple: MacBook Air M3: 5,500-7,000 | MacBook Pro 14" M3: 8,000-12,000 | MacBook Pro 16": 12,000-18,000
Apple: iPad Pro M4: 5,000-7,500 | iPad Air M2: 2,800-3,500 | iPad 10th: 1,800-2,200 | iPad mini: 2,400-2,800
Apple: AirPods Pro 2: 900-1,050 | AirPods 4: 550-750 | AirPods Max: 2,200-2,500
Apple: Apple Watch Ultra 2: 3,500-3,800 | Series 9: 1,800-2,200 | SE: 1,100-1,300
Samsung: Galaxy S24 Ultra: 4,500-5,200 | S24+: 3,800-4,200 | S24: 3,200-3,600 | S23: 2,400-2,800
Samsung: Galaxy Z Fold5: 6,500-7,200 | Z Flip5: 3,800-4,200 | A54: 1,400-1,600 | A34: 1,000-1,200
Samsung: Galaxy Tab S9: 3,000-4,500 | Tab A9: 800-1,200
Google: Pixel 8 Pro: 3,500-4,000 | Pixel 8: 2,800-3,200 | Pixel 7a: 1,800-2,200
Sony: PlayStation 5: 2,200-2,500 | PS5 Digital: 1,800-2,000 | PS5 game: 200-280 | PS4: 1,000-1,200
Microsoft: Xbox Series X: 2,100-2,400 | Series S: 1,200-1,400 | Xbox game: 200-260
Nintendo: Switch OLED: 1,500-1,800 | Switch: 1,200-1,400 | Switch game: 150-220
Sony: WH-1000XM5: 1,300-1,600 | WH-1000XM4: 900-1,100 | WF-1000XM5 earbuds: 900-1,100
Bose: QC Ultra headphones: 1,500-1,800 | QC45: 1,000-1,300 | SoundLink: 400-800
JBL: Flip 6: 350-450 | Charge 5: 550-700 | Xtreme 3: 1,100-1,400 | Go 3: 150-200
Marshall: Stanmore III: 1,800-2,200 | Emberton II: 600-750 | Minor IV earbuds: 350-450
Beats: Studio Pro: 1,200-1,500 | Solo 4: 800-1,000 | Fit Pro: 700-850
DJI: Mini 4 Pro: 3,500-4,200 | Air 3: 4,500-5,500 | Mavic 3: 8,000-12,000
GoPro: Hero 12: 1,800-2,200 | Hero 11: 1,400-1,700
LG: C3 55" OLED: 4,500-5,500 | B3 55": 3,500-4,200 | 65" models: +1,500-2,000
Samsung TV: QN90C 55": 4,000-5,000 | Crystal UHD 55": 2,200-2,800
Dyson: V15: 2,800-3,200 | V12: 2,200-2,600 | V8: 1,400-1,700 | Airwrap: 2,200-2,800
Robot vacuums: iRobot Roomba i7: 2,000-2,500 | Roborock S8: 2,500-3,000 | Ecovacs: 1,500-2,500
Monitors: Dell 27" 4K: 1,800-2,500 | LG 27" 4K: 1,600-2,200 | Samsung 32": 1,200-2,000
Keyboards: Logitech MX Keys: 450-550 | Apple Magic Keyboard: 400-750
Mice: Logitech MX Master 3S: 350-450 | Apple Magic Mouse: 300-400
Printers: HP LaserJet: 800-1,500 | Epson EcoTank: 900-1,400

HOME & KITCHEN:
Nespresso: Vertuo: 600-900 | Original: 400-600 | Capsules 10-pack: 20-40
DeLonghi espresso: 1,500-3,500 | Breville: 2,000-4,000
KitchenAid mixer: 2,500-3,500 | Kenwood: 1,800-2,800
Air fryer: Ninja: 500-800 | Philips: 600-900 | Xiaomi: 300-450
Instant Pot: 400-600 | Slow cooker: 200-400
Vitamix blender: 2,500-3,500 | Ninja blender: 400-700

FURNITURE:
IKEA: KALLAX shelf: 200-500 | MALM dresser: 500-1,000 | BILLY bookcase: 150-350 | LACK table: 80-150 | HEMNES: 800-2,000 | PAX wardrobe: 1,500-3,500 | POÄNG chair: 400-600
Office: Herman Miller Aeron: 5,000-7,000 | IKEA MARKUS: 800-1,000 | Standing desk: 1,500-3,000
Mattress: Good quality queen: 3,000-6,000 | IKEA mattress: 1,000-2,500
Sofa: IKEA 3-seat: 2,500-5,000 | Premium brands: 5,000-15,000

CLOTHING & FASHION:
Nike: Air Force 1: 400-500 | Air Max 90: 500-650 | Air Jordan 1: 550-800 | Running shoes: 400-700
Adidas: Superstar: 350-450 | Stan Smith: 350-450 | Ultraboost: 600-800 | Yeezy: 800-1,500
New Balance: 530: 400-500 | 990: 700-900 | 574: 350-450
Zara: Dress: 150-350 | Jacket: 250-500 | Pants: 150-300
H&M: Basics: 50-150 | Premium: 150-300
Mango: Dress: 200-400 | Coat: 400-800
The North Face jacket: 600-1,200 | Columbia: 400-800
Levi's jeans: 300-450 | Diesel: 500-800

WATCHES:
Luxury: Rolex Submariner: 35,000-45,000 | Datejust: 30,000-40,000 | Omega Speedmaster: 20,000-30,000 | Seamaster: 15,000-25,000
Mid-range: Tag Heuer: 5,000-15,000 | Longines: 3,000-8,000 | Tissot: 1,500-4,000
Fashion: Daniel Wellington: 400-600 | Fossil: 400-700 | Casio G-Shock: 300-800 | Swatch: 300-500
Smart: Garmin Fenix 7: 2,500-3,500 | Garmin Venu: 1,200-1,800

SPORTS & FITNESS:
Bicycle: Road bike mid-range: 3,000-8,000 | Mountain bike: 2,000-6,000 | Kids bike: 500-1,500
Electric scooter: Xiaomi M365: 1,500-2,000 | Ninebot: 1,800-3,000
Treadmill: 2,000-6,000 | Exercise bike: 1,500-4,000 | Dumbbells set: 500-1,500
Surfboard: 1,500-4,000 | SUP: 2,000-4,000
Tennis racket: 300-800 | Football (soccer ball): 100-400

BABY & KIDS:
Stroller: Bugaboo: 3,000-5,000 | Chicco: 800-1,500 | Baby Jogger: 1,500-3,000 | Yoyo: 2,000-3,000
Car seat: Cybex: 800-2,000 | Maxi-Cosi: 600-1,500 | Britax: 700-1,500
Crib: 1,000-3,000 | High chair: 300-1,200
LEGO sets: Small: 80-200 | Medium: 200-500 | Large/Technic: 500-1,500

BEAUTY & PERSONAL CARE:
Dyson Airwrap: 2,200-2,800 | Supersonic: 1,800-2,200
GHD Platinum+: 800-1,100 | Gold: 600-800
Oral-B iO: 600-1,000 | Philips Sonicare: 400-700
Philips OneBlade: 150-250 | Braun Series 9: 800-1,200

MUSICAL INSTRUMENTS:
Guitar: Fender Stratocaster: 3,000-6,000 | Yamaha acoustic: 800-2,000 | Epiphone: 1,500-3,000
Keyboard: Yamaha PSR: 800-2,000 | Roland: 2,000-5,000 | Casio: 500-1,500
Drums: Electronic kit: 2,000-5,000 | Acoustic: 3,000-8,000

BOOKS:
Hebrew novels: 50-100 | Textbooks: 100-300 | Coffee table books: 100-250

GENERAL RULE: If item not listed above, Israeli retail = US price × 1.3 (for 17% VAT + import duties)

STEP 3 — CONDITION (based ONLY on what you see):
- New Sealed: factory sealed, original packaging
- Like New: opened, barely used, no visible wear
- Excellent: light use, very minor marks
- Good: regular use, visible normal wear
- Fair: heavy use, noticeable cosmetic issues
- Poor: damaged, parts missing

STEP 4 — SECOND-HAND PRICE (from Israeli retail):
- New Sealed: 75-90% of retail
- Like New: 60-75%
- Excellent: 45-60%
- Good: 30-45%
- Fair: 15-30%
- Poor: 5-15%
High-demand (Apple, PlayStation, Nike Jordan, Dyson): use UPPER range
Low-demand (generic, seasonal, old tech): use LOWER range

STEP 5 — THREE TIERS:
- LOW: quick sale, ~80% of mid
- MID: fair market value
- HIGH: patient seller, ~125% of mid

CRITICAL:
- All prices in ₪ (ILS) — NEVER USD
- NEVER return 0 for sellable items
- Food/medicine/consumables → isSellable: false, all prices 0
- Be honest about confidence — lower it if you can't identify the exact model`;

    const userPrompt = isHebrew
      ? `זהה את הפריט בתמונה ותמחר אותו לשוק הישראלי.

ענה אך ורק ב-JSON תקין (ללא markdown, ללא backticks, ללא טקסט נוסף):
{"name":"שם באנגלית (מותג + דגם)","nameHebrew":"שם בעברית","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"מקור הערכה (למשל: מחיר קמעונאי ישראלי, KSP, באג)"},"details":{"description":"תיאור (2-3 משפטים)","brand":"מותג","model":"דגם","year":"שנה","identificationNotes":"מה בתמונה עזר לזהות","additionalInfo":"מידע נוסף"},"priceFactors":[{"factor":"גורם","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"טיפ למכירה","whereToBuy":"איפה למכור","israeliMarketNotes":"הערות לשוק הישראלי"}`
      : `Identify this item and price it for the Israeli market.

Respond ONLY with valid JSON (no markdown, no backticks, no extra text):
{"name":"English name (Brand + Model)","nameHebrew":"שם בעברית","category":"Electronics/Furniture/Vehicles/Watches/Clothing/Sports/Beauty/Books/Toys/Home/Tools/Music/Food/Other","confidence":0.85,"isSellable":true,"condition":"New Sealed/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS","newRetailPrice":0,"priceSource":"pricing source (e.g., Israeli retail, KSP, Bug)"},"details":{"description":"Description (2-3 sentences)","brand":"Brand","model":"Model","year":"Year","identificationNotes":"What in the image helped identify","additionalInfo":"Additional info"},"priceFactors":[{"factor":"Factor","impact":"+/- ₪X","direction":"up/down"}],"marketTrend":"up/down/stable","demandLevel":"high/moderate/low","sellingTips":"Selling tip","whereToBuy":"Where to sell","israeliMarketNotes":"Israeli market notes"}`;

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
          if (mv.low > mv.mid) mv.low = Math.round(mv.mid * 0.8);
          if (mv.high < mv.mid) mv.high = Math.round(mv.mid * 1.25);
          if (mv.mid <= 0) { mv.mid = 50; mv.low = 35; mv.high = 70; }
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
