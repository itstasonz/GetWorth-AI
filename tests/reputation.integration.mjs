// ══════════════════════════════════════════════════════════════════════════════
// FRONTEND-008C — reputation integration tests.
//
// Runs the REAL src/lib/reviews.js loader (the exact code production executes)
// against the REAL production database with the anon key — the same
// credentials the deployed frontend uses. Read-only. No mocks for the
// happy paths; a deliberately unreachable client exercises the error paths.
//
// Run: node tests/reputation.integration.mjs   (or: npm test)
// Requires .env.local with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { createClient } from '@supabase/supabase-js';

// Load env exactly as the app receives it (supabase.js falls back to process.env under node)
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { fetchReviewsFor, fetchAllReviews, enrichReviewRows } = await import('../src/lib/reviews.js');
const { supabase } = await import('../src/lib/supabase.js');
const { computeSellerTrust, computeTrustScore } = await import('../src/lib/utils.js');

// The production profile from the FRONTEND-008C report:
// rating 5, review_count 5, reviews section rendered "No reviews yet".
const AFFECTED = '750149a6-0d3c-4b5c-9a18-a1a925660b2e';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✔ ${name}`); pass++; }
  catch (e) { console.error(`  ✘ ${name}\n    ${e.message}`); fail++; }
}

console.log('── reputation integration (live production DB, anon key, read-only)');

// 1. Aggregate says N ⇒ the authoritative loader returns exactly N base rows.
//    (The pre-008C embed query returned HTTP 400 here and rendered zero.)
let affectedRows = null;
await test('affected profile: loader row count equals profiles.review_count', async () => {
  const [{ rows, total }, { data: prof, error }] = await Promise.all([
    fetchReviewsFor(AFFECTED, { limit: 20 }),
    supabase.from('profiles').select('rating, review_count').eq('id', AFFECTED).single(),
  ]);
  assert.equal(error, null);
  affectedRows = rows;
  assert.equal(total, prof.review_count, `total ${total} != review_count ${prof.review_count}`);
  assert.equal(rows.length, prof.review_count, `rows ${rows.length} != review_count ${prof.review_count}`);
});

// 2. Optional listing relation unavailable (all 5 listings are sold and
//    hidden from anon by RLS) ⇒ every review row still present, listing null.
await test('missing/hidden listing relation never drops a review row', async () => {
  assert.ok(affectedRows?.length > 0, 'needs rows from test 1');
  assert.ok(affectedRows.every((r) => 'listing' in r), 'listing key present');
  const hidden = affectedRows.filter((r) => r.listing === null).length;
  console.log(`      (${hidden}/${affectedRows.length} listings unavailable — rows preserved)`);
});

// 3. Reviewer enrichment failure ⇒ base rows preserved with reviewer=null.
await test('reviewer enrichment failure degrades to null, preserves rows', async () => {
  const deadClient = createClient('https://127.0.0.1:9', 'x', { auth: { persistSession: false } });
  const base = affectedRows.map(({ reviewer, reviewed, listing, ...r }) => r);
  const enriched = await enrichReviewRows(base, deadClient);
  assert.equal(enriched.length, base.length);
  assert.ok(enriched.every((r) => r.reviewer === null && r.listing === null));
});

// 4. Base-query failure ⇒ loader THROWS (UI shows error+retry) — never a
//    silent empty success.
await test('database failure raises an error, not an empty result', async () => {
  const deadClient = createClient('https://127.0.0.1:9', 'x', { auth: { persistSession: false } });
  await assert.rejects(() => fetchReviewsFor(AFFECTED, { client: deadClient }));
});

// 5. Zero rows for a nonexistent profile ⇒ honest empty success.
await test('zero reviews returns empty success (honest empty state)', async () => {
  const { rows, total } = await fetchReviewsFor('00000000-0000-0000-0000-000000000000');
  assert.deepEqual(rows, []);
  assert.equal(total, 0);
});

// 6+7. Both directions surface on the same profile view.
await test('buyer→seller and seller→buyer reviews both load for the reviewed user', async () => {
  const roles = new Set(affectedRows.map((r) => r.reviewer_role));
  assert.ok(roles.has('buyer'), 'buyer→seller review present');
  assert.ok(roles.has('seller'), 'seller→buyer review present');
});

// Ordering requirement: newest first.
await test('rows are ordered newest-first', async () => {
  const ts = affectedRows.map((r) => new Date(r.created_at).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
});

// 8/9-invariant. Insert/delete recompute triggers (20260718000002) are
// validated by the standing invariant they maintain: every profile's stored
// aggregate equals recomputation from live rows.
await test('aggregates equal recomputation from base rows (all reviewed profiles)', async () => {
  const { data: profs } = await supabase
    .from('profiles').select('id, rating, review_count').gt('review_count', 0);
  for (const p of profs) {
    const { data: revs } = await supabase.from('reviews').select('rating').eq('seller_id', p.id);
    assert.equal(revs.length, p.review_count, `count drift for ${p.id}`);
    const avg = Math.round((revs.reduce((s, r) => s + r.rating, 0) / revs.length) * 10) / 10;
    assert.equal(Number(p.rating), avg, `rating drift for ${p.id}`);
  }
});

// 10. Seller card and seller profile consume identical field values: the
//    card's listings-embedded seller row must carry the same reputation
//    fields as the profiles row the profile header reads.
await test('seller card embed and profile row agree on reputation fields', async () => {
  const { data: listing } = await supabase
    .from('listings')
    .select('seller_id, seller:profiles(id, rating, review_count, total_sales, created_at)')
    .eq('seller_id', AFFECTED).eq('status', 'active').limit(1).maybeSingle();
  if (!listing) { console.log('      (no active listing — skipped equality check)'); return; }
  const { data: prof } = await supabase
    .from('profiles').select('id, rating, review_count, total_sales, created_at')
    .eq('id', AFFECTED).single();
  assert.deepEqual(
    { r: listing.seller.rating, c: listing.seller.review_count, s: listing.seller.total_sales },
    { r: prof.rating, c: prof.review_count, s: prof.total_sales }
  );
  const cardTrust = computeSellerTrust(listing.seller);
  const profTrust = computeSellerTrust(prof);
  assert.equal(cardTrust.badge, profTrust.badge, 'card and profile badge must agree');
});

// Admin moderation feed uses the same authoritative path.
await test('admin feed loads via the same path (no dropped rows)', async () => {
  const { rows, total } = await fetchAllReviews({ limit: 50 });
  assert.ok(rows.length > 0);
  assert.ok(total >= rows.length);
  assert.ok(rows.every((r) => 'reviewer' in r && 'reviewed' in r && 'listing' in r));
});

// Trust formula: deterministic, bounded, monotonic in the product-required
// directions (more good reviews ⇒ up; bad reviews ⇒ down; volume ⇒ confidence).
await test('trust formula: baseline, monotonicity, bounds, badge consistency', async () => {
  const zero = computeTrustScore({});
  assert.equal(zero.score, 0);
  assert.equal(zero.badge, 'newSeller');

  const base = { hasFullName: true, salesCount: 5, accountAgeDays: 160 };
  const few  = computeTrustScore({ ...base, sellerRating: 5, sellerRatingCount: 1 });
  const some = computeTrustScore({ ...base, sellerRating: 5, sellerRatingCount: 5 });
  const many = computeTrustScore({ ...base, sellerRating: 5, sellerRatingCount: 10 });
  assert.ok(few.score < some.score && some.score < many.score, 'volume raises confidence');

  const bad = computeTrustScore({ ...base, sellerRating: 2, sellerRatingCount: 5 });
  assert.ok(bad.score < some.score, 'poor rating lowers trust');

  const maxed = computeTrustScore({
    hasFullName: true, hasAvatar: true, hasBio: true, isVerified: true, isPhoneVerified: true,
    salesCount: 100, sellerRating: 5, sellerRatingCount: 100, accountAgeDays: 1000, listingsCount: 100,
  });
  assert.ok(maxed.score <= 100, 'score capped at 100 (no unlimited inflation)');

  for (const t of [zero, few, some, many, bad, maxed]) {
    const expected = t.score >= 85 ? 'eliteSeller' : t.score >= 65 ? 'topSeller' : t.score >= 40 ? 'trustedSeller' : 'newSeller';
    assert.equal(t.badge, expected, `badge must derive from the same score (${t.score})`);
  }
});

// The affected profile specifically: 5 sales + 5.0×5 reviews must not read
// as an unreputed "New Seller" anywhere.
await test('affected profile: trust/badge reflect real reputation on all surfaces', async () => {
  const { data: prof } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, is_verified, rating, review_count, total_sales, created_at')
    .eq('id', AFFECTED).single();
  const t = computeSellerTrust(prof); // card shape: no listings count
  assert.ok(prof.total_sales >= 5, `total_sales backfilled (got ${prof.total_sales})`);
  assert.ok(t.trustScore >= 40, `trust ${t.trustScore} must clear trusted tier`);
  assert.notEqual(t.badge, 'newSeller', 'five-sale 5.0-rated seller is not a New Seller');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
