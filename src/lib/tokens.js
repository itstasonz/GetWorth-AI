/**
 * GetWorth design tokens — JS mirror (UI-002)
 *
 * This file exists for ONE reason: inline `style={{}}` props cannot use Tailwind
 * classes, and the app has ~340 of them across five view files. It is NOT a
 * second source of truth — the `/* @gw <role> *\/` annotations below are checked
 * against src/index.css by scripts/design-lint.mjs, so the two cannot drift.
 * If it can be a className, it MUST be a className.
 *
 * ── Why the STITCH/C re-exports at the bottom ──
 * UI-001 found SEVEN parallel token declarations: :root, tailwind.config.js, and
 * five file-local objects (STITCH ×3, SELL_STITCH, C). They had already diverged
 * — GLASS_BG shipped at 0.4 in HomeView and 0.6 in CameraResultsView, so glass
 * panels were visibly different weights on adjacent screens.
 *
 * The shim collapses 7 declarations to 1 without a rewrite: each view deletes
 * its literal object and adds one import. Key names are preserved EXACTLY, so
 * no call site changes. Delete a key when its last consumer becomes a
 * className; the shim is finished when the objects are empty.
 */

// ── Canonical JS mirror of the CSS custom properties ────────────────────────
export const T = {
  // Surfaces
  canvas:         /* @gw canvas          */ '#131313',
  sunken:         /* @gw sunken          */ '#0E0E0E',
  surface:        /* @gw surface         */ '#1C1B1B',
  elevated:       /* @gw elevated        */ '#201F1F',
  surfaceHigh:    /* @gw surface-high    */ '#2A2A2A',
  surfaceHighest: /* @gw surface-highest */ '#353534',

  // Text — one temperature (warm sage). Verified against the LIGHTEST surface,
  // not merely canvas: 12.08 / 8.66 / 4.71 on #353534.
  textPrimary:   /* @gw text-primary   */ '#EDEBEA',
  textSecondary: /* @gw text-secondary */ '#C2CBC9',
  textMuted:     /* @gw text-muted     */ '#96A3A1',

  // Brand / action
  accent:    /* @gw accent    */ '#6FEEE1',
  accentDim: /* @gw accent-dim*/ '#4FD1C5',
  onAccent:  /* @gw on-accent */ '#003733',

  // Semantic — one hue per meaning. `info` is deliberately neutral.
  success: /* @gw success */ '#3FCF93',
  warning: /* @gw warning */ '#EFB03A',
  danger:  /* @gw danger  */ '#FF9E93',
  info:    /* @gw info    */ '#C2CBC9',

  // Borders
  borderSubtle: /* @gw border-subtle */ '#2E2D2D',
  borderStrong: /* @gw border-strong */ '#7C8A86',
};

export const FONT_DISPLAY = '"Manrope", "Heebo", system-ui, -apple-system, sans-serif';
export const FONT_BODY    = '"Inter", "Heebo", system-ui, -apple-system, sans-serif';

/**
 * Safe-area fallbacks. The `max(env(safe-area-inset-*), fallback)` pattern is
 * already correct and consistent app-wide; these constants stop the fallback
 * numbers being retyped at each call site. The fallback is NEVER 0.
 */
export const SAFE_AREA = {
  top: 12,
  bottom: 16,
  bottomAnchored: 40, // thumb clearance under an anchored primary action
  side: 16,
};

/**
 * Elevation. Depth is carried by surface TONE (Material 3's tonal model);
 * shadow appears only where content floats over content it cannot predict.
 * Replaces 18 inline boxShadow declarations in 13 distinct strings.
 */
export const ELEVATION = {
  flat:    { background: T.canvas },
  raised:  { background: T.surface, border: `1px solid ${T.borderSubtle}` },
  overlay: { background: T.elevated, border: `1px solid ${T.borderSubtle}`, boxShadow: '0 8px 24px rgb(0 0 0 / 0.44)' },
  sheet:   { background: T.surface, boxShadow: '0 -8px 32px rgb(0 0 0 / 0.48)' },
};

// ═══════════════════════════════════════════════════════════════════════════
// DEPRECATED SHIMS — do not reference from new code.
//
// These exist ONLY so the five view-local objects can be deleted without
// touching their call sites. Every key removed here is progress.
// scripts/design-lint.mjs tracks `legacy-token-import` on a budget that only
// ratchets down.
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated Use Tailwind token classes. Shim for HomeView / AuthProfileView / CameraResultsView. */
export const STITCH = {
  background:              T.canvas,
  primary:                 T.accent,
  primaryContainer:        T.accentDim,
  onPrimary:               T.onAccent,
  onSurface:               T.textPrimary,
  onSurfaceVariant:        T.textSecondary,
  surfaceContainerLowest:  T.sunken,
  surfaceContainerLow:     T.surface,
  surfaceContainer:        T.elevated,
  surfaceContainerHigh:    T.surfaceHigh,
  surfaceContainerHighest: T.surfaceHighest,
  outlineVariant:          T.borderSubtle,
  error:                   T.danger,
  // The one intentional pixel change in the shim: HomeView shipped GLASS_BG at
  // 0.4 and CameraResultsView at 0.6 under the same name. 0.4 wins on use count.
  GRADIENT_PRIMARY: `linear-gradient(135deg, ${T.accent} 0%, ${T.accentDim} 100%)`,
  GLASS_BG:         'rgba(53, 53, 52, 0.4)',
  GLASS_BORDER:     '1px solid rgba(255, 255, 255, 0.05)',
  GLASS_BLUR:       'blur(24px)',
  FONT_HEADLINE:    FONT_DISPLAY,
  FONT_BODY,
};

/** @deprecated Shim for ChatViews' `C` object — key names preserved exactly. */
export const C = {
  surfaceDim:    T.canvas,
  surfaceLow:    T.surface,
  surface:       T.elevated,
  surfaceHigh:   T.surfaceHigh,
  surfaceLowest: T.sunken,
  primary:       T.accent,
  primaryCont:   T.accentDim,
  onPrimary:     T.onAccent,
  onSurface:     T.textPrimary,
  onSurfaceVar:  T.textSecondary,
  outline:       T.borderSubtle,
};
