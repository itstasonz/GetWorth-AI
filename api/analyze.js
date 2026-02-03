export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // Handle CORS preflight
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
    
    const prompt = isHebrew 
      ? `אתה מומחה להערכת שווי פריטים בשוק הישראלי. נתח את התמונה וזהה את הפריט.

חשוב מאוד:
- כל המחירים חייבים להיות בשקלים חדשים (₪)
- בסס את ההערכה על מחירי השוק הישראלי (יד2, פייסבוק מרקטפלייס ישראל, מחירי קמעונאות בישראל)
- קח בחשבון מיסי יבוא ישראליים וזמינות מקומית
- מוצרי אלקטרוניקה בישראל יקרים ב-20-40% יותר מארה"ב

ענה אך ורק ב-JSON תקין (ללא markdown, ללא backticks):
{"name":"שם הפריט באנגלית","nameHebrew":"שם הפריט בעברית","category":"Food/Electronics/Vehicles/Watches/Clothing/Furniture/Sports/Other","confidence":0.85,"isSellable":true,"condition":"חדש/כמו חדש/מצוין/טוב/סביר/גרוע","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS"},"details":{"description":"תיאור קצר בעברית","brand":"מותג או לא ידוע","additionalInfo":"פרטים נוספים בעברית"},"priceFactors":[{"factor":"גורם המשפיע על המחיר","impact":"+₪X-Y"}],"marketTrend":"up/down/stable/not-applicable","demandLevel":"high/moderate/low/not-applicable","sellingTips":"טיפ למכירה בעברית (הזכר יד2, קבוצות פייסבוק וכו׳)","whereToBuy":"איפה לקנות/למכור בישראל (למשל: יד2, KSP, באג, זאפ, פייסבוק מרקטפלייס)","israeliMarketNotes":"הערות ספציפיות לשוק הישראלי בעברית"}`
      : `You are an expert item appraiser specializing in the ISRAELI MARKET. Analyze this image and identify the item.

IMPORTANT: 
- All prices MUST be in Israeli New Shekel (ILS/₪)
- Base your valuations on Israeli market prices (Yad2, Facebook Marketplace Israel, Israeli retail prices)
- Consider Israeli import taxes and local availability
- Electronics are typically 20-40% more expensive in Israel than US

Respond ONLY with valid JSON (no markdown, no backticks):
{"name":"Item name in English","nameHebrew":"שם הפריט בעברית","category":"Food/Electronics/Vehicles/Watches/Clothing/Furniture/Sports/Other","confidence":0.85,"isSellable":true,"condition":"New/Like New/Excellent/Good/Fair/Poor","marketValue":{"low":0,"mid":0,"high":0,"currency":"ILS"},"details":{"description":"Brief description","brand":"Brand or Unknown","additionalInfo":"Details relevant to Israeli market"},"priceFactors":[{"factor":"Factor affecting Israeli price","impact":"+₪X-Y"}],"marketTrend":"up/down/stable/not-applicable","demandLevel":"high/moderate/low/not-applicable","sellingTips":"Tip for selling in Israel (mention Yad2, Facebook groups, etc.)","whereToBuy":"Where to buy/sell in Israel (e.g., Yad2, KSP, Bug, Zap, Facebook Marketplace Israel)","israeliMarketNotes":"Any specific notes about this item in the Israeli market"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
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
              text: prompt
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
