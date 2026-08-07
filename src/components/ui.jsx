import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X, ChevronRight, ChevronLeft, RefreshCw } from 'lucide-react';
import { BADGE_COLORS } from '../lib/utils';
import { navDirectionRef } from '../lib/urlSync';

/**
 * GetWorth shared primitives — UI-002
 *
 * Every component here is the ONLY sanctioned way to render its role. UI-001
 * measured what happens without that rule: 158 raw <button> against 24 <Btn>,
 * 11 hand-rolled bottom sheets against 1 <ConfirmSheet>, and 7 competing badge
 * colour registries.
 *
 * Design invariants enforced by these primitives:
 *   · ONE depth cue per surface (tonal fill + 1px border) — never gradient +
 *     border + shadow + inset bevel stacked, which is what made cards read as
 *     plastic.
 *   · Badges are tinted pills (semantic text over its own 12% tint). Solid
 *     high-opacity fills with white text are BANNED — that pattern produced the
 *     1.71:1 contrast failure on the condition badge.
 *   · Interaction feedback is a Material 3 state layer, not `active:scale`.
 *   · Touch targets are ≥44px via hit-slop, never by growing the glyph.
 *   · Hover is gated behind a real pointer — 116 `hover:` utilities on a
 *     touch-first PWA either never fire or fire-and-stick after a tap.
 */

// ── ScreenTransition ─────────────────────────────────────────────────────────
// Direction-aware view transition wrapper. Reads navDirectionRef at render time
// (the ref is written synchronously before setView, so this is always correct on
// mount). Use with key={view} on the parent so each change remounts.
export const ScreenTransition = ({ children, className = '' }) => {
  const dir = navDirectionRef.current;
  const animClass =
    dir === 'push' ? 'animate-slideInRight' :
    dir === 'pop'  ? 'animate-slideInLeft'  :
                     'animate-crossfade';
  return <div className={`${animClass} ${className}`}>{children}</div>;
};

// ── Animated wrappers ────────────────────────────────────────────────────────
/**
 * All three share ONE shape, deliberately.
 *
 * UI-002A: `ScaleIn` was the odd one out — it destructured only
 * `{ children, delay, className }` and spread nothing, so every other prop
 * handed to it was silently swallowed before reaching a DOM node. That is the
 * bug class behind "the overlay ignores my click handler": the JSX reads as if
 * `onClick` is attached, React reports no error, and the handler simply never
 * runs. `FadeIn`/`SlideUp` already spread `...p`; the divergence was invisible
 * at the call site and only discoverable by reading the primitive.
 *
 * `style` is destructured and merged explicitly rather than left in `...p`:
 * spreading after the `style` prop would let a call site passing its own style
 * clobber `animationDelay` and silently kill the stagger.
 */
export const FadeIn = ({ children, delay = 0, className = '', style, ...p }) => (
  <div className={`animate-fadeIn ${className}`} style={{ animationDelay: `${delay}ms`, ...style }} {...p}>{children}</div>
);

export const SlideUp = ({ children, delay = 0, className = '', style, ...p }) => (
  <div className={`animate-slideUp ${className}`} style={{ animationDelay: `${delay}ms`, ...style }} {...p}>{children}</div>
);

export const ScaleIn = ({ children, delay = 0, className = '', style, ...p }) => (
  <div className={`animate-scaleIn ${className}`} style={{ animationDelay: `${delay}ms`, ...style }} {...p}>{children}</div>
);

// ── Haptic ───────────────────────────────────────────────────────────────────
export const haptic = (pattern = 10) => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};

// ── HitArea ──────────────────────────────────────────────────────────────────
/**
 * Invisible touch-target expansion.
 *
 * UI-001 measured a 6×4px hit area on the results photo-dot indicators and 8×8px
 * on the gallery dots — effectively unhittable. The fix is never to grow the
 * visible glyph (that would bulk up deliberately tight layouts); it is to grow
 * the tappable area around it. Everything below 44px gets wrapped in this.
 */
export const HitArea = ({ children, className = '', as: As = 'button', ...p }) => (
  <As
    className={`relative inline-flex items-center justify-center min-w-tap min-h-tap ${className}`}
    {...p}
  >
    {children}
  </As>
);

// ── Toast ────────────────────────────────────────────────────────────────────
// Severity: success | info | warning | error | critical. `critical` never
// auto-dismisses. Direction is detected per message so a Hebrew string in an
// English UI (and vice versa) still reads correctly.
//
// UI-002: the five saturated 135° gradients are replaced by one tonal surface
// with a semantic left border. The icon plus the border carry severity; the
// surface stays constant, so a toast can never out-shout the screen behind it.
const TOAST_CFG = {
  success:  { ms: 4500, accent: 'rgb(var(--gw-success))', Icon: CheckCircle   },
  info:     { ms: 4500, accent: 'rgb(var(--gw-text-secondary))', Icon: Info   },
  warning:  { ms: 7000, accent: 'rgb(var(--gw-warning))', Icon: AlertTriangle },
  error:    { ms: 9500, accent: 'rgb(var(--gw-danger))',  Icon: AlertCircle   },
  critical: { ms: null, accent: 'rgb(var(--gw-danger))',  Icon: AlertCircle   },
};

export const Toast = ({ id, message, type = 'success', rtl: appRtl = false, onDismiss }) => {
  const [leaving, setLeaving] = useState(false);
  const cfg = TOAST_CFG[type] ?? TOAST_CFG.success;

  // Guarded with a ref rather than by reading `leaving`: a state updater must be
  // pure, and scheduling the dismiss timer inside one would fire it twice under
  // StrictMode's double-invoke — dismissing the toast that replaced this one.
  const dismissedRef = useRef(false);
  const exitTimerRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  // The host renders `onDismiss={() => dismissToast(t.id)}` — a NEW closure on
  // every App render. Reading it through a ref is what keeps `handleDismiss`
  // referentially stable, which is in turn what keeps the auto-dismiss effect
  // below from tearing down and restarting its timer on every root rerender.
  // Without it a toast on a busy screen would never reach its deadline.
  onDismissRef.current = onDismiss;

  const handleDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setLeaving(true);
    // matches the toastOut animation duration
    exitTimerRef.current = setTimeout(() => onDismissRef.current?.(), 230);
  }, []);

  useEffect(() => {
    if (!cfg.ms) return;
    const t = setTimeout(handleDismiss, cfg.ms);
    return () => clearTimeout(t);
  }, [cfg.ms, handleDismiss]);

  // UI-002A: the exit timer outlived the component. If the toast unmounted
  // during its 230ms leave animation — the stack is capped at 4, so a burst of
  // toasts evicts older ones mid-flight — the pending callback still fired
  // against a dead component. `dismissedRef` guards `handleDismiss`, not this
  // trailing timer, so the guard did not cover it.
  useEffect(() => () => clearTimeout(exitTimerRef.current), []);

  const hasHebrew = /[֐-׿]/.test(message);
  const dir = hasHebrew ? 'rtl' : 'ltr';

  return (
    <div
      // `role="alert"` implies assertive, so pairing it with aria-live="polite"
      // is contradictory. Urgent severities get alert/assertive; the rest get
      // status/polite, which does not interrupt a screen reader mid-sentence.
      role={type === 'critical' || type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'critical' || type === 'error' ? 'assertive' : 'polite'}
      className={`${leaving ? 'animate-toastOut' : 'animate-toastIn'} rounded-container shadow-overlay`}
      style={{
        background: 'rgb(var(--gw-surface-high))',
        border: '1px solid rgb(var(--gw-border-subtle))',
        [dir === 'rtl' ? 'borderRightWidth' : 'borderLeftWidth']: 3,
        [dir === 'rtl' ? 'borderRightColor' : 'borderLeftColor']: cfg.accent,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        direction: dir,
        color: 'rgb(var(--gw-text-primary))',
        minHeight: 48,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <cfg.Icon style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2, color: cfg.accent }} />

      <span
        className="flex-1 text-body-sm"
        style={{ wordBreak: 'break-word', overflowWrap: 'break-word', textAlign: dir === 'rtl' ? 'right' : 'left' }}
      >
        {message}
      </span>

      {/* 44px hit area around a 14px glyph — the dismiss control was 26×26px. */}
      <HitArea
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="-m-2 flex-shrink-0 rounded-control text-text-muted state-layer"
      >
        <X style={{ width: 16, height: 16 }} />
      </HitArea>
    </div>
  );
};

// ── Skeletons ────────────────────────────────────────────────────────────────
export const Skeleton = ({ className = '' }) => (
  <div className={`bg-surface-high/40 rounded-control overflow-hidden relative ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
  </div>
);

export const SkeletonCard = () => (
  <div className="rounded-container overflow-hidden bg-surface border border-subtle relative">
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent z-raised pointer-events-none" />
    <div className="aspect-square bg-surface-high/40" />
    <div className="p-4 space-y-3">
      <div className="h-4 bg-surface-high/40 rounded-control w-3/4" />
      <div className="h-7 bg-surface-high/40 rounded-control w-1/2" />
      <div className="flex justify-between">
        <div className="h-3 bg-surface-high/40 rounded-control w-1/3" />
        <div className="h-3 bg-surface-high/40 rounded-control w-1/4" />
      </div>
    </div>
  </div>
);

// ── Card ─────────────────────────────────────────────────────────────────────
/**
 * ONE depth cue: a tonal fill plus a 1px border. Nothing else.
 *
 * The previous Card emitted a 135° gradient fill, a 1px border, an outer drop
 * shadow AND `inset 0 1px 0` — a fake bevel simulating a light source no other
 * element in the app acknowledged — plus `backdrop-blur-xl` on all 58
 * instances, including cards sitting on an opaque background where it blurred
 * nothing and cost a GPU layer. Four stacked cues is what "plastic" looks like.
 *
 * Radius is 16px (`rounded-container`), matching the dominant ad-hoc treatment.
 * Previously Card was `rounded-3xl` (24px) while every hand-rolled card was
 * `rounded-2xl`, so using the shared primitive produced a visibly DIFFERENT
 * card than not using it — a structural disincentive to adopt it.
 *
 * @param gradient  DEPRECATED. Still honoured so the ~20 call sites passing an
 *                  explicit tint do not change unexpectedly, but tinted cards
 *                  are being retired — see docs/DESIGN_SYSTEM.md § Migration.
 * @param glow      DEPRECATED and NEUTRALISED. It emitted
 *                  `rgba(59,130,246,0.15)` — a *blue* glow in a teal app,
 *                  left over from a pre-rebrand palette.
 */
export const Card = ({ children, className = '', onClick, glow, gradient, style, as: As = 'div', ...p }) => (
  <As
    onClick={onClick}
    className={`relative rounded-container border border-subtle bg-surface ${
      onClick ? 'cursor-pointer state-layer transition-colors duration-quick' : ''
    } ${className}`}
    // `style` is destructured and merged explicitly rather than arriving via
    // {...p}: spreading after the style prop would let a call site passing both
    // `gradient` and `style` silently drop the gradient.
    style={gradient || style ? { ...(gradient ? { background: gradient } : null), ...style } : undefined}
    {...p}
  >
    {children}
  </As>
);

// ── Btn ──────────────────────────────────────────────────────────────────────
/**
 * UI-001 counted ~20 visually distinct button treatments for one semantic role
 * — 12 of them "primary" — differing across 3 radii, 9 padding recipes, 3
 * weights and 5 shadows. Tap targets ranged from ~30px (below minimum) to 64px.
 *
 * This collapses them to three intents × three sizes. The legacy boolean props
 * (`primary`, `secondary`) still work so the 24 existing call sites keep
 * rendering; `variant` is the form new code should use.
 *
 * `secondary` is a TONAL surface, not a second hue. The previous emerald
 * secondary collided with `success` and is what cost green its single meaning.
 */
const BTN_SIZES = {
  sm: 'min-h-tap px-4 text-label',
  md: 'min-h-tap px-5 py-3 text-label',
  lg: 'min-h-[3.25rem] px-6 py-3.5 text-body',
};

const BTN_VARIANTS = {
  primary:     'bg-action-primary text-on-action font-semibold',
  secondary:   'bg-action-secondary text-text-primary border border-subtle font-medium',
  ghost:       'bg-transparent text-text-secondary font-medium',
  // Filled, not outlined. In a confirmation sheet the destructive action sits
  // beside a filled secondary Cancel; an outlined confirm reads as LESS
  // prominent than the escape hatch, which inverts the meaning of the dialog.
  destructive: 'bg-danger text-canvas font-semibold',
};

export const Btn = ({
  children,
  variant,
  size = 'md',
  primary,
  secondary,
  disabled,
  loading,
  fullWidth,
  type = 'button',
  className = '',
  ...p
}) => {
  // Legacy default is `secondary`, NOT `ghost`. The pre-UI-002 Btn rendered a
  // filled surface with a border when given neither prop; defaulting to a
  // transparent ghost would have silently turned every such call site into a
  // text link. That makes `secondary` and the default the same variant, so the
  // prop is destructured only to keep it OFF the DOM node — React would warn on
  // an unknown `secondary` attribute if it stayed in `...p`.
  // `type` defaults to "button" because a Btn inside a <form> would otherwise
  // submit it — which would make ConfirmSheet's Cancel submit.
  const v = variant || (primary ? 'primary' : 'secondary');
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'relative inline-flex items-center justify-center gap-2 rounded-control',
        'state-layer transition-colors duration-quick',
        'disabled:opacity-40 disabled:pointer-events-none',
        BTN_SIZES[size] ?? BTN_SIZES.md,
        BTN_VARIANTS[v] ?? BTN_VARIANTS.ghost,
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...p}
    >
      {loading && <RefreshCw className="w-4 h-4 animate-spin-slow" aria-hidden="true" />}
      {children}
    </button>
  );
};

// ── Badge ────────────────────────────────────────────────────────────────────
/**
 * The ONLY sanctioned badge mechanism: semantic text over its own 12% tint.
 *
 * UI-001 found that solid, high-opacity fills with white text fail contrast
 * badly — white on `bg-[#6FEEE1]/90` computes to 1.71:1, on the *condition*
 * chip, which is the single most price-relevant fact on a second-hand listing.
 * The tinted form passes AA on every surface in the ramp (4.88–10.22:1),
 * verified by scripts/check-contrast.mjs.
 *
 * Legacy `color` values from BADGE_COLORS are mapped onto the semantic set so
 * the 5 existing <Badge> call sites keep working.
 */
const BADGE_TONE = {
  neutral: 'text-text-secondary bg-text-secondary/12 border-text-secondary/20',
  accent:  'text-accent bg-accent/12 border-accent/20',
  success: 'text-success bg-success/12 border-success/20',
  warning: 'text-warning bg-warning/12 border-warning/20',
  danger:  'text-danger bg-danger/12 border-danger/20',
};

// Legacy BADGE_COLORS keys → semantic tones.
const LEGACY_TONE = { blue: 'accent', green: 'success', yellow: 'warning', red: 'danger', purple: 'neutral', slate: 'neutral' };

export const Badge = ({ children, tone, color = 'blue', icon: Icon, className = '' }) => {
  const t = tone || LEGACY_TONE[color] || 'neutral';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border text-meta font-medium ${
        BADGE_TONE[t] ?? BADGE_TONE.neutral
      } ${className}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
};

// ── Chip ─────────────────────────────────────────────────────────────────────
/**
 * A control the USER sets — not a fact the platform asserts.
 *
 * UI-001 found a trust chip, a category filter and a valuation-confidence grade
 * rendering visually IDENTICALLY, so a user could not tell a fact from a filter
 * from a machine judgement. The taxonomy that survives a glance:
 *   facts are boxed (Badge/Credential, 10px radius, outlined)
 *   controls are round (Chip, full pill, always interactive)
 *   judgements are typographic (no container at all)
 */
export const Chip = ({ children, selected, onClick, className = '', ...p }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={[
      'inline-flex items-center gap-1.5 px-4 min-h-tap rounded-full text-label',
      'state-layer transition-colors duration-quick',
      selected
        ? 'bg-action-primary text-on-action font-semibold'
        : 'bg-surface-high text-text-secondary border border-subtle font-medium',
      className,
    ].join(' ')}
    {...p}
  >
    {children}
  </button>
);

// ── Credential ───────────────────────────────────────────────────────────────
/**
 * A fact the platform asserts about a person, backed by a stored value.
 *
 * ONE treatment, no variants — trust must look institutional, not gamified.
 * UI-001 found seller tiers rendered as gold/purple/teal gradients with matching
 * coloured glows and ⭐🏆🆕 emoji: the visual vocabulary of airline status and
 * game rank. A credential says "an institution verified something"; a loyalty
 * tier says "this platform is rewarding engagement" — and buyers correctly
 * discount the second.
 *
 * Rank is expressed by CONTENT, never by hue: "47 sales" beside "3 sales" is
 * the ranking. There is deliberately no `tier`, `color`, `variant` or `size`.
 *
 * `basis` is required: every asserted fact must carry a discoverable reason.
 */
export const Credential = ({ icon: Icon, label, basis, onBasisPress, className = '' }) => {
  if (process.env.NODE_ENV !== 'production' && !basis) {
    console.warn('[Credential] `basis` is required — a credential without a discoverable basis is decoration.');
  }
  const Wrapper = onBasisPress ? 'button' : 'span';
  return (
    <Wrapper
      {...(onBasisPress ? { onClick: onBasisPress, type: 'button' } : {})}
      title={basis}
      className={[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control',
        'border border-subtle bg-transparent text-text-primary text-meta font-medium',
        onBasisPress ? 'state-layer min-h-tap' : '',
        className,
      ].join(' ')}
    >
      {Icon && <Icon className="w-3.5 h-3.5 text-text-secondary" aria-hidden="true" />}
      {label}
    </Wrapper>
  );
};

// ── InputField ───────────────────────────────────────────────────────────────
/**
 * `htmlFor`/`id` pairing is the point of this component.
 *
 * UI-001 found ZERO `htmlFor` attributes in the entire codebase — every form
 * label was a bare sibling of its input, so screen readers got no accessible
 * name anywhere in sign-in, sign-up or listing creation. `useId` fixes it for
 * every call site at once.
 *
 * The border is `border-strong` (3.41–5.16:1 across the ramp), not subtle: a
 * form field the user must locate to act on is a WCAG 1.4.11 UI component, and
 * Hebrew form fields in particular must be findable.
 */
export const InputField = ({ label, icon: Icon, rtl, id, error, hint, className = '', ...p }) => {
  const autoId = useId();
  const inputId = id || autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={inputId} className="block text-label text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon
            aria-hidden="true"
            className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-text-muted`}
          />
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            // 16px, NOT the 15px `text-body` role. iOS Safari auto-zooms the
            // page whenever a focused input is under 16px, and since UI-002
            // restored pinch-zoom (removing `user-scalable=no`), that behaviour
            // is live again: every sign-in, price and composer field would zoom
            // on focus and not reliably zoom back in a standalone PWA.
            'w-full px-4 py-3 min-h-tap rounded-control text-base',
            'bg-surface-high text-text-primary placeholder-text-muted',
            'border transition-colors duration-quick',
            error ? 'border-danger' : 'border-strong focus:border-accent',
            // Deliberately NO outline-suppression utility here. That utility
            // compiles to `outline: 2px solid transparent` at specificity
            // (0,2,0), which beats the global `:focus-visible` (0,1,0) and
            // erases the accent ring on the app's most keyboard-relevant
            // control — while the ring's dark box-shadow still paints, leaving
            // a smudge and no ring.
            //
            // Do not write that class name literally anywhere in src/, comments
            // included: Tailwind's content scanner is a plain-text match, so
            // merely NAMING it in prose re-emits the rule into the bundle and
            // re-arms it for any element that later picks the class up.
            Icon ? (rtl ? 'pr-12' : 'pl-12') : '',
            className,
          ].join(' ')}
          dir={rtl ? 'rtl' : 'ltr'}
          {...p}
        />
      </div>
      {error && <p id={`${inputId}-err`} className="text-meta text-danger">{error}</p>}
      {!error && hint && <p id={`${inputId}-hint`} className="text-meta text-text-muted">{hint}</p>}
    </div>
  );
};

// ── BackButton ───────────────────────────────────────────────────────────────
export const BackButton = ({ onClick, rtl, label }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-2 min-h-tap text-text-secondary mb-6 state-layer rounded-control pe-3"
  >
    <span className="w-10 h-10 rounded-control bg-surface-high flex items-center justify-center">
      {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
    </span>
    <span className="text-label">{label}</span>
  </button>
);

// ── State primitives ─────────────────────────────────────────────────────────
// UI-001 counted five unrelated visual languages for "wait" — pulse skeletons,
// shimmer cards, Loader2 spinners, a bespoke SVG ring, and pulsing icon+text —
// which read as three different eras of the app rather than one product.
// Converged: skeletons for lists, LoadingState for single items.

export const LoadingState = ({ label, className = '' }) => (
  <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center py-16 gap-3 ${className}`}>
    <RefreshCw className="w-6 h-6 text-text-muted animate-spin-slow" aria-hidden="true" />
    {label && <p className="text-body-sm text-text-muted">{label}</p>}
  </div>
);

export const EmptyState = ({ icon: Icon, title, subtitle, cta, className = '' }) => (
  <FadeIn className={`flex flex-col items-center justify-center text-center py-16 ${className}`}>
    {Icon && (
      <div className="w-16 h-16 rounded-container bg-surface-high flex items-center justify-center mx-auto mb-4">
        <Icon className="w-8 h-8 text-text-muted" aria-hidden="true" />
      </div>
    )}
    {title && <p className="text-title-sm text-text-primary mb-1">{title}</p>}
    {subtitle && <p className="text-body-sm text-text-muted mb-5 max-w-[260px] leading-relaxed">{subtitle}</p>}
    {cta}
  </FadeIn>
);

/**
 * A failed load is NOT an empty list.
 *
 * UI-001 found `loadOrders`, `loadConversations` and `loadMessages` catching
 * their errors without setting any UI flag, so a failed request rendered
 * pixel-identically to "you have nothing" — the user concluded the app had lost
 * their data. AdminPanel already solved this (documented as the ADMIN-001 fix);
 * the pattern was never carried across. This primitive is that pattern, ready
 * for those three loaders to adopt.
 */
export const ErrorState = ({ title, subtitle, onRetry, retryLabel = 'Retry', className = '' }) => (
  <div role="alert" className={`flex flex-col items-center justify-center text-center py-16 ${className}`}>
    <div className="w-16 h-16 rounded-container bg-danger/12 flex items-center justify-center mx-auto mb-4">
      <AlertCircle className="w-8 h-8 text-danger" aria-hidden="true" />
    </div>
    {title && <p className="text-title-sm text-text-primary mb-1">{title}</p>}
    {subtitle && <p className="text-body-sm text-text-muted mb-5 max-w-[260px] leading-relaxed">{subtitle}</p>}
    {onRetry && <Btn variant="secondary" size="sm" onClick={onRetry}>{retryLabel}</Btn>}
  </div>
);

// ── AnchoredAction ───────────────────────────────────────────────────────────
/**
 * Fixed-bottom shell for a screen's single committing action.
 *
 * UI-001 computed that the results-screen CTA is off-screen on load even in the
 * best case at 375×667: header ~76px + nav ~77px leaves ~514px, and the
 * aspect-[4/5] photo alone consumes ~419px. The fix is anchoring, not padding —
 * adding air would push it further away.
 *
 * Use ONLY when the screen has exactly one committing action. Multi-action
 * screens and scrollable action lists stay inline.
 */
export const AnchoredAction = ({ children, className = '' }) => (
  <div
    className={`fixed inset-x-0 bottom-0 z-sticky flex flex-col items-center px-gutter ${className}`}
    style={{
      paddingBottom: 'max(env(safe-area-inset-bottom), 40px)',
      paddingTop: 24,
      background: 'linear-gradient(to top, rgb(var(--gw-canvas)) 0%, rgb(var(--gw-canvas) / 0.92) 55%, transparent 100%)',
    }}
  >
    {children}
  </div>
);

// ── Sheet ────────────────────────────────────────────────────────────────────
/**
 * The ONE overlay primitive.
 *
 * UI-001 found the bottom sheet copy-pasted 11 times, character-identical, and
 * already drifted on the axes that matter: scrim opacity split 80/70, only 8 of
 * 22 overlays dismissed on scrim tap, only 1 of 22 announced as a dialog, and
 * ZERO implemented a focus trap or Escape. Half the sheets closed on outside
 * tap and half trapped you — on mobile, tap-outside is muscle memory, so a
 * sheet that ignores it feels frozen.
 *
 * Dismissal, focus management, scrim and scroll-lock are behavioural properties
 * of the overlay ROLE, not styling choices, so they live here and only here.
 * NotificationsPanel.jsx got 4 of 6 right and is the base for this API; the two
 * it missed — focus trap and focus restore — are implemented below.
 */

// ── Overlay stack ────────────────────────────────────────────────────────────
/**
 * Module-level registry of every OPEN overlay, innermost last.
 *
 * UI-002A: each Sheet independently attached a capture-phase `keydown` listener
 * to `document`. With two sheets open (a ConfirmSheet raised from inside
 * another sheet — the delete-listing flow does exactly this) BOTH listeners sit
 * on the same node, so `stopPropagation` cannot separate them: it stops the
 * event reaching other NODES, while listeners already registered on the SAME
 * node still run. Escape therefore closed the confirmation AND the sheet
 * underneath it in one keystroke, and Tab was trapped twice, with the outer
 * trap (registered first, so running first) winning and yanking focus out of
 * the dialog the user was actually in.
 *
 * Ownership has to be decided somewhere both instances can see, which is what
 * this stack is. Only the topmost overlay reacts to Escape or Tab.
 *
 * Scroll lock is refcounted through the same stack rather than saved/restored
 * per-sheet: with per-sheet save, a nested sheet captures `overflow: hidden` as
 * its "previous" value and, if the two close out of order, restores the page to
 * permanently locked.
 */
const openOverlays = [];
let scrollLockPrevOverflow = null;

const pushOverlay = (token) => {
  openOverlays.push(token);
  if (openOverlays.length === 1) {
    scrollLockPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
};

const popOverlay = (token) => {
  const i = openOverlays.indexOf(token);
  if (i !== -1) openOverlays.splice(i, 1);
  if (openOverlays.length === 0 && scrollLockPrevOverflow !== null) {
    document.body.style.overflow = scrollLockPrevOverflow;
    scrollLockPrevOverflow = null;
  }
};

/**
 * "Topmost" is decided by DOCUMENT ORDER, not by registration order.
 *
 * Registration order is a trap here: React runs child effects BEFORE parent
 * effects, so a ConfirmSheet nested inside another Sheet registers FIRST and
 * the outer sheet registers second. A naive "last one in wins" therefore hands
 * ownership of Escape and Tab to the sheet UNDERNEATH — the exact inversion of
 * what the user sees, and worse than the bug it was meant to fix.
 *
 * Document order gets both arrangements right without special-casing either: a
 * nested panel is a descendant, so it FOLLOWS its parent; independent sibling
 * overlays share a z-index, so the one painted last is the later sibling. In
 * both cases the visually-topmost panel is the last in document order.
 */
const isTopOverlay = (token) => {
  let top = null;
  for (const o of openOverlays) {
    if (!o.panel?.isConnected) continue;
    if (!top) { top = o; continue; }
    // DOCUMENT_POSITION_FOLLOWING (4) is also set for descendants, which is
    // precisely the nested-sheet case.
    if (top.panel.compareDocumentPosition(o.panel) & 4) top = o;
  }
  return top ? top === token : false;
};

// `:not([disabled])` is not optional. A disabled control still MATCHES a bare
// `button` selector but cannot receive focus, so without it the "first
// focusable" is often a loading Btn, `.focus()` no-ops, focus stays on <body>,
// and `document.activeElement === firstEl` is never true — the trap silently
// does not trap.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Sheet = ({ open, onClose, title, children, labelledBy, className = '' }) => {
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  // Whether the gesture that is about to produce a `click` STARTED on the
  // scrim. Without this, selecting text inside the sheet and releasing the
  // pointer over the scrim dismisses it: the resulting click event targets the
  // nearest common ancestor, which is the scrim.
  const pressStartedOnScrim = useRef(false);
  const headingId = useId();

  // `onClose` is almost always an inline lambda, so putting it in the dependency
  // array would tear down and re-run this effect on every parent render — which
  // means restoring focus to the trigger and releasing the scroll lock in the
  // middle of an open sheet. Held in a ref so the effect depends only on `open`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    // This instance's entry in the overlay registry. It carries the panel node
    // because topmost-ness is resolved by comparing panels in document order.
    const panel = panelRef.current;
    const token = { panel };

    // Remember what opened us so focus can be restored on close.
    triggerRef.current = document.activeElement;

    // Registers this overlay as topmost AND takes the refcounted scroll lock.
    pushOverlay(token);

    // Focusables are recomputed on every keystroke, never cached: sheet content
    // is frequently conditional (a Btn that becomes `loading`, a field that
    // appears after a choice), so a list captured at open time goes stale.
    const focusables = () =>
      Array.from(panel?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []).filter(
        (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('[aria-hidden="true"], [inert]')
      );

    // Focus the first real control; fall back to the panel itself (tabIndex=-1)
    // so focus is never left on <body> behind the scrim.
    const first = focusables()[0];
    (first ?? panel)?.focus?.();

    const onKeyDown = (e) => {
      // Nested overlays: only the innermost one reacts. See `overlayStack`.
      if (!isTopOverlay(token)) return;

      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const els = focusables();
      if (els.length === 0) return;
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      const active = document.activeElement;

      // Focus is not on a control inside the panel — either it escaped entirely
      // (the browser moved on to page chrome) or it is resting on the panel box
      // itself, which is where the open-time fallback and any unmounted control
      // leave it. `contains` counts the panel as containing itself, so that
      // second case has to be named explicitly or Tab does nothing at all.
      // Either way, pull focus to a known end rather than letting it walk into
      // the page behind the scrim.
      if (!panel?.contains(active) || active === panel) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus();
        return;
      }
      if (e.shiftKey && active === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      popOverlay(token);

      // Restore focus to the trigger — but ONLY if focus is still ours to move.
      // A sheet whose action navigates elsewhere legitimately hands focus to
      // the new screen; yanking it back to a stale trigger is focus thrash, and
      // a trigger that has since unmounted would send focus to <body> and lose
      // the user's position entirely.
      const active = document.activeElement;
      const focusIsOurs = !active || active === document.body || panel?.contains(active);
      const trigger = triggerRef.current;
      if (focusIsOurs && trigger?.isConnected) trigger.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-sheet flex items-end justify-center animate-fadeIn"
      style={{ background: 'rgb(var(--gw-scrim) / 0.64)' }}
      // Dismiss only when the WHOLE gesture belongs to the scrim. `e.target ===
      // e.currentTarget` rejects clicks that merely bubbled up from the panel;
      // the mousedown latch additionally rejects a press that began inside the
      // sheet and ended outside it (text selection, a mistimed drag), which the
      // target check alone cannot see because the click lands on the ancestor.
      onMouseDown={(e) => { pressStartedOnScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const fromScrim = e.target === e.currentTarget && pressStartedOnScrim.current;
        pressStartedOnScrim.current = false;
        if (fromScrim) onClose?.();
      }}
    >
      {/* stopPropagation is now belt-and-braces rather than the mechanism — the
          scrim's own target check is what guarantees a body click cannot close
          the sheet, including for children that legitimately re-dispatch. */}
      <SlideUp className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy || (title ? headingId : undefined)}
          aria-label={!title && !labelledBy ? 'Dialog' : undefined}
          tabIndex={-1}
          className={`bg-surface border-t border-subtle shadow-sheet p-6 space-y-5 ${className}`}
          style={{
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
          }}
        >
          {/* Drag affordance — decorative, hidden from assistive tech. */}
          <div className="w-12 h-1 bg-text-muted/40 rounded-full mx-auto" aria-hidden="true" />
          {title && (
            <h2 id={headingId} className="text-title text-text-primary text-center">
              {title}
            </h2>
          )}
          {children}
        </div>
      </SlideUp>
    </div>
  );
};

// ── ConfirmSheet ─────────────────────────────────────────────────────────────
// Thin wrapper over <Sheet>, kept so the existing call site does not change.
export const ConfirmSheet = ({
  open, icon, title, body,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  onClose, onConfirm, destructive = true,
}) => (
  <Sheet open={open} onClose={onClose} title={title}>
    <div className="text-center space-y-3">
      {icon && (
        <div className={`w-14 h-14 rounded-container flex items-center justify-center mx-auto ${destructive ? 'bg-danger/12' : 'bg-surface-high'}`}>
          {icon}
        </div>
      )}
      {body && <p className="text-body-sm text-text-muted leading-relaxed">{body}</p>}
    </div>
    <div className="flex gap-3 pt-1">
      <Btn variant="secondary" fullWidth onClick={onClose}>{cancelLabel}</Btn>
      <Btn
        variant={destructive ? 'destructive' : 'primary'}
        fullWidth
        onClick={() => { haptic(15); onConfirm(); }}
      >
        {confirmLabel}
      </Btn>
    </div>
  </Sheet>
);
