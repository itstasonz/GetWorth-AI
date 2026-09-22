// ══════════════════════════════════════════════════════════════════════════════
// THE SECOND PRODUCTION WITNESS — IDENTITY HANDOFF AND PRICE PROVENANCE
//
// A Logitech gaming mouse, build ed37e75, a valid photograph this time.
//
//   Phase A: Logitech 92%, and three ranked candidates —
//            G Pro X Superlight 45% · G Pro Wireless 40% · G305 25%
//            Stage 2 declined to choose: final_model = 'unidentified'
//   Phase B: brand Logitech, model null, then reasoned aloud about
//            G703 / G403 and searched the market for THOSE.
//
// One photograph, two stages, two disjoint product families, and the second
// one silently became the search. Three separate defects produced that:
//
//   1. The client read ONLY `identification.model` (= final_model). Stage 2's
//      'unidentified' made the ternary return [], so the shortlist never left
//      the phone — although it was one field away in `recognition.alternatives`.
//   2. buildIdentityPrompt read `model_candidates?.[0]`, so even a full list
//      would have arrived as one name.
//   3. Nothing compared the two answers, so a disjoint guess became search
//      authority with no record that a disagreement had occurred.
//
//   node --test tests/identity-handoff.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { reconcileIdentity, IDENTITY_AGREEMENT } from '../api/_lib/phaseb/validation.js';
import { buildIdentityPrompt } from '../api/_lib/phaseb/prompts.js';
import { runPhaseB } from '../api/_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from '../api/_lib/phaseb/market-research.js';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');

/** Phase A's shortlist, exactly as the witness produced it. */
const WITNESS_CANDIDATES = [
  { model: 'G Pro X Superlight', confidence: 0.45 },
  { model: 'G Pro Wireless', confidence: 0.40 },
  { model: 'G305', confidence: 0.25 },
];

// ════════════════════════════════════════════════════════════════════════════
// IH-1 · THE SHORTLIST LEAVES THE PHONE
// ════════════════════════════════════════════════════════════════════════════
describe('IH-1 Phase A candidates reach Phase B', () => {
  test('IH-1a the client reads the candidate list, not only the resolved model', () => {
    const src = read('src/contexts/AppContext.jsx');
    const at = src.indexOf('model_candidates: [');
    assert.ok(at > 0, 'model_candidates must be assembled from more than one source');
    const block = src.slice(at, at + 900);
    assert.match(block, /recognition\?\.alternatives/,
      'the shortlist lives at recognition.alternatives and must be forwarded — reading only '
      + 'identification.model means an UNRESOLVED Stage 2 sends nothing at all');
    assert.match(block, /resolved: true/, 'the resolved model must be marked and ranked first');
  });

  test('IH-1b an unresolved Stage 2 still forwards candidates', () => {
    // The witness exactly: final_model 'unidentified', three alternatives.
    const src = read('src/contexts/AppContext.jsx');
    const at = src.indexOf('model_candidates: [');
    const block = src.slice(at, at + 900);
    // The 'unidentified' filter must apply ONLY to the resolved entry, never
    // to the alternatives — otherwise the witness reproduces exactly.
    const resolvedArm = block.slice(0, block.indexOf('...(Array.isArray'));
    assert.match(resolvedArm, /!== 'unidentified'/);
    const altArm = block.slice(block.indexOf('...(Array.isArray'));
    assert.ok(!/identification\.model/.test(altArm),
      'the alternatives arm must not be gated on the resolved model');
  });

  test('IH-1c the prompt carries every candidate, ranked', () => {
    const p = buildIdentityPrompt({
      language: 'en',
      existingRecognition: {
        category: 'Electronics', subcategory: 'gaming mouse',
        brand_candidates: [{ brand: 'Logitech', confidence: 0.92 }],
        model_candidates: WITNESS_CANDIDATES,
      },
      ocrText: ['G'],
    });
    for (const c of WITNESS_CANDIDATES) {
      assert.ok(p.includes(c.model), `the prompt dropped "${c.model}"`);
    }
    assert.match(p, /G Pro X Superlight \(45%\)/, 'the ranking must survive');
    // And it must still be quarantined as data.
    const fenceStart = p.indexOf('<<<UNTRUSTED_EXISTING_RECOGNITION>>>');
    const fenceEnd = p.indexOf('<<<END_UNTRUSTED_EXISTING_RECOGNITION>>>');
    assert.ok(fenceStart > 0 && fenceEnd > fenceStart);
    assert.ok(p.slice(fenceStart, fenceEnd).includes('G305'),
      'candidates must sit INSIDE the untrusted fence, not beside it');
  });

  test('IH-1d a shortlist is data, never an instruction to comply', () => {
    const p = buildIdentityPrompt({
      existingRecognition: { model_candidates: WITNESS_CANDIDATES },
    });
    assert.match(p, /may be wrong/);
    assert.match(p, /WHAT TO DO WITH THE CANDIDATE LIST/,
      'the model must be told how much weight the list carries, or it becomes an answer key');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IH-2 · A DISAGREEMENT IS RECORDED, NOT RESOLVED SILENTLY
// ════════════════════════════════════════════════════════════════════════════
describe('IH-2 the identity contract', () => {
  const rec = { model_candidates: WITNESS_CANDIDATES };
  const verdict = (model) => reconcileIdentity({
    identity: { subject: { brand: 'Logitech', model } }, existingRecognition: rec,
  });

  test('IH-2a the witness is a CONFLICT and caps the search', () => {
    for (const m of ['G703', 'G403']) {
      const r = verdict(m);
      assert.equal(r.agreement, IDENTITY_AGREEMENT.CONFLICT, m);
      assert.equal(r.conflict, true, m);
      assert.equal(r.search_specificity_cap, 'brand_category', m);
    }
  });

  test('IH-2b agreement, refinement and spelling are not conflicts', () => {
    assert.equal(verdict('G Pro Wireless').agreement, IDENTITY_AGREEMENT.CONFIRM);
    // Phase A's display names repeat the brand; Phase B returns the model
    // alone. Comparing raw would call two spellings of one answer a conflict.
    assert.equal(verdict('Logitech G Pro Wireless').agreement, IDENTITY_AGREEMENT.CONFIRM);
    assert.equal(verdict('G Pro X Superlight 2 DEX').agreement, IDENTITY_AGREEMENT.REFINE);
    for (const m of ['G Pro Wireless', 'Logitech G Pro Wireless', 'G Pro X Superlight 2 DEX']) {
      assert.equal(verdict(m).search_specificity_cap, null, `${m} must not be capped`);
    }
  });

  test('IH-2c an open-world DB miss is EXTEND, and is NEVER capped', () => {
    // THE PRODUCT REQUIREMENT. A catalog miss is the normal case: when Phase A
    // proposes nothing, Phase B is the only opinion there is and must be free
    // to search at full specificity. A contract that punished silence would
    // close the open world.
    const r = reconcileIdentity({
      identity: { subject: { brand: 'Ninja', model: 'BN751' } },
      existingRecognition: { model_candidates: [] },
    });
    assert.equal(r.agreement, IDENTITY_AGREEMENT.EXTEND);
    assert.equal(r.conflict, false);
    assert.equal(r.search_specificity_cap, null);
  });

  test('IH-2d no model, or the brand echoed back, is UNKNOWN not CONFLICT', () => {
    assert.equal(verdict(null).agreement, IDENTITY_AGREEMENT.UNKNOWN);
    assert.equal(verdict('Logitech').agreement, IDENTITY_AGREEMENT.UNKNOWN);
    assert.equal(verdict(null).conflict, false);
  });

  test('IH-2e it is total — any shape of input yields a verdict', () => {
    for (const bad of [undefined, null, {}, { identity: null }, { existingRecognition: 'x' },
      { identity: { subject: { model: 5 } }, existingRecognition: { model_candidates: 'no' } }]) {
      const r = reconcileIdentity(bad);
      assert.ok(r && typeof r.agreement === 'string', JSON.stringify(bad));
      assert.equal(typeof r.conflict, 'boolean');
    }
  });

  test('IH-2f a conflict caps the QUERY, and keeps the identity', async () => {
    const provider = async (_u, init) => {
      const n = JSON.parse(init.body)?.text?.format?.name ?? '';
      const payload = n.includes('identity') ? {
        subject: {
          object_class: 'gaming mouse', category_candidate: 'Electronics', brand: 'Logitech',
          product_name: 'Logitech G703', family: 'G', model: 'G703', variant: null,
          identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null },
        },
        confidence: { overall: 0.5, object_class: 0.9, brand: 0.9, model: 0.4, variant: 0 },
        evidence: [], references: [], ambiguities: ['shell shape ambiguous'], alternatives: [],
      } : n.includes('condition') ? {
        grade: 'Good', confidence: 0.6, observed: [], not_visible: [],
        authenticity_observation: 'insufficient_evidence',
      } : n.includes('market_query') ? {
        product_identity: 'Logitech G703', variant: 'black', condition_target: 'used',
        geography: 'Israel', currency: 'ILS', market: 'second_hand',
        search_terms: ['logitech g703'], specificity: 'exact_model',
      } : { observations: [], search_performed: true, notes: null };
      return new Response(JSON.stringify({
        model: 'test',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const r = await runPhaseB({
      images: ['aGk='], language: 'en', ocrText: ['G'],
      existingRecognition: { brand_candidates: [{ brand: 'Logitech' }], model_candidates: WITNESS_CANDIDATES },
      apiKey: 'k', model: 'test',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl: provider,
    });

    // The identity is KEPT — Phase B is allowed to disagree.
    assert.equal(r.identity_candidate.subject.model, 'G703');
    assert.equal(r.identity_candidate.reconciliation.agreement, IDENTITY_AGREEMENT.CONFLICT);
    // The SEARCH is what the disagreement costs.
    const q = r.market_evidence.query;
    assert.equal(q.specificity, 'brand_category',
      'a model both readings dispute must not be searched as an exact model');
    assert.ok(!/g703/i.test(q.product_identity),
      `the disputed model reached the search: ${q.product_identity}`);
    assert.equal(q.variant, null);
    const stage = r.stages.find((s) => s.stage === 'market_query');
    assert.match(String(stage.detail), /identity disputed/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IH-3 · PRICE PROVENANCE ON SCREEN
// ════════════════════════════════════════════════════════════════════════════
describe('IH-3 a price says what it rests on', () => {
  const src = () => read('src/views/CameraResultsView.jsx');

  test('IH-3a three bases exist and are distinguishable', () => {
    const s = src();
    assert.match(s, /PRICE_BASIS = Object\.freeze\(\{/);
    for (const k of ['VERIFIED_MARKET', 'MARKET_ESTIMATE', 'AI_ESTIMATE', 'NONE']) {
      assert.ok(s.includes(`${k}:`), `PRICE_BASIS.${k} must exist`);
    }
    assert.match(s, /export function resolvePriceBasis/);
  });

  test('IH-3b only qualified market evidence may claim the market', () => {
    const s = src();
    const fn = /export function resolvePriceBasis[\s\S]*?\n\}/.exec(s)[0];
    assert.match(fn, /_phaseB\?\.validation\?\.market_evidence/,
      'the verified-market basis must read the QUALIFIED report, not a count');
    assert.match(fn, /qualified === true/,
      'anything short of qualified is not verified market evidence');
    // Fail-closed: the last word is the uncorroborated reading.
    assert.match(fn, /return PRICE_BASIS\.AI_ESTIMATE;\s*\n\}/,
      'the default must be AI_ESTIMATE — an unrecognised source is not a market source');
  });

  test('IH-3c a search that admitted nothing cannot read as strong', () => {
    const s = src();
    const fn = /function getPricingEvidence\([\s\S]*?\n\}/.exec(s)[0];
    assert.match(fn, /marketEvidence/, 'the label must consult the market reading');
    assert.match(fn, /searched && admitted === 0/,
      'a search that ran and admitted nothing must cap the claim');
    // It may only LOWER. A market success is already in the grade via
    // verified_market; letting this raise anything would be a second authority.
    assert.ok(!/=== 'MEDIUM'\s*\)\s*\?\s*'HIGH'/.test(fn),
      'the market reading may never RAISE the grade');
  });

  test('IH-3d the label is wired to the real Phase B counts', () => {
    const s = src();
    const at = s.indexOf('const evidence = getPricingEvidence(');
    const call = s.slice(at, at + 420);
    assert.match(call, /search_performed === true/);
    assert.match(call, /validation\?\.market_evidence\?\.admitted/);
  });

  test('IH-3e every discovered listing is accounted for on screen', () => {
    const s = src();
    assert.match(s, /foreign currency \(no FX\)/,
      'context_only listings must be shown — the witness read 10 discovered, '
      + '0 admitted, 1 rejected and nine simply vanished');
    assert.match(s, /UNACCOUNTED/,
      'and any residual the three buckets do not explain must be visible, not silent');
  });
});
