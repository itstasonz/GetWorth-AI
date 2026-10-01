// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE ONE FOLLOW-UP PHOTOGRAPH
//
// When the identity cannot support a price, the user is asked for ONE specific
// photograph, never "another picture". The model names the KIND of evidence
// that is missing, from a closed list; the words shown to the user are written
// here, on the server, in both languages.
//
// The second photograph AUGMENTS the scan. `mergeIdentity` decides, field by
// field and without a model, what the new reading may replace and what the
// first photograph established and keeps.
// ══════════════════════════════════════════════════════════════════════════════

export const FOLLOWUP = Object.freeze({
  NONE: 'NONE',
  UNDERSIDE_MODEL_LABEL: 'UNDERSIDE_MODEL_LABEL',
  BOTTOM_MODEL_LABEL: 'BOTTOM_MODEL_LABEL',
  RATING_PLATE: 'RATING_PLATE',
  BOTTOM_LABEL: 'BOTTOM_LABEL',
  TONGUE_SKU_LABEL: 'TONGUE_SKU_LABEL',
  INNER_BRAND_TAG: 'INNER_BRAND_TAG',
  CASEBACK_REFERENCE: 'CASEBACK_REFERENCE',
  ABOUT_SCREEN: 'ABOUT_SCREEN',
  MODEL_LABEL: 'MODEL_LABEL',
  FRONT_VIEW: 'FRONT_VIEW',
  BETTER_LIGHT: 'BETTER_LIGHT',
});
export const FOLLOWUP_TYPES = Object.freeze(Object.values(FOLLOWUP));

/** Types that ask for a label, plate or reference: evidence that names a model. */
export const LABEL_FOLLOWUPS = Object.freeze(new Set([
  FOLLOWUP.UNDERSIDE_MODEL_LABEL, FOLLOWUP.BOTTOM_MODEL_LABEL, FOLLOWUP.RATING_PLATE,
  FOLLOWUP.BOTTOM_LABEL, FOLLOWUP.TONGUE_SKU_LABEL, FOLLOWUP.INNER_BRAND_TAG,
  FOLLOWUP.CASEBACK_REFERENCE, FOLLOWUP.ABOUT_SCREEN, FOLLOWUP.MODEL_LABEL,
]));

const INSTRUCTION = Object.freeze({
  [FOLLOWUP.UNDERSIDE_MODEL_LABEL]: {
    en: 'Photograph the underside label with the model number.',
    he: 'צלמו את המדבקה בתחתית המוצר עם מספר הדגם.',
  },
  [FOLLOWUP.BOTTOM_MODEL_LABEL]: {
    en: 'Photograph the model label on the bottom of the device.',
    he: 'צלמו את מדבקת הדגם בתחתית המכשיר.',
  },
  [FOLLOWUP.RATING_PLATE]: {
    en: 'Photograph the model / rating plate.',
    he: 'צלמו את לוחית הדגם (לוחית הנתונים) של המוצר.',
  },
  [FOLLOWUP.BOTTOM_LABEL]: {
    en: 'Photograph the label on the bottom.',
    he: 'צלמו את התווית שבתחתית המוצר.',
  },
  [FOLLOWUP.TONGUE_SKU_LABEL]: {
    en: 'Photograph the label inside the tongue with the size and SKU.',
    he: 'צלמו את התווית שבלשון הנעל עם המידה והמק״ט.',
  },
  [FOLLOWUP.INNER_BRAND_TAG]: {
    en: 'Photograph the inner brand and care tag.',
    he: 'צלמו את תווית המותג והכביסה הפנימית.',
  },
  [FOLLOWUP.CASEBACK_REFERENCE]: {
    en: 'Photograph the back of the case with the reference number.',
    he: 'צלמו את גב השעון עם מספר הרפרנס.',
  },
  [FOLLOWUP.ABOUT_SCREEN]: {
    en: 'Photograph the About screen showing the model name.',
    he: 'צלמו את מסך ״אודות״ שבו מופיע שם הדגם.',
  },
  [FOLLOWUP.MODEL_LABEL]: {
    en: 'Photograph the label that shows the model number.',
    he: 'צלמו את התווית שבה מופיע מספר הדגם.',
  },
  [FOLLOWUP.FRONT_VIEW]: {
    en: 'Photograph the whole item from the front.',
    he: 'צלמו את המוצר כולו מלפנים.',
  },
  [FOLLOWUP.BETTER_LIGHT]: {
    en: 'Photograph the item again in better light.',
    he: 'צלמו את המוצר שוב בתאורה טובה יותר.',
  },
});

/** The instruction shown to the user, or null for NONE / an unknown type. */
export function followupInstruction(type, language = 'en') {
  const entry = INSTRUCTION[type];
  if (!entry) return null;
  return String(language).toLowerCase().startsWith('he') ? entry.he : entry.en;
}

// WHERE THE MODEL IS WRITTEN, BY KIND OF OBJECT. Used when the model named no
// label-type evidence itself. Ordered: the first pattern that matches wins.
const BY_OBJECT = [
  [/\b(mouse|keyboard|controller|gamepad|headphones?|headset|earbuds?|speaker|router|console)\b/i, FOLLOWUP.UNDERSIDE_MODEL_LABEL],
  [/\b(laptop|notebook|macbook|monitor|television|tv)\b/i, FOLLOWUP.BOTTOM_MODEL_LABEL],
  [/\b(phone|smartphone|tablet|smartwatch)\b/i, FOLLOWUP.ABOUT_SCREEN],
  [/\b(watch|wristwatch)\b/i, FOLLOWUP.CASEBACK_REFERENCE],
  [/\b(shoes?|sneakers?|boots?|trainers?|sandals?)\b/i, FOLLOWUP.TONGUE_SKU_LABEL],
  [/\b(perfume|fragrance|cologne|cosmetic|lipstick|cream|serum)\b/i, FOLLOWUP.BOTTOM_LABEL],
  [/\b(blender|kettle|mixer|toaster|oven|microwave|vacuum|fridge|refrigerator|washer|dryer|heater|fan|iron|appliance|coffee|drill|saw)\b/i, FOLLOWUP.RATING_PLATE],
];
const BY_CATEGORY = Object.freeze({
  Watches: FOLLOWUP.CASEBACK_REFERENCE,
  Clothing: FOLLOWUP.INNER_BRAND_TAG,
  Bags: FOLLOWUP.INNER_BRAND_TAG,
  Beauty: FOLLOWUP.BOTTOM_LABEL,
  Home: FOLLOWUP.RATING_PLATE,
  Tools: FOLLOWUP.RATING_PLATE,
});

/** The label to ask for, given what kind of object this is. */
export function defaultFollowupFor({ object_class = null, category = null } = {}) {
  const text = String(object_class ?? '');
  for (const [pattern, type] of BY_OBJECT) if (pattern.test(text)) return type;
  return BY_CATEGORY[category] ?? FOLLOWUP.MODEL_LABEL;
}

const READ = new Set(['TEXT_READ', 'LABEL_READ']);
const wasRead = (field) => !!field?.value && READ.has(field?.evidence);
const sameValue = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** One identity field: the new reading wins only when it is better evidence. */
function mergeField(prior, next) {
  if (!next?.value) return prior;
  if (!prior?.value) return next;
  if (wasRead(next) && !wasRead(prior)) return next;          // read beats seen
  if (wasRead(prior) && !wasRead(next)) return prior;
  if (sameValue(prior.value, next.value)) {
    return { ...prior, confidence: Math.max(prior.confidence, next.confidence) };
  }
  return next.confidence > prior.confidence ? next : prior;
}

/**
 * The scan's identity after a follow-up photograph.
 *
 * `prior` is what the first photograph established; `next` is the reading of
 * the follow-up. Nothing the first photograph established is dropped because
 * the second one did not show it: a close-up of a label has no condition, no
 * colour and often no brand, and none of that is evidence of absence.
 */
export function mergeIdentity(prior, next) {
  if (!prior) return next;
  if (!next) return prior;
  const brand = mergeField(prior.brand, next.brand);
  const model = mergeField(prior.model, next.model);
  const variant = mergeField(prior.variant, next.variant);
  const modelSettled = wasRead(model);
  const union = (a, b, max) => [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, max);
  return {
    category: prior.category ?? next.category,
    object_class: prior.object_class || next.object_class,
    local_name: prior.local_name || next.local_name,
    visible_text: union(prior.visible_text, next.visible_text, 16),
    brand,
    model,
    variant,
    // A model that was READ leaves no shortlist to choose from. Otherwise the
    // newer shortlist is the better one, and the older survives an empty one.
    ranked_candidates: modelSettled ? []
      : ((next.ranked_candidates?.length ?? 0) > 0 ? next.ranked_candidates : (prior.ranked_candidates ?? [])),
    condition: prior.condition?.grade && prior.condition.grade !== 'Unknown' ? prior.condition : next.condition,
    identity_evidence: union(prior.identity_evidence, next.identity_evidence, 6),
    missing_evidence: next.missing_evidence ?? FOLLOWUP.NONE,
    market_hypotheses: {
      aliases: union(prior.market_hypotheses?.aliases, next.market_hypotheses?.aliases, 3),
      model_numbers: union(prior.market_hypotheses?.model_numbers, next.market_hypotheses?.model_numbers, 3),
    },
  };
}
