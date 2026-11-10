// AT — admin telemetry access (Production defect 2026-11-10: Admin → Scans showed "permission denied for table profiles").
// Real Postgres (PGlite) on Production's captured schema: the marketplace baseline (profiles with its column-level grants,
// auth_is_admin) plus the eight policies exactly as Production had them, then migration 20261110120000. Every read runs
// as the app does: role anon or authenticated, with the JWT subject set.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BASELINE = read('tests/fixtures/db/marketplace-baseline.sql');
// Already applied to Production on 2026-11-08 (after the baseline capture).
const PROFILES_FIX = read('supabase/migrations/20261108160000_profiles_admin_policy_fix.sql');
const MIGRATION = read('supabase/migrations/20261110120000_admin_policies_use_auth_is_admin.sql');
const ROLLBACK = read('supabase/manual/20261110120000_rollback_admin_policies_use_auth_is_admin.sql');

const ADMIN = '00000000-0000-4000-8000-00000000000a';
const USER = '00000000-0000-4000-8000-00000000000b';
const OTHER = '00000000-0000-4000-8000-00000000000c';

// The eight policies and the scan_events grants as captured from Production's pg_policies / relacl on 2026-11-10.
const PRODUCTION_BEFORE = `
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE TABLE public.scan_events (id bigserial PRIMARY KEY, scan_uuid uuid, event_type text, stage text, payload jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE public.observations (id bigserial PRIMARY KEY, user_id uuid, payload jsonb);
CREATE TABLE public.recognition_memory (id bigserial PRIMARY KEY, label text);
CREATE TABLE public.recognition_memory_samples (id bigserial PRIMARY KEY, label text);
CREATE TABLE public.product_candidates (id bigserial PRIMARY KEY, created_by uuid, name text);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name text;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scan_events','observations','recognition_memory','recognition_memory_samples','product_candidates','products','jobs_queue','valuations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
CREATE POLICY "scan_events_admin_select" ON public.scan_events FOR SELECT TO public USING (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_admin)));
CREATE POLICY "observations_admin_select" ON public.observations FOR SELECT TO public USING (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_admin)));
CREATE POLICY "observations_insert_own" ON public.observations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "recognition_memory_admin_select" ON public.recognition_memory FOR SELECT TO public USING (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_admin)));
CREATE POLICY "rm_samples_admin_select" ON public.recognition_memory_samples FOR SELECT TO public USING (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND p.is_admin)));
CREATE POLICY "Jobs admin only" ON public.jobs_queue FOR ALL TO public USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))));
CREATE POLICY "admins_full_access_candidates" ON public.product_candidates FOR ALL TO public USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))));
CREATE POLICY "users_can_insert_own_candidates" ON public.product_candidates FOR INSERT TO public WITH CHECK ((auth.uid() IS NOT NULL) AND (auth.uid() = created_by));
CREATE POLICY "users_can_select_own_candidates" ON public.product_candidates FOR SELECT TO public USING (auth.uid() = created_by);
CREATE POLICY "Products admin write" ON public.products FOR ALL TO public USING (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true))));
CREATE POLICY "Products are publicly readable" ON public.products FOR SELECT TO public USING (true);
CREATE POLICY "Service role can manage products" ON public.products FOR ALL TO public USING (auth.role() = 'service_role'::text);
CREATE POLICY "Users create own valuations" ON public.valuations FOR INSERT TO public WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users see own valuations" ON public.valuations FOR SELECT TO public USING ((user_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.is_admin = true)))));
CREATE POLICY "Users update own valuations" ON public.valuations FOR UPDATE TO public USING (user_id = auth.uid());
`;

async function fresh({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(PROFILES_FIX);
  await db.exec(PRODUCTION_BEFORE);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${USER}'), ('${OTHER}');
    INSERT INTO public.profiles (id, full_name, is_admin) VALUES ('${ADMIN}', 'admin', true), ('${USER}', 'u', false), ('${OTHER}', 'o', false);
    INSERT INTO public.scan_events (scan_uuid, event_type, stage, payload, created_at) VALUES
      (gen_random_uuid(), 'core_scan_request', 'core_scan', '{"action":"identify","outcome":"identified","total_ms":8100}', now() - interval '1 hour'),
      (gen_random_uuid(), 'core_scan_request', 'core_scan', '{"action":"identify","outcome":"failed","reason":"credit_exhausted","refunded":true}', now() - interval '2 hours'),
      (gen_random_uuid(), 'core_scan_prewarm', 'core_scan', '{"status":"ran","spent_usd":0.054,"cap_usd":0.3}', now() - interval '3 hours'),
      (gen_random_uuid(), 'core_scan_prewarm_control', 'core_scan', '{"enabled":true}', now() - interval '4 hours'),
      (gen_random_uuid(), 'core_scan_alert', 'core_scan', '{"kind":"openai_credit_exhausted"}', now() - interval '5 hours');
    INSERT INTO public.valuations (user_id, price_mid) VALUES ('${USER}', 100), ('${OTHER}', 200);
    INSERT INTO public.observations (user_id, payload) VALUES ('${USER}', '{}');
    INSERT INTO public.recognition_memory (label) VALUES ('x');
    INSERT INTO public.recognition_memory_samples (label) VALUES ('x');
    INSERT INTO public.product_candidates (created_by, name) VALUES ('${USER}', 'mine'), ('${OTHER}', 'theirs');
    INSERT INTO public.products (name) VALUES ('Bose QC45');
  `);
  if (migrate) await db.exec(MIGRATION);
  return db;
}

/** Run `fn(tx)` as anon (uid null) or as an authenticated account, as PostgREST does. */
async function as(db, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
      [uid ?? '', JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    await tx.exec(`SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
}
const rows = (db, uid, sql, params = []) => as(db, uid, async (tx) => (await tx.query(sql, params)).rows);
const refused = async (p, pattern) => { try { await p; } catch (e) { assert.match(e.message, pattern); return; } assert.fail('expected a refusal'); };

// The dashboard's own queries (src/views/ScanMonitor.jsx, src/components/PrewarmPanel.jsx), as PostgREST renders them.
const MONITOR = `SELECT scan_uuid, created_at, payload FROM public.scan_events WHERE event_type = 'core_scan_request' AND created_at >= now() - interval '7 days' ORDER BY created_at DESC LIMIT 500`;
const PREWARM = `SELECT event_type, created_at, payload FROM public.scan_events WHERE event_type IN ('core_scan_prewarm','core_scan_prewarm_control','core_scan_alert') AND created_at >= now() - interval '7 days' ORDER BY created_at DESC LIMIT 200`;
const CREDIT_FAILURES = `SELECT count(*)::int AS n FROM public.scan_events WHERE event_type = 'core_scan_request' AND payload->>'reason' = 'credit_exhausted' AND created_at >= now() - interval '1 day'`;

describe('AT-1 the defect, as Production had it', () => {
  test('AT-1a the admin dashboard read fails with "permission denied for table profiles" — for the admin too', async () => {
    const db = await fresh({ migrate: false });
    await refused(rows(db, ADMIN, MONITOR), /permission denied for table profiles/);
    await refused(rows(db, ADMIN, PREWARM), /permission denied for table profiles/);
    await refused(rows(db, USER, 'SELECT id FROM public.valuations'), /permission denied for table profiles/);
  });
});

describe('AT-2 after the migration: the admin reads every dashboard figure', () => {
  test('AT-2a scan counts, failures, latency, pre-research status and spend all load for the admin', async () => {
    const db = await fresh();
    const monitor = await rows(db, ADMIN, MONITOR);
    assert.equal(monitor.length, 2);
    assert.deepEqual(monitor.map((r) => r.payload.outcome).sort(), ['failed', 'identified']);
    assert.equal(monitor.find((r) => r.payload.outcome === 'identified').payload.total_ms, 8100);
    const prewarm = await rows(db, ADMIN, PREWARM);
    assert.deepEqual(prewarm.map((r) => r.event_type), ['core_scan_prewarm', 'core_scan_prewarm_control', 'core_scan_alert']);
    assert.equal(prewarm[0].payload.spent_usd, 0.054);
    assert.equal((await rows(db, ADMIN, CREDIT_FAILURES))[0].n, 1);
  });
  test('AT-2b the admin reads the other admin-only tables and every valuation', async () => {
    const db = await fresh();
    for (const t of ['observations', 'recognition_memory', 'recognition_memory_samples']) assert.equal((await rows(db, ADMIN, `SELECT id FROM public.${t}`)).length, 1, t);
    assert.equal((await rows(db, ADMIN, 'SELECT id FROM public.valuations')).length, 2);
    assert.equal((await rows(db, ADMIN, 'SELECT id FROM public.product_candidates')).length, 2);
  });
});

describe('AT-3 unauthorized callers get no telemetry', () => {
  test('AT-3a a signed-in non-admin: no error, and zero rows of scan_events, observations, recognition memory, jobs', async () => {
    const db = await fresh();
    for (const sql of [MONITOR, PREWARM, 'SELECT id FROM public.observations', 'SELECT id FROM public.recognition_memory', 'SELECT id FROM public.recognition_memory_samples', 'SELECT id FROM public.jobs_queue']) {
      assert.equal((await rows(db, USER, sql)).length, 0, sql);
    }
    assert.equal((await rows(db, USER, CREDIT_FAILURES))[0].n, 0);
  });
  test('AT-3b anonymous: scan_events is refused outright; the other admin tables return nothing', async () => {
    const db = await fresh();
    await refused(rows(db, null, MONITOR), /permission denied for table scan_events/);
    for (const t of ['observations', 'recognition_memory', 'recognition_memory_samples', 'jobs_queue', 'valuations', 'product_candidates']) {
      assert.equal((await rows(db, null, `SELECT id FROM public.${t}`)).length, 0, t);
    }
  });
  test('AT-3c no client role can write or empty the telemetry, admin included', async () => {
    const db = await fresh();
    for (const uid of [USER, ADMIN]) {
      await refused(rows(db, uid, `INSERT INTO public.scan_events (event_type, payload) VALUES ('core_scan_prewarm', '{"spent_usd":-5}')`), /permission denied for table scan_events/);
      await refused(rows(db, uid, `UPDATE public.scan_events SET payload = '{}'`), /permission denied for table scan_events/);
      await refused(rows(db, uid, 'DELETE FROM public.scan_events'), /permission denied for table scan_events/);
      await refused(rows(db, uid, 'TRUNCATE public.scan_events'), /permission denied for table scan_events/);
    }
    await refused(rows(db, null, 'TRUNCATE public.scan_events'), /permission denied for table scan_events/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.scan_events')).rows[0].n, 5);
    const acl = (await db.query(`SELECT relacl::text AS a FROM pg_class WHERE oid = 'public.scan_events'::regclass`)).rows[0].a;
    assert.match(acl, /authenticated=r\//, 'authenticated: SELECT only');
    assert.doesNotMatch(acl, /anon=/, 'anon: nothing');
  });
  test('AT-3d the admin flag stays private: not readable, and auth_is_admin() answers only for the caller', async () => {
    const db = await fresh();
    await refused(rows(db, USER, 'SELECT is_admin FROM public.profiles'), /permission denied for table profiles/);
    await refused(rows(db, null, 'SELECT is_admin FROM public.profiles'), /permission denied for table profiles/);
    assert.equal((await rows(db, USER, 'SELECT public.auth_is_admin() AS a'))[0].a, false);
    assert.equal((await rows(db, null, 'SELECT public.auth_is_admin() AS a'))[0].a, false);
    assert.equal((await rows(db, ADMIN, 'SELECT public.auth_is_admin() AS a'))[0].a, true);
  });
});

describe('AT-4 the other policies keep their meaning', () => {
  test('AT-4a valuations: an owner sees only their own (this read failed for everyone before)', async () => {
    const db = await fresh();
    assert.deepEqual((await rows(db, USER, 'SELECT price_mid::int AS p FROM public.valuations')).map((r) => r.p), [100]);
    assert.deepEqual((await rows(db, OTHER, 'SELECT price_mid::int AS p FROM public.valuations')).map((r) => r.p), [200]);
  });
  test('AT-4b candidates: own only for users; products readable by all, writable by admins only', async () => {
    const db = await fresh();
    assert.deepEqual((await rows(db, USER, 'SELECT name FROM public.product_candidates')).map((r) => r.name), ['mine']);
    assert.equal((await rows(db, null, 'SELECT name FROM public.products')).length, 1);
    await refused(rows(db, USER, `INSERT INTO public.products (name) VALUES ('fake')`), /row-level security/);
    await refused(rows(db, USER, `INSERT INTO public.jobs_queue (job_type) VALUES ('x')`), /row-level security/);
    assert.equal((await rows(db, ADMIN, `INSERT INTO public.products (name) VALUES ('real') RETURNING id`)).length, 1);
  });
  test('AT-4c the migration only rewrites the admin test: same policy names, commands and roles', async () => {
    const before = await fresh({ migrate: false });
    const after = await fresh();
    const shape = async (db) => (await db.query(`SELECT tablename, policyname, cmd, roles::text, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`)).rows;
    assert.deepEqual(await shape(after), await shape(before));
    const leftover = (await after.query(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND coalesce(qual, '') LIKE '%is_admin%' AND coalesce(qual, '') NOT LIKE '%auth_is_admin()%'`)).rows;
    assert.deepEqual(leftover.map((r) => r.policyname), [], 'no policy reads profiles.is_admin as the caller');
  });
  test('AT-4d the rollback restores Production exactly as it was (the defect comes back)', async () => {
    const db = await fresh();
    await db.exec(ROLLBACK);
    await refused(rows(db, ADMIN, MONITOR), /permission denied for table profiles/);
  });
});
