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
  // UI-002B. The linter is the only thing preventing a slow return to 340
  // literals, so it gets the same treatment as the code it guards.
  lint: {
    src: 'scripts/design-lint.mjs',
    mutant: 'scripts/design-lint.__mutant__.mjs',
    env: 'UI002B_LINT_PATH',
    suite: 'tests/design-lint.test.mjs',
  },
  // ── UI-003 Wave 0 (trust copy) ──
  // The app performs no authenticity verification of any kind, so every badge
  // it shows is a model reading or a seller assertion. These three targets are
  // where a credential can creep back in: the render sites, the copy table, and
  // the buyer-facing chip. All three are judged by the same suite, because the
  // invariant spans them — an honest string under a brand-accent colour, or an
  // English fix with the Hebrew left claiming 'מאומת', is still the defect.
  results: {
    src: 'src/views/CameraResultsView.jsx',
    mutant: 'src/views/CameraResultsView.__mutant__.jsx',
    env: 'UI003_RESULTS_PATH',
    suite: 'tests/trust-copy.test.mjs',
  },
  translations: {
    src: 'src/lib/translations.js',
    mutant: 'src/lib/translations.__mutant__.js',
    env: 'UI003_TRANSLATIONS_PATH',
    suite: 'tests/trust-copy.test.mjs',
  },
  detail: {
    src: 'src/views/BrowseDetailView.jsx',
    mutant: 'src/views/BrowseDetailView.__mutant__.jsx',
    env: 'UI003_DETAIL_PATH',
    suite: 'tests/trust-copy.test.mjs',
  },
  // The two writers of `valuations`. They upsert the SAME row id, so a
  // divergence between them is decided by whichever write lands first. The
  // suite reads these as TEXT and evaluates the row literal, so a mutant copy
  // needs no import resolution — see tests/helpers/extract-literal.mjs.
  analyze: {
    src: 'api/analyze.js',
    mutant: 'api/analyze.__mutant__.js',
    env: 'UI003_ANALYZE_PATH',
    suite: 'tests/persistence-rows.test.mjs',
  },
  context: {
    src: 'src/contexts/AppContext.jsx',
    mutant: 'src/contexts/AppContext.__mutant__.jsx',
    env: 'UI003_CONTEXT_PATH',
    suite: 'tests/persistence-rows.test.mjs',
  },

  // UI-003 Wave 0 — the GW-005A observations sink. Same three source files can
  // be mutated against a DIFFERENT suite, so each needs its own target entry:
  // the runner resolves the suite from TARGETS[m.target], not from the mutant.
  // Distinct mutant filenames keep the sweep unambiguous when both a
  // persistence mutant and an observation mutant name AppContext.jsx.
  contextObs: {
    src: 'src/contexts/AppContext.jsx',
    mutant: 'src/contexts/AppContext.__obsmutant__.jsx',
    env: 'UI003_CONTEXT_PATH',
    suite: 'tests/observation-payloads.test.mjs',
  },
  // utils is IMPORTED by the suite rather than text-extracted, so this copy must
  // stay beside the original — `./translations.js` resolves from its directory.
  utilsObs: {
    src: 'src/lib/utils.js',
    mutant: 'src/lib/utils.__obsmutant__.js',
    env: 'UI003_UTILS_PATH',
    suite: 'tests/observation-payloads.test.mjs',
  },
  camera: {
    src: 'src/views/CameraResultsView.jsx',
    mutant: 'src/views/CameraResultsView.__obsmutant__.jsx',
    env: 'UI003_CAMERA_PATH',
    suite: 'tests/observation-payloads.test.mjs',
  },
  // Gap B. Two more source/suite pairings: the new_retail CONSTRUCTORS live in
  // api/analyze.js but are judged by the guard suite (PB-13), and the client
  // mirror of positivePriceOrNull is judged by the persistence-row suite.
  analyzeGuard: {
    src: 'api/analyze.js',
    mutant: 'api/analyze.__gmutant__.js',
    env: 'UI003_ANALYZE_PATH',
    suite: 'tests/valuation-guard.test.mjs',
  },
  utilsPersist: {
    src: 'src/lib/utils.js',
    mutant: 'src/lib/utils.__pmutant__.js',
    env: 'UI003_UTILS_PATH',
    suite: 'tests/persistence-rows.test.mjs',
  },
  observations: {
    src: 'src/lib/observations.js',
    mutant: 'src/lib/observations.__mutant__.js',
    env: 'UI003_OBS_PATH',
    suite: 'tests/observation-payloads.test.mjs',
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

  // ══════════════════════════════════════════════════════════════════════════
  // UI-002B — design-system foundation
  // ══════════════════════════════════════════════════════════════════════════

  // ── IconButton ────────────────────────────────────────────────────────────
  {
    id: 'U41-ICON-BUTTON-UNNAMED',
    target: 'ui',
    invariant: 'An icon-only control always carries an accessible name.',
    // Without a name it is announced as just "button" — the defect is invisible
    // on screen, which is exactly why it needs a test rather than a review.
    kills: ['the icon-only control carries an accessible name'],
    find: '      aria-label={label}',
    replace: '      title={label}',
  },
  {
    id: 'U42-ICON-BUTTON-FAKE-TOGGLE',
    target: 'ui',
    invariant: 'aria-pressed appears only on controls that are genuinely toggles.',
    kills: ['announces a toggle state only when it is actually a toggle'],
    find: "      aria-pressed={typeof selected === 'boolean' ? selected : undefined}",
    replace: '      aria-pressed={Boolean(selected)}',
  },
  {
    id: 'U43-TOUCH-TARGET-COLLAPSES',
    target: 'ui',
    invariant: 'The 44px minimum target is expanded around the glyph, not painted on it.',
    kills: ['clears the 44px minimum target without growing the glyph'],
    find: '    className={`relative inline-flex items-center justify-center min-w-tap min-h-tap ${className}`}',
    replace: '    className={`relative inline-flex items-center justify-center ${className}`}',
  },
  {
    id: 'U44-ICON-BUTTON-DISABLED-IS-COSMETIC',
    target: 'ui',
    invariant: 'A disabled icon button is disabled in the DOM, not merely dimmed.',
    kills: ['disabled reaches the DOM, not just the opacity'],
    find: "      disabled={disabled}\n      aria-disabled={softDisabled ? true : undefined}\n      onClick={softDisabled ? (e) => e.preventDefault() : onClick}",
    replace: '      onClick={onClick}',
  },

  // ── TextArea ──────────────────────────────────────────────────────────────
  {
    id: 'U45-TEXTAREA-BELOW-ZOOM-FLOOR',
    target: 'ui',
    invariant: 'Multi-line controls hold the 16px floor that stops iOS zooming on focus.',
    kills: ['holds the 16px floor that stops iOS zooming on focus'],
    find: "          'w-full px-4 py-3 rounded-control text-base resize-none',",
    replace: "          'w-full px-4 py-3 rounded-control text-sm resize-none',",
  },
  {
    id: 'U46-TEXTAREA-ERROR-NOT-ANNOUNCED',
    target: 'ui',
    invariant: 'A field error is referenced by aria-describedby, not merely rendered beside the field.',
    // Narrowed: it used to strip aria-describedby wholesale, which also broke
    // the counter and overlapped U47, so neither mutant isolated its own claim.
    // This drops ONLY the error id.
    kills: ['an error is announced and marks the field invalid'],
    find: "    error ? `${fieldId}-err` : null,",
    replace: '    null,',
  },
  {
    id: 'U57-TEXTAREA-HINT-LOST-ON-ERROR',
    target: 'ui',
    invariant: 'The hint survives an error — format guidance must not vanish at the moment the format was wrong.',
    kills: ['the hint survives an error — guidance must not vanish when it is needed most'],
    find: "    hint ? `${fieldId}-hint` : null,",
    replace: '    null,',
  },
  {
    id: 'U58-TEXTAREA-NO-REF',
    target: 'ui',
    invariant: 'TextArea forwards a ref, or the chat composer can never adopt it.',
    kills: ['forwards a ref to the real control'],
    find: '        ref={ref}\n        id={fieldId}',
    replace: '        id={fieldId}',
  },
  {
    id: 'U59-TEXTAREA-FORCES-UI-DIRECTION',
    target: 'ui',
    invariant: 'Direction is resolved from content, not forced by the UI language.',
    kills: ['direction is resolved from content, not forced by the UI language'],
    find: "        dir={dir ?? (rtl === undefined ? 'auto' : rtl ? 'rtl' : 'ltr')}",
    replace: "        dir={rtl ? 'rtl' : 'ltr'}",
  },
  {
    id: 'U60-HITAREA-SUBMITS-THE-FORM',
    target: 'ui',
    invariant: 'A HitArea button never defaults to type="submit".',
    // One latent bug became systemic the moment IconButton was built on it.
    kills: ['never defaults to a submit button'],
    find: "    {...(As === 'button' ? { type: 'button' } : null)}",
    replace: '    {...null}',
  },
  {
    id: 'U61-SOFT-DISABLED-BECOMES-INERT',
    target: 'ui',
    invariant: 'A softDisabled control stays focusable so the user can discover why it is unavailable.',
    kills: ['softDisabled stays focusable and announces itself, unlike native disabled'],
    find: '      disabled={disabled}\n      aria-disabled={softDisabled ? true : undefined}',
    replace: '      disabled={off}',
  },
  {
    id: 'U62-SECTION-HARDCODES-H2',
    target: 'ui',
    invariant: 'Heading level is explicit, so nested Sections produce a real document outline.',
    kills: ['heading level is explicit, so nested sections produce a real outline'],
    find: '  const Heading = `h${Math.min(Math.max(level, 1), 6)}`;',
    replace: "  const Heading = 'h2';",
  },
  {
    id: 'U63-DEGRADE-RULE-LEAKS-LANDMARKS',
    target: 'ui',
    invariant: 'Every landmark tag degrades when untitled — not just <section>.',
    kills: ['the degrade rule covers every landmark tag, not just <section>'],
    find: "  const Tag = titled || !LANDMARK_TAGS.has(As) ? As : 'div';",
    replace: "  const Tag = titled || As !== 'section' ? As : 'div';",
  },
  {
    id: 'U47-TEXTAREA-COUNT-SILENT',
    target: 'ui',
    invariant: 'A character cap the user can see is also a cap a screen reader can reach.',
    kills: ['the character cap is discoverable rather than discovered by losing text'],
    find: '    showingCount ? countId : null,',
    replace: '    null,',
  },

  // ── Stack ─────────────────────────────────────────────────────────────────
  {
    id: 'U48-STACK-INTERPOLATED-CLASS',
    target: 'ui',
    suite: 'lint',
    expectRule: 'interpolated-class',
    invariant: 'Dynamic utilities come from a lookup table, because Tailwind cannot see an interpolated class.',
    // This one SURVIVED on its first run and is the reason the `interpolated-class`
    // lint rule exists. Both forms produce the SAME runtime className, so the
    // rendered DOM is byte-identical and every jsdom assertion passes; what
    // differs is build time, where Tailwind's text scanner never sees the
    // completed name and emits no rule. A DOM test cannot observe that, so the
    // invariant is enforced by source inspection instead — note `suite: 'lint'`,
    // which judges this mutant with the linter rather than the interaction suite.
    kills: ['interpolated-class is enforced, not merely declared'],
    find: "      align ? STACK_ALIGN[align] : '',\n      justify ? STACK_JUSTIFY[justify] : '',",
    replace: "      align ? `items-${align}` : '',\n      justify ? `justify-${justify}` : '',",
  },
  {
    id: 'U49-STACK-GAP-FALLS-OFF-SCALE',
    target: 'ui',
    invariant: 'An unrecognised gap falls back onto the closed scale rather than emitting no spacing.',
    kills: ['an unrecognised gap falls back to the scale rather than emitting nothing'],
    find: '      STACK_GAP[gap] ?? STACK_GAP.stack,',
    replace: '      STACK_GAP[gap],',
  },

  // ── Section ───────────────────────────────────────────────────────────────
  {
    id: 'U50-SECTION-UNNAMED-LANDMARK',
    target: 'ui',
    invariant: 'An untitled Section contributes no unnamed landmark to the rotor.',
    kills: ['an untitled Section adds no unnamed landmark'],
    find: "  const Tag = titled || !LANDMARK_TAGS.has(As) ? As : 'div';",
    replace: '  const Tag = As;',
  },
  {
    id: 'U51-SECTION-NOT-NAMED-BY-ITS-HEADING',
    target: 'ui',
    invariant: 'A titled Section is named by its own visible heading.',
    kills: ['is a landmark named by its own visible heading'],
    find: "      {...(titled ? { 'aria-labelledby': headingId } : null)}",
    replace: '      {...null}',
  },
  {
    id: 'U52-SECTION-DRAWS-A-BOX',
    target: 'ui',
    invariant: 'Section is layout-only — a section that paints its own container turns a screen into a dashboard.',
    kills: ['draws no box of its own'],
    find: '      className={`space-y-stack ${className}`}',
    replace: '      className={`space-y-stack bg-surface border border-subtle rounded-container p-4 ${className}`}',
  },

  // ── The ratchet ───────────────────────────────────────────────────────────
  // If these survive, every budget in the ledger is decorative.
  {
    id: 'U53-BUDGET-RATCHET-ACCEPTS-A-RAISE',
    target: 'lint',
    invariant: '--update refuses to raise a budget; a regression cannot be laundered into the ledger.',
    kills: ['REFUSES to raise a budget, and writes nothing'],
    find: '  const over = Object.entries(counts).filter(([id, n]) => n > BUDGET[id]);',
    replace: '  const over = [];',
  },
  {
    id: 'U54-REFUSAL-STILL-WRITES',
    target: 'lint',
    invariant: 'A refused update writes nothing at all — a partial write is a silent raise.',
    kills: ['REFUSES to raise a budget, and writes nothing'],
    // Models the defect precisely: the refusal is printed and the exit code is
    // still 1, but a budget is raised on the way out. Only the "wrote nothing"
    // half of the test can see this — checking the exit code alone would pass.
    find: '    process.exit(1);\n  }\n\n  const lowered',
    replace:
      "    writeFileSync(SELF, readFileSync(SELF, 'utf8').replace(/'glassmorphism': \\d+/, \"'glassmorphism': 999\"));\n" +
      '    process.exit(1);\n  }\n\n  const lowered',
  },
  {
    id: 'U55-A-RULE-CAN-LOSE-ITS-BUDGET',
    target: 'lint',
    invariant: 'Every rule has a budget entry — a rule without one compares against undefined and can never fail.',
    kills: ['every rule has a budget and every budget has a rule'],
    // Pinned to a HARD ZERO, not to a migration budget. It used to name
    // `'glassmorphism': 67,` and went MALFORMED the first time UI-003 ratcheted
    // that number down — the mutant then reported a refactor it had no opinion
    // about, in a file whose whole job is to notice real refactors. Every
    // decoration budget is a moving target for the duration of UI-003; a hard
    // zero is not. `interpolated-class` is deliberately one of the two hard
    // zeros NOT covered by the "hard zeros are still zero" test, so deleting it
    // fails the completeness assertion this mutant is actually aimed at and
    // nothing else.
    find: "  'interpolated-class': 0,\n",
    replace: '',
  },
  {
    id: 'U64-LEDGER-KEY-ORPHANED',
    target: 'lint',
    invariant: 'A budget entry with no matching rule is caught — the ledger is a set, not a wish list.',
    // U55 removes a budget, which ALSO breaks that rule's fire test, so the
    // ledger-completeness assertion was never independently verified. Renaming a
    // key is invisible to every fire test and visible only to completeness.
    kills: ['every rule has a budget and every budget has a rule'],
    find: "  'ad-hoc-shadow': 44,",
    replace: "  'ad-hoc-shadows': 44,",
  },
  {
    id: 'U65-HARD-ZERO-QUIETLY-RAISED',
    target: 'lint',
    invariant: 'The accessibility hard zeros stay at zero — they are not migration budgets.',
    // Nothing exercised this assertion before; a hard zero could have drifted
    // upward in a diff that reads like every other budget edit.
    kills: ['the hard-zero accessibility rules are still zero'],
    find: "  'focus-suppression': 0,",
    replace: "  'focus-suppression': 3,",
  },
  // ── UI-003 wave 0: interactive cards ──────────────────────────────────────
  // The defect these protect was the highest-severity accessibility failure in
  // the codebase: the app's primary browse affordance was a <div> with a click
  // handler, so Browse, Saved and every seller grid had ZERO tab stops. It is
  // defended in three places on purpose — the primitive refuses the prop, the
  // linter fails the build, and the card is asserted to be two real controls —
  // so each layer gets its own mutant.
  {
    id: 'U66-CARD-ACCEPTS-ONCLICK-AGAIN',
    target: 'ui',
    invariant: 'Card never attaches a click handler to a non-interactive element.',
    kills: ['REFUSES onClick — a div with a click handler is not a control'],
    // Exactly the pre-UI-003 primitive: the handler forwarded onto `as: 'div'`.
    edits: [
      {
        find: '    <As\n      className={`relative rounded-container border border-subtle bg-surface ${',
        replace: '    <As\n      onClick={onClick}\n      className={`relative rounded-container border border-subtle bg-surface ${',
      },
      {
        find: "  if (process.env.NODE_ENV !== 'production' && onClick) {",
        replace: '  if (false) {',
      },
    ],
  },
  {
    id: 'U67-CARD-DROPS-ONCLICK-SILENTLY',
    target: 'ui',
    invariant: 'Refusing the handler is LOUD — a silently dropped onClick ships a call site that believes it works.',
    // The half of U66 that a "did the handler fire?" assertion cannot see. Both
    // the correct code and this mutant leave the card inert; what differs is
    // whether anyone is told.
    kills: ['REFUSES onClick — a div with a click handler is not a control'],
    find: "  if (process.env.NODE_ENV !== 'production' && onClick) {",
    replace: '  if (false) {',
  },
  {
    id: 'U68-CARD-BOLTS-ON-ROLE-BUTTON',
    target: 'ui',
    invariant: 'The container never becomes the control — a card holding a save button would nest one control inside another.',
    // The tempting "fix". It restores keyboard reach on paper and produces an
    // interactive element wrapping an interactive element in ListingCard.
    kills: ['REFUSES onClick — a div with a click handler is not a control', 'nests no control inside another control'],
    find: '    <As\n      className={`relative rounded-container border border-subtle bg-surface ${',
    replace:
      '    <As\n      onClick={onClick}\n      role={onClick ? \'button\' : undefined}\n' +
      '      tabIndex={onClick ? 0 : undefined}\n' +
      '      className={`relative rounded-container border border-subtle bg-surface ${',
  },
  {
    id: 'U69-STRETCHED-TARGET-IS-NOT-A-BUTTON',
    target: 'ui',
    invariant: 'The card target is a real <button>, so Enter and Space come from the platform.',
    kills: ['is a real button, so Enter and Space activate it natively'],
    find: '  <button\n    // Not a link.',
    replace: '  <div\n    // Not a link.',
  },
  {
    id: 'U70-STRETCHED-TARGET-SUBMITS-THE-FORM',
    target: 'ui',
    invariant: 'The card target never defaults to type="submit".',
    kills: ['is a real button, so Enter and Space activate it natively'],
    // Pinned through `className={[` as well: Chip opens with the identical
    // type/onClick pair, so the shorter form matches twice and the runner
    // (correctly) refuses an ambiguous mutation.
    find: '    type="button"\n    onClick={onClick}\n    className={[',
    replace: '    onClick={onClick}\n    className={[',
  },
  {
    id: 'U71-OVERLAY-DOES-NOT-STRETCH',
    target: 'ui',
    invariant: 'The target claims the whole card as its hit area, not just the title text box.',
    // Without the overlay the markup is still perfectly accessible — one named,
    // focusable button — and every keyboard assertion passes. What silently
    // disappears is the full-card POINTER target the card has always had, which
    // is the behaviour this refactor promised not to change.
    kills: ['claims the whole card as its hit area via ::before, not ::after'],
    find: "      \"before:content-[''] before:absolute before:inset-0\",",
    replace: "      '',",
  },
  {
    id: 'U72-OVERLAY-COLLIDES-WITH-STATE-LAYER',
    target: 'ui',
    invariant: 'The overlay is ::before — .state-layer already owns ::after, and an after: overlay is erased by it.',
    kills: ['claims the whole card as its hit area via ::before, not ::after'],
    find: "      \"before:content-[''] before:absolute before:inset-0\",",
    replace: "      \"after:content-[''] after:absolute after:inset-0\",",
  },
  {
    id: 'U73-TARGET-CENTRES-ITS-TEXT',
    target: 'ui',
    invariant: 'The target aligns to the LOGICAL start, so a Hebrew title is not centred and no physical side is pinned.',
    kills: ['aligns to the logical start so a Hebrew title is not centred'],
    find: "      'text-start',",
    replace: "      'text-left',",
  },
  {
    id: 'U74-LISTING-CARD-IS-A-CLICKABLE-DIV',
    target: 'card',
    invariant: 'The browse card is two real controls, not a div with a handler.',
    // The exact live defect, restored: the whole card clickable, the title a
    // bare heading, and zero tab stops on the app's primary browse surface.
    kills: [
      'is exactly two tab stops — open the item, save the item',
      'the control that opens the item is named by the visible title',
    ],
    edits: [
      {
        find: '      <Card className="overflow-hidden group" interactive>',
        replace: '      <Card className="overflow-hidden group" onClick={() => viewItem(item)}>',
      },
      {
        find: '            <StretchedTarget onClick={() => viewItem(item)} className="block w-full">\n              <span className="block truncate group-hover:text-[#6FEEE1] transition-colors">\n                {title}\n              </span>\n            </StretchedTarget>',
        replace: '            <span className="block truncate group-hover:text-[#6FEEE1] transition-colors">\n              {title}\n            </span>',
      },
    ],
  },
  {
    id: 'U75-SAVE-CONTROL-UNNAMED',
    target: 'card',
    invariant: 'The save control carries an accessible name that identifies WHICH listing it saves.',
    // An icon-only control with no name is announced as "button"; twenty of them
    // in a Browse grid identify nothing at all.
    kills: ['the save control has a name that distinguishes it in a grid of twenty'],
    find: '            aria-label={saveLabel}\n            aria-pressed={isSaved}',
    replace: '            aria-pressed={isSaved}',
  },
  {
    id: 'U76-SAVE-STATE-NOT-ANNOUNCED',
    target: 'card',
    invariant: 'Saved / not-saved is announced through aria-pressed rather than a name that flips mid-toggle.',
    kills: ['the save control announces its state through aria-pressed'],
    find: '            aria-pressed={isSaved}\n',
    replace: '',
  },
  {
    id: 'U77-SAVE-CONTROL-BURIED-UNDER-OVERLAY',
    target: 'card',
    invariant: 'The save control sits above the title overlay, so the heart is still reachable by pointer.',
    // Both controls are absolutely positioned at z-auto, so paint order is
    // document order and the overlay — later in the tree — swallows the heart.
    // No handler assertion can see this: the onClick is still wired, the element
    // is still in the DOM, and jsdom does no hit testing at all.
    kills: ['the save control sits above the stretched overlay'],
    find: "${rtl ? 'left-3' : 'right-3'} z-raised w-10 h-10",
    replace: "${rtl ? 'left-3' : 'right-3'} w-10 h-10",
  },
  {
    id: 'U78-INTERACTIVE-CARD-RULE-STOPS-MATCHING',
    target: 'lint',
    invariant: 'The interactive-card rule actually matches a Card carrying a handler.',
    // The build gate for the whole defect. A regex that quietly stops matching
    // reports a clean build forever, and the hard zero becomes a monument.
    kills: ['interactive-card is enforced, not merely declared'],
    find: '        const handler = tag.match(\n',
    replace: '        const handler = null && tag.match(\n',
  },
  {
    id: 'U79-INTERACTIVE-CARD-RULE-GOES-LINE-BASED',
    target: 'lint',
    invariant: 'The rule sees the WHOLE opening tag — a handler formatted across lines is the common form, not the exception.',
    // Degrades the structural walk to single-line matching. Every one-line
    // fixture still fails, so only the multi-line negative test can see it.
    kills: ['interactive-card sees a handler on a Card even when the tag spans lines'],
    find: '          else if (c === \'>\' && depth === 0) break;\n        }\n        const tag = src.slice(m.index, i + 1);\n        // ACTIVATION handlers only.',
    replace: '          else if (c === \'\\n\') break;\n        }\n        const tag = src.slice(m.index, i + 1);\n        // ACTIVATION handlers only.',
  },
  {
    id: 'U80-INTERACTIVE-CARD-RULE-OVER-MATCHES',
    target: 'lint',
    invariant: 'The rule stays quiet on the ~58 Cards that are plain surfaces — a rule that cries wolf gets switched off.',
    kills: ['a non-interactive Card is not an interactive-card violation'],
    find: '        const handler = tag.match(\n          /\\bon(?:Click|DoubleClick|KeyDown|KeyUp|KeyPress|MouseDown|MouseUp|PointerDown|PointerUp|TouchStart|TouchEnd)\\s*=/\n        );',
    replace: '        const handler = tag.match(/\\bon[A-Z]\\w+\\s*=|\\bclassName\\s*=/);',
  },
  {
    id: 'U56-DECORATION-RULE-STOPS-MATCHING',
    target: 'lint',
    invariant: 'The gradient rule actually matches a gradient.',
    // A regex that quietly stops matching reports a clean build forever.
    kills: ['decorative-gradient is enforced, not merely declared'],
    find: '      return (line.match(/linear-gradient|radial-gradient|conic-gradient|\\bbg-gradient-to-[a-z]+/g) || []).length;',
    replace: '      return 0;',
  },

  // ── UI-003 Wave 0 — AI authenticity must never claim a verification ────────
  //
  // The shipped defect: `tier === 'high'` — the IDENTITY-confidence tier, which
  // says how sure the model is WHAT the object is and carries no authenticity
  // information — rendered a <Check> + 'מאומת' / 'Authenticated' pill. `מאומת`
  // is the exact word AuthProfileView uses for a seller who passed operator
  // review, so in Hebrew (the app's DEFAULT language) a model's guess and a real
  // credential rendered identically.
  //
  // Each mutant below is one plausible way that claim comes back. T05 and T06
  // are the two most likely: T05 because "the badge disappeared for good items"
  // reads as a regression someone will helpfully restore, and T06 because it
  // re-grants the credential through COLOUR ALONE, leaving every string honest —
  // which is exactly what a DOM or string-only test cannot see.
  {
    id: 'T01-HEBREW-CLAIMS-VERIFIED',
    target: 'translations',
    invariant: 'No authenticity label claims a verification — in EITHER language.',
    // Hebrew-only, deliberately. An English-only assertion would pass this.
    kills: ['T-01 no authenticity or serial label claims a verification, in EITHER language'],
    find: "    authSignsSeen:     'AI: סימני מקוריות',",
    replace: "    authSignsSeen:     'מאומת',",
  },
  {
    id: 'T02-HEBREW-KEY-MISSING',
    target: 'translations',
    invariant: 'A trust key missing from he renders undefined — an empty badge that fails silently.',
    kills: ['T-02 the Hebrew trust vocabulary is complete — a missing key renders an EMPTY badge, silently'],
    find: "    authIndicators:    'AI זיהה סימני מקוריות',\n",
    replace: '',
  },
  {
    id: 'T03-ATTRIBUTION-STRIPPED',
    target: 'translations',
    invariant: 'Every AI-derived badge names the AI — unattributed, it reads as a platform finding.',
    kills: ['T-03 every AI-derived authenticity badge attributes itself to the AI'],
    find: "    authIndicators:    'AI found authenticity indicators',",
    replace: "    authIndicators:    'Authenticity indicators found',",
  },
  {
    id: 'T04-SHIELD-RETURNS',
    target: 'results',
    invariant: 'No <Shield> on an AI reading — Shield is the operator identity-verification marker.',
    kills: ['T-04 the authenticity surfaces use no credential iconography'],
    find: '                  <Eye className="w-3.5 h-3.5" style={{ color: STITCH.onSurfaceVariant }} strokeWidth={2.5} />',
    replace: '                  <Shield className="w-3.5 h-3.5" style={{ color: STITCH.onSurfaceVariant }} strokeWidth={2.5} />',
  },
  {
    id: 'T05-IDENTITY-TIER-GRANTS-BADGE',
    target: 'results',
    invariant: 'The identity-confidence tier grants no authenticity badge.',
    // Restores the deleted arm in its minimal form. The state it fires on is the
    // one where analyze.js decided no authenticity assessment was needed at all,
    // so there is no finding behind it to report.
    kills: ['T-05 the identity-confidence tier grants no authenticity badge'],
    find: "            const indicator = status === 'verified_by_serial' ? t?.authSerialSeen",
    replace: "            if (tier === 'high') return null;\n            const indicator = status === 'verified_by_serial' ? t?.authSerialSeen",
  },
  {
    id: 'T06-CREDENTIAL-REGRANTED-BY-COLOUR',
    target: 'results',
    invariant: 'An indicator is never painted as brand-accent approval — colour makes its own claim.',
    // Every STRING stays honest under this mutant. That is the point: it is the
    // one form of the defect a text assertion is blind to.
    kills: ['T-06 an authenticity INDICATOR is never painted as brand-accent approval'],
    find: "        const accent = isReplica ? '#ef4444' : hasIndicator ? STITCH.onSurfaceVariant : '#fbbf24';",
    replace: "        const accent = isReplica ? '#ef4444' : hasIndicator ? STITCH.primary : '#fbbf24';",
  },
  {
    id: 'T07-BUYER-CHIP-CLAIMS-VERIFIED',
    target: 'detail',
    invariant: 'The buyer-facing serial chip attributes the claim to the seller, never to the platform.',
    // The chip sits in the same row as the genuine operator-backed 'Verified ID'
    // chip, and this one is true when a seller typed eight characters.
    kills: ['T-07 the buyer-facing serial chip attributes the claim to the seller'],
    find: '                      <Barcode className="w-2.5 h-2.5" />{t.serialProvided}',
    replace: '                      <Check className="w-2.5 h-2.5" />{lang === \'he\' ? \'מספר סידורי אומת\' : \'Serial verified\'}',
  },

  // ── UI-003 Wave 0 — a degraded valuation is PERSISTED as one ──────────────
  //
  // These two were the largest untested surface in the wave: the Valuation
  // Engineer predicted that reverting either would survive, because nothing
  // covered the rows at all. Both mutants restore the pre-fix write exactly.
  {
    id: 'P01-SERVER-ROW-STORES-ZERO',
    target: 'analyze',
    invariant: 'record_scan stores NULL for an unpriced valuation, never 0.',
    // A stored 0 is indistinguishable from an item genuinely worth nothing, and
    // SQL aggregates average it in rather than skipping it — so it silently
    // corrupts every metric over the column, not just the row it lands in.
    kills: ['PR-01 server row: an unpriced valuation (guard degrade, mislabelled ai_estimate) persists NULL, never 0'],
    find: '          : { price_low: null, price_mid: null, price_high: null }),',
    replace: '          : { price_low: result.marketValue.low, price_mid: result.marketValue.mid, price_high: result.marketValue.high }),',
  },
  {
    id: 'P02-CLIENT-ROW-STORES-ZERO',
    target: 'context',
    invariant: 'The client backup writer agrees with the server: NULL, never 0.',
    // Same row id as the server write, so a disagreement here is resolved by
    // whichever upsert lands first — a corruption decided by timing.
    kills: ['PR-03 client backup row: an unpriced valuation (guard degrade, mislabelled ai_estimate) persists NULL + an explicit marker'],
    find: '      price_low: priced ? aiResult.marketValue.low : null,',
    replace: '      price_low: aiResult.marketValue?.low ?? null,',
  },
  {
    id: 'P03-CLIENT-ROW-LOSES-MANUAL-MARKER',
    target: 'context',
    invariant: 'Manual pricing is a POSITIVE marker in the row, not the absence of a price.',
    // Without it, "unpriced" can only be INFERRED from a null — and an
    // `ai_estimate` label sitting over a null price reads as a bug in the
    // reader rather than a deliberate state.
    kills: ['PR-03 client backup row: an unpriced valuation (explicit manual_required) persists NULL + an explicit marker'],
    find: "      price_method: priced\n        ? (aiResult.marketValue?.price_method || 'ai_estimate')\n        : 'manual_required',",
    replace: "      price_method: aiResult.marketValue?.price_method || 'ai_estimate',",
  },

  // ── UI-003 Wave 0 — the GW-005A observations sink ─────────────────────────
  //
  // `observations` is the declared substrate for future pricing intelligence and
  // NOTHING reads it today, so a zero written here has no symptom until the day
  // someone builds the feature that averages it. That is exactly the shape of
  // defect a mutation suite exists for: the tests are the only thing that will
  // ever notice a regression here, so they had better actually catch one.
  //
  // O01-O03 restore the pre-fix write at each of the three sites, verbatim.
  {
    id: 'O01-VALUATION-COMPLETED-RECORDS-ZERO',
    target: 'contextObs',
    invariant: 'A degraded valuation records NO price at VALUATION_COMPLETED.',
    kills: ['OB-01 VALUATION_COMPLETED: unpriced (guard degrade, mislabelled ai_estimate) records no numeric price'],
    find: '        price_mid:    observedPriceMid(analysisResult.marketValue),',
    replace: '        price_mid:    analysisResult.marketValue?.mid,',
  },
  {
    id: 'O02-VALUATION-CONFIRMED-RECORDS-ZERO',
    target: 'contextObs',
    invariant: 'A degraded valuation records NO price at VALUATION_CONFIRMED.',
    // The third sink, absent from the Phase A brief and found while fixing the
    // other two. A confirmation is the strongest human signal collected, so a ₪0
    // here would be the most trustworthy-looking bad price in the table.
    kills: ['OB-01 VALUATION_CONFIRMED: unpriced (guard degrade, mislabelled ai_estimate) records no numeric price'],
    find: '      price_mid:  observedPriceMid(result.marketValue),',
    replace: '      price_mid:  result.marketValue?.mid,',
  },
  {
    id: 'O03-LISTING-CREATED-RECORDS-ZERO',
    target: 'contextObs',
    invariant: 'A degraded valuation records NO ai_price_mid at LISTING_CREATED.',
    // Worse than a bad row: ai_price_mid exists to compute the accuracy delta
    // (real − estimate), so a 0 scores the AI as maximally wrong on an item it
    // honestly declined to price.
    kills: ['OB-01 LISTING_CREATED: unpriced (guard degrade, mislabelled ai_estimate) records no numeric price'],
    find: '        ai_price_mid:   observedPriceMid(result?.marketValue),',
    replace: '        ai_price_mid:   result?.marketValue?.mid,',
  },

  // O04-O07 attack the helper itself rather than the call sites — the ways a
  // future edit could keep every call site looking correct while gutting them.
  {
    id: 'O04-HELPER-BYPASSES-HASREALPRICE',
    target: 'utilsObs',
    invariant: 'observedPriceMid delegates to the canonical predicate, defining no rule of its own.',
    // The subtle version: `mid > 0` looks equivalent and is not. It admits a
    // positive mid sitting on a zero low, and a manual_required status carrying
    // a stale triple — both shapes hasRealPrice rejects.
    kills: ['OB-06 observedPriceMid delegates to hasRealPrice and never invents a price'],
    find: 'export const observedPriceMid = (mv) => (hasRealPrice(mv) ? Number(mv.mid) : null);',
    replace: 'export const observedPriceMid = (mv) => (Number(mv?.mid) > 0 ? Number(mv.mid) : null);',
  },
  {
    id: 'O05-HELPER-RETURNS-ZERO-NOT-NULL',
    target: 'utilsObs',
    invariant: 'The unpriced return is null so cleanPayload OMITS the key — never a numeric 0.',
    // The whole fix hangs on this one value. `0` is a number, cleanPayload keeps
    // numbers, and the row is then written with an observed price of ₪0 — the
    // exact defect, reintroduced by a change that reads like a tidy-up.
    kills: ['OB-01 VALUATION_COMPLETED: unpriced (explicit manual_required) records no numeric price'],
    find: 'export const observedPriceMid = (mv) => (hasRealPrice(mv) ? Number(mv.mid) : null);',
    replace: 'export const observedPriceMid = (mv) => (hasRealPrice(mv) ? Number(mv.mid) : 0);',
  },
  {
    id: 'O06-HELPER-ACCEPTS-NEGATIVE',
    target: 'utilsObs',
    invariant: 'A negative price is not a price.',
    kills: ['OB-07 no marketValue shape can put a non-positive price into any payload'],
    find: 'export const observedPriceMid = (mv) => (hasRealPrice(mv) ? Number(mv.mid) : null);',
    replace: 'export const observedPriceMid = (mv) => (Number.isFinite(Number(mv?.mid)) ? Number(mv.mid) : null);',
  },
  {
    id: 'O07-MANUAL-REQUIRED-TREATED-AS-PRICED',
    target: 'utilsObs',
    invariant: 'An explicit manual_required status is never priced, whatever numbers ride along.',
    // Drops only the status check from hasRealPrice, leaving the numeric half —
    // so a manual_required verdict carrying a stale positive triple is recorded
    // as a real observed price.
    kills: ['OB-01 VALUATION_COMPLETED: unpriced (manual_required over a real triple) records no numeric price'],
    find: "  if (mv.pricing_status === 'manual_required') return false;\n",
    replace: '',
  },

  // O08-O09 attack the two POSITIVE markers. Without them "unpriced" can only be
  // inferred from an absence, which is unreadable at analysis time — the same
  // rule PR-03 enforces on the valuations row.
  {
    id: 'O08-COMPLETED-LOSES-MANUAL-MARKER',
    target: 'contextObs',
    invariant: 'VALUATION_COMPLETED marks the manual state positively via price_method.',
    kills: ['OB-03 the unpriced state is an explicit marker, not merely a missing key'],
    find: "        price_method: hasRealPrice(analysisResult.marketValue)\n          ? (analysisResult.marketValue?.price_method || 'ai_estimate')\n          : 'manual_required',",
    replace: '        price_method: analysisResult.marketValue?.price_method,',
  },
  {
    id: 'O09-LISTING-LOSES-PRICED-MARKER',
    target: 'contextObs',
    invariant: 'LISTING_CREATED distinguishes "no valuation" from "valuation, no price".',
    kills: ['OB-03 the unpriced state is an explicit marker, not merely a missing key'],
    find: '        ai_priced:      hasRealPrice(result?.marketValue),\n',
    replace: '',
  },

  // O10 attacks the MECHANISM the omission strategy depends on. cleanPayload
  // dropping nulls is why returning null is sufficient; if it starts preserving
  // them, every degraded row gains a `price_mid: null` key and the absence that
  // OB-01 asserts becomes a silent schema change.
  //
  // It needs BOTH edits, and finding that out was worth the detour. cleanPayload
  // rejects null TWICE, independently: the explicit `v === null` guard, and then
  // the type allowlist — `typeof null` is 'object', which the allowlist does not
  // admit. Mutating either line ALONE is an EQUIVALENT mutant: the other layer
  // still drops the key, behaviour is unchanged, and the harness (which has no
  // "equivalent" verdict) reports SURVIVED, indistinguishable from a real test
  // gap. Both were tried and both survived for exactly that reason.
  //
  // This is the case the header of this file describes: a layered defence has to
  // have every layer removed before the behaviour actually changes. Recorded
  // rather than trimmed, because "cleanPayload has defence in depth against
  // null" is a property the price fix quietly depends on and nothing else states.
  {
    id: 'O10-CLEANPAYLOAD-PRESERVES-NULL',
    target: 'observations',
    invariant: 'cleanPayload omits null-valued keys — the asymmetry the price fix relies on.',
    kills: ['OB-08 cleanPayload drops null/undefined and keeps 0 — the asymmetry the fix relies on'],
    edits: [
      { find: '    if (v === null || v === undefined) continue;',
        replace: '    if (v === undefined) continue;' },
      { find: "    if (t === 'string' || t === 'number' || t === 'boolean') out[k] = v;",
        replace: "    if (v === null || t === 'string' || t === 'number' || t === 'boolean') out[k] = v;" },
    ],
  },

  // O11 is the regression-proofing test's own mutant: if the source scan that
  // bans a direct marketValue read stops matching, a FOURTH observation site
  // could reintroduce the defect with every behavioural test still green.
  {
    id: 'O11-DIRECT-READ-SCAN-STOPS-MATCHING',
    target: 'contextObs',
    invariant: 'A new observation payload cannot read marketValue.mid directly.',
    // Simulates the future fourth site by adding one to an existing payload.
    kills: ['OB-09 no recordObservation payload reads marketValue?.mid directly'],
    find: '      ai_priced:  hasRealPrice(result.marketValue),',
    replace: '      ai_priced:  hasRealPrice(result.marketValue),\n      raw_mid:    result.marketValue?.mid,',
  },

  // O12 covers the two properties O11 does not. The first draft of OB-09 scanned
  // AppContext ALONE and matched only the `recordObservation(OBS.X, {` shape —
  // and there is an eighth call site, in CameraResultsView.jsx, that is in
  // neither set: different file, and it passes its event type as a STRING
  // LITERAL. It carries no price today, which is exactly why the narrow guard
  // looked sufficient. This mutant adds a price there, so the widened scan is
  // proven against the file and the call shape that actually escaped it.
  {
    id: 'O12-FOURTH-SITE-IN-ANOTHER-FILE',
    target: 'camera',
    invariant: 'The direct-read ban covers EVERY file and BOTH recordObservation call shapes.',
    kills: ['OB-09 no recordObservation payload reads marketValue?.mid directly'],
    find: '      confidence: result.confidence,\n      tier,',
    replace: '      confidence: result.confidence,\n      price_mid:  result.marketValue?.mid,\n      tier,',
  },

  // ── UI-003 Wave 0 — Gap B: `new_retail` ───────────────────────────────────
  //
  // The column outside the valuation band, and so the one the band's guard never
  // covered. `|| 0` at the constructors meant the value was ALWAYS a number,
  // which in turn made `?? null` at both persistence sites unreachable code —
  // the defect had two halves and removing either alone leaves it live. G01/G04
  // restore the constructors, G02/G03 restore the dead fallbacks.
  {
    id: 'G01-RETAIL-CONSTRUCTOR-DEFAULTS-ZERO',
    target: 'analyzeGuard',
    invariant: 'The marketValue constructor emits null, not 0, for an absent retail reference.',
    kills: ['PB-13 no new_retail path can reintroduce `|| 0` / `?? 0` / a literal zero'],
    find: '      newRetailPrice: positivePriceOrNull(verification.new_retail_price_ils),',
    replace: '      newRetailPrice: verification.new_retail_price_ils || 0,',
  },
  {
    id: 'G04-FALLBACK-CONSTRUCTOR-DEFAULTS-ZERO',
    target: 'analyzeGuard',
    invariant: 'The Stage 2 fallback constructor emits null, not 0, for an absent catalog retail.',
    // The larger of the two producers in practice: `_db_retail` is absent
    // whenever no catalog row resolved, which is the common case on this path.
    kills: ['PB-13 no new_retail path can reintroduce `|| 0` / `?? 0` / a literal zero'],
    find: '    new_retail_price_ils: positivePriceOrNull(fp._db_retail),',
    replace: '    new_retail_price_ils: fp._db_retail || 0,',
  },
  {
    id: 'G06-CATALOG-RETAIL-ORIGIN-DEFAULTS-ZERO',
    target: 'analyzeGuard',
    invariant: '_db_retail never carries "unknown" encoded as 0, even though its only reader normalizes.',
    kills: ['PB-13 no new_retail path can reintroduce `|| 0` / `?? 0` / a literal zero'],
    find: '    _db_retail:          positivePriceOrNull(row.retail_price_ils),',
    replace: '    _db_retail:          row.retail_price_ils || 0,',
  },
  {
    id: 'G02-SERVER-ROW-RESTORES-DEAD-FALLBACK',
    target: 'analyze',
    invariant: 'The server row NORMALIZES new_retail rather than passing it through.',
    // `?? null` catches only null/undefined, so it never caught the 0 the
    // constructor produced — and a result replayed from an older deploy still
    // carries one. This is the exact expression that shipped.
    kills: ['PR-07 both writers persist NULL new_retail when the reference is zero'],
    find: '        new_retail:        positivePriceOrNull(result.marketValue?.newRetailPrice),',
    replace: '        new_retail:        result.marketValue?.newRetailPrice ?? null,',
  },
  {
    id: 'G03-CLIENT-ROW-RESTORES-DEAD-FALLBACK',
    target: 'context',
    invariant: 'The client backup row applies the SAME normalization as the server.',
    kills: ['PR-07 both writers persist NULL new_retail when the reference is zero'],
    find: '      new_retail: positivePriceOrNull(aiResult.marketValue?.newRetailPrice),',
    replace: '      new_retail: aiResult.marketValue?.newRetailPrice ?? null,',
  },
  {
    id: 'G05-CLIENT-MIRROR-DRIFTS-ON-ZERO',
    target: 'utilsPersist',
    invariant: 'The client mirror of positivePriceOrNull cannot drift from the guard.',
    // `>= 0` admits exactly the value the whole fix exists to reject, and only
    // on the client — so the two writers of the same row id would disagree and
    // the stored value would depend on which upsert landed first.
    kills: ['PR-10 server and client agree on new_retail for EVERY input shape'],
    find: '  return Number.isFinite(n) && n > 0 ? n : null;',
    replace: '  return Number.isFinite(n) && n >= 0 ? n : null;',
  },
];

export default UI_MUTANTS;
