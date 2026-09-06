/**
 * UI-003 Wave 0 — PERSISTED VALUATION ROWS.
 *
 * The two writers that decide what a scan leaves behind in `valuations`:
 *
 *   · api/analyze.js        `valuationRow`  — the server, via record_scan (authoritative)
 *   · src/contexts/AppContext.jsx `row`     — the client backup writer (recovery path)
 *
 * They upsert the SAME row id, so they must agree; a divergence is a corruption
 * path where which copy won decides what the column says. Until this file there
 * was no test over either — the Valuation Engineer flagged it as the largest
 * hole in the wave, predicting that reverting the fix would survive. It did.
 *
 * WHY THE SOURCE IS EXECUTED RATHER THAN REGEXED.
 * Both are object literals buried inside a 4,400-line serverless handler and a
 * React `useCallback`; neither is reachable without running the whole handler or
 * mounting the whole provider. The alternatives were all worse:
 *   · assert over source text with a regex — proves the characters are present,
 *     not that the behaviour holds, and passes against gutted code (this is
 *     precisely the weakness of PB-09);
 *   · re-implement the row in the test — a test that re-implements its subject
 *     passes no matter what ships;
 *   · reshape production code purely to create a seam.
 * So tests/helpers/extract-literal.mjs lifts the exact characters that ship and
 * evaluates them with their dependencies bound. Nothing is copied, so nothing
 * can drift, and a refactor that moves a block fails LOUDLY rather than quietly
 * asserting over nothing.
 *
 * The invariant under test, in one line: an unpriced valuation is persisted as
 * NULL prices plus an explicit `manual_required` marker — never as ₪0, and never
 * labelled with a pricing method describing a number that does not exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { objectLiteralAt, compileRegion } from './helpers/extract-literal.mjs';
import { isPricedMarketValue, positivePriceOrNull } from '../api/_lib/valuation-guard.js';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const ANALYZE_SRC = process.env.UI003_ANALYZE_PATH || `${ROOT}api/analyze.js`;
const UTILS_SRC   = process.env.UI003_UTILS_PATH   || `${ROOT}src/lib/utils.js`;

// The client mirror is loaded through its env path for the same reason every
// other target is: a hard-coded import would test the pristine original while
// the harness reported on a mutant, and a harness that always says KILLED
// proves nothing.
const { hasRealPrice, positivePriceOrNull: clientPositivePriceOrNull } = await import(pathToFileURL(UTILS_SRC).href);
const CONTEXT_SRC = process.env.UI003_CONTEXT_PATH || `${ROOT}src/contexts/AppContext.jsx`;

/** The shipped server row literal, callable with its free identifiers bound. */
function serverRow(marketValue) {
  const src = readFileSync(ANALYZE_SRC, 'utf8');
  const body = objectLiteralAt(src, 'const valuationRow = {', 'api/analyze.js');
  const fn = compileRegion(
    ['result', 'isPricedMarketValue', 'positivePriceOrNull', 'candidates', 'lang',
     'scanUuid', 'authUser', 'valuationId', 'VALUATION_VERSION'],
    `return (${body});`,
    'analyze.js valuationRow',
  );
  return fn(
    { marketValue, category: 'Watches', confidence: 0.9, recognition: {} },
    isPricedMarketValue, positivePriceOrNull, [], 'en', 's-uuid', { id: 'u-1' }, 'v-1', 1,
  );
}

/** The shipped client backup row literal, same treatment. */
function clientRow(marketValue) {
  const src = readFileSync(CONTEXT_SRC, 'utf8');
  const body = objectLiteralAt(src, 'const row = {', 'src/contexts/AppContext.jsx');
  const fn = compileRegion(
    ['aiResult', 'priced', 'positivePriceOrNull', 'user', 'lang'],
    `return (${body});`,
    'AppContext row',
  );
  const aiResult = { marketValue, valuation_id: 'v-1', name: 'X', category: 'Watches', recognition: {} };
  // The CLIENT mirror is bound here on purpose: if it drifts from the server
  // rule, PR-08 sees the divergence in the rows rather than PB-12 alone.
  return fn(aiResult, hasRealPrice(marketValue), clientPositivePriceOrNull, { id: 'u-1' }, 'en');
}

// The shapes that matter. `degraded-but-labelled-priced` is the SHIPPED DEFECT:
// the guard rejected the quote and emitted 0/0/0, but the old mapping relabelled
// it `ai_estimate`, and that is what reached the row.
const UNPRICED = [
  ['guard degrade, mislabelled ai_estimate', { pricing_status: 'ai_estimate', low: 0, mid: 0, high: 0 }],
  ['explicit manual_required',               { pricing_status: 'manual_required', low: 0, mid: 0, high: 0 }],
  ['manual_required over a real triple',     { pricing_status: 'manual_required', low: 800, mid: 1200, high: 1800 }],
  ['negative mid',                           { pricing_status: 'db_based', low: -1, mid: -5, high: 10 }],
  ['non-finite mid',                         { pricing_status: 'db_based', low: 1, mid: NaN, high: 10 }],
];
const PRICED = { pricing_status: 'db_based', low: 800, mid: 1200, high: 1800, price_method: 'comp_based' };

for (const [name, mv] of UNPRICED) {
  test(`PR-01 server row: an unpriced valuation (${name}) persists NULL, never 0`, () => {
    const row = serverRow(mv);
    for (const col of ['price_low', 'price_mid', 'price_high']) {
      assert.equal(row[col], null,
        `${col} = ${JSON.stringify(row[col])}. Zero is not a price: it is indistinguishable from ` +
        `an item genuinely worth nothing, and SQL aggregates average it in rather than skipping it.`);
    }
  });
}

test('PR-02 server row: a priced valuation still persists its real triple', () => {
  const row = serverRow(PRICED);
  assert.equal(row.price_low, 800);
  assert.equal(row.price_mid, 1200);
  assert.equal(row.price_high, 1800);
});

for (const [name, mv] of UNPRICED) {
  test(`PR-03 client backup row: an unpriced valuation (${name}) persists NULL + an explicit marker`, () => {
    const row = clientRow(mv);
    for (const col of ['price_low', 'price_mid', 'price_high']) {
      assert.equal(row[col], null, `${col} = ${JSON.stringify(row[col])}`);
    }
    assert.equal(row.price_method, 'manual_required',
      'manual pricing must be a POSITIVE marker in the row, not the absence of one — ' +
      'otherwise it can only be inferred from a null, and `ai_estimate` over a null reads as a bug.');
  });
}

test('PR-04 client backup row: a priced valuation keeps its triple and its method', () => {
  const row = clientRow(PRICED);
  assert.equal(row.price_mid, 1200);
  assert.equal(row.price_method, 'comp_based');
});

test('PR-05 the two writers AGREE — they upsert the same row id, so a divergence corrupts by race', () => {
  // Whichever write lands first decides what the column says. If they disagree
  // about whether a valuation is priced, the stored value depends on timing.
  for (const [name, mv] of [...UNPRICED, ['priced', PRICED]]) {
    const s = serverRow(mv), c = clientRow(mv);
    for (const col of ['price_low', 'price_mid', 'price_high']) {
      assert.equal(
        s[col] === null, c[col] === null,
        `server and client disagree on nullity of ${col} for "${name}": ` +
        `server=${JSON.stringify(s[col])} client=${JSON.stringify(c[col])}`,
      );
    }
  }
});

test('PR-06 neither writer can emit a zero price for ANY marketValue shape', () => {
  // Exhaustive over the field boundaries rather than the curated list above —
  // the PB-08 lesson: a hand-picked corpus only catches what its author thought
  // of. A stored 0 is the defect regardless of which flag combination produced it.
  const VALUES = [undefined, null, NaN, -1, 0, 1, 1200, '1200', '0'];
  const STATUSES = [undefined, 'manual_required', 'ai_estimate', 'db_based'];
  let checked = 0;
  for (const pricing_status of STATUSES) {
    for (const low of VALUES) for (const mid of VALUES) for (const high of VALUES) {
      const mv = { pricing_status, low, mid, high };
      for (const [who, row] of [['server', serverRow(mv)], ['client', clientRow(mv)]]) {
        for (const col of ['price_low', 'price_mid', 'price_high']) {
          const v = row[col];
          assert.ok(v === null || (Number.isFinite(Number(v)) && Number(v) > 0),
            `${who}.${col} = ${JSON.stringify(v)} for ${JSON.stringify(mv)} — ` +
            `a persisted price is either NULL or strictly positive.`);
        }
      }
      checked++;
    }
  }
  assert.ok(checked > 2500, `corpus collapsed to ${checked} cases`);
});

// ══════════════════════════════════════════════════════════════════════════════
// UI-003 Wave 0 — Gap B: `new_retail`
//
// The one price column outside the valuation band, and therefore the one the
// band's guard never covered. It was built as `new_retail_price_ils || 0`, which
// ALWAYS yields a number — so the `?? null` at both persistence sites was
// unreachable and every scan with no retail signal stored 0.
//
// Nothing is sold new for ₪0, so the value could only ever have meant "unknown",
// encoded as a number that averages, sums and sorts like a fact.
//
// Deliberately INDEPENDENT of the band: a degraded valuation can still have a
// perfectly good known retail price, and discarding it would lose a real fact
// about the product. PR-09 pins that both directions.
// ══════════════════════════════════════════════════════════════════════════════

const RETAIL_UNKNOWN = [
  ['absent',        undefined],
  ['null',          null],
  ['zero',          0],
  ['negative',      -1],
  ['NaN',           NaN],
  ['empty string',  ''],
  ['string zero',   '0'],
  ['non-numeric',   'n/a'],
  ['Infinity',      Infinity],
];

for (const [name, retail] of RETAIL_UNKNOWN) {
  test(`PR-07 both writers persist NULL new_retail when the reference is ${name}`, () => {
    const mv = { ...PRICED, newRetailPrice: retail };
    for (const [who, row] of [['server', serverRow(mv)], ['client', clientRow(mv)]]) {
      assert.equal(row.new_retail, null,
        `${who}.new_retail = ${JSON.stringify(row.new_retail)} for retail=${JSON.stringify(retail)}. ` +
        'Zero is not a retail price — nothing is sold new for ₪0, so a 0 here can only mean ' +
        '"unknown", stored as a number that every future AVG/SUM will treat as a fact.');
    }
  });
}

test('PR-08 a valid positive new_retail is persisted unchanged by both writers', () => {
  for (const [input, expected] of [[700, 700], [1, 1], ['1450', 1450], [0.5, 0.5]]) {
    const mv = { ...PRICED, newRetailPrice: input };
    assert.equal(serverRow(mv).new_retail, expected, `server dropped a valid retail ${input}`);
    assert.equal(clientRow(mv).new_retail, expected, `client dropped a valid retail ${input}`);
  }
});

test('PR-09 new_retail is INDEPENDENT of the band — a degraded valuation keeps a known retail', () => {
  // The two facts are unrelated: "we could not price the used item" says nothing
  // about "we know what it costs new". Suppressing the retail reference on a
  // degrade would discard real information; emitting 0 would fabricate it.
  for (const [name, mv] of UNPRICED) {
    const withRetail = { ...mv, newRetailPrice: 700 };
    for (const [who, row] of [['server', serverRow(withRetail)], ['client', clientRow(withRetail)]]) {
      assert.equal(row.price_mid, null, `${who} should still be unpriced for "${name}"`);
      assert.equal(row.new_retail, 700,
        `${who} discarded a KNOWN retail price on a degraded valuation ("${name}") — ` +
        'the band guard must not decide the reference figure.');
    }
    const withoutRetail = { ...mv, newRetailPrice: 0 };
    for (const [who, row] of [['server', serverRow(withoutRetail)], ['client', clientRow(withoutRetail)]]) {
      assert.equal(row.new_retail, null,
        `${who} persisted new_retail = 0 on a degraded valuation ("${name}")`);
    }
  }
});

test('PR-10 server and client agree on new_retail for EVERY input shape', () => {
  // Same-row-id race argument as PR-05: if the two writers disagree about
  // whether 0 means "free" or "unknown", the stored value depends on timing.
  const RETAILS = [undefined, null, NaN, Infinity, -1, 0, 0.5, 1, 700, '700', '0', '', 'x', {}, []];
  let compared = 0;
  for (const [, mv] of [...UNPRICED, ['priced', PRICED]]) {
    for (const newRetailPrice of RETAILS) {
      const shape = { ...mv, newRetailPrice };
      const s = serverRow(shape).new_retail, c = clientRow(shape).new_retail;
      assert.deepEqual(s, c,
        `server=${JSON.stringify(s)} client=${JSON.stringify(c)} for retail=${JSON.stringify(newRetailPrice)}`);
      assert.ok(s === null || (typeof s === 'number' && Number.isFinite(s) && s > 0),
        `new_retail = ${JSON.stringify(s)} — must be NULL or a finite positive number.`);
      compared++;
    }
  }
  assert.ok(compared > 80, `corpus collapsed to ${compared} cases`);
});
