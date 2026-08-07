// ══════════════════════════════════════════════════════════════════════════════
// UI-002A — MUTANT CATALOG for the interaction, focus and CSS contract suites.
//
// Same contract as mutants.mjs (VAL-001), pointed at a different kind of code.
// Each entry breaks ONE invariant that UI-002A exists to hold, and the suite
// named by `target` must FAIL against it. A mutant that SURVIVES is a hole in
// the tests, not a bug in the app.
//
// Why this catalog is worth having HERE in particular: every defect UI-002A
// fixed rendered correctly. The markup was right in all of them and the bug
// lived in focus movement, timer lifetime, event ownership, or a stylesheet
// that quietly emitted no rule. Assertions about that class of behaviour are
// exceptionally easy to write in a way that passes without checking anything —
// so the assertions themselves need checking.
//
// `find` MUST match the target source exactly once; the runner refuses a mutant
// that matches zero or many times, so a refactor fails loudly here instead of
// silently reporting a green score against code it is no longer testing.
//
// A mutant may carry `find`/`replace`, or `edits: [{find, replace}]` when the
// invariant is held by more than one line — a layered defence has to have every
// layer removed before the behaviour actually changes, and a partial mutation
// would survive for the right reason and be indistinguishable from a test gap.
//
// `kills` names the tests expected to catch it — documentation for the reader,
// not something the runner enforces.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Where each mutant is written and which suite judges it.
 *
 * Mutants are written BESIDE their original, never over it. That placement is
 * load-bearing: `./ui`, `../lib/utils`, the Tailwind content globs and the
 * @tailwind directives all resolve relative to the file's own location, so a
 * copy in a temp dir would fail for reasons that have nothing to do with the
 * mutation and every mutant would "die" spuriously.
 */
export const TARGETS = {
  ui: {
    src: 'src/components/ui.jsx',
    mutant: 'src/components/ui.__mutant__.jsx',
    env: 'UI002A_UI_PATH',
    suite: 'tests/ui-interaction.test.mjs',
  },
  card: {
    src: 'src/components/ListingCard.jsx',
    mutant: 'src/components/ListingCard.__mutant__.jsx',
    env: 'UI002A_LISTING_CARD_PATH',
    suite: 'tests/ui-interaction.test.mjs',
  },
  utils: {
    src: 'src/lib/utils.js',
    mutant: 'src/lib/utils.__mutant__.js',
    env: 'UI002A_UTILS_PATH',
    suite: 'tests/ui-interaction.test.mjs',
  },
  css: {
    src: 'src/index.css',
    mutant: 'src/index.__mutant__.css',
    env: 'UI002A_CSS_PATH',
    suite: 'tests/ui-css-contract.test.mjs',
  },
  tailwind: {
    src: 'tailwind.config.js',
    mutant: 'tailwind.__mutant__.config.js',
    env: 'UI002A_TW_CONFIG',
    suite: 'tests/ui-css-contract.test.mjs',
  },
  html: {
    src: 'index.html',
    mutant: 'index.__mutant__.html',
    env: 'UI002A_INDEX_HTML',
    suite: 'tests/ui-css-contract.test.mjs',
  },
};

export const UI_MUTANTS = [
  // ── Overlay ownership ─────────────────────────────────────────────────────
  // Two sheets open at once is the delete-listing flow, not a corner case.
  {
    id: 'U01-EVERY-OVERLAY-IS-TOP',
    target: 'ui',
    invariant: 'Only the innermost overlay reacts to Escape.',
    kills: ['Escape closes ONLY the topmost sheet when nested'],
    find: '  return top ? top === token : false;',
    replace: '  return true;',
  },
  {
    id: 'U02-TOP-BY-REGISTRATION-ORDER',
    target: 'ui',
    invariant: 'Topmost is decided by document order, not by effect registration order.',
    // React runs child effects before parent effects, so "last registered" is
    // the sheet UNDERNEATH — the exact inversion of what the user sees.
    kills: ['Escape closes ONLY the topmost sheet when nested'],
    find: '  let top = null;\n  for (const o of openOverlays) {',
    replace: '  return openOverlays[openOverlays.length - 1] === token;\n  let top = null;\n  for (const o of openOverlays) {',
  },

  // ── Scroll lock ───────────────────────────────────────────────────────────
  {
    id: 'U03-SCROLL-UNLOCK-ON-FIRST-CLOSE',
    target: 'ui',
    invariant: 'The page stays locked until the LAST overlay closes.',
    kills: ['nested sheets keep the scroll lock until the last one closes'],
    find: '  if (openOverlays.length === 0 && scrollLockPrevOverflow !== null) {',
    replace: '  if (scrollLockPrevOverflow !== null) {',
  },
  {
    id: 'U04-SCROLL-PREV-OVERWRITTEN',
    target: 'ui',
    invariant: 'The pre-overlay overflow is captured once, by the FIRST overlay only.',
    // Otherwise a nested sheet records `hidden` as the page's "previous" value
    // and restores the app to permanently unscrollable.
    kills: ['nested sheets keep the scroll lock until the last one closes'],
    find: '  if (openOverlays.length === 1) {\n    scrollLockPrevOverflow = document.body.style.overflow;',
    replace: '  if (true) {\n    scrollLockPrevOverflow = document.body.style.overflow;',
  },
  {
    id: 'U05-SCROLL-CLEARED-NOT-RESTORED',
    target: 'ui',
    invariant: 'Closing restores the previous overflow value rather than clearing it.',
    kills: ['locks body scroll while open and releases it on close'],
    find: '    document.body.style.overflow = scrollLockPrevOverflow;',
    replace: "    document.body.style.overflow = '';",
  },

  // ── Focus trap ────────────────────────────────────────────────────────────
  {
    id: 'U06-FOCUSABLE-INCLUDES-DISABLED',
    target: 'ui',
    invariant: 'A disabled control is never treated as focusable.',
    // A disabled button matches a bare `button` selector but cannot take focus,
    // so `.focus()` no-ops, focus stays on <body>, and the trap silently stops
    // trapping without any visible symptom.
    kills: ['focuses the first ENABLED control, skipping disabled ones'],
    find: "  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])';",
    replace: "  'button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])';",
  },
  {
    id: 'U07-FOCUSABLES-CACHED-AT-OPEN',
    target: 'ui',
    invariant: 'The focusable list is recomputed per keystroke, so conditional content stays inside the trap.',
    kills: ['the trap boundary follows content that appears after open'],
    find:
      '    const focusables = () =>\n' +
      '      Array.from(panel?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []).filter(\n' +
      "        (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden=\"true\"], [inert]')\n" +
      '      );',
    replace:
      '    const cachedFocusables = Array.from(panel?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []).filter(\n' +
      "      (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden=\"true\"], [inert]')\n" +
      '    );\n' +
      '    const focusables = () => cachedFocusables;',
  },
  {
    id: 'U08-NO-TAB-WRAP-FORWARD',
    target: 'ui',
    invariant: 'Tab past the last control wraps to the first.',
    kills: ['traps Tab and Shift+Tab within the panel'],
    find: '      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus(); }',
    replace: '      else if (false) { e.preventDefault(); firstEl.focus(); }',
  },
  {
    id: 'U09-NO-TAB-WRAP-BACKWARD',
    target: 'ui',
    invariant: 'Shift+Tab before the first control wraps to the last.',
    kills: ['traps Tab and Shift+Tab within the panel'],
    find: '      if (e.shiftKey && active === firstEl) { e.preventDefault(); lastEl.focus(); }',
    replace: '      if (false) { e.preventDefault(); lastEl.focus(); }',
  },
  {
    id: 'U10-NO-REENTRY-FROM-OUTSIDE',
    target: 'ui',
    invariant: 'Tab pulls focus back in when it is resting outside the panel or on the panel box.',
    kills: ['Tab re-enters the panel when focus is not on one of its controls'],
    find: '      if (!panel?.contains(active) || active === panel) {',
    replace: '      if (false) {',
  },
  {
    id: 'U11-REENTRY-MISSES-THE-PANEL-BOX',
    target: 'ui',
    invariant: 'Focus resting ON the panel counts as outside the trap — `contains` says otherwise.',
    kills: ['Tab re-enters the panel when focus is not on one of its controls'],
    find: '      if (!panel?.contains(active) || active === panel) {',
    replace: '      if (!panel?.contains(active)) {',
  },
  {
    id: 'U12-NO-FOCUS-RESTORE',
    target: 'ui',
    invariant: 'Closing returns focus to whatever opened the sheet.',
    kills: ['restores focus to the trigger on close'],
    find: '      if (focusIsOurs && trigger?.isConnected) trigger.focus?.();',
    replace: '      if (false && trigger?.isConnected) trigger.focus?.();',
  },

  // ── Dismissal ─────────────────────────────────────────────────────────────
  {
    id: 'U13-NO-MOUSEDOWN-LATCH',
    target: 'ui',
    invariant: 'A gesture that began inside the panel never dismisses it, even when the click lands on the scrim.',
    kills: ['a press that STARTS inside and ends on the backdrop does NOT close'],
    find: '      onMouseDown={(e) => { pressStartedOnScrim.current = e.target === e.currentTarget; }}',
    replace: '      onMouseDown={() => { pressStartedOnScrim.current = true; }}',
  },
  {
    id: 'U14-BODY-CLICK-DISMISSES',
    target: 'ui',
    // Both layers have to go: either one alone still rejects an inside click,
    // so a single-line mutation would survive because the code is CORRECT, and
    // that is indistinguishable in the report from a genuine test gap.
    invariant: 'A click inside the panel never dismisses it — guarded by the scrim target check AND the panel stopPropagation.',
    kills: ['clicking the sheet body does NOT close it'],
    edits: [
      {
        find: '        const fromScrim = e.target === e.currentTarget && pressStartedOnScrim.current;',
        replace: '        const fromScrim = true;',
      },
      {
        find: '      <SlideUp className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>',
        replace: '      <SlideUp className="w-full max-w-md">',
      },
    ],
  },

  // ── Dialog semantics ──────────────────────────────────────────────────────
  {
    id: 'U15-NOT-MODAL',
    target: 'ui',
    invariant: 'The panel announces itself as a modal dialog.',
    kills: ['announces itself as a modal dialog with an accessible name'],
    find: '          aria-modal="true"',
    replace: '          aria-modal="false"',
  },
  {
    id: 'U16-NO-ACCESSIBLE-NAME',
    target: 'ui',
    invariant: 'The dialog is named by its visible title.',
    kills: ['announces itself as a modal dialog with an accessible name'],
    find: '          aria-labelledby={labelledBy || (title ? headingId : undefined)}',
    replace: '          aria-labelledby={undefined}',
  },

  // ── Toast lifetime ────────────────────────────────────────────────────────
  {
    id: 'U17-TIMER-RESTARTS-ON-RERENDER',
    target: 'ui',
    invariant: 'The auto-dismiss deadline survives parent rerenders.',
    // The host renders `onDismiss={() => dismissToast(t.id)}` — a new closure
    // every render — so a dependency on it means a toast on a busy screen never
    // expires at all.
    kills: ['parent rerenders do not restart the auto-dismiss timer'],
    find: '  }, [cfg.ms, handleDismiss]);',
    replace: '  }, [cfg.ms, handleDismiss, onDismiss]);',
  },
  {
    id: 'U18-DISMISS-NOT-IDEMPOTENT',
    target: 'ui',
    invariant: 'Dismissal fires exactly once however many times it is triggered.',
    kills: ['manual dismiss fires exactly once, even when clicked repeatedly'],
    find: '    if (dismissedRef.current) return;\n    dismissedRef.current = true;',
    replace: '    dismissedRef.current = true;',
  },
  {
    id: 'U19-EXIT-TIMER-OUTLIVES-UNMOUNT',
    target: 'ui',
    invariant: 'The exit timer is cleared on unmount, so an evicted toast cannot dismiss its replacement.',
    kills: ['does not fire after unmounting mid-exit-animation'],
    find: '  useEffect(() => () => clearTimeout(exitTimerRef.current), []);',
    replace: '  useEffect(() => () => {}, []);',
  },
  {
    id: 'U20-POLITENESS-CONTRADICTS-ROLE',
    target: 'ui',
    invariant: 'role and aria-live agree — alert is assertive, status is polite.',
    kills: ['status/alert semantics match their politeness'],
    find: "      aria-live={type === 'critical' || type === 'error' ? 'assertive' : 'polite'}",
    replace: '      aria-live="polite"',
  },

  // ── Animated wrappers ─────────────────────────────────────────────────────
  {
    id: 'U21-SCALEIN-SWALLOWS-PROPS',
    target: 'ui',
    invariant: 'Every animated wrapper forwards its props to a real DOM node.',
    // The original defect: JSX reads as if onClick is attached, React reports
    // no error, and the handler simply never runs.
    kills: ['ScaleIn attaches handlers and keeps its own animationDelay'],
    find: "export const ScaleIn = ({ children, delay = 0, className = '', style, ...p }) => (\n" +
      '  <div className={`animate-scaleIn ${className}`} style={{ animationDelay: `${delay}ms`, ...style }} {...p}>{children}</div>\n' +
      ');',
    replace: "export const ScaleIn = ({ children, delay = 0, className = '' }) => (\n" +
      '  <div className={`animate-scaleIn ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>\n' +
      ');',
  },
  {
    id: 'U22-CALLER-STYLE-REPLACES-STAGGER',
    target: 'ui',
    invariant: 'A caller-supplied style merges with the stagger instead of replacing it.',
    // Leaving `style` inside `...p` is the shape that loses animationDelay
    // entirely, because the spread lands after the style prop.
    kills: ['FadeIn attaches handlers and keeps its own animationDelay'],
    find: "export const FadeIn = ({ children, delay = 0, className = '', style, ...p }) => (\n" +
      '  <div className={`animate-fadeIn ${className}`} style={{ animationDelay: `${delay}ms`, ...style }} {...p}>{children}</div>',
    replace: "export const FadeIn = ({ children, delay = 0, className = '', ...p }) => (\n" +
      '  <div className={`animate-fadeIn ${className}`} style={{ animationDelay: `${delay}ms` }} {...p}>{children}</div>',
  },

  // ── Trust surfaces ────────────────────────────────────────────────────────
  {
    id: 'U23-BUYER-CARD-GRADES-THE-SELLER',
    target: 'card',
    invariant: 'The buyer card carries no copy-quality feedback at any score.',
    kills: ['shows no copy-quality badge to buyers, even at the highest score', 'a low score produces no buyer-visible "Improve" prompt'],
    edits: [
      {
        find: "import { formatPrice, timeAgo, getConditionLabel, getConditionColorAlpha } from '../lib/utils';",
        replace: "import { formatPrice, timeAgo, getConditionLabel, getConditionColorAlpha, getQualityBadge } from '../lib/utils';",
      },
      {
        find: '        <div className="p-4 space-y-2">',
        replace: '        <div className="p-4 space-y-2">\n          <span>{getQualityBadge(item.quality_score ?? 0, lang).label}</span>',
      },
    ],
  },
  {
    id: 'U24-SCORE-TIER-CLAIMS-VERIFICATION',
    target: 'utils',
    invariant: 'A tier earned by score never reuses the operator identity-verification wording or its checkmark.',
    kills: ['a score-derived tier never reuses the identity-verification label', 'no formula-derived badge carries a verification checkmark'],
    find: "    trustedSeller: lang === 'he' ? 'מוכר מהימן' : 'Trusted',",
    replace: "    trustedSeller: lang === 'he' ? 'מוכר מאומת' : '✓ Trusted',",
  },
  {
    id: 'U25-BUYER-TIER-CARRIES-CHECKMARK',
    target: 'utils',
    invariant: 'A buyer tier reached from purchase count alone carries no credential glyph.',
    kills: ['no formula-derived badge carries a verification checkmark'],
    find: "    trustedBuyer: lang === 'he' ? 'קונה מהימן'      : 'Trusted Buyer',",
    replace: "    trustedBuyer: lang === 'he' ? '✓ קונה מהימן'      : '✓ Trusted Buyer',",
  },
  {
    id: 'U26-COPY-QUALITY-CARRIES-CHECKMARK',
    target: 'utils',
    invariant: 'Copy-quality scoring never renders a checkmark — it grades a description, not a person.',
    kills: ['copy-quality scoring carries no credential glyph at any tier'],
    find: "  if (score >= 75) return { label: lang === 'he' ? 'איכות גבוהה' : 'High Quality', color: 'green', icon: '' };",
    replace: "  if (score >= 75) return { label: lang === 'he' ? 'איכות גבוהה' : 'High Quality', color: 'green', icon: '✓' };",
  },
  {
    id: 'U27-TIERS-COLLIDE',
    target: 'utils',
    invariant: 'Seller tiers are distinguishable from one another in both languages.',
    kills: ['Hebrew and English trust tiers stay distinguishable from each other'],
    find: "    newSeller: lang === 'he' ? '🆕 מוכר חדש' : '🆕 New Seller',",
    replace: "    newSeller: lang === 'he' ? 'מוכר מהימן' : 'Trusted',",
  },

  // ── Focus visibility (compiled CSS) ───────────────────────────────────────
  {
    id: 'U28-FOCUS-RING-RESHAPES-CONTROL',
    target: 'css',
    invariant: 'Focus styling sets no border-radius — it would reshape the focused control.',
    kills: ['never mutates a component radius'],
    find: ':focus-visible {\n  outline: 2px solid rgb(var(--gw-accent));',
    replace: ':focus-visible {\n  border-radius: 4px;\n  outline: 2px solid rgb(var(--gw-accent));',
  },
  {
    id: 'U29-FOCUS-RING-TOO-FAINT',
    target: 'css',
    invariant: 'The focus ring is a real 2px solid outline.',
    kills: ['draws a visible ring'],
    find: '  outline: 2px solid rgb(var(--gw-accent));\n  outline-offset: 2px;',
    replace: '  outline: 1px dotted rgb(var(--gw-accent));\n  outline-offset: 2px;',
  },
  {
    id: 'U30-NO-RING-INVERSION-ON-ACCENT',
    target: 'css',
    invariant: 'Accent-filled controls invert the ring, so it cannot vanish into its own fill.',
    kills: ['inverts on accent fills so the ring cannot vanish'],
    find: ".bg-action-primary:focus-visible,\n.bg-accent:focus-visible,\n[aria-pressed='true'].bg-action-primary:focus-visible {",
    replace: '.bg-accent:focus-visible {',
  },
  {
    id: 'U31-FOCUS-SUPPRESSION-BACK-IN-BUNDLE',
    target: 'css',
    invariant: 'No focus-suppressing utility reaches the shipped stylesheet.',
    // `outline-none` beats `:focus-visible` at (0,2,0) and erases the ring
    // wherever it lands, so its mere presence in the bundle is the defect.
    kills: ['no utility re-suppresses the ring anywhere in the bundle'],
    find: '.state-layer { position: relative; }',
    replace: '.state-layer { position: relative; }\n.outline-none { outline: 2px solid transparent; outline-offset: 2px; }',
  },

  // ── Reduced motion ────────────────────────────────────────────────────────
  {
    id: 'U32-INFINITE-LOOPS-SURVIVE',
    target: 'css',
    invariant: 'Infinite decorative animations are stopped, not merely shortened.',
    // A 0.01ms animation set to `infinite` respawns forever and pins the CPU —
    // quietly worse than the animation it replaced.
    kills: ['neutralises duration AND infinite iteration, universally'],
    find: '    animation-iteration-count: 1 !important;\n',
    replace: '',
  },
  {
    id: 'U33-REDUCED-MOTION-NOT-UNIVERSAL',
    target: 'css',
    invariant: 'The reduced-motion rule is universal, so it reaches component-level <style> blocks.',
    kills: ['neutralises duration AND infinite iteration, universally', 'pseudo-elements are covered'],
    find: '  *,\n  *::before,\n  *::after {',
    replace: '  .animate-fadeIn,\n  .animate-slideUp {',
  },
  {
    id: 'U34-PSEUDO-ELEMENTS-UNCOVERED',
    target: 'css',
    invariant: 'The ::before/::after state layers are covered by reduced motion too.',
    kills: ['pseudo-elements are covered'],
    find: '  *,\n  *::before,\n  *::after {\n    animation-duration',
    replace: '  * {\n    animation-duration',
  },
  {
    id: 'U35-TRANSITIONS-NOT-NEUTRALISED',
    target: 'css',
    invariant: 'Transitions are neutralised alongside animations.',
    kills: ['neutralises duration AND infinite iteration, universally'],
    find: '    transition-duration: 0.01ms !important;\n',
    replace: '',
  },

  // ── iOS input zoom ────────────────────────────────────────────────────────
  {
    id: 'U36-BASE-SIZE-BELOW-ZOOM-THRESHOLD',
    target: 'css',
    invariant: 'The document base size is at or above 16px, below which iOS Safari auto-zooms on focus.',
    kills: ['the document base size is at or above the 16px zoom threshold'],
    find: 'body { font-size: 16px; }',
    replace: 'body { font-size: 14px; }',
  },
  {
    id: 'U37-PINCH-ZOOM-DISABLED',
    target: 'html',
    invariant: 'Pinch-zoom stays enabled (WCAG 1.4.4).',
    kills: ['pinch-zoom is not disabled in the document'],
    find: '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
    replace: '<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover" />',
  },
  {
    id: 'U38-MAX-SCALE-PINS-ZOOM',
    target: 'html',
    invariant: 'maximum-scale=1 disables zoom on iOS and is equally a 1.4.4 failure.',
    kills: ['pinch-zoom is not disabled in the document'],
    find: '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
    replace: '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />',
  },

  // ── The alpha ladder ──────────────────────────────────────────────────────
  {
    id: 'U39-TINT-LADDER-OFF-SCALE',
    target: 'tailwind',
    invariant: 'The /12 badge tint is declared on theme.opacity, or Tailwind emits no rule at all.',
    // This one shipped: the badge system was specified as "semantic text over
    // its own 12% tint", a contrast script asserted twelve passing ratios for
    // that composite, and the tint was never rendered. Green tests, wrong
    // pixels — which is exactly what this suite exists to make impossible.
    kills: ['emits the badge tint recipe rather than silently dropping it'],
    find: "        12: '0.12',\n",
    replace: '',
  },
  {
    id: 'U40-TOKEN-IS-A-COMPLETE-COLOUR',
    target: 'tailwind',
    invariant: 'Colour tokens compile to rgb(var(--x) / <alpha>), so opacity modifiers can apply.',
    kills: ['tokens are channel triplets so opacity modifiers can apply at all'],
    find: "        accent:             'rgb(var(--gw-accent) / <alpha-value>)',",
    replace: "        accent:             'var(--color-primary)',",
  },
];

export default UI_MUTANTS;
