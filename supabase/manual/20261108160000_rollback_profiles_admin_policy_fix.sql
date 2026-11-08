-- ROLLBACK for 20261108160000_profiles_admin_policy_fix.sql — restores the policy condition exactly as it was
-- (captured from pg_policies on 2026-11-08). Note: this brings back the defect (user profile updates denied).
BEGIN;
ALTER POLICY "Admin update any profile" ON public.profiles
  USING (EXISTS (SELECT 1 FROM public.profiles profiles_1 WHERE profiles_1.id = auth.uid() AND profiles_1.is_admin = true));
COMMIT;
