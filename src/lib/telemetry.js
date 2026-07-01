// ═══════════════════════════════════════════════════════════════════════════
// GW-000 — Pluggable error / telemetry sink
// ═══════════════════════════════════════════════════════════════════════════
// reportError() is intentionally provider-agnostic so persistence reliability
// NEVER depends on an external monitoring service being configured.
//
//   • If a provider is registered (via initTelemetry) → emit to it.
//   • If not → structured console log only (picked up by log drains today).
//
// Full Sentry integration is deferred to ticket GW-000.5, which will call
// initTelemetry({ captureException, captureMessage }) once at app startup.
// ═══════════════════════════════════════════════════════════════════════════

let _provider = null;

// Register a monitoring provider (e.g. Sentry) — GW-000.5.
export function initTelemetry(provider) {
  _provider = provider || null;
}

// Report an error. Accepts arbitrary structured context (scan_uuid, stage, …).
// Guaranteed never to throw — telemetry must not break the caller.
export function reportError(err, context = {}) {
  try {
    const payload = { message: err?.message || String(err), ...context };
    // Structured, greppable line — log drains / GW-009 can parse this today.
    console.error('[reportError]', JSON.stringify(payload));
    if (_provider?.captureException) {
      _provider.captureException(err, { extra: context });
    }
  } catch {
    /* never throw from telemetry */
  }
}

// Optional lightweight breadcrumb/event for non-error diagnostics.
export function logEvent(name, data = {}) {
  try {
    if (_provider?.captureMessage) _provider.captureMessage(name, { extra: data });
  } catch {
    /* never throw from telemetry */
  }
}
