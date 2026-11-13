-- Rollback of 20261113120000_market_observations.sql. Promote a deployment without the market index FIRST
-- (it tolerates the tables' absence anyway: reads and writes fail soft), then run this.
DROP FUNCTION IF EXISTS public.purge_market_observations();
DROP FUNCTION IF EXISTS public.record_market_observations(jsonb);
DROP TABLE IF EXISTS public.market_observation_prices;
DROP TABLE IF EXISTS public.market_observations;
