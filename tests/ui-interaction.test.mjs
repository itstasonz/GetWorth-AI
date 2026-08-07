/**
 * UI-002A — interaction, accessibility and trust-surface behaviour.
 *
 * These are BEHAVIOUR tests, deliberately not snapshot tests. Every defect this
 * file covers was invisible to rendering assertions: the markup was correct in
 * all of them and the bug lived in focus movement, timer lifetime or event
 * ownership. A snapshot would have stayed green through every one.
 *
 * Harness notes:
 *  · src/components/ui.jsx is JSX, which Node cannot import. It is bundled once
 *    with rolldown (already a dependency, via Vite) into node_modules/.cache,
 *    which is inside the repo so `react` still resolves from the output file.
 *  · jsdom supplies real focus semantics — `document.activeElement`, `disabled`
 *    refusing focus, and event capture order — which is the whole point. It
 *    does NOT do layout, so nothing here may depend on measured geometry.
 *  · setTimeout is mocked so the toast's 4.5s deadline is deterministic. React
 *    18 schedules through MessageChannel, not setTimeout, so act() is unaffected.
 */
import { test, describe, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_DIR = join(ROOT, 'node_modules/.cache/ui-002a');

// The mutation harness (tests/mutations/ui-run.mjs) redirects these to broken
// COPIES so it can ask "would this suite notice?" without ever writing to the
// real files. Copies live beside their originals, so `./ui`, `../lib/utils` and
// every other relative import resolves exactly as it does for the real module.
const UI_SRC = process.env.UI002A_UI_PATH || join(ROOT, 'src/components/ui.jsx');
const CARD_SRC = process.env.UI002A_LISTING_CARD_PATH || join(ROOT, 'src/components/ListingCard.jsx');
const UTILS_SRC = process.env.UI002A_UTILS_PATH || join(ROOT, 'src/lib/utils.js');

let React, createRoot, act, UI, ListingCard, utils, dom, container, root;

// ── Harness ─────────────────────────────────────────────────────────────────
before(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const { build } = await import('rolldown');
  await build({
    input: UI_SRC,
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    output: { dir: OUT_DIR, format: 'esm', entryFileNames: 'ui.mjs' },
    logLevel: 'silent',
  });

  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  for (const k of [
    'window', 'document', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent',
    'MouseEvent', 'getComputedStyle', 'requestAnimationFrame',
    'cancelAnimationFrame', 'MessageChannel', 'Element',
  ]) globalThis[k] = dom.window[k];
  // Node 24 exposes `navigator` as a getter-only global, so it needs defineProperty.
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  React = (await import('react')).default;
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  UI = await import(join(OUT_DIR, 'ui.mjs'));

  await build({
    input: CARD_SRC,
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'],
    output: { dir: OUT_DIR, format: 'esm', entryFileNames: 'listing-card.mjs' },
    logLevel: 'silent',
  });
  ListingCard = (await import(join(OUT_DIR, 'listing-card.mjs'))).default;
  utils = await import(UTILS_SRC);
});

after(() => { mock.timers.reset(); });

const h = (...args) => React.createElement(...args);

const mount = async (el) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(el); });
  return {
    rerender: async (next) => { await act(async () => { root.render(next); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
};

// A failing assertion throws before its test's own unmount() runs. Without this
// the leaked Sheet stays in the overlay registry and the NEXT test starts with a
// corrupted scroll lock — one real failure would cascade into several fake ones.
afterEach(async () => {
  if (root) { await act(async () => { root.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  mock.timers.reset();
});

const press = (key, opts = {}) =>
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, ...opts }));

// A real click is mousedown-then-click. The Sheet scrim distinguishes them, so
// tests must too — firing only `click` would not exercise the latch.
const clickSeq = (downTarget, clickTarget = downTarget) => {
  downTarget.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  clickTarget.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
};

// ── Toast ───────────────────────────────────────────────────────────────────
describe('Toast', () => {
  test('auto-dismiss fires exactly once', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const view = await mount(h(UI.Toast, { id: 1, message: 'hi', type: 'success', onDismiss: () => calls++ }));

    await act(async () => { mock.timers.tick(4500); }); // success deadline
    assert.equal(calls, 0, 'dismiss must wait for the exit animation, not fire at the deadline');
    await act(async () => { mock.timers.tick(230); }); // exit animation
    assert.equal(calls, 1);

    // Nothing may fire a second time once the toast has left.
    await act(async () => { mock.timers.tick(60_000); });
    assert.equal(calls, 1, 'timer must not repeat');
    await view.unmount();
    mock.timers.reset();
  });

  test('manual dismiss fires exactly once, even when clicked repeatedly', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const view = await mount(h(UI.Toast, { id: 2, message: 'hi', type: 'success', onDismiss: () => calls++ }));

    const btn = container.querySelector('[aria-label="Dismiss"]');
    assert.ok(btn, 'dismiss control must exist');
    await act(async () => { btn.click(); btn.click(); btn.click(); });
    await act(async () => { mock.timers.tick(230); });
    assert.equal(calls, 1, 'repeated taps must not produce repeated dismissals');

    // The auto-dismiss deadline must not land a second call afterwards.
    await act(async () => { mock.timers.tick(10_000); });
    assert.equal(calls, 1);
    await view.unmount();
    mock.timers.reset();
  });

  test('parent rerenders do not restart the auto-dismiss timer', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    // A NEW onDismiss closure every render — exactly what App.jsx does with
    // `onDismiss={() => dismissToast(t.id)}`. If the timer effect depended on
    // that identity, each rerender would restart the 4.5s clock and a toast on
    // a busy screen would never expire.
    const render = () => h(UI.Toast, { id: 3, message: 'hi', type: 'success', onDismiss: () => calls++ });
    const view = await mount(render());

    for (let elapsed = 0; elapsed < 4500; elapsed += 100) {
      await view.rerender(render());
      await act(async () => { mock.timers.tick(100); });
    }
    await act(async () => { mock.timers.tick(230); });
    assert.equal(calls, 1, 'timer restarted on rerender — the toast would never auto-dismiss');
    await view.unmount();
    mock.timers.reset();
  });

  test('does not fire after unmounting mid-exit-animation', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const view = await mount(h(UI.Toast, { id: 4, message: 'hi', type: 'success', onDismiss: () => calls++ }));
    await act(async () => { container.querySelector('[aria-label="Dismiss"]').click(); });
    await view.unmount();                                  // evicted before the 230ms exit completes
    await act(async () => { mock.timers.tick(5_000); });
    assert.equal(calls, 0, 'exit timer must be cleared on unmount');
    mock.timers.reset();
  });

  test('status/alert semantics match their politeness', async () => {
    // role="alert" already implies assertive; pairing it with aria-live="polite"
    // is self-contradictory and browsers resolve it inconsistently.
    const polite = await mount(h(UI.Toast, { id: 5, message: 'ok', type: 'success', onDismiss() {} }));
    const p = container.querySelector('[role]');
    assert.equal(p.getAttribute('role'), 'status');
    assert.equal(p.getAttribute('aria-live'), 'polite');
    await polite.unmount();

    const urgent = await mount(h(UI.Toast, { id: 6, message: 'bad', type: 'error', onDismiss() {} }));
    const u = container.querySelector('[role]');
    assert.equal(u.getAttribute('role'), 'alert');
    assert.equal(u.getAttribute('aria-live'), 'assertive');
    await urgent.unmount();
  });
});

// ── Animated wrappers ───────────────────────────────────────────────────────
describe('animation wrappers forward props to a real DOM node', () => {
  for (const name of ['FadeIn', 'SlideUp', 'ScaleIn']) {
    test(`${name} attaches handlers and keeps its own animationDelay`, async () => {
      let clicks = 0;
      const view = await mount(
        h(UI[name], { delay: 40, onClick: () => clicks++, 'data-probe': name, style: { color: 'red' } }, 'x')
      );
      const el = container.querySelector('[data-probe]');
      assert.ok(el, `${name} must render a DOM node carrying passed-through attributes`);

      el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      assert.equal(clicks, 1, `${name} dropped its onClick — handlers never reached the DOM`);

      assert.equal(el.style.animationDelay, '40ms', 'a caller style must not clobber the stagger');
      assert.equal(el.style.color, 'red', 'a caller style must still be applied');
      await view.unmount();
    });
  }
});

// ── Sheet ───────────────────────────────────────────────────────────────────
describe('Sheet', () => {
  // Content with a DISABLED first control — the case that silently defeated the
  // old trap, because a disabled button matches `button` but cannot take focus.
  const body = () => [
    h('button', { key: 'a', disabled: true }, 'disabled-first'),
    h('button', { key: 'b', id: 'first' }, 'first'),
    h('input', { key: 'c', id: 'middle' }),
    h('button', { key: 'd', id: 'last' }, 'last'),
  ];

  const openSheet = (props = {}) =>
    h(UI.Sheet, { open: true, onClose() {}, title: 'T', ...props }, body());

  test('focuses the first ENABLED control, skipping disabled ones', async () => {
    const view = await mount(openSheet());
    assert.equal(document.activeElement.id, 'first');
    await view.unmount();
  });

  test('traps Tab and Shift+Tab within the panel', async () => {
    const view = await mount(openSheet());

    document.getElementById('last').focus();
    press('Tab');
    assert.equal(document.activeElement.id, 'first', 'Tab past the last control must wrap to the first');

    document.getElementById('first').focus();
    press('Tab', { shiftKey: true });
    assert.equal(document.activeElement.id, 'last', 'Shift+Tab before the first must wrap to the last');

    // A disabled control must never be a trap boundary.
    assert.notEqual(document.activeElement.textContent, 'disabled-first');
    await view.unmount();
  });

  test('Tab re-enters the panel when focus is not on one of its controls', async () => {
    const view = await mount(openSheet());
    const panel = container.querySelector('[role="dialog"]');

    // Focus parked on the page behind the scrim — where the browser leaves it
    // when it moves on to chrome.
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    outside.focus();
    press('Tab');
    assert.equal(document.activeElement.id, 'first', 'Tab must re-enter at the first control');

    outside.focus();
    press('Tab', { shiftKey: true });
    assert.equal(document.activeElement.id, 'last', 'Shift+Tab must re-enter at the last control');

    // Focus resting on the panel BOX rather than on a control: the open-time
    // fallback leaves it here, and so does a control that unmounts mid-flow.
    // `panel.contains(panel)` is true, so this case is invisible to a plain
    // containment check and Tab would simply do nothing.
    panel.focus();
    press('Tab');
    assert.equal(document.activeElement.id, 'first', 'Tab off the panel box must reach a control');

    outside.remove();
    await view.unmount();
  });

  test('the trap boundary follows content that appears after open', async () => {
    // Sheet content is routinely conditional — a Btn that becomes `loading`, a
    // field revealed by a choice. A focusable list captured at open time goes
    // stale, and the trap then wraps at a control that is no longer the last
    // one, dropping the newest control out of the cycle.
    const withExtra = (extra) =>
      h(UI.Sheet, { open: true, onClose() {}, title: 'T' },
        ...body(), extra ? h('button', { key: 'e', id: 'extra' }, 'extra') : null);

    const view = await mount(withExtra(false));
    await view.rerender(withExtra(true));

    document.getElementById('extra').focus();
    press('Tab');
    assert.equal(document.activeElement.id, 'first',
      'a control added after open must become the trap boundary');
    await view.unmount();
  });

  test('restores focus to the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    assert.equal(document.activeElement.id, 'trigger');

    const view = await mount(openSheet());
    assert.equal(document.activeElement.id, 'first', 'focus must move into the sheet');

    await view.rerender(h(UI.Sheet, { open: false, onClose() {}, title: 'T' }, body()));
    assert.equal(document.activeElement.id, 'trigger', 'focus must return to whatever opened the sheet');

    await view.unmount();
    trigger.remove();
  });

  test('locks body scroll while open and releases it on close', async () => {
    document.body.style.overflow = 'auto';
    const view = await mount(openSheet());
    assert.equal(document.body.style.overflow, 'hidden');

    await view.rerender(h(UI.Sheet, { open: false, onClose() {}, title: 'T' }, body()));
    assert.equal(document.body.style.overflow, 'auto', 'the pre-sheet value must be restored, not cleared');
    await view.unmount();
  });

  test('Escape closes the sheet', async () => {
    let closed = 0;
    const view = await mount(openSheet({ onClose: () => closed++ }));
    press('Escape');
    assert.equal(closed, 1);
    await view.unmount();
  });

  test('Escape closes ONLY the topmost sheet when nested', async () => {
    let outerClosed = 0, innerClosed = 0;
    // The real shape of this: a ConfirmSheet raised from inside another sheet.
    const view = await mount(
      h(UI.Sheet, { open: true, onClose: () => outerClosed++, title: 'outer' },
        h('button', { id: 'outer-btn' }, 'outer'),
        h(UI.Sheet, { open: true, onClose: () => innerClosed++, title: 'inner' },
          h('button', { id: 'inner-btn' }, 'inner'))));

    press('Escape');
    assert.equal(innerClosed, 1, 'the innermost sheet must close');
    assert.equal(outerClosed, 0, 'the sheet underneath must NOT close on the same keystroke');
    await view.unmount();
  });

  test('nested sheets keep the scroll lock until the last one closes', async () => {
    document.body.style.overflow = 'auto';
    const nested = (innerOpen) =>
      h(UI.Sheet, { open: true, onClose() {}, title: 'outer' },
        h('button', { id: 'outer-btn' }, 'outer'),
        innerOpen
          ? h(UI.Sheet, { open: true, onClose() {}, title: 'inner' }, h('button', { id: 'inner-btn' }, 'inner'))
          : null);

    const view = await mount(nested(true));
    assert.equal(document.body.style.overflow, 'hidden');

    await view.rerender(nested(false));       // inner closes, outer still open
    assert.equal(document.body.style.overflow, 'hidden', 'closing a nested sheet must not unlock the page');

    await view.unmount();
    assert.equal(document.body.style.overflow, 'auto', 'the last overlay to leave restores the page');
  });

  test('backdrop click closes the sheet', async () => {
    let closed = 0;
    const view = await mount(openSheet({ onClose: () => closed++ }));
    const scrim = container.firstElementChild;
    clickSeq(scrim);
    assert.equal(closed, 1);
    await view.unmount();
  });

  test('clicking the sheet body does NOT close it', async () => {
    let closed = 0;
    const view = await mount(openSheet({ onClose: () => closed++ }));
    clickSeq(document.getElementById('middle'));
    assert.equal(closed, 0, 'a click inside the panel must never dismiss');
    await view.unmount();
  });

  test('a press that STARTS inside and ends on the backdrop does NOT close', async () => {
    // Text selection and mistimed drags produce exactly this: the click event
    // targets the common ancestor (the scrim) even though the gesture began in
    // the panel. Target-checking alone cannot tell the difference.
    let closed = 0;
    const view = await mount(openSheet({ onClose: () => closed++ }));
    const scrim = container.firstElementChild;
    clickSeq(document.getElementById('middle'), scrim);
    assert.equal(closed, 0, 'a drag out of the sheet must not be read as a backdrop dismissal');
    await view.unmount();
  });

  test('announces itself as a modal dialog with an accessible name', async () => {
    const view = await mount(openSheet());
    const panel = container.querySelector('[role="dialog"]');
    assert.ok(panel, 'the panel must expose role="dialog"');
    assert.equal(panel.getAttribute('aria-modal'), 'true');
    const labelId = panel.getAttribute('aria-labelledby');
    assert.ok(labelId && document.getElementById(labelId)?.textContent === 'T',
      'aria-labelledby must resolve to the visible title');
    await view.unmount();
  });
});

// ── Trust surfaces ──────────────────────────────────────────────────────────
describe('trust labelling', () => {
  // AuthProfileView renders this exact string for a seller who passed operator
  // identity review. Nothing computed from a score may collide with it.
  const VERIFIED_IDENTITY_HE = 'מוכר מאומת';

  test('a score-derived tier never reuses the identity-verification label', () => {
    const trusted = utils.getSellerBadgeLabel('trustedSeller', 'he');
    assert.notEqual(trusted, VERIFIED_IDENTITY_HE,
      'the earned-by-score tier claimed the operator-verified wording');
    assert.ok(!trusted.includes('מאומת'),
      '"מאומת" (verified) must be reserved for is_verified / serial_verified');
  });

  test('no formula-derived badge carries a verification checkmark', () => {
    // A ✓ glyph IS the credential signal — changing only the words would leave
    // the "the platform vouches for this person" reading intact.
    const derived = [
      ...['eliteSeller', 'topSeller', 'trustedSeller', 'newSeller']
        .flatMap((b) => ['he', 'en'].map((l) => utils.getSellerBadgeLabel(b, l))),
      ...['topBuyer', 'trustedBuyer', 'newBuyer']
        .flatMap((b) => ['he', 'en'].map((l) => utils.getBuyerBadgeLabel(b, l))),
      ...[90, 70, 50, 30, 10].flatMap((s) => ['he', 'en'].map((l) => utils.getTrustLevelLabel(s, l))),
    ];
    const offenders = derived.filter((l) => /[✓✔☑]/.test(l));
    assert.deepEqual(offenders, [], 'score-derived labels must not use a checkmark glyph');
  });

  test('Hebrew and English trust tiers stay distinguishable from each other', () => {
    for (const lang of ['he', 'en']) {
      const labels = ['eliteSeller', 'topSeller', 'trustedSeller', 'newSeller']
        .map((b) => utils.getSellerBadgeLabel(b, lang));
      assert.equal(new Set(labels).size, labels.length, `duplicate seller tier label in "${lang}"`);
    }
  });

  test('copy-quality scoring carries no credential glyph at any tier', () => {
    for (const score of [100, 80, 60, 20, 0]) {
      for (const lang of ['he', 'en']) {
        const q = utils.getQualityBadge(score, lang);
        assert.ok(!/[✓✔☑]/.test(`${q.icon}${q.label}`),
          `quality tier at score ${score} renders a checkmark — it reads as verification`);
      }
    }
  });
});

describe('ListingCard (buyer surface)', () => {
  const item = {
    id: 'l1', title: 'Camera', price: 1200, condition: 'used',
    images: ['a.jpg', 'b.jpg'], created_at: new Date().toISOString(),
    quality_score: 95,               // top tier — the one that used to show a ✓
  };
  const props = { item, lang: 'en', t: {}, rtl: false, savedIds: new Set(), heartAnim: null };

  test('shows no copy-quality badge to buyers, even at the highest score', async () => {
    const view = await mount(h(ListingCard, { ...props, toggleSave() {}, viewItem() {} }));
    const text = container.textContent;
    for (const label of ['High Quality', 'איכות גבוהה', 'Fair', 'Improve', 'שפר מודעה']) {
      assert.ok(!text.includes(label),
        `buyer card rendered seller-authoring feedback: "${label}"`);
    }
    await view.unmount();
  });

  test('a low score produces no buyer-visible "Improve" prompt', async () => {
    const view = await mount(
      h(ListingCard, { ...props, item: { ...item, quality_score: 10 }, toggleSave() {}, viewItem() {} }));
    assert.ok(!/Improve|שפר/.test(container.textContent));
    await view.unmount();
  });

  test('still renders the buyer-relevant facts it is responsible for', async () => {
    // Guards against "passing by rendering nothing" — the card must keep
    // working, it just must not grade the seller.
    const view = await mount(h(ListingCard, { ...props, toggleSave() {}, viewItem() {} }));
    assert.match(container.textContent, /Camera/, 'title must render');
    assert.ok(container.querySelector('img, [class*="aspect"]'), 'media area must render');
    await view.unmount();
  });

  test('wires its interactive controls to the props it is given', async () => {
    // The Saved tab passed `onClick` (which this card does not accept) and none
    // of these, so every tap threw on an undefined function.
    let viewed = 0, saved = 0;
    const view = await mount(
      h(ListingCard, { ...props, toggleSave: () => saved++, viewItem: () => viewed++ }));

    container.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(saved, 1, 'the save control must reach toggleSave');
    assert.equal(viewed, 0, 'saving must not also open the listing');
    await view.unmount();
  });
});
