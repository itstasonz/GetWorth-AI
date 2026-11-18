#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// PHOTO → IDENTITY → PRICE, END TO END, ON REAL PHOTOGRAPHS (2026-11-18)
//
//   node --env-file=<env> scripts/scan-e2e-eval.mjs record <photosDir> <outDir>       LIVE, PAID (hard cap below)
//   node scripts/scan-e2e-eval.mjs replay <outDir> <report.json>                       OFFLINE, free
//
// record  runs each photograph through the production identify step (service.js runIdentify, production model) and the
//         production price step (runPrice, production model, no stored research, no marketplace), as the app does: a
//         required question is answered "not sure" (what a person who does not know says), and keeps every OpenAI response.
// replay  answers both steps from those recordings against the code in this checkout: the same photographs and the same
//         search results, so a difference is the code's.
// The truth for each photograph is the product its Wikimedia Commons file shows (TRUTH below / identify-commons-set.json).
// ══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIdentify, runPrice, resetMarketCache } from '../api/_lib/scan/service.js';
import { resolveIdentityModel, resolveMarketModel, MAX_FOLLOWUPS } from '../api/_lib/scan/config.js';
import { recordAnswer } from '../api/_lib/scan/identify.js';

const CAP_USD = 1.5;
const PRICE = { in: 0.10 / 1e6, out: 0.50 / 1e6, search: 0.01, identifyIn: 1.0 / 1e6, identifyOut: 4.0 / 1e6 };
const SET = JSON.parse(fs.readFileSync(new URL('./benchmarks/identify-commons-set.json', import.meta.url), 'utf8'));
export const TRUTH = [
  ...SET.map((x) => ({ id: x.id, truth: [x.brand, x.model, x.variant].filter(Boolean).join(' '), category: 'electronics' })),
  { id: 'poang-a', truth: 'IKEA POÄNG armchair', category: 'furniture' },
  { id: 'dualsense-a', truth: 'Sony DualSense controller (Chroma Pearl)', category: 'gaming' },
  { id: 'dualsense-b', truth: 'Sony DualSense controller (Midnight Black)', category: 'gaming' },
  { id: 'kindle-a', truth: 'Amazon Kindle Paperwhite', category: 'small electronics' },
  { id: 'rayban-a', truth: 'Ray-Ban Wayfarer RB5121 (optical frame)', category: 'fashion' },
  { id: 'mxmaster-a', truth: 'Logitech MX Master 3S', category: 'small electronics' },
  { id: 'kitchenaid-a', truth: 'KitchenAid Artisan stand mixer', category: 'household' },
  { id: 'switchlite-a', truth: 'Nintendo Switch Lite (grey)', category: 'gaming' },
  // FRESH photographs (2026-11-18, round 2): never scanned before this run.
  { id: 'iphone13pro-f', truth: 'Apple iPhone 13 Pro', category: 'smartphone' },
  { id: 'galaxys22-f', truth: 'Samsung Galaxy S22', category: 'smartphone' },
  { id: 's22ultra-f', truth: 'Samsung Galaxy S22 Ultra', category: 'smartphone' },
  { id: 'ps4-f', truth: 'Sony PlayStation 4 (original) with DualShock 4', category: 'gaming' },
  { id: 'xboxs-f', truth: 'Microsoft Xbox Series S', category: 'gaming' },
  { id: 'aw7-f', truth: 'Apple Watch Series 7 45mm', category: 'small electronics' },
  { id: 'dysonv8-f', truth: 'Dyson V8 cordless vacuum', category: 'household' },
  { id: 'vertuopop-f', truth: 'Nespresso Vertuo Pop', category: 'household' },
  { id: 'mxkeys-f', truth: 'Logitech MX Keys', category: 'small electronics' },
  { id: 'kindle-f', truth: 'Amazon Kindle Paperwhite', category: 'small electronics' },
];
const stageOf = (init) => {
  const b = String(init?.body ?? '');
  if (/"input_image"|image_url/.test(b)) return 'identify';
  return /SEARCH — LOOK CLOSER/.test(b) ? 'deep' : (/SEARCH — LOOK FURTHER/.test(b) ? 'expand' : 'local');
};
const memStore = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, v) => { m.set(k, v); } }; };
const usageOf = (text) => [...text.matchAll(/"usage"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean).at(-1) ?? null;
// WHAT THE OWNER WOULD TAP (answer mode): for each photograph, the option text(s) that name its true product, written from
// the truth above — never derived from the options offered. A photo whose truth does not settle the question (airpodspro-c
// shows no generation) has none, and its owner answers "not sure".
export const OWNER_ANSWERS = {
  'iphone12-a': ['iPhone 12'], 'iphone12-b': ['iPhone 12'], 'iphone11pro-a': ['iPhone 11 Pro'], 'iphone11pro-b': ['iPhone 11 Pro'],
  'iphonex-a': ['iPhone X'], 'iphonex-b': ['iPhone X'], 'airpodspro-a': ['דור ראשון'], 'airpodspro2-a': ['דור שני'],
  's21-a': ['Galaxy S21'], 's21-b': ['Galaxy S21'], '5d3-a': ['EOS 5D Mark III'], '5d3-b': ['EOS 5D Mark III'],
  'aw4-a': ['Series 4'], 'aw4-b': ['Series 4'], 'dualsense-a': ['DualSense רגיל'], 'dualsense-b': ['DualSense רגיל'],
  'kindle-a': ['Kindle Paperwhite'], 'mxmaster-a': ['MX Master 3S'], 'switchlite-a': ['Nintendo Switch Lite'],
  // Fresh photographs: every way an option may name the true product, written from the truth before the run.
  'iphone13pro-f': ['iPhone 13 Pro'], 'galaxys22-f': ['Galaxy S22', 'Samsung Galaxy S22'], 's22ultra-f': ['Galaxy S22 Ultra', 'Samsung Galaxy S22 Ultra'],
  'ps4-f': ['PlayStation 4', 'PS4', 'PlayStation 4 (original)', 'PS4 original', 'מקורי'], 'xboxs-f': ['Xbox Series S'],
  'aw7-f': ['Series 7', 'Apple Watch Series 7', '45mm', '45 mm'], 'dysonv8-f': ['V8', 'Dyson V8'], 'vertuopop-f': ['Vertuo Pop', 'Nespresso Vertuo Pop'],
  'mxkeys-f': ['MX Keys', 'Logitech MX Keys'], 'kindle-f': ['Kindle Paperwhite'],
};
// NOTHING IS ASSUMED (founder, 2026-11-18): a storage or other price-moving detail the photograph cannot show and the truth
// does not record is answered "not sure", as an owner who does not know would. Kept empty on purpose.
export const ASSUMED_ANSWERS = {};
const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * The owner answers a REQUIRED choice through the server's own recordAnswer (as api/scan.js does): the one offered option
 * whose text EQUALS an expected answer; none, or more than one, is "not sure". Exact equality only, so "iPhone 11 Pro Max"
 * never stands in for "iPhone 11 Pro".
 */
export function ownerAnswer(identity, id, { followupsLeft = 1 } = {}) {
  const q = identity?.followup;
  if (!q?.required || q.kind !== 'choice') return { identity, answer: null, picked: null, assumed: false };
  const pick = (list) => (q.options ?? []).map((o, i) => ({ o, i })).filter(({ o }) => (list ?? []).some((a) => sameText(a, o)));
  const known = pick(OWNER_ANSWERS[id]);
  const assumed = known.length ? [] : pick(ASSUMED_ANSWERS[id]);
  const hits = known.length ? known : assumed;
  // Every hit is one of the true product's own names (OWNER_ANSWERS lists only those), so the first is a true answer.
  const raw = hits.length >= 1 ? hits[0].i : 'unsure';
  const r = recordAnswer(identity, raw, { lang: 'he', followupsLeft });
  if (r.error) return { identity, answer: null, picked: null, assumed: false };
  return { identity: r.identity, answer: r.answer, picked: hits.length >= 1 ? hits[0].o : 'unsure', assumed: hits.length >= 1 && !known.length };
}
const notSure = (identity) => (identity?.followup?.required ? { question: identity.followup.question ?? '', text: 'not sure', unsure: true, attribute: identity.followup.attribute ?? null } : null);

function stateOf(v) {
  if (!v) return 'none';
  if (v.status === 'priced') return 'A';
  if (v.comparative) return 'B';
  if (v.calculated) return 'C-calc';
  if (v.retail_new_ils) return 'D-retail';
  return 'E';
}
function summary(r) {
  const v = r?.valuation;
  const used = (v?.evidence ?? []).filter((e) => e.used).map((e) => ({ url: e.url, ils: e.price_ils, kind: e.kind, market: e.market }));
  const retail = (v?.evidence ?? []).filter((e) => e.kind === 'new_retail' && e.market === 'IL' && (e.binding === 'strong' || e.binding === 'verified_row')).map((e) => ({ url: e.url, ils: e.price_ils, match: e.match }));
  return {
    status: r?.status ?? null, state: stateOf(v), worth: v?.prices?.good?.worth ?? null, list: v?.prices?.good?.list ?? null, quick: v?.prices?.good?.quick ?? null,
    confidence: v?.price_confidence ?? null, withdrawn: v?.withdrawn ?? null,
    comparative: v?.comparative ? v.comparative.observations.map((o) => ({ ils: o.price_ils, url: o.url })) : null,
    retail_new_ils: v?.retail_new_ils ?? null, retail_in_stock: v?.retail_new_in_stock ?? null, retail,
    calculated: v?.calculated ? { retail: v.calculated.retail_ils, estimates: v.calculated.estimates, condition: v.calculated.condition, source: v.calculated.sources?.[0]?.url ?? null } : null,
    used,
  };
}
const identitySummary = (r) => {
  const i = r?.identity;
  return {
    status: r?.status, name: i?.display_name ?? null, brand: i?.brand ?? null, model: i?.model ?? null, variant: i?.variant ?? null, capacity: i?.size_or_capacity ?? null,
    exact: i?.exact_model_established ?? null, confidence: i?.identity_confidence ?? null, market_class: i?.market_class ?? null, precision: i?.identity_precision ?? null,
    condition: i?.visible_condition ?? null, question: i?.followup?.kind && i.followup.kind !== 'none' ? { attribute: i.followup.attribute ?? null, required: i.followup.required === true, q: i.followup.question } : null,
    incomplete: i?.incomplete ?? null,
  };
};

async function record(photos, out) {
  fs.mkdirSync(out, { recursive: true });
  const ledger = path.join(out, 'spend.json');
  const spend = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { usd: 0, items: {} };
  for (const t of TRUTH) {
    const photo = path.join(photos, `${t.id}.jpg`);
    const file = path.join(out, `${t.id}.json`);
    if (!fs.existsSync(photo) || fs.existsSync(file)) continue;
    if (spend.usd + 0.08 > CAP_USD) { console.log(`STOP before ${t.id}: $${spend.usd.toFixed(3)} of $${CAP_USD}`); break; }
    const responses = {};
    const pending = [];
    const fetchImpl = (url, init = {}) => {
      if (!String(url).includes('api.openai.com')) return fetch(url, init);
      const stage = stageOf(init);
      const { signal, ...rest } = init;
      const p = fetch(url, rest).then(async (res) => {
        const text = await res.text();
        responses[stage] = { status: res.status, body: text, usage: usageOf(text) };
        return new Response(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'text/event-stream' } });
      });
      pending.push(p.catch(() => null));
      if (signal) return Promise.race([p, new Promise((_, rej) => { if (signal.aborted) rej(new Error('aborted')); signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }); })]);
      return p;
    };
    const b64 = fs.readFileSync(photo).toString('base64');
    resetMarketCache();
    const t0 = Date.now();
    const id = await runIdentify({ images: [b64], lang: 'he', model: resolveIdentityModel({}), apiKey: process.env.OPENAI_API_KEY, fetchImpl });
    const identifyMs = Date.now() - t0;
    let pr = null; let priceMs = null;
    if (id.status !== 'failed' && id.identity && !id.identity.incomplete) {
      const t1 = Date.now();
      pr = await runPrice({ identity: id.identity, answer: notSure(id.identity), scanUuid: crypto.randomUUID(), model: resolveMarketModel({}), apiKey: process.env.OPENAI_API_KEY, fetchImpl, store: memStore(), marketplace: async () => [], marketplaceListings: async () => [], background: () => {} });
      priceMs = Date.now() - t1;
    }
    await Promise.all(pending);
    const i = responses.identify?.usage;
    let cost = i ? (i.input_tokens ?? 0) * PRICE.identifyIn + (i.output_tokens ?? 0) * PRICE.identifyOut : 0;
    for (const [k, s] of Object.entries(responses)) if (k !== 'identify') cost += (s.usage?.input_tokens ?? 0) * PRICE.in + (s.usage?.output_tokens ?? 0) * PRICE.out + PRICE.search;
    spend.usd += cost; spend.items[t.id] = Math.round(cost * 1e4) / 1e4;
    fs.writeFileSync(ledger, JSON.stringify(spend, null, 1));
    const row = { id: t.id, truth: t.truth, category: t.category, identify_ms: identifyMs, price_ms: priceMs, cost_usd: spend.items[t.id], identity: identitySummary(id), price: pr ? summary(pr) : null, responses };
    fs.writeFileSync(file, JSON.stringify(row));
    console.log(t.id.padEnd(14), `${identifyMs} ms`, String(row.identity.name).slice(0, 40).padEnd(40), row.identity.exact ? 'exact' : 'NOT-exact', row.price ? `${row.price.state} ${row.price.worth ?? row.price.calculated?.estimates?.good ?? row.price.retail_new_ils ?? ''}` : '-', priceMs ? `${priceMs} ms` : '', `$${cost.toFixed(4)}`);
  }
  console.log(`SPENT $${spend.usd.toFixed(4)} (cap $${CAP_USD})`);
}

async function replay(dir, outFile) {
  const rows = [];
  for (const t of TRUTH) {
    const file = path.join(dir, `${t.id}.json`);
    if (!fs.existsSync(file)) continue;
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fetchImpl = async (url, init = {}) => {
      if (!String(url).includes('api.openai.com')) return fetch(url, init);
      const s = rec.responses[stageOf(init)];
      return s ? new Response(s.body, { status: s.status, headers: { 'content-type': 'text/event-stream' } }) : new Response('{"error":{"message":"not recorded"}}', { status: 500 });
    };
    resetMarketCache();
    const id = await runIdentify({ images: ['/9j/4AAQSkZJRgABAQAAAQABAAD'], lang: 'he', model: resolveIdentityModel({}), apiKey: 'replay', fetchImpl });
    let pr = null;
    if (id.status !== 'failed' && id.identity && !id.identity.incomplete) {
      pr = await runPrice({ identity: id.identity, answer: notSure(id.identity), scanUuid: null, model: resolveMarketModel({}), apiKey: 'replay', fetchImpl, now: () => Date.parse(rec.recorded_at ?? '2026-11-18T12:00:00Z'), store: memStore(), marketplace: async () => [], marketplaceListings: async () => [], background: () => {} });
    }
    rows.push({ id: t.id, truth: t.truth, category: t.category, identify_ms: rec.identify_ms, price_ms: rec.price_ms, identity: identitySummary(id), price: pr ? summary(pr) : null });
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  const tally = rows.reduce((m, r) => { const k = r.price?.state ?? 'not priced'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  for (const r of rows) console.log(r.id.padEnd(14), String(r.identity.name).slice(0, 44).padEnd(44), (r.identity.exact ? 'exact' : 'hedged').padEnd(7), (r.price?.state ?? '-').padEnd(9), r.price?.worth ? `₪${r.price.worth}` : r.price?.calculated ? `≈₪${r.price.calculated.estimates.good} (new ₪${r.price.calculated.retail})` : r.price?.comparative ? `ads ${r.price.comparative.map((o) => o.ils).join('/')}` : r.price?.retail_new_ils ? `new ₪${r.price.retail_new_ils}` : (r.price?.withdrawn ?? ''));
  console.log(JSON.stringify(tally));
}

/**
 * ANSWER: for each recorded photo whose identity asked a REQUIRED question, the owner answers it (ownerAnswer) and the
 * price step runs LIVE on the answered identity. The identification is the recorded one (no new identify call).
 */
async function answerMode(recDir, out) {
  fs.mkdirSync(out, { recursive: true });
  const ledger = path.join(out, 'spend.json');
  const spend = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { usd: 0, items: {} };
  for (const t of TRUTH) {
    const src = path.join(recDir, `${t.id}.json`);
    const file = path.join(out, `${t.id}.json`);
    if (!fs.existsSync(src) || fs.existsSync(file)) continue;
    const rec = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (!rec.identity?.question?.required) continue;
    if (spend.usd + 0.06 > CAP_USD) { console.log(`STOP before ${t.id}: $${spend.usd.toFixed(3)} of $${CAP_USD}`); break; }
    const responses = { identify: rec.responses.identify };
    const pending = [];
    const fetchImpl = (url, init = {}) => {
      if (!String(url).includes('api.openai.com')) return fetch(url, init);
      const stage = stageOf(init);
      if (stage === 'identify') return Promise.resolve(new Response(rec.responses.identify.body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      const { signal, ...rest } = init;
      const p = fetch(url, rest).then(async (res) => {
        const text = await res.text();
        responses[stage] = { status: res.status, body: text, usage: usageOf(text) };
        return new Response(text, { status: res.status, headers: { 'content-type': 'text/event-stream' } });
      });
      pending.push(p.catch(() => null));
      if (signal) return Promise.race([p, new Promise((_, rej) => { if (signal.aborted) rej(new Error('aborted')); signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true }); })]);
      return p;
    };
    resetMarketCache();
    const id = await runIdentify({ images: ['/9j/4AAQSkZJRgABAQAAAQABAAD'], lang: 'he', model: resolveIdentityModel({}), apiKey: 'replay', fetchImpl });
    // Each required question in turn, as the app asks them, up to the server's follow-up limit (config.js MAX_FOLLOWUPS).
    let ans = { identity: id.identity, answer: null };
    const picks = [];
    for (let k = 0; k < MAX_FOLLOWUPS && ans.identity?.followup?.required === true; k += 1) {
      const next = ownerAnswer(ans.identity, t.id, { followupsLeft: MAX_FOLLOWUPS - k - 1 });
      if (!next.picked) break;
      picks.push({ attribute: ans.identity.followup.attribute ?? null, picked: next.picked, assumed: next.assumed });
      ans = next;
    }
    ans.picked = picks.map((p) => `${p.picked}${p.assumed ? ' (assumed)' : ''}`).join(' + ') || null;
    let pr = null; let priceMs = null;
    if (ans.identity && !ans.identity.incomplete && ans.identity.followup?.required !== true) {
      const t1 = Date.now();
      pr = await runPrice({ identity: ans.identity, answer: ans.answer, scanUuid: crypto.randomUUID(), model: resolveMarketModel({}), apiKey: process.env.OPENAI_API_KEY, fetchImpl, store: memStore(), marketplace: async () => [], marketplaceListings: async () => [], background: () => {} });
      priceMs = Date.now() - t1;
    }
    await Promise.all(pending);
    let cost = 0;
    for (const [k, s] of Object.entries(responses)) if (k !== 'identify') cost += (s.usage?.input_tokens ?? 0) * PRICE.in + (s.usage?.output_tokens ?? 0) * PRICE.out + PRICE.search;
    spend.usd += cost; spend.items[t.id] = Math.round(cost * 1e4) / 1e4;
    fs.writeFileSync(ledger, JSON.stringify(spend, null, 1));
    const row = { id: t.id, truth: t.truth, category: t.category, identify_ms: rec.identify_ms, price_ms: priceMs, picked: ans.picked, picks, answer: ans.answer, identity: identitySummary({ status: id.status, identity: ans.identity }), price: pr ? summary(pr) : null, responses };
    fs.writeFileSync(file, JSON.stringify(row));
    console.log(t.id.padEnd(14), `picked=${ans.picked}`.padEnd(26), String(row.identity.name).slice(0, 40).padEnd(40), row.price ? `${row.price.state} ${row.price.worth ?? row.price.calculated?.estimates?.good ?? row.price.retail_new_ils ?? ''}` : 'no price (question still open)', priceMs ? `${priceMs} ms` : '', `$${cost.toFixed(4)}`);
  }
  console.log(`SPENT $${spend.usd.toFixed(4)} (cap $${CAP_USD})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [step, a, b] = process.argv.slice(2);
  if (step === 'record') await record(a, b);
  else if (step === 'replay') await replay(a, b);
  else if (step === 'answer') await answerMode(a, b);
  else { console.error('usage: record <photosDir> <outDir> | replay <outDir> <report.json> | answer <recordDir> <outDir>'); process.exit(1); }
}
