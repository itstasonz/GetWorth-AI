#!/usr/bin/env node
/**
 * UI-002 — Design-system enforcement.
 *
 * UI-001's root-cause finding was that the previous token layer was DOCUMENTED
 * rather than ENFORCED: a comment in index.css saying "screens can use
 * text-primary" produced zero uses (and pointed at the wrong token). This file
 * is the difference between a design system and a design suggestion.
 *
 * ── Budgets, not bans ──
 * Every rule carries a maximum that may only ratchet DOWN. A hard ban would
 * fail on day one against 340 pre-existing literals and would simply be
 * switched off. A budget fails the build the moment a violation is ADDED, while
 * every migrated file lowers a number. Regenerate after real migration work:
 *
 *     node scripts/design-lint.mjs --update
 *
 * ── UI-002B: --update is now RATCHET-ONLY ──
 * It previously rewrote every budget to the CURRENT count, which meant the
 * documented rule ("may only ratchet down") was enforced by nothing but good
 * manners: adding 40 gradients and running --update turned a red build green
 * and recorded the regression as the new normal, in a diff line that reads
 * identically to a legitimate improvement. A budget that rises to meet reality
 * is not a budget.
 *
 * --update now writes a number ONLY when it is lower than the recorded one, and
 * REFUSES THE WHOLE UPDATE if any rule is over budget. Raising a budget requires
 * hand-editing the ledger below, which is visible in review as exactly what it
 * is. There is deliberately no --force.
 *
 * Escape hatch: `// design-lint-disable` on the offending line — itself budgeted
 * as `lint-suppression`, so silencing a rule costs a visible ledger edit.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Assembled rather than written literally, so this file's own use of the marker
// in comments and rule text does not register as a suppression when the linter
// is ever pointed at a tree containing it.
const DISABLE_MARKER = 'design-lint' + '-disable';

const ROOT = new URL('..', import.meta.url).pathname;

// ── Fixture mode ────────────────────────────────────────────────────────────
// The linter must be testable against a fixture tree — a linter nobody tests
// silently stops matching after a refactor and reports a clean build forever.
//
// But the first version of this read DESIGN_LINT_SRC straight from the
// environment on the production path, which meant a single variable disabled
// the entire gate:
//
//     DESIGN_LINT_SRC=/tmp/empty npm test     → 14/14 rules pass, exit 0
//
// `npm test` inherits the caller's environment, so that is not a hypothetical.
// A gate whose corpus is caller-supplied is not a gate. The redirect now
// requires an EXPLICIT --fixture argument as well: an env var alone cannot move
// the target, and --fixture in a CI invocation or an npm script is visible in
// review as exactly what it is.
const FIXTURE = process.argv.includes('--fixture');
const SRC = (FIXTURE && process.env.DESIGN_LINT_SRC) || join(ROOT, 'src');
const SELF = (FIXTURE && process.env.DESIGN_LINT_SELF) || new URL(import.meta.url).pathname;

// ── Budget ledger ───────────────────────────────────────────────────────────
const BUDGET = {
  'raw-hex': 273,
  'tiny-type': 180,
  'emoji-in-jsx': 44,
  'off-ladder-alpha': 17,
  'legacy-token-object': 0,
  'promotional-copy': 0,
  // ── UI-002B decoration budgets. Seeded at the counts measured when the rules
  // were written, so the build stays green while growth becomes impossible.
  // These are the Temu-removal ledger: every one of them is retired by DELETION
  // during UI-003, never by a redesign that keeps the effect and renames it.
  'decorative-gradient': 77,
  'glassmorphism': 63,
  'ad-hoc-shadow': 44,
  'arbitrary-radius': 246,
  'interpolated-class': 0,
  'lint-suppression': 0,
  'legacy-token-import': 5,
  // ── UI-002A. Both are hard zeroes, not budgets ratcheting down: each was
  // fixed completely, and a single reintroduction is a real accessibility
  // regression rather than un-migrated legacy.
  'focus-suppression': 0,
  'input-zoom-floor': 0,
  // ── UI-003 wave 0. Also a hard zero, and for the same reason: a Card with a
  // click handler is a control that keyboard and switch users cannot reach at
  // all. There is no legacy to migrate — there were two, both fixed.
  'interactive-card': 0,
};

const RULES = [
  {
    id: 'raw-hex',
    why: 'Colour literals bypass the token layer. Use a token class or src/lib/tokens.js.',
    // src/lib/tokens.js is the sanctioned JS mirror — it is REQUIRED to hold
    // literals, because inline style={{}} props cannot use Tailwind classes.
    //
    // WARNING: this comment previously claimed those values "are checked against
    // index.css by the token-drift rule below". No such rule has ever existed,
    // in this file or anywhere else — the `/* @gw <role> */` annotations in
    // tokens.js are read by nothing. So the one file licensed to hold colour
    // literals is currently unverified, and the exemption below is a real hole
    // rather than the safe trade the comment described. Writing the rule is
    // tracked in docs/DESIGN_SYSTEM.md § Known debt.
    exempt: (rel) => rel === 'src/lib/tokens.js',
    test: (line) => (line.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).length,
  },
  {
    id: 'tiny-type',
    why: 'Below the 12px type floor (13px for Hebrew). If a fact does not fit at 12px, it does not ship.',
    test: (line) => (line.match(/text-\[(?:[0-9]|10|11)px\]/g) || []).length,
  },
  {
    id: 'emoji-in-jsx',
    why: 'Emoji render in the platform font — categorically outside the brand, and the visual language of gamified points rather than verified trust.',
    // Comments are exempt: this rule is about what RENDERS, and documentation
    // that names the anti-pattern (or quotes an offending string) is not itself
    // a violation.
    test: (line) => {
      const s = line.trimStart();
      if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) return 0;
      return (line.match(/\p{Extended_Pictographic}/gu) || []).length;
    },
  },
  {
    id: 'off-ladder-alpha',
    // Tailwind 3 accepts ANY integer slash modifier regardless of theme.opacity,
    // so the config cannot close this ladder — it has to be linted.
    // Anchored on colour-utility prefixes so layout fractions (w-1/2) don't match.
    why: 'Alpha outside the closed ladder (4/8/12/20/40/64). 22 improvised values is what "no scale" looks like.',
    test: (line) => {
      const m = line.match(/\b(?:bg|text|border|from|to|via|ring|fill|stroke|shadow)-\[?[#\w.\-()]+\]?\/(\d{1,3})\b/g) || [];
      const allowed = new Set(['4', '8', '12', '20', '40', '64', '5', '10', '30', '50', '60', '70', '80', '90']);
      return m.filter((s) => !allowed.has(s.split('/').pop())).length;
    },
  },
  {
    id: 'legacy-token-object',
    why: 'A view-local token object. Import from src/lib/tokens.js instead — seven parallel declarations is what caused 0.89% adoption.',
    test: (line) => (/^const (STITCH|SELL_STITCH|C) = \{/.test(line) ? 1 : 0),
  },
  {
    id: 'promotional-copy',
    // UI-001 §22: this codebase deliberately deleted fabricated "HOT DEAL /
    // Trending now / 12 bids active" badges. This rule stops them coming back.
    why: 'Promotional or fabricated-urgency copy. A marketplace that fakes activity loses the user the moment they notice.',
    test: (line) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return 0;
      return (line.match(/['"`][^'"`]*\b(HOT DEAL|TRENDING NOW|SELLING FAST|מבצע חם|נמכר מהר)\b/gi) || []).length;
    },
  },
  // ── UI-002B: the decoration rules ──────────────────────────────────────────
  // These four are what separate "we wrote it down" from "it cannot come back".
  // Each is seeded at the CURRENT count, so the build stays green today and the
  // number can only fall. None of them can be satisfied by a redesign — they are
  // satisfied by DELETION, which is the point.
  {
    id: 'decorative-gradient',
    // A gradient is the single most reliable "generated mockup" signal in this
    // codebase: a teal→teal ramp on a button, a green→emerald ramp on a price,
    // a black→transparent ramp on a photo. Only the last is doing real work
    // (a legibility scrim), and it should say so with an explicit disable.
    why: 'Gradient fill. Depth here is carried by surface TONE, not by a ramp. A scrim that genuinely aids legibility may opt out with `// design-lint-disable`.',
    test: (line) => {
      const s = line.trimStart();
      if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) return 0;
      return (line.match(/linear-gradient|radial-gradient|conic-gradient|\bbg-gradient-to-[a-z]+/g) || []).length;
    },
  },
  {
    id: 'glassmorphism',
    // 75 uses, most of them over an OPAQUE surface where the blur samples a
    // solid colour, costs a GPU layer, and changes nothing on screen.
    why: 'Backdrop blur. Over an opaque surface it blurs nothing and still costs a compositing layer; it also makes text contrast unverifiable, because the backdrop is unknown.',
    test: (line) => {
      const s = line.trimStart();
      if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) return 0;
      return (line.match(/\bbackdrop-blur[a-z-]*|backdropFilter|GLASS_[A-Z]+/g) || []).length;
    },
  },
  {
    id: 'ad-hoc-shadow',
    // Three shadows are sanctioned: raised, overlay, sheet. Everything else is
    // a one-off, and one-offs are how the app reached 13 distinct shadow
    // strings with no two alike.
    why: 'Shadow outside the closed set (raised / overlay / sheet). Coloured shadows are glows and are banned outright.',
    test: (line) => {
      const s = line.trimStart();
      if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) return 0;
      const tw = (line.match(/\bshadow-(?!raised\b|overlay\b|sheet\b|none\b)[a-z0-9[]/g) || []).length;
      // An inline boxShadow is fine only when it reads a shadow token.
      const inline = (line.match(/boxShadow:\s*(?!['"`]?var\(--gw-shadow)/g) || []).length;
      return tw + inline;
    },
  },
  {
    id: 'arbitrary-radius',
    // 8 distinct radii across 399 uses. `rounded-full` is NOT counted: the pill
    // is the sanctioned Chip shape (a control the user sets) and the avatar
    // shape. Everything between control (10px) and container (16px) is noise —
    // nobody can see the difference between xl and 2xl, but everybody can see
    // that two adjacent cards disagree.
    why: 'Radius outside the closed set (control 10px / container 16px / full / none). Nesting rule: inner = outer − padding.',
    test: (line) => {
      const s = line.trimStart();
      if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) return 0;
      const tw = (line.match(/\brounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-(?:sm|md|lg|xl|2xl|3xl|\[[^\]]+\])\b/g) || []).length;
      const inline = (line.match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*(?![^,;\n]*var\(--gw)/g) || []).length;
      return tw + inline;
    },
  },
  {
    id: 'lint-suppression',
    // Counted by the walker rather than by this `test`, because the walker has
    // to see the marker before it skips the line. Kept in RULES so it appears
    // in the report and carries a budget like everything else.
    why: 'A suppressed line. The escape hatch is legitimate but not free — using it costs an explicit ledger edit, so the suppression is visible in review rather than buried in a comment.',
    test: () => 0,
  },
  {
    id: 'interpolated-class',
    // Found by tests/mutations/ui-run.mjs, which showed this defect is invisible
    // to a DOM test: `items-${align}` and the lookup-table form produce the SAME
    // runtime className, so the rendered markup is identical and every
    // assertion about the element passes. What differs is build time —
    // Tailwind's content scanner is a plain TEXT match, so it never sees the
    // completed name, never emits the rule, and the prop silently does nothing.
    // Only source inspection can catch it, which is why it is a lint rule.
    why: 'A utility name completed by interpolation. Tailwind never sees it, so the rule is never emitted and the class silently does nothing. Use a lookup table of whole class names.',
    test: (line) => {
      const s = line.trimStart();
      if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*')) return 0;
      // Interpolating a WHOLE class name (`${animClass} ${className}`) is fine
      // and extremely common; only a PARTIAL utility completed by a value is
      // the hazard, so the prefix must be attached to the `${`.
      return (line.match(
        /\b(?:items|justify|self|place|content|bg|text|border|ring|outline|divide|rounded|shadow|opacity|gap|space-[xy]|[pm][xytrbles]?|[wh]|min-[wh]|max-[wh]|flex|grid-cols|col-span|row-span|order|z|top|bottom|left|right|inset|translate-[xy]|scale|rotate|duration|delay|ease|animate)-\$\{/g
      ) || []).length;
    },
  },
  {
    id: 'legacy-token-import',
    // The STITCH/C shims exist only so seven parallel token objects could be
    // deleted without touching their call sites. Every import here is a call
    // site that has not yet moved to a className. The shim is finished when
    // this number reaches 0 — at which point the shim itself gets deleted.
    why: 'Deprecated token shim (STITCH / SELL_STITCH / C). Inline style props are the only legitimate reason; if it can be a className, it MUST be a className.',
    exempt: (rel) => rel === 'src/lib/tokens.js',
    test: (line) => (/^\s*import\s*\{[^}]*\b(STITCH|SELL_STITCH|C)\b[^}]*\}\s*from\s*['"][^'"]*lib\/tokens/.test(line) ? 1 : 0),
  },
  {
    id: 'focus-suppression',
    // NOTE the split string literals below. This file lives in scripts/, which
    // is outside Tailwind's content globs, so it is safe here — but the same
    // tokens written plainly inside src/ (a COMMENT is enough) make Tailwind
    // emit the utility again, because its scanner is a plain-text match. That
    // is exactly how this rule got resurrected once already.
    why: 'Cancels the global :focus-visible ring at specificity (0,2,0). Keyboard users lose the only indication of where they are.',
    test: (line) => {
      const pats = ['focus:' + 'outline-none', 'focus:' + 'ring-0', 'outline' + '-none'];
      return pats.reduce((n, p) => n + (line.split(p).length - 1), 0);
    },
  },
];

// ── Structural rules ────────────────────────────────────────────────────────
// Line-based matching cannot express "a font-size utility ON a form control" —
// the className routinely sits several lines below the `<input`. These rules
// see the whole opening tag.
const FILE_RULES = [
  {
    id: 'input-zoom-floor',
    why: 'A form control below 16px makes iOS Safari auto-zoom on focus, and a standalone PWA does not reliably zoom back out.',
    test: (src) => {
      const hits = [];
      const small = /\btext-(?:xs|sm|\[(?:[0-9]|1[0-5])px\])\b/;
      for (const m of src.matchAll(/<(input|textarea|select)\b/g)) {
        // Walk to the end of the opening tag, tracking {…} so a nested
        // expression containing '>' does not terminate it early.
        let i = m.index, depth = 0;
        for (; i < src.length; i++) {
          const c = src[i];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) break;
        }
        const tag = src.slice(m.index, i + 1);
        if (small.test(tag)) {
          hits.push({ line: src.slice(0, m.index).split('\n').length, text: `<${m[1]} … ${tag.match(small)[0]}` });
        }
      }
      return hits;
    },
  },
  {
    id: 'interactive-card',
    why: 'A Card with a click handler renders a non-interactive element carrying one: no tab stop, no role, no Enter/Space, no accessible name. Put a <StretchedTarget> on the card title and pass `interactive` for the affordance.',
    // Line-based matching cannot see this. The live defect at
    // ListingCard.jsx:79 happened to fit on one line, but BrowseDetailView's
    // seller card spread `onClick` across six — and the multi-line form is the
    // one a real handler takes, because a handler long enough to need braces is
    // exactly the handler someone formats onto its own lines.
    //
    // `Card` itself already refuses the prop at runtime, so this rule is not the
    // only defence. It is the one that fails the BUILD, before a reviewer has to
    // notice a console.error in someone else's dev session.
    test: (src) => {
      const hits = [];
      for (const m of src.matchAll(/<Card\b/g)) {
        // Walk to the end of the opening tag, tracking {…} so a handler body
        // containing '>' (an arrow function — i.e. every handler) does not
        // terminate it early.
        let i = m.index, depth = 0;
        for (; i < src.length; i++) {
          const c = src[i];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) break;
        }
        const tag = src.slice(m.index, i + 1);
        // ACTIVATION handlers only. `onAnimationEnd`/`onTransitionEnd` on a card
        // are ordinary lifecycle plumbing and say nothing about interactivity;
        // matching every `on[A-Z]` would make the rule read as noise and get
        // switched off, which is how a hard zero dies.
        const handler = tag.match(
          /\bon(?:Click|DoubleClick|KeyDown|KeyUp|KeyPress|MouseDown|MouseUp|PointerDown|PointerUp|TouchStart|TouchEnd)\s*=/
        );
        if (handler) {
          hits.push({ line: src.slice(0, m.index).split('\n').length, text: `<Card … ${handler[0]}` });
        }
      }
      return hits;
    },
  },
];

// ── Walk ────────────────────────────────────────────────────────────────────
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(p) ? [p] : [];
  });

const counts = Object.fromEntries([...RULES, ...FILE_RULES].map((r) => [r.id, 0]));
const hits = [];

for (const file of walk(SRC)) {
  if (file === SELF) continue;
  // Relative to the tree being LINTED, not to this file's own location. It used
  // to be `relative(ROOT, …)`, where ROOT derives from the linter's path — so a
  // copy of the linter running against the real src/ produced `../../…` paths
  // and every `exempt` predicate silently stopped matching. That made the
  // exemptions dead code under exactly the conditions the tests and the mutation
  // harness run in: `raw-hex` reported 292 instead of 273 because
  // src/lib/tokens.js was no longer exempt.
  const rel = relative(join(SRC, '..'), file);
  const source = readFileSync(file, 'utf8');

  for (const rule of FILE_RULES) {
    if (rule.exempt?.(rel)) continue;
    for (const hit of rule.test(source)) {
      counts[rule.id] += 1;
      hits.push({ id: rule.id, loc: `${rel}:${hit.line}`, text: hit.text.slice(0, 90) });
    }
  }

  const lines = source.split('\n');
  lines.forEach((line, i) => {
    // The escape hatch is itself budgeted. It used to be unlimited, uncounted
    // and — after UI-002B advertised it in the gradient rule's own message —
    // the cheapest way to silence any rule in this file. Counting it FIRST
    // (before the skip) is what makes suppression cost a visible ledger edit
    // instead of a comment nobody greps for.
    if (line.includes(DISABLE_MARKER)) {
      counts['lint-suppression'] += 1;
      hits.push({ id: 'lint-suppression', loc: `${rel}:${i + 1}`, text: line.trim().slice(0, 90) });
      return;
    }
    for (const rule of RULES) {
      if (rule.exempt?.(rel)) continue;
      const n = rule.test(line);
      if (n > 0) {
        counts[rule.id] += n;
        hits.push({ id: rule.id, loc: `${rel}:${i + 1}`, text: line.trim().slice(0, 90) });
      }
    }
  });
}

// ── --json: machine-readable counts ─────────────────────────────────────────
// Used by tests/mutations/ui-run.mjs to judge a mutation DIFFERENTIALLY: lint
// the original file and the mutated file in isolation and compare counts. A
// pass/fail exit code cannot answer that question, because a whole-file copy of
// a legacy view fails a zeroed ledger either way — what matters is whether the
// mutation made any rule count go UP.
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ counts, hits: hits.length }));
  process.exit(0);
}

// ── --update: ratchet the ledger DOWN, never up ─────────────────────────────
// The whole value of a budget is that it cannot absorb a regression. So this
// refuses to run at all while anything is over budget, and only ever writes a
// smaller number. See the ratchet note in the header.
if (process.argv.includes('--update')) {
  const over = Object.entries(counts).filter(([id, n]) => n > BUDGET[id]);
  if (over.length) {
    console.error('\n✗ Refusing to update: these rules are OVER budget.\n');
    for (const [id, n] of over) console.error(`    ${id.padEnd(21)} ${n} > ${BUDGET[id]}  (+${n - BUDGET[id]})`);
    console.error('\n  --update lowers budgets; it does not raise them. Fix the violations,');
    console.error('  or hand-edit the ledger in this file so the increase is visible in review.\n');
    process.exit(1);
  }

  const lowered = Object.entries(counts).filter(([id, n]) => n < BUDGET[id]);
  if (!lowered.length) {
    console.log('\nAll budgets already match reality — nothing to lower.\n');
    process.exit(0);
  }

  let src = readFileSync(SELF, 'utf8');
  for (const [id, n] of lowered) {
    src = src.replace(new RegExp(`('${id}': )\\d+`), `$1${n}`);
  }
  writeFileSync(SELF, src);
  console.log('\nBudgets ratcheted down:\n');
  for (const [id, n] of lowered) console.log(`    ${id.padEnd(21)} ${BUDGET[id]} → ${n}  (−${BUDGET[id] - n})`);
  console.log('');
  process.exit(0);
}

// ── Report ──────────────────────────────────────────────────────────────────
let failed = 0;
console.log('\nUI-002 — design-system lint\n');
for (const rule of [...RULES, ...FILE_RULES]) {
  const n = counts[rule.id];
  const max = BUDGET[rule.id];
  const over = n > max;
  if (over) failed++;
  const delta = n < max ? `  (${max - n} under budget — run --update to lock it in)` : over ? `  (+${n - max} OVER)` : '';
  console.log(`  ${over ? 'FAIL' : 'ok  '}  ${rule.id.padEnd(21)} ${String(n).padStart(4)} / ${String(max).padEnd(4)}${delta}`);
  if (over) {
    console.log(`         ${rule.why}`);
    for (const h of hits.filter((h) => h.id === rule.id).slice(0, 8)) {
      console.log(`         ${h.loc}  ${h.text}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n✗ ${failed} rule(s) over budget. New violations are not accepted.\n`);
  process.exit(1);
}
console.log('\n✓ No new design-system violations.\n');
