-- ══════════════════════════════════════════════════════════════════════════════
-- GetWorth — GW-005A Observation & Feedback Foundation
-- Generated: 2026-07-01
-- Apply in Supabase Dashboard → SQL Editor (or `supabase db push`) BEFORE deploying
-- the matching app changes. Idempotent — safe to re-run.
--
-- The "black box flight recorder": an append-only, immutable, replayable log of
-- real user/business signals (scanning, valuation, marketplace, feedback). It is
-- SEPARATE from scan_events (GW-000), which stays a scan-scoped pipeline log.
--
-- Signals come from reality (user behavior), never from AI or from GetWorth's own
-- suggestions. This table only COLLECTS; no analytics, dashboards, or Market
-- Intelligence are built on it yet.
--
-- Schema (per GW-005A):
--   observation_id · scan_uuid · valuation_id · user_id · event_type · event_payload · created_at
--
-- scan_uuid / valuation_id / user_id are nullable — marketplace events are not
-- always scan-scoped, and retention/erasure may null user_id (see PART 3).
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — observations table (append-only, minimal, generic)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS observations (
  observation_id  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_uuid       uuid,
  valuation_id    uuid,
  user_id         uuid,
  event_type      text        NOT NULL,
  event_payload   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Analytics-readiness indexes (queries by type/time/entity are the future access paths).
CREATE INDEX IF NOT EXISTS idx_observations_event_type  ON observations (event_type);
CREATE INDEX IF NOT EXISTS idx_observations_created_at  ON observations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_scan_uuid   ON observations (scan_uuid)    WHERE scan_uuid   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_valuation   ON observations (valuation_id) WHERE valuation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_user_id     ON observations (user_id)      WHERE user_id      IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — RLS: append-only for clients, admin-only reads
--
-- • Server (service role) writes any observation (bypasses RLS).
-- • Authenticated clients may INSERT only their OWN observations (user_id = auth.uid()).
-- • No UPDATE/DELETE policy → append-only / immutable for clients. Retention and
--   erasure run via the service role only (PART 3).
-- • Reads are admin-only so raw behavioral telemetry is never exposed to clients
--   (future GW-009 dashboard reads with an admin session).
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS observations_insert_own ON observations;
CREATE POLICY observations_insert_own
  ON observations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS observations_admin_select ON observations;
CREATE POLICY observations_admin_select
  ON observations FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3 — Retention / GDPR notes (documented; jobs are a later ticket)
--
-- • Immutable facts: prices, conditions, categories, confidences, durations, ids
--   are pseudonymous business signals — retained long-term to power future pricing
--   intelligence and accuracy tracking.
-- • event_payload MUST NOT contain raw PII (no names/emails/phones/addresses) —
--   only ids and quantitative signals. Enforced in application code.
-- • Right-to-erasure: null the user_id for a subject (keeps the anonymized signal,
--   removes the personal link) via a service-role job — the only permitted mutation.
-- • Optional future TTL: raw high-volume events may expire after N months once
--   rolled up; aggregates persist. Not implemented here.
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4 — Verify (run manually after applying)
-- ══════════════════════════════════════════════════════════════════════════════
-- SELECT to_regclass('public.observations');
-- SELECT relrowsecurity FROM pg_class WHERE relname='observations';   -- expect t
-- SELECT policyname, cmd FROM pg_policies WHERE tablename='observations';
