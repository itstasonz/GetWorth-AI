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

// ── §13. HARNESS CALIBRATION — JUDGED, NEVER SCORED ─────────────────────────
//
// A mutation harness that kills EVERYTHING is exactly as uninformative as one
// that kills nothing, and it is harder to notice because the number looks
// perfect. These two entries measure the INSTRUMENT rather than the suite, so
// they sit outside both the numerator and the denominator.
//
//   SENSITIVITY  must be KILLED. If it survives, the harness is not reaching
//                the module under test and every other result is unexplained.
//   SPECIFICITY  must SURVIVE. A real, applied change that no suite asserts
//                anything about. If it is killed, the suites are going red for
//                reasons unrelated to the mutation, and every "killed" in the
//                run is unearned.
//
// The specificity control edits the human-readable `detail` of an EXISTING
// V-ENVELOPE-SOFT violation. The rule still fires, the violation is still
// pushed, the verdict is unchanged — only the prose differs, and no assertion
// reads that prose. If one ever does, this control starts being killed and the
// gate says so, which is correct: at that point it is no longer a control.
export const GUARD_CONTROLS = [
  {
    id: 'CTL-SENSITIVITY-MUST-DIE',
    control: 'kill',
    target: 'guard',
    invariant: 'The harness reaches the module under test at all.',
    find: 'export function resolveEnvelope(ctx = {}) {',
    replace: 'export function resolveEnvelope(ctx = {}) {\n  if (ctx) throw new Error("[control] sensitivity probe");',
  },
  {
    id: 'CTL-SPECIFICITY-MUST-LIVE',
    control: 'survive',
    target: 'guard',
    invariant: 'A real change no suite asserts anything about is NOT killed.',
    find: "    violations.push({ rule: 'V-ENVELOPE-SOFT', detail: `mid ${mid} > soft_max ${env.soft_max} (${env.key}) — priced, flagged` });",
    replace: "    violations.push({ rule: 'V-ENVELOPE-SOFT', detail: `mid ${mid} exceeds soft_max ${env.soft_max} for ${env.key}; priced and flagged` });",
  },
  // ── AND THE AUTHORITY CHANNEL, WHICH WAS EQUALLY UNCALIBRATED ─────────────
  // A reviewer found the provider harness printing PROVEN over a channel no
  // control had touched. This harness had the same shape: mutants target both
  // `guard` and `authority`, and both controls targeted only `guard`.
  {
    id: 'CTL-AUTHORITY-SENSITIVITY-MUST-DIE',
    control: 'kill',
    target: 'authority',
    invariant: 'The harness reaches api/_lib/pricing-authority.js at all.',
    find: 'export function deriveEvidence({ recognition = null, visionData = null, anchor = null } = {}) {',
    replace: 'export function deriveEvidence({ recognition = null, visionData = null, anchor = null } = {}) {\n  throw new Error("[control] authority sensitivity probe");',
  },
  {
    id: 'CTL-AUTHORITY-SPECIFICITY-MUST-LIVE',
    control: 'survive',
    target: 'authority',
    invariant: 'A real change no suite asserts anything about is NOT killed, on the authority side too.',
    // A genuine behavioural change — the bound on how many lines the provenance
    // record keeps — for an input no test supplies. That is what a specificity
    // control has to be: real, and unobserved.
    find: 'const MAX_BLOCK_LINES = 80;',
    replace: 'const MAX_BLOCK_LINES = 79;',
  },
  // ── AND THE MARKET CHANNEL, ADDED WITH IT RATHER THAN AFTER IT ───────────
  //
  // The authority channel above was added uncalibrated and ran that way until a
  // reviewer noticed the harness printing PROVEN over a channel no control had
  // ever touched. A third mutable module is exactly the same mistake waiting to
  // be repeated, so its two controls ship in the same commit as its mutants.
  {
    id: 'CTL-MARKET-SENSITIVITY-MUST-DIE',
    control: 'kill',
    target: 'market',
    invariant: 'The harness reaches api/_lib/market-evidence.js at all.',
    find: 'export function qualifyMarketEvidence({ observations = [], subject = {}, fxProofs = null } = {}) {',
    replace: 'export function qualifyMarketEvidence({ observations = [], subject = {}, fxProofs = null } = {}) {\n  throw new Error("[control] market sensitivity probe");',
  },
  {
    id: 'CTL-MARKET-SPECIFICITY-MUST-LIVE',
    control: 'survive',
    target: 'market',
    invariant: 'A real change no suite asserts anything about is NOT killed, on the market side too.',
    // The floating-point slack in the FX proof check: a genuine behavioural
    // change, on an input no test supplies. Every FX fixture is either exact or
    // wrong by a factor of ten, so a tenth of an agora either way is invisible.
    // If a test ever pins this tolerance, the control starts being killed and
    // the gate says so — which is correct, because at that point it is no
    // longer unobserved.
    find: '  if (Math.abs(amount * rate - normalized) > 0.001) return null;',
    replace: '  if (Math.abs(amount * rate - normalized) > 0.002) return null;',
  },
];

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
    // RESTORED, and the round trip is the record.
    //
    // The round-3 run reported this mutant KILLED once the harness also ran the
    // verdict suites, and the marker was dropped as stale. It was not stale: the
    // only assertion killing it demanded valuation_verdict MANUAL for EVERY
    // refusal, and that assertion was itself wrong -- PENDING_MARKET is a refusal
    // that is allowed to say something about the future. Correcting the assertion
    // brought the mutant back to life, which is the right answer.
    //
    // A mutant killed only by an over-broad assertion is not really killed, and an
    // equivalence marker removed on that evidence is a score inflated by a bug.
    equivalent: "V-SPREAD-MIN degrades the same inputs (high/low <= 0 < 1.05)",
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
    // RE-PINNED when VERIFIED_MARKET split this ternary into three branches.
    // The invariant is unchanged; only the shape of the line it lives on moved.
    find: "    return { source: 'stage2_ai', grade: 'MEDIUM' };",
    replace: "    return { source: 'stage2_comp_anchored', grade: 'HIGH' };",
  },
  {
    id: 'M12-PRE-CATALOG-ALWAYS-MEDIUM',
    invariant: 'A PRE catalog row grades MEDIUM only when its MODEL column was hit.',
    kills: ['S-03'],
    find: "        grade: (ctx.anchorModelEvidence && hasMarketAnchor(ctx)) ? 'MEDIUM' : 'LOW',",
    replace: "        grade: 'MEDIUM',",
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
    // RE-PINNED in round 3. §5 added `valuation_verdict: MANUAL` to degrade(),
    // because the verdicts are computed on `base` before the numeric rules run and
    // a quote that then failed an envelope check still reported BOUNDED beside its
    // own refusal. The harness reported this as INVALID (find matched 0x) rather
    // than scoring it either way, which is the behaviour that makes re-pinning safe.
    invariant: 'A degraded verdict emits 0/0/0 — the rejected price never reaches a caller.',
    kills: ['I-03', 'DEGRADE-NEVER-CLAMP'],
    find: "      prices: { ...ZERO },\n      repairs,\n      violations,\n      // A DEGRADED SCAN IS NOT BOUNDED, AND IT IS NOT ANCHORED. A quote that\n      // fails an envelope or ordering check must not keep a verdict that claims\n      // the number was backed. Recognition survives a refusal; valuation\n      // authority does not.\n      //\n      // PENDING_MARKET is the one verdict a refusal may KEEP, because it is\n      // itself a refusal and it is the only one /api/enrich can act on. Flattening\n      // it to MANUAL here is what made a pending scan indistinguishable from an\n      // unrecognisable one.\n      meta: { ...base, pricing_grade: 'MANUAL_REQUIRED', degraded: true,\n        valuation_verdict: base.valuation_verdict === VALUATION_VERDICT.PENDING_MARKET\n          ? VALUATION_VERDICT.PENDING_MARKET : VALUATION_VERDICT.MANUAL,\n        degraded_reason: `${rule}: ${detail}` },",
    replace: "      prices: { low: q.low, mid: q.mid, high: q.high },\n      repairs,\n      violations,\n      // A DEGRADED SCAN IS NOT BOUNDED, AND IT IS NOT ANCHORED. A quote that\n      // fails an envelope or ordering check must not keep a verdict that claims\n      // the number was backed. Recognition survives a refusal; valuation\n      // authority does not.\n      //\n      // PENDING_MARKET is the one verdict a refusal may KEEP, because it is\n      // itself a refusal and it is the only one /api/enrich can act on. Flattening\n      // it to MANUAL here is what made a pending scan indistinguishable from an\n      // unrecognisable one.\n      meta: { ...base, pricing_grade: 'MANUAL_REQUIRED', degraded: true,\n        valuation_verdict: base.valuation_verdict === VALUATION_VERDICT.PENDING_MARKET\n          ? VALUATION_VERDICT.PENDING_MARKET : VALUATION_VERDICT.MANUAL,\n        degraded_reason: `${rule}: ${detail}` },",
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
    // RESTORED, and the round trip is the record.
    //
    // The round-3 run reported this mutant KILLED once the harness also ran the
    // verdict suites, and the marker was dropped as stale. It was not stale: the
    // only assertion killing it demanded valuation_verdict MANUAL for EVERY
    // refusal, and that assertion was itself wrong -- PENDING_MARKET is a refusal
    // that is allowed to say something about the future. Correcting the assertion
    // brought the mutant back to life, which is the right answer.
    //
    // A mutant killed only by an over-broad assertion is not really killed, and an
    // equivalence marker removed on that evidence is a score inflated by a bug.
    equivalent: "R-SPREAD-CLAMP mathematically guarantees the ratio the check re-tests",
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
    // RESTORED, and the round trip is the record.
    //
    // The round-3 run reported this mutant KILLED once the harness also ran the
    // verdict suites, and the marker was dropped as stale. It was not stale: the
    // only assertion killing it demanded valuation_verdict MANUAL for EVERY
    // refusal, and that assertion was itself wrong -- PENDING_MARKET is a refusal
    // that is allowed to say something about the future. Correcting the assertion
    // brought the mutant back to life, which is the right answer.
    //
    // A mutant killed only by an over-broad assertion is not really killed, and an
    // equivalence marker removed on that evidence is a score inflated by a bug.
    equivalent: "the post-transform envelope check degrades on prices.mid <= 0",
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

  // ==========================================================================
  // ROUND 3 - §3 bucket authority, §4 category authority, §5 verdicts, §6 tokens
  //
  // Each of these breaks ONE rule and names the tests that must notice it.
  //
  // `target: 'authority'` mutates api/_lib/pricing-authority.js instead of the
  // guard. §6 moved the category token predicate there so the guard and
  // api/_lib/category.js could not hold two copies of it - and that put a rule
  // the guard DEPENDS ON outside the only file this harness could damage. A
  // 100% score would then have meant "everything still inside valuation-guard.js
  // is protected", while the shared predicate underneath it was untested by
  // construction. A mutation score is only as wide as the files it can break.
  // ==========================================================================
  {
    id: "M31-BUCKET-AUTHORITY-NEVER-REFUSES",
    invariant: "§3 DERIVED alone may never enter a bucket wider than its parent.",
    kills: ["EA-1a","EA-1b","EA-2a"],
    find: "  const req = bucketEntryRequirement(key, table);\n  if (req === UNSATISFIABLE) return false;\n  if (req.length === 0) return true;",
    replace: "  const req = bucketEntryRequirement(key, table);\n  if (req === UNSATISFIABLE) return false;\n  return true;",
  },
  {
    id: "M32-UNDECLARED-WIDE-BUCKET-OPENS",
    invariant: "§3 a bucket wider than its parent with no declaration is UNREACHABLE, not permitted.",
    kills: ["EA-2c"],
    find: "  return self.hard_max > up.hard_max ? UNSATISFIABLE : [];",
    replace: "  return [];",
  },
  {
    id: "M33-AUTHORITY-FALLS-TO-NULL",
    invariant: "§3 a refused bucket falls back to its PARENT, never to no bucket at all.",
    kills: ["EA-1c","EA-1b"],
    find: "    if (bucketEntryPermitted(k, evidence)) return k;\n    k = parentKey(k);",
    replace: "    if (bucketEntryPermitted(k, evidence)) return k;\n    k = null;",
  },
  {
    id: "M34-EVIDENCE-DEFAULTS-TO-EVERYTHING",
    invariant: "§3 a caller that passes no evidence gets DERIVED only, the fail-closed default.",
    kills: ["EA-1a"],
    find: "const DERIVED_ONLY = Object.freeze(new Set(['DERIVED']));",
    replace: "const DERIVED_ONLY = Object.freeze(new Set(['DERIVED', 'OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT']));",
  },
  {
    id: "M35-STAGE2-CATEGORY-WIDENS-FREELY",
    invariant: "§4 a later stage may not widen the pricing envelope by returning a different category string.",
    kills: ["CA-1a","CA-2b"],
    find: "  if (CATEGORY_WIDENING_EVIDENCE.some((c) => have.has(c))) {",
    replace: "  if (true) {",
  },
  {
    id: "M36-DISAGREEMENT-NOT-RECORDED",
    invariant: "§4 a widening without qualifying evidence is RECORDED as a disagreement.",
    kills: ["CA-1a","CA-2b"],
    find: "  out.category_disagreement = true;\n  return out;",
    replace: "  out.category_disagreement = false;\n  return out;",
  },
  {
    id: "M37-DISAGREEMENT-STILL-PRICES",
    invariant: "§4 a recorded disagreement refuses the NUMBER, under either label.",
    kills: ["CA-1b"],
    find: "  if (ctx.category_disagreement === true) {\n    return degrade('V-CATEGORY-DISAGREEMENT',",
    replace: "  if (false) {\n    return degrade('V-CATEGORY-DISAGREEMENT',",
  },
  {
    id: "M38-PENDING-SHIPS-THE-PRICE",
    invariant: "§5 PENDING_MARKET emits 0/0/0; the unbacked number never reaches a caller.",
    kills: ["VV-1b","VV-2b"],
    find: "    return verdict({\n      action: 'pending',\n      prices: { ...ZERO },",
    replace: "    return verdict({\n      action: 'pending',\n      prices: { low: q.low, mid: q.mid, high: q.high },",
  },
  {
    id: "M39-PRODUCT-IDENTITY-PRICES-UNBACKED",
    invariant: "§5 a product-level identity with no market evidence is PENDING_MARKET, not a price.",
    kills: ["VV-1b","VV-2b","VV-3c"],
    find: "  if (PRODUCT_LEVEL.has(rec)) return VALUATION_VERDICT.PENDING_MARKET;",
    replace: "  if (PRODUCT_LEVEL.has(rec)) return VALUATION_VERDICT.BOUNDED;",
  },
  {
    id: "M40-PENDING-NOT-FLAGGED-DEGRADED",
    invariant: "§5 pending sets degraded:true, so every caller written before it refuses the number.",
    kills: ["VV-3f"],
    find: "        degraded: true,\n        degraded_reason: 'V-MARKET-EVIDENCE: market evidence pending',",
    replace: "        degraded: false,\n        degraded_reason: 'V-MARKET-EVIDENCE: market evidence pending',",
  },
  {
    id: "M41-DEGRADE-KEEPS-BOUNDED-VERDICT",
    invariant: "§5 a degraded scan reports valuation_verdict MANUAL, never BOUNDED beside its own refusal.",
    kills: ["VV-3e"],
    find: "        valuation_verdict: base.valuation_verdict === VALUATION_VERDICT.PENDING_MARKET\n          ? VALUATION_VERDICT.PENDING_MARKET : VALUATION_VERDICT.MANUAL,",
    replace: "        valuation_verdict: base.valuation_verdict,",
  },
  {
    id: "M42-TOKEN-MATCH-BECOMES-SUBSTRING",
    target: "authority",
    invariant: "§6 a category matcher fires on a WORD, never on a coincidence of letters.",
    kills: ["TK-1b","EA-1a"],
    find: "  for (const w of String(text || '').toLowerCase().split(WORD_SPLIT)) {",
    replace: "  if (String(text || '').toLowerCase().includes(token)) return true;\n  for (const w of String(text || '').toLowerCase().split(WORD_SPLIT)) {",
  },
  {
    id: "M43-UNDECLARED-TOKEN-MATCHES",
    target: "authority",
    invariant: "§6 a token with no declared match mode cannot match; adding a matcher must break loudly.",
    kills: ["TK-1c"],
    find: "  if (!mode) return false;",
    replace: "  if (!mode) return String(text || '').toLowerCase().includes(token);",
  },
  {
    id: "M44-BRAND-TEXT-FROM-A-CLAIM",
    target: "authority",
    invariant: "§3 BRAND_TEXT requires the name to OCCUR in text read off the item, not to be asserted.",
    kills: ["EA-3a","EA-3b"],
    find: "  if (typeof brand === 'string' && presentOnSomeLine(brand, lines)) {",
    replace: "  if (typeof brand === 'string' && brand) {",
  },
  {
    id: "M45-OBJECT-CLASS-IGNORES-THE-FLOOR",
    target: "authority",
    invariant: "§3 OBJECT_CLASS requires a classifier signal at or above the recognition floor.",
    kills: ["EA-3d"],
    find: "    if (l && l.description && Number(l.score) >= OBJECT_CLASS_SCORE_FLOOR) out.push(l.description);\n  }\n  for (const l of (visionData?.logos || [])) {",
    replace: "    if (l && l.description) out.push(l.description);\n  }\n  for (const l of (visionData?.logos || [])) {",
  },
  {
    id: "M46-PHRASE-BECOMES-BAG-OF-WORDS",
    target: "authority",
    invariant: "§3 a multi-word product name matches as a CONTIGUOUS phrase, not as pooled tokens.",
    kills: ["EA-3c"],
    find: "      if (haystackWords[i + j] !== n[j]) { ok = false; break; }",
    replace: "      if (!haystackWords.includes(n[j])) { ok = false; break; }",
  },

  // ==========================================================================
  // ROUND 4 - C-1 anchor price, C-3 fail-closed envelope, H-1 verdict timing,
  // H-5 provenance, H-6 compatibility text.
  //
  // Every one of these restores a defect an INDEPENDENT REVIEW found against a
  // suite that was green, with a 100% mutation score, on a clean build. That
  // score was honest about the properties it covered and silent about the ones
  // nobody had written down, which is the only kind of dishonesty a mutation
  // score is capable of.
  // ==========================================================================
  {
    id: "M47-ANCHOR-WITHOUT-A-PRICE",
    target: "authority",
    invariant: "C-1 a catalog row must carry a usable price to be MARKET evidence.",
    kills: ["C1-a","C1-b","C1-d"],
    find: "    const price = anchorPrice(anchor);\n    if (price !== null) {",
    replace: "    const price = anchorPrice(anchor);\n    if (true) {",
  },
  {
    id: "M48-ANCHOR-PRICE-COERCED",
    // RE-POINTED. The first version dropped the `typeof` guard and SURVIVED, and it
    // survived because it was equivalent: Number.isFinite does not coerce, so "900",
    // true, {} and [900] fail it either way. A mutant that cannot change behaviour
    // measures nothing. This one restores the coercion that was actually there —
    // `Number(ctx.anchor?.retail_price_ils)` — which accepted the STRING "900" and,
    // as this round’s own property test found, turned `retail_price_ils: true` into a
    // one-shekel anchor-relative ceiling.
    target: "authority",
    invariant: "C-1 a price is a finite NUMBER above zero; the string \"900\" is not a price.",
    kills: ["C1-a","C1-b"],
    find: "    if (typeof v !== 'number') continue;",
    replace: "    const n = Number(v);\n    if (Number.isFinite(n) && n > 0) return n;\n    continue;",
  },
  {
    id: "M49-GUARD-ANCHOR-IS-TRUTHINESS",
    invariant: "C-1 the guard derives ANCHORED from a PRICED anchor, not from any object.",
    kills: ["C1-b","C1-c","C1-f"],
    find: "function hasMarketAnchor(ctx) {\n  return anchorPriceOf(ctx?.anchor) !== null;\n}",
    replace: "function hasMarketAnchor(ctx) {\n  return !!ctx?.anchor;\n}",
  },
  {
    id: "M50-CALLER-ASSERTS-ANCHOR",
    invariant: "C-1 a caller may not assert the ANCHOR class it has not earned.",
    kills: ["C1-e"],
    find: "  if (hasMarketAnchor(ctx) || ANCHORED_SOURCES.has(derived.source)) {",
    replace: "  if (hasMarketAnchor(ctx) || asEvidenceSet(ctx.evidence).has('ANCHOR') || ANCHORED_SOURCES.has(derived.source)) {",
  },
  {
    id: "M51-UNRESOLVED-GETS-GLOBAL",
    invariant: "C-3 an unresolved bucket fails closed; no identity tier buys the global ceiling.",
    kills: ["C3-a","C3-b"],
    find: "    return { key: key || 'unresolved', basis: 'manual_only', ...MANUAL_ONLY, requiresAnchorAboveSoft: false };",
    replace: "    return { key: key || 'unresolved', basis: 'global', ...GLOBAL_ENVELOPE, requiresAnchorAboveSoft: false };",
  },
  {
    id: "M52-ENVELOPE-LOOKUP-WALKS-PROTOTYPE",
    invariant: "C-3 an envelope lookup is an OWN-property lookup.",
    kills: ["C3-c","C3-e"],
    find: "  return Object.prototype.hasOwnProperty.call(ENVELOPES, key) ? ENVELOPES[key] : null;",
    replace: "  return ENVELOPES[key] || null;",
  },
  {
    id: "M53-CALLER-KEY-SKIPS-AUTHORITY",
    invariant: "C-3 / VAL-5 a caller-supplied envelope key is subject to bucket authority.",
    kills: ["C3-d"],
    find: "  const key = ctx.envelope_key != null\n    ? applyBucketAuthority(envelopeFor(ctx.envelope_key) ? ctx.envelope_key : null, ctx.evidence)\n    : requestedKey;",
    replace: "  const key = ctx.envelope_key != null ? ctx.envelope_key : requestedKey;",
  },
  {
    id: "M54-VERDICTS-ASSIGNED-TOO-LATE",
    invariant: "H-1 what was established is recorded before any exit can refuse.",
    kills: ["VV-3e"],
    find: "  const identityTier = resolveIdentityTier(ctx);\n  base.identity_tier = identityTier;\n  base.recognition_verdict = resolveRecognitionVerdict(ctx);",
    replace: "  const identityTier = resolveIdentityTier(ctx);\n  base.identity_tier = identityTier;\n  if (false) base.recognition_verdict = resolveRecognitionVerdict(ctx);",
  },
  {
    id: "M55-SELF-WRITTEN-OCR-CORROBORATES",
    // RE-POINTED. The first version changed the FUNCTION SIGNATURE and survived,
    // because the call site still passed one argument — so the injected loop read an
    // undefined `recognition` and iterated nothing. A mutant must damage a path the
    // code actually takes; editing a parameter no caller supplies damages nothing.
    target: "authority",
    invariant: "H-5 a model may not corroborate its own candidate with its own transcription.",
    kills: ["EA-3b"],
    find: "  const lines = classifiedLines(visionData);",
    replace: "  const lines = classifiedLines(visionData)\n    .concat((recognition?.ocr_text?.raw_texts || []).map((t) => words(t)).filter((w) => w.length));",
  },
  {
    id: "M56-COMPATIBILITY-TEXT-CORROBORATES",
    target: "authority",
    invariant: "H-6 a compatibility label does not establish that the item IS the named product.",
    kills: ["EA-3b"],
    // RE-PINNED IN ROUND 6. The old site was the per-LINE drop inside
    // classifiedLines; the judgement now happens at BLOCK scope, because a line
    // is not a semantic scope (REC7-C1). Deleting the block verdict restores
    // exactly the behaviour this mutant has always described.
    find: "    if (relation !== RELATION.SUBJECT) referenceBearing = true;",
    replace: "    if (false) referenceBearing = true;",
  },
  {
    id: "M57-TOKENS-POOL-ACROSS-LINES",
    target: "authority",
    invariant: "H-6 text matching is per detection; tokens may not pool across separate lines.",
    kills: ["EA-3b","EA-3c"],
    find: "  return lines.some((line) => phrasePresent(needle, line));",
    replace: "  return phrasePresent(needle, lines.flat());",
  },

  // ==========================================================================
  // ROUND 5 - V5-1 the consumer C-1 missed, A5-1 the forked serialiser,
  // R5-C1 the per-word Vision shape, R5-H1 the erased scripts.
  //
  // Each restores a defect an independent review found against round 4, which
  // was itself green with a 100% mutation score. Three rounds running, the
  // score was true and the coverage was narrower than the claim.
  // ==========================================================================
  {
    id: "M58-SOFT-GATE-TAKES-ANY-ANCHOR",
    invariant: "V5-1 requiresAnchorAboveSoft needs MARKET evidence, not any object.",
    kills: ["R5-1a"],
    // RE-PINNED when the soft gate was widened to accept VERIFIED_MARKET. The
    // mutation still says the same thing — "any object satisfies the gate" — and
    // the widening did not change that it must not.
    find: "    if (env.requiresAnchorAboveSoft && !hasMarketAnchor(ctx) && !verifiedMarket) {",
    replace: "    if (env.requiresAnchorAboveSoft && !ctx.anchor && !verifiedMarket) {",
  },
  {
    id: "M59-MODEL-COLUMN-LIFTS-GRADE-UNPRICED",
    invariant: "V5-1b a priceless row may not lift the pre_catalog grade with its model column.",
    kills: ["M-02"],
    find: "        grade: (ctx.anchorModelEvidence && hasMarketAnchor(ctx)) ? 'MEDIUM' : 'LOW',",
    replace: "        grade: ctx.anchorModelEvidence ? 'MEDIUM' : 'LOW',",
  },
  {
    id: "M60-EVIDENCE-SERIALISER-FORKS",
    invariant: "A5-1 one canonical evidence-class list, shared by producer and guard.",
    kills: ["R5-6a"],
    find: "  return EVIDENCE_CLASSES.filter((c) => have.has(c));",
    replace: "  return ['ANCHOR', 'OBJECT_CLASS', 'BRAND_TEXT', 'PRODUCT_TEXT', 'DERIVED'].filter((c) => have.has(c));",
  },
  {
    id: "M61-FLAT-PER-WORD-TEXT-CORROBORATES",
    target: "authority",
    invariant: "R5-C1 lines come from the line-structured block, never the per-word array.",
    kills: ["R5-2d"],
    // RE-PINNED IN ROUND 6. The fallback moved into `blockProvenance`; the
    // mutation is the same one — let a per-word array with no line structure
    // stand in for the block.
    find: "  if (!ctx || typeof ctx !== 'object') return null;",
    replace: "  if (!ctx || typeof ctx !== 'object') return classifyOcrBlock((visionData?.text || []).join(' '));",
  },
  {
    id: "M62-REFERENCE-LINES-CORROBORATE",
    target: "authority",
    invariant: "R6 a provenance record is re-derived, not believed — a flag beside a contradicting line is refused.",
    kills: ["R6-1f"],
    // RE-PINNED IN ROUND 6, onto the OTHER half of the block rule. M56 deletes
    // the verdict as it is COMPUTED; this deletes the check as it is CONSUMED.
    // They are distinct because the record round-trips through `vision_cache`
    // as plain JSON, so the flag and the lines can disagree by the time a
    // consumer sees them.
    find: "    if (!line || line.relation !== RELATION.SUBJECT) return false;",
    replace: "    if (false) return false;",
  },
  {
    id: "M63-COMPATIBILITY-IS-ENGLISH-ONLY",
    target: "authority",
    invariant: "R5-H1 compatibility markers are recognised in the languages this market uses.",
    kills: ["R5-3a"],
    find: "    if (RTL_FOR_PREFIX.test(w)) return RELATION.COMPATIBILITY_TARGET;",
    replace: "    if (false) return RELATION.COMPATIBILITY_TARGET;",
  },
  {
    id: "M64-TOKENISER-ERASES-NON-LATIN",
    target: "authority",
    invariant: "R5-H1 a word in a script the author did not think of is tokenised, not deleted.",
    kills: ["R5-3a","R5-3c"],
    find: "    .split(/[^\\p{L}\\p{N}]+/u)",
    replace: "    .split(/[^a-z0-9]+/)",
  },
  {
    id: "M65-ACCESSORY-NOUN-IGNORED",
    target: "authority",
    invariant: "R5-C1 an accessory noun names a relationship even with no preposition.",
    kills: ["R5-3b"],
    // RE-PINNED. The branch moved when relationOfLine learned to tell a bare
    // homograph from a product name; the INVARIANT is unchanged, so the mutant
    // is re-aimed rather than retired. Skipping every accessory noun is still
    // the mutation, it is just spelled with the guard clause now.
    find: "    if (!ACCESSORY_NOUN.has(w)) continue;",
    replace: "    if (true) continue;",
  },
  {
    // ── THE OTHER HALF OF THE SAME RULE ────────────────────────────────────
    //
    // The homograph carve-out is the change that let the first production
    // witness through, and a carve-out is exactly the shape of thing that
    // quietly widens until it swallows the rule it was carved out of. This
    // mutant removes the `barelabel` condition, so EVERY occurrence of an
    // ambiguous noun — bare or inside a phrase — stops marking a relationship.
    //
    // It must die on the complement loop in FW-1c, which asserts that a
    // qualified ambiguous noun ("Silicone Case / iPhone 16 Pro") is still
    // packaging. If this ever survives, the carve-out has stopped being about
    // isolated labels and has become a hole.
    id: "M65b-AMBIGUITY-CARVEOUT-WIDENED",
    target: "authority",
    invariant: "FW-1 the homograph relaxation applies to BARE labels only, never inside a phrase.",
    kills: ["FW-2a"],
    find: "    if (barelabel && AMBIGUOUS_ACCESSORY_NOUN.has(w)) continue;",
    replace: "    if (AMBIGUOUS_ACCESSORY_NOUN.has(w)) continue;",
  },

  // ==========================================================================
  // ROUND 6 - REC7-C1 the block is the semantic scope, and the truncation that
  // made the safety cap a source of authority. V5-2 the sealed server record.
  // ==========================================================================
  {
    id: "M66-UNPROVEN-BLOCK-CORROBORATES",
    target: "authority",
    invariant: "REC7-C1 a block we cannot prove complete establishes nothing — truncation may not add authority.",
    kills: ["R6-2a"],
    find: "  return classifyOcrBlock(full, { truncated: true });",
    replace: "  return classifyOcrBlock(full, { truncated: false });",
  },
  {
    id: "M67-TRUNCATED-BLOCK-IS-SUBJECT",
    target: "authority",
    invariant: "REC7-C1 a truncated block is UNKNOWN, and UNKNOWN permits nothing.",
    kills: ["R6-2b"],
    find: "  const block_relation = truncated",
    replace: "  const block_relation = false",
  },
  {
    id: "M68-PACKAGING-REFERENCE-IGNORED",
    target: "authority",
    invariant: "REC7-C1 'device not included' / 'sold separately' name something that is NOT the subject.",
    kills: ["R6-1d"],
    find: "  if ((negation && inclusion) || (sold && separately)) return RELATION.PACKAGING_REFERENCE;",
    replace: "  if (false) return RELATION.PACKAGING_REFERENCE;",
  },
  {
    id: "M69-MODEL-FORGERY-IS-SERVER-AUTHORITY",
    target: "authority",
    invariant: "V5-2 an authoritative pricing record is one this module MINTED, not one that has the right shape.",
    kills: ["R6-3a"],
    find: "  return isServerAuthority(value) ? value : null;",
    replace: "  return (value && typeof value === 'object') ? value : null;",
  },
  {
    id: "M71-CJK-IS-MATCHED-AS-WHOLE-WORDS",
    target: "authority",
    invariant: "REC7-C1 a script written without word separators is matched by CONTAINMENT, not equality.",
    kills: ["R6-5a"],
    find: "    if (cjkRelation(w) === RELATION.COMPATIBILITY_TARGET) return RELATION.COMPATIBILITY_TARGET;",
    replace: "    if (false) return RELATION.COMPATIBILITY_TARGET;",
  },
  {
    id: "M72-COMBINING-MARKS-ARE-LETTERS",
    target: "authority",
    invariant: "REC7-C1 a combining mark, a tatweel and a zero-width joiner are decoration, not part of the word.",
    kills: ["R6-5a"],
    find: "    .replace(DECORATION, '')",
    replace: "    .replace(/__never_matches__/gu, '')",
  },
  {
    id: "M73-CJK-ACCESSORY-NOUN-IGNORED",
    target: "authority",
    invariant: "REC7-C1 a CJK accessory noun names a relationship, exactly as its English counterpart does.",
    kills: ["R6-5a"],
    find: "    if (cjkRelation(w) === RELATION.ACCESSORY_TARGET) return RELATION.ACCESSORY_TARGET;",
    replace: "    if (false) return RELATION.ACCESSORY_TARGET;",
  },
  {
    id: "M70-SEAL-IS-NOT-RECORDED",
    target: "authority",
    invariant: "V5-2 sealing records the object's IDENTITY; without the record nothing is authoritative.",
    kills: ["R6-3b"],
    find: "  SERVER_AUTHORITY.add(sealed);",
    replace: "  if (false) SERVER_AUTHORITY.add(sealed);",
  },
  // ══════════════════════════════════════════════════════════════════════════
  // VERIFIED_MARKET — THE AUTHORITY MECHANISM (§17)
  //
  // Every mutation below is a way somebody could make the class easier to
  // obtain: drop the quorum, skip a compatibility check, believe the model's
  // own field, or hand the new class the old one's powers. They are the shapes
  // the order names, written as the smallest edit that would actually produce
  // them rather than as a comment describing them.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "M74-QUORUM-REMOVED",
    target: "market",
    invariant: "§5 VERIFIED_MARKET represents a SET; a quorum is required, never assumed.",
    kills: ["MA-3a", "MA-3b"],
    find: "  if (admitted.length < VERIFIED_MARKET_QUORUM) setFailures.push(SET_FAILURE.QUORUM);",
    replace: "  if (false) setFailures.push(SET_FAILURE.QUORUM);",
  },
  {
    id: "M75-QUORUM-OF-ONE",
    target: "market",
    invariant: "§5 one marketplace listing is one seller's hope, not a market.",
    kills: ["MA-3a", "MA-3b"],
    find: "export const VERIFIED_MARKET_QUORUM = 3;",
    replace: "export const VERIFIED_MARKET_QUORUM = 1;",
  },
  {
    id: "M76-DIVERSITY-REMOVED",
    target: "market",
    invariant: "§6 three listings from one site is one site's opinion sampled three times.",
    kills: ["MA-3c", "MA-3d"],
    find: "  if (sources.size < MIN_DISTINCT_SOURCES) setFailures.push(SET_FAILURE.DIVERSITY);",
    replace: "  if (false) setFailures.push(SET_FAILURE.DIVERSITY);",
  },
  {
    id: "M77-DEDUPE-SKIPPED",
    target: "market",
    invariant: "§6 one advert repeated cannot become a quorum.",
    kills: ["MA-4a", "MA-4b"],
    find: "    if (keys.some((k) => seen.has(k))) { reject(o, DISQUALIFIER.DUPLICATE); continue; }",
    replace: "    if (false) { reject(o, DISQUALIFIER.DUPLICATE); continue; }",
  },
  {
    id: "M78-DEDUPE-LOSES-THE-RETITLE-KEY",
    target: "market",
    invariant: "§15 the same listing under a different title is still the same listing.",
    kills: ["MA-4b"],
    find: "      `p:${domain}|${ils}`,",
    replace: "      `p:${domain}|${reference}|${ils}`,",
  },
  {
    id: "M79-IDENTITY-COMPATIBILITY-SKIPPED",
    target: "market",
    invariant: "§7 a listing must be about THIS product; compatibility is not optional.",
    kills: ["MA-2a", "MA-5c", "MA-7a"],
    find: "    if (verdict !== null) { reject(o, verdict); continue; }",
    replace: "    if (false) { reject(o, verdict); continue; }",
  },
  {
    id: "M80-BRAND-ALONE-IS-ENOUGH",
    target: "market",
    invariant: "§7 generic brand comps must not obtain exact-model authority.",
    kills: ["MA-5c"],
    find: "  if (modelHits.length === 0) return DISQUALIFIER.MODEL_ABSENT;",
    replace: "  if (false) return DISQUALIFIER.MODEL_ABSENT;",
  },
  {
    id: "M81-IDENTITY-FLOOR-LOWERED",
    target: "market",
    invariant: "§7 one distinctive token with no brand is below the floor.",
    kills: ["MA-5d"],
    find: "  if (score < 2) return DISQUALIFIER.IDENTITY_TOO_WEAK;",
    replace: "  if (score < 1) return DISQUALIFIER.IDENTITY_TOO_WEAK;",
  },
  {
    id: "M82-WEAK-IDENTITY-STILL-QUALIFIES",
    target: "market",
    invariant: "§7 market authority never repairs an identity below product level.",
    kills: ["MA-5a"],
    find: "  if (!vocab.brand || !vocab.model) setFailures.push(SET_FAILURE.IDENTITY_INSUFFICIENT);",
    replace: "  if (false) setFailures.push(SET_FAILURE.IDENTITY_INSUFFICIENT);",
  },
  {
    id: "M83-VARIANT-COMPATIBILITY-SKIPPED",
    target: "market",
    invariant: "§4 a stated different size is a different product.",
    kills: ["MA-6a"],
    find: "    if (![...got].some((v) => wanted.has(v))) return DISQUALIFIER.VARIANT_MISMATCH;",
    replace: "    if (false) return DISQUALIFIER.VARIANT_MISMATCH;",
  },
  {
    id: "M84-QUALIFIER-CONFLICT-IGNORED",
    target: "market",
    invariant: "§4 Air is not Pro; the words that earn no points still separate siblings.",
    kills: ["MA-6c"],
    find: "    return DISQUALIFIER.QUALIFIER_MISMATCH;",
    replace: "    return null;",
  },
  {
    id: "M85-HOST-PRODUCT-COMPS-ACCEPTED",
    target: "market",
    invariant: "§8 a replacement strap does not become the Rolex it fits.",
    kills: ["MA-7a"],
    find: "    if (!namesTheAccessory) return DISQUALIFIER.HOST_PRODUCT_LISTING;",
    replace: "    if (false) return DISQUALIFIER.HOST_PRODUCT_LISTING;",
  },
  {
    id: "M86-ACCESSORY-COMPS-PRICE-THE-PRODUCT",
    target: "market",
    invariant: "§8 a spare blade does not price the blender.",
    kills: ["MA-7c"],
    find: "      return DISQUALIFIER.ACCESSORY_LISTING;",
    replace: "      return null;",
  },
  {
    id: "M87-MISSING-CURRENCY-ACCEPTED",
    target: "market",
    invariant: "§9 currency ambiguity is a rejection, never a default.",
    kills: ["MA-8c"],
    find: "    if (!currency) { reject(o, DISQUALIFIER.NO_CURRENCY); continue; }",
    replace: "    if (false) { reject(o, DISQUALIFIER.NO_CURRENCY); continue; }",
  },
  {
    id: "M88-FOREIGN-CURRENCY-PASSES-THROUGH",
    target: "market",
    invariant: "§9 a foreign amount must not become shekels by way of a missing branch.",
    kills: ["MA-8a", "MA-8b"],
    find: "      if (!proof) { reject(o, DISQUALIFIER.UNVERIFIED_FX); continue; }",
    replace: "      if (!proof) { ils = price; }",
  },
  {
    id: "M89-FX-PROOF-ARITHMETIC-UNCHECKED",
    target: "market",
    invariant: "§9 a proof whose own numbers disagree is a fabricated proof.",
    kills: ["MA-8e"],
    find: "  if (Math.abs(amount * rate - normalized) > 0.001) return null;",
    replace: "  if (false) return null;",
  },
  {
    id: "M90-MODEL-AUTHORITY-FIELD-ALLOWED",
    target: "market",
    invariant: "§16 a listing that claims authority is an injection attempt, not evidence.",
    kills: ["MA-1c"],
    find: "    if (assertsAuthority(o)) { reject(o, DISQUALIFIER.ASSERTED_AUTHORITY); continue; }",
    replace: "    if (false) { reject(o, DISQUALIFIER.ASSERTED_AUTHORITY); continue; }",
  },
  {
    id: "M91-TOKEN-NOT-MINTED",
    target: "market",
    invariant: "§3 authority is WeakSet membership; without the record nothing is authoritative.",
    kills: ["MA-0a", "MG-1b"],
    find: "  MARKET_AUTHORITY.add(token);",
    replace: "  if (false) MARKET_AUTHORITY.add(token);",
  },
  {
    id: "M92-FORGERY-ACCEPTED",
    target: "market",
    invariant: "§16 a plain object claiming to be the token is not the token.",
    kills: ["MA-1a", "MG-2a"],
    find: "  return typeof value === 'object' && value !== null && MARKET_AUTHORITY.has(value);",
    replace: "  return typeof value === 'object' && value !== null && value.class === VERIFIED_MARKET;",
  },
  {
    id: "M93-MODEL-SELF-REPORT-CAN-ADMIT",
    target: "market",
    invariant: "§3 the model's own match score may subtract, never add.",
    kills: ["MA-2a"],
    find: "    const verdict = identityCompatibility(toks, vocab);",
    replace: "    const verdict = (selfMatch !== null && selfMatch >= 0.9) ? null : identityCompatibility(toks, vocab);",
  },
  {
    id: "M94-NEW-RETAIL-TITLE-IGNORED",
    target: "market",
    invariant: "§4 the title is the server's word; a new listing is not used-market evidence.",
    kills: ["MA-9d"],
    find: "    if (!namesAny(toks, LIKE_NEW) && namesAny(toks, NEW_RETAIL)) { reject(o, DISQUALIFIER.NOT_USED); continue; }",
    replace: "    if (false) { reject(o, DISQUALIFIER.NOT_USED); continue; }",
  },
  {
    id: "M95-LIKE-NEW-READ-AS-NEW",
    target: "market",
    invariant: "like new is a USED listing; reading it as new silently starves every Hebrew quorum.",
    kills: ["MA-9e"],
    find: "    if (!namesAny(toks, LIKE_NEW) && namesAny(toks, NEW_RETAIL)) { reject(o, DISQUALIFIER.NOT_USED); continue; }",
    replace: "    if (namesAny(toks, NEW_RETAIL)) { reject(o, DISQUALIFIER.NOT_USED); continue; }",
  },
  {
    id: "M96-PROVENANCE-NOT-REQUIRED",
    target: "market",
    invariant: "§4 an observation with no source is not evidence.",
    kills: ["MA-9b"],
    find: "    if (!domain || !reference) { reject(o, DISQUALIFIER.NO_PROVENANCE); continue; }",
    replace: "    if (false) { reject(o, DISQUALIFIER.NO_PROVENANCE); continue; }",
  },
  {
    id: "M97-VERIFIED-MARKET-IS-ANCHORED",
    invariant: "§11 verified market is NOT a catalog anchor, and must not report as one.",
    kills: ["MG-1c"],
    find: "    return VALUATION_VERDICT.VERIFIED_MARKET;",
    replace: "    return VALUATION_VERDICT.ANCHORED;",
  },
  {
    id: "M98-VERIFIED-MARKET-OPENS-EVERY-BUCKET",
    invariant: "§11 only CATALOG authority short-circuits a bucket entry requirement.",
    kills: ["MG-3a"],
    find: "  if (have.has('ANCHOR')) return true;",
    replace: "  if (have.has('ANCHOR') || have.has('VERIFIED_MARKET')) return true;",
  },
  {
    id: "M99-VERIFIED-MARKET-EARNS-HIGH",
    invariant: "§11 the HIGH grade says GetWorth holds a priced row; market research does not.",
    kills: ["MG-3c"],
    find: "    if (verifiedMarket) return { source: 'verified_market', grade: 'MEDIUM' };",
    replace: "    if (verifiedMarket) return { source: 'stage2_comp_anchored', grade: 'HIGH' };",
  },
  {
    id: "M100-GUARD-READS-THE-FIELD-NOT-THE-MINT",
    invariant: "§16 the guard must derive authority from the mint, never from a caller's field.",
    kills: ["MG-2a", "MG-2b"],
    find: "  if (readMarketEvidence(ctx?.market_evidence) !== null && PRODUCT_LEVEL.has(rec)) {",
    replace: "  if (ctx?.market_evidence && PRODUCT_LEVEL.has(rec)) {",
  },
  {
    id: "M101-MARKET-EVIDENCE-PROMOTES-IDENTITY",
    invariant: "§7 market evidence may corroborate an identity, never be the reason for one.",
    kills: ["MG-4a"],
    find: "  if (readMarketEvidence(ctx?.market_evidence) !== null && PRODUCT_LEVEL.has(rec)) {",
    replace: "  if (readMarketEvidence(ctx?.market_evidence) !== null) {",
  },
];

export default MUTANTS;
