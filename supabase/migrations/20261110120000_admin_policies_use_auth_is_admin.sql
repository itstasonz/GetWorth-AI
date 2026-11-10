-- ══════════════════════════════════════════════════════════════════════════════
-- 20261110120000 — admin RLS checks through auth_is_admin(), never through profiles.is_admin as the caller
--
-- DEFECT (Production, 2026-11-10, Admin → Scans on the founder's iPhone): "permission denied for table profiles".
-- Eight policies decide "is the caller an admin?" with
--     EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin)
-- A policy expression runs with the CALLER's privileges. Production grants anon/authenticated SELECT on 13 profile
-- columns only — is_admin is deliberately not one of them (no one can list the admins) — so the subquery itself is
-- refused and the whole read fails with 42501, for admins and everyone else alike. Reproduced anonymously against
-- Production's REST API on scan_events, valuations and observations.
--
-- FIX: the same question through public.auth_is_admin() — SECURITY DEFINER, search_path pinned to public, returns
-- COALESCE(profiles.is_admin, false) for auth.uid() only, EXECUTE already granted to anon/authenticated, and already used
-- by listings_select_admin_bypass / orders_select_admin_bypass / "Admin update any profile" (20261108160000).
-- Each policy keeps its name, command, roles and every other condition; only the admin test changes form. Nobody gains
-- access: a non-admin still gets false, anon (auth.uid() NULL) gets false, and is_admin stays unreadable.
--
-- LEAST PRIVILEGE on the telemetry table: scan_events is written only by the server (service_role). The client roles held
-- every table privilege (arwdDxtm) — harmless under RLS for INSERT/UPDATE/DELETE (no policy allows them) but TRUNCATE is
-- not subject to RLS. anon loses everything; authenticated keeps SELECT only, which RLS limits to admins.
-- Rollback: supabase/manual/20261110120000_rollback_admin_policies_use_auth_is_admin.sql
-- ══════════════════════════════════════════════════════════════════════════════

ALTER POLICY "scan_events_admin_select" ON public.scan_events USING (public.auth_is_admin());
ALTER POLICY "observations_admin_select" ON public.observations USING (public.auth_is_admin());
ALTER POLICY "recognition_memory_admin_select" ON public.recognition_memory USING (public.auth_is_admin());
ALTER POLICY "rm_samples_admin_select" ON public.recognition_memory_samples USING (public.auth_is_admin());
ALTER POLICY "Jobs admin only" ON public.jobs_queue USING (public.auth_is_admin());
ALTER POLICY "admins_full_access_candidates" ON public.product_candidates USING (public.auth_is_admin());
ALTER POLICY "Products admin write" ON public.products USING (public.auth_is_admin());
ALTER POLICY "Users see own valuations" ON public.valuations USING ((user_id = auth.uid()) OR public.auth_is_admin());

REVOKE ALL ON TABLE public.scan_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.scan_events FROM authenticated;
GRANT SELECT ON TABLE public.scan_events TO authenticated;
