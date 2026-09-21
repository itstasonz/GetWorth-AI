// ══════════════════════════════════════════════════════════════════════════════
// ROUND 6 — THE AUTHORITY CONTRACTS
//
// Three properties, each stated before its mechanism, each attacked with cases
// that were NOT used to build the mechanism.
//
//   REC7-C1  OCR BODY TEXT ALONE MUST NOT UPGRADE A REFERENCED PRODUCT INTO
//            SUBJECT IDENTITY WHEN THE OCR BLOCK CONTAINS ACCESSORY/REFERENCE
//            SEMANTICS.
//
//   §4       AUTHORITY(truncated_input) <= AUTHORITY(full_input).
//            A safety truncation may preserve or REDUCE identity authority. It
//            may never increase it.
//
//   V5-2     MODEL_OUTPUT ∩ SERVER_AUTHORITY = ∅, unless an explicit trusted
//            server transformation promotes evidence after validation.
//
// WHY THE ROUND NEEDED THEM. Round 5 closed the accessory class by classifying
// each OCR line on its own. One newline defeated it:
//
//   Replacement strap for ROLEX SUBMARINER      -> DERIVED           refused
//   Replacement strap for \n ROLEX SUBMARINER   -> BRAND+PRODUCT_TEXT  ACCEPTED
//
// and so did printing the host name ABOVE its own marker. Round 5 also answered
// forged pricing provenance with a list of eighteen key names, which is a list
// of the forgeries somebody thought of.
//
// THE NEGATIVE-SPACE RULE FOR THIS FILE. Section 6 below was written AFTER the
// implementation, from layouts and wordings that appear nowhere in the
// implementation or in its fixtures. If a mechanism only catches the cases it
// was built against, the class is open.
//
//   node --test tests/round6-authority.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { visionData, visionResponse } from './helpers/vision-fixture.mjs';
const AN = await import('../api/analyze.js');
const { parseVisionResponse, OCR_FULL_TEXT_CAP, sealModelVerification,
        MODEL_VERIFICATION_ALLOWLIST, VERIFICATION_SCHEMA } = AN;

// ── POINTED AT THE MUTATED COPIES WHEN THE HARNESS IS DRIVING ───────────────
//
// tests/mutations/run.mjs lists this file among the suites that judge guard and
// authority mutants. A suite that imports the real modules directly cannot see
// the mutant, so every mutant whose only observer is here would SURVIVE for a
// reason that has nothing to do with the property — the same defect the round-6
// provider work found in tests/provider-discovery.test.mjs.
const AUTH_URL = process.env.VAL001_AUTHORITY_PATH
  ? new URL(`file://${process.env.VAL001_AUTHORITY_PATH}`)
  : new URL('../api/_lib/pricing-authority.js', import.meta.url);
const {
  deriveEvidence, evidenceList, classifyOcrBlock, subjectTextPermitted, blockRelation,
  RELATION, OCR_PROVENANCE_VERSION,
  sealServerAuthority, readServerAuthority, isServerAuthority,
} = await import(AUTH_URL.href);

const GUARD_URL = process.env.VAL001_GUARD_PATH
  ? new URL(`file://${process.env.VAL001_GUARD_PATH}`)
  : new URL('../api/_lib/valuation-guard.js', import.meta.url);
const { resolveEnvelope } = await import(GUARD_URL.href);

// The parser builds the fixture — labels, logos, the per-word array and the
// capped block — exactly as production does. The one field REPLACED is the
// provenance record, recomputed with the module under test: `parseVisionResponse`
// lives in api/analyze.js and imports the REAL pricing-authority, so under the
// mutation harness the parser would hand every test an UNMUTATED verdict and
// every block-rule mutant would survive untouched. R6-0 asserts the two agree
// when they are the same module, so this cannot drift into a second
// implementation.
const vd = (block, opts) => {
  const parsed = visionData(parseVisionResponse, block, opts);
  return { ...parsed, ocr_context: { ...parsed.ocr_context, provenance: classifyOcrBlock(block) } };
};
const rec = (brand, model) => ({
  category: 'Watches', subcategory: 'watch', category_confidence: 0.9,
  brand_candidates: brand ? [{ brand, confidence: 0.9 }] : [],
  model_candidates: model ? [{ model, confidence: 0.9 }] : [],
  ocr_text: { raw_texts: [] },
});
const ev = (brand, model, block, opts) =>
  evidenceList(deriveEvidence({ recognition: rec(brand, model), visionData: vd(block, opts) }).classes);
const textClasses = (list) => list.filter((c) => c === 'BRAND_TEXT' || c === 'PRODUCT_TEXT');

// ════════════════════════════════════════════════════════════════════════════
// R6-1 · THE BLOCK IS THE SEMANTIC SCOPE
// ════════════════════════════════════════════════════════════════════════════
test('R6-0 the fixture’s provenance is the parser’s provenance', () => {
  // The honesty check for `vd` above. When no mutant is in play the recomputed
  // record must be byte-identical to the one `parseVisionResponse` wrote, or
  // this file is testing a second implementation of the rule instead of the one
  // production runs.
  if (process.env.VAL001_AUTHORITY_PATH) return;        // a mutant IS in play, by design
  for (const b of ['ROLEX\nSUBMARINER', 'Replacement strap for\nROLEX SUBMARINER',
    'רצועה\nעבור\nRolex Submariner', '', 'NINJA\nPOWER BLENDER DUO PRO']) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(classifyOcrBlock(b) ?? null)),
      JSON.parse(JSON.stringify(parseVisionResponse(visionResponse(b)).ocr_context.provenance ?? null)),
      `the fixture and the parser disagree about ${JSON.stringify(b)}`);
  }
});

describe('R6-1 a reference-bearing block establishes no subject identity', () => {
  test('R6-1a THE WITNESS: one newline used to buy watches:luxury', () => {
    // The exact pair from the finding, asserted together so a future change
    // that fixes one and not the other cannot pass.
    assert.deepEqual(textClasses(ev('Rolex', 'Submariner', 'Replacement strap for ROLEX SUBMARINER')), [],
      'the single-line form was already refused');
    assert.deepEqual(textClasses(ev('Rolex', 'Submariner', 'Replacement strap for\nROLEX SUBMARINER')), [],
      'THE WITNESS: identical words, one newline apart, and the second form was ACCEPTED');
  });

  test('R6-1b the marker may sit on either side of the host name', () => {
    // Reverse layout is not an edge case; it is how most packaging is printed.
    // A per-line rule can never see it: the host name is a clean product label
    // on its own line by construction.
    const LAYOUTS = [
      ['Replacement Strap\nFor\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      ['ROLEX SUBMARINER\nReplacement Strap', 'Rolex', 'Submariner'],
      ['Compatible With\niPhone 16 Pro\nProtective Case', 'Apple', 'iPhone 16 Pro'],
      ['iPhone 16 Pro\nCompatible Case', 'Apple', 'iPhone 16 Pro'],
      ['Replacement Filter\nDYSON V15', 'Dyson', 'V15'],
      ['DYSON V15\nReplacement Filter', 'Dyson', 'V15'],
      ['Replacement Blade\nNINJA\nPOWER BLENDER', 'Ninja', 'Power Blender'],
      ['NINJA\nPOWER BLENDER\nReplacement Blade', 'Ninja', 'Power Blender'],
    ];
    for (const [block, brand, model] of LAYOUTS) {
      assert.deepEqual(textClasses(ev(brand, model, block)), [],
        `${JSON.stringify(block)} established host identity`);
    }
  });

  test('R6-1c Hebrew, Arabic and mixed-language layouts, in both orders', () => {
    // This is an Israeli-market product: accessory packaging is written in
    // Hebrew, and Hebrew attaches the "for" preposition as a PREFIX, so the
    // marker is not a separate token at all.
    const LAYOUTS = [
      ['רצועה עבור Rolex Submariner', 'Rolex', 'Submariner'],
      ['רצועה\nעבור\nRolex Submariner', 'Rolex', 'Submariner'],
      ['Rolex Submariner\nרצועה', 'Rolex', 'Submariner'],
      ['כיסוי תואם\niPhone 16 Pro', 'Apple', 'iPhone 16 Pro'],
      ['iPhone 16 Pro\nכיסוי תואם', 'Apple', 'iPhone 16 Pro'],
      ['מטען ל-MacBook Pro', 'Apple', 'MacBook Pro'],
      ['MacBook Pro\nמטען', 'Apple', 'MacBook Pro'],
      ['פילטר תואם\nDyson V15', 'Dyson', 'V15'],
      ['Dyson V15\nפילטר תואם', 'Dyson', 'V15'],
      ['חלק חילוף\nNINJA\nPOWER BLENDER', 'Ninja', 'Power Blender'],
      ['مناسب لـ\nRolex Submariner', 'Rolex', 'Submariner'],
    ];
    for (const [block, brand, model] of LAYOUTS) {
      assert.deepEqual(textClasses(ev(brand, model, block)), [],
        `${JSON.stringify(block)} established host identity`);
    }
  });

  test('R6-1d packaging that names what is NOT in the box is a reference', () => {
    for (const block of [
      'iPhone 16 Pro\nDevice not included',
      'iPhone 16 Pro\nPhone sold separately',
      'Rolex Submariner\nWatch not included',
      'iPhone 16 Pro\nהמכשיר אינו כלול',
    ]) {
      assert.deepEqual(textClasses(ev('Apple', 'iPhone 16 Pro', block)).concat(
        textClasses(ev('Rolex', 'Submariner', block))), [],
        `${JSON.stringify(block)} established host identity`);
    }
  });

  test('R6-1e the per-line relations are RETAINED, not merely used and discarded', () => {
    // The contract says a referenced product may be kept as structured
    // compatibility metadata; it may only not become the subject. So the record
    // has to say WHICH relation each line carries, or a Phase-B consumer has
    // nothing to build `compatible_with` from.
    const prov = classifyOcrBlock('Premium Leather Replacement Strap\nModel RS-42\nFor Rolex Submariner');
    assert.equal(prov.version, OCR_PROVENANCE_VERSION);
    assert.equal(prov.block_relation, RELATION.REFERENCE);
    assert.equal(prov.subject_text_permitted, false);
    const rels = prov.lines.map((l) => l.relation);
    assert.ok(rels.includes(RELATION.COMPATIBILITY_TARGET), `expected a compatibility line, got ${rels.join(',')}`);
    assert.ok(prov.lines.some((l) => l.words.includes('rs')), 'the accessory’s own model line is kept');
    // The other vocabulary: a line whose own subject is an accessory noun, with
    // no preposition anywhere, is still a relationship.
    const noMarker = classifyOcrBlock('Leather Strap\n20mm\nRolex Submariner');
    assert.equal(noMarker.lines[0].relation, RELATION.ACCESSORY_TARGET);
    assert.equal(noMarker.block_relation, RELATION.REFERENCE);
  });

  test('R6-1f a record whose flag contradicts its own lines is REFUSED', () => {
    // The record round-trips through `vision_cache` as plain JSON, so by the
    // time a consumer sees it, it is a row from a database rather than a verdict
    // from this process. A `subject_text_permitted: true` sitting beside a
    // COMPATIBILITY_TARGET line is a contradiction, and the fail-closed reading
    // of a contradiction is to refuse.
    const forged = {
      ocr_context: {
        version: 2,
        full_text: 'Replacement strap for\nROLEX SUBMARINER',
        full_text_truncated: false,
        provenance: {
          version: OCR_PROVENANCE_VERSION,
          truncated: false,
          line_count: 2,
          block_relation: RELATION.SUBJECT,        // a lie
          subject_text_permitted: true,            // a lie
          lines: [
            { words: ['replacement', 'strap', 'for'], relation: RELATION.COMPATIBILITY_TARGET },
            { words: ['rolex', 'submariner'], relation: RELATION.SUBJECT },
          ],
        },
      },
    };
    assert.equal(subjectTextPermitted(forged), false,
      'the flag must be re-derived from the lines, not believed');
    assert.deepEqual(
      evidenceList(deriveEvidence({ recognition: rec('Rolex', 'Submariner'), visionData: forged }).classes),
      ['DERIVED']);
  });

  test('R6-1g an INDEPENDENT VISUAL SIGNAL may still corroborate — and only the brand', () => {
    // The contract admits one carve-out: a classifier's verdict that a mark is
    // ON the object. A logo is that; body text is not, and the model cannot
    // declare its own text to be one because no model output reaches here.
    const got = ev('Rolex', 'Submariner', 'Replacement strap for\nROLEX SUBMARINER', { logos: ['Rolex'] });
    assert.ok(got.includes('BRAND_TEXT'), 'a logo is a mark read off the object');
    assert.ok(!got.includes('PRODUCT_TEXT'),
      'a logo names a brand, never a model — so watches:luxury, which wants BOTH, stays shut');
  });

  test('R6-1h the money consequence, end of chain', () => {
    const strap = rec('Rolex', 'Submariner');
    const WEAK = { brandOk: true, modelOk: true, brandC: 0.9, modelC: 0.9, brandConfLabel: 'inferred_from_visuals' };
    const key = (block, opts) => resolveEnvelope({
      recognition: strap, identity: WEAK,
      evidence: deriveEvidence({ recognition: strap, visionData: vd(block, opts) }).classes,
    }).key;
    assert.equal(key('Replacement strap for\nROLEX SUBMARINER'), 'watches',
      'a strap is bounded by the ordinary watches bucket');
    assert.equal(key('ROLEX SUBMARINER\nReplacement Strap'), 'watches');
    // The genuine arm carries the classifier label a real watch photograph
    // carries: ROUND 6 added OBJECT_CLASS to watches:luxury, because without it
    // the marker vocabulary was the only thing between an unlisted language and
    // a ₪250,000 ceiling.
    assert.equal(key('ROLEX\nSUBMARINER', { labels: ['Watch', 'Analog watch'] }), 'watches:luxury',
      'and a genuine dial still reaches the luxury one — the fix is not "refuse all text"');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R6-2 · TRUNCATION MONOTONICITY
// ════════════════════════════════════════════════════════════════════════════
describe('R6-2 a truncation may reduce authority, never increase it', () => {
  test('R6-2a THE WITNESS: the safety cap used to remove the marker', () => {
    // `full_text` is capped because it rides in the response envelope. The cap
    // removes the TAIL — and on packaging the relation marker is very often in
    // the tail. Classified after the cap, this block is a clean product label.
    const filler = Array.from({ length: 70 }, (_, i) => `SPEC${i}`).join(' ');
    const block = `ROLEX SUBMARINER\n${filler}\nReplacement Strap For`;
    const parsed = parseVisionResponse(visionResponse(block));
    assert.ok(block.length > OCR_FULL_TEXT_CAP, 'fixture: the block must exceed the cap');
    assert.equal(parsed.ocr_context.full_text_truncated, true);
    assert.ok(!parsed.ocr_context.full_text.includes('Replacement'),
      'fixture: the marker must genuinely be cut from the displayed field');
    assert.equal(parsed.ocr_context.provenance.block_relation, RELATION.REFERENCE,
      'provenance must be computed on the UNTRUNCATED annotation');
    assert.deepEqual(
      evidenceList(deriveEvidence({ recognition: rec('Rolex', 'Submariner'), visionData: parsed }).classes),
      ['DERIVED']);
  });

  test('R6-2b a block with NO provenance record is UNKNOWN, and UNKNOWN permits nothing', () => {
    // A stale `vision_cache` row written before the record existed carries a
    // `full_text` we cannot prove is complete. There is no way to recover the
    // missing information by looking harder at the string, so it establishes
    // nothing. Authority falls because provenance is uncertain — the only
    // direction §4 allows.
    const stale = { ocr_context: { version: 1, full_text: 'ROLEX\nSUBMARINER' } };
    assert.equal(blockRelation(stale), RELATION.UNKNOWN);
    assert.deepEqual(
      evidenceList(deriveEvidence({ recognition: rec('Rolex', 'Submariner'), visionData: stale }).classes),
      ['DERIVED']);
    // …and a logo still works, because a logo is not body text.
    assert.ok(evidenceList(deriveEvidence({
      recognition: rec('Rolex', 'Submariner'),
      visionData: { ...stale, logos: [{ description: 'Rolex', score: 0.95 }] },
    }).classes).includes('BRAND_TEXT'));
  });

  test('R6-2c THE PROPERTY, over generated blocks and every cap', () => {
    // Not "these three fixtures". For 4,000 generated blocks and seven caps
    // each, the evidence derived from the CAPPED parse must be a subset of the
    // evidence derived from the uncapped one. A single counterexample is a
    // truncation that bought authority.
    const WORDS = ['ROLEX', 'SUBMARINER', 'NINJA', 'BLENDER', 'for', 'replacement',
      'strap', 'תואם', 'עבור', 'case', 'PRO', 'G502', 'LOGITECH', 'not', 'included'];
    let seed = 987654321;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];
    const R = rec('Rolex', 'Submariner');
    let checked = 0;
    for (let t = 0; t < 4000; t++) {
      const lines = [];
      for (let i = 0, n = 1 + Math.floor(rnd() * 6); i < n; i++) {
        lines.push(Array.from({ length: 1 + Math.floor(rnd() * 4) }, pick).join(' '));
      }
      const resp = visionResponse(lines.join('\n'));
      const full = new Set(evidenceList(deriveEvidence({
        recognition: R, visionData: parseVisionResponse(resp, { textCap: Infinity }) }).classes));
      for (const cap of [1, 5, 10, 20, 40, 80, OCR_FULL_TEXT_CAP]) {
        const got = evidenceList(deriveEvidence({
          recognition: R, visionData: parseVisionResponse(resp, { textCap: cap }) }).classes);
        checked++;
        for (const c of got) {
          assert.ok(full.has(c),
            `AUTHORITY ROSE UNDER TRUNCATION at cap ${cap}: ${JSON.stringify(lines.join('\\n'))} ` +
            `gained ${c} (full: ${[...full].join('+')})`);
        }
      }
    }
    assert.ok(checked >= 28000, `expected a real sweep, ran ${checked} comparisons`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R6-3 · MODEL OUTPUT AND SERVER AUTHORITY ARE DISJOINT
// ════════════════════════════════════════════════════════════════════════════
describe('R6-3 the model may claim; only the server may vouch', () => {
  test('R6-3a a byte-perfect forgery of the server record is not authority', () => {
    const real = sealServerAuthority({ pricing_status: 'db_based', pre_source: 'catalog' });
    assert.deepEqual(readServerAuthority(real), { pricing_status: 'db_based', pre_source: 'catalog' });
    // Same keys, same values, same shape. Different object.
    assert.equal(readServerAuthority({ pricing_status: 'db_based', pre_source: 'catalog' }), null);
    assert.equal(readServerAuthority({ ...real }), null, 'a spread copy is a new object');
    assert.equal(readServerAuthority(JSON.parse(JSON.stringify(real))), null,
      'a value that has been through the wire is no longer the object this server minted');
    assert.equal(isServerAuthority(Object.freeze({ pricing_status: 'db_based' })), false);
  });

  test('R6-3b the seal is the RECORD of minting, not a property of the value', () => {
    // A symbol or a marker key would survive cloning and could be re-attached
    // by anyone holding it. Membership of a closed WeakSet cannot be forged,
    // copied, or serialised into existence — and nothing exported adds to it.
    const sealed = sealServerAuthority({ pricing_status: 'ai_estimate' });
    assert.ok(isServerAuthority(sealed));
    assert.ok(Object.isFrozen(sealed), 'a value that has been vouched for must not change afterwards');
    for (const k of Object.keys(sealed)) assert.equal(typeof k, 'string');
    assert.deepEqual(Object.getOwnPropertySymbols(sealed), [],
      'no marker symbol — a marker is a thing an attacker can copy');
    assert.equal(sealServerAuthority(null), null);
    assert.equal(sealServerAuthority([1, 2]), null, 'an array is not a pricing record');
    assert.equal(sealServerAuthority('x'), null);
  });

  test('R6-3c GENERATED model keys — none becomes authority, whatever it is called', () => {
    // NOT a list of known forgeries. Names are generated across the shapes an
    // attacker or a future model actually produces: unseen words, case
    // variants, Unicode confusables, prototype-shaped names, pricing-looking
    // names, future-looking names, nested objects and arrays.
    const CONFUSABLE_A = String.fromCharCode(1072);   // Cyrillic small a
    const CONFUSABLE_E = String.fromCharCode(1077);   // Cyrillic small e
    const INVENTED = [
      'pricing_provenance', 'price_authority', 'trusted_pricing_source', 'pricing_grade',
      'anchor_authority', 'market_evidence', 'envelope_authority', 'guard_verdict',
      'validation_status', 'final_pricing_status', 'refund_authority', 'server_provenance',
      '_pricing_meta', '_pricing_meta_v2', '_pricing_meta_2027', '_serverPricing',
      'PRICING_STATUS', 'Pricing_Status', 'pricingStatus', 'pricing status',
      `pricing_st${CONFUSABLE_A}tus`, `pric${CONFUSABLE_E}_method`,
      '__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty',
      'evidence', 'envelope_key', 'identity_tier', 'recognition_verdict', 'valuation_verdict',
      'futureAuthorityField', 'x'.repeat(200), '', ' ', '0', '-1',
    ];
    const VALUES = [
      'db_based', 'HIGH', true, 42,
      { pricing_status: 'db_based', nested: { deeper: { grade: 'HIGH' } } },
      [{ pricing_status: 'db_based' }, 'catalog'],
      null,
    ];

    const schemaKeys = new Set(Object.keys(VERIFICATION_SCHEMA.properties));
    for (const key of INVENTED) {
      for (const value of VALUES) {
        // Built through JSON.parse, because that is how a model's output really
        // arrives — and because a `__proto__` key behaves differently there than
        // in an object literal.
        let body;
        try {
          body = JSON.parse(JSON.stringify({ final_brand: 'Rolex', [key]: value }));
        } catch { continue; }
        const out = sealModelVerification(body);
        if (schemaKeys.has(key)) continue;                 // a declared field is not a forgery
        // `key in out` is the WRONG test and it cost me a false failure:
        // `'__proto__' in anything` is true for every ordinary object. The
        // question is whether the boundary gave the key an OWN property.
        assert.ok(!Object.prototype.hasOwnProperty.call(out, key),
          `an undeclared key "${key}" survived the boundary into the pipeline`);
        assert.equal(readServerAuthority(out._pricing_meta), null,
          `"${key}" produced a readable server authority record`);
        assert.equal(({}).polluted, undefined, 'prototype pollution through the boundary');
        assert.equal(Object.prototype.pricing_status, undefined);
      }
    }
  });

  test('R6-3d the allowlist is DERIVED from the schema, and the positive control passes', () => {
    assert.deepEqual([...MODEL_VERIFICATION_ALLOWLIST].sort(),
      Object.keys(VERIFICATION_SCHEMA.properties).sort(),
      'a transcribed copy of the schema is the denylist this round removed, one level up');

    // THE POSITIVE CONTROL. A legitimate Stage-2 response must survive intact —
    // a boundary that drops real fields is a different defect with the same
    // green tests.
    const legit = {
      final_category: 'Electronics', final_brand: 'Logitech', final_model: 'G502',
      full_name: 'Logitech G502', match_confidence: 0.92,
      identification_method: 'ocr_confirmed', brand_confidence: 'confirmed_by_text',
      price_estimate_low: 180, price_estimate_mid: 240, price_estimate_high: 300,
      price_method: 'comp_based', currency: 'ILS', condition: 'Good',
      is_sellable: true, market_demand: 'moderate', selling_tips: 'clean it',
      israeli_market_notes: 'popular', price_factors: [{ factor: 'condition' }],
      matched_product_ids: ['a'], confidence_reasoning: 'read off the label',
      new_retail_price_ils: 400, authenticity_assessment: { status: 'not_required' },
    };
    const out = sealModelVerification(legit);
    assert.equal(out.model_claims, undefined, 'a clean response produces no claims bag');
    for (const [k, v] of Object.entries(legit)) assert.deepEqual(out[k], v, `${k} was dropped`);
  });

  test('R6-3e a server-minted record survives the boundary it is not subject to', () => {
    // `sealModelVerification` runs on MODEL output. The two server construction
    // paths build their verification AFTER it, so their sealed record must keep
    // its identity through the ordinary spreads the pipeline performs.
    const sealed = sealServerAuthority({ pricing_status: 'db_based', pre_source: 'catalog' });
    const verification = { final_brand: 'Rolex', _pricing_meta: sealed };
    const spread = { ...verification, final_category_basis: 'registered' };
    assert.ok(readServerAuthority(spread._pricing_meta), 'a spread of the CONTAINER keeps the value identity');
    assert.equal(readServerAuthority(spread._pricing_meta).pricing_status, 'db_based');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R6-4 · POSITIVE SUBJECT CONTROLS — the fix is not "refuse all text"
// ════════════════════════════════════════════════════════════════════════════
describe('R6-4 legitimate OCR recognition is preserved', () => {
  test('R6-4a the named product witnesses still contribute identity evidence', () => {
    const CASES = [
      ['Ninja', 'Power Blender Duo Pro', 'NINJA\nPOWER BLENDER DUO PRO\nBLENDSENSE'],
      ['Logitech', 'G Pro X Superlight', 'LOGITECH\nG PRO X SUPERLIGHT'],
      ['Sony', 'WH-1000XM5', 'SONY\nWH-1000XM5'],
      ['Louis Vuitton', 'Imagination', 'LOUIS VUITTON\nIMAGINATION'],
      ['Rolex', 'Submariner', 'ROLEX\nSUBMARINER'],
    ];
    for (const [brand, model, block] of CASES) {
      const got = ev(brand, model, block);
      assert.ok(got.includes('BRAND_TEXT'), `${brand}: brand evidence was destroyed`);
      assert.ok(got.includes('PRODUCT_TEXT'), `${brand}: product evidence was destroyed`);
      assert.equal(blockRelation(vd(block)), RELATION.SUBJECT);
    }
  });

  test('R6-4b a brand-only label still establishes only the brand', () => {
    const got = ev('LG', null, 'LG');
    assert.ok(got.includes('BRAND_TEXT'));
    assert.ok(!got.includes('PRODUCT_TEXT'), 'limited evidence stays limited');
  });

  test('R6-4c THE ACCESSORY POSITIVE CONTROL: the accessory may be identified, the host may not', () => {
    // "Premium Leather Replacement Strap / Model RS-42 / For Rolex Submariner"
    // The strap's OWN model is a legitimate identity. Rolex Submariner is not.
    const block = 'Premium Leather Replacement Strap\nModel RS-42\nFor Rolex Submariner';
    assert.deepEqual(textClasses(ev('Rolex', 'Submariner', block)), [],
      'the HOST must not be purchased from the accessory’s own packaging');

    const prov = classifyOcrBlock(block);
    const compat = prov.lines.filter((l) => l.relation === RELATION.COMPATIBILITY_TARGET);
    assert.ok(compat.some((l) => l.words.includes('rolex') && l.words.includes('submariner')),
      'the host stays available as structured compatibility metadata — retained, not promoted');
    assert.ok(prov.lines.some((l) => l.words.includes('rs') && l.words.includes('42')),
      'and the accessory’s own model designation is still in the record');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// R6-5 · NEGATIVE SPACE — written AFTER the implementation, to defeat it
// ════════════════════════════════════════════════════════════════════════════
describe('R6-5 layouts and wordings the implementation was never shown', () => {
  // Every string below is absent from api/_lib/pricing-authority.js and from
  // every fixture used while building the block rule. If the mechanism only
  // catches what it was built against, this section is where that shows.

  test('R6-5a packaging wordings nobody enumerated', () => {
    const ATTACKS = [
      // marker buried mid-block, host first AND last
      ['ROLEX SUBMARINER\nGENUINE LEATHER\n20mm\nSTRAP ONLY\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      // marker as the very last word of a long block
      ['ROLEX\nSUBMARINER\n316L STEEL\nDEPLOYMENT CLASP\nSPARE', 'Rolex', 'Submariner'],
      // host name repeated on many clean lines, ONE accessory noun
      ['DYSON\nV15\nDETECT\nHEPA\nFILTER', 'Dyson', 'V15'],
      // marker separated from the host by blank lines
      ['Replacement\n\n\n\nNINJA POWER BLENDER', 'Ninja', 'Power Blender'],
      // carriage returns rather than newlines
      ['ROLEX SUBMARINER\r\rStrap', 'Rolex', 'Submariner'],
      // mixed scripts on one line, marker in Arabic
      ['iPhone 16 Pro متوافق', 'Apple', 'iPhone 16 Pro'],
      // marker in a European language
      ['Ersatz\nDYSON V15', 'Dyson', 'V15'],
      ['Custodia per\niPhone 16 Pro', 'Apple', 'iPhone 16 Pro'],
      // fullwidth compatibility form — NFKC must fold it before anything reads it
      ['ｆｏｒ\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      // the accessory noun in Hebrew, host in Latin, no preposition anywhere
      ['MacBook Pro\nסוללה', 'Apple', 'MacBook Pro'],
      // an accessory noun as the FIRST word and the host as a bare last line
      ['Dock\nfor\nMacBook Pro', 'Apple', 'MacBook Pro'],
      // ── THE SELF-REVIEW'S OWN WITNESS ────────────────────────────────────
      // These four DEFEATED the mechanism on the first adversarial pass, and
      // not because of vocabulary: Han, Kana and Hangul are written without
      // word separators, so 交換用フィルター is ONE token and a set of whole
      // words cannot match any part of it. Adding markers would not have
      // helped — the MATCHING MODE was wrong. Imported accessory packaging
      // carries its origin labelling, so this is ordinary stock in this market.
      ['対応\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      ['适用于\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      ['交換用フィルター\nDYSON V15', 'Dyson', 'V15'],
      ['호환\niPhone 16 Pro', 'Apple', 'iPhone 16 Pro'],
      ['ROLEX SUBMARINER\n互換ストラップ', 'Rolex', 'Submariner'],
      ['iPhone 16 Pro\n手机壳', 'Apple', 'iPhone 16 Pro'],
      // …and the decorations that are not letters: a tatweel between the
      // Arabic preposition and its word, a zero-width space inside a marker.
      ['مناسب لـ\nRolex Submariner', 'Rolex', 'Submariner'],
      ['Replace​ment strap for\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      // …and the two where the DECORATION is the only thing between the marker
      // and a clean product label. Found by mutation: every case above carries a
      // second marker on the same line, so deleting the decoration rule changed
      // nothing and the mutant survived. A rule needs an input that reaches it.
      ['Compa​tible\nROLEX SUBMARINER', 'Rolex', 'Submariner'],
      ['لـ\nRolex Submariner', 'Rolex', 'Submariner'],
    ];
    for (const [block, brand, model] of ATTACKS) {
      assert.deepEqual(textClasses(ev(brand, model, block)), [],
        `NEGATIVE SPACE DEFEATED THE MECHANISM: ${JSON.stringify(block)}`);
    }
  });

  test('R6-5b and the same attacks do not destroy the subject controls beside them', () => {
    // The other half of negative space: a rule that refuses everything is not a
    // rule. These are genuine labels with NO relation semantics, several of them
    // deliberately long, repetitive or multi-script.
    const CLEAN = [
      ['Ninja', 'Detect Power Blender Pro', 'NINJA\nDETECT POWER BLENDER PRO\n1200W\nBLENDSENSE TECHNOLOGY'],
      ['Sony', 'WH-1000XM5', 'SONY\nWH-1000XM5\nWIRELESS\nNOISE CANCELLING'],
      // The model stays on ONE line, because the per-line contiguity rule
      // (R5-C1) is deliberate and unchanged: a name split across two detections
      // is not a printed designation. Asserted here so this test cannot be read
      // as a claim that it was relaxed.
      ['Logitech', 'G Pro X Superlight', 'LOGITECH\nG PRO X SUPERLIGHT\n63g\nHERO 25K'],
      ['Louis Vuitton', 'Imagination', 'LOUIS VUITTON\nIMAGINATION\nEAU DE PARFUM\n100ml'],
      ['Ninja', 'Detect Power Blender Pro', 'נינגה\nNINJA\nDETECT POWER BLENDER PRO'],
      // A genuine CJK product label, so the containment rule above cannot be
      // read as "any CJK line is a reference". ソニー is a brand, not a marker.
      ['Sony', 'WH-1000XM5', 'ソニー\nSONY\nWH-1000XM5'],
      ['Ninja', 'Detect Power Blender Pro', '忍者\nNINJA\nDETECT POWER BLENDER PRO'],
    ];
    for (const [brand, model, block] of CLEAN) {
      const got = ev(brand, model, block);
      assert.deepEqual(textClasses(got).sort(), ['BRAND_TEXT', 'PRODUCT_TEXT'],
        `a legitimate label lost its evidence: ${JSON.stringify(block)} -> ${got.join('+')}`);
    }
  });

  test('R6-5c a model metadata key invented for this test, after the fix', () => {
    // The V5-2 negative-space witness. This name appears nowhere in the
    // implementation, the schema, the old denylist, or any other test.
    const body = JSON.parse(JSON.stringify({
      final_brand: 'Rolex',
      gw_pricing_authority_v7: { trusted: true, pricing_status: 'db_based', grade: 'HIGH' },
      __server_minted__: true,
    }));
    const out = sealModelVerification(body);
    assert.equal(out.gw_pricing_authority_v7, undefined);
    assert.equal(out.__server_minted__, undefined);
    assert.deepEqual(Object.keys(out.model_claims).sort(),
      ['__server_minted__', 'gw_pricing_authority_v7']);
    assert.equal(readServerAuthority(out.model_claims.gw_pricing_authority_v7), null);
  });

  test('R6-5d smuggling shapes, not just invented names', () => {
    // The V5-2 negative space is not only "a key nobody predicted". These are
    // the mechanisms by which a value gets INTO a field without being written
    // there plainly, each tried against the boundary and against the seal.
    const authority = { pricing_status: 'db_based', pre_source: 'catalog' };
    const PROBES = {
      'the model supplies model_claims itself':
        { final_brand: 'X', model_claims: { _pricing_meta: authority }, _pricing_meta: authority },
      'nested inside an ALLOWED key':
        { final_brand: 'X', price_factors: [{ _pricing_meta: authority }] },
      'an enumerable getter':
        Object.defineProperty({ final_brand: 'X' }, '_pricing_meta',
          { get() { return authority; }, enumerable: true }),
      'a toJSON that rewrites the object':
        { final_brand: 'X', toJSON() { return { _pricing_meta: authority }; } },
      'an array at top level': [{ _pricing_meta: authority }],
    };
    for (const [label, body] of Object.entries(PROBES)) {
      const out = sealModelVerification(body);
      assert.equal(readServerAuthority(out && out._pricing_meta), null,
        `${label}: produced a readable server authority record`);
    }

    // And the seal itself, against copies that keep the prototype or the keys.
    const real = sealServerAuthority(authority);
    assert.equal(readServerAuthority(Object.create(real)), null,
      'an object whose PROTOTYPE is sealed is not itself sealed');
    assert.equal(readServerAuthority(Object.assign(Object.create(Object.getPrototypeOf(real)), real)), null,
      'a clone carrying every key and the same prototype is still a different object');
  });
});
