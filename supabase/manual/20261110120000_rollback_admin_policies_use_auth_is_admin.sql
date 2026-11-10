-- Rollback of 20261110120000_admin_policies_use_auth_is_admin.sql: restores the exact policy expressions and scan_events
-- grants captured from Production on 2026-11-10 (which reproduce the "permission denied for table profiles" defect).
ALTER POLICY "scan_events_admin_select" ON public.scan_events USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin));
ALTER POLICY "observations_admin_select" ON public.observations USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin));
ALTER POLICY "recognition_memory_admin_select" ON public.recognition_memory USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin));
ALTER POLICY "rm_samples_admin_select" ON public.recognition_memory_samples USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin));
ALTER POLICY "Jobs admin only" ON public.jobs_queue USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
ALTER POLICY "admins_full_access_candidates" ON public.product_candidates USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
ALTER POLICY "Products admin write" ON public.products USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
ALTER POLICY "Users see own valuations" ON public.valuations USING ((user_id = auth.uid()) OR (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)));
GRANT ALL ON TABLE public.scan_events TO anon, authenticated;
