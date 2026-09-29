// ══════════════════════════════════════════════════════════════════════════════
// IDENTITY EXPANSION — WHAT IS SEARCHED IS NOT WHAT IS ADMITTED
//
// Phase B used to search the market with five of the fields it had. These
// tests hold the replacement: everything already known about the subject
// reaches the search, the search is a bounded plan with one query per purpose,
// and what the results teach us about the product's NAME can never become
// evidence about its PRICE.
//
// Every provider here is a recorded shape. Nothing calls OpenAI.
//
//   node --test tests/identity-expansion.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import {
  buildIdentityContext, enforceQueryPlan, planSearch, supportedPurposes, assessIdentityDiscovery,
  observedIdentifiers, QUERY_PURPOSE, QUERY_DROPPED, DISCOVERY_DROPPED, SOURCE, MAX_QUERIES,
  buildLocalQuery, localSpecificity, localPlanFor, QUERY_PLANNER,
} from '../api/_lib/phaseb/identity-expansion.js';
import { extractSearchProvenance } from '../api/_lib/phaseb/search-provenance.js';
import { buildMarketQueryPrompt, buildMarketEvidencePrompt, buildIdentityPrompt } from '../api/_lib/phaseb/prompts.js';
import { MARKET_QUERY_SCHEMA, MARKET_EVIDENCE_SCHEMA, IDENTITY_SCHEMA } from '../api/_lib/phaseb/schemas.js';
import { resolveMarketRegion, MARKET_REGIONS } from '../api/_lib/phaseb/config.js';
import { runPhaseB, MARKET_OUTCOME } from '../api/_lib/phaseb/pipeline.js';
import { MARKET_MECHANISM } from '../api/_lib/phaseb/market-research.js';
import { describeModelIdentity, observedModelNumber } from '../api/analyze.js';
import {
  observedModelNumber as clientObservedModelNumber, recognisedModelName,
} from '../src/lib/utils.js';
import { researchOutput, IMG } from './fixtures/phaseb/benchmarks.mjs';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');
const P = QUERY_PURPOSE;
const READ = 'reported_read_off_item';

// A made-up product, so nothing here can be mistaken for a rule about a real one.
const subject = (o = {}) => ({
  object_class: 'espresso machine', category_candidate: 'Home', brand: 'Acme',
  product_name: 'Acme Barista Duo', family: 'Barista', model: 'Barista Duo', variant: null,
  identifiers: { mpn: null, sku: null, model_number: null, serial_visible: null }, ...o,
});
const identityOf = (o = {}, extra = {}) => ({
  subject: subject(o),
  confidence: { overall: 0.9, object_class: 0.9, brand: 0.9, model: 0.9, variant: 0 },
  evidence: [
    { type: 'visible_text', value: 'ACME', source: 'image', confidence: 0.9 },
    { type: 'visible_text', value: 'BARISTA DUO', source: 'image', confidence: 0.9 },
    { type: 'visible_text', value: 'THERMOJET', source: 'image', confidence: 0.9 },
    { type: 'visible_text', value: '1450W', source: 'image', confidence: 0.9 },
    { type: 'visible_text', value: 'MADE IN ITALY', source: 'image', confidence: 0.9 },
  ],
  attributes: { materials: [], colors: [], finish: null, shape: null, dimensions: null, style: null, distinctive: [] },
  known_aliases: [], references: [], ambiguities: ['capacity not visible'],
  alternatives: [{ brand: 'Acme', model: 'Barista Solo', why: 'similar body', confidence: 0.2 }],
  ...extra,
});
const PERMITTED = { subject_text_permitted: true };
const SHELF = identityOf(
  { object_class: 'wooden shelf', category_candidate: 'Furniture', brand: null, product_name: null, family: null, model: null },
  {
    evidence: [],
    attributes: { materials: ['oak'], colors: ['brown'], finish: 'matte', shape: null, dimensions: null, style: 'rustic', distinctive: ['three tiers'] },
    alternatives: [], ambiguities: [],
  },
);

// ════════════════════════════════════════════════════════════════════════════
// IX-1 · A MODEL NAME IS NOT A MODEL NUMBER
// ════════════════════════════════════════════════════════════════════════════
describe('IX-1 model name and model number are separate fields', () => {
  test('IX-1a a name is reported as a name, and no number is manufactured', () => {
    const r = describeModelIdentity({ final_model: 'Barista Duo' }, { model_candidates: [] });
    assert.deepEqual(r, { modelName: 'Barista Duo', modelNumber: null, modelNumberSource: null });
  });

  test('IX-1b a number exists only when one was read off the item', () => {
    const r = describeModelIdentity({ final_model: 'Barista Duo' }, { model_number_read: ' BD-450 ' });
    assert.deepEqual(r, { modelName: 'Barista Duo', modelNumber: 'BD-450', modelNumberSource: READ });
    // The adapter's private namespace is not a source: analyze.js may not read it.
    assert.equal(describeModelIdentity({ final_model: 'x' }, { _openai: { model_number: 'BD-450' } }).modelNumber, null);
    for (const none of [null, undefined, '', '   ', 42, {}, []]) {
      assert.equal(describeModelIdentity({ final_model: 'x' }, { model_number_read: none }).modelNumber, null);
    }
  });

  test('IX-1c an unidentified model is no name and no number', () => {
    for (const v of ['unidentified', 'Unidentified', '', null, undefined]) {
      assert.deepEqual(describeModelIdentity({ final_model: v }, {}),
        { modelName: null, modelNumber: null, modelNumberSource: null });
    }
  });

  test('IX-1d an OLD response’s name is never reinterpreted as an identifier', () => {
    // What every response looked like before the fix: the NAME, under the
    // field called number, with no source marker.
    const legacy = { modelNumber: 'Barista Duo' };
    for (const reader of [observedModelNumber, clientObservedModelNumber]) {
      assert.equal(reader(legacy), null);
      assert.equal(reader({ modelNumber: 'BD-450', modelNumberSource: READ }), 'BD-450');
      assert.equal(reader({ modelNumber: 'BD-450', modelNumberSource: 'guessed' }), null);
      assert.equal(reader(null), null);
    }
    // The name is still recoverable AS A NAME, for display.
    assert.equal(recognisedModelName(legacy, {}), 'Barista Duo');
    assert.equal(recognisedModelName({ modelName: 'Barista Duo', modelNumber: 'BD-450', modelNumberSource: READ }, {}), 'Barista Duo');
    assert.equal(recognisedModelName({ modelNumber: 'BD-450', modelNumberSource: READ }, { model: 'unidentified' }), null,
      'an identifier must not be shown as the model name either');
  });

  test('IX-1e no consumer writes a name into a column that means identifier', () => {
    const server = read('api/analyze.js');
    assert.ok(!/modelNumber:\s*verification\.final_model/.test(server), 'the response fills modelNumber from the name');
    assert.match(server, /model_number:\s+observedModelNumber\(result\.recognition\)/);
    const client = read('src/contexts/AppContext.jsx');
    assert.ok(!/model_number:[^\n]*identification\.model/.test(client), 'a row falls back from number to name');
    assert.ok(!/model_number:[^\n]*recognition\??\.modelNumber \|\|/.test(client), 'a row reads modelNumber unguarded');
    assert.equal((client.match(/model_number: observedModelNumber\(/g) || []).length, 3);
    assert.match(client, /detected_model: recognisedModelName\(recognition, identification\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-2 · WHAT IS ALREADY KNOWN REACHES THE SEARCH
// ════════════════════════════════════════════════════════════════════════════
describe('IX-2 identity data already paid for is preserved, with its source', () => {
  const phaseA = {
    category: 'Home', full_name: 'Acme Barista Duo Espresso Maker', full_name_hebrew: 'מכונת אספרסו אקמה בריסטה דואו',
    logos_detected: ['ACME'], labels_detected: ['PUMP 15 BAR'], model_number: null,
    visual_features: { materials: ['stainless steel'], colors: ['silver'], finish: 'brushed', shape: null },
  };

  test('IX-2a every field the order names is carried', () => {
    const c = buildIdentityContext({
      identity: identityOf({ identifiers: { model_number: 'BD-450', mpn: 'AC-77', sku: 'S-1', serial_visible: 'X' } }),
      existingRecognition: phaseA, ocrText: ['ACME', 'BARISTA DUO', 'THERMOJET'], corroboration: PERMITTED,
    });
    assert.equal(c.object_class, 'espresso machine');
    assert.equal(c.category, 'Home');
    assert.equal(c.brand, 'Acme');
    assert.equal(c.commercial_name, 'Acme Barista Duo');
    assert.equal(c.family, 'Barista');
    assert.equal(c.model_name, 'Barista Duo');
    assert.deepEqual(c.identifiers.model_number, { value: 'BD-450', source: SOURCE.PHASE_B_IMAGE });
    assert.equal(c.identifiers.mpn.value, 'AC-77');
    assert.equal(c.identifiers.sku.value, 'S-1');
    assert.ok(!JSON.stringify(c).includes('serial'), 'a serial number identifies a unit, not a product');
    assert.deepEqual(c.ambiguities, ['capacity not visible']);
    assert.deepEqual(c.alternatives.map((x) => x.model), ['Barista Solo']);
  });

  test('IX-2b Phase A’s names arrive as aliases, each marked as a hint', () => {
    const c = buildIdentityContext({ identity: identityOf(), existingRecognition: phaseA });
    assert.deepEqual(c.aliases, [{ value: 'Acme Barista Duo Espresso Maker', source: SOURCE.PHASE_A }]);
    assert.deepEqual(c.regional_names, [{ value: 'מכונת אספרסו אקמה בריסטה דואו', source: SOURCE.PHASE_A }]);
  });

  test('IX-2c a name that only repeats the known name is not an alias', () => {
    const c = buildIdentityContext({
      identity: identityOf(), existingRecognition: { full_name: 'ACME  barista duo', full_name_hebrew: 'unidentified' },
    });
    assert.deepEqual(c.aliases, []);
    assert.deepEqual(c.regional_names, []);
  });

  test('IX-2d remembered aliases are kept apart from anything that was read', () => {
    const c = buildIdentityContext({
      identity: identityOf({}, { known_aliases: [{ kind: 'alias', value: 'Acme Barista Twin' }, { kind: 'regional_name', value: 'Acme Doppio' }] }),
    });
    assert.deepEqual(c.aliases, [{ value: 'Acme Barista Twin', source: SOURCE.PHASE_B_KNOWLEDGE }]);
    assert.deepEqual(c.regional_names, [{ value: 'Acme Doppio', source: SOURCE.PHASE_B_KNOWLEDGE }]);
    assert.equal(c.identifiers.model_number, null, 'a remembered name manufactures no identifier');
  });

  test('IX-2e distinctive text survives; the name, ratings and boilerplate do not', () => {
    const c = buildIdentityContext({
      identity: identityOf(), existingRecognition: phaseA,
      ocrText: ['ACME', 'BARISTA DUO', 'THERMOJET', '1450W', 'CE', 'Made in Italy'], corroboration: PERMITTED,
    });
    const texts = c.visible_text.map((t) => t.value);
    assert.ok(texts.includes('THERMOJET'));
    assert.ok(texts.includes('PUMP 15 BAR'));
    for (const no of ['ACME', 'BARISTA DUO', '1450W', 'CE', 'MADE IN ITALY', 'Made in Italy']) {
      assert.ok(!texts.includes(no), `${no} identifies nothing`);
    }
  });

  test('IX-2f text from a reference-bearing block does not speak for the subject', () => {
    const c = buildIdentityContext({
      identity: identityOf({}, { evidence: [] }), existingRecognition: phaseA,
      ocrText: ['For HOSTBRAND TURBOMAX'], corroboration: { subject_text_permitted: false },
    });
    assert.deepEqual(c.visible_text, []);
  });

  test('IX-2g total: any input yields a context', () => {
    for (const bad of [undefined, null, {}, { identity: null }, { identity: 7, existingRecognition: 'x', ocrText: 3 }]) {
      const c = buildIdentityContext(bad ?? undefined);
      assert.equal(c.brand, null);
      assert.deepEqual([...supportedPurposes(c)], []);
    }
  });

  test('IX-2h the client forwards what Phase A produced, and the server returns it', () => {
    const client = read('src/contexts/AppContext.jsx');
    for (const key of ['full_name:', 'full_name_hebrew:', 'logos_detected:', 'labels_detected:', 'visual_features:']) {
      assert.ok(client.includes(key), `existing_recognition.${key} is not forwarded`);
    }
    const server = read('api/analyze.js');
    assert.match(server, /labels_found: ocr\.labels_detected/);
    assert.match(server, /visual_attributes: \{/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-3 · THE QUERY PLAN
// ════════════════════════════════════════════════════════════════════════════
describe('IX-3 a bounded plan, one query per purpose', () => {
  const withNumber = buildIdentityContext({ identity: identityOf({ identifiers: { model_number: 'BD-450' } }) });
  const noNumber = buildIdentityContext({ identity: identityOf() });
  const aliased = buildIdentityContext({ identity: identityOf(), existingRecognition: { full_name_hebrew: 'אקמה בריסטה' } });
  const q = (purpose, text) => ({ purpose, text });

  test('IX-3a the schema is a plan of at most five purposes', () => {
    const s = MARKET_QUERY_SCHEMA.properties.queries;
    assert.equal(s.maxItems, 5);
    assert.equal(MAX_QUERIES, 5);
    assert.deepEqual(s.items.properties.purpose.enum, Object.values(P));
    assert.ok(!('search_terms' in MARKET_QUERY_SCHEMA.properties), 'the free-text list is gone from what the model is asked for');
  });

  test('IX-3b an observed model number reaches a MODEL_NUMBER query', () => {
    assert.ok(supportedPurposes(withNumber).has(P.MODEL_NUMBER));
    const plan = enforceQueryPlan({ queries: [q(P.MODEL_NUMBER, 'Acme bd-450 used')] }, withNumber);
    assert.deepEqual(plan.queries, [q(P.MODEL_NUMBER, 'Acme bd-450 used')]);
    const prompt = buildMarketQueryPrompt({ identity: identityOf(), context: withNumber });
    assert.match(prompt, /model_number \(read off the item\): BD-450/);
  });

  test('IX-3c a MODEL_NUMBER query must contain the identifier that was read', () => {
    const plan = enforceQueryPlan({ queries: [q(P.MODEL_NUMBER, 'Acme ZZ-999 used')] }, withNumber);
    assert.deepEqual(plan.queries, []);
    assert.equal(plan.dropped[0].reason, QUERY_DROPPED.IDENTIFIER_ABSENT);
  });

  test('IX-3d no model number, no MODEL_NUMBER query', () => {
    assert.ok(!supportedPurposes(noNumber).has(P.MODEL_NUMBER));
    assert.deepEqual(observedIdentifiers(noNumber), []);
    const plan = enforceQueryPlan({ queries: [q(P.MODEL_NUMBER, 'Acme BD-450'), q(P.EXACT_IDENTITY, 'Acme Barista Duo')] }, noNumber);
    assert.deepEqual(plan.queries.map((x) => x.purpose), [P.EXACT_IDENTITY]);
    assert.equal(plan.dropped[0].reason, QUERY_DROPPED.NO_EVIDENCE);
  });

  test('IX-3e never more than five, never a purpose twice, never the same text twice', () => {
    const flood = [
      q(P.EXACT_IDENTITY, 'Acme Barista Duo'), q(P.EXACT_IDENTITY, 'Barista Duo by Acme'),
      q(P.LOCAL_SECOND_HAND, 'acme  BARISTA duo'), q(P.LOCAL_SECOND_HAND, 'Acme Barista Duo יד שנייה'),
      q(P.GENERIC_COMPARABLE, 'espresso machine used'), q(P.GENERIC_COMPARABLE, 'used espresso machine'),
      q('SOMETHING_ELSE', 'x'), q(P.ALIAS_OR_REGIONAL, ''), q(P.LOCAL_SECOND_HAND, 'a'), q(P.LOCAL_SECOND_HAND, 'b'),
    ];
    const plan = enforceQueryPlan({ queries: flood }, noNumber);
    assert.deepEqual(plan.queries.map((x) => x.purpose), [P.EXACT_IDENTITY, P.LOCAL_SECOND_HAND, P.GENERIC_COMPARABLE]);
    assert.ok(plan.queries.length <= 5);
    assert.equal(new Set(plan.queries.map((x) => x.purpose)).size, plan.queries.length);
    const why = plan.dropped.map((d) => d.reason);
    for (const r of [QUERY_DROPPED.DUPLICATE_PURPOSE, QUERY_DROPPED.DUPLICATE_TEXT, QUERY_DROPPED.UNKNOWN_PURPOSE, QUERY_DROPPED.EMPTY]) {
      assert.ok(why.includes(r), r);
    }
    const all = buildIdentityContext({
      identity: identityOf({ identifiers: { model_number: 'BD-450' } }), existingRecognition: { full_name_hebrew: 'אקמה בריסטה' },
    });
    const five = enforceQueryPlan({ queries: [
      q(P.EXACT_IDENTITY, 'Acme Barista Duo'), q(P.MODEL_NUMBER, 'Acme BD-450'), q(P.LOCAL_SECOND_HAND, 'Acme Barista Duo יד שנייה'),
      q(P.ALIAS_OR_REGIONAL, 'אקמה בריסטה'), q(P.GENERIC_COMPARABLE, 'espresso machine'),
    ] }, all);
    assert.equal(five.queries.length, 5);
  });

  test('IX-3f aliases reach query generation, and enable the alias purpose', () => {
    assert.ok(supportedPurposes(aliased).has(P.ALIAS_OR_REGIONAL));
    assert.ok(!supportedPurposes(noNumber).has(P.ALIAS_OR_REGIONAL));
    const prompt = buildMarketQueryPrompt({ identity: identityOf(), context: aliased, purposes: [...supportedPurposes(aliased)] });
    assert.match(prompt, /regional_names \(unverified\): אקמה בריסטה/);
    assert.match(prompt, /ALIAS_OR_REGIONAL/);
  });

  test('IX-3g a competing identity is context, never an alias', () => {
    assert.deepEqual(noNumber.aliases, []);
    const prompt = buildMarketQueryPrompt({ identity: identityOf(), context: noNumber });
    assert.match(prompt, /competing_identities \(different products, do not search\): Acme Barista Solo/);
  });

  test('IX-3h distinctive text on the item reaches query generation', () => {
    const c = buildIdentityContext({ identity: identityOf(), ocrText: ['THERMOJET'], corroboration: PERMITTED });
    assert.match(buildMarketQueryPrompt({ identity: identityOf(), context: c }), /other_text_on_the_item: THERMOJET/);
    assert.match(buildMarketEvidencePrompt({ query: { queries: [q(P.EXACT_IDENTITY, 'Acme Barista Duo')] }, context: c }),
      /query \[EXACT_IDENTITY\]: Acme Barista Duo/);
  });

  test('IX-3i a disputed model is removed from the plan as well as the intent', () => {
    const planned = planSearch({
      product_identity: 'Acme Barista Duo', variant: 'x', specificity: 'exact_model',
      queries: [
        q(P.EXACT_IDENTITY, 'Acme Barista Duo'), q(P.LOCAL_SECOND_HAND, 'Acme barista duo יד שנייה'),
        q(P.GENERIC_COMPARABLE, 'Acme espresso machine used'),
      ],
    }, noNumber, { disputed: true, identity: identityOf() });
    assert.equal(planned.specificity, 'brand_category');
    assert.equal(planned.variant, null);
    assert.deepEqual(planned.queries, [q(P.GENERIC_COMPARABLE, 'Acme espresso machine used')]);
    assert.deepEqual(planned.search_terms, ['Acme espresso machine used']);
    assert.ok(planned.queries_dropped.some((d) => d.reason === QUERY_DROPPED.DISPUTED_MODEL));
  });

  test('IX-3j the plan is what reaches the research stage', async () => {
    let researchPrompt = null;
    const identity = identityOf({ identifiers: { model_number: 'BD-450', mpn: null, sku: null, serial_visible: null } });
    const fetchImpl = async (_u, init) => {
      const body = JSON.parse(init.body);
      const n = body?.text?.format?.name ?? '';
      const text = body.input[0].content.find((c) => c.type === 'input_text').text;
      if (n.includes('market_evidence')) researchPrompt = text;
      const market = { observations: [], identity_discovery: { claims: [] }, search_performed: true, notes: null };
      const payload = n.includes('identity') ? identity
        : n.includes('condition') ? { grade: 'Good', confidence: 0.7, observed: [], not_visible: [], authenticity_observation: 'insufficient_evidence' }
          : n.includes('market_query') ? {
            product_identity: 'Acme Barista Duo', variant: null, condition_target: 'used', geography: 'Israel',
            currency: 'ILS', market: 'second_hand', specificity: 'exact_model',
            queries: [
              q(P.EXACT_IDENTITY, 'Acme Barista Duo'), q(P.MODEL_NUMBER, 'Acme BD-450'),
              q(P.ALIAS_OR_REGIONAL, 'invented other name'), q(P.EXACT_IDENTITY, 'again'),
            ],
          } : market;
      return new Response(JSON.stringify({
        output: n.includes('market_evidence') ? researchOutput(market)
          : [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      }), { status: 200 });
    };
    // The provider's planner, forced: this test is about what happens to a
    // plan a MODEL wrote. IX-8 covers the plan the pipeline builds itself.
    const r = await runPhaseB({
      images: [IMG], ocrText: ['ACME', 'BARISTA DUO', 'BD-450'], apiKey: 'k', model: 'm',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl, queryPlanner: 'model',
    });
    assert.deepEqual(r.market_evidence.query.queries.map((x) => x.purpose), [P.EXACT_IDENTITY, P.MODEL_NUMBER]);
    assert.deepEqual(r.market_evidence.query.search_terms, ['Acme Barista Duo', 'Acme BD-450']);
    assert.match(researchPrompt, /query \[MODEL_NUMBER\]: Acme BD-450/);
    assert.ok(!researchPrompt.includes('invented other name'), 'a query with no evidence behind it reached the search');
    assert.equal(r.market_evidence.identity_context.identifiers.model_number.value, 'BD-450');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-4 · GENERIC ITEMS
// ════════════════════════════════════════════════════════════════════════════
describe('IX-4 an object with no brand is searched by what it looks like', () => {
  test('IX-4a the identity schema can describe an object', () => {
    const a = IDENTITY_SCHEMA.properties.attributes;
    assert.deepEqual(Object.keys(a.properties), ['materials', 'colors', 'finish', 'shape', 'dimensions', 'style', 'distinctive']);
    for (const k of ['finish', 'shape', 'dimensions', 'style']) {
      assert.deepEqual(a.properties[k].type, ['string', 'null'], `${k} must be allowed to be unknown`);
    }
    assert.match(buildIdentityPrompt({}), /Never estimate a measurement from the photograph/);
  });

  test('IX-4b a shelf needs no brand, model or identifier', () => {
    const c = buildIdentityContext({ identity: SHELF });
    assert.equal(c.is_generic, true);
    assert.equal(c.brand, null);
    assert.deepEqual(observedIdentifiers(c), []);
    assert.deepEqual([...supportedPurposes(c)].sort(), [P.GENERIC_COMPARABLE, P.LOCAL_SECOND_HAND].sort());
  });

  test('IX-4c visible attributes reach the GENERIC_COMPARABLE query', () => {
    const c = buildIdentityContext({ identity: SHELF });
    const prompt = buildMarketQueryPrompt({ identity: SHELF, context: c, purposes: [...supportedPurposes(c)] });
    for (const line of ['materials: oak', 'colors: brown', 'finish: matte', 'style: rustic', 'distinctive_features: three tiers']) {
      assert.ok(prompt.includes(line), line);
    }
    assert.match(prompt, /dimensions: \n/, 'an unknown dimension stays empty');
    const plan = enforceQueryPlan({ queries: [
      { purpose: P.GENERIC_COMPARABLE, text: 'מדף עץ אלון כפרי שלוש קומות' },
      { purpose: P.EXACT_IDENTITY, text: 'BrandX Shelf Pro' },
      { purpose: P.MODEL_NUMBER, text: 'SH-100' },
    ] }, c);
    assert.deepEqual(plan.queries.map((x) => x.purpose), [P.GENERIC_COMPARABLE]);
  });

  test('IX-4d Phase A’s description is the fallback, and nothing is invented', () => {
    const bare = identityOf({ object_class: 'chair', brand: null, product_name: null, family: null, model: null },
      { evidence: [], attributes: undefined });
    const c = buildIdentityContext({
      identity: bare, existingRecognition: { visual_features: { materials: ['metal'], colors: [], finish: '', shape: 'folding' } },
    });
    assert.deepEqual(c.attributes.materials, { values: ['metal'], source: SOURCE.PHASE_A });
    assert.deepEqual(c.attributes.shape, { value: 'folding', source: SOURCE.PHASE_A });
    assert.deepEqual(c.attributes.colors, { values: [], source: null });
    assert.equal(c.attributes.finish, null);
    assert.equal(c.attributes.dimensions, null);
    assert.equal(c.attributes.style, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-5 · DISCOVERY IS NOT AUTHORITY
// ════════════════════════════════════════════════════════════════════════════
describe('IX-5 what the web calls a product can never price it', () => {
  const prov = extractSearchProvenance([{
    type: 'web_search_call', status: 'completed',
    action: { type: 'search', query: 'q', sources: [{ url: 'https://shop-one.example/p/1' }, { url: 'https://www.shop-two.example/x' }] },
  }]);
  const claim = (kind, value, domain) => ({ kind, value, source_url: `https://${domain}/page`, source_domain: domain });

  test('IX-5a the schema has nowhere to put a price', () => {
    const c = MARKET_EVIDENCE_SCHEMA.properties.identity_discovery.properties.claims.items.properties;
    assert.deepEqual(Object.keys(c), ['kind', 'value', 'source_url', 'source_domain']);
    assert.ok(!/price|currency|amount/i.test(JSON.stringify(MARKET_EVIDENCE_SCHEMA.properties.identity_discovery)));
  });

  test('IX-5b every claim keeps the page that suggested it', () => {
    const d = assessIdentityDiscovery({ claims: [claim('model_number', 'BD-450', 'shop-one.example')] }, prov);
    assert.deepEqual(d.claims[0].source_domains, ['shop-one.example']);
    assert.deepEqual(d.claims[0].source_urls, ['https://shop-one.example/page']);
    assert.deepEqual(d.model_numbers, ['BD-450']);
  });

  test('IX-5c an identifier seen on one domain is recorded and untrusted', () => {
    const d = assessIdentityDiscovery({ claims: [
      claim('model_number', 'BD-450', 'shop-one.example'), claim('model_number', 'bd-450', 'shop-one.example'),
    ] }, prov);
    assert.equal(d.claims.length, 1);
    assert.equal(d.claims[0].corroborated, false);
    assert.equal(d.claims[0].trusted, false);
    assert.equal(d.corroborated_count, 0);
  });

  test('IX-5d two independent domains corroborate, and STILL grant nothing', () => {
    const d = assessIdentityDiscovery({ claims: [
      claim('model_number', 'BD-450', 'shop-one.example'), claim('model_number', 'BD-450', 'shop-two.example'),
    ] }, prov);
    assert.equal(d.claims[0].corroborated, true);
    for (const c of d.claims) {
      assert.equal(c.trusted, false);
      assert.equal(c.qualification_authority, false);
      assert.equal(c.price_authority, false);
    }
    assert.equal(d.price_authority, false);
    assert.equal(d.qualification_authority, false);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.claims[0]));
  });

  test('IX-5e a claim from a page the search never reached, or with no search, is dropped', () => {
    const d = assessIdentityDiscovery({ claims: [claim('alias', 'Acme Twin', 'never-reached.example')] }, prov);
    assert.deepEqual(d.claims, []);
    assert.equal(d.dropped[0].reason, DISCOVERY_DROPPED.UNBOUND);
    const none = assessIdentityDiscovery({ claims: [claim('alias', 'Acme Twin', 'shop-one.example')] }, extractSearchProvenance([]));
    assert.deepEqual(none.claims, []);
    assert.equal(none.dropped[0].reason, DISCOVERY_DROPPED.NO_SEARCH);
  });

  test('IX-5f a value that looks like a price is not an identity', () => {
    for (const v of ['₪450', '450 ILS', '$90', 'only 300 nis', '199 ש"ח', '€80']) {
      const d = assessIdentityDiscovery({ claims: [claim('alias', v, 'shop-one.example')] }, prov);
      assert.deepEqual(d.claims, [], v);
      assert.equal(d.dropped[0].reason, DISCOVERY_DROPPED.PRICE_LIKE);
    }
  });

  test('IX-5g total: any input yields a record', () => {
    for (const bad of [undefined, null, 'x', {}, { claims: 'x' }, { claims: [null, 1, {}] }]) {
      const d = assessIdentityDiscovery(bad, prov);
      assert.deepEqual(d.claims, []);
      assert.equal(d.price_authority, false);
    }
  });

  // The end-to-end property: discovery full of prices, observations empty.
  const pipelineWith = (market) => {
    const identity = identityOf();
    const fetchImpl = async (_u, init) => {
      const n = JSON.parse(init.body)?.text?.format?.name ?? '';
      const payload = n.includes('identity') ? identity
        : n.includes('condition') ? { grade: 'Good', confidence: 0.7, observed: [], not_visible: [], authenticity_observation: 'insufficient_evidence' }
          : n.includes('market_query') ? {
            product_identity: 'Acme Barista Duo', variant: null, condition_target: 'used', geography: 'Israel',
            currency: 'ILS', market: 'second_hand', specificity: 'exact_model',
            queries: [{ purpose: P.EXACT_IDENTITY, text: 'Acme Barista Duo' }],
          } : market;
      return new Response(JSON.stringify({
        output: n.includes('market_evidence')
          ? researchOutput(market, { sources: ['https://shop-one.example/p/1', 'https://shop-two.example/x', 'https://shop-three.example/y'] })
          : [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      }), { status: 200 });
    };
    return runPhaseB({
      images: [IMG], ocrText: ['ACME', 'BARISTA DUO'], apiKey: 'k', model: 'm',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl,
    });
  };
  const smuggled = (domain, ref, price) => ({
    kind: 'model_number', value: 'BD-450', source_url: `https://${domain}/${ref}`, source_domain: domain,
    // Everything an observation has, placed where no observation belongs.
    title: 'Acme Barista Duo', observed_price: price, currency: 'ILS', listing_kind: 'used_listing',
    listing_id_or_reference: ref, match: { brand: 'Acme', model: 'Barista Duo', variant: null, confidence: 0.95 },
  });

  test('IX-5h discovery cannot reach valuation or mint market authority', async () => {
    const r = await pipelineWith({
      observations: [],
      identity_discovery: { claims: [
        smuggled('shop-one.example', 'a', 480), smuggled('shop-two.example', 'b', 520), smuggled('shop-three.example', 'c', 560),
      ] },
      search_performed: true, notes: null,
    });
    const me = r.market_evidence;
    assert.equal(me.identity_discovery.claims[0].value, 'BD-450', 'the identity is recorded');
    assert.equal(me.identity_discovery.claims[0].corroborated, true);
    assert.ok(!JSON.stringify(me.identity_discovery).includes('observed_price'), 'a price survived inside discovery');
    assert.equal(me.counts.returned, 0);
    assert.equal(me.counts.accepted, 0);
    assert.equal(me.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
    assert.equal(me.diagnostics.FINAL_MARKET_AUTHORITY, 'NONE');
    assert.equal(r.valuation_candidate.status, 'PENDING_MARKET');
    assert.deepEqual([r.valuation_candidate.low, r.valuation_candidate.mid, r.valuation_candidate.high], [null, null, null]);
    assert.equal(r.validation.market_evidence, null);
  });

  test('IX-5i a discovered model number is not an identity token for qualification', async () => {
    // Three real, bound, ILS listings on three domains — titled ONLY by the
    // discovered identifier. Discovery corroborates "BD-450". Qualification
    // must still ask for the model Phase B established, and refuse.
    const byNumber = (domain, ref, price) => ({
      source: `https://${domain}/${ref}`, source_domain: domain, listing_id_or_reference: ref,
      title: 'Acme BD-450', observed_price: price, currency: 'ILS', condition: 'used', location: null,
      observed_at: null, listing_kind: 'used_listing',
      match: { brand: 'Acme', model: 'BD-450', variant: null, confidence: 0.9 },
    });
    const r = await pipelineWith({
      observations: [byNumber('shop-one.example', 'p/1', 480), byNumber('shop-two.example', 'x', 520), byNumber('shop-three.example', 'y', 560)],
      identity_discovery: { claims: [
        { kind: 'model_number', value: 'BD-450', source_url: 'https://shop-one.example/p/1', source_domain: 'shop-one.example' },
        { kind: 'model_number', value: 'BD-450', source_url: 'https://shop-two.example/x', source_domain: 'shop-two.example' },
      ] },
      search_performed: true, notes: null,
    });
    assert.equal(r.market_evidence.identity_discovery.claims[0].corroborated, true);
    assert.equal(r.validation.market_evidence.qualified, false);
    assert.equal(r.validation.market_evidence.admitted, 0);
    assert.ok(r.validation.market_evidence.disqualified.every((d) => d.reason === 'no_distinctive_model_token_in_listing'));
    assert.equal(r.market_evidence.diagnostics.FINAL_MARKET_AUTHORITY, 'NONE');
  });

  test('IX-5j no evidence gate is ever handed the discovery or the context', () => {
    const src = read('api/_lib/phaseb/pipeline.js');
    for (const call of ['normalizeObservations(', 'qualifyMarketEvidence({', 'computeValuationCandidate({', 'applyGuard({']) {
      const at = src.indexOf(call);
      assert.ok(at > 0, call);
      const args = src.slice(at, src.indexOf(');', at));
      assert.ok(!/identity_discovery|identityContext|identity_context/.test(args), `${call} receives identity expansion`);
    }
    const gate = read('api/_lib/market-evidence.js');
    assert.ok(!/identity_discovery|identity-expansion|known_aliases/.test(gate), 'the evidence engine knows about discovery');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-6 · NOTHING IS WRITTEN FOR ONE PRODUCT
// ════════════════════════════════════════════════════════════════════════════
describe('IX-6 no product, identifier or marketplace is hardcoded', () => {
  test('IX-6a the expansion module and the market prompts name no product', () => {
    const FORBIDDEN = /ninja|logitech|tb301|tb401|blendsense|superlight|yad2|zap\.co|facebook|ebay|ksp|amazon/i;
    assert.ok(!FORBIDDEN.test(read('api/_lib/phaseb/identity-expansion.js')));
    for (const prompt of [
      buildMarketQueryPrompt({ identity: null, context: buildIdentityContext({}) }),
      buildMarketEvidencePrompt({ query: {}, context: buildIdentityContext({}) }),
    ]) {
      // `יד2` is a phrase meaning second-hand, supplied by the region table.
      assert.ok(!FORBIDDEN.test(prompt.replace(/יד2/g, '')), FORBIDDEN.exec(prompt)?.[0]);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-7 · THE LOCAL QUERY BUILDER
//
// Not wired into the pipeline. These hold what it would be held to if it were.
// ════════════════════════════════════════════════════════════════════════════
describe('IX-7 a plan assembled from fields obeys the same rules as a written one', () => {
  const IL = resolveMarketRegion();
  const plan = (ctx, market = IL) => planSearch(buildLocalQuery(ctx, market), ctx, { identity: null });
  const named = buildIdentityContext({ identity: identityOf() });
  const numbered = buildIdentityContext({
    identity: identityOf({ identifiers: { model_number: 'BD-450' } }), existingRecognition: { full_name_hebrew: 'אקמה בריסטה' },
  });
  const shelf = buildIdentityContext({ identity: SHELF });

  test('IX-7a one query per purpose, five at most, and only where evidence exists', () => {
    assert.deepEqual(plan(named).queries.map((q) => q.purpose), [P.EXACT_IDENTITY, P.LOCAL_SECOND_HAND, P.GENERIC_COMPARABLE]);
    const all = plan(numbered);
    assert.deepEqual(all.queries.map((q) => q.purpose),
      [P.EXACT_IDENTITY, P.MODEL_NUMBER, P.LOCAL_SECOND_HAND, P.ALIAS_OR_REGIONAL, P.GENERIC_COMPARABLE]);
    assert.ok(all.queries.length <= MAX_QUERIES);
    assert.deepEqual(all.queries_dropped, [], 'the builder proposes nothing the server has to remove');
    assert.ok(all.queries.find((q) => q.purpose === P.MODEL_NUMBER).text.includes('BD-450'));
  });

  test('IX-7b an object with no brand is searched by what it looks like', () => {
    const r = plan(shelf);
    assert.deepEqual(r.queries.map((q) => q.purpose), [P.LOCAL_SECOND_HAND, P.GENERIC_COMPARABLE]);
    assert.equal(r.specificity, 'category_only');
    const generic = r.queries.find((q) => q.purpose === P.GENERIC_COMPARABLE).text;
    for (const word of ['wooden shelf', 'oak', 'brown', 'rustic']) assert.ok(generic.includes(word), word);
  });

  test('IX-7c the local vocabulary comes from the market handed in', () => {
    const elsewhere = { ...MARKET_REGIONS.IL, id: 'XX', name: 'Elsewhere', currency: 'GBP', terms: { second_hand: 'second hand', for_sale: 'for sale', price: 'price' } };
    const r = plan(named, elsewhere);
    assert.equal(r.geography, 'Elsewhere');
    assert.equal(r.currency, 'GBP');
    assert.ok(r.queries.every((q) => !/[֐-׿]/.test(q.text)), 'a Hebrew word reached another market’s query');
    assert.ok(r.queries.some((q) => q.text.includes('second hand')));
    const src = read('api/_lib/phaseb/identity-expansion.js');
    assert.ok(!/[֐-׿]/.test(src.split('export function buildLocalQuery')[1].split('\n}\n')[0]),
      'the builder itself holds no word of any language');
  });

  test('IX-7d specificity is what the identity supports', () => {
    assert.equal(localSpecificity(named), 'exact_model');
    assert.equal(localSpecificity({ brand: 'Acme', family: 'Barista' }), 'family');
    assert.equal(localSpecificity({ brand: 'Acme', object_class: 'espresso machine' }), 'brand_category');
    assert.equal(localSpecificity({ object_class: 'shelf' }), 'category_only');
    assert.equal(localSpecificity(null), 'category_only');
  });

  test('IX-7e a disputed model is absent from a built plan too', () => {
    const r = planSearch(buildLocalQuery(named, IL), named, { disputed: true, identity: identityOf() });
    assert.equal(r.specificity, 'brand_category');
    assert.ok(r.queries.every((q) => !/barista duo/i.test(q.text)));
    assert.deepEqual(r.queries.map((q) => q.purpose), [P.GENERIC_COMPARABLE]);
  });

  test('IX-7f it is deterministic, and it is fast', () => {
    assert.deepEqual(plan(numbered), plan(numbered));
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i += 1) plan(numbered);
    const each = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    assert.ok(each < 10, `${each.toFixed(3)}ms per plan; the target is under 10ms`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// IX-8 · WHICH PLANNER RUNS
//
// Decided from the identity that already exists. No call is made to choose.
// ════════════════════════════════════════════════════════════════════════════
describe('IX-8 a strong branded identity is planned locally; everything else is not', () => {
  const IL = resolveMarketRegion();
  const named = buildIdentityContext({ identity: identityOf() });

  test('IX-8a brand and model established: local', () => {
    const plan = localPlanFor(named, IL, { identity: identityOf() });
    assert.equal(plan.planner, 'local');
    assert.equal(plan.specificity, 'exact_model');
    assert.ok(plan.queries.length >= 2 && plan.queries.length <= MAX_QUERIES);
  });

  test('IX-8b everything else keeps the provider’s planner', () => {
    const cases = {
      'no brand (a generic object)': buildIdentityContext({ identity: SHELF }),
      'brand without a model': buildIdentityContext({ identity: identityOf({ model: null, product_name: null, family: null }) }),
      'brand and family only': buildIdentityContext({ identity: identityOf({ model: null }) }),
      'nothing at all': buildIdentityContext({}),
    };
    for (const [name, ctx] of Object.entries(cases)) assert.equal(localPlanFor(ctx, IL), null, name);
    assert.equal(localPlanFor(named, IL, { disputed: true }), null, 'a disputed model may not be named');
    assert.equal(localPlanFor(named, IL, { planner: QUERY_PLANNER.MODEL }), null, 'forced');
    assert.equal(localPlanFor(named, { ...IL, terms: undefined }), null, 'a market with no vocabulary');
    assert.equal(localPlanFor(null, IL), null);
  });

  // One provider for the whole pipeline, counting what it is asked.
  const counting = (identity) => {
    const asked = [];
    const fetchImpl = async (_u, init) => {
      const body = JSON.parse(init.body);
      const n = body?.text?.format?.name ?? '';
      asked.push(n);
      const market = { observations: [], identity_discovery: { claims: [] }, search_performed: true, notes: null };
      const payload = n.includes('identity') ? identity
        : n.includes('condition') ? { grade: 'Good', confidence: 0.7, observed: [], not_visible: [], authenticity_observation: 'insufficient_evidence' }
          : n.includes('market_query') ? {
            product_identity: 'x', variant: null, condition_target: 'used', geography: 'Israel', currency: 'ILS',
            market: 'second_hand', specificity: 'category_only',
            queries: [{ purpose: P.GENERIC_COMPARABLE, text: 'written by the model' }],
          } : market;
      return new Response(JSON.stringify({
        output: n.includes('market_evidence') ? researchOutput(market)
          : [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      }), { status: 200 });
    };
    return { asked, fetchImpl };
  };
  const scan = (identity, ocr, extra = {}) => {
    const c = counting(identity);
    return runPhaseB({
      images: [IMG], ocrText: ocr, apiKey: 'k', model: 'm',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl: c.fetchImpl, ...extra,
    }).then((r) => ({ r, asked: c.asked }));
  };

  test('IX-8c a branded scan makes no query call, and still researches', async () => {
    const { r, asked } = await scan(identityOf(), ['ACME', 'BARISTA DUO']);
    assert.ok(!asked.some((n) => n.includes('market_query')), 'the query stage called the provider');
    assert.ok(asked.some((n) => n.includes('market_evidence')), 'the research stage did not run');
    assert.equal(r.model_metadata.calls.attempts, 3);
    assert.equal(r.market_evidence.query.planner, 'local');
    assert.deepEqual(r.market_evidence.query.queries.map((q) => q.purpose),
      [P.EXACT_IDENTITY, P.LOCAL_SECOND_HAND, P.GENERIC_COMPARABLE]);
    assert.ok(r.timings.market_query_ms < 50, `${r.timings.market_query_ms}ms for a local plan`);
  });

  test('IX-8d a generic scan still asks the provider for its plan', async () => {
    const { r, asked } = await scan(SHELF, []);
    assert.ok(asked.some((n) => n.includes('market_query')));
    assert.equal(r.model_metadata.calls.attempts, 4);
    assert.equal(r.market_evidence.query.planner, undefined);
    assert.deepEqual(r.market_evidence.query.search_terms, ['written by the model']);
  });

  test('IX-8e a disputed identity still asks the provider, and is still capped', async () => {
    const { r, asked } = await scan(identityOf(), ['ACME'], {
      existingRecognition: { brand_candidates: [{ brand: 'Acme' }], model_candidates: [{ model: 'Roaster Nine', confidence: 0.6 }] },
    });
    assert.equal(r.identity_candidate.reconciliation.conflict, true);
    assert.ok(asked.some((n) => n.includes('market_query')));
    assert.equal(r.market_evidence.query.specificity, 'brand_category');
  });

  test('IX-8f the planner is a server decision', () => {
    const enrich = read('api/enrich.js');
    assert.ok(!/queryPlanner/.test(enrich) || !/body\??\.queryPlanner|body\??\.query_planner/.test(enrich),
      'a request field chooses the planner');
  });
});
