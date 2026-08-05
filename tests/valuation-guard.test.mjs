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
