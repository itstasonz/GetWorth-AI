#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// BENCHMARK DATASET CAPTURE HELPER — DEVELOPMENT ONLY (GW-BENCHMARK-001 M3)
//
//   node scripts/dev/benchmark-capture.mjs [--manifest <file>] [--port 8790] [--lan]
//
// Shows the benchmark items one at a time in a browser, accepts the photograph
// (from the phone's camera when started with --lan and opened on the phone),
// stores the ORIGINAL bytes as the master plus the PWA-prepared derivative the
// page makes (1280 px / JPEG 0.82, the PWA's own rule), records integrity
// (SHA-256, format, bytes, pixels, timestamp) and the founder's confirmation of
// the ground truth with its provenance.
//
// THIS PROCESS MAKES NO OUTBOUND REQUEST OF ANY KIND. It imports no engine
// module and knows no provider. It lives under scripts/, which neither Vite nor
// Vercel ships (tests/scan-v2-capture-helper.test.mjs proves both).
// ══════════════════════════════════════════════════════════════════════════════
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROVENANCE = Object.freeze(['PHYSICAL_LABEL', 'PACKAGING', 'OWNER_KNOWLEDGE', 'PURCHASE_RECORD', 'SERIAL_MODEL_LABEL', 'MANUFACTURER_REFERENCE', 'OTHER']);
export const CONDITIONS = Object.freeze(['New', 'Like New', 'Good', 'Fair', 'Poor', 'Parts', 'Unknown']);
export const CONFIGURATIONS = Object.freeze(['COMPLETE', 'BASE_ONLY', 'ACCESSORY_ONLY', 'BOX_ONLY', 'REPLACEMENT_PART', 'BUNDLE', 'PARTS', 'UNKNOWN']);
export const TRUTH_FIELDS = Object.freeze(['brand', 'product_family', 'exact_model', 'model_number', 'variant', 'capacity_size', 'color', 'configuration']);
export const GT_CLASSES = Object.freeze(['A', 'B', 'C', 'D', 'E']);
const MAX_UPLOAD = 40 * 1024 * 1024;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ── IMAGE HEADERS: format and pixel size, from the bytes alone ──────────────
export function imageInfo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { format: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return { format: 'jpeg', width: null, height: null };
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buf.length >= 30) return { format: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8L' && buf.length >= 25) { const b = buf.readUInt32LE(21); return { format: 'webp', width: 1 + (b & 0x3FFF), height: 1 + ((b >> 14) & 0x3FFF) }; }
    if (chunk === 'VP8 ' && buf.length >= 30) return { format: 'webp', width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
    return { format: 'webp', width: null, height: null };
  }
  return null;
}

// ── THE MANIFEST STORE ──────────────────────────────────────────────────────
export function openManifest(path) {
  const abs = resolve(path);
  const dir = dirname(abs);
  const read = () => JSON.parse(readFileSync(abs, 'utf8'));
  const write = (m) => { const tmp = `${abs}.tmp`; writeFileSync(tmp, `${JSON.stringify(m, null, 1)}\n`); renameSync(tmp, abs); };
  const photoDir = join(dir, 'photos');
  mkdirSync(photoDir, { recursive: true });
  const itemOf = (m, id) => { const it = m.items.find((i) => i.benchmark_id === id); if (!it) throw Object.assign(new Error('unknown item'), { status: 404 }); return it; };
  const status = (m) => m.items.map((i) => ({
    benchmark_id: i.benchmark_id, cohort: i.cohort, category: i.category, subcategory: i.subcategory,
    primary: !!i.photo?.master?.sha256, prepared: !!i.photo?.prepared?.sha256, followup_required: !!i.photo?.followup_photo_path, followup: !!i.photo?.followup_master?.sha256,
    confirmed: !!i.ground_truth_source && !/^pending/i.test(i.ground_truth_source), valuation_class: i.valuation_ground_truth?.class ?? null,
  }));
  return {
    path: abs, dir, photoDir, read, write, itemOf, status,
    /** Store a photograph exactly as received. kind: primary | followup | prepared | followup_prepared. */
    acceptPhoto(id, kind, buf) {
      const info = imageInfo(buf);
      if (!info) throw Object.assign(new Error('not a JPEG, PNG or WEBP'), { status: 415 });
      const m = read();
      const it = itemOf(m, id);
      const ext = info.format === 'jpeg' ? 'jpg' : info.format;
      const name = kind === 'primary' ? `${id}.${ext}` : kind === 'prepared' ? `${id}.prepared.jpg`
        : kind === 'followup' ? `${id}-followup.${ext}` : `${id}-followup.prepared.jpg`;
      writeFileSync(join(photoDir, name), buf);
      const rec = { path: `photos/${name}`, sha256: sha256(buf), format: info.format, bytes: buf.length, width: info.width, height: info.height, imported_at: new Date().toISOString() };
      if (kind === 'prepared' || kind === 'followup_prepared') rec.method = 'browser canvas, longest side 1280 px, JPEG 0.82, skipped under 150 KB (the PWA rule)';
      it.photo = it.photo ?? {};
      if (kind === 'primary') { it.photo.photo_path = rec.path; it.photo.master = rec; delete it.photo.prepared; }
      else if (kind === 'prepared') it.photo.prepared = rec;
      else if (kind === 'followup') { it.photo.followup_photo_path = rec.path; it.photo.followup_master = rec; delete it.photo.followup_prepared; }
      else it.photo.followup_prepared = rec;
      write(m);
      return rec;
    },
    /** Record the founder's confirmation: values, per-field provenance, condition, optional valuation truth. */
    confirm(id, body) {
      const m = read();
      const it = itemOf(m, id);
      const prov = {};
      for (const f of TRUTH_FIELDS) {
        if (!(f in (body.identity ?? {}))) continue;
        const v = body.identity[f];
        const p = (body.provenance?.[f] ?? []).filter((x) => PROVENANCE.includes(x));
        if (f === 'configuration' && v !== null && !CONFIGURATIONS.includes(v)) throw Object.assign(new Error('configuration not in the list'), { status: 400 });
        if (v !== null && v !== '' && p.length === 0) throw Object.assign(new Error(`${f}: a confirmed value needs a provenance`), { status: 400 });
        it.identity[f] = v === '' ? null : v;
        if (p.length) prov[f] = p;
      }
      if (body.condition !== undefined) {
        if (body.condition !== null && !CONDITIONS.includes(body.condition)) throw Object.assign(new Error('condition not in the list'), { status: 400 });
        it.condition = { condition: body.condition, condition_notes: body.condition_notes ?? null };
      }
      if (body.valuation_ground_truth) {
        const v = body.valuation_ground_truth;
        if (v.class !== null && !GT_CLASSES.includes(v.class)) throw Object.assign(new Error('class not A-E'), { status: 400 });
        it.valuation_ground_truth = { ...it.valuation_ground_truth, class: v.class ?? null, status: v.class ? 'RECORDED' : 'PENDING_HUMAN_COLLECTION', reference_ils: v.reference_ils ?? null, reference_low_ils: v.reference_low_ils ?? null, reference_high_ils: v.reference_high_ils ?? null, retail_reference_ils: v.retail_reference_ils ?? null, evidence: v.evidence ?? [], methodology: v.methodology ?? null, observed_on: v.observed_on ?? null };
      }
      it.ground_truth_provenance = { ...(it.ground_truth_provenance ?? {}), ...prov };
      it.ground_truth_source = `confirmed by the founder from the physical item on ${new Date().toISOString().slice(0, 10)} (capture helper); provenance per field under ground_truth_provenance`;
      if (body.notes !== undefined) it.notes = body.notes || null;
      write(m);
      return it;
    },
  };
}

// ── THE SERVER ──────────────────────────────────────────────────────────────
const readBody = (req, max) => new Promise((res, rej) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > max) { rej(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; } chunks.push(c); });
  req.on('end', () => res(Buffer.concat(chunks))); req.on('error', rej);
});
export function createCaptureServer(store) {
  const page = readFileSync(join(HERE, 'benchmark-capture.html'));
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, page, 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/helper/manifest') {
        const m = store.read();
        return send(200, JSON.stringify({ name: m.name, excluded_from_benchmark: m.excluded_from_benchmark === true, status: store.status(m), items: m.items, enums: { PROVENANCE, CONDITIONS, CONFIGURATIONS, GT_CLASSES, TRUTH_FIELDS } }));
      }
      if (req.method === 'GET' && url.pathname === '/helper/photo-file') {
        const it = store.itemOf(store.read(), url.searchParams.get('id'));
        const rec = url.searchParams.get('kind') === 'followup' ? it.photo?.followup_master : it.photo?.master;
        if (!rec) return send(404, '{"error":"no photograph"}');
        return send(200, readFileSync(join(store.dir, rec.path)), `image/${rec.format}`);
      }
      if (req.method === 'POST' && url.pathname === '/helper/photo') {
        const kind = url.searchParams.get('kind') ?? 'primary';
        if (!['primary', 'prepared', 'followup', 'followup_prepared'].includes(kind)) return send(400, '{"error":"kind"}');
        const rec = store.acceptPhoto(url.searchParams.get('id'), kind, await readBody(req, MAX_UPLOAD));
        return send(200, JSON.stringify(rec));
      }
      if (req.method === 'POST' && url.pathname === '/helper/truth') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
        return send(200, JSON.stringify(store.confirm(url.searchParams.get('id'), body)));
      }
      return send(404, '{"error":"not found"}');
    } catch (err) {
      return send(err.status ?? 500, JSON.stringify({ error: String(err.message ?? err).slice(0, 200) }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const manifest = flag('--manifest') ?? resolve(HERE, '../../tests/fixtures/scan-v2/benchmark-44.json');
  if (!existsSync(manifest)) { process.stderr.write(`no manifest at ${manifest}\n`); process.exit(1); }
  const port = Number(flag('--port') ?? 8790);
  const host = argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
  createCaptureServer(openManifest(manifest)).listen(port, host, () => {
    // Physical adapters first: a virtual switch (Hyper-V, VirtualBox, VMware, WSL) is not what the phone can reach.
    const virtual = (name) => /^(vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vboxnet|vmnet)/i.test(name);
    const lan = Object.entries(networkInterfaces()).sort(([x], [y]) => Number(virtual(x)) - Number(virtual(y))).flatMap(([, l]) => l).filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${port}/`);
    const urls = host === '0.0.0.0' ? [`http://127.0.0.1:${port}/`, ...lan] : [`http://127.0.0.1:${port}/`];
    process.stdout.write(`capture helper for ${basename(manifest)} (development only; no outbound request is ever made)\n${urls.map((u) => `  ${u}`).join('\n')}\n${host === '0.0.0.0' ? '  open a LAN address on the phone (same Wi-Fi); the first LAN address is the physical adapter; virtual switches are listed last\n' : '  add --lan to open it from the phone\n'}`);
  });
}
