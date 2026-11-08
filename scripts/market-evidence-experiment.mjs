// Run 2026-11-08: results in scripts/benchmarks/market-evidence-2026-11-08.json (10 products, $0.2129; PS5 re-run $0.0235).
// Controlled market-evidence experiment: 10 products through the production price step (service.js runPrice), with a
// hard spend cap enforced from each call's own usage at published prices. In-memory store: nothing is written anywhere.
// Usage: node --env-file=<env> run.mjs <repo> <out.json> [ids...]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [repo, outFile, ...only] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(`${repo}/${p}`).href);
const { runPrice } = await imp('api/_lib/scan/service.js');
const { normalizeIdentity } = await imp('api/_lib/scan/identify.js');
// gpt-6-luna + web search, developers.openai.com/api/docs/pricing (read 2026-11-08)
const PRICE = { in: 0.10 / 1e6, out: 0.50 / 1e6, search: 0.01 };
const CAP = 1.0;
const WORST_NEXT = 0.10;
const LEDGER = `${outFile}.spend`;
const base = { is_sellable_item: true, visible_text: [], model_number: null, variant: null, color: null, size_or_capacity: null, configuration: 'complete_item', included_items: [], exact_model_established: true, alternatives: [], identity_confidence: 'high', uncertainty_note: null, visible_condition: 'good', condition_notes: [], listing_description: '', followup: { kind: 'none', affects: 'none', question: null, options: [] }, attributes: [], clarifications: [], eligibility_notes: [] };
const P = (id, o) => ({ id, raw: { ...base, ...o } });
const PRODUCTS = [
  P('iphone13', { category: 'Electronics', item_type: 'smartphone', brand: 'Apple', product_family: 'iPhone', model: 'iPhone 13', size_or_capacity: '128 GB', display_name: 'Apple iPhone 13 128GB', canonical_name: 'apple iphone 13', market_class: 'consumer_electronics', identity_precision: 'exact_model', search: { hebrew_name: 'אייפון 13', aliases: [], model_numbers: [] }, attributes: [{ name: 'storage', value: '128 GB', basis: 'observed', matters: 'high' }] }),
  P('ps5', { category: 'Electronics', item_type: 'game console', brand: 'Sony', product_family: 'PlayStation', model: 'PlayStation 5', variant: 'Disc Edition', display_name: 'Sony PlayStation 5 Disc Edition', canonical_name: 'sony playstation 5', market_class: 'consumer_electronics', identity_precision: 'exact_model', search: { hebrew_name: 'פלייסטיישן 5', aliases: ['PS5'], model_numbers: [] } }),
  P('airpodspro2', { category: 'Electronics', item_type: 'wireless earbuds', brand: 'Apple', product_family: 'AirPods', model: 'AirPods Pro (2nd generation)', display_name: 'Apple AirPods Pro 2', canonical_name: 'apple airpods pro 2', market_class: 'consumer_electronics', identity_precision: 'exact_model', search: { hebrew_name: 'איירפודס פרו 2', aliases: [], model_numbers: [] } }),
  P('switcholed', { category: 'Electronics', item_type: 'game console', brand: 'Nintendo', product_family: 'Switch', model: 'Switch OLED', display_name: 'Nintendo Switch OLED', canonical_name: 'nintendo switch oled', market_class: 'consumer_electronics', identity_precision: 'exact_model', search: { hebrew_name: 'נינטנדו סוויץ OLED', aliases: [], model_numbers: [] } }),
  P('dysonv11', { category: 'Home', item_type: 'cordless vacuum cleaner', brand: 'Dyson', product_family: 'V11', model: 'V11', display_name: 'Dyson V11', canonical_name: 'dyson v11', market_class: 'consumer_electronics', identity_precision: 'exact_model', search: { hebrew_name: 'שואב אבק דייסון V11', aliases: [], model_numbers: [] } }),
  P('poang', { category: 'Furniture', item_type: 'armchair', brand: 'IKEA', product_family: 'POÄNG', model: 'POÄNG armchair', display_name: 'IKEA POÄNG armchair', canonical_name: 'ikea poang armchair', market_class: 'furniture', identity_precision: 'descriptive', search: { hebrew_name: 'כורסת פואנג איקאה', aliases: [], model_numbers: [] } }),
  P('eos5d3', { category: 'Electronics', item_type: 'DSLR camera body', brand: 'Canon', product_family: 'EOS', model: 'EOS 5D Mark III', display_name: 'Canon EOS 5D Mark III', canonical_name: 'canon eos 5d mark iii', market_class: 'consumer_electronics', identity_precision: 'exact_model', configuration: 'base_only', search: { hebrew_name: 'מצלמה קנון 5D Mark III', aliases: [], model_numbers: [] } }),
  P('corolla2018', { category: 'Vehicles', item_type: 'car', brand: 'Toyota', product_family: 'Corolla', model: 'Corolla', display_name: 'Toyota Corolla 2018', canonical_name: 'toyota corolla', market_class: 'vehicle', identity_precision: 'exact_model', search: { hebrew_name: 'טויוטה קורולה 2018', aliases: [], model_numbers: [] }, attributes: [{ name: 'year', value: '2018', basis: 'confirmed', matters: 'high' }] }),
  P('watch8', { category: 'Electronics', item_type: 'smartwatch', brand: 'Apple', product_family: 'Apple Watch', model: 'Apple Watch Series 8', size_or_capacity: '45 mm', display_name: 'Apple Watch Series 8 45mm', canonical_name: 'apple watch series 8', market_class: 'consumer_electronics', identity_precision: 'exact_model', search: { hebrew_name: 'אפל ווטש סדרה 8', aliases: [], model_numbers: [] } }),
  P('bugaboofox', { category: 'Other', item_type: 'baby stroller', brand: 'Bugaboo', product_family: 'Fox', model: 'Fox 3', display_name: 'Bugaboo Fox 3', canonical_name: 'bugaboo fox 3', market_class: 'other', identity_precision: 'exact_model', search: { hebrew_name: 'עגלת בוגבו פוקס 3', aliases: [], model_numbers: [] } }),
];
// The spend ledger persists across runs, so the cap covers the whole experiment, not one invocation.
let spent = fs.existsSync(LEDGER) ? Number(fs.readFileSync(LEDGER, 'utf8')) : 0;
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : [];
for (const p of PRODUCTS.filter((x) => !only.length || only.includes(x.id))) {
  if (out.some((o) => o.id === p.id)) continue;
  if (spent + WORST_NEXT > CAP) { console.log(`STOP before ${p.id}: spent $${spent.toFixed(4)}`); break; }
  const identity = normalizeIdentity(p.raw);
  const discovered = new Set();
  const fetchImpl = async (url, init) => {
    const res = await fetch(url, init);
    if (!String(url).includes('api.openai.com')) return res;
    const text = await res.text();
    if (process.env.EXP_RAW) fs.appendFileSync(process.env.EXP_RAW, text + '\n===\n');
    for (const m of text.matchAll(/"url"\s*:\s*"(https?:[^"]+)"/g)) discovered.add(m[1]);
    return new Response(text, { status: res.status, headers: res.headers });
  };
  const mem = new Map();
  const t0 = Date.now();
  const r = await runPrice({ identity, scanUuid: crypto.randomUUID(), model: 'gpt-6-luna', apiKey: process.env.OPENAI_API_KEY, fetchImpl,
    store: { load: async (k) => mem.get(k) ?? null, save: async (k, v) => { mem.set(k, v); } }, marketplace: async () => [], background: async () => {} });
  const u = r.call?.usage ?? {};
  const cost = (u.input_tokens ?? 0) * PRICE.in + (u.output_tokens ?? 0) * PRICE.out + (r.call?.tool_calls ?? 0) * PRICE.search;
  spent += cost;
  fs.writeFileSync(LEDGER, String(spent));
  const v = r.valuation ?? {};
  out.push({ id: p.id, name: identity.display_name, strategy: v.strategy, status: r.status, failure: r.failure ?? null, ms: Date.now() - t0, cost: Math.round(cost * 10000) / 10000,
    tokens: u, tool_calls: r.call?.tool_calls ?? null, stages: r.call?.stages ?? null, searched: v.searched ?? null,
    prices: v.prices ?? null, withdrawn: v.withdrawn ?? null, confidence: v.price_confidence ?? null, gap: v.evidence_gap ?? null, retail_new_ils: v.retail_new_ils ?? null, counts: v.counts ?? null,
    evidence: (v.evidence ?? []).map((e) => ({ url: e.url, domain: e.domain, kind: e.kind, market: e.market, match: e.match, price: e.price, currency: e.currency, ils: e.price_ils, condition: e.condition, listed: e.listed, archived: e.archived, freshness: e.freshness, binding: e.binding, binding_reason: e.binding_reason, used: e.used, why: e.set_aside ?? null })),
    discovered: [...discovered] });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(p.id, r.status, `${Date.now() - t0}ms`, `$${cost.toFixed(4)}`, `total $${spent.toFixed(4)}`, 'evidence', (v.evidence ?? []).length, 'used', (v.evidence ?? []).filter((e) => e.used).length, 'discovered', discovered.size);
}
console.log(`SPENT total $${spent.toFixed(4)}`);
