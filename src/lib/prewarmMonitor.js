// The admin monitor's reading of the pre-research events (src/components/PrewarmPanel.jsx). Pure: rows in, summary out.
/** Today's spend, the week's, the current switch state and the recent runs and alerts, from scan_events rows. */
export function summarisePrewarm(rows, now = Date.now()) {
  const day = new Date(Math.floor(now / 864e5) * 864e5).toISOString();
  const runs = rows.filter((r) => r.event_type === 'core_scan_prewarm');
  const spend = (list) => list.reduce((n, r) => n + (Number(r.payload?.spent_usd) || 0) + (Number(r.payload?.preflight_usd) || 0), 0);
  const control = rows.filter((r) => r.event_type === 'core_scan_prewarm_control').sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  return {
    today_usd: spend(runs.filter((r) => r.created_at >= day)),
    week_usd: spend(runs),
    paused: control?.payload?.enabled === false,
    control,
    runs: runs.slice(0, 7),
    alerts: rows.filter((r) => r.event_type === 'core_scan_alert').slice(0, 10),
  };
}

