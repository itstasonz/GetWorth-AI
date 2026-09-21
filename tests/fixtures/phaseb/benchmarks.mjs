// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — THE FIVE BENCHMARK FIXTURES (§31–§35)
//
// Each fixture is a MOCKED OpenAI response set, not a live call. §30 requires
// that no automated test spend credits, so these describe what a competent
// model would plausibly return for each scan and let the deterministic layers —
// normalisation, filtering, valuation, guard — be measured against it.
//
// ── WHAT A BENCHMARK FIXTURE CAN AND CANNOT PROVE ──────────────────────────
//
// It CAN prove: that the pipeline wires together; that the filters reject what
// they claim to; that the guard is applied; that PENDING_MARKET happens when
// evidence is thin; that an accessory reference does not become a subject.
//
// It CANNOT prove that the real model identifies a real Ninja. That question is
// answerable only by the live benchmark, and §36 asks for the comparison
// explicitly. These fixtures are the harness for that comparison, not a
// substitute for it — writing them as if they were would be the "fixture that
// describes a shape production cannot emit" defect this repo recorded in
// round 4, where a correct module was inert in production and every test
// passed.
// ══════════════════════════════════════════════════════════════════════════════

/** A minimal valid JPEG header, same shape the Phase-A harness uses. */
export const IMG = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46,
    0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]),
  Buffer.alloc(64, 0x20),
]).toString('base64');

const ident = ({
  object_class = null, category = null, brand = null, product_name = null,
  family = null, model = null, variant = null, identifiers = {},
  overall = 0.5, objConf = 0.5, brandConf = 0.5, modelConf = 0.5, variantConf = 0,
  evidence = [], references = [], ambiguities = [], alternatives = [],
}) => ({
  subject: {
    object_class, category_candidate: category, brand, product_name, family, model, variant,
    identifiers: {
      mpn: identifiers.mpn ?? null, sku: identifiers.sku ?? null,
      model_number: identifiers.model_number ?? null, serial_visible: identifiers.serial_visible ?? null,
    },
  },
  confidence: { overall, object_class: objConf, brand: brandConf, model: modelConf, variant: variantConf },
  evidence, references, ambiguities, alternatives,
});

const obs = ({
  domain, ref = null, title, price, currency = 'ILS', kind = 'used_listing',
  matchConf = 0.9, brand = null, model = null, variant = null, condition = 'Good', location = 'Tel Aviv',
}) => ({
  source: domain, source_domain: domain, listing_id_or_reference: ref, title,
  observed_price: price, currency, condition, location, observed_at: '2026-09-01',
  listing_kind: kind, match: { brand, model, variant, confidence: matchConf },
});

// ── §31 NINJA — the regression that motivated Phase B ───────────────────────
//
// Phase A returns IDENTIFIED / PENDING_MARKET / 0-0-0: it recognises the
// product and has no market evidence to price it with. The Phase-B question is
// whether the market stage can supply what Phase A lacks WITHOUT inventing it.
export const NINJA = {
  name: 'NINJA',
  phaseA: { identity: 'Ninja Detect Power Blender Pro', verdict: 'IDENTIFIED', valuation: 'PENDING_MARKET', price: '0/0/0' },
  ocr: ['NINJA', 'DETECT POWER BLENDER PRO', 'BLENDSENSE', '1200W'],
  recognition: {
    category: 'Home', subcategory: 'blender', product_type: 'blender', category_confidence: 0.9,
    brand_candidates: [{ brand: 'Ninja', confidence: 0.9 }],
    model_candidates: [{ model: 'Detect Power Blender Pro', confidence: 0.85 }],
    ocr_text: { raw_texts: ['NINJA', 'DETECT POWER BLENDER PRO'] },
  },
  identity: ident({
    object_class: 'blender', category: 'Home', brand: 'Ninja',
    product_name: 'Ninja Detect Power Blender Pro', family: 'Detect', model: 'Detect Power Blender Pro',
    identifiers: { model_number: 'TB401EU' },
    overall: 0.88, objConf: 0.97, brandConf: 0.95, modelConf: 0.82,
    evidence: [
      { type: 'visible_text', value: 'NINJA', source: 'image', confidence: 0.96 },
      { type: 'visible_text', value: 'DETECT POWER BLENDER PRO', source: 'image', confidence: 0.9 },
      { type: 'shape', value: 'countertop blender with pitcher', source: 'image', confidence: 0.95 },
    ],
    ambiguities: ['exact regional SKU not visible'],
  }),
  condition: {
    grade: 'Good', confidence: 0.7,
    observed: [{ signal: 'wear', detail: 'light scuffing on base' }, { signal: 'clean', detail: null }],
    not_visible: ['internal_function', 'usage_hours'],
    authenticity_observation: 'no_obvious_visual_inconsistency',
  },
  query: {
    product_identity: 'Ninja Detect Power Blender Pro', variant: null, condition_target: 'used',
    geography: 'Israel', currency: 'ILS', market: 'second_hand',
    search_terms: ['ניניה בלנדר', 'Ninja Detect Power Blender Pro יד שניה'], specificity: 'exact_model',
  },
  market: {
    search_performed: true, notes: null,
    observations: [
      obs({ domain: 'yad2.co.il', ref: 'y-1', title: 'Ninja Detect Power Blender Pro', price: 620, brand: 'Ninja', model: 'Detect Power Blender Pro' }),
      obs({ domain: 'yad2.co.il', ref: 'y-2', title: 'בלנדר נינג׳ה Detect Pro', price: 700, brand: 'Ninja', model: 'Detect Power Blender Pro' }),
      obs({ domain: 'facebook.com', ref: 'f-1', title: 'Ninja Detect blender', price: 550, brand: 'Ninja', model: 'Detect Power Blender Pro' }),
      obs({ domain: 'yad2.co.il', ref: 'y-3', title: 'Ninja Detect Power Blender Pro כמו חדש', price: 800, brand: 'Ninja', model: 'Detect Power Blender Pro' }),
      // Must be REJECTED: a new-retail listing is not used-market evidence.
      obs({ domain: 'ksp.co.il', ref: 'k-1', title: 'Ninja Detect Power Blender Pro חדש', price: 1299, kind: 'new_retail', brand: 'Ninja', model: 'Detect Power Blender Pro' }),
      // Must be REJECTED: an accessory, not the product.
      obs({ domain: 'yad2.co.il', ref: 'y-4', title: 'כד רזרבי לנינג׳ה', price: 90, kind: 'accessory', brand: 'Ninja', model: 'pitcher' }),
      // Must be CONTEXT ONLY: foreign currency, no verified FX in this phase.
      obs({ domain: 'ebay.com', ref: 'e-1', title: 'Ninja Detect Power Blender Pro', price: 149, currency: 'USD', brand: 'Ninja', model: 'Detect Power Blender Pro', location: 'US' }),
      // Must be REJECTED: duplicate of y-1.
      obs({ domain: 'yad2.co.il', ref: 'y-1', title: 'Ninja Detect Power Blender Pro', price: 620, brand: 'Ninja', model: 'Detect Power Blender Pro' }),
    ],
  },
};

// ── §32 LOGITECH — must not get WORSE ──────────────────────────────────────
export const LOGITECH = {
  name: 'LOGITECH',
  phaseA: { identity: 'Logitech G Pro X Superlight', verdict: 'IDENTIFIED', valuation: 'PENDING_MARKET', price: '0/0/0' },
  ocr: ['LOGITECH', 'G PRO X SUPERLIGHT'],
  recognition: {
    category: 'Electronics', subcategory: 'gaming mouse', product_type: 'mouse', category_confidence: 0.95,
    brand_candidates: [{ brand: 'Logitech', confidence: 0.95 }],
    model_candidates: [{ model: 'G Pro X Superlight', confidence: 0.9 }],
    ocr_text: { raw_texts: ['LOGITECH', 'G PRO X SUPERLIGHT'] },
  },
  identity: ident({
    object_class: 'gaming mouse', category: 'Electronics', brand: 'Logitech',
    product_name: 'Logitech G Pro X Superlight', family: 'G Pro', model: 'G Pro X Superlight',
    variant: 'white', overall: 0.93, objConf: 0.98, brandConf: 0.97, modelConf: 0.92, variantConf: 0.8,
    evidence: [
      { type: 'visible_text', value: 'G PRO X SUPERLIGHT', source: 'image', confidence: 0.95 },
      { type: 'logo', value: 'Logitech G', source: 'image', confidence: 0.93 },
    ],
  }),
  condition: {
    grade: 'Like New', confidence: 0.8,
    observed: [{ signal: 'clean', detail: 'no visible wear' }, { signal: 'box_present', detail: 'retail box in frame' }],
    not_visible: ['internal_function', 'battery_health'],
    authenticity_observation: 'no_obvious_visual_inconsistency',
  },
  query: {
    product_identity: 'Logitech G Pro X Superlight', variant: 'white', condition_target: 'used',
    geography: 'Israel', currency: 'ILS', market: 'second_hand',
    search_terms: ['Logitech G Pro X Superlight יד שניה'], specificity: 'exact_model',
  },
  market: {
    search_performed: true, notes: null,
    observations: [
      obs({ domain: 'yad2.co.il', ref: 'l-1', title: 'G Pro X Superlight לבן', price: 340, brand: 'Logitech', model: 'G Pro X Superlight' }),
      obs({ domain: 'yad2.co.il', ref: 'l-2', title: 'Logitech G Pro X Superlight', price: 380, brand: 'Logitech', model: 'G Pro X Superlight' }),
      obs({ domain: 'facebook.com', ref: 'l-3', title: 'עכבר גיימינג Logitech Superlight', price: 300, brand: 'Logitech', model: 'G Pro X Superlight' }),
      obs({ domain: 'yad2.co.il', ref: 'l-4', title: 'G Pro X Superlight כמו חדש', price: 420, brand: 'Logitech', model: 'G Pro X Superlight' }),
      // Must be REJECTED: a different model in the same family.
      obs({ domain: 'yad2.co.il', ref: 'l-5', title: 'Logitech G305', price: 120, matchConf: 0.2, brand: 'Logitech', model: 'G305' }),
    ],
  },
};

// ── §33 LG — family known, exact model NOT established ─────────────────────
//
// The honest answer here is BRAND_ONLY/family. §33: "Do not invent an LG
// model", and market research "must not pretend generic LG-monitor comps are
// exact model comps". The fixture therefore returns a null model and a
// `family` specificity, and the test asserts the pipeline does not upgrade it.
export const LG = {
  name: 'LG',
  phaseA: { identity: 'LG (monitor)', verdict: 'IDENTIFIED', valuation: 'PENDING_MARKET', price: '0/0/0' },
  ocr: ['LG'],
  recognition: {
    category: 'Electronics', subcategory: 'monitor', product_type: 'monitor', category_confidence: 0.92,
    brand_candidates: [{ brand: 'LG', confidence: 0.9 }],
    model_candidates: [],
    ocr_text: { raw_texts: ['LG'] },
  },
  identity: ident({
    object_class: 'monitor', category: 'Electronics', brand: 'LG',
    product_name: 'LG monitor', family: null, model: null,
    overall: 0.55, objConf: 0.95, brandConf: 0.9, modelConf: 0.1,
    evidence: [
      { type: 'logo', value: 'LG', source: 'image', confidence: 0.9 },
      { type: 'shape', value: 'flat panel monitor, thin bezel', source: 'image', confidence: 0.94 },
    ],
    ambiguities: ['model plate not visible', 'panel size not measurable from image'],
    alternatives: [
      { brand: 'LG', model: '27GP850', why: 'bezel and stand resemble UltraGear', confidence: 0.25 },
      { brand: 'LG', model: '24MK600', why: 'similar proportions', confidence: 0.2 },
    ],
  }),
  condition: {
    grade: 'Good', confidence: 0.6,
    observed: [{ signal: 'clean', detail: null }],
    not_visible: ['screen_when_on', 'internal_function'],
    authenticity_observation: 'insufficient_evidence',
  },
  query: {
    product_identity: 'LG monitor', variant: null, condition_target: 'used',
    geography: 'Israel', currency: 'ILS', market: 'second_hand',
    search_terms: ['מסך LG יד שניה'], specificity: 'brand_category',
  },
  market: {
    search_performed: true, notes: 'generic brand-level results only',
    observations: [
      // Deliberately LOW match confidence: these are LG monitors, not THIS one.
      obs({ domain: 'yad2.co.il', ref: 'g-1', title: 'מסך LG 27', price: 450, matchConf: 0.35, brand: 'LG', model: null }),
      obs({ domain: 'yad2.co.il', ref: 'g-2', title: 'מסך LG 24', price: 300, matchConf: 0.3, brand: 'LG', model: null }),
      obs({ domain: 'facebook.com', ref: 'g-3', title: 'LG monitor', price: 380, matchConf: 0.3, brand: 'LG', model: null }),
    ],
  },
};

// ── §34 LOUIS VUITTON — market vs a too-tight envelope ─────────────────────
//
// §34: the beauty envelope is known to be too tight for luxury fragrance, and
// this phase must NOT widen it. The value of this benchmark is that it should
// produce a market picture that CONFLICTS with the guard — and that the
// conflict is recorded rather than resolved by changing calibration.
export const LOUIS_VUITTON = {
  name: 'LOUIS_VUITTON',
  phaseA: { identity: 'Louis Vuitton Imagination', verdict: 'IDENTIFIED', valuation: 'PENDING_MARKET', price: '0/0/0' },
  ocr: ['LOUIS VUITTON', 'IMAGINATION', 'EAU DE PARFUM', '100ml'],
  recognition: {
    category: 'Beauty', subcategory: 'fragrance', product_type: 'perfume', category_confidence: 0.93,
    brand_candidates: [{ brand: 'Louis Vuitton', confidence: 0.95 }],
    model_candidates: [{ model: 'Imagination', confidence: 0.9 }],
    ocr_text: { raw_texts: ['LOUIS VUITTON', 'IMAGINATION'] },
  },
  identity: ident({
    object_class: 'perfume', category: 'Beauty', brand: 'Louis Vuitton',
    product_name: 'Louis Vuitton Imagination', family: 'Imagination', model: 'Imagination',
    variant: '100ml', overall: 0.9, objConf: 0.96, brandConf: 0.95, modelConf: 0.9, variantConf: 0.85,
    evidence: [
      { type: 'visible_text', value: 'LOUIS VUITTON', source: 'image', confidence: 0.96 },
      { type: 'visible_text', value: 'IMAGINATION', source: 'image', confidence: 0.94 },
      { type: 'visible_text', value: '100ml', source: 'image', confidence: 0.85 },
    ],
  }),
  condition: {
    grade: 'Like New', confidence: 0.75,
    observed: [{ signal: 'box_present', detail: 'original box' }, { signal: 'clean', detail: null }],
    not_visible: ['authenticity'],
    authenticity_observation: 'verification_recommended',
  },
  query: {
    product_identity: 'Louis Vuitton Imagination 100ml', variant: '100ml', condition_target: 'used',
    geography: 'Israel', currency: 'ILS', market: 'second_hand',
    search_terms: ['Louis Vuitton Imagination בושם'], specificity: 'exact_model',
  },
  market: {
    search_performed: true, notes: null,
    observations: [
      obs({ domain: 'yad2.co.il', ref: 'v-1', title: 'Louis Vuitton Imagination 100ml', price: 1100, brand: 'Louis Vuitton', model: 'Imagination', variant: '100ml' }),
      obs({ domain: 'facebook.com', ref: 'v-2', title: 'בושם LV Imagination', price: 1250, brand: 'Louis Vuitton', model: 'Imagination', variant: '100ml' }),
      obs({ domain: 'yad2.co.il', ref: 'v-3', title: 'LV Imagination EDP', price: 980, brand: 'Louis Vuitton', model: 'Imagination', variant: '100ml' }),
      obs({ domain: 'yad2.co.il', ref: 'v-4', title: 'Imagination Louis Vuitton 100ml', price: 1400, brand: 'Louis Vuitton', model: 'Imagination', variant: '100ml' }),
    ],
  },
};

// ── §35 UNKNOWN — the negative control ─────────────────────────────────────
//
// The expected behaviour is NOT that OpenAI identifies it. It is that a thin
// answer stays thin: no invented model, no fabricated comps, no price.
export const UNKNOWN = {
  name: 'UNKNOWN',
  phaseA: { identity: 'unidentified', verdict: 'UNKNOWN', valuation: 'MANUAL', price: '0/0/0' },
  ocr: [],
  recognition: {
    category: 'Other', subcategory: '', product_type: '', category_confidence: 0.2,
    brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: [] },
  },
  identity: ident({
    object_class: 'unidentified plastic object', category: null, brand: null,
    product_name: null, family: null, model: null,
    overall: 0.15, objConf: 0.3, brandConf: 0, modelConf: 0,
    evidence: [{ type: 'shape', value: 'small moulded object, no markings', source: 'image', confidence: 0.3 }],
    ambiguities: ['no visible branding', 'no readable text', 'scale unclear'],
  }),
  condition: {
    grade: 'Unknown', confidence: 0.2,
    observed: [], not_visible: ['internal_function', 'authenticity', 'included_accessories'],
    authenticity_observation: 'insufficient_evidence',
  },
  query: null,
  market: { search_performed: false, notes: 'no identity to search', observations: [] },
};

// ── THE ACCESSORY CONTROL — not one of the five, and load-bearing ──────────
//
// §31: the Ninja benchmark "must NOT use reference/accessory text to fabricate
// a Ninja host product". This is that case as its own fixture: a replacement
// blade whose packaging names the blender. Phase B must keep the blade as the
// subject and the blender as a reference, and the market stage must not run on
// the host.
export const NINJA_BLADE_ACCESSORY = {
  name: 'NINJA_BLADE_ACCESSORY',
  phaseA: { identity: 'unidentified (accessory)', verdict: 'UNKNOWN', valuation: 'MANUAL', price: '0/0/0' },
  ocr: ['Replacement Blade', 'For NINJA', 'POWER BLENDER'],
  recognition: {
    category: 'Home', subcategory: 'blender blade', product_type: 'blade', category_confidence: 0.6,
    brand_candidates: [], model_candidates: [], ocr_text: { raw_texts: ['Replacement Blade', 'For NINJA'] },
  },
  // THE ATTACK: the model has promoted the referenced host into the subject.
  // Phase B's own corroboration must refuse it, using the same block rule the
  // Phase-A path uses.
  identity: ident({
    object_class: 'blender', category: 'Home', brand: 'Ninja',
    product_name: 'Ninja Power Blender', family: 'Power', model: 'Power Blender',
    overall: 0.7, objConf: 0.6, brandConf: 0.8, modelConf: 0.6,
    evidence: [{ type: 'visible_text', value: 'NINJA', source: 'ocr', confidence: 0.8 }],
    references: [],
  }),
  condition: { grade: 'Good', confidence: 0.5, observed: [], not_visible: [], authenticity_observation: 'insufficient_evidence' },
  query: null,
  market: { search_performed: false, notes: null, observations: [] },
};

export const ALL_BENCHMARKS = [NINJA, LOGITECH, LG, LOUIS_VUITTON, UNKNOWN];

/**
 * A `fetchImpl` that answers each Phase-B stage from a fixture.
 *
 * Routes on the schema NAME in the request body, so the mock cannot silently
 * answer the wrong stage — a mock that returns identity data to the condition
 * stage would produce a green test about nothing.
 */
export function mockOpenAI(fixture, { fail = null, malformed = false, refusal = false } = {}) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const schemaName = body?.text?.format?.name ?? '';
    if (fail) return fail;

    const payload = schemaName.includes('identity') ? fixture.identity
      : schemaName.includes('condition') ? fixture.condition
      : schemaName.includes('market_query') ? fixture.query
      : schemaName.includes('market_evidence') ? fixture.market
      : null;

    if (payload === null) {
      return new Response(JSON.stringify({ output: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (refusal) {
      return new Response(JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const text = malformed ? '{not json' : JSON.stringify(payload);
    return new Response(JSON.stringify({
      model: body.model,
      usage: { input_tokens: 800, output_tokens: 300 },
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
