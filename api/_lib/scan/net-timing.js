// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHERE A DATABASE CALL'S TIME GOES (the 4.12 s quota check, scan 16666e44, 2026-11-10)
//
// The quota RPC executes in under a millisecond in Postgres, yet one real identification spent 4,122 ms in it on a warm
// instance. This module times one server-side call to Supabase from the inside, with monotonic clocks
// (performance.now()), using the events Node's own fetch publishes (diagnostics_channel, "undici:*"):
//
//   MEASURED
//     total_ms            the whole traced call, from the caller's side
//     loop_lag_ms         how late a 0 ms timer fired after the call began (a blocked event loop inflates everything)
//     attempts[]          one per HTTP request the call made (more than one = a retry), each with:
//       fetch_ms            when the client library called fetch, from the start of the call
//       connect             'new' (a socket was opened for it) | 'reused' | 'unknown' (socket older than this module)
//       connect_ms          DNS + TCP + TLS for a new socket (beforeConnect → connected)
//       socket_idle_ms      for a reused socket: how long it had been idle since its previous response ended
//       sent_ms             when the request's headers were written to the socket
//       headers_ms          when the response's status and headers arrived
//       done_ms             when the response body ended
//       status, error       the HTTP status, or the error code (never a message, URL or header)
//       upstream_ms         Supabase's gateway: time its backend (PostgREST + Postgres) took (x-envoy-upstream-service-time)
//       gateway_attempts    Supabase's gateway retries (x-envoy-attempt-count)
//   INFERRED (arithmetic on the measured values, labelled as such)
//     before_send_ms      fetch_ms → sent_ms minus connect_ms: time inside the client and its connection pool
//     network_ms          sent_ms → headers_ms minus upstream_ms: the wire and the gateway, both directions
//     after_response_ms   last done_ms → total_ms: parsing and the client library's own work
//
// Nothing identifying is recorded: no URL beyond its path, no query string, no body, no header, no key.
// ══════════════════════════════════════════════════════════════════════════════
import dc from 'node:diagnostics_channel';
import { AsyncLocalStorage } from 'node:async_hooks';

const TRACE_HEADER = 'x-gw-trace';
const als = new AsyncLocalStorage();
const now = () => performance.now();
const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

const active = new Map();          // trace id → trace
const attemptOf = new WeakMap();   // undici request → attempt
const socketOf = new WeakMap();    // undici request → socket
const connecting = new Map();      // host:port → start times of connections not yet established (FIFO)
const hostKey = (p) => `${p?.host ?? p?.hostname ?? ''}:${p?.port ?? ''}`;
const sockets = new WeakMap();     // socket → { connected_at, connect_ms, uses, last_done_at }

/** The trace id an undici request carries, if it is one of ours. */
function traceIdOf(request) {
  const h = request?.headers;
  // Node's fetch hands undici a flat [name, value, name, value…] array; undici's own API may use "name: value\r\n" text.
  if (Array.isArray(h)) return headerOf(h, TRACE_HEADER)?.toLowerCase() ?? null;
  return /x-gw-trace:\s*([a-z0-9]+)/i.exec(String(h ?? ''))?.[1]?.toLowerCase() ?? null;
}
/** One header, from undici's flat [name, value, name, value…] array (strings or buffers). */
function headerOf(headers, name) {
  if (!Array.isArray(headers)) return null;
  for (let i = 0; i + 1 < headers.length; i += 2) if (String(headers[i]).toLowerCase() === name) return String(headers[i + 1]);
  return null;
}

let installed = false;
export function installNetTiming() {
  if (installed) return;
  installed = true;
  dc.subscribe('undici:request:create', ({ request }) => {
    const trace = active.get(traceIdOf(request));
    if (!trace) return;
    const attempt = { t_create: now() };
    trace.attempts.push(attempt);
    attemptOf.set(request, attempt);
    attempt.path = String(request.path ?? '').split('?')[0].slice(0, 80);
  });
  // The connectParams object differs between these two events (seen 2026-11-10), so a start is matched by host, first in first out.
  dc.subscribe('undici:client:beforeConnect', ({ connectParams }) => {
    const k = hostKey(connectParams);
    if (connecting.size > 100) connecting.clear();
    connecting.set(k, [...(connecting.get(k) ?? []), now()]);
  });
  dc.subscribe('undici:client:connected', ({ connectParams, socket }) => {
    if (!socket) return;
    const queue = connecting.get(hostKey(connectParams));
    const start = queue?.shift();
    if (queue && queue.length === 0) connecting.delete(hostKey(connectParams));
    const t = now();
    sockets.set(socket, { connected_at: t, connect_ms: start === undefined ? null : t - start, uses: 0, last_done_at: null });
  });
  dc.subscribe('undici:client:connectError', ({ connectParams, error }) => {
    // A failed connection is attributed to whichever traced attempt is still waiting to send.
    for (const trace of active.values()) {
      const a = trace.attempts.find((x) => x.t_sent === undefined && !x.error);
      if (a) a.connect_error = String(error?.code ?? error?.name ?? 'error').slice(0, 40);
    }
    connecting.get(hostKey(connectParams))?.shift();
  });
  dc.subscribe('undici:client:sendHeaders', ({ request, socket }) => {
    if (socket) socketOf.set(request, socket);
    const a = attemptOf.get(request);
    if (!a) return;
    a.t_sent = now();
    const s = socket ? sockets.get(socket) : undefined;
    if (!s) { a.connect = 'unknown'; return; }
    a.connect = s.uses === 0 ? 'new' : 'reused';
    if (a.connect === 'new') a.connect_ms = s.connect_ms;
    else a.socket_idle_ms = s.last_done_at === null ? null : a.t_sent - s.last_done_at;
    s.uses += 1;
  });
  dc.subscribe('undici:request:headers', ({ request, response }) => {
    const a = attemptOf.get(request);
    if (!a) return;
    a.t_headers = now();
    a.status = response?.statusCode ?? null;
    a.upstream_ms = Number(headerOf(response?.headers, 'x-envoy-upstream-service-time')) || null;
    a.gateway_attempts = Number(headerOf(response?.headers, 'x-envoy-attempt-count')) || null;
  });
  dc.subscribe('undici:request:trailers', ({ request }) => {
    const t = now();
    const socket = socketOf.get(request);
    const s = socket ? sockets.get(socket) : undefined;
    if (s) s.last_done_at = t;
    const a = attemptOf.get(request);
    if (a) a.t_done = t;
  });
  dc.subscribe('undici:request:error', ({ request, error }) => {
    const a = attemptOf.get(request);
    if (a) a.error = String(error?.code ?? error?.name ?? 'error').slice(0, 40);
  });
}

/**
 * fetch for the server's Supabase client: inside a trace it tags the request (a random id, nothing else) and records
 * when the library called it; outside a trace it is plain fetch.
 */
export function tracedFetch(input, init = {}) {
  const trace = als.getStore();
  if (!trace) return fetch(input, init);
  trace.fetch_calls.push(now());
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set(TRACE_HEADER, trace.id);
  return fetch(input, { ...init, headers });
}

/** Run `fn` with its database traffic traced. Resolves to { result, timing } (or rethrows with err.timing set). */
export async function traced(fn, { onStart = null } = {}) {
  installNetTiming();
  const trace = { id: crypto.randomUUID().replace(/-/g, ''), t0: now(), attempts: [], fetch_calls: [], lag: null };
  active.set(trace.id, trace);
  onStart?.(trace);
  const lagTimer = setTimeout(() => { trace.lag = now() - trace.t0; }, 0);
  try {
    // Awaited INSIDE the context: Supabase's query builder sends its request only when it is awaited (it is a thenable).
    const result = await als.run(trace, async () => await fn());
    return { result, timing: summarise(trace, now()) };
  } catch (err) {
    try { err.timing = summarise(trace, now()); } catch { /* never mask the error */ }
    throw err;
  } finally {
    clearTimeout(lagTimer);
    active.delete(trace.id);
  }
}

/** The trace as numbers: measured values first, then what is inferred from them. Exported for the suites. */
export function summarise(trace, tEnd) {
  const rel = (t) => (t === undefined ? null : round(t - trace.t0));
  const total = tEnd - trace.t0;
  const attempts = trace.attempts.map((a, i) => ({
    fetch_ms: rel(trace.fetch_calls[i]),
    path: a.path ?? null,
    connect: a.connect ?? (a.t_sent === undefined ? 'not_sent' : 'unknown'),
    connect_ms: round(a.connect_ms),
    socket_idle_ms: round(a.socket_idle_ms),
    sent_ms: rel(a.t_sent),
    headers_ms: rel(a.t_headers),
    done_ms: rel(a.t_done),
    status: a.status ?? null,
    error: a.error ?? a.connect_error ?? null,
    upstream_ms: a.upstream_ms ?? null,
    gateway_attempts: a.gateway_attempts ?? null,
  }));
  const last = trace.attempts.at(-1);
  const inferred = attempts.map((a) => ({
    before_send_ms: a.sent_ms === null || a.fetch_ms === null ? null : round(a.sent_ms - a.fetch_ms - (a.connect_ms ?? 0)),
    network_ms: a.headers_ms === null || a.sent_ms === null ? null : round(a.headers_ms - a.sent_ms - (a.upstream_ms ?? 0)),
  }));
  return {
    measured: {
      total_ms: round(total),
      loop_lag_ms: trace.lag === null ? round(total) : round(trace.lag),
      loop_lag_capped: trace.lag === null,
      fetch_calls: trace.fetch_calls.length,
      attempts,
    },
    inferred: {
      attempts: inferred,
      after_response_ms: last?.t_done === undefined ? null : round(tEnd - last.t_done),
    },
  };
}
