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
    find: '      : { source: \'stage2_ai\', grade: \'MEDIUM\' };',
    replace: '      : { source: \'stage2_comp_anchored\', grade: \'HIGH\' };',
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
    find: "      if (relationOf(w) === RELATION.REFERENCE) continue;",
    replace: "      if (false) continue;",
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
    find: "    if (env.requiresAnchorAboveSoft && !hasMarketAnchor(ctx)) {",
    replace: "    if (env.requiresAnchorAboveSoft && !ctx.anchor) {",
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
    kills: ["R5-2a","R5-2b"],
    find: "  const full = visionData?.ocr_context?.full_text;",
    replace: "  const full = visionData?.ocr_context?.full_text || (visionData?.text || []).join(' ');",
  },
  {
    id: "M62-REFERENCE-LINES-CORROBORATE",
    target: "authority",
    invariant: "R5-C1 a line describing compatibility does not establish subject identity.",
    kills: ["R5-2a","R5-3a"],
    find: "      if (relationOf(w) === RELATION.REFERENCE) continue;",
    replace: "      if (false) continue;",
  },
  {
    id: "M63-COMPATIBILITY-IS-ENGLISH-ONLY",
    target: "authority",
    invariant: "R5-H1 compatibility markers are recognised in the languages this market uses.",
    kills: ["R5-3a"],
    find: "    if (RTL_FOR_PREFIX.test(w)) return RELATION.REFERENCE;",
    replace: "    if (false) return RELATION.REFERENCE;",
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
    find: "    if (ACCESSORY_NOUN.has(w)) return RELATION.REFERENCE;",
    replace: "    if (false) return RELATION.REFERENCE;",
  },
];

export default MUTANTS;
