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

// ── UI-002B: the closed scales, as COMPILED ─────────────────────────────────
// A scale that is "closed" in the config but emits extra steps, or emits its
// steps at the wrong value, is not closed. These read the stylesheet.
describe('closed scales', () => {
  test('the sanctioned radius steps compile to their declared values, 6px apart', () => {
    // Named for what it actually checks. It does NOT assert exclusivity — the
    // bundle still ships rounded-md/lg/xl/2xl/3xl from ~246 un-migrated call
    // sites, which is the `arbitrary-radius` budget's job to retire.
    const px = (sel) => {
      const rule = rules().find((r) => r.selector === sel);
      assert.ok(rule, `${sel} must exist`);
      const n = Number(rule.decls.match(/border-radius:\s*([\d.]+)px/)?.[1]);
      assert.ok(Number.isFinite(n), `${sel} has no pixel border-radius`);
      return n;
    };
    const control = px('.rounded-control');
    const container = px('.rounded-container');
    assert.equal(control, 10);
    assert.equal(container, 16);
    // Subtracting the PARSED values, not the literals. Written as `16 - 10 === 6`
    // this asserted arithmetic about two constants and would have held while
    // both tokens changed underneath it. The nesting rule (inner = outer −
    // padding) only works while the real gap stays 6px.
    assert.equal(container - control, 6,
      'the nesting rule depends on this gap — a correctly-padded control no longer lands on `control`');
  });

  test('every sanctioned elevation utility resolves to its token', () => {
    // Tailwind emits a utility only where it has SEEN it, so an unused step
    // legitimately produces no rule — `shadow-raised` currently has zero call
    // sites. What must hold is that each step which IS in the bundle reads the
    // custom property rather than carrying its own copy of the numbers; two
    // copies of a shadow is how the app reached 13 distinct shadow strings.
    const sanctioned = ['raised', 'overlay', 'sheet']
      .map((n) => rules().find((r) => r.selector === `.shadow-${n}`))
      .filter(Boolean);

    // `> 0` would pass with two of the three silently gone. `shadow-raised` has
    // no call sites today (recorded as debt), so the honest floor is the two
    // that Sheet and Toast actually use.
    assert.ok(sanctioned.length >= 2,
      `only ${sanctioned.length} sanctioned elevation utilities reached the bundle; Sheet and Toast need shadow-sheet and shadow-overlay`);
    for (const rule of sanctioned) {
      assert.match(rule.decls, /var\(--gw-shadow-/,
        `${rule.selector} inlines its shadow instead of reading the token`);
    }
  });

  test('the design system itself ships no coloured glow', () => {
    // A coloured shadow is a glow, and a glow is the single clearest "neon
    // fintech / gaming UI" signal. Views still carry several (tracked by the
    // `ad-hoc-shadow` budget in scripts/design-lint.mjs, which only ratchets
    // down); what this asserts is narrower and permanent — none of them may
    // come from a token the design system declares.
    for (const name of ['raised', 'overlay', 'sheet']) {
      const rule = rules().find((r) => r.selector === `.shadow-${name}`);
      if (!rule) continue;
      const coloured = /(?:rgb|hsl)a?\([^)]*\)/g;
      for (const c of rule.decls.match(coloured) ?? []) {
        const nums = c.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
        assert.ok(nums.length < 3 || (nums[0] === nums[1] && nums[1] === nums[2]),
          `${rule.selector} carries a coloured shadow (${c}) — elevation is neutral`);
      }
    }
  });

  test('the named spacing steps compile to the 8-point rhythm', () => {
    const gap = (n) => rules().find((r) => r.selector === `.gap-${n}`)?.decls ?? '';
    assert.match(gap('stack'), /gap:\s*0\.75rem/,   'stack = 12px, between related elements');
    assert.match(gap('group'), /gap:\s*1\.5rem/,    'group = 24px, between groups');
    assert.match(gap('section'), /gap:\s*2\.5rem/,  'section = 40px, between sections');
  });

  test('the 44px touch floor is a real utility, not a convention', () => {
    const h = rules().find((r) => r.selector === '.min-h-tap');
    const w = rules().find((r) => r.selector === '.min-w-tap');
    assert.ok(h && w, 'both min-h-tap and min-w-tap must exist');
    assert.match(h.decls, /min-height:\s*2\.75rem/);
    assert.match(w.decls, /min-width:\s*2\.75rem/);
  });
});

// ── Brand typography is actually applied ────────────────────────────────────
describe('global typography', () => {
  test('the brand face reaches the document, not just the inline call sites', () => {
    // UI-001's highest-leverage finding: the app preloaded three brand font
    // files and then rendered ~99% of its text in the OS UI font, because
    // nothing set a family on html or body. Preloading a font you do not apply
    // is a pure cost. This asserts the family actually lands.
    const applied = rules().filter(
      (r) => /(^|,)\s*(html|body)\s*$/.test(r.selector) && /font-family/.test(r.decls)
    );
    assert.ok(applied.length > 0, 'neither html nor body declares a font-family');
    const decls = applied.map((r) => r.decls).join(' ');
    assert.match(decls, /Inter/, 'the brand body face must be applied globally');
    assert.match(decls, /Heebo/, 'the Hebrew face must be in the global stack, not only inline');
  });

  test('Hebrew has real coverage rather than a silent fallback', () => {
    // Manrope and Inter carry no Hebrew glyphs. Heebo is aliased UNDER both
    // family names by unicode-range so Hebrew resolves automatically at the
    // ~58 call sites that name a Latin family inline. If those @font-face
    // blocks lose their Hebrew range, Hebrew silently falls back to the OS font
    // and the app renders in two typefaces at once.
    const hebrew = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((b) => /unicode-range:[^;]*U\+0590/i.test(b));
    assert.ok(hebrew.length >= 2,
      'expected Hebrew-ranged faces aliased under both Latin family names');
    const families = hebrew.map((b) => b.match(/font-family:\s*'([^']+)'/)?.[1]);
    for (const f of ['Manrope', 'Inter']) {
      assert.ok(families.includes(f), `"${f}" has no Hebrew-ranged face — Hebrew would fall back`);
    }
  });

  test('the type floor is a variable, and Hebrew raises it', () => {
    // Heebo has a smaller x-height at the same nominal size and no case
    // distinction to aid word-shape recognition, so the DEFAULT language was
    // strictly harder to read than the secondary one until this existed.
    const root = rules().filter((r) => r.selector === ':root').map((r) => r.decls).join(' ');
    const he = rules().find((r) => r.selector === ':lang(he)');
    assert.match(root, /--gw-type-floor:\s*12px/);
    assert.ok(he, ':lang(he) must raise the floor');
    assert.match(he.decls, /--gw-type-floor:\s*13px/);
    // Order matters: identical specificity, both match <html>, so Hebrew must
    // come second to win.
    assert.ok(css.indexOf(':lang(he)') > css.lastIndexOf('--gw-type-floor: 12px'),
      'the Hebrew floor must be declared after the default or it never applies');
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
