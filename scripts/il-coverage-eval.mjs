#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// ISRAELI SECOND-HAND PRICE COVERAGE — a fixed 20-item evaluation of the price step
//
//   node --env-file=<env> scripts/il-coverage-eval.mjs record <dir> [ids...]   LIVE, PAID (hard cap below)
//   node scripts/il-coverage-eval.mjs replay <dir> <repo-or-copy> <out.json>     OFFLINE, free
//
// record  runs each item through the production price step (service.js runPrice) with the production model, an
//         in-memory store and no marketplace, and keeps every OpenAI response it received, BY STAGE, in <dir>. Both
//         stages are always kept whole (the wider one is not cut off when the server decides it is not needed), so a
//         replay can answer whichever stages the code under test asks for.
// replay  answers the price step's OpenAI requests from those recordings and nothing else, against any copy of the
//         code (the release before a change, and after it): the same search results, so a difference in the outcome
//         is the code's. Exchange rates are fetched live (Bank of Israel), as in production.
//
// The set was fixed BEFORE any run (2026-11-12) and is not chosen for being easy to price: phones and consoles that
// sell every day, a camera body, appliances, furniture sold by description, a stroller, a bicycle, a scooter, a guitar.
// Identities are written as the identify step returns them; no photograph is involved (that is identify's benchmark).
// ══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// gpt-6-luna + web search at published prices (scripts/market-evidence-experiment.mjs, read 2026-11-08).
const PRICE = { in: 0.10 / 1e6, out: 0.50 / 1e6, search: 0.01 };
const CAP_USD = 1.5;
const WORST_NEXT_USD = 0.12;
const MODEL = 'gpt-6-luna';
// One fixed day for both replays, so a listing's age is measured the same way.
const NOW = Date.parse('2026-11-12T13:00:00Z');

const base = { is_sellable_item: true, visible_text: [], model_number: null, variant: null, color: null, size_or_capacity: null, configuration: 'complete_item', included_items: [], exact_model_established: true, alternatives: [], identity_confidence: 'high', uncertainty_note: null, visible_condition: 'good', condition_notes: [], listing_description: '', followup: { kind: 'none', affects: 'none', question: null, options: [] }, attributes: [], clarifications: [], eligibility_notes: [], market_class: 'consumer_electronics', identity_precision: 'exact_model' };
const P = (id, o) => ({ id, raw: { ...base, ...o, search: { aliases: [], model_numbers: [], ...o.search } } });
export const ITEMS = [
  P('iphone13', { category: 'Electronics', item_type: 'smartphone', brand: 'Apple', product_family: 'iPhone', model: 'iPhone 13', size_or_capacity: '128 GB', display_name: 'Apple iPhone 13 128GB', canonical_name: 'apple iphone 13', search: { hebrew_name: 'אייפון 13' }, attributes: [{ name: 'storage', value: '128 GB', basis: 'observed', matters: 'high' }] }),
  P('galaxys23', { category: 'Electronics', item_type: 'smartphone', brand: 'Samsung', product_family: 'Galaxy S', model: 'Galaxy S23', size_or_capacity: '128 GB', display_name: 'Samsung Galaxy S23 128GB', canonical_name: 'samsung galaxy s23', search: { hebrew_name: 'גלקסי S23', model_numbers: ['SM-S911B'] }, attributes: [{ name: 'storage', value: '128 GB', basis: 'observed', matters: 'high' }] }),
  P('dualsense', { category: 'Electronics', item_type: 'game controller', brand: 'Sony', product_family: 'PlayStation 5', model: 'DualSense Wireless Controller', display_name: 'Sony DualSense', canonical_name: 'sony dualsense wireless controller', search: { hebrew_name: 'בקר DualSense לפלייסטיישן 5', aliases: ['PS5 controller'] } }),
  P('ps5', { category: 'Electronics', item_type: 'game console', brand: 'Sony', product_family: 'PlayStation', model: 'PlayStation 5', variant: 'Disc Edition', display_name: 'Sony PlayStation 5 Disc Edition', canonical_name: 'sony playstation 5', search: { hebrew_name: 'פלייסטיישן 5', aliases: ['PS5'] } }),
  P('switcholed', { category: 'Electronics', item_type: 'game console', brand: 'Nintendo', product_family: 'Switch', model: 'Switch OLED', display_name: 'Nintendo Switch OLED', canonical_name: 'nintendo switch oled', search: { hebrew_name: 'נינטנדו סוויץ OLED' } }),
  P('airpodspro2', { category: 'Electronics', item_type: 'wireless earbuds', brand: 'Apple', product_family: 'AirPods', model: 'AirPods Pro (2nd generation)', display_name: 'Apple AirPods Pro 2', canonical_name: 'apple airpods pro 2', search: { hebrew_name: 'איירפודס פרו 2' } }),
  P('watch8', { category: 'Electronics', item_type: 'smartwatch', brand: 'Apple', product_family: 'Apple Watch', model: 'Apple Watch Series 8', size_or_capacity: '45 mm', display_name: 'Apple Watch Series 8 45mm', canonical_name: 'apple watch series 8', search: { hebrew_name: 'אפל ווטש סדרה 8' } }),
  P('ipad9', { category: 'Electronics', item_type: 'tablet', brand: 'Apple', product_family: 'iPad', model: 'iPad (9th generation)', size_or_capacity: '64 GB', display_name: 'Apple iPad 9th gen 64GB', canonical_name: 'apple ipad 9', search: { hebrew_name: 'אייפד 9' }, attributes: [{ name: 'storage', value: '64 GB', basis: 'observed', matters: 'high' }] }),
  P('mbairm1', { category: 'Electronics', item_type: 'laptop', brand: 'Apple', product_family: 'MacBook Air', model: 'MacBook Air M1', size_or_capacity: '256 GB', display_name: 'Apple MacBook Air M1 256GB', canonical_name: 'apple macbook air m1', search: { hebrew_name: 'מקבוק אייר M1', model_numbers: ['A2337'] }, attributes: [{ name: 'storage', value: '256 GB', basis: 'observed', matters: 'high' }] }),
  P('gprowireless', { category: 'Electronics', item_type: 'gaming mouse', brand: 'Logitech', product_family: 'G Pro', model: 'G Pro Wireless', display_name: 'Logitech G Pro Wireless', canonical_name: 'logitech g pro wireless', search: { hebrew_name: 'עכבר לוגיטק G Pro Wireless' } }),
  P('eos5d3', { category: 'Electronics', item_type: 'DSLR camera body', brand: 'Canon', product_family: 'EOS', model: 'EOS 5D Mark III', configuration: 'base_only', display_name: 'Canon EOS 5D Mark III', canonical_name: 'canon eos 5d mark iii', search: { hebrew_name: 'מצלמה קנון 5D Mark III' } }),
  P('dysonv11', { category: 'Home', item_type: 'cordless vacuum cleaner', brand: 'Dyson', product_family: 'V11', model: 'V11', display_name: 'Dyson V11', canonical_name: 'dyson v11', search: { hebrew_name: 'שואב אבק דייסון V11' } }),
  P('essenzamini', { category: 'Home', item_type: 'coffee machine', brand: 'Nespresso', product_family: 'Essenza', model: 'Essenza Mini', display_name: 'Nespresso Essenza Mini', canonical_name: 'nespresso essenza mini', market_class: 'household', search: { hebrew_name: 'מכונת קפה נספרסו אסנזה מיני' } }),
  P('airfryerxxl', { category: 'Home', item_type: 'air fryer', brand: 'Philips', product_family: 'Airfryer', model: 'Airfryer XXL', model_number: 'HD9650', display_name: 'Philips Airfryer XXL HD9650', canonical_name: 'philips airfryer xxl', market_class: 'household', search: { hebrew_name: 'סיר טיגון ללא שמן פיליפס XXL' } }),
  P('poang', { category: 'Furniture', item_type: 'armchair', brand: 'IKEA', product_family: 'POÄNG', model: 'POÄNG armchair', display_name: 'IKEA POÄNG armchair', canonical_name: 'ikea poang armchair', market_class: 'furniture', identity_precision: 'descriptive', search: { hebrew_name: 'כורסת פואנג איקאה' } }),
  P('kallax', { category: 'Furniture', item_type: 'shelving unit', brand: 'IKEA', product_family: 'KALLAX', model: 'KALLAX 4x4 shelf', display_name: 'IKEA KALLAX 4x4', canonical_name: 'ikea kallax 4x4', market_class: 'furniture', identity_precision: 'descriptive', search: { hebrew_name: 'כוורת קאלאקס איקאה 16 תאים' } }),
  P('bugaboofox3', { category: 'Other', item_type: 'baby stroller', brand: 'Bugaboo', product_family: 'Fox', model: 'Fox 3', display_name: 'Bugaboo Fox 3', canonical_name: 'bugaboo fox 3', market_class: 'other', search: { hebrew_name: 'עגלת בוגבו פוקס 3' } }),
  P('marlin5', { category: 'Sports', item_type: 'mountain bike', brand: 'Trek', product_family: 'Marlin', model: 'Marlin 5', display_name: 'Trek Marlin 5', canonical_name: 'trek marlin 5', market_class: 'other', search: { hebrew_name: 'אופני הרים טרק מרלין 5' } }),
  P('xiaomipro2', { category: 'Sports', item_type: 'electric scooter', brand: 'Xiaomi', product_family: 'Mi Electric Scooter', model: 'Mi Electric Scooter Pro 2', display_name: 'Xiaomi Mi Electric Scooter Pro 2', canonical_name: 'xiaomi mi electric scooter pro 2', search: { hebrew_name: 'קורקינט חשמלי שיאומי פרו 2' } }),
  P('squiercv', { category: 'Music', item_type: 'electric guitar', brand: 'Squier', product_family: 'Classic Vibe', model: "Classic Vibe '50s Stratocaster", display_name: "Squier Classic Vibe '50s Stratocaster", canonical_name: 'squier classic vibe 50s stratocaster', market_class: 'other', search: { hebrew_name: 'גיטרה חשמלית סקוויר קלאסיק וייב סטרטוקסטר' } }),
];

const stageOf = (init) => (/SEARCH — LOOK FURTHER/.test(String(init?.body ?? '')) ? 'expand' : 'local');
const imp = (repo, p) => import(pathToFileURL(path.resolve(repo, p)).href);
const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, v) => { m.set(k, v); } }; };
const summary = (v) => ({
  status: v?.status ?? null, withdrawn: v?.withdrawn ?? null, confidence: v?.price_confidence ?? null, basis: v?.basis ?? null,
  good: v?.prices?.good ? { worth: v.prices.good.worth, list: v.prices.good.list, quick: v.prices.good.quick, low: v.prices.good.low, high: v.prices.good.high } : null,
  retail_new_ils: v?.retail_new_ils ?? null, counts: v?.counts ?? null, gap: v?.evidence_gap ?? null,
  evidence: (v?.evidence ?? []).map((e) => ({ url: e.url, domain: e.domain, title: e.title, kind: e.kind, market: e.market, match: e.match, price: e.price, currency: e.currency, ils: e.price_ils, condition: e.condition, listed: e.listed, freshness: e.freshness, binding: e.binding, binding_reason: e.binding_reason, used: e.used, why: e.set_aside ?? null })),
});

async function record(dir, only) {
  fs.mkdirSync(dir, { recursive: true });
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const { runPrice } = await imp(repo, 'api/_lib/scan/service.js');
  const { normalizeIdentity } = await imp(repo, 'api/_lib/scan/identify.js');
  const ledger = path.join(dir, 'spend.json');
  const spend = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { usd: 0, items: {} };
  for (const item of ITEMS.filter((x) => !only.length || only.includes(x.id))) {
    const file = path.join(dir, `${item.id}.json`);
    if (fs.existsSync(file)) continue;
    if (spend.usd + WORST_NEXT_USD > CAP_USD) { console.log(`STOP before ${item.id}: spent $${spend.usd.toFixed(4)} of $${CAP_USD}`); break; }
    const responses = {};
    const pending = [];
    // Every OpenAI response is read WHOLE and kept, even when the price step stops listening (a wider stage it cancelled).
    const fetchImpl = (url, init = {}) => {
      if (!String(url).includes('api.openai.com')) return fetch(url, init);
      const stage = stageOf(init);
      const { signal, ...rest } = init;
      const p = fetch(url, rest).then(async (res) => {
        const text = await res.text();
        responses[stage] = { status: res.status, body: text, usage: [...text.matchAll(/"usage"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean).at(-1) ?? null };
        return new Response(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'text/event-stream' } });
      });
      pending.push(p.catch(() => null));
      if (signal) return Promise.race([p, new Promise((_, reject) => { if (signal.aborted) reject(new Error('aborted')); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); })]);
      return p;
    };
    const t0 = Date.now();
    const r = await runPrice({ identity: normalizeIdentity(item.raw), scanUuid: crypto.randomUUID(), model: MODEL, apiKey: process.env.OPENAI_API_KEY, fetchImpl, now: () => NOW + (Date.now() - t0), store: memStore(), marketplace: async () => [], background: async () => {}, ...(globalThis.__GW_EVAL_INDEX__ ? { index: globalThis.__GW_EVAL_INDEX__ } : {}) });
    const ms = Date.now() - t0;
    await Promise.all(pending);
    // Billed: every stage that reached the provider, whether or not its evidence was used.
    let cost = 0;
    for (const s of Object.values(responses)) cost += (s.usage?.input_tokens ?? 0) * PRICE.in + (s.usage?.output_tokens ?? 0) * PRICE.out + PRICE.search;
    spend.usd += cost; spend.items[item.id] = Math.round(cost * 10000) / 10000;
    fs.writeFileSync(ledger, JSON.stringify(spend, null, 1));
    fs.writeFileSync(file, JSON.stringify({ id: item.id, recorded_at: new Date().toISOString(), live_ms: ms, cost_usd: spend.items[item.id], stages_used: r.call?.stages ?? [], responses, live: summary(r.valuation) }));
    console.log(item.id.padEnd(13), String(r.status).padEnd(22), `${ms} ms`, `$${cost.toFixed(4)}`, `total $${spend.usd.toFixed(4)}`, r.valuation?.prices?.good ? `₪${r.valuation.prices.good.worth}` : (r.valuation?.withdrawn ?? r.failure ?? ''));
  }
  console.log(`SPENT $${spend.usd.toFixed(4)} (cap $${CAP_USD})`);
}

async function replay(dir, repo, outFile) {
  const { runPrice } = await imp(repo, 'api/_lib/scan/service.js');
  const { normalizeIdentity } = await imp(repo, 'api/_lib/scan/identify.js');
  const out = [];
  for (const item of ITEMS) {
    const file = path.join(dir, `${item.id}.json`);
    if (!fs.existsSync(file)) continue;
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const missing = [];
    const fetchImpl = async (url, init = {}) => {
      if (!String(url).includes('api.openai.com')) return fetch(url, init);
      const s = rec.responses[stageOf(init)];
      if (!s) { missing.push(stageOf(init)); return new Response('{"error":{"message":"not recorded"}}', { status: 500 }); }
      return new Response(s.body, { status: s.status, headers: { 'content-type': 'text/event-stream' } });
    };
    const r = await runPrice({ identity: normalizeIdentity(item.raw), scanUuid: null, model: MODEL, apiKey: 'replay', fetchImpl, now: () => NOW, store: memStore(), marketplace: async () => [], background: async () => {}, ...(globalThis.__GW_EVAL_INDEX__ ? { index: globalThis.__GW_EVAL_INDEX__ } : {}) });
    out.push({ id: item.id, name: item.raw.display_name, category: item.raw.category, live_ms: rec.live_ms, cost_usd: rec.cost_usd, stages: r.call?.stages ?? [], missing, ...summary(r.valuation) });
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  for (const o of out) console.log(o.id.padEnd(13), String(o.status).padEnd(22), o.good ? `worth ₪${o.good.worth} list ₪${o.good.list} quick ₪${o.good.quick} (${o.confidence})` : (o.withdrawn ?? ''), o.missing.length ? `MISSING ${o.missing}` : '');
  const priced = out.filter((o) => o.status === 'priced').length;
  console.log(`priced ${priced}/${out.length}`);
}

const [step, ...args] = process.argv.slice(2);
if (step === 'record') await record(args[0], args.slice(1));
else if (step === 'replay') await replay(args[0], args[1], args[2]);
else { console.error('usage: record <dir> [ids...] | replay <dir> <repo> <out.json>'); process.exit(1); }
