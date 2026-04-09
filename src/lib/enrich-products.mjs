import { createClient } from '@supabase/supabase-js';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log('=== ENRICH PRODUCTS ===');
  const { data: products, error } = await supa.from('products')
    .select('id,name,name_hebrew,brand,model,category,subcategory,keywords').order('id');
  if (error) { console.error(error.message); process.exit(1); }
  console.log('Products:', products.length);
  let ok = 0, fail = 0;
  for (const p of products) {
    const ocr = [...new Set([p.brand,p.model,p.name,p.name_hebrew,...(p.keywords||[])].filter(Boolean).flatMap(s => s.split(/[\s/]+/).map(w => w.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff\-]/g,'')).filter(w => w.length >= 2)))];
    const models = [...new Set((`${p.name} ${p.model} ${(p.keywords||[]).join(' ')}`).match(/\b[A-Z]{0,4}\d{1,5}[-/]?[A-Z0-9]{0,10}\b/gi)?.filter(m => m.length >= 3 && m.length <= 20) || []).values()].map(m => m.toUpperCase());
    const aliases = [...new Set([p.name?.toLowerCase(), p.name_hebrew, p.model?.toLowerCase(), p.brand && p.model ? `${p.brand} ${p.model}`.toLowerCase() : null].filter(Boolean))];
    const cat = (p.subcategory||'').toLowerCase();
    const brand = (p.brand||'').toLowerCase();
    const serial = (cat==='smartphone'||cat==='tablet') ? '^\\d{15}$' : brand==='apple' ? '^[A-Z0-9]{10,14}$' : brand==='samsung' ? '^[A-Z0-9]{11,15}$' : ['laptop','camera','gaming console','smartwatch','monitor','tv'].includes(cat) ? '^[A-Z0-9]{6,20}$' : null;
    const { error: e } = await supa.from('products').update({ ocr_keywords: ocr, model_numbers: models, aliases, serial_pattern: serial, country_market: 'IL', confidence_weight: 1.0 }).eq('id', p.id);
    e ? fail++ : ok++;
  }
  console.log('Updated:', ok, 'Errors:', fail);
}
main().catch(e => { console.error(e); process.exit(1); });