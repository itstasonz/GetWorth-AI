// ═══════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — the model CONTRACT
// ═══════════════════════════════════════════════════════════════════════════
//
// What we ask the model for, kept apart from how we call it and how we
// interpret the answer (api/_lib/openai-recognition.js). This is the file that
// changes when the identity contract or the prompt is tuned, and the one to
// diff when comparing benchmark runs — a prompt or schema edit is the most
// likely cause of an accuracy movement, so it should show up as a change to a
// small file rather than a hunk buried in transport code.
//
// The taxonomy constants are shared with the normalizer, which validates
// against them. They MUST stay in step with the Stage 1 prompt's category list
// in api/analyze.js: a category this file allows but the rest of the pipeline
// does not recognise would flow into retrieval and the envelope lookup as an
// unknown value.
// ═══════════════════════════════════════════════════════════════════════════

// REVIEW FINDING (valuation reviewer, CRITICAL). This list must cover every
// category `resolveEnvelopeKey` (api/_lib/valuation-guard.js) can match, not
// just the 14 the Stage 1 prompt happens to name.
//
// The current engine's RECOGNITION_SCHEMA types `category` as a free-form
// string, so Sonnet can return "Jewelry" even though the prompt lists 14
// buckets — and `resolveEnvelopeKey` then selects the jewelry envelope. A
// strict `enum` here is a HARD constraint, so Bags and Jewelry were being
// coerced to 'Other', which matches no matcher and falls through to
// GLOBAL_ENVELOPE. Measured on one ₪18,000 Cartier gold band:
//
//   current engine : env jewelry/manual_only → degrade → ₪0/0/0 MANUAL_REQUIRED
//   openai (before): env global/global       → accept  → ₪18,000 at MEDIUM
//
// Jewelry is one of four deliberate manual_only buckets, and bags/jewelry are
// the two highest counterfeit-risk categories — the worst possible pair to
// lose. The strictness that makes the schema reliable is exactly what turned a
// prompt suggestion into a structural gap.
//
// ANY future edit to valuation-guard's matcher list must be mirrored here.
export const CATEGORIES = [
  'Electronics', 'Furniture', 'Vehicles', 'Watches', 'Clothing', 'Sports',
  'Smoking', 'Home', 'Beauty', 'Books', 'Toys', 'Tools', 'Food',
  'Bags', 'Jewelry',
  'Other',
];

export const CONDITIONS = ['New', 'Like New', 'Good', 'Fair', 'Poor'];

// REVIEW FINDING (architecture reviewer, MEDIUM). `category_hebrew` was
// hardcoded to ''. Five consumers read it, and two of them are the DEGRADED
// paths — buildFastPathVerification and buildFallback both derive
// `final_category_hebrew` and `full_name_hebrew` from it, and
// `final_category_hebrew` is persisted. So every OpenAI scan that took the
// fast path or the Stage 2 fallback stored and rendered empty Hebrew names.
// In a Hebrew-first product that is user-visible, and it is a data-quality
// regression in the stored valuation, not only a UI one.
//
// A lookup keyed off the enum costs no output tokens and cannot drift from
// the model's answer, which is why it is here rather than a schema field.
//
// Reviewed for idiom by the architecture reviewer. Two were corrected from a
// first draft that named the ACTIVITY or the PLACE rather than the goods —
// עישון is the act of smoking and בית is a house, neither of which is a
// category of things for sale.
//
// KNOWN, NOT FIXED HERE: analyze.js feeds category_hebrew into
// `full_name_hebrew` on the fast path and the Stage 2 fallback, so a watch can
// be persisted with the item NAME "שעונים" ("Watches"). That is a pre-existing
// overload of one field for two purposes in analyze.js and affects the current
// engine identically — this frozen table makes it deterministic rather than
// introducing it. Worth its own ticket; out of scope here.
export const CATEGORY_HEBREW = Object.freeze({
  Electronics: 'אלקטרוניקה',
  Furniture:   'ריהוט',
  Vehicles:    'רכבים',
  Watches:     'שעונים',
  Clothing:    'ביגוד',
  Sports:      'ספורט',
  Smoking:     'מוצרי עישון',   // "smoking products", not עישון (the act)
  Home:        'כלי בית',       // "household goods"; bare בית reads as real-estate next to ריהוט
  Beauty:      'טיפוח ויופי',
  Books:       'ספרים',
  Toys:        'צעצועים',
  Tools:       'כלי עבודה',
  Food:        'מזון',
  Bags:        'תיקים',
  Jewelry:     'תכשיטים',
  Other:       'אחר',
});

// ═══════════════════════════════════════════════════════
// STRUCTURED OUTPUT SCHEMA
// ═══════════════════════════════════════════════════════
// Strict mode constraints, all load-bearing:
//   • every property must appear in `required`
//   • `additionalProperties: false` on every object
//   • no numeric/length keywords (minimum, maximum, maxItems) — range is
//     enforced in normalizeOpenAIRecognition() instead, which is where it
//     belongs anyway since a schema cannot police semantics.
// Optional fields are expressed as nullable unions, never as omitted keys.
export const OPENAI_IDENTITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // KEY ORDER IS LOAD-BEARING (recognition review). Structured output emits
  // keys in schema order, so the order here IS the model's generation order.
  // `visible_text` and `logos` previously came AFTER `brand` and `model`,
  // which meant the model committed to an identity and then generated the
  // text it had supposedly "read" — precisely the setup that produces an echo
  // of its own guess, which downstream stamps origin:'OCR' and treats as
  // evidence. The current engine counteracts this in prose ("EXTRACTION
  // STEPS: 1. OCR SCAN ... 4. MODEL CANDIDATES"); the short prompt here did
  // not, so nothing opposed the schema.
  //
  // Read first, decide second. Costs nothing if the ordering assumption is
  // ever wrong.
  required: [
    'object_type', 'category', 'subcategory',
    'is_packaging',
    'visible_text', 'logos',
    'brand', 'brand_confidence',
    'product_family', 'model', 'model_number', 'model_confidence',
    'visual_attributes',
    'identity_confidence', 'needs_confirmation', 'ambiguity_reason',
    'candidate_models', 'candidate_brands',
  ],
  properties: {
    object_type:  { type: 'string', description: 'Plain noun for the object, e.g. "gaming mouse". Never empty.' },
    category:     { type: 'string', enum: CATEGORIES },
    subcategory:  { type: 'string' },

    // M4 (recognition reviewer). analyze.js has a whole packaging calibration
    // branch — calibrateRecognition floors a packaging-evidence brand at
    // 0.60-0.79 — keyed on the evidence strings 'packaging_design' /
    // 'packaging_visual'. The adapter emitted neither, so that branch was dead
    // for every OpenAI scan: measured 0.72 -> 0.57 on the same retail-box
    // photo, which crosses VISION_TRIGGER_THRESHOLD and buys an extra Vision
    // call per boxed item. Retail boxes are a first-class scan type (step 0 of
    // the existing Stage 1 prompt), so this was a systematic loss, not an edge.
    is_packaging: { type: 'boolean', description: 'true when the photo shows a retail box or packaging rather than the bare item.' },

    visible_text: { type: 'array', items: { type: 'string' }, description: 'Exact strings read off the item. Empty when none.' },
    logos:        { type: 'array', items: { type: 'string' } },

    brand:            { type: ['string', 'null'], description: 'null when the brand cannot be determined. Never guess.' },
    brand_confidence: { type: 'number', description: '0..1' },

    product_family: { type: ['string', 'null'], description: 'e.g. "Logitech G-series gaming mouse" when the exact model is unknown.' },
    model:          { type: ['string', 'null'], description: 'null when the exact model cannot be determined. Never guess.' },
    model_number:   { type: ['string', 'null'], description: 'Only when physically READ off the item. Never inferred.' },

    model_confidence: { type: 'number', description: '0..1' },

    visual_attributes: {
      type: 'object',
      additionalProperties: false,
      required: ['materials', 'colors', 'finish', 'shape', 'condition'],
      properties: {
        materials: { type: 'array', items: { type: 'string' } },
        colors:    { type: 'array', items: { type: 'string' } },
        finish:    { type: ['string', 'null'] },
        shape:     { type: ['string', 'null'] },
        condition: { type: 'string', enum: CONDITIONS },
      },
    },

    identity_confidence: { type: 'number', description: '0..1 overall identity certainty.' },
    needs_confirmation:  { type: 'boolean' },
    ambiguity_reason:    { type: ['string', 'null'] },

    candidate_models: {
      type: 'array',
      description: 'Siblings that cannot be separated from this photo. Equal low confidences are correct.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['model', 'confidence'],
        properties: {
          model:      { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },

    // REVIEW FINDING (architecture reviewer, MEDIUM). Without this the adapter
    // could only ever emit ONE brand candidate, while recognize() returns up
    // to five — and `needsAuthenticityForensics` (api/analyze.js) scans EVERY
    // brand candidate against AUTHENTICITY_HIGH_RISK_BRANDS. A photo the
    // current engine reads as [{Seiko,0.5},{Rolex,0.4}] triggers counterfeit
    // forensics; with only the top brand it does not. That is a weakened
    // counterfeit surface on exactly the items where it matters, so it needed
    // a schema field rather than a note in the docs.
    candidate_brands: {
      type: 'array',
      description: 'Other brands this could plausibly be. Include a luxury/high-risk brand here whenever it is a genuine possibility, even at low confidence.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['brand', 'confidence'],
        properties: {
          brand:      { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

// ═══════════════════════════════════════════════════════
// PROMPT
// ═══════════════════════════════════════════════════════
// Deliberately short. Latency is the hypothesis under test, the schema already
// carries the field contract, and every extra paragraph is input tokens on an
// image-dominated request. The uncertainty rules are kept verbatim in spirit
// from the Stage 1 prompt because they are the behaviour the trust layer
// downstream is calibrated against — in particular the 0.70 silhouette ceiling,
// which calibrateRecognition ENFORCES regardless of what is returned here.
export function buildOpenAIRecognitionPrompt(language = 'he') {
  return `Identify the product in the image. Output data only — no prose, no explanation.

ORDER OF WORK — do these in this sequence, not in parallel:
FIRST transcribe into visible_text every string you can see, and name the logos.
THEN, and only then, decide brand / model from what you transcribed plus the shape.
visible_text is a TRANSCRIPTION. Every entry must be text you can point at in the image. If you cannot point at it, omit it.
Transcribe EVERYTHING you can see, including boilerplate: CE, FCC, 5V 1.5A, MADE IN CHINA, warranty lines, serials. Do not tidy the label down to the part that looks useful — a partial transcription is worse than a full one.

RULES
1. Read text off the item exactly as printed into visible_text. Do not translate, correct or complete it.
2. brand / model / model_number: null unless you can actually determine them. An empty field is a correct answer; an invented one is not.
3. Shape alone never exceeds 0.70 model_confidence. Reaching 0.75+ requires text or a logo you actually read.
4. Two or more plausible siblings: list them all in candidate_models at equal low confidence, set needs_confirmation true, give ambiguity_reason, and set product_family instead of picking one.
5. Retail box or packaging: set is_packaging true and identify the product INSIDE, not the box.
6. model_number is only what is physically printed on the item or its label. If it is not legible in the photo, use null — do not supply one you know from the product name.
7. candidate_brands: list any other brand this could plausibly be. If a luxury or designer brand is a genuine possibility, include it even at low confidence — a missed possibility is worse than a listed one.
${language === 'he' ? '8. Keep visible_text in its original script, including Hebrew.' : '8. Keep visible_text in its original script.'}`;
}

