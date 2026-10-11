#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN TRACE — what the last scans found, and why they priced or did not
//
// READ-ONLY, founder-run. Reads the core scan's own event rows (scan_events:
// core_scan_priced, core_scan_market) and valuation rows through the service
// role, and prints one root-cause view per scan: the identity as it stood, the
// queries planned and run, how many pages the search reached, every price found
// with where it came from and why it was or was not used. It prints no user id,
// no token, no photograph and no secret, and nothing the owner TYPED: a
// correction ("Wrong item?") or an answer in their own words is shown by its
// length only, so the output can be shared. Options the app offered are shown.
//
//   node --env-file=.env.local scripts/scan-trace.mjs [--days 2] [--limit 40] [--json out.scan-trace.json]
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment. Without them
// it says so and exits 2. It never guesses an environment: the URL it reads
// from is printed so the reader knows which database answered. The JSON it
// writes is always named *.scan-trace.json, which .gitignore keeps out of git.
// ══════════════════════════════════════════════════════════════════════════════
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const days = Number(opt('--days', 2));
const limit = Number(opt('--limit', 40));
const JSON_SUFFIX = '.scan-trace.json';
const given = opt('--json', null);
const jsonOut = given ? (given.endsWith(JSON_SUFFIX) ? given : given.replace(/\.json$/i, '') + JSON_SUFFIX) : null;
/** Text the owner typed, by its length only: never the words. */
const typed = (s) => (typeof s === 'string' && s ? `(${s.length} chars, not shown)` : null);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.log('[trace] SUPABASE_URL and SUPABASE_SERVICE_KEY are needed (node --env-file=.env.local …)'); process.exit(2); }

const { createClient } = await import('@supabase/supabase-js');
const supa = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - days * 86_400_000).toISOString();
console.log(`[trace] database ${new URL(url).host} · since ${since}`);

const { data: events, error } = await supa.from('scan_events').select('created_at, scan_uuid, event_type, payload')
  .eq('stage', 'core_scan').gte('created_at', since).order('created_at', { ascending: true }).limit(limit);
if (error) { console.log(`[trace] scan_events: ${error.message}`); process.exit(2); }
const uuids = [...new Set(events.map((e) => e.scan_uuid))];
const { data: vals, error: verr } = uuids.length
  ? await supa.from('valuations').select('created_at, scan_uuid, ai_name, ai_name_hebrew, price_low, price_high, new_retail, price_method, comp_count, lang, ai_raw_response').in('scan_uuid', uuids).order('created_at', { ascending: true })
  : { data: [], error: null };
if (verr) console.log(`[trace] valuations: ${verr.message}`);

const short = (u) => String(u ?? '').slice(0, 8);
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return '?'; } };
/** Why a price was not used, counted, so A–F can be told apart: rejected by binding (B/C), by rule (D), or never verified (F). */
const histogram = (sources) => {
  const h = {};
  for (const s of sources) { const k = s.used ? 'USED' : (s.set_aside ?? (s.binding && s.binding !== 'strong' && s.binding !== 'verified_row' ? `unbound:${s.binding_reason ?? s.binding}` : 'not_used')); h[k] = (h[k] ?? 0) + 1; }
  return h;
};

const byScan = new Map();
for (const e of events) {
  const row = byScan.get(e.scan_uuid) ?? { scan: short(e.scan_uuid), events: [] };
  row.events.push(e);
  byScan.set(e.scan_uuid, row);
}
for (const v of vals ?? []) {
  const row = byScan.get(v.scan_uuid) ?? { scan: short(v.scan_uuid), events: [] };
  row.valuation = v;
  byScan.set(v.scan_uuid, row);
}

let report = [];
for (const row of byScan.values()) {
  const v = row.valuation;
  const raw = v?.ai_raw_response ?? {};
  const id = raw.identity ?? {};
  const ownWords = new Set((id.confirmed ?? []).filter((c) => c.stated).map((c) => c.value));
  const val = raw.valuation ?? null;
  const priced = row.events.filter((e) => e.event_type === 'core_scan_priced').map((e) => e.payload);
  const markets = row.events.filter((e) => e.event_type === 'core_scan_market').map((e) => e.payload);
  const out = {
    scan: row.scan,
    at: v?.created_at ?? row.events[0]?.created_at ?? null,
    identity: v ? {
      name: id.display_name, canonical: id.canonical_name, hebrew: id.search?.hebrew_name ?? null, brand: id.brand, model: id.model, model_number: id.model_number,
      codes: id.search?.model_numbers ?? [], aliases: id.search?.aliases ?? [], size: id.size_or_capacity, exact: id.exact_model_established, confidence: id.identity_confidence,
      market_class: id.market_class, precision: id.identity_precision, incomplete: id.incomplete ?? null,
      // An answer in the owner's own words is theirs: its length is shown, not the words, wherever it was written —
      // the confirmed facts and the attribute it settled. An option the app offered is the app's.
      attributes: (id.attributes ?? []).map((a) => `${a.name}=${a.basis === 'confirmed' && ownWords.has(a.value) ? typed(a.value) : (a.value ?? '?')} (${a.basis})`),
      confirmed: (id.confirmed ?? []).map((c) => `${c.attribute}=${c.stated ? typed(c.value) : c.value}${c.unsure ? ' (unsure)' : ''}`),
      followup: id.followup?.kind && id.followup.kind !== 'none' ? `${id.followup.kind}${id.followup.required ? ' REQUIRED' : ''}: ${id.followup.question}` : null,
      owner_correction: typed(id.owner_correction),
    } : null,
    outcome: val ? {
      status: val.status, withdrawn: val.withdrawn ?? null, strategy: val.strategy ?? priced[0]?.strategy ?? null, basis: val.basis, approximate: val.approximate, confidence: val.price_confidence,
      good: val.prices?.good ?? null, retail_new_ils: val.retail_new_ils, counts: val.counts, local_strength: val.local_strength, dispersion: val.dispersion, reference_range: val.reference_range,
      searched: val.searched ?? null,
    } : null,
    timings: priced.map((p) => ({ identify_ms: p.identify_ms, market_ms: p.market_ms, first_search_ms: p.first_search_ms, tool_calls: p.tool_calls, stages: p.stages, model: p.model, reused: p.reused, stale: p.stale })),
    diagnostics: priced.map((p) => p.diagnostics ?? null).filter(Boolean),
    // The market identity (the research key) carries the owner's answers: the key's hash is shown, never the key.
    market_research: markets.map((m) => ({ key: String(m.key ?? '').slice(0, 12), searched: m.record?.searched, unverified: m.record?.unverified, evidence: (m.record?.evidence ?? []).length })),
    sources: (val?.sources ?? []).map((s) => ({
      used: s.used, why: s.set_aside ?? null, binding: s.binding, binding_reason: s.binding_reason ?? null, kind: s.kind, match: s.match, market: s.market, condition: s.condition, page: s.page,
      listed: s.listed, freshness: s.freshness, price: s.price, currency: s.currency, host: host(s.url),
    })),
  };
  out.set_aside = histogram(val?.sources ?? []);
  report.push(out);
}

// THE LAST CHECK, before anything is printed or written: nothing the owner typed — a correction, an answer in their own
// words — appears anywhere in the report, whichever field carried it (the model echoes a correction into the name it
// gives). A field added later cannot leak by omission: every occurrence is replaced by its length.
const typedTexts = [...byScan.values()].flatMap((row) => { const id = row.valuation?.ai_raw_response?.identity ?? {}; return [id.owner_correction, ...(id.confirmed ?? []).filter((c) => c.stated).map((c) => c.value)]; }).filter((t) => typeof t === 'string' && t.length >= 3);
let printed = JSON.stringify(report);
for (const t of typedTexts) printed = printed.split(JSON.stringify(t).slice(1, -1)).join(typed(t));
report = JSON.parse(printed);

for (const r of report) {
  console.log(`\n━━ scan ${r.scan} · ${r.at}`);
  if (r.identity) console.log('  identity   ', JSON.stringify(r.identity));
  if (r.outcome) console.log('  outcome    ', JSON.stringify(r.outcome));
  for (const t of r.timings) console.log('  timings    ', JSON.stringify(t));
  for (const d of r.diagnostics) console.log('  diagnostics', JSON.stringify(d));
  for (const m of r.market_research) console.log('  research   ', JSON.stringify(m));
  console.log('  set aside  ', JSON.stringify(r.set_aside));
  for (const s of r.sources) console.log('    ', `${s.used ? 'USED ' : 'no   '} ${s.why ?? s.binding_reason ?? ''} | ${s.kind}/${s.match}/${s.market}/${s.condition}/${s.page} | ${s.price} ${s.currency} | ${s.freshness ?? '?'} ${s.listed ?? ''} | ${s.host}`);
}
console.log(`\n[trace] ${report.length} scans, ${events.length} events`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`[trace] written ${jsonOut}`); }
