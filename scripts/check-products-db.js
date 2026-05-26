#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// GetWorth — products DB diagnostic script
// Usage: node scripts/check-products-db.js
// Requires: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
// ═══════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read .env.local
const envPath = resolve(process.cwd(), '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
);

const url = env['VITE_SUPABASE_URL'];
const key = env['VITE_SUPABASE_ANON_KEY'] || env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const supa = createClient(url, key);

async function run() {
  console.log('=== PRODUCTS DB DIAGNOSTIC ===\n');

  // 1. Total product count
  const { count } = await supa.from('products').select('*', { count: 'exact', head: true });
  console.log(`Total products in DB: ${count}`);

  // 2. Logitech G900 search
  console.log('\n--- Logitech G900 search ---');
  const { data: g900, error: e1 } = await supa.from('products').select('id, brand, model, name, category')
    .ilike('brand', '%logitech%')
    .or('model.ilike.%G900%,name.ilike.%G900%');
  if (e1) console.error('Error:', e1.message);
  else console.log('Results:', g900?.length ?? 0, JSON.stringify(g900, null, 2));

  // 3. All Logitech products
  console.log('\n--- All Logitech products ---');
  const { data: logitech, error: e2 } = await supa.from('products').select('id, brand, model, name, category')
    .ilike('brand', '%logitech%')
    .order('popularity_score', { ascending: false })
    .limit(20);
  if (e2) console.error('Error:', e2.message);
  else {
    console.log(`Found ${logitech?.length ?? 0} Logitech products:`);
    (logitech || []).forEach(p => console.log(`  [${p.id}] ${p.brand} | ${p.model} | ${p.name} | ${p.category}`));
  }

  // 4. Check match_products_by_ocr RPC
  console.log('\n--- match_products_by_ocr RPC test ---');
  const { data: rpcData, error: rpcErr } = await supa.rpc('match_products_by_ocr', {
    p_keywords: ['logitech', 'g900', 'gaming', 'mouse'],
    p_limit: 5,
  });
  if (rpcErr) console.error('RPC MISSING or failed:', rpcErr.message, '\n→ Run migration 20260526000003_add_product_search_rpcs.sql');
  else console.log(`RPC returned ${rpcData?.length ?? 0} results:`, JSON.stringify(rpcData?.slice(0, 2), null, 2));

  // 5. Check match_products (vector) RPC
  console.log('\n--- match_products (vector) RPC — expect error if pgvector not configured ---');
  const { error: vecErr } = await supa.rpc('match_products', {
    query_embedding: new Array(1536).fill(0.1),
    similarity_threshold: 0.60,
    match_limit: 1,
  });
  if (vecErr) console.error('Vector RPC missing or pgvector not enabled:', vecErr.message);
  else console.log('Vector RPC exists ✓');
}

run().catch(console.error);
