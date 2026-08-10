// ══════════════════════════════════════════════════════════════════════════════
// VAL-001 — contract tests for api/_lib/valuation-guard.js
//
// These test THE CONTRACT (scratchpad CHECKPOINT.md §D), not an implementation.
// A disagreement between the module and the contract is a FAILING TEST, never a
// test that gets relaxed. Rule ids in test names are the contract's own ids so a
// failure names the rule it broke.
//
// Pure unit tests: no network, no DB, no env. Runner is Node's built-in
// node:test — zero new dependencies.
//
//   node --test tests/valuation-guard.test.mjs
//
// VAL001_GUARD_PATH=<abs path> points the suite at a copy of the module; the
// mutation harness (tests/mutations/README.md) uses it to run this exact suite
// against a mutated copy under /tmp. The real module is never mutated.
// ══════════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);

const G = await import(GUARD_URL.href);
const {
  validateQuote, resolveEnvelope, derivePricingSource, normalizeConditionBasis,
  conditionDelta, applyTransform,
  isPricedVerdict, isPricedMarketValue, resolvePricingStatus, resolvePricingGrade,
  positivePriceOrNull,
  MANUAL_REQUIRED_STATUS,
  ENVELOPES, CONDITION_LADDER, VALIDATOR_VERSION, RULESET_VERSION,
} = G;

const GUARD_SRC = readFileSync(GUARD_URL, 'utf8');
const GRADES = ['HIGH', 'MEDIUM', 'LOW', 'MANUAL_REQUIRED'];

// ── fixtures ──────────────────────────────────────────────────────────────────
const rec = (o = {}) => ({
  category: 'Electronics', subcategory: 'Laptop', product_type: '',
  model_candidates: [], brand_candidates: [], ocr_text: { raw_texts: [] },
  visual_features: { condition: 'Good' }, ...o,
});
const ctx = (o = {}) => ({
  recognition: rec(o.recognition || {}), candidates: [], identity: { identityHigh: false },
  stage: 'stage2', pre_source: null, model: 'claude-test-model', anchor: null,
  ...o, ...(o.recognition ? { recognition: rec(o.recognition) } : {}),
});
const q = (o = {}) => ({ low: 800, mid: 1200, high: 1800, currency: 'ILS', ...o });
// price_method is model-declared; the reading site is the module's choice, so
// offer it on both the quote and the ctx and assert only on what comes back out.
const claiming = (method, over = {}) => ctx({ price_method: method, model_claimed_method: method, ...over });
const qClaiming = (method, over = {}) => q({ price_method: method, ...over });

const IPHONE = { category: 'Electronics', brand_candidates: [{ brand: 'Apple' }] };
const BOOKS = { category: 'Books', subcategory: '' };
const JEWELRY = { category: 'Jewelry', subcategory: 'ring' };
const ROLEX = { category: 'Watches', subcategory: 'watch', brand_candidates: [{ brand: 'Rolex' }] };
const UNKNOWN = { category: 'Quantum Widgets', subcategory: 'flux capacitor' };

const rules = (v) => v.violations.map((x) => x.rule);
const repairIds = (v) => v.repairs.map((x) => x.rule);
const hasRule = (v, re) => rules(v).some((r) => re.test(r));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// FALLBACK_PRICE_MAP is the sole per-category price evidence in the repo and the
// declared derivation source for ENVELOPES, so read it from api/analyze.js
// rather than restating it here — a drift between the two must fail.
function loadFallbackPriceMap() {
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  const block = src.match(/const FALLBACK_PRICE_MAP = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'FALLBACK_PRICE_MAP not found in api/analyze.js');
  const map = {};
  for (const line of block[1].split('\n')) {
    const e = line.match(/^\s*'([^']+)':\s*(null|\{[^}]*\})/);
    if (!e) continue;
    if (e[2] === 'null') { map[e[1]] = null; continue; }
    const n = {};
    for (const kv of e[2].matchAll(/(low|mid|high):\s*(\d+)/g)) n[kv[1]] = Number(kv[2]);
    map[e[1]] = n;
  }
  return map;
}
const FALLBACK = loadFallbackPriceMap();
const envOf = (k) => ENVELOPES[k];
const isManualOnly = (e) => e === null || e?.manual_only === true || e?.class === 'manual_only';

// ══ A. purity — the module is a pure function of its inputs ═══════════════════

test('P-01 no I/O imports (fs/net/http/child_process/@supabase/node:)', () => {
  const banned = /\b(?:import|require)\s*\(?\s*['"](?:node:)?(?:fs|net|http|https|dns|child_process|worker_threads|@supabase\/[^'"]+)['"]/;
  const fromClause = /from\s+['"](?:node:)?(fs|net|http|https|dns|child_process|worker_threads|@supabase\/[^'"]+)['"]/;
  assert.ok(!banned.test(GUARD_SRC), 'guard imports an I/O module');
  assert.ok(!fromClause.test(GUARD_SRC), 'guard imports an I/O module via from-clause');
});

test('P-02 no clock, no randomness, no process.env', () => {
  // Scan CODE only. The guard's header comment documents the purity contract in
  // prose ("no clock, no process.env, no imports"), which a raw source scan
  // matches as if it were a violation.
  const code = GUARD_SRC
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(!/process\.env/.test(code), 'guard reads process.env');
  assert.ok(!/Date\.now\(|new Date\(|performance\.now\(/.test(code), 'guard reads the clock');
  assert.ok(!/Math\.random\(/.test(code), 'guard uses randomness');
});

test('P-03 frozen inputs are never mutated', () => {
  const quote = deepFreeze(q({ low: 0, high: 0, mid: 1200.4 }));
  const c = deepFreeze(ctx());
  const before = JSON.stringify([quote, c]);
  const v = validateQuote(quote, c); // must not throw on frozen input
  assert.ok(v, 'no verdict returned');
  assert.equal(JSON.stringify([quote, c]), before, 'guard mutated its inputs');
});

test('P-04 ENVELOPES and CONDITION_LADDER are frozen', () => {
  assert.ok(Object.isFrozen(ENVELOPES), 'ENVELOPES not frozen');
  assert.ok(Object.isFrozen(CONDITION_LADDER), 'CONDITION_LADDER not frozen');
  assert.throws(() => { CONDITION_LADDER.used = 0.99; }, 'CONDITION_LADDER is writable');
});

test('P-05 versions are exported and pinned', () => {
  assert.equal(VALIDATOR_VERSION, 1);
  assert.equal(RULESET_VERSION, '2026-08-05.1');
});

// ══ B. envelope table integrity ═══════════════════════════════════════════════

test('E-01 every FALLBACK_PRICE_MAP key has an envelope', () => {
  const missing = Object.keys(FALLBACK).filter((k) => !(k in ENVELOPES));
  assert.deepEqual(missing, [], `envelope missing for: ${missing.join(', ')}`);
});

test('E-02 every null FALLBACK bucket is declared manual_only', () => {
  const nulls = Object.keys(FALLBACK).filter((k) => FALLBACK[k] === null);
  assert.ok(nulls.length >= 4, 'expected the repo\'s null buckets to still exist');
  for (const k of nulls) assert.ok(isManualOnly(envOf(k)), `${k} must be manual_only`);
});

test('E-03 floor < bucket.low <= bucket.high < soft_max < hard_max for every priced key', () => {
  for (const [k, b] of Object.entries(FALLBACK)) {
    if (b === null) continue;
    const e = envOf(k);
    assert.ok(!isManualOnly(e), `${k} is priced in FALLBACK but manual_only in ENVELOPES`);
    assert.ok(Number.isFinite(e.floor) && Number.isFinite(e.soft_max) && Number.isFinite(e.hard_max),
      `${k}: non-finite envelope bound`);
    assert.ok(e.floor < b.low, `${k}: floor ${e.floor} !< bucket.low ${b.low}`);
    assert.ok(b.low <= b.high, `${k}: bucket.low ${b.low} > bucket.high ${b.high}`);
    assert.ok(b.high < e.soft_max, `${k}: bucket.high ${b.high} !< soft_max ${e.soft_max}`);
    assert.ok(e.soft_max < e.hard_max, `${k}: soft_max ${e.soft_max} !< hard_max ${e.hard_max}`);
  }
});

test('E-04 envelopes are derived from FALLBACK (0.40 / 2.50 / 8.00), overrides only where declared', () => {
  const OVERRIDE = new Set(['watches:luxury']);
  for (const [k, b] of Object.entries(FALLBACK)) {
    if (b === null || OVERRIDE.has(k)) continue;
    const e = envOf(k);
    assert.equal(e.floor, Math.round(b.low * 0.40), `${k}: floor not low*0.40`);
    assert.equal(e.soft_max, Math.round(b.high * 2.50), `${k}: soft_max not high*2.50`);
    assert.equal(e.hard_max, Math.round(b.high * 8.00), `${k}: hard_max not high*8.00`);
  }
  const lux = envOf('watches:luxury');
  assert.equal(lux.soft_max, 40000, 'watches:luxury soft_max override');
  assert.equal(lux.hard_max, 250000, 'watches:luxury hard_max override');
});

test('E-05 no invented envelope keys outside FALLBACK (global/default key excepted)', () => {
  const allowed = new Set(['*', 'global', '__global__', 'default']);
  const extra = Object.keys(ENVELOPES).filter((k) => !(k in FALLBACK) && !allowed.has(k));
  assert.deepEqual(extra, [], `envelope keys with no FALLBACK evidence: ${extra.join(', ')}`);
});

test('E-06 resolveEnvelope reuses the analyze.js taxonomy', () => {
  assert.equal(resolveEnvelope(ctx({ recognition: IPHONE })).key, 'electronics:iphone');
  assert.equal(resolveEnvelope(ctx()).key, 'electronics:laptop');
  assert.equal(resolveEnvelope(ctx({ recognition: BOOKS })).key, 'books');
  assert.equal(resolveEnvelope(ctx({ recognition: JEWELRY })).key, 'jewelry');
  assert.equal(resolveEnvelope(ctx({ recognition: ROLEX })).key, 'watches:luxury');
  const g = resolveEnvelope(ctx({ recognition: UNKNOWN }));
  assert.ok(!(g.key in FALLBACK), 'unknown category must fall to the global envelope');
  assert.equal(g.hard_max, 500000, 'global ceiling is the ported ₪500,000');
});

// ══ C. rule set ═══════════════════════════════════════════════════════════════

// [id, quote, ctx, expected action, rule matcher (violations) | null]
const RULE_CASES = [
  // zero state — the deliberate degraded state, NOT a violation
  ['V-ZERO-01 manual_required 0/0/0 accepted', q({ low: 0, mid: 0, high: 0, pricing_status: 'manual_required' }), ctx(), 'accept', null],
  ['V-ZERO-02 bare 0/0/0 is not the zero state', q({ low: 0, mid: 0, high: 0 }), ctx(), 'degrade', /V-POSITIVE/],
  ['V-ZERO-03 manual_required with a nonzero mid falls through', q({ low: 0, mid: 900, high: 0, pricing_status: 'manual_required' }), ctx(), 'repair', null],
  ['V-ZERO-04 manual_required with nonzero low is not the zero state', q({ low: 5, mid: 0, high: 0, pricing_status: 'manual_required' }), ctx(), 'degrade', /V-POSITIVE/],
  // finiteness — on RAW values, so strings fail
  ['V-FINITE-01 string mid "1200"', q({ mid: '1200' }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-02 string low "800"', q({ low: '800' }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-03 string high "1800"', q({ high: '1800' }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-04 NaN mid', q({ mid: NaN }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-05 Infinity mid', q({ mid: Infinity }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-06 -Infinity high', q({ high: -Infinity }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-07 null mid', q({ mid: null }), ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-08 undefined mid (missing field)', { low: 800, high: 1800, currency: 'ILS' }, ctx(), 'degrade', /V-FINITE/],
  ['V-FINITE-09 object mid', q({ mid: { value: 1200 } }), ctx(), 'degrade', /V-FINITE/],
  // sign
  ['V-POSITIVE-01 mid 0', q({ mid: 0 }), ctx(), 'degrade', /V-POSITIVE/],
  ['V-POSITIVE-02 mid negative', q({ low: -900, mid: -500, high: -100 }), ctx(), 'degrade', /V-POSITIVE/],
  // currency — never silently relabel
  ['V-CURRENCY-01 USD degrades', q({ currency: 'USD' }), ctx(), 'degrade', /V-CURRENCY/],
  ['V-CURRENCY-02 absent currency is ILS', { low: 800, mid: 1200, high: 1800 }, ctx(), 'accept', null],
  // Lead ruling (VAL-001): currency matching is case-insensitive. 'ils' IS the
  // shekel; degrading a sound valuation to the rescue path over letter case
  // would be a false degradation that costs the user a real price. The rule
  // that matters — never silently RELABEL a genuinely different currency —
  // is covered by V-CURRENCY-01.
  ['V-CURRENCY-03 lowercase ils is accepted as ILS', q({ currency: 'ils' }), ctx(), 'accept', null],
  // envelope
  ['V-ENVELOPE-HARD-01 ₪250,000 iPhone', q({ low: 200000, mid: 250000, high: 300000 }), ctx({ recognition: IPHONE }), 'degrade', /V-ENVELOPE-HARD/],
  ['V-ENVELOPE-HARD-02 below floor', q({ low: 40, mid: 50, high: 60 }), ctx(), 'degrade', /V-ENVELOPE-HARD/],
  ['V-ENVELOPE-HARD-03 ₪12,000 book', q({ low: 9000, mid: 12000, high: 15000 }), ctx({ recognition: BOOKS }), 'degrade', /V-ENVELOPE-HARD/],
  ['V-ENVELOPE-SOFT-01 ₪12,000 laptop is real, flag it', q({ low: 10000, mid: 12000, high: 14000 }), ctx(), 'accept', null],
  // unknown category → global envelope
  ['ENV-GLOBAL-01 unknown category prices normally', q(), ctx({ recognition: UNKNOWN }), 'accept', null],
  ['ENV-GLOBAL-02 unknown category above the ₪500k ceiling', q({ low: 500000, mid: 600000, high: 700000 }), ctx({ recognition: UNKNOWN }), 'degrade', /V-ENVELOPE-HARD/],
  // manual_only categories
  ['ENV-MANUAL-01 jewelry over ₪2,000 with no anchor', q({ low: 4000, mid: 5000, high: 6000 }), ctx({ recognition: JEWELRY }), 'degrade', /ENVELOPE|MANUAL/],
  ['ENV-MANUAL-02 jewelry under ₪2,000', q({ low: 900, mid: 1200, high: 1600 }), ctx({ recognition: JEWELRY }), 'accept', null],
  // anchor-relative envelope wins and is tighter
  ['ENV-ANCHOR-01 3x retail degrades', q({ low: 2500, mid: 3000, high: 3500 }), ctx({ anchor: { retail_price_ils: 1000, similarity: 0.95 } }), 'degrade', /ENVELOPE|ANCHOR/],
  ['ENV-ANCHOR-02 under retail passes', q({ low: 500, mid: 700, high: 900 }), ctx({ anchor: { retail_price_ils: 1000, similarity: 0.95 } }), 'accept', null],
  // ordering
  // Lead ruling (VAL-001 contract §D): an inverted range DEGRADES, it is not
  // repaired. Repairing would mean inventing a band the model never gave, and
  // the only alternative — moving `mid` — is forbidden. An inverted range is a
  // strong signal the output is incoherent, so fail closed to the rescue path.
  ['V-ORDER-01 low > mid degrades', q({ low: 2000, mid: 1200, high: 3000 }), ctx(), 'degrade', /V-ORDER/],
  ['V-ORDER-02 mid > high degrades', q({ low: 400, mid: 1200, high: 800 }), ctx(), 'degrade', /V-ORDER/],
  // repairs
  ['R-ROUND-01 non-integer mid', q({ low: 800.2, mid: 1200.6, high: 1800.4 }), ctx(), 'repair', null],
  ['R-DERIVE-BAND-01 band missing', q({ low: 0, mid: 1200, high: 0 }), ctx(), 'repair', null],
  ['R-SPREAD-WIDEN-01 degenerate band', q({ low: 1200, mid: 1200, high: 1200 }), ctx(), 'repair', null],
  ['R-SPREAD-CLAMP-01 absurd spread', q({ low: 100, mid: 1200, high: 9000 }), ctx(), 'repair', null],
];

for (const [name, quote, c, expected, ruleRe] of RULE_CASES) {
  test(name, () => {
    const v = validateQuote(quote, c);
    assert.equal(v.action, expected, `expected ${expected}, got ${v.action} (violations: ${rules(v)}, repairs: ${repairIds(v)})`);
    if (ruleRe) assert.ok(hasRule(v, ruleRe), `expected a ${ruleRe} violation, got ${JSON.stringify(v.violations)}`);
  });
}

test('V-ZERO-01b zero state carries the MANUAL_REQUIRED grade and degraded flag', () => {
  const v = validateQuote(q({ low: 0, mid: 0, high: 0, pricing_status: 'manual_required' }), ctx());
  assert.equal(v.action, 'accept');
  assert.equal(v.metadata.degraded, true, 'zero state must be flagged degraded');
  assert.equal(v.metadata.pricing_grade, 'MANUAL_REQUIRED');
  assert.deepEqual(v.violations, [], 'the zero state is a deliberate state, not a violation');
  assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
});

test('V-ENVELOPE-SOFT-02 soft breach flags needs_review and steps the grade down exactly one', () => {
  const anchored = ctx({ anchor: { retail_price_ils: 20000, similarity: 0.95 } });
  const base = validateQuote(q({ low: 4000, mid: 5000, high: 6000 }), anchored);
  const soft = validateQuote(q({ low: 10000, mid: 12000, high: 14000 }), ctx());
  assert.equal(soft.action, 'accept', 'a legitimate high-value item must be priced, not degraded');
  assert.equal(soft.metadata.needs_review, true);
  assert.equal(base.metadata.needs_review, false);
  const plain = validateQuote(q(), ctx());
  assert.equal(GRADES.indexOf(soft.metadata.pricing_grade) - GRADES.indexOf(plain.metadata.pricing_grade), 1,
    'soft breach must step the grade down exactly one');
});

test('DEGRADE-NEVER-CLAMP absurd values are never rewritten to a bound', () => {
  const e = resolveEnvelope(ctx({ recognition: IPHONE }));
  const v = validateQuote(q({ low: 200000, mid: 250000, high: 300000 }), ctx({ recognition: IPHONE }));
  assert.equal(v.action, 'degrade');
  assert.notEqual(v.prices?.mid, e.hard_max, 'mid was clamped to hard_max — a confidently wrong number');
  assert.notEqual(v.prices?.mid, e.soft_max, 'mid was clamped to soft_max');
  const below = validateQuote(q({ low: 40, mid: 50, high: 60 }), ctx());
  assert.notEqual(below.prices?.mid, resolveEnvelope(ctx()).floor, 'mid was clamped up to floor');
});

// ══ D. pricing source — derived, never model-declared ═════════════════════════

const ANCHOR = { id: 'p1', retail_price_ils: 2000, similarity: 0.95, brand: 'Dell', model: 'XPS 13' };

const SOURCE_CASES = [
  ['S-01 stage2 + compatible anchor', ctx({ anchor: ANCHOR }), 'stage2_comp_anchored', 'HIGH'],
  ['S-02 stage2, no anchor', ctx(), 'stage2_ai', 'MEDIUM'],
  ['S-03 pre catalog', ctx({ stage: 'pre', pre_source: 'catalog' }), 'pre_catalog', null],
  ['S-04 pre haiku', ctx({ stage: 'pre', pre_source: 'ai_haiku' }), 'pre_haiku', 'MEDIUM'],
  ['S-05 category bucket', ctx({ stage: 'pre', pre_source: 'category_anchor' }), 'category_bucket', 'LOW'],
  ['S-06 no source', ctx({ stage: 'pre', pre_source: 'none' }), 'manual_required', 'MANUAL_REQUIRED'],
];

for (const [name, c, source, grade] of SOURCE_CASES) {
  test(name, () => {
    const d = derivePricingSource(c);
    assert.equal(d.source, source);
    if (grade) assert.equal(d.grade, grade);
  });
}

test('S-07 model-declared comp_based with no compatible anchor is MEDIUM, and the claim is recorded', () => {
  const v = validateQuote(qClaiming('comp_based'), claiming('comp_based'));
  assert.equal(v.metadata.pricing_source, 'stage2_ai', 'no anchor ⇒ source can never be comp-anchored');
  assert.equal(v.metadata.pricing_grade, 'MEDIUM', 'a self-declared comp_based must not buy the top grade');
  assert.equal(v.metadata.model_claimed_method, 'comp_based', 'the model claim must be recorded for drift measurement');
});

test('S-08 the model claim cannot change any price or grade', () => {
  const strip = (v) => ({ ...v, metadata: { ...v.metadata, model_claimed_method: null } });
  const a = validateQuote(qClaiming('comp_based'), claiming('comp_based'));
  const b = validateQuote(qClaiming('ai_estimate'), claiming('ai_estimate'));
  assert.deepEqual(strip(a), strip(b), 'price_method changed the verdict');
});

test('S-09 a confidently identified product is never priced from a category bucket', () => {
  const v = validateQuote(q(), ctx({ stage: 'pre', pre_source: 'category_anchor', identity: { identityHigh: true } }));
  assert.equal(v.action, 'degrade', 'B-15: category_bucket is illegal when identity is high-confidence');
});

// ══ E. condition applied exactly once — the headline regression ═══════════════

const CONDS = ['newSealed', 'likeNew', 'used', 'poor'];
// The contract's residual-delta rule (CHECKPOINT D1), stated here so the
// property is asserted against the contract and not against whatever the
// frontend happens to compute.
const residual = (basis, user) => {
  const b = normalizeConditionBasis(basis);
  if (b === null || !(user in CONDITION_LADDER)) return 0;          // fail-safe
  return CONDITION_LADDER[user] - CONDITION_LADDER[b];
};

test('C-01 normalizeConditionBasis maps the Stage-1 vocabulary', () => {
  const cases = [['New', 'newSealed'], ['Like New', 'likeNew'], ['Good', 'used'], ['Fair', 'used'], ['Poor', 'poor'],
    ['  good  ', 'used'], ['LIKE NEW', 'likeNew'], ['like_new', 'likeNew']];
  for (const [input, want] of cases) assert.equal(normalizeConditionBasis(input), want, `${JSON.stringify(input)}`);
});

test('C-02 unmappable basis is null (never a silent default)', () => {
  for (const bad of [null, undefined, '', 'unknown', 'banana', 123, {}, []]) {
    assert.equal(normalizeConditionBasis(bad), null, `${JSON.stringify(bad)} must map to null`);
  }
});

test('C-03 CONDITION_LADDER is the one server-owned copy of the discount table', () => {
  assert.deepEqual({ ...CONDITION_LADDER }, { newSealed: 0, likeNew: 0.15, used: 0.30, poor: 0.70 });
});

test('C-04 basis === user condition ⇒ delta 0 (no second discount)', () => {
  const basisFor = { newSealed: 'New', likeNew: 'Like New', used: 'Good', poor: 'Poor' };
  for (const c of CONDS) assert.equal(residual(basisFor[c], c), 0, `${c} double-discounted`);
});

test('C-05 absent/unmappable basis ⇒ delta 0 for every user condition (fail-safe)', () => {
  for (const basis of [null, undefined, '', 'unknown', 'banana']) {
    for (const c of CONDS) assert.equal(residual(basis, c), 0, `basis=${basis} cond=${c} must not adjust`);
  }
});

test('C-06 a strictly better user condition can only raise the price', () => {
  for (let i = 0; i < CONDS.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = residual({ newSealed: 'New', likeNew: 'Like New', used: 'Good', poor: 'Poor' }[CONDS[i]], CONDS[j]);
      assert.ok(d < 0, `${CONDS[j]} vs basis ${CONDS[i]} must raise (delta ${d})`);
      assert.ok(1 - d > 1, 'multiplier must exceed 1 for a better condition');
    }
  }
});

test('C-07 applying the residual twice is a no-op (condition applied exactly once)', () => {
  const base = 1000;
  for (const basis of ['New', 'Like New', 'Good', 'Poor']) {
    for (const user of CONDS) {
      const once = Math.round(base * (1 - residual(basis, user)));
      // after applying, the basis IS the user's condition — a second pass must not move it
      const twice = Math.round(once * (1 - residual({ newSealed: 'New', likeNew: 'Like New', used: 'Good', poor: 'Poor' }[user], user)));
      assert.equal(twice, once, `basis=${basis} user=${user} discounted twice`);
    }
  }
});

test('C-08 the guard itself applies no condition math — identical quote, any condition, identical prices', () => {
  const out = ['New', 'Like New', 'Good', 'Fair', 'Poor', 'unknown', undefined].map((cond) =>
    JSON.stringify(validateQuote(q(), ctx({ recognition: { visual_features: { condition: cond } } })).prices));
  assert.equal(new Set(out).size, 1, `guard re-priced by condition: ${[...new Set(out)].join(' | ')}`);
});

test('C-09 the guard emits the condition basis it priced for', () => {
  const v = validateQuote(q(), ctx({ recognition: { visual_features: { condition: 'Good' } } }));
  assert.equal(v.metadata.condition_basis, 'used');
  const u = validateQuote(q(), ctx({ recognition: { visual_features: { condition: 'unknown' } } }));
  assert.equal(u.metadata.condition_basis, null, 'unmappable basis must surface as null, not a default');
});

test('C-10 the client ladder fallback can never drift from the server ladder', async () => {
  // The client keeps a local CONDITION_LADDER as the fallback for responses
  // that predate marketValue.condition_ladder (older deploy, cached result).
  // That duplicate is deliberate — but two copies are exactly how a ruleset
  // silently forks, so assert VALUE equality rather than banning the constant.
  //
  // This replaces an earlier source-regex check that was backwards: editing a
  // rung (used 0.30 -> 0.35) stopped the pattern matching and made the test
  // PASS, which is the precise drift it was meant to catch.
  const { CONDITION_LADDER: CLIENT } = await import('../src/lib/utils.js');
  assert.deepEqual(
    { ...CLIENT }, { ...CONDITION_LADDER },
    'client fallback ladder has drifted from api/_lib/valuation-guard.js — the server table is the authority (D1)',
  );
  assert.ok(Object.isFrozen(CLIENT), 'client ladder must be frozen');
});

test('C-11 calcPrice does not re-discount a price already at the user\'s condition', async () => {
  const { calcPrice } = await import('../src/lib/utils.js');
  const marketValue = {
    low: 800, mid: 1000, high: 1300, currency: 'ILS', pricing_status: 'ok',
    condition_basis: 'used', condition_ladder: { ...CONDITION_LADDER },
  };
  // Signature is frontend-owned; accept any form that carries the basis through.
  const forms = [
    () => calcPrice(1000, 'used', {}, 'Electronics', marketValue),
    () => calcPrice(1000, 'used', {}, 'Electronics', 'used'),
    () => calcPrice(marketValue, 'used', {}, 'Electronics'),
  ];
  const got = forms.map((f) => { try { return f(); } catch { return null; } });
  assert.ok(got.some((r) => r === 1000),
    `every calcPrice form re-discounted a used-basis price to ${got.join('/')} instead of 1000 (double discount, CHECKPOINT D1)`);
});

// ══ F. determinism + global invariants over the whole corpus ══════════════════

const CORPUS = RULE_CASES.map(([id, quote, c]) => ({ id, quote, c })).concat([
  { id: 'corpus-anchored', quote: q(), c: ctx({ anchor: ANCHOR }) },
  { id: 'corpus-claimed', quote: qClaiming('comp_based'), c: claiming('comp_based') },
  { id: 'corpus-pre-haiku', quote: q(), c: ctx({ stage: 'pre', pre_source: 'ai_haiku' }) },
  { id: 'corpus-rolex-anchored', quote: q({ low: 30000, mid: 35000, high: 40000 }), c: ctx({ recognition: ROLEX, anchor: { retail_price_ils: 60000, similarity: 0.93 } }) },
  { id: 'corpus-rolex-bare', quote: q({ low: 30000, mid: 35000, high: 40000 }), c: ctx({ recognition: ROLEX }) },
]);

test('D-01 identical inputs produce byte-identical verdicts across repeated runs', () => {
  for (const { id, quote, c } of CORPUS) {
    const first = JSON.stringify(validateQuote(quote, c));
    for (let i = 0; i < 25; i++) {
      assert.equal(JSON.stringify(validateQuote(quote, c)), first, `${id}: verdict is not deterministic`);
    }
  }
});

test('D-02 verdict + metadata shape is exactly the contract', () => {
  const v = validateQuote(q(), ctx());
  assert.deepEqual(Object.keys(v).sort(), ['action', 'currency', 'metadata', 'prices', 'repairs', 'violations']);
  // Contract amended by the lead during Wave 2, deliberately and additively:
  //   envelope_basis — which envelope actually bound the price (anchor /
  //     category / manual_only / global). Without it a degrade citing an
  //     envelope cannot be reproduced from the stored record.
  //   model — the model string that produced the number. MODEL_VISION is an
  //     unpinnable alias, so recording it per valuation is the only way a
  //     silent alias-repoint is reconstructable after the fact.
  assert.deepEqual(Object.keys(v.metadata).sort(), [
    'condition_basis', 'degraded', 'degraded_reason', 'envelope_basis', 'envelope_key',
    'model', 'model_claimed_method',
    'needs_review', 'pricing_grade', 'pricing_source', 'ruleset_version', 'validator_version',
  ].sort());
});

test('I-01 corpus invariants: integers, order, non-negative low, mid never moved, four repairs only', () => {
  const REPAIRS = new Set(['R-ROUND', 'R-DERIVE-BAND', 'R-SPREAD-CLAMP', 'R-SPREAD-WIDEN']);
  for (const { id, quote, c } of CORPUS) {
    const v = validateQuote(quote, c);
    assert.ok(['accept', 'repair', 'degrade'].includes(v.action), `${id}: bad action ${v.action}`);
    assert.equal(v.currency, 'ILS', `${id}: currency must always be ILS`);
    assert.equal(v.metadata.validator_version, VALIDATOR_VERSION, `${id}`);
    assert.equal(v.metadata.ruleset_version, RULESET_VERSION, `${id}`);
    for (const r of repairIds(v)) assert.ok(REPAIRS.has(r), `${id}: unknown repair ${r}`);
    if (v.action === 'degrade') continue;
    const { low, mid, high } = v.prices;
    for (const [k, n] of Object.entries(v.prices)) assert.ok(Number.isInteger(n), `${id}: ${k}=${n} is not an integer`);
    assert.ok(low >= 0, `${id}: negative low ${low}`);
    assert.ok(low <= mid && mid <= high, `${id}: order violated ${low}/${mid}/${high}`);
    if (Number.isFinite(quote.mid)) assert.equal(mid, Math.round(quote.mid), `${id}: mid was moved ${quote.mid} → ${mid}`);
  }
});

test('I-02 accept with no repairs returns the input triple untouched', () => {
  const v = validateQuote(q(), ctx());
  assert.equal(v.action, 'accept');
  assert.deepEqual(v.repairs, []);
  assert.deepEqual(v.prices, { low: 800, mid: 1200, high: 1800 });
});

test('I-03 degrade always names the rule that caused it', () => {
  for (const { id, quote, c } of CORPUS) {
    const v = validateQuote(quote, c);
    if (v.action !== 'degrade') continue;
    assert.ok(v.violations.length > 0, `${id}: degraded with no violation recorded`);
    assert.equal(v.metadata.degraded, true, `${id}: degraded action without degraded metadata`);
    assert.ok(v.metadata.degraded_reason, `${id}: degraded with no reason`);
  }
});

// ══ G. both paths are validated by the same rules ═════════════════════════════

test('PATH-01/02 primary and fallback quotes go through an identical rule set', () => {
  const cases = [q({ mid: NaN }), q({ mid: '1200' }), q({ mid: 0 }), q({ currency: 'USD' }),
    q({ low: 200000, mid: 250000, high: 300000 })];
  for (const quote of cases) {
    const s2 = validateQuote(quote, ctx({ stage: 'stage2' }));
    const pre = validateQuote(quote, ctx({ stage: 'pre', pre_source: 'ai_haiku' }));
    assert.equal(s2.action, pre.action, `stage2 ${s2.action} vs pre ${pre.action} for ${JSON.stringify(quote)}`);
    assert.deepEqual(rules(s2), rules(pre), 'the fallback path must not have a weaker rule set');
  }
});

// ══ H. mutation-derived tests ═════════════════════════════════════════════════
//
// Every test below closes a hole found by tests/mutations/run.mjs: a deliberate
// break in the guard that this suite passed straight over. Each names the mutant
// it kills. Do not delete one without deleting its mutant — the harness fails if
// the pair goes out of sync.

test('M-01 (kills M07) an unordered triple DEGRADES — it is never silently repaired into order', () => {
  // low > mid is a contradiction, not a rounding artifact. Repairing it would
  // invent a `low` the pipeline never produced and ship it graded HIGH.
  const v = validateQuote(q({ low: 1500, mid: 1000, high: 1200 }), ctx({ anchor: ANCHOR }));
  assert.equal(v.action, 'degrade', 'unordered input must be rejected, not repaired');
  assert.ok(hasRule(v, /V-ORDER/), `expected V-ORDER, got ${rules(v).join(',')}`);
  assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 });
});

test('M-02 (kills M12) a PRE catalog row earns MEDIUM only when its MODEL column was hit', () => {
  // S-03 asserted the source but passed `null` for the grade, so grade inflation
  // on the unevidenced branch went unnoticed.
  const base = { stage: 'pre', pre_source: 'catalog' };
  assert.equal(derivePricingSource({ ...base, anchorModelEvidence: false }).grade, 'LOW');
  assert.equal(derivePricingSource({ ...base }).grade, 'LOW', 'absent evidence must grade as absent, not assumed');
  assert.equal(derivePricingSource({ ...base, anchorModelEvidence: true }).grade, 'MEDIUM');
});

test('M-03 (kills M14) a degraded verdict emits 0/0/0 — the rejected number never leaves the guard', () => {
  // DEGRADE-NEVER-CLAMP only proved mid was not rewritten to a BOUND; it allowed
  // the original rejected price to pass through untouched, which is worse.
  const rejected = [
    q({ low: -50, mid: 1000, high: 2000 }),
    q({ low: 1500, mid: 1000, high: 1200 }),
    q({ low: 200000, mid: 250000, high: 300000 }),
    q({ currency: 'USD' }),
    q({ mid: 'not-a-number' }),
  ];
  for (const quote of rejected) {
    const v = validateQuote(quote, ctx({ recognition: IPHONE }));
    assert.equal(v.action, 'degrade', `expected degrade for ${JSON.stringify(quote)}`);
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 },
      `degraded verdict leaked a price for ${JSON.stringify(quote)}: ${JSON.stringify(v.prices)}`);
    assert.equal(v.metadata.pricing_grade, 'MANUAL_REQUIRED');
  }
  // and the same for the whole corpus, so a new degrade path cannot skip it
  for (const { id, quote, c } of CORPUS) {
    const v = validateQuote(quote, c);
    if (v.action !== 'degrade') continue;
    assert.deepEqual(v.prices, { low: 0, mid: 0, high: 0 }, `${id}: degraded verdict leaked a price`);
  }
});

test('M-04 (kills M18) a transform that drives mid below the envelope floor degrades to 0/0/0', () => {
  // The replica multipliers (0.07/0.15/0.28) are exactly where this bites: the
  // envelope guarantee is void unless it is re-asserted AFTER the multiply.
  const c = ctx({ anchor: ANCHOR });
  const env = resolveEnvelope(c);
  const base = validateQuote(q({ low: 800, mid: 1000, high: 1200 }), c);
  assert.equal(base.action, 'accept');

  // The anchor basis sets floor 160 here, so the harshest replica multiplier
  // (0.07 -> mid 70) is itself below the floor and must fail closed.
  for (const m of [0.001, 0.07]) {
    const sunk = applyTransform(base, { multiplier: m, reason: 'test', ctx: c });
    assert.equal(sunk.metadata.degraded, true,
      `mid ${Math.round(1000 * m)} is below floor ${env.floor} and must degrade`);
    assert.deepEqual(sunk.prices, { low: 0, mid: 0, high: 0 }, 'a sub-floor transformed price must not be emitted');
  }

  // a multiplier that stays inside the envelope still prices, and stays ordered
  const ok = applyTransform(base, { multiplier: 0.28, reason: 'test', ctx: c });
  assert.notEqual(ok.metadata.degraded, true, 'an in-envelope transform must still price');
  assert.ok(ok.prices.mid >= env.floor, 'a surviving transform must sit at or above the floor');
  assert.ok(ok.prices.low <= ok.prices.mid && ok.prices.mid <= ok.prices.high, 'transform broke ordering');
  assert.equal(ok.metadata.needs_review, true, 'a transformed price is always review-worthy');
});

test('M-07 (kills M23) a transform may not weaken V-POSITIVE — a low that rounds to 0 degrades', () => {
  // Reachable with a REAL replica multiplier, not a contrived one: a cheap book
  // at 7/29/42 (spread 6.0, the weak-identity limit) times 0.07 gives
  // low 0.49 -> 0 while mid 2.03 -> 2 clears the books floor of 2 and the
  // triple stays ordered. Without the low check the guard would emit a band
  // starting at ₪0, which validateQuote itself rejects outright.
  const c = ctx({ recognition: BOOKS });
  const base = validateQuote(q({ low: 7, mid: 29, high: 42 }), c);
  assert.equal(base.action, 'accept', 'fixture must be accepted before the transform');

  const t = applyTransform(base, { multiplier: 0.07, reason: 'replica', ctx: c });
  assert.equal(t.metadata.degraded, true, 'a post-transform low of 0 must degrade');
  assert.deepEqual(t.prices, { low: 0, mid: 0, high: 0 });
  assert.match(t.metadata.degraded_reason, /low/, 'the reason must name the rule that actually failed');
});

test('M-05 (kills M21) the EXPORTED conditionDelta is the one under test, and it fail-safes', () => {
  // The suite's local `residual` helper is a re-implementation. C-04..C-07
  // therefore tested the test, not the module: conditionDelta could return NaN
  // and every one of them still passed. Bind the two together here.
  for (const basis of [null, undefined, '', 'unknown', 'banana']) {
    for (const c of CONDS) {
      const d = conditionDelta(basis, c);
      assert.equal(d, 0, `conditionDelta(${String(basis)}, ${c}) must fail safe to 0, got ${d}`);
      assert.ok(!Number.isNaN(d), 'NaN would propagate into the client price as NaN');
    }
  }
  // the module and the local helper must agree everywhere, or the helper is lying
  const basisFor = { newSealed: 'New', likeNew: 'Like New', used: 'Good', poor: 'Poor' };
  for (const b of [...CONDS.map((k) => basisFor[k]), null, 'unknown']) {
    for (const u of CONDS) {
      assert.equal(conditionDelta(b, u), residual(b, u),
        `residual() has drifted from the module for basis=${String(b)} user=${u}`);
    }
  }
});

test('M-06 (kills M22) the guard applies no condition math via the QUOTE field either', () => {
  // C-08 only varied ctx.recognition.visual_features.condition. The quote's own
  // `condition` field is read first (it is the higher-priority basis source), so
  // condition math introduced there was invisible to the suite.
  const out = ['New', 'Like New', 'Good', 'Fair', 'Poor', 'unknown', undefined].map((condition) =>
    JSON.stringify(validateQuote(q({ condition }), ctx({ anchor: ANCHOR })).prices));
  assert.equal(new Set(out).size, 1, `guard re-priced by the quote's condition: ${[...new Set(out)].join(' | ')}`);

  // and the basis is still reported, so the client can apply the residual once
  const v = validateQuote(q({ condition: 'Poor' }), ctx({ anchor: ANCHOR }));
  assert.equal(v.metadata.condition_basis, 'poor');
  assert.equal(v.prices.mid, 1200, 'the emitted mid must be the quote mid, unadjusted');
});

// ══ I. presentation boundary — MANUAL_REQUIRED never becomes a priced status ══
// UI-003 Wave 0. The defect: api/analyze.js gated the manual-pricing status on
// `degraded && pricing_source === 'manual_required'`, but degrade() preserves
// the ORIGINALLY DERIVED source, so every rejected quote fell through to
// `ai_estimate` carrying a 0/0/0 triple. These tests pin the invariant that the
// permission (action/degraded/grade/prices) and the diagnostic (pricing_source)
// are never conflated again.

// Every source derivePricingSource can produce. If ANY of them can escape the
// boundary, the defect is back.
const ALL_SOURCE_CTXS = [
  ['stage2_ai',            ctx()],
  ['stage2_comp_anchored', ctx({ anchor: ANCHOR })],
  ['pre_catalog',          ctx({ stage: 'pre', pre_source: 'catalog' })],
  ['pre_haiku',            ctx({ stage: 'pre', pre_source: 'ai_haiku' })],
  ['category_bucket',      ctx({ stage: 'pre', pre_source: 'category_anchor' })],
  ['manual_required',      ctx({ stage: 'pre', pre_source: 'none' })],
  ['unknown',              ctx({ stage: 'weird' })],
];

test('PB-01 a degraded verdict is unpriced for EVERY derived pricing_source', () => {
  for (const [name, c] of ALL_SOURCE_CTXS) {
    // a non-finite mid is the exact reproduction case from the defect report
    const v = validateQuote({ low: 100, mid: 'not-a-number', high: 900, price_method: 'ai_estimate' }, c);
    assert.equal(v.action, 'degrade', `${name}: expected a degrade`);
    assert.equal(isPricedVerdict(v), false, `${name}: a degraded verdict claimed to be priced`);
    for (const candidate of ['ai_estimate', 'db_based', 'db_fallback', 'rescue_estimate', 'category_fallback', '', null, undefined]) {
      assert.equal(resolvePricingStatus(v, candidate), MANUAL_REQUIRED_STATUS,
        `${name}: candidate ${JSON.stringify(candidate)} promoted a degraded verdict to a priced status`);
      assert.equal(resolvePricingGrade(v, 'HIGH'), 'MANUAL_REQUIRED',
        `${name}: a degraded verdict kept a priced grade`);
    }
    // and the diagnostic is deliberately NOT manual_required — that is the whole
    // point: the boundary must hold without it.
    if (name !== 'manual_required') {
      assert.equal(v.metadata.pricing_source, name,
        `${name}: degrade() must preserve the derived source so the rejection stays attributable`);
    }
  }
});

test('PB-02 zero is never a priced status — no flag combination can override the number', () => {
  // A hand-built verdict with every flag saying "fine" and a 0 mid. The numeric
  // half of the predicate must reject it on its own.
  const clean = (prices) => ({
    action: 'accept', prices, currency: 'ILS', repairs: [], violations: [],
    metadata: { pricing_source: 'stage2_comp_anchored', pricing_grade: 'HIGH', degraded: false, needs_review: false },
  });
  for (const prices of [
    { low: 0, mid: 0, high: 0 },
    { low: 0, mid: 1200, high: 1800 },
    { low: -5, mid: -5, high: -5 },
    { low: 800, mid: NaN, high: 1800 },
    { low: 800, mid: 1200, high: 900 },   // high < mid
    { low: 800, mid: null, high: 1800 },
  ]) {
    const v = clean(prices);
    assert.equal(isPricedVerdict(v), false, `priced a bad triple ${JSON.stringify(prices)}`);
    assert.equal(resolvePricingStatus(v, 'db_based'), MANUAL_REQUIRED_STATUS,
      `emitted db_based over ${JSON.stringify(prices)}`);
    assert.equal(resolvePricingGrade(v, 'HIGH'), 'MANUAL_REQUIRED');
  }
  assert.equal(isPricedVerdict(null), false, 'a missing verdict must be unpriced');
  assert.equal(resolvePricingStatus(null, 'ai_estimate'), MANUAL_REQUIRED_STATUS);
});

test('PB-03 the V-ZERO-STATE accept path is unpriced too (accept != priced)', () => {
  const v = validateQuote(q({ low: 0, mid: 0, high: 0, pricing_status: 'manual_required' }), ctx());
  assert.equal(v.action, 'accept', 'precondition: the zero state is accepted, not a violation');
  assert.equal(isPricedVerdict(v), false, 'an ACCEPTED zero state must still be unpriced');
  assert.equal(resolvePricingStatus(v, 'ai_estimate'), MANUAL_REQUIRED_STATUS);
});

test('PB-03b `degraded` alone is disqualifying — each half of the predicate stands on its own', () => {
  // Not redundant with `action === 'degrade'`. `marketValue.validation` persists
  // the METADATA (api/analyze.js writes {...verdict.metadata, action, …} into
  // valuations.ai_raw_response and the memory observation ledger), so a verdict
  // reconstructed from storage — or built by a future caller — can carry
  // degraded:true with a stale action and a stale triple. Each disqualifying
  // signal must be independently sufficient, which is what makes the boundary
  // hold under partial data rather than only under the guard's own output.
  const reconstructed = {
    action: 'accept',                                  // stale / absent in storage
    prices: { low: 800, mid: 1200, high: 1800 },       // the pre-rejection numbers
    metadata: { pricing_source: 'stage2_ai', pricing_grade: 'HIGH', degraded: true,
                degraded_reason: 'V-ENVELOPE-HARD: mid 1200 > hard_max' },
  };
  assert.equal(isPricedVerdict(reconstructed), false,
    'degraded:true was ignored because the action and the numbers looked healthy');
  assert.equal(resolvePricingStatus(reconstructed, 'db_based'), MANUAL_REQUIRED_STATUS);
  assert.equal(resolvePricingGrade(reconstructed, 'HIGH'), 'MANUAL_REQUIRED');

  // ...and the grade alone is disqualifying too, on the same reasoning.
  const gradeOnly = {
    action: 'accept', prices: { low: 800, mid: 1200, high: 1800 },
    metadata: { pricing_source: 'stage2_comp_anchored', pricing_grade: 'MANUAL_REQUIRED', degraded: false },
  };
  assert.equal(isPricedVerdict(gradeOnly), false, 'a MANUAL_REQUIRED grade was ignored');
  assert.equal(resolvePricingStatus(gradeOnly, 'db_based'), MANUAL_REQUIRED_STATUS);

  // ...and so is a missing action, with everything else clean.
  const actionOnly = {
    action: 'degrade', prices: { low: 800, mid: 1200, high: 1800 },
    metadata: { pricing_source: 'stage2_ai', pricing_grade: 'HIGH', degraded: false },
  };
  assert.equal(isPricedVerdict(actionOnly), false, 'action:degrade was ignored');
});

test('PB-04 a healthy verdict is priced, and the candidate label only ever narrows', () => {
  const v = validateQuote(q(), ctx({ anchor: ANCHOR }));
  assert.equal(isPricedVerdict(v), true);
  assert.equal(resolvePricingStatus(v, 'db_based'), 'db_based');
  assert.equal(resolvePricingStatus(v, 'rescue_estimate'), 'rescue_estimate');
  assert.equal(resolvePricingStatus(v, ''), 'ai_estimate', 'a priced verdict with no label defaults to ai_estimate');
  // a caller that itself knows the price is unusable is honoured, never overridden
  assert.equal(resolvePricingStatus(v, MANUAL_REQUIRED_STATUS), MANUAL_REQUIRED_STATUS);
  assert.equal(resolvePricingGrade(v, 'LOW'), 'HIGH', 'the verdict grade wins over the caller candidate');
});

test('PB-05 status and grade never disagree about whether a price exists, over the whole corpus', () => {
  for (const { id, quote, c } of CORPUS) {
    const v = validateQuote(quote, c);
    const s = resolvePricingStatus(v, 'ai_estimate');
    const g = resolvePricingGrade(v, 'MEDIUM');
    assert.equal(s === MANUAL_REQUIRED_STATUS, g === 'MANUAL_REQUIRED',
      `${id}: status=${s} disagrees with grade=${g}`);
    if (s !== MANUAL_REQUIRED_STATUS) {
      assert.ok(v.prices.mid > 0 && v.prices.low > 0 && v.prices.high >= v.prices.mid,
        `${id}: priced as ${s} with triple ${JSON.stringify(v.prices)}`);
    }
  }
});

test('PB-06 a post-transform degrade is unpriced (the replica path cannot leak a priced status)', () => {
  const v = validateQuote(q({ low: 800, mid: 1200, high: 1800 }), ctx());
  assert.equal(isPricedVerdict(v), true, 'precondition');
  const t = applyTransform(v, { multiplier: 0.07, reason: 'authenticity:low_quality_fake', ctx: ctx() });
  assert.equal(t.action, 'degrade', 'precondition: 1200 x 0.07 = 84 is below the electronics:laptop floor');
  assert.equal(isPricedVerdict(t), false);
  assert.equal(resolvePricingStatus(t, 'ai_estimate'), MANUAL_REQUIRED_STATUS);
});

test('PB-07 isPricedMarketValue applies the same rule to the WIRE shape', () => {
  // The persistence sinks and the client hold a normalized marketValue, not a
  // verdict. The numeric half is what protects them from a response cached by a
  // deploy that predates this fix: priced label, zero number.
  assert.equal(isPricedMarketValue({ pricing_status: 'ai_estimate', low: 0, mid: 0, high: 0 }), false,
    'the exact shipped-defect shape must be rejected');
  assert.equal(isPricedMarketValue({ pricing_status: 'manual_required', low: 800, mid: 1200, high: 1800 }), false);
  assert.equal(isPricedMarketValue({ pricing_status: 'db_based', low: 800, mid: 1200, high: 1800 }), true);
  assert.equal(isPricedMarketValue({ pricing_status: 'ai_estimate', low: 800, mid: '1200', high: 1800 }), true,
    'a numeric string over the wire is still a number');
  assert.equal(isPricedMarketValue(null), false);
  assert.equal(isPricedMarketValue({}), false);
});

test('PB-08 the client mirror (src/lib/utils.js hasRealPrice) cannot drift from the server rule', async () => {
  // Duplicated deliberately (the guard is a serverless module carrying the whole
  // envelope table), so — exactly as with CONDITION_LADDER / C-10 — assert
  // BEHAVIOUR equality across a corpus rather than banning the duplicate.
  const { hasRealPrice } = await import('../src/lib/utils.js');

  // The corpus is GENERATED, not hand-listed. A curated list only catches the
  // divergences its author thought of: an earlier version of this test missed
  // `mid <= 0` weakened to `mid < 0`, because it happened to contain no case
  // with mid === 0 and a positive low — the low check masked it and the test
  // passed vacuously. The cross-product below exercises every field at every
  // boundary independently, so no single-condition edit can hide behind another.
  const VALUES = [undefined, null, NaN, -1, 0, 1, 800, 1200, 1800, '1200', '0'];
  const STATUSES = [undefined, 'manual_required', 'ai_estimate', 'db_based'];
  const CASES = [null, undefined, {}, { mid: 1200 }, { low: 800, high: 1800 }];
  for (const pricing_status of STATUSES) {
    for (const low of VALUES) for (const mid of VALUES) for (const high of VALUES) {
      CASES.push({ pricing_status, low, mid, high });
    }
  }

  let compared = 0;
  for (const mv of CASES) {
    assert.equal(hasRealPrice(mv), isPricedMarketValue(mv),
      `client hasRealPrice has drifted from api/_lib/valuation-guard.js isPricedMarketValue for ${JSON.stringify(mv)}`);
    compared++;
  }
  assert.ok(compared > 5000, `corpus collapsed to ${compared} cases — the drift test is no longer discriminating`);
  // Both must actually DISCRIMINATE. Two functions that return false for every
  // input would agree perfectly and prove nothing.
  assert.ok(CASES.some((mv) => isPricedMarketValue(mv) === true), 'no case is priced — the corpus proves nothing');
  assert.ok(CASES.some((mv) => isPricedMarketValue(mv) === false), 'no case is unpriced — the corpus proves nothing');
});

test('PB-09 api/analyze.js reads the boundary — the provenance-gated ternary is gone', async () => {
  // A source assertion, because the hole was in the CALLER, not the guard: the
  // guard was already emitting degraded/MANUAL_REQUIRED/0-0-0 correctly and
  // analyze.js threw that away. Nothing in the module suite can see that.
  const src = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
  assert.ok(/pricing_status:\s*resolvePricingStatus\(/.test(src),
    'analyze.js no longer routes pricing_status through resolvePricingStatus()');
  assert.ok(/pricing_confidence:\s*resolvePricingGrade\(/.test(src),
    'analyze.js no longer routes pricing_confidence through resolvePricingGrade()');
  assert.ok(!/degraded\s*&&\s*\w+\.metadata\.pricing_source\s*===\s*'manual_required'/.test(src),
    'the provenance-gated manual_required ternary is back — pricing_source is a diagnostic, not a permission');
});

test('PB-10 formatPrice no longer hides a zero (the accidental safety net is gone)', async () => {
  // The old `p ? … : ''` made ₪0 invisible, which looked like a fix and was in
  // fact the reason the shipped defect rendered a BLANK hero instead of ₪0.
  // Hiding a zero is not fixing a zero: the source of truth is hasRealPrice.
  const { formatPrice } = await import('../src/lib/utils.js');
  assert.equal(formatPrice(0), '₪0', 'formatPrice must render a zero it is given');
  assert.equal(formatPrice(null), '');
  assert.equal(formatPrice(undefined), '');
  assert.equal(formatPrice(''), '');
  assert.equal(formatPrice(NaN), '');
  assert.equal(formatPrice(1200), '₪1,200');
});

test('PB-11 calcPrice returns null (never 0) for the degraded shape', async () => {
  const { calcPrice } = await import('../src/lib/utils.js');
  assert.equal(calcPrice({ pricing_status: 'ai_estimate', low: 0, mid: 0, high: 0 }, 'used'), null,
    'a degraded 0/0/0 mislabelled ai_estimate must not become a suggested listing price');
  assert.equal(calcPrice({ pricing_status: 'manual_required', low: 0, mid: 0, high: 0 }, 'used'), null);
  assert.equal(calcPrice(null, 'used'), null);
  // the documented bare-number form still works (no band ⇒ delta 0)
  assert.equal(calcPrice(1000, 'used'), 1000);
});

// ══════════════════════════════════════════════════════════════════════════════
// UI-003 Wave 0 — Gap B: the reference-price rule
// ══════════════════════════════════════════════════════════════════════════════

test('PB-12 the client mirror (src/lib/utils.js positivePriceOrNull) cannot drift from the server rule', async () => {
  // Same arrangement as PB-08 / C-10: duplicated deliberately (the guard is a
  // serverless module carrying the whole envelope table), so assert BEHAVIOUR
  // equality across a generated corpus rather than banning the duplicate.
  const { positivePriceOrNull: client } = await import('../src/lib/utils.js');

  const CASES = [
    undefined, null, NaN, Infinity, -Infinity, '', ' ', '0', '700', '700.5', '-1', 'x', 'n/a',
    -1, -0.0001, 0, 0.0001, 0.5, 1, 700, 1e9, true, false, {}, [], [700], '1e3', '0x10',
  ];
  let compared = 0, kept = 0;
  for (const v of CASES) {
    const s = positivePriceOrNull(v);
    assert.deepEqual(s, client(v),
      `client positivePriceOrNull has drifted from the guard for ${JSON.stringify(String(v))}: ` +
      `server=${JSON.stringify(s)} client=${JSON.stringify(client(v))}`);
    assert.ok(s === null || (typeof s === 'number' && Number.isFinite(s) && s > 0),
      `positivePriceOrNull(${JSON.stringify(String(v))}) = ${JSON.stringify(s)} — must be null or finite > 0`);
    if (s !== null) kept++;
    compared++;
  }
  assert.ok(compared > 25, `corpus collapsed to ${compared} cases`);
  // Both must DISCRIMINATE — two functions returning null for everything would
  // agree perfectly and prove nothing (the PB-08 lesson).
  assert.ok(kept > 3, 'no input was accepted — the corpus proves nothing');
  assert.equal(positivePriceOrNull(0), null, 'zero must never be a reference price');
  assert.equal(positivePriceOrNull(700), 700, 'a real retail price must survive unchanged');
});

test('PB-13 no new_retail path can reintroduce `|| 0` / `?? 0` / a literal zero', async () => {
  // A source assertion for the same reason as PB-09: the defect was in the
  // CONSTRUCTORS, two of them, and both fed a persistence site whose `?? null`
  // was then dead code. The behavioural tests (PR-07..PR-10) cover the rows;
  // this covers the two upstream expressions that produce the value, which no
  // row test can reach without running the whole handler.
  // Env-driven so the mutation harness can swap either file for a broken copy.
  const read = (env, rel) => (process.env[env]
    ? readFileSync(process.env[env], 'utf8')
    : readFileSync(new URL(rel, import.meta.url), 'utf8'));
  const files = {
    'api/analyze.js': read('UI003_ANALYZE_PATH', '../api/analyze.js'),
    'src/contexts/AppContext.jsx': read('UI003_CONTEXT_PATH', '../src/contexts/AppContext.jsx'),
  };

  const offenders = [];
  for (const [name, src] of Object.entries(files)) {
    src.split('\n').forEach((raw, i) => {
      const line = raw.replace(/\/\/.*$/, '');
      if (!/new_retail|newRetailPrice|_db_retail/i.test(line)) return;
      //  `|| 0`, `?? 0`, or an outright `new_retail: 0` — every way the old
      //  semantics could come back while still looking like a defaulting idiom.
      if (/\|\|\s*0\b/.test(line) || /\?\?\s*0\b/.test(line) || /new_retail\s*:\s*0\b/.test(line)) {
        offenders.push(`${name}:${i + 1} — ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'A new_retail path defaults to 0 again. Zero is not a retail price: nothing is sold new ' +
    'for ₪0, so a 0 can only mean "unknown" — stored as a number that every future ' +
    'AVG/SUM treats as a fact. Use positivePriceOrNull().\nOffenders:\n  ' + offenders.join('\n  '));

  // …and the rule must actually be WIRED, not merely un-violated: a file with no
  // new_retail handling at all would pass the ban above vacuously.
  assert.match(files['api/analyze.js'],
    /newRetailPrice:\s*positivePriceOrNull\(/, 'analyze.js no longer normalizes newRetailPrice');
  assert.match(files['api/analyze.js'],
    /new_retail:\s*positivePriceOrNull\(/, 'the server row no longer normalizes new_retail');
  assert.match(files['api/analyze.js'],
    /new_retail_price_ils:\s*positivePriceOrNull\(/, 'the Stage 2 fallback no longer normalizes new_retail_price_ils');
  assert.match(files['api/analyze.js'],
    /_db_retail:\s*positivePriceOrNull\(/, 'the catalog-row reader no longer normalizes _db_retail');
  assert.match(files['src/contexts/AppContext.jsx'],
    /new_retail:\s*positivePriceOrNull\(/, 'the client backup row no longer normalizes new_retail');
});
