// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — PRIVATE BENCHMARK CAPTURE (one allowlisted account)
//
// Photograph an item, confirm what it physically is, save. Per slot:
//
//   the original        the file the phone produced, stored byte for byte
//   the prepared copy   what the scan's own image preparation makes of it
//   the ground truth    what a person confirmed, and how they know
//
// THIS SCREEN RUNS NOTHING. It makes no recognition, search or pricing call and
// has no control that could; the "Benchmark result" block shows what a future,
// separately authorized run will fill in.
//
// Every slot, choice and stored fact on this screen comes from /api/scan-lab
// after the server has authorized the account. English and left-to-right on
// purpose: it is a lab instrument for one person, like the V2 diagnostics panel.
// ══════════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Check, CloudOff, Lock, Trash2 } from 'lucide-react';
import { useApp, compressImage, assessImageDataUrl } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';
import { Btn, Badge, Chip, Section, LoadingState, ErrorState, ConfirmSheet } from '../components/ui';
import ScanLabTruthForm from '../components/ScanLabTruthForm';
import {
  LAB_SET, LAB_STAGE, LAB_FAILURE, labRequest, checkFile, prepareCapture, queueCapture, runCapture, resumeCaptures,
  pendingCaptures, discardCapture, captureKey, draftKey,
} from '../lib/scanLab';
import { openLabDb } from '../lib/scanLabDb';

const BUILD = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'local';
const kb = (n) => (typeof n === 'number' ? (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : '—');
const words = (s) => String(s).replace(/_/g, ' ');
const stateKey = (userId) => `state|${userId}|${LAB_SET}`;

const readDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error ?? new Error('could not read the photograph'));
  r.readAsDataURL(blob);
});

/** Straight to private storage, with the one-object token the server signed. */
async function upload({ bucket, path, token, bytes, contentType }) {
  try {
    const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, new Blob([bytes], { type: contentType }), { contentType });
    return error ? { ok: false, error: error.message, status: Number(error.statusCode ?? error.status) || null } : { ok: true };
  } catch (err) { return { ok: false, error: err?.message }; }
}

const QUEUE_COPY = {
  [LAB_FAILURE.OFFLINE]: 'Saved on this phone. It will upload when the connection returns.',
  [LAB_FAILURE.UPLOAD_FAILED]: 'The upload was interrupted. It is saved on this phone and will be retried.',
  [LAB_FAILURE.NO_SESSION]: 'Sign in again to finish the upload. The photograph is saved on this phone.',
  [LAB_FAILURE.INTEGRITY_MISMATCH]: 'What reached storage did not match the photograph. Nothing was recorded.',
  [LAB_FAILURE.SERVER_REFUSED]: 'The server refused this photograph.',
};

function Fact({ label, value }) {
  return (
    <p className="text-meta text-text-secondary break-words">
      <span className="text-text-muted">{label}: </span>{value === null || value === undefined || value === '' ? '—' : String(value)}
    </p>
  );
}

function PhotoRecord({ title, record, absent }) {
  if (!record) return <Fact label={title} value={absent} />;
  return <Fact label={title} value={`${record.format} · ${record.width ?? '?'}×${record.height ?? '?'} · ${kb(record.bytes)} · sha256 ${record.sha256.slice(0, 12)}…`} />;
}

export default function ScanLabView() {
  const { user, getFreshToken, showToastMsg } = useApp();
  const userId = user?.id ?? null;
  const [phase, setPhase] = useState('loading');           // loading | ready | unavailable | denied | error
  const [data, setData] = useState(null);
  const [offline, setOffline] = useState(false);
  const [failure, setFailure] = useState(null);
  const [index, setIndex] = useState(0);
  const [queue, setQueue] = useState({});                  // item id -> { stage, error }
  const [previews, setPreviews] = useState({});            // item id -> object URL of the photograph just taken
  const [stored, setStored] = useState({});                // item id -> { url, kind } signed for 60 s
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);                  // item id being hashed and prepared
  const [refusal, setRefusal] = useState(null);            // { itemId, code, detail }: a file that cannot be stored, and why
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);            // { what, itemId }
  const dbRef = useRef(null);
  const previewsRef = useRef({});
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);

  const request = useCallback((action, body = {}) => labRequest(action, { set: LAB_SET, ...body }, { getToken: getFreshToken }), [getFreshToken]);
  const mergeItem = useCallback((item) => {
    if (!item) return;
    setData((d) => {
      if (!d?.items) return d;
      const items = d.items.map((i) => (i.item_id === item.item_id ? item : i));
      const ready = items.filter((i) => i.readiness.ready).length;
      return { ...d, items, readiness: { ready: ready === items.length, ready_items: ready, items_total: items.length } };
    });
  }, []);
  const syncQueue = useCallback(async () => {
    if (!dbRef.current || !userId) return;
    const records = await pendingCaptures({ db: dbRef.current, userId, set: LAB_SET });
    setQueue(Object.fromEntries(records.map((r) => [r.itemId, { stage: r.stage, error: r.error }])));
  }, [userId]);

  const refresh = useCallback(async () => {
    try {
      const r = await request('state');
      if (r.status === 200 && r.payload?.status === 'OK') {
        setData(r.payload); setOffline(false); setPhase('ready');
        await dbRef.current?.put(stateKey(userId), r.payload);
      } else if (r.status === 200 && r.payload?.status === 'UNAVAILABLE') { setData(r.payload); setPhase('unavailable'); }
      else if (r.status === 403) { await dbRef.current?.delete(stateKey(userId)); setPhase('denied'); }
      else if (r.status === 401) {
        // No usable session (it can also mean "could not be refreshed while offline"): not a refusal.
        const cached = await dbRef.current?.get(stateKey(userId)).catch(() => null);
        setOffline(true);
        if (cached) { setData((d) => (d?.set ? d : cached)); setPhase('ready'); } else setPhase((p) => (p === 'ready' ? p : 'denied'));
      }
      else {
        // A server fault. A screen already in use stays in use: what is typed and queued is not thrown away for it.
        setFailure([r.payload?.error, r.payload?.detail].filter(Boolean).join(' · ') || `HTTP ${r.status}`);
        setOffline(true);
        setPhase((p) => (p === 'ready' ? p : 'error'));
      }
    } catch {
      // No connection. The last state this phone saw keeps the screen usable: a photograph can still be queued.
      const cached = await dbRef.current?.get(stateKey(userId)).catch(() => null);
      setOffline(true);
      if (cached) { setData((d) => (d?.set ? d : cached)); setPhase('ready'); } else { setFailure('No connection to the server.'); setPhase((p) => (p === 'ready' ? p : 'error')); }
    }
  }, [request, userId]);

  const resume = useCallback(async () => {
    if (!dbRef.current || !userId) return;
    const results = await resumeCaptures({ db: dbRef.current, userId, set: LAB_SET, request, upload, onStage: () => { syncQueue(); } });
    for (const r of results) if (r.ok) mergeItem(r.item);
    await syncQueue();
  }, [userId, request, mergeItem, syncQueue]);

  useEffect(() => {
    if (!userId) { setPhase('denied'); return undefined; }
    let alive = true;
    (async () => {
      dbRef.current = await openLabDb();
      const found = await dbRef.current.entries(`draft|${userId}|${LAB_SET}|`);
      if (!alive) return;
      setDrafts(Object.fromEntries(found.map((e) => [String(e.key).split('|')[3], e.value])));
      await refresh();
      await resume();
    })();
    const again = () => { if (document.visibilityState === 'visible') resume().catch(() => {}).then(refresh); };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      alive = false;
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
      for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const slot = data?.set?.slots?.[index] ?? null;
  const item = slot ? data.items.find((i) => i.item_id === slot.id) : null;

  const onFile = async (file) => {
    if (!file || !slot || !dbRef.current) return;
    const itemId = slot.id;
    setRefusal(null);
    setBusy(itemId);
    try {
      // Sixteen bytes first: a format that cannot be stored is named at once, before anything is read, hashed or sent.
      await checkFile(file);
      const bytes = await file.arrayBuffer();
      const capture = await prepareCapture({ bytes, readDataUrl, maxBytes: data.limits?.max_original_bytes, assess: assessImageDataUrl, compress: (d) => compressImage(d, 1280, 0.82) });
      const record = await queueCapture({ db: dbRef.current, userId, set: LAB_SET, itemId, capture });
      if (previewsRef.current[itemId]) URL.revokeObjectURL(previewsRef.current[itemId]);
      previewsRef.current[itemId] = URL.createObjectURL(new Blob([bytes], { type: `image/${capture.original.format}` }));
      setPreviews({ ...previewsRef.current });
      setStored((s) => ({ ...s, [itemId]: undefined }));
      await syncQueue();
      setBusy(null);
      const result = await runCapture({ record, db: dbRef.current, request, upload, onStage: () => { syncQueue(); } });
      if (result.ok) mergeItem(result.item);
      await syncQueue();
    } catch (err) {
      if (err?.code === LAB_FAILURE.HEIC_NOT_SUPPORTED || err?.code === LAB_FAILURE.NOT_AN_IMAGE) { setRefusal({ itemId, code: err.code, detail: err.detail }); return; }
      showToastMsg(err?.code === LAB_FAILURE.PHOTO_TOO_LARGE ? 'This photograph is too large to store.'
          : err?.code === LAB_FAILURE.QUEUE_FAILED ? 'This phone could not save the photograph, so nothing was sent. Free some space and try again.'
            : 'The photograph could not be prepared. Please try again.', 'error');
    } finally { setBusy(null); }
  };

  const retry = async () => {
    const record = await dbRef.current?.get(captureKey(userId, LAB_SET, slot.id));
    if (!record) { await syncQueue(); return; }
    const result = await runCapture({ record, db: dbRef.current, request, upload, onStage: () => { syncQueue(); } });
    if (result.ok) mergeItem(result.item);
    await syncQueue();
  };
  const discardLocal = async (itemId) => {
    if (dbRef.current) await discardCapture({ db: dbRef.current, userId, set: LAB_SET, itemId });
    if (previewsRef.current[itemId]) { URL.revokeObjectURL(previewsRef.current[itemId]); delete previewsRef.current[itemId]; setPreviews({ ...previewsRef.current }); }
    await syncQueue();
  };

  const showStored = async (kind) => {
    try {
      const r = await request('photo_url', { item_id: slot.id, kind });
      if (r.status === 200 && r.payload?.url) setStored((s) => ({ ...s, [slot.id]: { url: r.payload.url, kind } }));
      else showToastMsg('The stored photograph could not be opened.', 'error');
    } catch { showToastMsg('No connection to the server.', 'error'); }
  };

  const onDraft = (form) => { setDrafts((d) => ({ ...d, [slot.id]: form })); dbRef.current?.put(draftKey(userId, LAB_SET, slot.id), form); };
  const saveTruth = async (body) => {
    setSaving(true);
    try {
      const r = await request('truth', { item_id: slot.id, ...body });
      if (r.status !== 200 || r.payload?.status !== 'OK') { showToastMsg(`Not saved: ${r.payload?.detail ?? r.payload?.error ?? `HTTP ${r.status}`}`, 'error'); return; }
      mergeItem(r.payload.item);
      await dbRef.current?.delete(draftKey(userId, LAB_SET, slot.id));
      setDrafts((d) => ({ ...d, [slot.id]: undefined }));
      showToastMsg('Saved.');
      // On to the next slot that still needs something, looking forward first.
      const n = data.set.slots.length;
      const next = Array.from({ length: n - 1 }, (_, k) => (index + 1 + k) % n)
        .find((k) => !data.items.find((i) => i.item_id === data.set.slots[k].id)?.readiness.ready);
      if (next !== undefined) { setIndex(next); window.scrollTo(0, 0); }
    } catch { showToastMsg('Not saved: no connection. Your entries are kept on this phone.', 'warning'); } finally { setSaving(false); }
  };

  const runDelete = async () => {
    const { what, itemId } = confirm;
    setConfirm(null);
    try {
      const r = what === 'set' ? await request('remove_set', { confirm: LAB_SET }) : await request('remove', { item_id: itemId, what });
      if (r.status !== 200) { showToastMsg(`Not deleted: ${r.payload?.error ?? `HTTP ${r.status}`}`, 'error'); return; }
      for (const id of what === 'set' ? data.set.slots.map((s) => s.id) : [itemId]) {
        await discardLocal(id);
        if (what !== 'photo') { await dbRef.current?.delete(draftKey(userId, LAB_SET, id)); setDrafts((d) => ({ ...d, [id]: undefined })); }
        setStored((s) => ({ ...s, [id]: undefined }));
      }
      showToastMsg('Deleted.');
      await refresh();
    } catch { showToastMsg('Not deleted: no connection.', 'error'); }
  };

  if (phase === 'loading') return <LoadingState label="Opening Scan Lab…" />;
  if (phase === 'denied') return <ErrorState title="Not available" subtitle="This area is not available for this account." />;
  if (phase === 'error') return <ErrorState title="Scan Lab could not load" subtitle={failure} onRetry={() => { setPhase('loading'); refresh(); }} />;
  if (phase === 'unavailable') {
    return (
      <div className="space-y-group pt-2" dir="ltr">
        <ErrorState title="Storage is not ready" subtitle="This account is enrolled, but the server has no private storage configured for Scan Lab yet." onRetry={() => { setPhase('loading'); refresh(); }} />
        <Diagnostics data={data} userId={userId} db={dbRef.current} queue={queue} />
      </div>
    );
  }

  const q = queue[slot.id];
  const uploading = q && !q.error && q.stage !== LAB_STAGE.FAILED;
  const preview = previews[slot.id] ?? stored[slot.id]?.url ?? null;
  const master = item.photo?.master ?? null;

  return (
    <div className="space-y-group pt-2 pb-8" dir="ltr">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-title-lg text-text-primary">Scan Lab</h2>
          <Badge tone="neutral" icon={Lock}>Private</Badge>
        </div>
        <p className="text-body-sm text-text-muted">{data.set.title}{data.set.excluded_from_benchmark ? ' · excluded from the benchmark' : ''}</p>
        <div className="flex gap-1" aria-hidden="true">
          {data.items.map((i) => <div key={i.item_id} className={`h-1.5 flex-1 rounded-full ${i.readiness.ready ? 'bg-success' : 'bg-surface-high'}`} />)}
        </div>
        <p className="text-label text-text-secondary" role="status">
          {data.readiness.ready ? 'Capture complete. Ready for benchmark.' : `${data.readiness.ready_items} of ${data.readiness.items_total} ready`}
        </p>
        {offline && <p className="text-body-sm text-warning flex items-center gap-2"><CloudOff className="w-4 h-4" aria-hidden="true" />Not connected to the server. Showing what this phone last saw; photographs are queued here.</p>}
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Items">
        {data.set.slots.map((s, k) => {
          const ready = data.items.find((i) => i.item_id === s.id)?.readiness.ready;
          return <Chip key={s.id} selected={k === index} onClick={() => setIndex(k)}>{ready && <Check className="w-4 h-4" aria-hidden="true" />}{k + 1}</Chip>;
        })}
      </div>

      <Section title={`${index + 1}. ${slot.title}`} subtitle={slot.hint}>
        <p className="text-meta text-text-muted">{data.set.natural_photo_rule}</p>
        {preview && (
          <div className="rounded-container overflow-hidden bg-surface border border-subtle">
            <img src={preview} alt="" className="w-full max-h-80 object-contain" />
          </div>
        )}
        {preview && <p className="text-meta text-text-muted">{previews[slot.id] ? 'The original, as taken on this phone.' : `The stored ${stored[slot.id]?.kind === 'prepared' ? 'prepared copy' : 'original'}, opened for 60 seconds.`}</p>}
        <div className="rounded-container border border-subtle bg-surface p-3 space-y-1">
          <PhotoRecord title="Original" record={master} absent="not stored yet" />
          {master && <Fact label="Metadata" value="the original keeps what the phone wrote into it (EXIF; location only if the phone included it). It stays private." />}
          <PhotoRecord title="Prepared copy" record={item.photo?.prepared} absent={master ? 'none: the original is under 150 KB and is sent as it is' : 'not stored yet'} />
          {master && <Fact label="Stored" value={`${master.stored_at.slice(0, 16).replace('T', ' ')} UTC · hash verified by the server`} />}
        </div>
        {refusal?.itemId === slot.id && (
          <div className="rounded-container border border-subtle bg-surface p-3 space-y-2" role="alert">
            {refusal.code === LAB_FAILURE.HEIC_NOT_SUPPORTED ? (
              <>
                <p className="text-body-sm text-warning">This photograph is HEIC. Nothing was stored or sent.</p>
                <p className="text-body-sm text-text-secondary">Scan Lab keeps the original exactly as it receives it, and the benchmark reads JPEG, PNG or WEBP. Converting it here would replace your original with a different file, so it is not done for you.</p>
                <p className="text-body-sm text-text-secondary">Do one of these instead:</p>
                <ul className="text-body-sm text-text-secondary list-disc ps-5 space-y-1">
                  <li>Tap <strong>Take photo</strong>. The iPhone camera hands the app a JPEG.</li>
                  <li>Tap <strong>Choose photo</strong>, pick it from <strong>Photos</strong> (not Files), and under <strong>Options</strong> set Format to <strong>Most Compatible</strong> or Automatic.</li>
                </ul>
              </>
            ) : (
              <>
                <p className="text-body-sm text-warning">This file cannot be stored. Nothing was stored or sent.</p>
                <p className="text-body-sm text-text-secondary">It is {refusal.detail === 'unknown' ? 'not a photograph Scan Lab recognises' : `a ${String(refusal.detail).toUpperCase()} file`}. Scan Lab stores JPEG, PNG or WEBP photographs. Use Take photo, or choose a JPEG.</p>
              </>
            )}
            <p className="text-meta text-text-muted font-mono">{refusal.code}{refusal.detail ? ` · ${refusal.detail}` : ''}</p>
          </div>
        )}
        {busy === slot.id && <p className="text-body-sm text-text-secondary" role="status">Hashing and preparing the photograph…</p>}
        {uploading && <p className="text-body-sm text-text-secondary" role="status">Uploading to private storage…</p>}
        {q?.error && (
          <div className="space-y-2" role="alert">
            <p className="text-body-sm text-warning">{QUEUE_COPY[q.error.code] ?? 'The upload did not finish.'}</p>
            <p className="text-meta text-text-muted font-mono">{q.error.code}{q.error.detail ? ` · ${q.error.detail}` : ''}</p>
            <div className="flex gap-2">
              <Btn size="sm" onClick={retry}>Try again</Btn>
              <Btn size="sm" variant="ghost" onClick={() => discardLocal(slot.id)}>Discard</Btn>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Btn primary fullWidth disabled={busy !== null || uploading} onClick={() => cameraRef.current?.click()}><Camera className="w-4 h-4" aria-hidden="true" />{master ? 'Retake' : 'Take photo'}</Btn>
          <Btn fullWidth disabled={busy !== null || uploading} onClick={() => libraryRef.current?.click()}><ImageIcon className="w-4 h-4" aria-hidden="true" />Choose photo</Btn>
        </div>
        {master && !previews[slot.id] && (
          <div className="flex gap-2">
            <Btn size="sm" variant="ghost" onClick={() => showStored('original')}>View stored original</Btn>
            {item.photo.prepared && <Btn size="sm" variant="ghost" onClick={() => showStored('prepared')}>View prepared copy</Btn>}
          </div>
        )}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
        <input ref={libraryRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
      </Section>

      <ScanLabTruthForm
        key={slot.id} item={item} enums={data.enums} draft={drafts[slot.id]} onDraft={onDraft} onSave={saveTruth} saving={saving}
        saveLabel={index < data.set.slots.length - 1 ? 'Save and continue' : 'Save'}
      />
      {item.confirmed_at && <p className="text-meta text-text-muted">Confirmed {item.confirmed_at.slice(0, 16).replace('T', ' ')} UTC.{item.readiness.ready ? '' : ` Still needed: ${item.readiness.problems.join('; ')}.`}</p>}

      <Section title="Benchmark result" level={3} subtitle="Not run. A run is never started from capture: it needs your explicit authorization, the approved cost ceiling and a matching freeze.">
        <div className="rounded-container border border-subtle bg-surface p-3 space-y-1">
          {(data.execution?.run_fields ?? []).map((f) => <Fact key={f} label={words(f)} value={item.run?.[f] ?? 'not run'} />)}
        </div>
      </Section>

      <Section title="Stored data" level={3} subtitle="Kept in private storage until you delete it. Nothing here expires on its own, is published, or becomes a listing.">
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" disabled={!item.photo && !item.upload_pending} onClick={() => setConfirm({ what: 'photo', itemId: slot.id })}><Trash2 className="w-4 h-4" aria-hidden="true" />Delete photo</Btn>
          <Btn size="sm" disabled={!item.photo && !item.truth && !item.upload_pending} onClick={() => setConfirm({ what: 'item', itemId: slot.id })}>Delete this item</Btn>
          <Btn size="sm" variant="ghost" className="text-danger" onClick={() => setConfirm({ what: 'set', itemId: null })}>Delete the whole set</Btn>
        </div>
      </Section>

      <Diagnostics data={data} userId={userId} db={dbRef.current} queue={queue} />

      <ConfirmSheet
        open={!!confirm} onClose={() => setConfirm(null)} onConfirm={runDelete} confirmLabel="Delete" cancelLabel="Keep"
        title={confirm?.what === 'set' ? 'Delete the whole set?' : confirm?.what === 'item' ? 'Delete this item?' : 'Delete this photograph?'}
        body={confirm?.what === 'set' ? 'Every photograph and confirmation stored for this set is removed from private storage and from this phone. This cannot be undone.'
          : confirm?.what === 'item' ? 'The photograph and the confirmation for this item are removed. This cannot be undone.'
            : 'The original and its prepared copy are removed from private storage. The confirmation is kept.'}
      />
    </div>
  );
}

/** What is needed to trust what this screen says, readable on the phone itself. */
function Diagnostics({ data, userId, db, queue }) {
  const server = data?.deployment ?? {};
  const differs = server.sha && server.sha !== 'local' && BUILD !== 'local' && server.sha !== BUILD;
  const waiting = Object.keys(queue).length;
  return (
    <div className="rounded-container border border-subtle bg-surface p-3 space-y-1 font-mono">
      <p className="text-label font-semibold text-text-primary">SCAN LAB DIAGNOSTICS</p>
      <Fact label="app build" value={BUILD} />
      <Fact label="server build" value={`${server.sha ?? '—'} · ${server.environment ?? '—'}`} />
      <Fact label="builds match" value={differs ? 'NO: update the app' : (server.sha ? 'yes' : '—')} />
      <Fact label="account" value={userId ? `${userId.slice(0, 8)}… (allowlisted by the server)` : null} />
      <Fact label="storage" value={data?.status === 'OK' ? 'private bucket reachable' : (data?.reason ?? data?.error ?? 'unknown')} />
      <Fact label="set" value={data?.set ? `${data.set.name} · excluded from benchmark: ${data.set.excluded_from_benchmark ? 'yes' : 'no'}` : null} />
      <Fact label="phone queue" value={`${waiting} waiting · ${db?.persistent ? 'survives closing the app' : 'memory only: keep the app open'}`} />
      <Fact label="paid calls made by capture" value={data?.execution?.paid_calls_made_by_capture ?? 0} />
      <Fact label="benchmark execution" value={data?.execution ? (data.execution.available ? 'available' : `locked · requires ${data.execution.requires}`) : null} />
      <Fact label="device" value={typeof navigator !== 'undefined' ? String(navigator.userAgent).replace(/^Mozilla\/5\.0 /, '').slice(0, 90) : null} />
    </div>
  );
}
