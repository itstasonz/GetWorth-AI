/** @type {import('tailwindcss').Config} */

/**
 * GetWorth design system — Tailwind surface (UI-002)
 *
 * Every token here resolves to a CSS custom property declared in src/index.css.
 * That file is the single source of truth; this file only exposes it as utility
 * classes.
 *
 * ── The channel-triplet pattern ──
 * Colours are written `rgb(var(--gw-x) / <alpha-value>)`. Tailwind substitutes
 * `<alpha-value>` with the opacity modifier, so `bg-surface`, `bg-surface/40`
 * and `border-subtle/60` all work. The previous config mapped tokens to
 * `var(--color-x)` — a complete colour — so opacity modifiers silently produced
 * nothing. Since the codebase's dominant idiom is exactly `bg-x/NN` (999 sites),
 * the token layer was unusable and adoption sat at 0.89%. This is the fix that
 * unblocks everything else in UI-002.
 *
 * ── Axes ──
 * The previous config extended ONLY `colors`, so radius, type, spacing,
 * elevation and z-index had no token layer at all and existed purely as
 * literals — which is how the app accumulated 6 radii, ~20 discrete type sizes,
 * 13 distinct shadow strings, 22 alpha values and 10 z-index values. Every axis
 * is closed here.
 */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // ─── COLOUR ────────────────────────────────────────────────────────────
      colors: {
        // Surfaces — a tonal ramp. Elevation is expressed by TONE, not shadow.
        canvas:            'rgb(var(--gw-canvas) / <alpha-value>)',
        surface:           'rgb(var(--gw-surface) / <alpha-value>)',
        elevated:          'rgb(var(--gw-elevated) / <alpha-value>)',
        'surface-high':    'rgb(var(--gw-surface-high) / <alpha-value>)',
        'surface-highest': 'rgb(var(--gw-surface-highest) / <alpha-value>)',
        scrim:             'rgb(var(--gw-scrim) / <alpha-value>)',

        // Text — `text-primary` means primary TEXT. The brand hue is `accent`.
        'text-primary':   'rgb(var(--gw-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--gw-text-secondary) / <alpha-value>)',
        'text-muted':     'rgb(var(--gw-text-muted) / <alpha-value>)',

        // Brand / action.
        // `accent` and `action-primary` are separate NAMES for the same triplet
        // so brand identity and interaction affordance can diverge later without
        // a rename — use `accent` when you mean "this is GetWorth", and
        // `action-primary` when you mean "you can press this".
        // `action-secondary` is deliberately a TONAL surface, not a second hue:
        // UI-001 found 26 emerald "secondary" buttons colliding with `success`,
        // which is what cost green its single meaning.
        accent:             'rgb(var(--gw-accent) / <alpha-value>)',
        'accent-dim':       'rgb(var(--gw-accent-dim) / <alpha-value>)',
        'on-accent':        'rgb(var(--gw-on-accent) / <alpha-value>)',
        'action-primary':   'rgb(var(--gw-accent) / <alpha-value>)',
        'action-pressed':   'rgb(var(--gw-accent-dim) / <alpha-value>)',
        'on-action':        'rgb(var(--gw-on-accent) / <alpha-value>)',
        'action-secondary': 'rgb(var(--gw-surface-high) / <alpha-value>)',

        // Semantic — exactly one hue per meaning
        success: 'rgb(var(--gw-success) / <alpha-value>)',
        warning: 'rgb(var(--gw-warning) / <alpha-value>)',
        danger:  'rgb(var(--gw-danger) / <alpha-value>)',
        info:    'rgb(var(--gw-info) / <alpha-value>)',

        // Borders
        subtle: 'rgb(var(--gw-border-subtle) / <alpha-value>)',
        strong: 'rgb(var(--gw-border-strong) / <alpha-value>)',

        // ── DEPRECATED aliases — pre-UI-002 call sites only. Do not use in new
        // code; scripts/check-ui-rules.mjs warns on growth. Tracked for removal
        // in docs/DESIGN_SYSTEM.md § Migration.
        'app':           'rgb(var(--gw-canvas) / <alpha-value>)',
        'app-secondary': 'rgb(var(--gw-text-secondary) / <alpha-value>)',
        'app-muted':     'rgb(var(--gw-text-muted) / <alpha-value>)',
        'surface-low':   'rgb(var(--gw-surface) / <alpha-value>)',
        'surface-muted': 'rgb(var(--gw-surface-high) / <alpha-value>)',
        'outline':       'rgb(var(--gw-border-subtle) / <alpha-value>)',
      },

      // ─── TYPOGRAPHY ────────────────────────────────────────────────────────
      // Preflight applies fontFamily.sans to <html>, so declaring it here is
      // what actually puts the brand faces on the ~99% of text that previously
      // rendered in the OS font. Heebo is listed after each Latin face as the
      // Hebrew fallback; index.css additionally aliases Heebo UNDER the Latin
      // family names via unicode-range, so Hebrew resolves correctly even at
      // the many call sites that still name 'Manrope'/'Inter' inline.
      fontFamily: {
        sans:    ['Inter', 'Heebo', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Manrope', 'Heebo', 'system-ui', '-apple-system', 'sans-serif'],
      },

      // A closed, role-named scale. UI-001 found ~20 discrete sizes with 65% of
      // all text inside a 2px band (text-sm 196 + text-xs 155), which cannot
      // express hierarchy — so hierarchy migrated to weight and colour instead,
      // producing 346 bold-or-heavier tokens and ZERO font-normal.
      //
      // `meta` at 12px is the FLOOR. Nothing smaller is sanctioned. If a fact
      // does not fit at 12px it does not ship — that cut is the design work.
      fontSize: {
        // Reserved for the valuation reveal — the product's peak moment.
        'display':   ['clamp(2rem, 9vw, 2.75rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        // Page / screen title
        'title-lg':  ['1.5rem',    { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '700' }],
        // Section heading
        'title':     ['1.125rem',  { lineHeight: '1.35', letterSpacing: '-0.01em',  fontWeight: '600' }],
        // Card / list-row title
        'title-sm':  ['1rem',      { lineHeight: '1.4',  letterSpacing: '-0.005em', fontWeight: '600' }],
        // Body — the default. Set at NORMAL weight by design.
        'body':      ['0.9375rem', { lineHeight: '1.55', fontWeight: '400' }],
        // Supporting / secondary prose
        'body-sm':   ['0.875rem',  { lineHeight: '1.5',  fontWeight: '400' }],
        // Form labels, button text
        'label':     ['0.8125rem', { lineHeight: '1.35', fontWeight: '500' }],
        // Metadata, timestamps, counts — THE FLOOR.
        // Resolves to --gw-type-floor so :lang(he) raises it from 12px to 13px
        // automatically: Heebo has a smaller x-height at the same nominal size
        // and no case distinction to aid word-shape recognition, so the DEFAULT
        // language was strictly harder to read than the secondary one.
        'meta':      ['var(--gw-type-floor, 0.75rem)', { lineHeight: '1.35', fontWeight: '400' }],
        // Money. Never gradient-filled, never a second hue.
        'price':     ['1.5rem',    { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        'price-sm':  ['1.125rem',  { lineHeight: '1.2',  letterSpacing: '-0.015em', fontWeight: '600' }],
      },

      // ─── SPACING ───────────────────────────────────────────────────────────
      // Tailwind's default 4px-based scale is retained (0.5→2px, 1→4px, 2→8px…)
      // because 158 raw call sites depend on it. These are the named semantic
      // steps new code should reach for; both resolve to the same 8-point grid.
      spacing: {
        'gutter':  '1.25rem', // 20px — the shell's horizontal padding
        'stack':   '0.75rem', // 12px — between related elements
        'group':   '1.5rem',  // 24px — between groups within a section
        'section': '2.5rem',  // 40px — between sections
        'tap':     '2.75rem', // 44px — minimum touch target
      },

      // Tailwind's minWidth/minHeight scales are separate from `spacing`, so the
      // touch-target step has to be declared for them explicitly. `min-h-tap` is
      // the single mechanism for the 44px floor.
      minWidth:  { 'tap': '2.75rem' },
      minHeight: { 'tap': '2.75rem' },

      // ─── RADIUS ────────────────────────────────────────────────────────────
      // Three values, replacing six (8/12/16/24/32/full) applied at random.
      // Nesting rule: inner radius = outer − padding. A `container` holding a
      // `control` with 4px padding is 12 → 8, which is why these two steps are
      // 4px apart. `sheet` is a documented container variant for the single
      // bottom-sheet primitive only.
      // 16px container is chosen over 12 deliberately: `rounded-2xl` (78 uses)
      // is the dominant ad-hoc card treatment while `<Card>` shipped
      // `rounded-3xl` (13 uses). UI-001 §15.3 found that USING the shared
      // primitive therefore produced a visibly different card than not using it
      // — a structural disincentive to adopt it. Matching the majority makes
      // ~66 ad-hoc cards correct without edits.
      //
      // Nesting rule falls out arithmetically: 16 − 6px inset = 10, so a
      // correctly-padded control inside a card lands exactly on `control`.
      borderRadius: {
        'control':   '10px',
        'container': '16px',
      },

      // ─── ELEVATION ─────────────────────────────────────────────────────────
      // Three shadows, replacing 18 inline declarations in 13 distinct strings.
      // Depth is normally carried by surface TONE; shadow is used only where
      // content floats over content it cannot predict.
      boxShadow: {
        'raised':  'var(--gw-shadow-raised)',
        'overlay': 'var(--gw-shadow-overlay)',
        'sheet':   'var(--gw-shadow-sheet)',
      },

      // ─── LAYERS ────────────────────────────────────────────────────────────
      // A named contract, replacing 10 ad-hoc values including four arbitrary
      // bracket escapes (z-[45], z-[55], z-[60], z-[100]) — the signature of
      // stacking bugs fixed one at a time.
      zIndex: {
        'base':    '0',
        'raised':  '10',
        'sticky':  '20',
        'nav':     '30',
        'scrim':   '40',
        'sheet':   '50',
        'banner':  '60',
        'toast':   '70',
      },

      // ─── ALPHA LADDER ──────────────────────────────────────────────────────
      // Tailwind v3 validates BARE numeric opacity modifiers against
      // `theme.opacity`, whose default is multiples of 5 (0,5,10,15,20,…).
      // Anything off that scale — `bg-accent/12` — emits NO RULE AT ALL and
      // fails silently: the element simply has no background.
      //
      // That is not a hypothetical. It shipped: the entire badge system was
      // specified as "semantic text over its own 12% tint", the contrast script
      // asserted twelve passing ratios for that composite, and the tint was
      // never rendered. Green tests, wrong pixels — precisely the failure mode
      // UI-001 diagnosed, only automated.
      //
      // Declaring the ladder here is what makes it real. 20 and 40 already
      // exist on the default scale; 4, 8 and 64 do not.
      opacity: {
        4:  '0.04',
        8:  '0.08',
        12: '0.12',
        64: '0.64',
      },

      // Motion — Material 3 emphasized easing, used for enter/exit transitions.
      transitionTimingFunction: {
        'emphasized':     'cubic-bezier(0.2, 0, 0, 1)',
        'emphasized-in':  'cubic-bezier(0.05, 0.7, 0.1, 1)',
        'emphasized-out': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
      },
      transitionDuration: {
        'instant': '80ms',   // tap feedback
        'quick':   '150ms',  // state change
        'enter':   '250ms',  // element enters
        'exit':    '200ms',  // element leaves
      },
    },
  },
  plugins: [],
};
