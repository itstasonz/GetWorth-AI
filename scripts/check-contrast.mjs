#!/usr/bin/env node
/**
 * UI-002 — Design-system contrast verification.
 *
 * Computes WCAG 2.1 relative-luminance contrast ratios for every text/surface
 * pair the design system declares, and fails if any pair is below its required
 * threshold. Run via `npm run check:contrast` (also wired into `npm test`).
 *
 * Why this exists: UI-001 found six shipped text pairs below 4.5:1, including a
 * 1.71:1 failure on condition — the single most price-relevant fact on a listing.
 * Contrast was previously asserted in review comments and drifted. Here it is
 * arithmetic that runs from `npm test`. (There is no CI runner in this repo.)
 *
 * Method: sRGB → linear (WCAG 2.x transfer), L = 0.2126R + 0.7152G + 0.0722B,
 * ratio = (Lhi + 0.05) / (Llo + 0.05). Translucent fills are alpha-composited
 * over their stated backdrop before measurement, because that is what the eye
 * actually receives.
 */

// ── colour math ──────────────────────────────────────────────────────────────
const hexToRgb = (hex) => {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Alpha-composite `fg` at opacity `a` over opaque `bg`. */
const over = (fg, bg, a) => {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  const out = f.map((v, i) => Math.round(v * a + b[i] * (1 - a)));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
};

// ── the design system's declared values ──────────────────────────────────────
// PARSED from src/index.css, never hand-copied.
//
// An earlier revision of this file duplicated the fifteen token values as a JS
// object with a comment saying "if you change a token there, change it here".
// That is an eighth parallel declaration, in the very tool whose job is to stop
// parallel declarations — and it would have gone stale exactly the way the
// original seven did. The check now reads the source it is checking.
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

/** Read `--gw-<name>: r g b;` out of :root and return it as #rrggbb. */
const token = (name) => {
  const m = CSS.match(new RegExp(`--gw-${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  if (!m) throw new Error(`check-contrast: --gw-${name} not found in src/index.css`);
  return '#' + m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
};

const T = {
  canvas:         token('canvas'),
  surface:        token('surface'),
  elevated:       token('elevated'),
  surfaceHigh:    token('surface-high'),
  surfaceHighest: token('surface-highest'),
  textPrimary:    token('text-primary'),
  textSecondary:  token('text-secondary'),
  textMuted:      token('text-muted'),
  accent:         token('accent'),
  onAccent:       token('on-accent'),
  success:        token('success'),
  warning:        token('warning'),
  danger:         token('danger'),
  borderSubtle:   token('border-subtle'),
  borderStrong:   token('border-strong'),
};

const AA_NORMAL = 4.5; // WCAG 1.4.3 — body text
const AA_LARGE = 3.0;  // ≥18.66px bold or ≥24px
const AA_NONTEXT = 3.0; // WCAG 1.4.11 — UI component boundaries / focus ring

// [label, foreground, background, threshold]
const PAIRS = [
  // Body text on every surface in the ramp
  ['text-primary on canvas',        T.textPrimary,   T.canvas,      AA_NORMAL],
  ['text-primary on surface',       T.textPrimary,   T.surface,     AA_NORMAL],
  ['text-primary on elevated',      T.textPrimary,   T.elevated,    AA_NORMAL],
  ['text-primary on surface-high',  T.textPrimary,   T.surfaceHigh, AA_NORMAL],
  ['text-secondary on canvas',      T.textSecondary, T.canvas,      AA_NORMAL],
  ['text-secondary on surface',     T.textSecondary, T.surface,     AA_NORMAL],
  ['text-secondary on elevated',    T.textSecondary, T.elevated,    AA_NORMAL],
  ['text-secondary on surface-high',T.textSecondary, T.surfaceHigh, AA_NORMAL],
  ['text-muted on canvas',          T.textMuted,     T.canvas,         AA_NORMAL],
  ['text-muted on surface',         T.textMuted,     T.surface,        AA_NORMAL],
  ['text-muted on elevated',        T.textMuted,     T.elevated,       AA_NORMAL],
  ['text-muted on surface-high',    T.textMuted,     T.surfaceHigh,    AA_NORMAL],
  // The real worst case: the lightest surface a muted caption may sit on.
  ['text-muted on surface-highest', T.textMuted,     T.surfaceHighest, AA_NORMAL],
  ['text-secondary on highest',     T.textSecondary, T.surfaceHighest, AA_NORMAL],
  ['text-primary on highest',       T.textPrimary,   T.surfaceHighest, AA_NORMAL],

  // Accent as text/icon
  ['accent on canvas',              T.accent,        T.canvas,      AA_NORMAL],
  ['accent on surface',             T.accent,        T.surface,     AA_NORMAL],
  ['accent on elevated',            T.accent,        T.elevated,    AA_NORMAL],
  ['accent on surface-high',        T.accent,        T.surfaceHigh, AA_NORMAL],

  // Accent as a FILL (the 1.71:1 failure class from UI-001 §19.1)
  ['on-accent text on accent fill', T.onAccent,      T.accent,      AA_NORMAL],

  // Semantic text on every surface — these are the badge/chip recipe
  ['success on canvas',             T.success,       T.canvas,      AA_NORMAL],
  ['success on surface',            T.success,       T.surface,     AA_NORMAL],
  ['success on elevated',           T.success,       T.elevated,    AA_NORMAL],
  ['warning on canvas',             T.warning,       T.canvas,      AA_NORMAL],
  ['warning on surface',            T.warning,       T.surface,     AA_NORMAL],
  ['warning on elevated',           T.warning,       T.elevated,    AA_NORMAL],
  ['danger on canvas',              T.danger,        T.canvas,      AA_NORMAL],
  ['danger on surface',             T.danger,        T.surface,     AA_NORMAL],
  ['danger on elevated',            T.danger,        T.elevated,    AA_NORMAL],

  // Badge recipe: semantic text over its own 12%-alpha tint on each surface.
  // This is the ONLY sanctioned badge mechanism — verified, not asserted.
  ['success badge on canvas',  T.success, over(T.success, T.canvas,  0.12), AA_NORMAL],
  ['success badge on surface', T.success, over(T.success, T.surface, 0.12), AA_NORMAL],
  ['warning badge on canvas',  T.warning, over(T.warning, T.canvas,  0.12), AA_NORMAL],
  ['warning badge on surface', T.warning, over(T.warning, T.surface, 0.12), AA_NORMAL],
  ['danger badge on canvas',   T.danger,  over(T.danger,  T.canvas,  0.12), AA_NORMAL],
  ['danger badge on surface',  T.danger,  over(T.danger,  T.surface, 0.12), AA_NORMAL],
  ['accent badge on canvas',   T.accent,  over(T.accent,  T.canvas,  0.12), AA_NORMAL],
  ['accent badge on surface',  T.accent,  over(T.accent,  T.surface, 0.12), AA_NORMAL],
  // Worst case for the badge recipe: the tint sitting on the lightest surface.
  ['success badge on highest',  T.success, over(T.success, T.surfaceHighest, 0.12), AA_NORMAL],
  ['warning badge on highest',  T.warning, over(T.warning, T.surfaceHighest, 0.12), AA_NORMAL],
  ['danger badge on highest',   T.danger,  over(T.danger,  T.surfaceHighest, 0.12), AA_NORMAL],
  ['accent badge on highest',   T.accent,  over(T.accent,  T.surfaceHighest, 0.12), AA_NORMAL],

  // Non-text: focus ring and strong borders must clear 3:1 on every surface
  ['focus ring on canvas',       T.accent,       T.canvas,      AA_NONTEXT],
  ['focus ring on surface',      T.accent,       T.surface,     AA_NONTEXT],
  ['focus ring on elevated',     T.accent,       T.elevated,    AA_NONTEXT],
  ['focus ring on surface-high', T.accent,       T.surfaceHigh, AA_NONTEXT],
  // border-strong is the INPUT / focusable-container boundary, so WCAG 1.4.11
  // applies on every surface it can sit on. (border-subtle is decorative
  // grouping only — dividers are explicitly out of scope for 1.4.11 and are
  // deliberately not asserted here.)
  ['border-strong on canvas',       T.borderStrong, T.canvas,      AA_NONTEXT],
  ['border-strong on surface',      T.borderStrong, T.surface,     AA_NONTEXT],
  ['border-strong on elevated',     T.borderStrong, T.elevated,    AA_NONTEXT],
  ['border-strong on surface-high', T.borderStrong, T.surfaceHigh, AA_NONTEXT],
  ['border-strong on highest',      T.borderStrong, T.surfaceHighest, AA_NONTEXT],
];

// ── run ──────────────────────────────────────────────────────────────────────
let failed = 0;
const rows = PAIRS.map(([label, fg, bg, min]) => {
  const ratio = contrast(fg, bg);
  const pass = ratio >= min;
  if (!pass) failed++;
  return { label, ratio: ratio.toFixed(2), min: min.toFixed(1), pass };
});

const width = Math.max(...rows.map((r) => r.label.length));
console.log('\nUI-002 — design-system contrast verification (WCAG 2.1)\n');
for (const r of rows) {
  console.log(
    `  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label.padEnd(width)}  ${r.ratio.padStart(6)}:1  (min ${r.min}:1)`
  );
}
console.log(`\n  ${rows.length - failed}/${rows.length} pairs pass.\n`);

if (failed > 0) {
  console.error(`✗ ${failed} contrast pair(s) below threshold. Fix the token, not the test.\n`);
  process.exit(1);
}
console.log('✓ All declared token pairs meet WCAG AA.\n');
