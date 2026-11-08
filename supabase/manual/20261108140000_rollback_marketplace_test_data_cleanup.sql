-- ROLLBACK for 20261108140000_marketplace_test_data_cleanup.sql — run by hand, in one transaction.
-- Restores every value the batch changed, exactly as the snapshot recorded it, then removes the batch's log rows.
-- The log table itself is kept (drop it separately only if no other batch uses it).
BEGIN;

UPDATE public.comps c
SET is_outlier = (l.old_value #>> '{}')::boolean
FROM public.data_correction_log l
WHERE l.batch = 'gw-test-sales-2026-11-08' AND l.table_name = 'comps' AND l.column_name = 'is_outlier' AND l.row_id = c.id;

UPDATE public.valuations v
SET actual_sold_price = (SELECT (l.old_value #>> '{}')::numeric FROM public.data_correction_log l
                          WHERE l.batch = 'gw-test-sales-2026-11-08' AND l.table_name = 'valuations' AND l.column_name = 'actual_sold_price' AND l.row_id = v.id),
    price_accuracy    = (SELECT (l.old_value #>> '{}')::real FROM public.data_correction_log l
                          WHERE l.batch = 'gw-test-sales-2026-11-08' AND l.table_name = 'valuations' AND l.column_name = 'price_accuracy' AND l.row_id = v.id)
WHERE v.id IN (SELECT row_id FROM public.data_correction_log WHERE batch = 'gw-test-sales-2026-11-08' AND table_name = 'valuations');

DELETE FROM public.data_correction_log WHERE batch = 'gw-test-sales-2026-11-08';

COMMIT;
