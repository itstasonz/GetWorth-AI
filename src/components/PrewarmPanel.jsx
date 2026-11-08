import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Pause, Play } from 'lucide-react';
import { Card } from './ui';
import { supabase } from '../lib/supabase';
import { summarisePrewarm } from '../lib/prewarmMonitor';

// ══════════════════════════════════════════════════════════════════════════════
// PRE-RESEARCH: COST, ALERTS AND THE OFF SWITCH (admin monitor, Scans tab)
//
// Reads what the daily run records in scan_events (admin-only under RLS): each
// run's measured spend, the pause/resume history, the alerts, and scans that
// failed because the OpenAI account is out of credit. Pause takes effect
// before the next product of a run in progress (api/prewarm.js POST).
// ══════════════════════════════════════════════════════════════════════════════
export const DAILY_CAP_USD = 0.30;
const TYPES = ['core_scan_prewarm', 'core_scan_prewarm_control', 'core_scan_alert'];
const usd = (n) => (Number.isFinite(n) ? `$${n.toFixed(3)}` : '—');
const ALERT_TEXT = {
  openai_credit_exhausted: ['OpenAI credit exhausted — scans and pre-research fail until it is topped up', 'נגמר הקרדיט ב-OpenAI — סריקות ומחקר מוקדם נכשלים עד טעינה'],
  prewarm_daily_cap_reached: ['Daily pre-research cap reached', 'הגיע תקרת ההוצאה היומית למחקר מוקדם'],
  prewarm_failures: ['Half or more of a run\'s research failed', 'מחצית או יותר מהמחקר בהרצה נכשל'],
  prewarm_spend_over_cap: ['Spend went over the cap — pre-research paused itself', 'ההוצאה עברה את התקרה — המחקר המוקדם הושהה אוטומטית'],
  prewarm_demand_unreadable: ['Could not read scan demand', 'לא ניתן היה לקרוא את הביקוש לסריקות'],
};

export default function PrewarmPanel({ lang }) {
  const t = (en, he) => (lang === 'he' ? he : en);
  const [rows, setRows] = useState([]);
  const [creditFailures, setCreditFailures] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const day = new Date(Date.now() - 864e5).toISOString();
    const [events, failures] = await Promise.all([
      supabase.from('scan_events').select('event_type, created_at, payload').in('event_type', TYPES).gte('created_at', since).order('created_at', { ascending: false }).limit(200),
      supabase.from('scan_events').select('scan_uuid', { count: 'exact', head: true }).eq('event_type', 'core_scan_request').eq('payload->>reason', 'credit_exhausted').gte('created_at', day),
    ]);
    if (events.error) { setError(events.error.message); return; }
    setRows(events.data ?? []);
    setCreditFailures(failures.count ?? 0);
  }, []);
  useEffect(() => { load(); }, [load]);

  const s = summarisePrewarm(rows);
  const toggle = async () => {
    setBusy(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/prewarm', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ action: s.paused ? 'resume' : 'pause' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) { setError(err?.message || 'failed'); } finally { setBusy(false); }
  };

  return (
    <Card className="p-3 space-y-2" data-testid="prewarm-panel">
      {creditFailures > 0 && (
        <div className="flex items-center gap-2 text-xs text-red-300" data-testid="credit-alert">
          <AlertTriangle className="w-4 h-4" />
          <span>{t(`${creditFailures} scans failed in the last 24 h: the OpenAI account is out of credit.`, `${creditFailures} סריקות נכשלו ב-24 השעות האחרונות: נגמר הקרדיט בחשבון OpenAI.`)}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">{t('Pre-research', 'מחקר מוקדם')} · {s.paused ? t('paused', 'מושהה') : t('active', 'פעיל')}</p>
        <button onClick={toggle} disabled={busy} className="flex items-center gap-1 px-2.5 py-1 rounded-control text-xs bg-white/5 text-slate-200">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (s.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />)}
          {s.paused ? t('Resume', 'הפעלה') : t('Pause now', 'השהיה מיידית')}
        </button>
      </div>
      <p className="text-xs text-slate-300" dir="ltr">{t('Today', 'היום')} {usd(s.today_usd)} / {usd(DAILY_CAP_USD)} · {t('7 days', '7 ימים')} {usd(s.week_usd)}</p>
      {s.control && <p className="text-xs text-slate-500" dir="ltr">{s.control.payload?.enabled === false ? 'paused' : 'resumed'} {new Date(s.control.created_at).toLocaleString()} · {String(s.control.payload?.by ?? '').slice(0, 16)}</p>}
      {s.alerts.map((a) => (
        <p key={a.created_at + a.payload?.kind} className="text-xs text-amber-300">{new Date(a.created_at).toLocaleString()} · {(ALERT_TEXT[a.payload?.kind] ?? [a.payload?.kind, a.payload?.kind])[lang === 'he' ? 1 : 0]}</p>
      ))}
      {s.runs.map((r) => (
        <p key={r.created_at} className="text-xs text-slate-400" dir="ltr">{new Date(r.created_at).toLocaleDateString()} · {r.payload?.status} · researched {r.payload?.researched ?? 0} · priced {r.payload?.priced ?? 0} · {usd((Number(r.payload?.spent_usd) || 0) + (Number(r.payload?.preflight_usd) || 0))}</p>
      ))}
      {s.runs.length === 0 && <p className="text-xs text-slate-500">{t('No runs in the last 7 days.', 'אין הרצות ב-7 הימים האחרונים.')}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </Card>
  );
}
