// ══════════════════════════════════════════════════════════════════════════════
// VAL-001 — MUTANT CATALOG for api/_lib/valuation-guard.js
//
// Each entry breaks ONE safety invariant from docs/VALUATION_ARCHITECTURE.md.
// The contract suite (tests/valuation-guard.test.mjs) must FAIL against every
// one of them. A mutant that SURVIVES is a hole in the tests, not a bug in the
// guard — the suite is asserting something weaker than the invariant it names.
//
// `find` MUST match the guard source exactly once. The runner refuses to run a
// mutant whose `find` matches zero or many times, so a refactor that moves this
// code fails loudly here instead of silently reporting a green mutation score.
//
// `kills` names the contract-test ids expected to catch it — documentation for
// the reader, not something the runner enforces.
// ══════════════════════════════════════════════════════════════════════════════

export const MUTANTS = [
  // ── The cardinal rule: out-of-envelope prices DEGRADE, they are never clamped
  {
    id: 'M01-ENVELOPE-HARD-CLAMP',
    invariant: 'An out-of-envelope price is rejected, never quietly clamped into range.',
    kills: ['DEGRADE-NEVER-CLAMP', 'I-01'],
    find: 'if (mid > env.hard_max) return degrade(',
    replace: 'if (mid > env.hard_max) { mid = env.hard_max; }\n  if (false) return degrade(',
  },
  {
    id: 'M02-ENVELOPE-FLOOR-OFF',
    invariant: 'A price below the category floor is rejected.',
    kills: ['I-01', 'E-*'],
    find: 'if (mid < env.floor) return degrade(',
    replace: 'if (false) return degrade(',
  },
  {
    id: 'M03-ENVELOPE-SOFT-NO-DOWNGRADE',
    invariant: 'An exceptional (above soft_max) price is graded DOWN one step.',
    kills: ['E-*', 'I-03'],
    find: '    needsReview = true;\n    grade = gradeDown(grade);\n    violations.push({ rule: \'V-ENVELOPE-SOFT\',',
    replace: '    needsReview = true;\n    violations.push({ rule: \'V-ENVELOPE-SOFT\',',
  },

  // ── Numeric sanity on the incoming quote
  {
    id: 'M04-FINITE-MID-OFF',
    invariant: 'A non-finite mid (string, NaN, null) is rejected before use.',
    kills: ['V-FINITE', 'I-01'],
    find: 'if (!Number.isFinite(q.mid)) return degrade(',
    replace: 'if (false) return degrade(',
  },
  {
    id: 'M05-POSITIVE-MID-OFF',
    invariant: 'A mid of 0 or less is rejected.',
    kills: ['V-POSITIVE'],
    find: 'if (q.mid <= 0) return degrade(',
    replace: 'if (false) return degrade(',
  },
  {
    id: 'M06-POSITIVE-LOW-OFF',
    invariant: 'A non-positive low is rejected (never shipped as a free item).',
    // EQUIVALENT: a non-positive low makes high/low non-positive, so V-SPREAD-MIN
    // degrades the quote before it can be emitted. Verified: no probe produces a
    // different verdict from the real guard. Redundant depth, not a test gap.
    equivalent: 'V-SPREAD-MIN degrades the same inputs (high/low <= 0 < 1.05)',
    kills: ['V-POSITIVE', 'I-01'],
    find: 'if (low <= 0) return degrade(\'V-POSITIVE\'',
    replace: 'if (false) return degrade(\'V-POSITIVE\'',
  },
  {
    id: 'M07-ORDER-OFF',
    invariant: 'low <= mid <= high is enforced; an unordered triple is rejected.',
    kills: ['V-ORDER', 'I-01'],
    find: 'if (!(low <= mid && mid <= high)) {',
    replace: 'if (false) {',
  },
  {
    id: 'M08-MID-MOVED',
    invariant: 'mid is NEVER moved by the guard — only low/high are ever repaired.',
    kills: ['I-01', 'D-01'],
    find: 'let mid = Math.round(q.mid);',
    replace: 'let mid = Math.round(q.mid * 1.05);',
  },
  {
    id: 'M09-ROUND-OFF',
    invariant: 'Every emitted price is an integer.',
    kills: ['I-01'],
    find: '  const rLow = Math.round(low), rHigh = Math.round(high);',
    replace: '  const rLow = low, rHigh = high;',
  },

  // ── Currency must never be silently relabelled
  {
    id: 'M10-CURRENCY-RELABEL',
    invariant: 'A non-ILS quote is rejected, never relabelled as ILS.',
    kills: ['V-CURRENCY'],
    find: 'String(q.currency).trim().toUpperCase() !== \'ILS\'',
    replace: 'false',
  },

  // ── Provenance: the grade is DERIVED, never taken from the model's claim
  {
    id: 'M11-UNANCHORED-EARNS-HIGH',
    invariant: 'Only a compatible catalog anchor earns HIGH. Unanchored Stage 2 is MEDIUM.',
    kills: ['S-02', 'S-07', 'S-08'],
    find: '      : { source: \'stage2_ai\', grade: \'MEDIUM\' };',
    replace: '      : { source: \'stage2_comp_anchored\', grade: \'HIGH\' };',
  },
  {
    id: 'M12-PRE-CATALOG-ALWAYS-MEDIUM',
    invariant: 'A PRE catalog row grades MEDIUM only when its MODEL column was hit.',
    kills: ['S-03'],
    find: 'case \'catalog\': return { source: \'pre_catalog\', grade: ctx.anchorModelEvidence ? \'MEDIUM\' : \'LOW\' };',
    replace: 'case \'catalog\': return { source: \'pre_catalog\', grade: \'MEDIUM\' };',
  },
  {
    id: 'M13-SOURCE-POLICY-OFF',
    invariant: 'B-15: a confidently identified product is never priced from a category bucket.',
    kills: ['S-09'],
    find: 'if (derived.source === \'category_bucket\' && ctx.identity?.identityHigh) {',
    replace: 'if (false) {',
  },

  // ── Degrade must not leak the rejected number
  {
    id: 'M14-DEGRADE-LEAKS-PRICE',
    invariant: 'A degraded verdict emits 0/0/0 — the rejected price never reaches a caller.',
    kills: ['I-03', 'DEGRADE-NEVER-CLAMP'],
    find: '      prices: { ...ZERO },\n      repairs,\n      violations,\n      meta: { ...base, pricing_grade: \'MANUAL_REQUIRED\', degraded: true, degraded_reason: `${rule}: ${detail}` },',
    replace: '      prices: { low: q.low, mid: q.mid, high: q.high },\n      repairs,\n      violations,\n      meta: { ...base, pricing_grade: \'MANUAL_REQUIRED\', degraded: true, degraded_reason: `${rule}: ${detail}` },',
  },
  {
    id: 'M15-ZERO-STATE-TOO-LOOSE',
    invariant: 'The manual_required zero-state accepts ONLY an exact 0/0/0 triple.',
    kills: ['V-ZERO-STATE', 'I-01'],
    find: 'if (q.pricing_status === \'manual_required\' && q.low === 0 && q.mid === 0 && q.high === 0) {',
    replace: 'if (q.pricing_status === \'manual_required\') {',
  },

  // ── Spread bounds
  {
    id: 'M16-SPREAD-MAX-OFF',
    invariant: 'A band wider than the identity-tier limit is rejected after repair.',
    // EQUIVALENT: R-SPREAD-CLAMP already guarantees high/low <= maxRatio, so the
    // post-repair re-check is unreachable for any input. It is a backstop against
    // a future clamp bug, and correctly cannot be triggered today.
    equivalent: 'R-SPREAD-CLAMP mathematically guarantees the ratio the check re-tests',
    kills: ['V-SPREAD-MAX'],
    find: 'if (ratio > maxRatio) return degrade(\'V-SPREAD-MAX\'',
    replace: 'if (false) return degrade(\'V-SPREAD-MAX\'',
  },
  {
    id: 'M17-SPREAD-CLAMP-BOUND',
    invariant: 'The spread clamp is multiplicative around mid (sqrt), preserving ordering.',
    kills: ['V-SPREAD-MAX', 'I-01'],
    find: 'const s = Math.sqrt(maxRatio);',
    replace: 'const s = maxRatio;',
  },

  // ── Post-validation transform must re-assert the envelope
  {
    id: 'M18-TRANSFORM-SKIPS-ENVELOPE',
    invariant: 'A replica multiplier that drives mid below the floor degrades the quote.',
    kills: ['T-*', 'PATH-01/02'],
    find: '  if (cause) {',
    replace: '  if (false) {',
  },
  {
    id: 'M19-TRANSFORM-NEGATIVE-MULTIPLIER',
    invariant: 'A non-positive multiplier degrades rather than inverting the price.',
    // EQUIVALENT: a negative multiplier yields a negative mid, which the
    // post-transform `prices.mid <= 0` check degrades anyway. The early return
    // only improves the violation message.
    equivalent: 'the post-transform envelope check degrades on prices.mid <= 0',
    kills: ['T-*'],
    find: '  if (m <= 0) {',
    replace: '  if (false) {',
  },

  {
    id: 'M23-TRANSFORM-ALLOWS-ZERO-LOW',
    invariant: 'A transform may not weaken V-POSITIVE: a post-multiply low of 0 degrades.',
    kills: ['M-07'],
    find: '    : prices.low <= 0 ? `low ${prices.low} rounded to zero or below`\n',
    replace: '',
  },

  // ── Condition authority: unknown condition must fail safe to "no adjustment"
  {
    id: 'M20-CONDITION-DEFAULT-RUNG',
    invariant: 'An unmappable condition returns null, never a silent default rung.',
    kills: ['C-02', 'C-05'],
    find: '    default: return null; // includes \'\', \'unknown\', anything unrecognized',
    replace: '    default: return \'used\';',
  },
  {
    id: 'M21-CONDITION-DELTA-NOT-FAILSAFE',
    invariant: 'conditionDelta returns 0 when either side is unknown (applied once, or not at all).',
    kills: ['C-05', 'C-07'],
    find: '  if (!b || !u) return 0;',
    replace: '  if (false) return 0;',
  },
  {
    id: 'M22-GUARD-APPLIES-CONDITION',
    invariant: 'The guard itself applies NO condition math — the client owns the residual.',
    kills: ['C-08'],
    find: '  let mid = Math.round(q.mid);\n  if (mid !== q.mid) repairs.push',
    replace: '  let mid = Math.round(q.mid * (1 - (CONDITION_LADDER[normalizeConditionBasis(q.condition)] ?? 0)));\n  if (mid !== q.mid) repairs.push',
  },

  // ── Presentation boundary (UI-003 Wave 0): MANUAL_REQUIRED is never a price
  // The shipped defect lived in the CALLER, which read `pricing_source` (a
  // diagnostic) as permission to publish a price. These mutants attack each
  // independently-sufficient half of the replacement predicate.
  {
    id: 'M24-PRICED-IGNORES-DEGRADED',
    invariant: 'A degraded verdict is never presented as priced, whatever its pricing_source says.',
    kills: ['PB-03b'],
    find: '  if (md.degraded) return false;',
    replace: '  if (false) return false;',
  },
  {
    id: 'M25-PRICED-IGNORES-ZERO-MID',
    invariant: 'Zero is not an estimate: a non-positive mid is unpriced even when every flag says fine.',
    kills: ['PB-02', 'PB-05'],
    find: '  const { low, mid, high } = v.prices || {};\n  if (!Number.isFinite(mid) || mid <= 0) return false;',
    replace: '  const { low, mid, high } = v.prices || {};\n  if (false) return false;',
  },
  {
    id: 'M26-CANDIDATE-PROMOTES',
    invariant: 'The caller\'s candidate label can only narrow — it can never promote an unpriced verdict.',
    kills: ['PB-01', 'PB-02', 'PB-03'],
    find: 'export function resolvePricingStatus(v, candidate) {\n  if (!isPricedVerdict(v)) return MANUAL_REQUIRED_STATUS;',
    replace: 'export function resolvePricingStatus(v, candidate) {\n  if (false) return MANUAL_REQUIRED_STATUS;',
  },
  {
    id: 'M27-GRADE-NOT-GATED',
    invariant: 'pricing_confidence is gated by the same predicate as pricing_status — they cannot disagree.',
    kills: ['PB-01', 'PB-05'],
    find: 'export function resolvePricingGrade(v, candidate) {\n  if (!isPricedVerdict(v)) return \'MANUAL_REQUIRED\';',
    replace: 'export function resolvePricingGrade(v, candidate) {\n  if (false) return \'MANUAL_REQUIRED\';',
  },
  {
    id: 'M28-WIRE-RULE-LABEL-ONLY',
    invariant: 'The wire-shape rule checks the NUMBER too — a priced label over a zero mid is rejected.',
    kills: ['PB-07', 'PB-08'],
    find: '  const mid = Number(mv.mid), low = Number(mv.low), high = Number(mv.high);\n  if (!Number.isFinite(mid) || mid <= 0) return false;',
    replace: '  const mid = Number(mv.mid), low = Number(mv.low), high = Number(mv.high);\n  if (false) return false;',
  },

  // ── UI-003 Wave 0 Gap B — the reference-price rule ────────────────────────
  // `new_retail` is the one price column outside the valuation band, so none of
  // the band mutants above touch it. Nothing is sold new for GBP/ILS 0, which is
  // why zero can only ever have meant "unknown" — stored as a number that every
  // future AVG/SUM treats as a fact.
  {
    id: 'M29-RETAIL-ACCEPTS-ZERO',
    invariant: 'A reference price of 0 is unknown, not free.',
    kills: ['PB-12'],
    find: '  return Number.isFinite(n) && n > 0 ? n : null;',
    replace: '  return Number.isFinite(n) && n >= 0 ? n : null;',
  },
  {
    id: 'M30-RETAIL-PASSES-THROUGH-GARBAGE',
    invariant: 'A non-finite or non-numeric reference price is null, never echoed back.',
    kills: ['PB-12'],
    find: "  if (v === null || v === undefined || v === '') return null;\n  const n = Number(v);\n  return Number.isFinite(n) && n > 0 ? n : null;",
    replace: "  if (v === null || v === undefined || v === '') return null;\n  return Number(v);",
  },
];

export default MUTANTS;
