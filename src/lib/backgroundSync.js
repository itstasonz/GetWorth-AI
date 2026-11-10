// ══════════════════════════════════════════════════════════════════════════════
// BACKGROUND SYNC GATE — keep the database quiet while a Core Scan is on the critical path (scan b4254487, 2026-11-10)
//
// Production evidence: the scan's quota check spent 3,556 ms inside Supabase while the same phone's background reloads
// (get_user_orders 5.2 s, conversations 4.6 s, listings 4.6 s) ran on the same small database. Those reloads were
// re-syncs after a realtime reconnect and after auth events — nothing the person was waiting for.
//
// While the gate is held (camera open, or a scan step in flight), a re-sync is not run: it is remembered under a key
// (several requests for the same data collapse into one) and runs once when the gate is released. A hold can never
// outlive MAX_HOLD_MS, so a stuck scan cannot stop the app from syncing. Work the person asked for is never deferred:
// only callers that choose deferWhileBusy() are affected.
// ══════════════════════════════════════════════════════════════════════════════

export const MAX_HOLD_MS = 60_000;

const holds = new Map();      // token → expiry timer
const pending = new Map();    // key → fn (last one wins; same data, one fetch)
let nextToken = 1;

/** Is a scan holding the gate right now? */
export const isBusy = () => holds.size > 0;

function flush() {
  if (holds.size > 0 || pending.size === 0) return;
  const work = [...pending.values()];
  pending.clear();
  for (const fn of work) {
    try { Promise.resolve(fn()).catch(() => {}); } catch { /* a re-sync is best-effort */ }
  }
}

/**
 * Hold the gate until the returned release() is called (idempotent), or MAX_HOLD_MS passes.
 * @returns {() => void} release
 */
export function holdBackgroundSync({ maxHoldMs = MAX_HOLD_MS } = {}) {
  const token = nextToken++;
  const release = () => {
    const timer = holds.get(token);
    if (timer === undefined) return;
    clearTimeout(timer);
    holds.delete(token);
    flush();
  };
  holds.set(token, setTimeout(release, maxHoldMs));
  return release;
}

/** Run `fn` now, or — while a scan holds the gate — once, when it is released. Returns true when it ran now. */
export function deferWhileBusy(key, fn) {
  if (holds.size === 0) {
    try { Promise.resolve(fn()).catch(() => {}); } catch { /* best-effort */ }
    return true;
  }
  pending.set(key, fn);
  return false;
}

/** Drop everything (sign-out: a deferred re-sync must never run for the next account). */
export function resetBackgroundSync() {
  for (const timer of holds.values()) clearTimeout(timer);
  holds.clear();
  pending.clear();
}

/** For the suites. */
export const pendingKeys = () => [...pending.keys()];

const IN_FLIGHT = new Set(['preparing', 'identifying', 'pricing']);
/** Should the app hold background re-syncs? While the camera is open or a scan step is in flight (coreScan STAGE). */
export const scanHoldsSync = (view, stage) => view === 'camera' || IN_FLIGHT.has(stage);
