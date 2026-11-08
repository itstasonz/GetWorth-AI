-- ROLLBACK for 20261108150000_marketplace_sale_evidence.sql — removes the two read-only functions. No data involved.
BEGIN;
DROP FUNCTION IF EXISTS public.marketplace_sale_evidence(timestamptz);
DROP FUNCTION IF EXISTS public.admin_accuracy_report();
COMMIT;
