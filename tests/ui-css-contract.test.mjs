/**
 * UI-002A — CSS contract, asserted against COMPILED output.
 *
 * Why compiled and not source: every blocker in this file was a case where the
 * source read correctly and the emitted stylesheet did not.
 *
 *  · The badge system was specified as "semantic text over its own 12% tint",
 *    a contrast script asserted twelve passing ratios for that composite, and
 *    Tailwind emitted NO RULE for `/12` because the bare modifier was off
 *    `theme.opacity`. Green tests, transparent badges.
 *  · A focus-suppression utility can be resurrected into the bundle by a source
 *    COMMENT, because Tailwind's content scanner is a plain-text match. Reading
 *    the JSX would never reveal it.
 *
 * So these assertions parse the stylesheet the browser would receive. Tailwind
 * is invoked directly rather than reading dist/ so the suite is self-contained
 * and cannot pass against a stale build.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'node_modules/.cache/ui-002a/compiled.css');

// The mutation harness (tests/mutations/ui-run.mjs) redirects these to broken
// COPIES so it can ask "would this suite notice?" without ever writing to the
// real files. Copies live beside their originals so relative resolution — the
// Tailwind content globs, the @tailwind directives — behaves identically.
const CSS_IN = process.env.UI002A_CSS_PATH || join(ROOT, 'src/index.css');
const TW_CONFIG = process.env.UI002A_TW_CONFIG || null;
const INDEX_HTML = process.env.UI002A_INDEX_HTML || join(ROOT, 'index.html');

let css;

before(() => {
  mkdirSync(join(ROOT, 'node_modules/.cache/ui-002a'), { recursive: true });
  execFileSync(
    join(ROOT, 'node_modules/.bin/tailwindcss'),
    ['-i', CSS_IN, '-o', OUT, ...(TW_CONFIG ? ['-c', TW_CONFIG] : [])],
    { cwd: ROOT, stdio: 'pipe' }
  );
  // Comments contain no braces, so the block regex below would otherwise absorb
  // a preceding /* … */ into the following rule's SELECTOR and no lookup would
  // ever match. Strip them first.
  css = readFileSync(OUT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
});

/** Every innermost `selector { declarations }` block in the sheet. */
const rules = () => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), decls: m[2] }));

/** The body of an at-rule, resolved by brace matching. */
const atRuleBody = (needle) => {
  const start = css.indexOf(needle);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
};

// ── 1 & 2. Focus visibility ─────────────────────────────────────────────────
describe('focus-visible', () => {
  test('never mutates a component radius', () => {
    // A bare `:focus-visible` has the same specificity (0,1,0) as
    // `.rounded-control` / `.rounded-full` but is emitted later, so a
    // border-radius here RESHAPES the focused control: a focused pill collapses
    // to a rectangle, and `.state-layer::after` inherits the wrong shape too.
    const offenders = rules().filter(
      (r) => r.selector.includes(':focus-visible') && /(^|[;\s])border-radius\s*:/.test(r.decls)
    );
    assert.deepEqual(offenders.map((r) => r.selector), [],
      'focus styling must not set border-radius — the outline already follows the element');
  });

  test('draws a visible ring', () => {
    const base = rules().find((r) => r.selector === ':focus-visible');
    assert.ok(base, 'a global :focus-visible rule must exist');
    assert.match(base.decls, /outline\s*:\s*2px solid/, 'focus ring must be a real, non-transparent outline');
    assert.match(base.decls, /outline-offset/, 'the ring must stand off the control to stay legible');
  });

  test('inverts on accent fills so the ring cannot vanish', () => {
    // A teal ring on a teal button is invisible. The inversion rule is the only
    // thing preventing a focused primary button from having no indicator at all.
    const inv = rules().find(
      (r) => r.selector.includes('.bg-action-primary:focus-visible') && /outline-color/.test(r.decls)
    );
    assert.ok(inv, 'accent-filled controls need an inverted focus ring');
  });

  test('no utility re-suppresses the ring anywhere in the bundle', () => {
    // Tailwind only emits a utility it has SEEN in the content globs, so any
    // occurrence here means a live call site (or a comment naming the class).
    for (const banned of ['outline-none', 'focus\\:ring-0']) {
      assert.ok(!css.includes(banned),
        `"${banned}" is emitted — it beats :focus-visible at (0,2,0) and erases the ring`);
    }
  });
});

// ── The /12 tint ladder ─────────────────────────────────────────────────────
describe('opacity ladder', () => {
  test('emits the badge tint recipe rather than silently dropping it', () => {
    // Tailwind 3 validates BARE numeric modifiers against theme.opacity, whose
    // default is multiples of 5. `bg-accent/12` off that scale emits NOTHING.
    for (const cls of ['bg-accent\\/12', 'bg-success\\/12', 'bg-danger\\/12']) {
      assert.ok(css.includes(cls), `${cls} produced no rule — the badge tint would be invisible`);
    }
  });

  test('tokens are channel triplets so opacity modifiers can apply at all', () => {
    const rule = rules().find((r) => r.selector === '.bg-accent\\/12');
    assert.ok(rule, 'the .bg-accent/12 rule must exist');
    // A token mapped to `var(--color-x)` returns a COMPLETE colour, which
    // cannot take an alpha modifier — that is what made the tint vanish.
    assert.match(rule.decls, /rgb\(var\(--gw-accent\)\s*\/\s*0?\.12\)/,
      'tokens must compile to rgb(var(--x) / <alpha>), not a complete colour');
  });
});

// ── Reduced motion ──────────────────────────────────────────────────────────
describe('prefers-reduced-motion', () => {
  test('neutralises duration AND infinite iteration, universally', () => {
    const body = atRuleBody('@media (prefers-reduced-motion: reduce)');
    assert.ok(body, 'a global reduced-motion rule must exist');

    assert.match(body, /\*\s*,/, 'must apply universally, so component-level <style> blocks are reached');
    assert.match(body, /animation-duration:\s*0\.01ms\s*!important/);
    assert.match(body, /transition-duration:\s*0\.01ms\s*!important/);
    // Without capping iterations, a 0.01ms animation set to `infinite` simply
    // respawns forever and pins the CPU — quietly worse than the animation.
    assert.match(body, /animation-iteration-count:\s*1\s*!important/,
      'infinite decorative loops must be stopped, not merely shortened');
  });

  test('pseudo-elements are covered', () => {
    const body = atRuleBody('@media (prefers-reduced-motion: reduce)');
    assert.match(body, /:before/, 'the ::before state layer animates too');
    assert.match(body, /:after/, 'the ::after state layer animates too');
  });
});

// ── iOS input zoom ──────────────────────────────────────────────────────────
describe('iOS input zoom', () => {
  test('the document base size is at or above the 16px zoom threshold', () => {
    const body = rules().find((r) => r.selector === 'body' && /font-size/.test(r.decls));
    assert.ok(body, 'body must declare an explicit base size');
    const px = Number(body.decls.match(/font-size:\s*(\d+)px/)?.[1]);
    assert.ok(px >= 16, `body font-size is ${px}px — iOS Safari auto-zooms below 16px`);
  });

  test('pinch-zoom is not disabled in the document', () => {
    // The 16px floor and pinch-zoom are the same accessibility story: with
    // user-scalable=no there is no way to recover from small type at all.
    const html = readFileSync(INDEX_HTML, 'utf8');
    const viewport = html.match(/<meta\s+name="viewport"[^>]*>/)?.[0] ?? '';
    assert.ok(!/user-scalable\s*=\s*no/.test(viewport), 'user-scalable=no is a WCAG 1.4.4 failure');
    assert.ok(!/maximum-scale\s*=\s*1/.test(viewport), 'maximum-scale=1 disables zoom on iOS');
  });
});
