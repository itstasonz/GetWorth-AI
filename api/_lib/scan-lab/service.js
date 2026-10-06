// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — WHAT THE LAB DOES (over a store, with no HTTP in it)
//
//   state      the set, the slots, what is stored, capture readiness
//   begin      declare a photograph (hash, size, format) and get upload tokens
//   commit     the server reads back what was uploaded and hashes it ITSELF;
//              only bytes that match the declaration become the record
//   truth      the person's confirmation, with a provenance per value
//   photo_url  a 60-second link to a stored photograph
//   remove     delete a photograph, a confirmation, an item or the whole set
//
// THE ORIGINAL AND THE DERIVATIVE ARE TWO OBJECTS. The original is the file the
// phone produced, byte for byte. The prepared derivative is what the PWA's own
// image preparation makes of it. They are stored at different paths, hashed
// separately, and a derivative with the master's hash is refused.
//
// A CAPTURE IS IMMUTABLE. Every `begin` gets a fresh capture id and therefore
// fresh object paths; nothing is ever overwritten. A record is written only
// while the row still expects THAT capture, so a commit racing a newer begin
// records nothing.
//
// A CONFIRMATION BELONGS TO A PHOTOGRAPH. It is stored with the capture it was
// made for, and an item whose photograph changed afterwards is not ready until
// a person confirms it again.
//
// DELETING MEANS THE BYTES ARE GONE. A deletion that could not remove the
// objects fails and keeps the record that names them.
//
// THERE IS NO ACTION HERE THAT RUNS THE ENGINE. Capture makes no recognition,
// search or pricing call, and this module imports nothing that could.
// ══════════════════════════════════════════════════════════════════════════════
import { getLabSet, getLabSlot } from './sets.js';
import {
  LabError, validateTruth, imageInfo, sha256Hex, PROVENANCE, CONDITIONS, CONFIGURATIONS, TRUTH_FIELDS,
} from './truth.js';
import {
  LAB_BUCKET, LAB_MAX_ORIGINAL_BYTES, LAB_MAX_PREPARED_BYTES, LAB_MIN_IMAGE_BYTES, LAB_SIGNED_URL_SECONDS,
} from './config.js';

const FORMATS = Object.freeze({ jpeg: 'jpg', png: 'png', webp: 'webp' });
const SHA_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PREPARED_METHOD = 'the PWA image preparation: longest side 1280 px, JPEG 0.82, skipped under 150 KB';
/** What a future benchmark run will fill in. Nothing in this version writes it. */
export const RUN_FIELDS = Object.freeze(['recognition_result', 'model_accuracy', 'followup_requirement', 'identity_latency', 'market_search_results', 'qualified_evidence', 'pricing_tier', 'total_latency', 'replay_status']);

const bad = (detail) => new LabError(400, 'bad_request', detail);

function declared(value, { name, maxBytes, jpegOnly }) {
  if (!value || typeof value !== 'object') throw bad(`${name} is required`);
  const sha256 = String(value.sha256 ?? '').toLowerCase();
  if (!SHA_RE.test(sha256)) throw bad(`${name}.sha256 must be a SHA-256`);
  if (!Number.isInteger(value.bytes) || value.bytes < LAB_MIN_IMAGE_BYTES) throw bad(`${name} is too small to be a photograph`);
  if (value.bytes > maxBytes) throw new LabError(413, 'payload_too_large', `${name} is over ${Math.round(maxBytes / 1048576)} MB`);
  if (typeof value.format !== 'string' || !Object.hasOwn(FORMATS, value.format)) throw new LabError(415, 'unsupported_format', `${name} must be a JPEG, PNG or WEBP`);
  if (jpegOnly && value.format !== 'jpeg') throw new LabError(415, 'unsupported_format', `${name} must be a JPEG`);
  return { sha256, bytes: value.bytes, format: value.format };
}

/** What stands between this item and being usable by the benchmark. */
export function captureReadiness(row) {
  const problems = [];
  const photo = row?.photo?.master?.sha256 ? row.photo : null;
  if (!photo) problems.push(row?.pending ? 'upload not finished' : 'photograph missing');
  if (!row?.truth || !row?.confirmed_at) problems.push('ground truth not confirmed by a person');
  else if (photo && row.truth.for_capture_id !== photo.capture_id) problems.push('ground truth was confirmed for a different photograph: confirm it again');
  return { ready: problems.length === 0, problems };
}

const publicRecord = (r) => (r ? { sha256: r.sha256, format: r.format, bytes: r.bytes, width: r.width, height: r.height, stored_at: r.stored_at } : null);

function publicItem(slot, row) {
  return {
    item_id: slot.id,
    photo: row?.photo ? { capture_id: row.photo.capture_id, master: publicRecord(row.photo.master), prepared: publicRecord(row.photo.prepared) } : null,
    upload_pending: !!row?.pending,
    truth: row?.truth ?? null,
    confirmed_at: row?.confirmed_at ?? null,
    readiness: captureReadiness(row),
    // The benchmark has not run. It is filled by a run that someone authorized, never by capture.
    run: null,
  };
}

export function createLabService({ store, now = () => new Date(), newId = () => crypto.randomUUID() }) {
  const requireSet = (name) => {
    const set = getLabSet(name);
    if (!set) throw bad('unknown set');
    return set;
  };
  const requireSlot = (set, itemId) => {
    const slot = getLabSlot(set, itemId);
    if (!slot) throw bad('unknown item');
    return slot;
  };
  const objectsOf = (capture) => [capture?.original?.path ?? capture?.master?.path, capture?.prepared?.path].filter(Boolean);
  /** Housekeeping: remove objects under this owner's prefix. A failure here is not the request's failure. */
  const drop = async (ownerId, paths) => {
    const own = paths.filter((p) => typeof p === 'string' && p.startsWith(`${ownerId}/`));
    if (!own.length) return;
    try { await store.removeObjects(own); } catch (err) { console.warn(`[ScanLab] cleanup deferred: ${String(err?.code ?? err?.message).slice(0, 80)}`); }
  };
  /** Deletion: everything stored under a prefix of this owner goes, or the request fails. */
  const purge = async (ownerId, prefix) => {
    if (!prefix.startsWith(`${ownerId}/`)) throw new LabError(500, 'internal_error');
    const paths = (await store.listPaths(prefix)).filter((p) => p.startsWith(`${prefix}/`));
    if (paths.length) await store.removeObjects(paths);
  };

  async function state({ ownerId, set: setName }) {
    const set = requireSet(setName);
    const rows = new Map((await store.listItems(ownerId, set.name)).map((r) => [r.item_id, r]));
    const items = set.slots.map((slot) => publicItem(slot, rows.get(slot.id)));
    const ready = items.filter((i) => i.readiness.ready).length;
    return {
      set: { name: set.name, title: set.title, excluded_from_benchmark: set.excluded_from_benchmark, natural_photo_rule: set.natural_photo_rule, slots: set.slots },
      enums: { PROVENANCE, CONDITIONS, CONFIGURATIONS, TRUTH_FIELDS },
      limits: { max_original_bytes: LAB_MAX_ORIGINAL_BYTES, formats: Object.keys(FORMATS) },
      items,
      readiness: { ready: ready === items.length, ready_items: ready, items_total: items.length },
      execution: { available: false, run_fields: RUN_FIELDS, paid_calls_made_by_capture: 0, requires: 'explicit authorization, the approved cost ceiling and a matching freeze' },
    };
  }

  async function begin({ ownerId, set: setName, item_id: itemId, original, prepared }) {
    const set = requireSet(setName);
    const slot = requireSlot(set, itemId);
    const master = declared(original, { name: 'original', maxBytes: LAB_MAX_ORIGINAL_BYTES });
    const derived = prepared === null || prepared === undefined ? null
      : declared(prepared, { name: 'prepared', maxBytes: LAB_MAX_PREPARED_BYTES, jpegOnly: true });
    if (derived && derived.sha256 === master.sha256) throw bad('the prepared derivative must not be the original');

    const existing = await store.getItem(ownerId, set.name, slot.id);
    if (existing?.pending) await drop(ownerId, objectsOf(existing.pending));

    const captureId = newId();
    const base = `${ownerId}/${set.name}/${slot.id}/${captureId}`;
    const up = { original: await store.signUpload(`${base}/original.${FORMATS[master.format]}`), prepared: derived ? await store.signUpload(`${base}/prepared.jpg`) : null };
    await store.putItem(ownerId, set.name, slot.id, {
      pending: {
        capture_id: captureId, started_at: now().toISOString(),
        original: { path: up.original.path, ...master },
        prepared: derived ? { path: up.prepared.path, ...derived } : null,
      },
    });
    return { capture_id: captureId, bucket: LAB_BUCKET, uploads: up };
  }

  /** Read one uploaded object back and hold it against what was declared. */
  async function verified(path, decl, name) {
    const bytes = await store.download(path);
    if (!bytes) return { missing: name };
    if (bytes.length !== decl.bytes) return { mismatch: name };
    let info = null;
    try { info = imageInfo(bytes); } catch { info = null; }
    const sha256 = await sha256Hex(bytes);
    if (!info || info.format !== decl.format || sha256 !== decl.sha256) return { mismatch: name };
    return { record: { path, sha256, format: info.format, bytes: bytes.length, width: info.width, height: info.height } };
  }

  async function commit({ ownerId, set: setName, item_id: itemId, capture_id: captureId }) {
    const set = requireSet(setName);
    const slot = requireSlot(set, itemId);
    if (!UUID_RE.test(String(captureId ?? ''))) throw bad('capture_id must be a UUID');
    const row = await store.getItem(ownerId, set.name, slot.id);
    const pending = row?.pending;
    if (!pending || pending.capture_id !== captureId) throw new LabError(409, 'no_pending_capture');

    const master = await verified(pending.original.path, pending.original, 'original');
    const derived = pending.prepared ? await verified(pending.prepared.path, pending.prepared, 'prepared') : { record: null };
    const missing = master.missing ?? derived.missing;
    // Not there yet: the upload was interrupted. The capture stays pending so the phone can finish it.
    if (missing) throw new LabError(409, 'upload_missing', missing);
    const mismatch = master.mismatch ?? derived.mismatch;
    if (mismatch) {
      // What is in storage is not what the phone declared. It never becomes a record.
      await drop(ownerId, objectsOf(pending));
      await store.putItemIfPending(ownerId, set.name, slot.id, captureId, { pending: null });
      throw new LabError(409, 'integrity_mismatch', mismatch);
    }

    const storedAt = now().toISOString();
    const photo = {
      capture_id: captureId,
      master: { ...master.record, stored_at: storedAt },
      prepared: derived.record ? { ...derived.record, stored_at: storedAt, method: PREPARED_METHOD } : null,
    };
    // Written only if the row STILL expects this capture. While this request was reading the bytes back,
    // a newer begin may have replaced it (and removed these objects): then nothing is recorded.
    const saved = await store.putItemIfPending(ownerId, set.name, slot.id, captureId, { photo, pending: null });
    if (!saved) throw new LabError(409, 'no_pending_capture');
    if (row.photo && row.photo.capture_id !== captureId) await drop(ownerId, objectsOf(row.photo));
    return { item: publicItem(slot, saved) };
  }

  async function truth({ ownerId, set: setName, item_id: itemId, ...body }) {
    const set = requireSet(setName);
    const slot = requireSlot(set, itemId);
    const confirmed = validateTruth(body);
    const row = await store.getItem(ownerId, set.name, slot.id);
    // The confirmation is of the item in the stored photograph; before any is stored, of the one
    // being uploaded. A photograph that replaces it later needs the person's confirmation again.
    const saved = await store.putItem(ownerId, set.name, slot.id, {
      truth: { ...confirmed, for_capture_id: row?.photo?.capture_id ?? row?.pending?.capture_id ?? null },
      confirmed_at: now().toISOString(),
    });
    return { item: publicItem(slot, saved) };
  }

  async function photoUrl({ ownerId, set: setName, item_id: itemId, kind = 'original' }) {
    const set = requireSet(setName);
    const slot = requireSlot(set, itemId);
    if (kind !== 'original' && kind !== 'prepared') throw bad('kind must be original or prepared');
    const row = await store.getItem(ownerId, set.name, slot.id);
    const record = kind === 'original' ? row?.photo?.master : row?.photo?.prepared;
    if (!record?.path || !record.path.startsWith(`${ownerId}/`)) throw new LabError(404, 'no_photograph');
    return { url: await store.signDownload(record.path, LAB_SIGNED_URL_SECONDS), expires_in_s: LAB_SIGNED_URL_SECONDS, kind };
  }

  async function removeOne(ownerId, set, slot, what) {
    if (what === 'truth') {
      const row = await store.getItem(ownerId, set.name, slot.id);
      return publicItem(slot, row ? await store.putItem(ownerId, set.name, slot.id, { truth: null, confirmed_at: null }) : null);
    }
    // The bytes first, and everything under the item — also what an abandoned upload left behind.
    // If storage refuses, this throws and the record that names the photograph is kept.
    await purge(ownerId, `${ownerId}/${set.name}/${slot.id}`);
    const row = await store.getItem(ownerId, set.name, slot.id);
    if (what === 'photo') return publicItem(slot, row ? await store.putItem(ownerId, set.name, slot.id, { photo: null, pending: null }) : null);
    if (row) await store.deleteItem(ownerId, set.name, slot.id);
    return publicItem(slot, null);
  }

  async function remove({ ownerId, set: setName, item_id: itemId, what }) {
    const set = requireSet(setName);
    const slot = requireSlot(set, itemId);
    if (!['photo', 'truth', 'item'].includes(what)) throw bad('what must be photo, truth or item');
    return { item: await removeOne(ownerId, set, slot, what) };
  }

  /** Everything this account stored for a set. The set's name must be repeated to mean it. */
  async function removeSet({ ownerId, set: setName, confirm }) {
    const set = requireSet(setName);
    if (confirm !== set.name) throw bad('confirm must repeat the set name');
    await purge(ownerId, `${ownerId}/${set.name}`);
    for (const row of await store.listItems(ownerId, set.name)) await store.deleteItem(ownerId, set.name, row.item_id);
    return { removed: set.slots.length };
  }

  return { state, begin, commit, truth, photo_url: photoUrl, remove, remove_set: removeSet };
}
