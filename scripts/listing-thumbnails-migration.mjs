#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// MIGRATION 20261111120000 — LISTING THUMBNAILS: the reproducible Production procedure
//
//   node scripts/listing-thumbnails-migration.mjs <step>
//
//   backup    READ-ONLY  every listings row + both order functions, to .backups/20261111120000/ (gitignored), hashed
//   prepare   READ-ONLY  reads each legacy first photograph WITH its md5, makes the thumbnails (listing-thumbnails.ps1),
//                        writes apply.sql and the committed manifest (ids, hashes, sizes — no image data)
//   preview   LOCAL      the target project, the checksums, and apply.sql with every image shortened
//   rehearse  ROLLED BACK  apply.sql + its checks + the rollback + its checks, inside one transaction that is rolled back
//   apply     WRITES     after re-checking every checksum, runs apply.sql on the linked project (one transaction)
//   verify    READ-ONLY  the post-apply checks: columns, trigger, functions, thumbnails, originals unchanged
//   rollback  WRITES     the committed rollback (promote the previous deployment FIRST — see that file)
//
// apply.sql is one transaction that aborts itself unless: the photographs of every listing are byte-for-byte what they
// were (md5 of each images array before = after), each thumbnail was made from exactly the photograph it is written
// beside (its md5 is in the UPDATE's WHERE), and every listing with a photograph has a thumbnail.
// No credential is read or printed: the Supabase CLI uses its own login; the project ref is the committed link.
// ══════════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = '20261111120000';
const MIGRATION = `supabase/migrations/${ID}_listing_thumbnails.sql`;
const ROLLBACK = `supabase/manual/${ID}_rollback_listing_thumbnails.sql`;
const MANIFEST = `supabase/manual/${ID}_listing_thumbnails.manifest.json`;
const WORK = path.join(ROOT, '.backups', ID);
const APPLY = path.join(WORK, 'apply.sql');
const at = (p) => path.join(ROOT, p);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const die = (msg) => { console.error(`STOP: ${msg}`); process.exit(1); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THUMB = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

const link = JSON.parse(fs.readFileSync(at('supabase/.temp/linked-project.json'), 'utf8'));
const REF = link.ref;
if (!/^[a-z]{20}$/.test(REF ?? '')) die('the linked project is not a Supabase project ref');

function git(...args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
/** The file must be committed, unchanged, and identical to what HEAD holds. */
function committed(p) {
  const head = git('rev-parse', `HEAD:${p}`);
  const disk = git('hash-object', p);
  if (head !== disk) die(`${p} differs from the commit (HEAD ${head.slice(0, 12)} ≠ disk ${disk.slice(0, 12)})`);
  return { blob: head, sha256: sha256(fs.readFileSync(at(p))), commit: git('log', '-1', '--format=%h', '--', p) };
}

function cli(args, { write = false } = {}) {
  const out = execFileSync('npx', ['-y', 'supabase@latest', ...args, `--remote=${REF}`, ...(write ? ['--yes'] : ['--read-only']), '--output-format', 'json'],
    { cwd: ROOT, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256e6 });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  if (j._tag === 'Error') die(`${j.error?.code}: ${String(j.error?.message).slice(0, 400)}`);
  return j.rows ?? [];
}
function query(sql, opts) {
  fs.mkdirSync(WORK, { recursive: true });
  const f = path.join(WORK, `q-${process.pid}.sql`);
  fs.writeFileSync(f, sql);
  try { return cli(['db', 'query', '-f', f], opts); } finally { fs.rmSync(f, { force: true }); }
}

// ── THE CHECKS apply.sql and rehearse run inside the transaction ─────────────────────────────────────────────────────
const BEFORE = `CREATE TEMP TABLE _lt_before ON COMMIT DROP AS SELECT id, md5(coalesce(images::text, '')) AS h FROM public.listings;`;
const ORIGINALS_UNCHANGED = `DO $$ BEGIN
  IF (SELECT count(*) FROM _lt_before) <> (SELECT count(*) FROM public.listings) THEN RAISE EXCEPTION 'listing count changed'; END IF;
  IF EXISTS (SELECT 1 FROM _lt_before b JOIN public.listings l USING (id) WHERE md5(coalesce(l.images::text, '')) <> b.h) THEN RAISE EXCEPTION 'a listing photograph changed'; END IF;
END $$;`;
const FORWARD_CHECKS = `DO $$ BEGIN
  IF (SELECT count(*) FROM public.listings WHERE cardinality(images) > 0 AND thumbnail IS NULL) > 0 THEN RAISE EXCEPTION 'thumbnail backfill incomplete'; END IF;
  IF (SELECT count(*) FROM public.listings WHERE image_count <> coalesce(cardinality(images), 0)) > 0 THEN RAISE EXCEPTION 'image_count wrong'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_listings_sync_thumbnail') THEN RAISE EXCEPTION 'trigger missing'; END IF;
  IF position('l.thumbnail' in pg_get_functiondef('public.get_user_orders()'::regprocedure)) = 0 THEN RAISE EXCEPTION 'get_user_orders not replaced'; END IF;
  IF position('l.thumbnail' in pg_get_functiondef('public.get_order_by_id(uuid)'::regprocedure)) = 0 THEN RAISE EXCEPTION 'get_order_by_id not replaced'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_user_orders()', 'EXECUTE') THEN RAISE EXCEPTION 'execute grant lost'; END IF;
  IF NOT has_column_privilege('anon', 'public.listings', 'thumbnail', 'SELECT') THEN RAISE EXCEPTION 'anon cannot read thumbnail'; END IF;
END $$;`;
const ROLLBACK_CHECKS = `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.listings'::regclass AND attname IN ('thumbnail', 'image_count') AND NOT attisdropped) THEN RAISE EXCEPTION 'columns not dropped'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_listings_sync_thumbnail') THEN RAISE EXCEPTION 'trigger not dropped'; END IF;
  IF position('l.images' in pg_get_functiondef('public.get_user_orders()'::regprocedure)) = 0 THEN RAISE EXCEPTION 'get_user_orders not restored'; END IF;
END $$;`;

// ── STEPS ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const steps = {
  backup() {
    fs.mkdirSync(WORK, { recursive: true });
    const rows = query('SELECT * FROM public.listings ORDER BY created_at, id;');
    const fns = query(`SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE proname IN ('get_user_orders', 'get_order_by_id') AND pronamespace = 'public'::regnamespace;`);
    const files = { 'listings.json': JSON.stringify(rows), 'order-functions.json': JSON.stringify(fns) };
    const sums = {};
    for (const [name, body] of Object.entries(files)) { fs.writeFileSync(path.join(WORK, name), body); sums[name] = sha256(body); }
    const record = { project: link.name ?? 'linked', taken_at: new Date().toISOString(), listings: rows.length, functions: fns.map((f) => f.sig), sha256: sums,
      images_md5: Object.fromEntries(rows.map((r) => [r.id, md5(JSON.stringify(r.images ?? null))])) };
    fs.writeFileSync(path.join(WORK, 'backup.json'), JSON.stringify(record, null, 1));
    console.log(`backup: ${rows.length} listings, ${fns.length} functions → .backups/${ID}/ (gitignored)`);
    for (const [k, v] of Object.entries(sums)) console.log(`  ${k}  sha256 ${v}`);
  },

  prepare() {
    const mig = committed(MIGRATION);
    fs.mkdirSync(WORK, { recursive: true });
    // md5 computed BY POSTGRES over the very text that will be compared in the UPDATE's guard.
    const rows = query(`SELECT id, md5(images[1]) AS m, images[1] AS img FROM public.listings WHERE cardinality(images) > 0 AND left(images[1], 11) = 'data:image/' ORDER BY created_at, id;`);
    for (const r of rows) {
      if (!UUID.test(r.id)) die(`bad id ${r.id}`);
      if (md5(r.img) !== r.m) die(`md5 of ${r.id} read here differs from Postgres's`);
    }
    const input = path.join(WORK, 'originals.json');
    const output = path.join(WORK, 'thumbs.json');
    fs.writeFileSync(input, JSON.stringify(rows.map((r) => ({ id: r.id, img: r.img }))));
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', at('scripts/listing-thumbnails.ps1'), '-In', input, '-Out', output], { stdio: 'inherit' });
    const thumbs = JSON.parse(fs.readFileSync(output, 'utf8').replace(/^﻿/, ''));
    fs.rmSync(input, { force: true });
    const byId = new Map(thumbs.map((t) => [t.id, t]));
    const entries = rows.map((r) => {
      const t = byId.get(r.id);
      if (!t || t.error || !THUMB.test(t.thumb ?? '') || t.thumb.length > 100_000) die(`no usable thumbnail for ${r.id}: ${t?.error ?? 'missing'}`);
      // The thumbnail is the same picture: its proportions are the original's (within a pixel of rounding).
      if (Math.abs(t.w / t.h - t.src_w / t.src_h) > 2 / Math.min(t.w, t.h)) die(`thumbnail of ${r.id} is not the original's shape`);
      return { id: r.id, original_md5: r.m, original_bytes: r.img.length, original_w: t.src_w, original_h: t.src_h, thumb_sha256: sha256(t.thumb), thumb_bytes: t.thumb.length, w: t.w, h: t.h, thumb: t.thumb };
    });
    const updates = entries.map((e) => `UPDATE public.listings SET thumbnail = '${e.thumb}' WHERE id = '${e.id}' AND thumbnail IS NULL AND md5(images[1]) = '${e.original_md5}';`);
    const sql = [
      `-- ${ID} listing thumbnails — generated by scripts/listing-thumbnails-migration.mjs prepare. One transaction.`,
      'BEGIN;', 'SET LOCAL ROLE postgres;', BEFORE,
      `-- ${MIGRATION} (git blob ${mig.blob}, commit ${mig.commit})`, fs.readFileSync(at(MIGRATION), 'utf8'),
      '-- legacy thumbnails: each guarded by the md5 of the exact photograph it was made from', ...updates,
      ORIGINALS_UNCHANGED, FORWARD_CHECKS,
      `SELECT count(*) AS listings, count(thumbnail) AS with_thumbnail, sum(length(thumbnail)) AS thumbnail_bytes FROM public.listings;`,
      'COMMIT;', '',
    ].join('\n');
    fs.writeFileSync(APPLY, sql);
    const manifest = {
      migration: { path: MIGRATION, git_blob: mig.blob, sha256: mig.sha256, commit: mig.commit },
      rollback: { path: ROLLBACK, ...committed(ROLLBACK) },
      thumbnails: { generator: 'scripts/listing-thumbnails.ps1', max_side: 480, quality: 72, count: entries.length,
        rows: entries.map(({ thumb, ...rest }) => rest) },
      apply_sql: { sha256: sha256(sql), bytes: Buffer.byteLength(sql) },
    };
    fs.writeFileSync(at(MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`prepare: ${entries.length} thumbnails; apply.sql sha256 ${manifest.apply_sql.sha256}; manifest → ${MANIFEST}`);
  },

  preview() {
    const m = gate();
    const sql = fs.readFileSync(APPLY, 'utf8');
    console.log(`target   project "${link.name ?? '?'}" ref ${REF.slice(0, 4)}…${REF.slice(-2)} (supabase/.temp/linked-project.json)`);
    console.log(`migration ${m.migration.path}  blob ${m.migration.git_blob}  sha256 ${m.migration.sha256}  commit ${m.migration.commit}`);
    console.log(`apply.sql sha256 ${m.apply_sql.sha256}  (${m.apply_sql.bytes} bytes, ${m.thumbnails.count} thumbnail updates)`);
    console.log('──────── apply.sql, images shortened ────────');
    console.log(sql.replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, (s) => `data:image/jpeg;base64,…(${s.length} chars)`)
      .split('\n').filter((l, i, a) => !(l.startsWith('UPDATE public.listings SET thumbnail') && a[i - 1]?.startsWith('UPDATE public.listings SET thumbnail') && a[i + 1]?.startsWith('UPDATE public.listings SET thumbnail')))
      .join('\n'));
  },

  rehearse() {
    gate();
    const forward = fs.readFileSync(APPLY, 'utf8').replace(/\nCOMMIT;\n$/, '\n');
    const rollback = fs.readFileSync(at(ROLLBACK), 'utf8').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    const rows = query(`${forward}\n-- rollback, then its checks\n${rollback}\n${ORIGINALS_UNCHANGED}\n${ROLLBACK_CHECKS}\nSELECT 'forward, checks, rollback, checks: all passed' AS rehearsal;\nROLLBACK;\n`, { write: true });
    console.log(JSON.stringify(rows));
  },

  apply() {
    const m = gate();
    console.log(`applying ${MIGRATION} + ${m.thumbnails.count} thumbnails to "${link.name ?? '?'}" (${REF.slice(0, 4)}…) — one transaction`);
    const rows = cli(['db', 'query', '-f', APPLY], { write: true });
    console.log(JSON.stringify(rows));
    console.log('applied. Next: node scripts/listing-thumbnails-migration.mjs verify');
  },

  verify() {
    const m = JSON.parse(fs.readFileSync(at(MANIFEST), 'utf8'));
    const [r] = query(`SELECT
      (SELECT count(*) FROM public.listings) AS listings,
      (SELECT count(*) FROM public.listings WHERE cardinality(images) > 0 AND thumbnail IS NULL) AS missing_thumbnails,
      (SELECT count(*) FROM public.listings WHERE image_count <> coalesce(cardinality(images), 0)) AS wrong_counts,
      (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_listings_sync_thumbnail') AS trigger,
      position('l.thumbnail' in pg_get_functiondef('public.get_user_orders()'::regprocedure)) > 0 AS orders_fn,
      position('l.thumbnail' in pg_get_functiondef('public.get_order_by_id(uuid)'::regprocedure)) > 0 AS order_fn,
      (SELECT json_object_agg(id, md5(images[1])) FROM public.listings WHERE id = ANY($ids$${'{' + m.thumbnails.rows.map((x) => x.id).join(',') + '}'}$ids$::uuid[])) AS originals;`);
    const changed = m.thumbnails.rows.filter((x) => r.originals?.[x.id] !== x.original_md5).map((x) => x.id);
    const ok = r.missing_thumbnails === 0 && r.wrong_counts === 0 && r.trigger === 1 && r.orders_fn && r.order_fn && changed.length === 0;
    console.log(JSON.stringify({ ...r, originals: undefined, originals_unchanged: changed.length === 0 ? m.thumbnails.rows.length : `CHANGED: ${changed.join(',')}` }));
    console.log(ok ? 'VERIFIED' : 'NOT VERIFIED');
    if (!ok) process.exit(1);
  },

  rollback() {
    committed(ROLLBACK);
    console.log(`rolling back ${ID} on "${link.name ?? '?'}" (${REF.slice(0, 4)}…). The previous deployment must already be live.`);
    console.log(JSON.stringify(cli(['db', 'query', '-f', at(ROLLBACK)], { write: true })));
  },
};

/** Everything that must still be true before apply.sql may be shown, rehearsed or run. */
function gate() {
  if (!fs.existsSync(APPLY)) die('apply.sql is missing: run prepare');
  const m = JSON.parse(fs.readFileSync(at(MANIFEST), 'utf8'));
  committed(MANIFEST);
  const mig = committed(MIGRATION);
  if (mig.blob !== m.migration.git_blob || mig.sha256 !== m.migration.sha256) die('the migration is not the one the manifest was prepared from');
  const sql = fs.readFileSync(APPLY, 'utf8');
  if (sha256(sql) !== m.apply_sql.sha256) die('apply.sql does not match the committed manifest');
  if (!sql.includes(fs.readFileSync(at(MIGRATION), 'utf8'))) die('apply.sql does not carry the committed migration verbatim');
  const ids = [...sql.matchAll(/WHERE id = '([0-9a-f-]{36})' AND thumbnail IS NULL AND md5\(images\[1\]\) = '([0-9a-f]{32})'/g)];
  if (ids.length !== m.thumbnails.count || ids.some(([, id, h], k) => m.thumbnails.rows[k].id !== id || m.thumbnails.rows[k].original_md5 !== h)) die('apply.sql updates are not the manifest rows');
  for (const [k, t] of [...sql.matchAll(/SET thumbnail = '(data:image\/jpeg;base64,[A-Za-z0-9+/=]+)'/g)].entries()) {
    if (sha256(t[1]) !== m.thumbnails.rows[k].thumb_sha256) die(`thumbnail ${k} does not match the manifest`);
  }
  return m;
}

const step = process.argv[2];
if (!steps[step]) die(`usage: node scripts/listing-thumbnails-migration.mjs ${Object.keys(steps).join('|')}`);
steps[step]();
