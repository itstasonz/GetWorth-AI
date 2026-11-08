// ══════════════════════════════════════════════════════════════════════════════
// IDENTIFICATION BENCHMARK — the production identify step on independently labelled photographs
//
// Ground truth is NOT the model's output: each photograph is a real-world photo on Wikimedia Commons filed under the
// category of the exact product it shows (scripts/benchmarks/identify-commons-set.json names the file and the category
// it was taken from). The same production code (service.js runIdentify: prompt, schema, the server's question rules)
// runs for every configuration, and one scoring rule is applied to all of them:
//   correct          — the brand/family/model/variant fields name the labelled model (and no other specific model)
//   wrong_confident  — the identity claims an exact model (exact_model_established) and it is not the labelled one
//   hedged           — family only, or a different model WITHOUT claiming it is established (the scan then asks)
// It also records which question the scan would ask, whether it is required, latency and tokens.
//
// Usage (paid calls — about $0.01 per photograph per configuration):
//   node --env-file=<env with OPENAI_API_KEY> scripts/identify-benchmark.mjs fetch <dir>
//   node --env-file=<env> scripts/identify-benchmark.mjs run <dir> '<configs json>' <out.json>
//   node scripts/identify-benchmark.mjs score <out.json>
// configs: [{ "name": "terra-none", "model": "gpt-6.1-terra", "effort": "none" }, ...]. No key is printed.
//
// 18 photographs, 9 products, is enough to compare configurations under one rule; it is NOT an accuracy claim for
// the product. The minimum set for that: ~150 labelled photographs over the categories people actually scan (phones,
// earbuds, consoles, cameras, watches, appliances, furniture), taken on a phone, several per product.
// ══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SET = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/benchmarks/identify-commons-set.json'), 'utf8'));
const UA = 'GetWorthBenchmark/1.0 (identification benchmark)';
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const [cmd, a1, a2, a3] = process.argv.slice(2);

async function fetchSet(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const it of SET) {
    const out = path.join(dir, `${it.id}.jpg`);
    if (fs.existsSync(out)) continue;
    await sleep(4000);
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(it.file)}&prop=imageinfo&iiprop=url&iiurlwidth=1280`;
    const j = await (await fetch(u, { headers: { 'User-Agent': UA } })).json().catch(() => null);
    const info = j && Object.values(j.query?.pages ?? {})[0]?.imageinfo?.[0];
    if (!info) { console.log('miss (rate limited? run again)', it.id); continue; }
    await sleep(2000);
    const b = await fetch(info.thumburl ?? info.url, { headers: { 'User-Agent': UA } });
    if (!b.ok) { console.log('fail', it.id, b.status); continue; }
    fs.writeFileSync(out, Buffer.from(await b.arrayBuffer()));
    console.log('ok', it.id);
  }
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SPECIFIERS = /\b(pro|mini|max|plus|ultra|fe|lite|xs|xr|se)\b/;
export function classify(label, said, exact) {
  const s = norm(said); const l = norm(label);
  const words = ` ${s} `;
  const hasAll = l.split(' ').every((t) => words.includes(` ${t} `));
  const extra = s.split(l).join(' ');
  const another = hasAll && SPECIFIERS.test(extra) && !SPECIFIERS.test(l);
  if (hasAll && !another) return 'correct';
  if (exact) return 'wrong_confident';
  return s ? 'hedged' : 'none';
}

async function run(dir, configsJson, outFile) {
  const { runIdentify } = await import(pathToFileURL(path.join(ROOT, 'api/_lib/scan/service.js')).href);
  const configs = JSON.parse(configsJson);
  const rows = [];
  for (const c of configs) {
    process.env.CORE_SCAN_IDENTITY_EFFORT = c.effort ?? 'none';
    const queue = SET.filter((it) => fs.existsSync(path.join(dir, `${it.id}.jpg`)));
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        const b64 = fs.readFileSync(path.join(dir, `${it.id}.jpg`)).toString('base64');
        const t0 = Date.now();
        const r = await runIdentify({ images: [b64], lang: 'he', model: c.model, apiKey: process.env.OPENAI_API_KEY });
        const id = r.identity;
        const said = [id?.brand, id?.product_family, id?.model, id?.variant, id?.model_number].filter(Boolean).join(' | ');
        const q = id?.followup?.kind && id.followup.kind !== 'none' ? `${id.followup.kind}:${id.followup.attribute}${id.followup.required ? '!' : ''}` : null;
        rows.push({ cfg: c.name, id: it.id, label: it.model, ms: Date.now() - t0, status: r.status, failure: r.failure ?? null, exact: id?.exact_model_established ?? null,
          result: r.status === 'failed' ? 'fail' : classify(it.model, said.split('|').slice(1).join(' '), id?.exact_model_established), said: said.slice(0, 120), q,
          tin: r.call?.usage?.input_tokens ?? null, tout: r.call?.usage?.output_tokens ?? null });
        process.stdout.write('.');
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    console.log(' ', c.name);
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  score(outFile);
}

function score(file) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
  const by = {};
  for (const r of rows) (by[r.cfg] ??= []).push(r);
  console.log('config            n  fail correct wrong_confident hedged  asked(required) photo_asked  p50_ms  p90_ms  out_tokens');
  for (const [k, a] of Object.entries(by)) {
    const ok = a.filter((r) => r.status !== 'failed');
    const n = (f) => a.filter(f).length;
    console.log(k.padEnd(17), String(a.length).padEnd(3), String(n((r) => r.result === 'fail')).padEnd(5), String(n((r) => r.result === 'correct')).padEnd(8), String(n((r) => r.result === 'wrong_confident')).padEnd(16),
      String(n((r) => r.result === 'hedged' || r.result === 'none')).padEnd(7), `${n((r) => r.q)}(${n((r) => r.q?.endsWith('!'))})`.padEnd(16), String(n((r) => r.q?.startsWith('photo'))).padEnd(12),
      String(pct(ok.map((r) => r.ms), 0.5)).padEnd(8), String(pct(ok.map((r) => r.ms), 0.9)).padEnd(8), Math.round(ok.reduce((s, r) => s + (r.tout ?? 0), 0) / (ok.length || 1)));
  }
}

if (cmd === 'fetch') await fetchSet(a1);
else if (cmd === 'run') await run(a1, a2, a3);
else if (cmd === 'score') score(a1);
else console.log('usage: fetch <dir> | run <dir> <configs-json> <out.json> | score <out.json>');
