// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — STRUCTURED OUTPUT SCHEMAS
//
// §6 forbids parsing an unconstrained prose answer into trusted fields, so
// every stage that asks OpenAI a question asks it with a strict json_schema.
//
// ── STRICT MODE HAS TWO RULES THAT SHAPE EVERY SCHEMA BELOW ─────────────────
//
// OpenAI strict structured output requires `additionalProperties: false` on
// every object AND requires `required` to list EVERY property. There is no
// optional key. So "missing information = null" (§10) is expressed as a
// nullable TYPE — `['string','null']` — rather than by omitting the field.
//
// That distinction matters beyond syntax. A field that can be omitted lets a
// model quietly skip the question; a field that must be present and may be
// null forces it to answer "I do not know" explicitly. §10's "do not
// hallucinate required strings" is only enforceable in the second shape.
//
// ── CONFIDENCE IS BOUNDED, AND IT IS STILL ONLY A CLAIM ─────────────────────
//
// Every confidence here is `number` with 0..1 bounds, because §10 requires it
// numeric and bounded. Bounds make it PARSEABLE; they do not make it true.
// §11 is the load-bearing rule — a model writing 0.99 does not make an
// identity trusted — and it is enforced downstream in validation.js, not here.
// The schema's job is only to stop a percent-scale or a prose confidence from
// entering the pipeline, which is the exact defect `confidence()` in
// api/_lib/pricing-authority.js exists to catch on the Phase-A side.
// ══════════════════════════════════════════════════════════════════════════════

const nullableString = { type: ['string', 'null'] };
const confidence01 = { type: 'number', minimum: 0, maximum: 1 };

/** Every object in a strict schema must forbid extras and require all keys. */
const strictObject = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

// ── B2 · STRUCTURED IDENTITY CANDIDATE (§10) ────────────────────────────────
export const IDENTITY_SCHEMA = strictObject({
  subject: strictObject({
    object_class: nullableString,
    category_candidate: nullableString,
    brand: nullableString,
    product_name: nullableString,
    family: nullableString,
    model: nullableString,
    variant: nullableString,
    identifiers: strictObject({
      mpn: nullableString,
      sku: nullableString,
      model_number: nullableString,
      serial_visible: nullableString,
    }),
  }),
  confidence: strictObject({
    overall: confidence01,
    object_class: confidence01,
    brand: confidence01,
    model: confidence01,
    variant: confidence01,
  }),
  // What the model says it SAW. `source` is constrained to an enum so a model
  // cannot invent a provenance label — the Phase-A lesson that a free-form
  // `evidence` string inverts under relabelling (see the withdrawn rule in
  // api/_lib/pricing-authority.js) applies here with more force, because this
  // list is what validation reads to decide whether the subject was read or
  // asserted.
  evidence: {
    type: 'array',
    maxItems: 24,
    items: strictObject({
      type: { type: 'string', enum: ['visible_text', 'logo', 'shape', 'packaging', 'label', 'inference'] },
      value: { type: 'string' },
      source: { type: 'string', enum: ['image', 'ocr', 'existing_recognition'] },
      confidence: confidence01,
    }),
  },
  // §9's subject/reference separation, in the model's own output. A host
  // product named on accessory packaging belongs HERE, never in `subject`.
  references: {
    type: 'array',
    maxItems: 12,
    items: strictObject({
      relation: {
        type: 'string',
        enum: ['compatible_with', 'replacement_for', 'accessory_for', 'packaging_reference', 'background_object'],
      },
      brand: nullableString,
      product: nullableString,
      model: nullableString,
    }),
  },
  ambiguities: { type: 'array', maxItems: 12, items: { type: 'string' } },
  alternatives: {
    type: 'array',
    maxItems: 6,
    items: strictObject({
      brand: nullableString,
      model: nullableString,
      why: nullableString,
      confidence: confidence01,
    }),
  },
});

// ── B3 · MARKET QUERY INTENT (§13) ──────────────────────────────────────────
//
// A STRUCTURED INTENT, never a URL. §13 and §40 both forbid letting the model
// construct a fetch target the server then requests, so there is no `url` field
// here and no way to express one.
export const MARKET_QUERY_SCHEMA = strictObject({
  product_identity: { type: 'string' },
  variant: nullableString,
  condition_target: { type: 'string', enum: ['new', 'used', 'any'] },
  geography: { type: 'string' },
  currency: { type: 'string' },
  market: { type: 'string', enum: ['second_hand', 'retail', 'any'] },
  search_terms: { type: 'array', maxItems: 6, items: { type: 'string' } },
  specificity: {
    type: 'string',
    // §31/§33: when the exact model is not established, say so, and search at
    // the level the evidence actually supports rather than faking exactness.
    enum: ['exact_model', 'family', 'brand_category', 'category_only'],
  },
});

// ── B4 · MARKET OBSERVATIONS (§15) ──────────────────────────────────────────
//
// Currency is REQUIRED and has no default. §15 and §17 are emphatic: never
// treat $500 as ₪500. A model that cannot tell the currency must say null, and
// normalisation then excludes the observation rather than guessing.
export const MARKET_EVIDENCE_SCHEMA = strictObject({
  observations: {
    type: 'array',
    maxItems: 40,
    items: strictObject({
      source: nullableString,
      source_domain: nullableString,
      listing_id_or_reference: nullableString,
      title: nullableString,
      observed_price: { type: ['number', 'null'] },
      currency: nullableString,
      condition: nullableString,
      location: nullableString,
      observed_at: nullableString,
      listing_kind: {
        type: 'string',
        enum: ['used_listing', 'new_retail', 'parts_only', 'broken', 'accessory', 'unknown'],
      },
      match: strictObject({
        brand: nullableString,
        model: nullableString,
        variant: nullableString,
        confidence: confidence01,
      }),
    }),
  },
  search_performed: { type: 'boolean' },
  notes: nullableString,
});

// ── B5 · CONDITION (§18) ────────────────────────────────────────────────────
//
// The grade vocabulary is GetWorth's existing one (CONDITION_LADDER in
// api/_lib/valuation-guard.js: New / Like New / Good / Fair / Poor), plus the
// two answers a photograph can legitimately give that the ladder does not
// cover: PARTS, and UNKNOWN. §18 requires "return unknown where appropriate",
// and a vocabulary with no way to say it forces a guess.
export const CONDITION_SCHEMA = strictObject({
  grade: { type: 'string', enum: ['New', 'Like New', 'Good', 'Fair', 'Poor', 'Parts', 'Unknown'] },
  confidence: confidence01,
  observed: {
    type: 'array',
    maxItems: 16,
    items: strictObject({
      signal: {
        type: 'string',
        enum: ['scratches', 'cracks', 'wear', 'missing_accessories', 'box_present', 'charger_present',
               'screen_damage', 'cosmetic_damage', 'sealed_packaging', 'discoloration', 'dents', 'clean'],
      },
      detail: nullableString,
    }),
  },
  // §18's hard rule: do not infer invisible facts. The model is asked to name
  // what it CANNOT see, which turns an omission into an explicit statement.
  not_visible: {
    type: 'array',
    maxItems: 12,
    items: {
      type: 'string',
      enum: ['battery_health', 'internal_function', 'authenticity', 'screen_when_on',
             'included_accessories', 'water_damage', 'usage_hours'],
    },
  },
  // §19: an observation, never a verdict. The enum has no value meaning
  // "authentic" — the strongest available answer is "no obvious inconsistency".
  authenticity_observation: {
    type: 'string',
    enum: ['no_obvious_visual_inconsistency', 'possible_inconsistency',
           'verification_recommended', 'insufficient_evidence'],
  },
});
