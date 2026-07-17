// ═══════════════════════════════════════════════════════
// REVIEWS — single authoritative loading path (FRONTEND-008C)
//
// Production defect this replaces: every review loader embedded
// `reviewer:profiles!reviewer_id(...)` — but the live schema has NO foreign
// key from reviews to profiles, so PostgREST rejected the WHOLE query with
// PGRST200 (HTTP 400). Profiles said "5 reviews" while the list rendered
// zero, because the catch block swallowed the error into an empty array.
//
// Contract:
//   reviews.seller_id   = the REVIEWED party (buyer or seller — despite the
//                         name), i.e. the profile whose reputation the row
//                         feeds. Maintained by DB policy since 20260718000002.
//   reviews.reviewer_id = the author.
//   reviews.reviewer_role = the AUTHOR's side of the order ('buyer' wrote it
//                         → subject was reviewed as seller, and vice versa).
//
// Rules:
//   1. Base rows load FIRST, alone, by reviewed-profile UUID. They are the
//      authoritative record and are never dropped.
//   2. Reviewer/listing data is optional enrichment via separate queries.
//      A missing/hidden relation (sold listing behind RLS, deleted profile)
//      or a failed enrichment query degrades that field to null — the UI
//      shows "Listing unavailable" / "User unavailable" instead.
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// Optional enrichment: attach reviewer / reviewed / listing objects.
// Never throws, never drops rows — on any failure relations stay null.
export async function enrichReviewRows(rows, client = supabase) {
  if (!rows?.length) return rows ?? [];
  const profileIds = [...new Set(
    rows.flatMap((r) => [r.reviewer_id, r.seller_id]).filter(Boolean)
  )];
  const listingIds = [...new Set(rows.map((r) => r.listing_id).filter(Boolean))];

  const [profRes, listRes] = await Promise.all([
    profileIds.length
      ? client.from('profiles').select('id, full_name, avatar_url').in('id', profileIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? client.from('listings').select('id, title, title_hebrew, images').in('id', listingIds)
      : Promise.resolve({ data: [] }),
  ]).catch(() => [{ data: [] }, { data: [] }]);

  if (profRes.error) console.warn('[Reviews] reviewer enrichment failed:', profRes.error.message);
  if (listRes.error) console.warn('[Reviews] listing enrichment failed:', listRes.error.message);

  const profMap = new Map((profRes.data || []).map((p) => [p.id, p]));
  const listMap = new Map((listRes.data || []).map((l) => [l.id, l]));
  return rows.map((r) => ({
    ...r,
    reviewer: profMap.get(r.reviewer_id) ?? null,
    reviewed: profMap.get(r.seller_id) ?? null,
    listing:  listMap.get(r.listing_id) ?? null,
  }));
}

// All reviews RECEIVED by a profile (both directions), newest first.
// Returns { rows, total } — total is the authoritative DB count, which may
// exceed rows.length when a page limit applies ("Showing X of Y").
// Throws on base-query failure: callers must surface an error state, never
// an empty list.
export async function fetchReviewsFor(profileId, { limit = 20, client = supabase } = {}) {
  const { data, error, count } = await client
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('seller_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data || [];
  return { rows: await enrichReviewRows(rows, client), total: count ?? rows.length };
}

// Latest reviews platform-wide (admin moderation), newest first.
export async function fetchAllReviews({ limit = 50, client = supabase } = {}) {
  const { data, error, count } = await client
    .from('reviews')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data || [];
  return { rows: await enrichReviewRows(rows, client), total: count ?? rows.length };
}
