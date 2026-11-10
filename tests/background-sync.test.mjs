// BG — background re-syncs and auth events during a Core Scan (Production scan b4254487, 2026-11-10).
// The scan's quota check waited 3,556 ms in Supabase while the phone re-ran loadUserData (an auth event replaced the
// user object) and realtime-reconnect re-syncs (orders, chats). These suites pin the three fixes:
//   BG-1 the gate (src/lib/backgroundSync.js), BG-2 the stable auth user (src/lib/authUser.js),
//   BG-3 how AppContext wires them (source checks: the provider is a 4,700-line React module with no test seam).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holdBackgroundSync, deferWhileBusy, resetBackgroundSync, isBusy, pendingKeys, scanHoldsSync, MAX_HOLD_MS } from '../src/lib/backgroundSync.js';
import { nextAuthUser, profileRefetchNeeded } from '../src/lib/authUser.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('BG-1 the background-sync gate', () => {
  beforeEach(() => resetBackgroundSync());

  test('BG-1a idle: a re-sync runs at once', () => {
    let n = 0;
    assert.equal(deferWhileBusy('orders', () => { n += 1; }), true);
    assert.equal(n, 1);
  });

  test('BG-1b held: re-syncs wait, collapse per key, and run once on release', async () => {
    const ran = [];
    const release = holdBackgroundSync();
    assert.equal(isBusy(), true);
    assert.equal(deferWhileBusy('orders', () => ran.push('orders-1')), false);
    deferWhileBusy('orders', () => ran.push('orders-2'));
    deferWhileBusy('conversations', () => ran.push('conversations'));
    assert.deepEqual(ran, []);
    assert.deepEqual(pendingKeys().sort(), ['conversations', 'orders']);
    release();
    await tick();
    assert.deepEqual(ran.sort(), ['conversations', 'orders-2']);
    assert.equal(isBusy(), false);
    release(); // idempotent
    assert.deepEqual(pendingKeys(), []);
  });

  test('BG-1c two holds: nothing runs until both are released', () => {
    const ran = [];
    const a = holdBackgroundSync();
    const b = holdBackgroundSync();
    deferWhileBusy('orders', () => ran.push('orders'));
    a();
    assert.deepEqual(ran, []);
    b();
    assert.deepEqual(ran, ['orders']);
  });

  test('BG-1d a hold can never outlive its limit: a stuck scan does not stop syncing', async () => {
    const ran = [];
    holdBackgroundSync({ maxHoldMs: 15 });
    deferWhileBusy('orders', () => ran.push('orders'));
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(ran, ['orders']);
    assert.equal(isBusy(), false);
    assert.equal(MAX_HOLD_MS, 60_000);
  });

  test('BG-1e sign-out drops deferred work: nothing runs for the next account', () => {
    const ran = [];
    const release = holdBackgroundSync();
    deferWhileBusy('orders', () => ran.push('orders'));
    resetBackgroundSync();
    release();
    assert.deepEqual(ran, []);
    assert.equal(isBusy(), false);
  });

  test('BG-1f a failing re-sync never breaks the others', async () => {
    const ran = [];
    const release = holdBackgroundSync();
    deferWhileBusy('a', () => { throw new Error('boom'); });
    deferWhileBusy('b', () => Promise.reject(new Error('async boom')));
    deferWhileBusy('c', () => ran.push('c'));
    release();
    await tick();
    assert.deepEqual(ran, ['c']);
  });

  test('BG-1g the scan lifecycle: held with the camera open and while a step is in flight; free once a result shows', () => {
    assert.equal(scanHoldsSync('camera', 'idle'), true);
    for (const stage of ['preparing', 'identifying', 'pricing']) assert.equal(scanHoldsSync('results', stage), true, stage);
    for (const stage of ['idle', 'priced', 'insufficient', 'needs_detail', 'no_item', 'error']) assert.equal(scanHoldsSync('results', stage), false, stage);
    assert.equal(scanHoldsSync('home', 'idle'), false);
  });
});

describe('BG-2 auth events keep the same user object when the account did not change', () => {
  const u = { id: 'u1', email: 'a@x', updated_at: '2026-11-10T10:00:00Z', app_metadata: {} };

  test('BG-2a TOKEN_REFRESHED / session recovery: same account → the previous object (no reload, no profile read)', () => {
    const again = { ...u };
    assert.equal(nextAuthUser(u, again), u);
    assert.equal(profileRefetchNeeded('TOKEN_REFRESHED', u, again), false);
    assert.equal(profileRefetchNeeded('SIGNED_IN', u, again), false);
  });

  test('BG-2b a real change still produces a new object and a profile read', () => {
    const other = { ...u, id: 'u2' };
    assert.equal(nextAuthUser(u, other), other);
    assert.equal(profileRefetchNeeded('SIGNED_IN', u, other), true);
    const edited = { ...u, updated_at: '2026-11-10T11:00:00Z' };
    assert.equal(nextAuthUser(u, edited), edited);
    assert.equal(profileRefetchNeeded('USER_UPDATED', u, { ...u }), true);
    const reEmailed = { ...u, email: 'b@x' };
    assert.equal(nextAuthUser(u, reEmailed), reEmailed);
  });

  test('BG-2c first sign-in and sign-out', () => {
    assert.equal(nextAuthUser(null, u), u);
    assert.equal(profileRefetchNeeded('INITIAL_SESSION', null, u), true);
    assert.equal(nextAuthUser(u, null), null);
    assert.equal(profileRefetchNeeded('SIGNED_OUT', u, null), false);
  });
});

describe('BG-3 AppContext wiring', () => {
  const src = readFileSync(new URL('../src/contexts/AppContext.jsx', import.meta.url), 'utf8');

  test('BG-3a the account-data loader is keyed on the account id, not the user object', () => {
    const at = src.indexOf('      loadUserData();\n      // MKT-3');
    assert.ok(at > 0);
    const close = src.indexOf('}, [', at);
    assert.equal(src.slice(close, close + 16), '}, [user?.id]);\n');
  });

  test('BG-3b auth events go through nextAuthUser and read the profile only when needed', () => {
    const listener = src.slice(src.indexOf('supabase.auth.onAuthStateChange'), src.indexOf('return () => { mounted = false; subscription.unsubscribe(); };'));
    assert.match(listener, /nextAuthUser\(prevUser, session\.user\)/);
    assert.match(listener, /if \(profileRefetchNeeded\(event, prevUser, session\.user\)\)/);
    // The one direct hand-over left is PASSWORD_RECOVERY (a recovery link always means a fresh session).
    assert.equal((listener.match(/setUser\(session\.user\)/g) || []).length, 1);
    assert.match(listener, /authUserRef\.current = session\.user;\n\s+setUser\(session\.user\);\n\s+setPasswordRecovery\(true\);/);
  });

  test('BG-3c realtime-reconnect and new-order re-syncs are deferred while a scan holds the gate', () => {
    assert.match(src, /deferWhileBusy\('notifications', \(\) => loadNotifications\(\)\); deferWhileBusy\('orders', \(\) => loadOrders\(true\)\);/);
    assert.match(src, /deferWhileBusy\('conversations', \(\) => loadConversations\(true\)\)/);
    assert.equal((src.match(/deferWhileBusy\('orders', \(\) => loadOrders\(true\)\)/g) || []).length, 3);
  });

  test('BG-3d the scan lifecycle holds the gate, and sign-out resets it', () => {
    assert.match(src, /scanHoldsSync\(view, scanStore\.getSnapshot\(\)\.stage\)/);
    assert.match(src, /holdBackgroundSync\(\)/);
    assert.match(src, /resetBackgroundSync\(\); \/\/ a re-sync deferred during a scan/);
  });

  test('BG-3e no list query reads listings.* or embeds full photographs', () => {
    assert.ok(!/from\('listings'\)\s*\.select\('\*'\)/.test(src), 'my listings must use the card columns');
    assert.ok(!/listing:listings\(\*/.test(src), 'saved items must use the card columns');
    assert.ok(!/listing:listings\(id, title, title_hebrew(, price)?, images\)/.test(src), 'chat previews must use the thumbnail');
    // The only full-row listing reads left: one listing opened by a resumed buy intent, and the photographs for delete.
    const fullRows = src.match(/\.select\('\*, seller:profiles/g) || [];
    assert.equal(fullRows.length, 1);
  });
});
