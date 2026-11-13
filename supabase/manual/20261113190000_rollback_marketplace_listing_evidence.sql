-- Rollback of 20261113190000: the scan tolerates the function's absence (no first-party asking prices, never a failed scan).
DROP FUNCTION IF EXISTS public.marketplace_listing_evidence(timestamptz);
