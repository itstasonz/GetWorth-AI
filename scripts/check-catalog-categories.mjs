#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — catalog taxonomy check (pre-benchmark gate).
//
// WHY THIS MUST RUN BEFORE THE A/B
// Retrieval strategies 3a/3b filter with `.ilike('category', '%' + category + '%')`
// (api/analyze.js). The OpenAI adapter can now emit `Bags` and `Jewelry` —
// required, because coercing them to 'Other' sent a ₪18,000 Cartier to the
// GLOBAL envelope instead of jewelry/manual_only.
//
// But if the `products` table spells those categories differently, or has no
// rows for them, those strategies return ZERO for exactly the two
// highest-value, highest-counterfeit-risk categories — and the benchmark would
// score that as "OpenAI retrieves worse" when the cause is taxonomy, not
// recognition. That is a wrong conclusion about the thing the experiment
// exists to decide, so it is worth one query up front.
//
// Prints counts only. No product rows, no credentials.
//
//   node scripts/check-catalog-categories.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { CATEGORIES } from '../api/_lib/openai-recognition-contract.js';

function loadEnv() {
  const out = { ...process.env };
  const p = resolve(process.cwd(), '.env.local');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!(k in out)) out[k] = v;
    }
  }
  return out;
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.log('\nCATALOG TAXONOMY CHECK — SKIPPED\n');
  console.log('  No Supabase URL/key found in the environment or .env.local.');
  console.log('  Run this before the A/B benchmark, against the project the benchmark will hit.\n');
  process.exit(0);
}

const supa = createClient(url, key);
const { data, error } = await supa.from('products').select('category').limit(10000);

if (error) {
  console.error(`\nCATALOG TAXONOMY CHECK — FAILED: ${error.message}\n`);
  process.exit(1);
}

const counts = new Map();
for (const row of data || []) {
  const c = (row.category ?? '(null)').trim() || '(empty)';
  counts.set(c, (counts.get(c) || 0) + 1);
}

console.log('\nCATALOG TAXONOMY CHECK\n');
console.log(`  ${data.length} product rows sampled\n`);
console.log('  catalog category'.padEnd(34) + 'rows');
console.log('  ' + '─'.repeat(42));
for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log('  ' + c.padEnd(32) + String(n).padStart(6));
}

// The real question: does an adapter category retrieve anything at all?
// Mirrors retrieval's own substring semantics rather than testing equality,
// because `.ilike('%X%')` is what actually runs.
console.log('\n  adapter enum -> retrievable via ilike(%category%)?\n');
const catalogCats = [...counts.keys()];
let missing = [];
for (const c of CATEGORIES) {
  const hits = catalogCats.filter((cc) => cc.toLowerCase().includes(c.toLowerCase()));
  const rows = hits.reduce((a, h) => a + counts.get(h), 0);
  const ok = rows > 0;
  if (!ok && c !== 'Other') missing.push(c);
  console.log(`  ${ok ? 'ok  ' : 'MISS'}  ${c.padEnd(14)} ${rows ? `${rows} rows via ${hits.join(', ')}` : 'no matching catalog category'}`);
}

if (missing.length) {
  console.log(`\n  ${missing.length} adapter categor${missing.length === 1 ? 'y' : 'ies'} retrieve NOTHING: ${missing.join(', ')}`);
  console.log('  Retrieval strategies 3a/3b will return zero rows for these, and the A/B');
  console.log('  would read that as an OpenAI recognition failure. Map them to the catalog\'s');
  console.log('  own wording in api/_lib/openai-recognition-contract.js — do NOT widen the');
  console.log('  enum again, and do NOT drop them (that reopens the GLOBAL-envelope bypass).\n');
  process.exit(2);
}
console.log('\n  All adapter categories retrieve. Safe to run the A/B benchmark.\n');
