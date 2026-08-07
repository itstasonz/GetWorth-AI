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
 * Lowering a budget is a normal part of a migration commit. RAISING one
 * requires deleting this comment and explaining yourself in the PR.
 *
 * Escape hatch: `// design-lint-disable` on the offending line.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const SELF = new URL(import.meta.url).pathname;

// ── Budget ledger ───────────────────────────────────────────────────────────
const BUDGET = {
  'raw-hex': 273,
  'tiny-type': 180,
  'emoji-in-jsx': 44,
  'off-ladder-alpha': 17,
  'legacy-token-object': 0,
  'promotional-copy': 0,
  // ── UI-002A. Both are hard zeroes, not budgets ratcheting down: each was
  // fixed completely, and a single reintroduction is a real accessibility
  // regression rather than un-migrated legacy.
  'focus-suppression': 0,
  'input-zoom-floor': 0,
};

const RULES = [
  {
    id: 'raw-hex',
    why: 'Colour literals bypass the token layer. Use a token class or src/lib/tokens.js.',
    // src/lib/tokens.js is the sanctioned JS mirror — it is REQUIRED to hold
    // literals, because inline style={{}} props cannot use Tailwind classes.
    // Its values are checked against index.css by the token-drift rule below,
    // so exempting it here does not create a second source of truth.
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
  const rel = relative(ROOT, file);
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
    if (line.includes('design-lint-disable')) return;
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

// ── --update: rewrite the ledger to current reality ─────────────────────────
if (process.argv.includes('--update')) {
  let src = readFileSync(SELF, 'utf8');
  for (const [id, n] of Object.entries(counts)) {
    src = src.replace(new RegExp(`('${id}': )\\d+`), `$1${n}`);
  }
  writeFileSync(SELF, src);
  console.log('Budgets updated to current counts:', counts);
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
