// ══════════════════════════════════════════════════════════════════════════════
// SCAN MONITOR — FROM TELEMETRY ROWS TO SCANS AND NUMBERS
//
// Pure functions over `core_scan_request` rows (api/_lib/scan/telemetry.js):
// group them into scans by scan_uuid, give each scan one status and its
// durations, and summarise. No network here; the Admin Panel tab reads the rows
// with the admin's own session (scan_events is admin-only under RLS).
//
// Nothing is estimated that was not measured: a scan without the phone's report
// has no client duration, and identification accuracy is not computed at all
// because no confirmed ground-truth labels exist in these rows.
// ══════════════════════════════════════════════════════════════════════════════

export const SLOW_MS = 20_000;

/** Nearest-rank percentile of a list of numbers, or null for an empty list. */
export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.min(xs.length, Math.max(1, Math.ceil((p / 100) * xs.length)));
  return xs[rank - 1];
}

const latest = (rows) => rows.reduce((a, r) => (!a || r.created_at > a.created_at ? r : a), null);

/** One scan from its rows. */
export function scanOf(scanUuid, rows) {
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const p = (r) => r.payload ?? {};
  const of = (action) => sorted.filter((r) => p(r).action === action);
  const identify = latest(of('identify'));
  const price = latest(of('price').filter((r) => p(r).http === 200 && p(r).outcome !== 'identified'));
  const report = latest(of('report'));
  const refusal = sorted.find((r) => ['unavailable', 'rate_limited'].includes(p(r).outcome));
  const failure = sorted.find((r) => p(r).outcome === 'failed' || (p(r).http ?? 0) >= 500);
  const badRequest = sorted.find((r) => (p(r).http ?? 0) >= 400 && (p(r).http ?? 0) < 500 && p(r).outcome !== 'rate_limited');

  let status;
  if (price) status = p(price).priced ? 'priced' : (p(price).outcome === 'failed' ? 'failed' : 'no_price');
  else if (refusal) status = p(refusal).outcome;
  else if (failure) status = 'failed';
  else if (identify && p(identify).outcome === 'no_item') status = 'no_item';
  else if (badRequest) status = 'error';
  else if (identify && p(identify).http === 200) status = 'awaiting_answer';
  else status = 'unknown';

  const sum = (list) => list.reduce((n, r) => n + (p(r).total_ms ?? 0), 0);
  const identifyMs = of('identify').length ? sum(of('identify')) : null;
  const priceMs = of('price').length ? sum(of('price')) : null;
  const serverMs = identifyMs === null && priceMs === null ? null : (identifyMs ?? 0) + (priceMs ?? 0);
  const tokens = sorted.reduce((n, r) => n + (p(r).tokens_in ?? 0) + (p(r).tokens_out ?? 0), 0);
  const any = identify ?? price ?? sorted[0];

  return {
    scan_uuid: scanUuid,
    started: sorted[0]?.created_at ?? null,
    status,
    item: p(price ?? {}).item ?? p(identify ?? {}).item ?? null,
    category: p(price ?? {}).category ?? p(identify ?? {}).category ?? null,
    identity_confidence: p(identify ?? {}).identity_confidence ?? null,
    question: p(identify ?? {}).question ?? null,
    account: p(any ?? {}).account ?? null,
    deployment: p(any ?? {}).deployment?.sha ?? null,
    reason: p(refusal ?? failure ?? badRequest ?? {}).reason ?? null,
    identify_ms: identifyMs,
    price_ms: priceMs,
    server_ms: serverMs,
    client_ms: p(report ?? {}).client?.price_shown_ms ?? null,
    client_identity_ms: p(report ?? {}).client?.identity_shown_ms ?? null,
    searches: p(price ?? {}).searches ?? null,
    ai_requests: sorted.reduce((n, r) => n + (p(r).ai_requests ?? 0), 0),
    evidence: p(price ?? {}).evidence ?? null,
    evidence_used: p(price ?? {}).evidence_used ?? null,
    resale_refs: p(price ?? {}).resale_refs ?? null,
    withdrawn: p(price ?? {}).withdrawn ?? null,
    price_confidence: p(price ?? {}).price_confidence ?? null,
    reused: p(price ?? {}).reused === true,
    hosts: p(price ?? {}).hosts ?? [],
    tokens: tokens || null,
    requests: sorted.length,
  };
}

/** Rows → scans, newest first. */
export function groupScans(rows) {
  const by = new Map();
  for (const r of rows ?? []) {
    if (!r?.scan_uuid) continue;
    if (!by.has(r.scan_uuid)) by.set(r.scan_uuid, []);
    by.get(r.scan_uuid).push(r);
  }
  return [...by.entries()].map(([id, rs]) => scanOf(id, rs)).sort((a, b) => (a.started < b.started ? 1 : -1));
}

/** The summary the tab shows. Rates are fractions of the scans they are about; null when there is nothing to divide. */
export function summarise(scans) {
  const n = scans.length;
  const count = (s) => scans.filter((x) => x.status === s).length;
  const finished = scans.filter((x) => ['priced', 'no_price', 'no_item'].includes(x.status)).length;
  const failed = count('failed') + count('error');
  const researched = count('priced') + count('no_price');
  const rate = (a, b) => (b > 0 ? a / b : null);
  const server = scans.map((x) => x.server_ms);
  const client = scans.map((x) => x.client_ms);
  const tokens = scans.map((x) => x.tokens).filter((t) => Number.isFinite(t));
  return {
    total: n,
    finished, failed,
    unavailable: count('unavailable'), rate_limited: count('rate_limited'), awaiting_answer: count('awaiting_answer'),
    success_rate: rate(finished, n), failure_rate: rate(failed, n),
    priced: count('priced'), no_price: count('no_price'),
    evidence_coverage: rate(count('priced'), researched),
    server_ms: { p50: percentile(server, 50), p90: percentile(server, 90), p95: percentile(server, 95), n: server.filter(Number.isFinite).length },
    client_ms: { p50: percentile(client, 50), p90: percentile(client, 90), p95: percentile(client, 95), n: client.filter(Number.isFinite).length },
    slow: scans.filter((x) => (x.client_ms ?? x.server_ms ?? 0) > SLOW_MS).length,
    tokens_per_scan: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null,
    // A 503 from the core scan is the only road to the legacy engine; each one is a fallback.
    legacy_fallbacks: count('unavailable'),
    accuracy: null,
  };
}

/** The account reference the server writes, computed in the browser for "my scans". */
export async function accountRefOf(userId) {
  if (!userId || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(userId)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
