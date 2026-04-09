import { createClient } from '@supabase/supabase-js';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const VK = process.env.VOYAGE_API_KEY;
function bt(p){return[...new Set([p.brand,p.model,p.name,p.name_hebrew,p.category,p.subcategory,...(p.keywords||[])].filter(Boolean).map(s=>s.toLowerCase()))].join(' ');}
async function ge(texts){const r=await fetch('https://api.voyageai.com/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+VK},body:JSON.stringify({model:'voyage-3',input:texts,input_type:'document'})});if(!r.ok)throw new Error('Voyage '+r.status);return(await r.json()).data.map(d=>d.embedding);}
async function main(){
console.log('\n=== SEED EMBEDDINGS ===\n');
const{count:total}=await supa.from('products').select('id',{count:'exact',head:true});
console.log('Products in DB:',total);
const{count:done}=await supa.from('products').select('id',{count:'exact',head:true}).not('text_embedding','is',null);
console.log('Already embedded:',done);
const{data:prods}=await supa.from('products').select('id,name,name_hebrew,brand,model,category,subcategory,keywords').is('text_embedding',null).order('id');
if(!prods||!prods.length){console.log('\nAll done!\n');return;}
console.log('Need embeddings:',prods.length,'\n');
let ok=0,fail=0;
for(let i=0;i<prods.length;i+=32){
const b=prods.slice(i,i+32);
try{const embs=await ge(b.map(bt));
for(let j=0;j<b.length;j++){const{error}=await supa.from('products').update({text_embedding:embs[j]}).eq('id',b[j].id);error?fail++:ok++;}
console.log('  Batch',Math.floor(i/32)+1,':',b[0].brand,'->',b[b.length-1].brand);
if(i+32<prods.length)await new Promise(r=>setTimeout(r,500));
}catch(e){console.error('  Batch failed:',e.message);fail+=b.length;}}
const{count:fin}=await supa.from('products').select('id',{count:'exact',head:true}).not('text_embedding','is',null);
console.log('\n=== DONE ===\nEmbedded:',ok,'\nErrors:',fail,'\nTotal with embeddings:',fin,'/',total,'\n');
}
main().catch(e=>{console.error(e);process.exit(1)});
