// ══════════════════════════════════════════════════════════════════════════════
// THE FIRST PRODUCTION WITNESS — REGRESSION SUITE
//
// A real phone, a real Ninja blender, build 500d699. Phase A identified it
// correctly (brand 99%, model 95%, ocr_confirmed). Phase B then refused to
// search the market at all, and the user was told "Set your own price" beside
// a confident "New retail: ₪950" that nothing had verified.
//
// The cause was one word. The blender's own control panel read, in Hebrew:
//
//     פולס · תוכניות · ידני · חלק · קיצור דק · בינוני · גבוה · ריסוק · זמן
//
// `חלק` between "fine chop" and "crush" means SMOOTH. In ACCESSORY_NOUN it is
// the Hebrew for PART. One bare label out of fifteen lines made the block
// REFERENCE, which made the printed brand and model unusable as corroboration,
// which produced CONTRADICTED, which skipped market research — the entire
// reason Phase B exists.
//
// ── WHY THESE TESTS ARE NOT ABOUT NINJA ────────────────────────────────────
//
// Nothing below names a Ninja rule, a Ninja price, or a Ninja fixture. The
// witness supplies the OCR because it is REAL TEXT that really broke, and a
// regression suite built from invented text tests the invention. What is
// asserted is the general property: a bare ambiguous noun is a LABEL, a
// qualified one is a PRODUCT NAME, and only the second describes a
// relationship. Group B exists to prove that distinction did not cost the
// accessory protection anything.
//
//   node --test tests/first-witness.test.mjs
//
// Every provider call is mocked. No test here spends credits.
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

// ── THE AUTHORITY MODULE IS IMPORTED THROUGH THE HARNESS'S PATH ────────────
//
// tests/mutations/run.mjs writes a MUTATED copy of pricing-authority.js to a
// temp file and points VAL001_AUTHORITY_PATH at it. A suite that imports the
// real path instead always sees the unmutated module, so every mutant of these
// rules SURVIVES — not because the property is untested, but because the test
// was looking at the wrong file. M65b did exactly that on its first run, which
// is the same omission run.mjs's own comment block has recorded three times.
const AUTH_URL = process.env.VAL001_AUTHORITY_PATH
  ? new URL(`file://${process.env.VAL001_AUTHORITY_PATH}`)
  : new URL('../api/_lib/pricing-authority.js', import.meta.url);
const { classifyOcrBlock, RELATION } = await import(AUTH_URL.href);

import { corroborateSubject, CORROBORATION } from '../api/_lib/phaseb/validation.js';
import { runPhaseB, PHASE_B_STATUS } from '../api/_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from '../api/_lib/phaseb/market-research.js';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');

/** The OCR exactly as production logged it. Fifteen lines, not three. */
const WITNESS_OCR = Object.freeze([
  'NINJA', 'POWER BLENDER DUO PRO', 'BLENDSENSE',
  'פולס', 'תוכניות', 'ידני', 'התחלה / עצירה', 'חלק',
  'קיצור דק', 'בינוני', 'גבוה', 'ריסוק', 'ריסוק מקסימלי', 'מזג סנגר', 'זמן',
]);

// ════════════════════════════════════════════════════════════════════════════
// FW-1 · A BARE AMBIGUOUS NOUN IS A LABEL, NOT A RELATIONSHIP
// ════════════════════════════════════════════════════════════════════════════
describe('FW-1 an isolated ambiguous noun cannot poison a block', () => {
  test('FW-1a the witness block is SUBJECT, and its brand is readable', () => {
    const prov = classifyOcrBlock(WITNESS_OCR.join('\n'));
    assert.equal(prov.block_relation, RELATION.SUBJECT,
      'fifteen lines of an object labelling itself were classified as a relationship');
    assert.equal(prov.subject_text_permitted, true);
    const nonSubject = prov.lines.filter((l) => l.relation !== RELATION.SUBJECT);
    assert.deepEqual(nonSubject, [],
      `no line here names a relationship; got ${nonSubject.map((l) => l.words.join(' ')).join(', ')}`);
  });

  test('FW-1b the property generalises across languages and vocabularies', () => {
    // Every one of these is a bare ACCESSORY_NOUN used as an ordinary label on
    // the object itself. None of them is a claim about a different product.
    // If this list only contained Hebrew, the fix would be a Hebrew patch.
    for (const [label, block] of [
      ['Hebrew guard/protect mode', 'SAMSUNG\nWF80F5\nמגן\nאקו'],
      ['Hebrew cover/lid label', 'TEFAL\nCY505\nכיסוי\nחימום'],
      ['English screen label', 'LG\n27GP850\nscreen\nmenu\ninput'],
      ['English case/mode label', 'CANON\nEOS R6\ncase\nauto'],
      ['English stand control', 'DELL\nU2720Q\nstand\nbrightness'],
      ['English band setting', 'SONY\nICF-P26\nband\nAM\nFM'],
    ]) {
      const prov = classifyOcrBlock(block);
      assert.equal(prov.block_relation, RELATION.SUBJECT, `${label}: ${JSON.stringify(block)}`);
    }
  });

  test('FW-1c the relaxation reaches homographs and stops there', () => {
    // THIS TEST IS TWO LOOPS ON PURPOSE. The first is the fix; the second is
    // the price of the fix, and it is the one that must never start passing.
    //
    // HOMOGRAPHS — a bare line carrying one of these is a label, not a claim.
    for (const bare of ['חלק', 'מגן', 'כיסוי', 'screen', 'case', 'cover', 'band', 'stand', 'part']) {
      const prov = classifyOcrBlock(`ACME\nMODEL X1\n${bare}`);
      assert.equal(prov.block_relation, RELATION.SUBJECT,
        `a bare "${bare}" label vetoed a block that otherwise describes its own subject`);
    }
    // THE COMPLEMENT — these nouns mean nothing but an accessory, so one of
    // them alone IS a relationship and must still veto the block. A first
    // attempt at this fix required a phrase for EVERY accessory noun and broke
    // `Rolex Submariner / רצועה` and `DYSON V15 DETECT HEPA FILTER` at once.
    for (const bare of ['strap', 'רצועה', 'filter', 'פילטר', 'charger', 'מטען',
                        'blade', 'להב', 'battery', 'סוללה', 'lens', 'עדשה', 'cable']) {
      const prov = classifyOcrBlock(`ACME\nMODEL X1\n${bare}`);
      assert.equal(prov.block_relation, RELATION.REFERENCE,
        `a bare "${bare}" no longer marks packaging — the accessory protection has been widened`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FW-2 · THE ACCESSORY PROTECTION IS UNCHANGED
//
// This is the half that matters more. The fix is only acceptable if genuine
// accessory packaging still refuses to hand over the host's identity.
// ════════════════════════════════════════════════════════════════════════════
describe('FW-2 real accessory and reference packaging stays REFERENCE', () => {
  test('FW-2a qualified accessory nouns, with no preposition anywhere', () => {
    for (const [label, block] of [
      ['R6-1e contract case', 'Leather Strap\n20mm\nRolex Submariner'],
      ['Hebrew charger + host', 'מטען MacBook Pro'],
      ['English charger + host', 'Charger MacBook Pro'],
      ['two-word accessory', 'Silicone Case\niPhone 16 Pro'],
      ['screen protector', 'Tempered Protector\nGalaxy S24'],
    ]) {
      const prov = classifyOcrBlock(block);
      assert.equal(prov.block_relation, RELATION.REFERENCE, `${label}: ${JSON.stringify(block)}`);
      assert.equal(prov.subject_text_permitted, false, label);
    }
  });

  test('FW-2b explicit relational markers, the paths this change did not touch', () => {
    for (const [label, block] of [
      ['replacement', 'Replacement Blade\nFor NINJA\nPOWER BLENDER'],
      ['compatible with', 'Slim Case\ncompatible with iPhone 16 Pro'],
      ['for + host', 'Charger for MacBook Pro'],
      ['Hebrew spare part', 'חלק חילוף\nNINJA'],
      ['Hebrew compatible', 'כיסוי תואם ל-iPhone 16 Pro'],
      ['sold separately', 'iPhone 16 Pro\nPhone sold separately'],
      ['not included', 'Rolex Submariner\nWatch not included'],
      ['Hebrew not included', 'iPhone 16 Pro\nהמכשיר אינו כלול'],
      ['CJK single token', 'ROLEX\n交換用ベルト'],
    ]) {
      const prov = classifyOcrBlock(block);
      assert.equal(prov.block_relation, RELATION.REFERENCE, `${label}: ${JSON.stringify(block)}`);
    }
  });

  test('FW-2c an accessory block still cannot lend its host to a subject', () => {
    // The end-to-end consequence, not just the classification: a Phase-B
    // subject that echoes a host name out of a reference-bearing block is
    // CONTRADICTED, which is REC7-C1 and must survive this change intact.
    const r = corroborateSubject({
      identity: { subject: { brand: 'Rolex', model: 'Submariner' }, references: [] },
      ocrText: ['Leather Strap', '20mm', 'Rolex Submariner'],
    });
    assert.equal(r.level, CORROBORATION.CONTRADICTED);
    assert.equal(r.brand_read_off_item, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FW-3 · THE WITNESS NOW REACHES THE MARKET
//
// Strong OCR-backed identity + zero catalog rows must reach live research.
// This is the product requirement the witness violated.
// ════════════════════════════════════════════════════════════════════════════
describe('FW-3 strong identity with a DB miss reaches market research', () => {
  const listing = (domain, ref, price) => ({
    source: `https://${domain}/${ref}`, source_domain: domain, listing_id_or_reference: ref,
    title: 'Ninja Power Blender Duo Pro', observed_price: price, currency: 'ILS',
    condition: 'used', location: 'Tel Aviv', observed_at: null, listing_kind: 'used_listing',
    match: { brand: 'Ninja', model: 'Power Blender Duo Pro', variant: null, confidence: 0.9 },
  });

  /** A provider that answers each stage from a recorded shape. */
  const provider = ({ observations = [], latency = {} } = {}) => async (_url, init) => {
    const n = JSON.parse(init.body)?.text?.format?.name ?? '';
    const key = n.includes('identity') ? 'identity'
      : n.includes('condition') ? 'condition'
        : n.includes('market_query') ? 'market_query' : 'market_research';
    const payload = key === 'identity' ? {
      subject: {
        object_class: 'blender', category_candidate: 'Home', brand: 'Ninja',
        product_name: 'Ninja Power Blender Duo Pro', family: 'Power Blender',
        model: 'Power Blender Duo Pro', variant: null,
        identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null },
      },
      confidence: { overall: 0.93, object_class: 0.95, brand: 0.97, model: 0.92, variant: 0 },
      evidence: [{ type: 'visible_text', value: 'POWER BLENDER DUO PRO', source: 'image', confidence: 0.95 }],
      references: [], ambiguities: [], alternatives: [],
    } : key === 'condition' ? {
      grade: 'Good', confidence: 0.7, observed: [{ signal: 'clean', detail: 'light use' }],
      not_visible: ['internal_function'], authenticity_observation: 'no_obvious_visual_inconsistency',
    } : key === 'market_query' ? {
      product_identity: 'Ninja Power Blender Duo Pro', variant: null, condition_target: 'used',
      geography: 'Israel', currency: 'ILS', market: 'second_hand',
      search_terms: ['ninja power blender duo pro יד שניה'], specificity: 'exact_model',
    } : { observations, search_performed: true, notes: null };
    if (latency[key]) await new Promise((r) => setTimeout(r, latency[key]));
    return new Response(JSON.stringify({
      model: 'test', usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const run = (opts) => runPhaseB({
    images: ['aGk='], language: 'he', ocrText: WITNESS_OCR,
    catalogCandidates: [],            // THE DB MISS, which must not matter
    apiKey: 'k', model: 'test',
    marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH,
    fetchImpl: provider(opts),
  });

  test('FW-3a corroboration is READ_OFF_ITEM and the market stages RUN', async () => {
    const r = await run({ observations: [] });
    assert.equal(r.identity_candidate.corroboration.level, CORROBORATION.READ_OFF_ITEM);
    const stage = (n) => r.stages.find((s) => s.stage === n);
    assert.equal(stage('market_query').status, 'ok',
      `market_query ${stage('market_query').status}: ${stage('market_query').detail}`);
    assert.equal(stage('market_research').status, 'ok');
    assert.equal(r.model_metadata.calls.attempts, 4,
      'the witness made 2 calls because the market branch was skipped; it must now make 4');
  });

  test('FW-3b qualified evidence produces a second-hand price, not "set your own"', async () => {
    const r = await run({
      observations: [
        listing('yad2.co.il', 'a', 480), listing('facebook.com', 'b', 520),
        listing('ebay.co.il', 'c', 450), listing('yad2.co.il', 'd', 560),
      ],
    });
    assert.equal(r.validation.market_evidence.qualified, true, 'VERIFIED_MARKET must be granted');
    assert.ok(r.validation.market_evidence.distinct_sources >= 2);
    assert.equal(r.valuation_candidate.status, 'PRICED');
    const { low, mid, high, currency } = r.valuation_candidate;
    assert.ok(low > 0 && mid >= low && high >= mid, `${low}/${mid}/${high}`);
    assert.equal(currency, 'ILS');
    assert.equal(r.validation.action, 'accept');
    assert.equal(r.status, PHASE_B_STATUS.COMPLETE);
    // NOT a hardcoded expectation: the numbers must be derived FROM the
    // observations, so the assertion is a relationship, not a constant.
    assert.ok(mid >= 450 && mid <= 560, `the median must sit inside the observed range, got ${mid}`);
  });

  test('FW-3c insufficient evidence still says so honestly', async () => {
    // The other correct answer. Two listings cannot meet the quorum of three,
    // and the engine must refuse rather than price a thin market.
    const r = await run({ observations: [listing('yad2.co.il', 'a', 480), listing('facebook.com', 'b', 520)] });
    assert.equal(r.validation.market_evidence, null, 'nothing should have been granted');
    assert.equal(r.valuation_candidate.status, 'PENDING_MARKET');
    assert.equal(r.valuation_candidate.mid, null, 'no price may be invented to avoid the manual state');
    assert.equal(r.status, PHASE_B_STATUS.IDENTIFIED_PENDING_MARKET);
  });

  test('FW-3d an unknown object still fails honestly, and searches nothing', async () => {
    const blank = async (_u, init) => {
      const n = JSON.parse(init.body)?.text?.format?.name ?? '';
      const payload = n.includes('identity') ? {
        subject: {
          object_class: null, category_candidate: null, brand: null, product_name: null,
          family: null, model: null, variant: null,
          identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null },
        },
        confidence: { overall: 0.1, object_class: 0.1, brand: 0, model: 0, variant: 0 },
        evidence: [], references: [], ambiguities: ['no visible branding'], alternatives: [],
      } : n.includes('condition') ? {
        grade: 'Unknown', confidence: 0.1, observed: [], not_visible: [],
        authenticity_observation: 'insufficient_evidence',
      } : { observations: [], search_performed: false, notes: null };
      return new Response(JSON.stringify({
        model: 'test', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const r = await runPhaseB({
      images: ['aGk='], ocrText: [], apiKey: 'k', model: 'test',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl: blank,
    });
    assert.equal(r.status, PHASE_B_STATUS.UNKNOWN);
    assert.equal(r.valuation_candidate.mid, null);
  });

  // ── FW-3e · CONCURRENCY PRESERVES SEMANTICS ────────────────────────────
  test('FW-3e condition overlaps the market branch without changing any answer', async () => {
    const observations = [
      listing('yad2.co.il', 'a', 480), listing('facebook.com', 'b', 520),
      listing('ebay.co.il', 'c', 450), listing('yad2.co.il', 'd', 560),
    ];
    const latency = { identity: 120, condition: 220, market_query: 60, market_research: 260 };
    const r = await run({ observations, latency });

    const at = (n) => r.stages.find((s) => s.stage === n);
    // The proof of overlap: condition and market_query start at the same
    // moment, both immediately after identity resolves.
    assert.ok(Math.abs(at('condition').at_ms - at('market_query').at_ms) < 60,
      `condition @+${at('condition').at_ms} vs market_query @+${at('market_query').at_ms} — not concurrent`);
    // And the wall clock beats the serial sum by roughly the shorter branch.
    const serial = Object.values(latency).reduce((a, b) => a + b, 0);
    assert.ok(r.timings.total_ms < serial - 100,
      `total ${r.timings.total_ms}ms did not beat the serial sum ${serial}ms`);

    // SEMANTICS UNCHANGED. Condition still received the resolved identity, so
    // its answer — and everything computed from it — is what it always was.
    assert.equal(r.condition_candidate.grade, 'Good');
    assert.equal(r.valuation_candidate.condition_adjustment.applied, true);
    assert.equal(r.validation.action, 'accept');
    assert.equal(r.status, PHASE_B_STATUS.COMPLETE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FW-4 · A RECALLED RETAIL PRICE IS NOT A MARKET PRICE
// ════════════════════════════════════════════════════════════════════════════
describe('FW-4 new_retail carries its provenance and no authority', () => {
  test('FW-4a the UI value defaults to the untrusted reading', () => {
    const src = read('api/analyze.js');
    assert.match(src, /newRetailSource: verification\.new_retail_source === 'catalog' \? 'catalog' : 'model_estimate'/,
      'provenance must be emitted beside the number, and must FAIL CLOSED: a construction '
      + 'path that forgets to mark itself is an estimate, not evidence');
  });

  test('FW-4b only a catalog-backed path may claim provenance', () => {
    const src = read('api/analyze.js');
    // Both catalog constructions read _db_retail, and only they set the marker.
    const marked = [...src.matchAll(/new_retail_source: 'catalog'/g)];
    assert.equal(marked.length, 2, `expected exactly the two _db_retail paths, found ${marked.length}`);
    for (const m of marked) {
      const before = src.slice(Math.max(0, m.index - 400), m.index);
      assert.match(before, /_db_retail/,
        'a path claimed catalog provenance without reading a catalog row');
    }
    // The Stage-2 schema field must NOT be marked anywhere.
    assert.ok(!/new_retail_price_ils: positivePriceOrNull\(verification\.new_retail_price_ils\)[\s\S]{0,200}new_retail_source: 'catalog'/.test(src),
      'the model-authored field was given catalog provenance');
  });

  test('FW-4c an unverified retail number is not shown beside a withheld price', () => {
    const src = read('src/views/CameraResultsView.jsx');
    const at = src.indexOf('newRetailPrice > 0');
    assert.ok(at > 0, 'the display site must exist');
    const gate = src.slice(at, at + 200);
    assert.match(gate, /newRetailSource === 'catalog'/,
      'the display must require catalog provenance. The witness showed a confident '
      + '"New retail: ₪950" under a REFUSED valuation, with no catalog row and no market research.');
  });

  test('FW-4d new_retail has no pricing authority anywhere', () => {
    // The strongest form of "zero authority": nothing that decides a price can
    // even READ it. If this ever fails, a recalled number has become an input.
    for (const rel of [
      'api/_lib/valuation-guard.js',
      'api/_lib/market-evidence.js',
      'api/_lib/pricing-authority.js',
      'api/_lib/phaseb/valuation.js',
      'api/_lib/phaseb/validation.js',
    ]) {
      const code = read(rel).split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      assert.ok(!/new_retail_price_ils|newRetailPrice|new_retail_source/.test(code),
        `${rel} reads the new-retail value; it must never influence a price`);
    }
  });

  test('FW-4e a new_retail listing is still rejected as market evidence', async () => {
    // The other half: even a REAL retail listing found by research cannot
    // enter the second-hand distribution. Unchanged by this pass, asserted
    // here because FW-4 is where a reader will look for it.
    const { normalizeObservations, REJECTION } = await import('../api/_lib/phaseb/market-research.js');
    const { accepted, rejected } = normalizeObservations([{
      source_domain: 'ksp.co.il', listing_id_or_reference: 'r1', title: 'Ninja Power Blender Duo Pro',
      observed_price: 950, currency: 'ILS', listing_kind: 'new_retail',
      match: { brand: 'Ninja', model: 'Power Blender Duo Pro', confidence: 0.95 },
    }]);
    assert.equal(accepted.length, 0);
    assert.equal(rejected[0].reason, REJECTION.NOT_USED);
  });
});
