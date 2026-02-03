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
    const { imageData } = await req.json();
    
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
              text: `You are an expert item appraiser specializing in the ISRAELI MARKET. Analyze this image and identify the item.

IMPORTANT: 
- All prices MUST be in Israeli New Shekel (ILS/₪)
- Base your valuations on Israeli market prices (Yad2, Facebook Marketplace Israel, Israeli retail prices)
- Consider Israeli import taxes and local availability
- Factor in that electronics are typically 20-40% more expensive in Israel than US

Respond ONLY with valid JSON (no markdown, no backticks):
{
  "name":"Item name (in English)",
  "nameHebrew":"שם הפריט (in Hebrew if applicable)",
  "category":"Food/Electronics/Vehicles/Watches/Clothing/Furniture/Sports/Other",
  "confidence":0.85,
  "isSellable":true,
  "condition":"New/Like New/Good/Fair/Poor",
  "marketValue":{
    "low":0,
    "mid":0,
    "high":0,
    "currency":"ILS"
  },
  "details":{
    "description":"Brief description",
    "brand":"Brand or Unknown",
    "additionalInfo":"Details relevant to Israeli market"
  },
  "priceFactors":[
    {"factor":"Factor affecting Israeli price","impact":"+₪X-Y"}
  ],
  "marketTrend":"up/down/stable/not-applicable",
  "demandLevel":"high/moderate/low/not-applicable",
  "sellingTips":"Tip for selling in Israel (mention Yad2, Facebook groups, etc.)",
  "whereToBuy":"Where to buy/sell in Israel (e.g., Yad2, KSP, Ivory, Bug, Facebook Marketplace Israel)",
  "israeliMarketNotes":"Any specific notes about this item in the Israeli market"
}`
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
