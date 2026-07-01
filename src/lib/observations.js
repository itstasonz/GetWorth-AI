// ═══════════════════════════════════════════════════════════════════════════
// GW-005A — Observation recorder (the "black box flight recorder", client side)
// ═══════════════════════════════════════════════════════════════════════════
// Append-only, fire-and-forget writer for real user/business signals into the
// `observations` table (migration 20260701130000_gw005a_observations.sql).
//
// Principles (must hold at every call site):
//   • Signals come from REALITY — actual user behaviour (scanning, valuation
//     feedback, marketplace actions). Never AI output treated as independent
//     truth, never GetWorth's own suggestions fed back as if observed.
//   • event_payload carries ONLY ids + quantitative / categorical signals —
//     NEVER raw PII (names, emails, phones, addresses, free text). See migration
//     PART 3. cleanPayload() is a defensive net, not a substitute for that rule.
//   • Recording MUST NOT affect UX — every call is guarded and never throws.
//
// RLS: authenticated clients may INSERT only their own rows (user_id = auth.uid()).
// Anonymous sessions cannot insert; those events are skipped silently here.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

const DEV = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Payload-contract generation. Bump when the SHAPE of any event's payload changes
// in a breaking way, so downstream consumers can branch on old vs new rows.
// Injected into every observation centrally — never set at call sites.
const SCHEMA_VERSION = 1;

// Canonical event types. Keep names stable — future analytics depend on them.
export const OBS = {
  VALUATION_COMPLETED: 'valuation_completed', // a scan produced a valuation
  VALUATION_REFINED:   'valuation_refined',   // user corrected the identification
  VALUATION_CONFIRMED: 'valuation_confirmed', // user confirmed the identification
  LISTING_CREATED:     'listing_created',     // seller published at a chosen price
  ORDER_CREATED:       'order_created',        // buyer initiated a purchase
  ORDER_TRANSITIONED:  'order_transitioned',   // marketplace outcome (accept/complete/…)
  REVIEW_SUBMITTED:    'review_submitted',     // completed-order rating
};

// Record one observation. Resolves the user from the local session (no network),
// inserts a flat, PII-free payload, and swallows every failure.
//
//   recordObservation(OBS.LISTING_CREATED, { category, price }, { valuationId })
export async function recordObservation(eventType, payload = {}, opts = {}) {
  try {
    if (!eventType) return;

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return; // RLS: only authenticated users may insert their own rows

    const { error } = await supabase.from('observations').insert({
      user_id:       userId,
      scan_uuid:     opts.scanUuid ?? null,
      valuation_id:  opts.valuationId ?? null,
      event_type:    eventType,
      // schema_version added last so it always survives and can't be shadowed.
      event_payload: { ...cleanPayload(payload), schema_version: SCHEMA_VERSION },
    });
    if (error && DEV) console.warn('[obs] insert failed:', eventType, error.message);
  } catch (e) {
    if (DEV) console.warn('[obs] error:', e?.message);
    /* never throw — observation logging must not affect UX */
  }
}

// Keep only primitive, non-empty values. Dropping nested objects/arrays keeps the
// payload flat and makes accidental PII (nested user records, address objects)
// much harder to leak. Callers should still pass only ids + numeric/categorical.
function cleanPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
  }
  return out;
}
