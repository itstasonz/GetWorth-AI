import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { Card } from '../components/ui';
import { supabase } from '../lib/supabase';
import { groupScans, summarise, accountRefOf, SLOW_MS } from '../lib/scanMonitor';

// Admin-only: scan_events is readable only by profiles.is_admin under RLS, so a
// non-admin session gets no rows here even if this component were reached.
const RANGES = [{ id: 1, label: '24h' }, { id: 7, label: '7d' }, { id: 30, label: '30d' }];
const STATUSES = ['all', 'priced', 'no_price', 'awaiting_answer', 'no_item', 'failed', 'error', 'unavailable', 'rate_limited'];
const MAX_ROWS = 3000;

const sec = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—');
const pct = (f) => (f === null || f === undefined ? '—' : `${Math.round(f * 100)}%`);
const STATUS_COLOR = {
  priced: 'text-emerald-300', no_price: 'text-amber-300', awaiting_answer: 'text-sky-300', no_item: 'text-slate-300',
  failed: 'text-red-300', error: 'text-red-300', unavailable: 'text-red-300', rate_limited: 'text-orange-300',
};

export default function ScanMonitor({ lang }) {
  const t = (en, he) => (lang === 'he' ? he : en);
  const [days, setDays] = useState(1);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [rows, setRows] = useState([]);
  const [myRef, setMyRef] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  // Pricing accuracy on independent GetWorth sales (admin_accuracy_report): null = unavailable, [] = unmeasured.
  const [accuracy, setAccuracy] = useState(null);
  useEffect(() => {
    let live = true;
    supabase.rpc('admin_accuracy_report').then(({ data, error }) => { if (live) setAccuracy(error ? null : (data ?? [])); }, () => {});
    return () => { live = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const { data, error: e } = await supabase.from('scan_events')
        .select('scan_uuid, created_at, payload').eq('event_type', 'core_scan_request')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(MAX_ROWS);
      if (e) throw e;
      setRows(data ?? []);
      const { data: u } = await supabase.auth.getUser();
      setMyRef(await accountRefOf(u?.user?.id));
    } catch (err) {
      setError(err?.message || 'load failed');
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const scans = useMemo(() => groupScans(rows), [rows]);
  const shown = useMemo(() => scans.filter((s) => (status === 'all' || s.status === status)
    && (!mineOnly || (myRef && s.account === myRef))
    && (!query.trim() || s.scan_uuid.startsWith(query.trim().toLowerCase()) || (s.deployment ?? '').startsWith(query.trim().toLowerCase()))), [scans, status, mineOnly, myRef, query]);
  const sum = useMemo(() => summarise(shown), [shown]);

  const Stat = ({ label, value }) => (
    <div className="rounded-control bg-white/5 px-3 py-2"><p className="text-xs text-slate-400">{label}</p><p className="text-sm font-semibold">{value}</p></div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 items-center">
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setDays(r.id)} className={`px-2.5 py-1 rounded-control text-xs ${days === r.id ? 'bg-accent/12 text-accent' : 'bg-white/5 text-slate-400'}`}>{r.label}</button>
        ))}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1 rounded-control text-base bg-white/5 text-slate-200">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-300">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />{t('My scans', 'הסריקות שלי')}
        </label>
        <button onClick={load} className="p-1.5 rounded-control bg-white/5" aria-label={t('Refresh', 'רענון')}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Scan ID or commit prefix', 'מזהה סריקה או קומיט')}
        className="w-full px-3 py-2 rounded-control bg-white/5 text-base text-slate-200" dir="ltr" />

      {error && (
        <Card className="p-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" /><p className="text-xs text-red-300">{error}</p></Card>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label={t('Scans', 'סריקות')} value={sum.total} />
        <Stat label={t('Finished', 'הושלמו')} value={pct(sum.success_rate)} />
        <Stat label={t('Failed', 'נכשלו')} value={pct(sum.failure_rate)} />
        <Stat label={t('Priced from evidence', 'תומחרו מראיות')} value={pct(sum.evidence_coverage)} />
        <Stat label={t('Legacy fallbacks', 'נפילות למנוע הישן')} value={sum.legacy_fallbacks} />
        <Stat label={t('Rate limited', 'הוגבלו')} value={sum.rate_limited} />
        <Stat label={`${t('Phone', 'טלפון')} p50/p90/p95 (n=${sum.client_ms.n})`} value={`${sec(sum.client_ms.p50)} / ${sec(sum.client_ms.p90)} / ${sec(sum.client_ms.p95)}`} />
        <Stat label={`${t('Server', 'שרת')} p50/p90/p95 (n=${sum.server_ms.n})`} value={`${sec(sum.server_ms.p50)} / ${sec(sum.server_ms.p90)} / ${sec(sum.server_ms.p95)}`} />
        <Stat label={t('Tokens / scan', 'טוקנים לסריקה')} value={sum.tokens_per_scan ?? '—'} />
      </div>
      <p className="text-xs text-slate-500">{t('Identification accuracy: not measured — no confirmed labels exist yet.', 'דיוק זיהוי: לא נמדד — אין עדיין תוויות מאומתות.')}</p>
      {accuracy && (
        <div className="rounded-control bg-white/5 px-3 py-2 text-xs text-slate-300 space-y-1" data-testid="pricing-accuracy">
          <p className="font-semibold">{t('Pricing accuracy (independent GetWorth sales)', 'דיוק תמחור (מכירות GetWorth עצמאיות)')}</p>
          {accuracy.length === 0 ? (
            <p className="text-slate-400">{t('Unmeasured — no independent buyer-confirmed sale yet.', 'לא נמדד — אין עדיין מכירה עצמאית שאושרה על ידי קונה.')}</p>
          ) : accuracy.map((a) => (
            <p key={a.category} dir="ltr">{a.category}: n={a.n} · median error {Math.round(a.median_ape * 100)}% (IQR {Math.round(a.ape_p25 * 100)}–{Math.round(a.ape_p75 * 100)}%) · ₪{Math.round(a.median_abs_error_ils)}{a.anchored_excluded ? ` · ${a.anchored_excluded} anchored excluded` : ''}{a.n < 10 ? ' · small sample' : ''}</p>
          ))}
        </div>
      )}

      {rows.length >= MAX_ROWS && <p className="text-xs text-amber-300">{t(`Showing the newest ${MAX_ROWS} requests only.`, `מוצגות ${MAX_ROWS} הבקשות האחרונות בלבד.`)}</p>}

      <div className="space-y-1.5">
        {shown.length === 0 && !loading && <p className="text-xs text-slate-400 text-center py-6">{t('No scans in this range', 'אין סריקות בטווח הזה')}</p>}
        {shown.slice(0, 200).map((s) => {
          const ms = s.client_ms ?? s.server_ms;
          return (
            <Card key={s.scan_uuid} className="p-3">
              <button className="w-full text-start" onClick={() => setOpen(open === s.scan_uuid ? null : s.scan_uuid)}>
                <div className="flex justify-between gap-2 text-xs">
                  <span className={`font-semibold ${STATUS_COLOR[s.status] ?? 'text-slate-300'}`}>{s.status}{s.account && s.account === myRef ? ' · mine' : ''}</span>
                  <span className={ms > SLOW_MS ? 'text-red-300' : 'text-slate-300'}>{sec(ms)}{s.client_ms ? '' : ' (srv)'}</span>
                </div>
                <p className="text-xs text-slate-200 truncate">{s.item ?? '—'}</p>
                <p className="text-xs text-slate-500" dir="ltr">{new Date(s.started).toLocaleString()} · {s.scan_uuid.slice(0, 8)} · {s.deployment ?? '?'}</p>
              </button>
              {open === s.scan_uuid && (
                <div className="mt-2 text-xs text-slate-300 space-y-0.5" dir="ltr">
                  <p>identify {sec(s.identify_ms)} · price {sec(s.price_ms)} · server {sec(s.server_ms)} · phone {sec(s.client_ms)} (identity shown {sec(s.client_identity_ms)})</p>
                  <p>category {s.category ?? '—'} · identity {s.identity_confidence ?? '—'} · question {s.question ?? '—'}</p>
                  <p>AI requests {s.ai_requests} · searches {s.searches ?? '—'} · evidence {s.evidence ?? '—'} (used {s.evidence_used ?? '—'}, resale refs {s.resale_refs ?? '—'}){s.reused ? ' · research reused' : ''}</p>
                  <p>price confidence {s.price_confidence ?? '—'} · withdrawn {s.withdrawn ?? '—'} · reason {s.reason ?? '—'}</p>
                  <p className="break-all">hosts {s.hosts.length ? s.hosts.join(', ') : '—'}</p>
                  <p>tokens {s.tokens ?? '—'} · requests {s.requests}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
