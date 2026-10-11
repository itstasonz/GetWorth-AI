// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — STEP 1: WHAT IS IT?
//
// ONE vision call. The photograph itself goes to a multimodal model, which
// reports what it can actually see: the kind of object, the brand, the model
// when the photograph establishes one, the configuration, the visible
// condition, and whether one specific question would materially change the
// identity or the price.
//
// UNKNOWN IS AN ANSWER. The prompt asks for the exact model only when the
// photograph supports it, and the code below removes the one claim it can
// check: a model number that is not among the text the model says it read.
//
// It answers nothing about price. That is step 2, and it searches.
// ══════════════════════════════════════════════════════════════════════════════
import { CANONICAL_CATEGORIES } from '../category.js';
import { stripDataUriPrefix, detectImageMime, extractOpenAIJson } from '../openai-recognition.js';
import { promptSafe } from '../prompt-trust.js';
import { streamResponse } from '../v2/openai-stream.js';
import { CONDITIONS, IDENTIFY_TIMEOUT_MS, IDENTIFY_MAX_OUTPUT_TOKENS, resolveIdentityEffort } from './config.js';
import { buildIdentityPrompt, languageName, MAX_VISIBLE_TEXT, MAX_ALTERNATIVES, MAX_OPTIONS, MAX_ATTRIBUTES, MAX_CLARIFICATIONS } from './identity-prompt.js';
import { STRATEGY, strategyFor, changesSearch, isListingVariant } from './strategy.js';
import { applyConfirmed, sameAttribute, fieldOf, ASKED_ATTRIBUTE } from './confirmed.js';

// The prompt lives beside the schema it fills: identity-prompt.js. Re-exported so callers read it from here.
export { buildIdentityPrompt, languageName };

export const CONFIGURATIONS = Object.freeze(['complete_item', 'base_only', 'accessory', 'part', 'box_only', 'bundle', 'unknown']);
export const CONFIDENCE = Object.freeze(['high', 'medium', 'low']);
export const FOLLOWUP_KINDS = Object.freeze(['none', 'choice', 'yes_no', 'number', 'photo']);
export const VISIBLE_CONDITIONS = Object.freeze([...CONDITIONS, 'unknown']);
/**
 * THE MARKET AN ITEM BELONGS TO. Not a product catalogue: a handful of markets
 * that are researched and valued differently (market.js, valuation.js). A
 * market class is the model's judgement of what KIND of thing this is; the
 * server derives one from the category when the model gives none.
 */
export const MARKET_CLASSES = Object.freeze(['consumer_electronics', 'vehicle', 'furniture', 'fashion', 'luxury_watch_jewelry', 'fragrance_cosmetics', 'tools', 'collectible', 'household', 'handmade_vintage', 'other']);
/**
 * HOW PRECISELY THIS KIND OF ITEM IS IDENTIFIED FOR SALE. A phone is sold by
 * exact model and storage; a sofa by type, size, material and condition. An
 * unbranded item is not "unidentified": it is identified descriptively.
 */
export const PRECISIONS = Object.freeze(['exact_model', 'family', 'descriptive']);
export const ATTRIBUTE_BASIS = Object.freeze(['observed', 'inferred', 'unknown', 'confirmed']);
export const IMPACTS = Object.freeze(['high', 'medium', 'low']);
const MAX_CONFIRMED = 6;

const nullable = { type: ['string', 'null'] };
const strings = (maxItems) => ({ type: 'array', maxItems, items: { type: 'string' } });
const strict = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

// KEY ORDER IS GENERATION ORDER: what was read comes before what was concluded.
export const IDENTITY_SCHEMA = strict({
  is_sellable_item: { type: 'boolean' },
  visible_text: strings(MAX_VISIBLE_TEXT),
  category: { type: 'string', enum: [...CANONICAL_CATEGORIES] },
  item_type: nullable,
  brand: nullable,
  product_family: nullable,
  model: nullable,
  model_number: nullable,
  variant: nullable,
  color: nullable,
  size_or_capacity: nullable,
  configuration: { type: 'string', enum: [...CONFIGURATIONS] },
  included_items: strings(6),
  exact_model_established: { type: 'boolean' },
  alternatives: { type: 'array', maxItems: MAX_ALTERNATIVES, items: strict({ name: { type: 'string' }, distinguishing: nullable }) },
  identity_confidence: { type: 'string', enum: [...CONFIDENCE] },
  display_name: { type: 'string' },
  canonical_name: { type: 'string' },
  uncertainty_note: nullable,
  visible_condition: { type: 'string', enum: [...VISIBLE_CONDITIONS] },
  condition_notes: strings(2),
  listing_description: nullable,
  search: strict({ hebrew_name: nullable, aliases: strings(3), model_numbers: strings(3) }),
  // WHAT KIND OF THING, HOW PRECISELY IT IS SOLD, AND WHAT ABOUT IT MATTERS: the universal part of the identity.
  market_class: { type: 'string', enum: [...MARKET_CLASSES] },
  identity_precision: { type: 'string', enum: [...PRECISIONS] },
  attributes: {
    type: 'array', maxItems: MAX_ATTRIBUTES,
    // "confirmed" is what the OWNER said in an earlier round; the model may carry it, and the server checks it against its own record (applyConfirmed).
    items: strict({ name: { type: 'string' }, value: nullable, basis: { type: 'string', enum: ['observed', 'inferred', 'unknown', 'confirmed'] }, matters: { type: 'string', enum: [...IMPACTS] } }),
  },
  // What the model would ask, if anything. The SERVER chooses which one, when, and whether at all.
  clarifications: {
    type: 'array', maxItems: MAX_CLARIFICATIONS,
    items: strict({
      attribute: { type: 'string' },
      kind: { type: 'string', enum: ['choice', 'yes_no', 'number', 'photo'] },
      question: { type: 'string' },
      options: strings(MAX_OPTIONS),
      unit: nullable,
      impact: { type: 'string', enum: [...IMPACTS] },
      affects: { type: 'string', enum: ['identity', 'price', 'eligibility'] },
    }),
  },
  eligibility_notes: strings(3),
});

// ── NORMALISATION ───────────────────────────────────────────────────────────
const UNKNOWN = /^(unidentified|unknown|none|n\/a|null|generic|unbranded|no brand|לא ידוע)$/i;
const NOT_AN_ANSWER = /^(not sure|unsure|i don'?t know|don'?t know|other|לא בטוח.*|לא יודע.*|אחר)$/i;
const text = (v, max = 80) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s && !UNKNOWN.test(s) ? s.slice(0, max) : null;
};
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const list = (v, maxItems, maxLen) => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, maxLen)).filter(Boolean))].slice(0, maxItems);
const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Does every token of `value` occur in the text read off the item? */
export function occursInText(value, visibleText) {
  const want = tokens(value);
  if (want.length === 0) return false;
  const have = new Set((Array.isArray(visibleText) ? visibleText : []).flatMap(tokens));
  const joined = [...have].join(' ');
  return want.every((t) => have.has(t) || joined.includes(t));
}

/** A name assembled from the parts, for when the model's own is missing. */
function composeName(i) {
  const head = [i.brand, i.model ?? i.product_family].filter(Boolean).join(' ');
  return [head || i.item_type, i.variant].filter(Boolean).join(' ') || null;
}

/**
 * The model's answer as the contract the rest of the scan reads.
 *
 * Total: any input yields a well-formed identity. `ownerStated` is true when
 * the identity rests on the owner's correction, in which case a model number
 * does not have to be legible in the photograph.
 */
export function normalizeIdentity(raw, { ownerStated = false, followupsLeft = 1 } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const visibleText = list(r.visible_text, MAX_VISIBLE_TEXT, 60);
  const identity = {
    is_sellable_item: r.is_sellable_item !== false,
    visible_text: visibleText,
    category: oneOf(r.category, CANONICAL_CATEGORIES, 'Other'),
    item_type: text(r.item_type, 60),
    brand: text(r.brand, 60),
    product_family: text(r.product_family, 60),
    model: text(r.model, 80),
    model_number: text(r.model_number, 40),
    variant: text(r.variant, 60),
    color: text(r.color, 40),
    size_or_capacity: text(r.size_or_capacity, 40),
    configuration: oneOf(r.configuration, CONFIGURATIONS, 'unknown'),
    included_items: list(r.included_items, 6, 40),
    exact_model_established: r.exact_model_established === true,
    alternatives: (Array.isArray(r.alternatives) ? r.alternatives : [])
      .map((a) => ({ name: text(a?.name, 80), distinguishing: text(a?.distinguishing, 80) }))
      .filter((a) => a.name).slice(0, MAX_ALTERNATIVES),
    identity_confidence: oneOf(r.identity_confidence, CONFIDENCE, 'low'),
    display_name: text(r.display_name, 100),
    canonical_name: text(String(r.canonical_name ?? '').toLowerCase(), 100),
    uncertainty_note: text(r.uncertainty_note, 160),
    visible_condition: oneOf(r.visible_condition, VISIBLE_CONDITIONS, 'unknown'),
    condition_notes: list(r.condition_notes, 2, 80),
    listing_description: text(r.listing_description, 400),
    search: {
      hebrew_name: text(r.search?.hebrew_name, 60),
      aliases: list(r.search?.aliases, 3, 60),
      model_numbers: list(r.search?.model_numbers, 3, 30),
    },
    owner_stated: ownerStated,
  };

  // "Read" is a claim about the photograph, and the photograph's text is right here.
  if (identity.model_number && !ownerStated && !occursInText(identity.model_number, visibleText)) identity.model_number = null;
  if (!identity.model) identity.exact_model_established = false;
  // Sure of a name while still listing what else it could be is not "high".
  if (!ownerStated && !identity.exact_model_established && identity.alternatives.length >= 2 && identity.identity_confidence === 'high') {
    identity.identity_confidence = 'medium';
  }
  identity.display_name ??= composeName(identity);
  if (!identity.display_name) { identity.is_sellable_item = false; identity.identity_confidence = 'low'; }

  // THE UNIVERSAL PART. What kind of thing, how precisely it is sold, what matters, what could be asked.
  identity.market_class = oneOf(r.market_class, MARKET_CLASSES, marketClassOf(identity));
  identity.identity_precision = oneOf(r.identity_precision, PRECISIONS, precisionOf(identity.market_class));
  identity.attributes = (Array.isArray(r.attributes) ? r.attributes : [])
    // The model's "confirmed" is only its word for what the owner said: it is read as inferred here, and becomes confirmed
    // only where the server's own record of the owner's answers says so (applyConfirmed). A seller's statement is never
    // promoted to something the photograph showed, and the model cannot promote one either.
    .map((a) => ({ name: attributeName(a?.name), value: text(a?.value, 60), basis: oneOf(a?.basis === 'confirmed' ? 'inferred' : a?.basis, ['observed', 'inferred', 'unknown'], 'unknown'), matters: oneOf(a?.matters, IMPACTS, 'low') }))
    .filter((a) => a.name).slice(0, MAX_ATTRIBUTES);
  // A value the photograph did not show is not a value: an inferred attribute keeps its word but never passes for a fact.
  for (const a of identity.attributes) if (!a.value) a.basis = 'unknown';
  identity.eligibility_notes = list(r.eligibility_notes, 3, 120);
  identity.confirmed = [];
  identity.clarifications = (Array.isArray(r.clarifications) ? r.clarifications : [])
    .map((c) => clarification(c)).filter(Boolean).slice(0, MAX_CLARIFICATIONS);
  // The one question of the earlier contract, when a caller still gives one: it is a candidate like the others.
  const f = r.followup ?? null;
  if (f && f.kind && f.kind !== 'none') {
    const legacy = clarification({ attribute: 'followup', kind: f.kind, question: f.question, options: f.options, unit: null, impact: 'high', affects: f.affects === 'identity' ? 'identity' : 'price' });
    if (legacy) identity.clarifications.unshift(legacy);
  }
  // The question on the identity is chosen by the server (selectQuestion); until it runs, none is asked.
  identity.followup = followupsLeft > 0 ? questionOf(identity.clarifications[0] ?? null) : NO_QUESTION;
  return identity;
}

// ── ATTRIBUTES AND CLARIFICATIONS ───────────────────────────────────────────
const NO_QUESTION = Object.freeze({ kind: 'none', affects: 'none', question: null, options: [] });
const attributeName = (v) => { const s = text(v, 40); return s ? s.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) || null : null; };
const YES_NO = /^(yes|no|כן|לא)$/i;
/** One candidate clarification as the server keeps it, or null when it is not a question that can be answered. */
function clarification(c) {
  if (!c || typeof c !== 'object') return null;
  const kind = oneOf(c.kind, ['choice', 'yes_no', 'number', 'photo'], null);
  const question = text(c.question, 200);
  if (!kind || !question) return null;
  let options = list(c.options, MAX_OPTIONS + 1, 40).filter((o) => !NOT_AN_ANSWER.test(o)).slice(0, MAX_OPTIONS);
  if (kind === 'choice' && options.length < 2) return null;
  if (kind === 'yes_no') { if (options.length !== 2 || !options.every((o) => YES_NO.test(o))) return null; }
  if (kind !== 'choice' && kind !== 'yes_no') options = [];
  return {
    attribute: attributeName(c.attribute) ?? 'detail', kind, question, options,
    unit: kind === 'number' ? text(c.unit, 12) : null,
    impact: oneOf(c.impact, IMPACTS, 'medium'), affects: oneOf(c.affects, ['identity', 'price', 'eligibility'], 'price'),
  };
}
/** A clarification as the question the client shows. */
const questionOf = (c, required = false) => (c ? { kind: c.kind, affects: c.affects, question: c.question, options: [...c.options], unit: c.unit ?? null, attribute: c.attribute, ...(required ? { required: true } : {}) } : { ...NO_QUESTION });

// The market class a category implies when the model names none, and the precision a market class implies.
const CLASS_BY_CATEGORY = { Electronics: 'consumer_electronics', Vehicles: 'vehicle', Furniture: 'furniture', Watches: 'luxury_watch_jewelry', Jewelry: 'luxury_watch_jewelry', Clothing: 'fashion', Bags: 'fashion', Beauty: 'fragrance_cosmetics', Tools: 'tools', Home: 'household', Toys: 'collectible', Books: 'collectible', Sports: 'other' };
const DESCRIPTIVE_CLASSES = new Set(['furniture', 'household', 'handmade_vintage']);
/** The market a category implies — an appliance under "Home" is sold by model, like electronics, not by description. */
export const marketClassOf = (i) => (APPLIANCE.test(String(i?.item_type ?? '')) ? 'consumer_electronics' : (CLASS_BY_CATEGORY[i?.category] ?? 'other'));
export const precisionOf = (marketClass) => (DESCRIPTIVE_CLASSES.has(marketClass) ? 'descriptive' : 'exact_model');
/** Is this kind of item identified by description rather than by a model buyers search for? */
export const isDescriptive = (i) => i?.identity_precision === 'descriptive';

// ── WHAT A SEARCH NEEDS TO KNOW FIRST ───────────────────────────────────────
// Three real scans (2026-10-11) showed what a market search cannot do: price a
// perfume known only by its house (it came back with another house's perfume),
// or a blender known only by its brand (it came back with other blenders). A
// market search is paid for, and one that cannot name the product buys
// nothing. So before the search, the server — not the model — checks that the
// identity names ONE product, and when it does not, asks for the one photograph
// that would settle it. The rules are few and stated:
//
//   a brand alone            no model, no family, no model number: a catalogue,
//                            not a product. Ask for the model name or label.
//   a fragrance              needs its NAME and its SIZE before any price: the
//                            same house sells many at very different prices,
//                            and 30 ml is not 100 ml. Then, before the price,
//                            how much is left — the one fact the owner knows.
//   electronics, appliances  when the exact model is not established, no model
//                            number was read and the photograph suggests no
//                            alternatives, ask for the model label: the family
//                            alone cannot be priced for this product.
//
// The owner's own word ("Wrong item?") settles any of these: an owner-stated
// identity is taken as it is given.
export const INCOMPLETE = Object.freeze({ BRAND_ONLY: 'brand_only', FRAGRANCE_NAME_OR_SIZE: 'fragrance_name_or_size', MODEL_UNREAD: 'model_not_established' });
const FRAGRANCE = /(perfume|fragrance|parfum|cologne|eau de (?:toilette|parfum)|\bed[pt]\b|בושם|פרפיום)/iu;
const APPLIANCE = /(blender|mixer|processor|vacuum|kettle|toaster|microwave|fryer|coffee|espresso|iron\b|heater|washer|dryer|dishwasher|oven|printer|speaker|headphone|earbud|camera|console|router|monitor|television|\btv\b|laptop|tablet|phone|watch|drone|projector|soundbar|scooter|בלנדר|מיקסר|שואב|קומקום|מצנם|מיקרוגל|מצלמה|אוזניות|רמקול|מדפסת|קונסולה)/iu;
const VOLUME = /\d+(?:\.\d+)?\s?(ml|מ"ל|מ״ל|מל|oz|fl\.? ?oz)(?![\p{L}\p{N}])/iu;
const ASK = {
  [INCOMPLETE.BRAND_ONLY]: { en: 'Take a clear photo of the model name or the label, so the exact product can be identified.', he: 'צלמו בבירור את שם הדגם או את התווית, כדי שאפשר יהיה לזהות את המוצר המדויק.' },
  [INCOMPLETE.FRAGRANCE_NAME_OR_SIZE]: { en: 'Take a clear photo of the label or the sticker on the bottom of the bottle, so the fragrance name and size can be read.', he: 'צלמו בבירור את התווית או את המדבקה בתחתית הבקבוק, כדי שאפשר יהיה לקרוא את שם הבושם ואת הנפח.' },
  [INCOMPLETE.MODEL_UNREAD]: { en: 'Take a clear photo of the model label (usually on the underside or the back), so the exact model can be identified.', he: 'צלמו בבירור את תווית הדגם (בדרך כלל בתחתית או מאחור), כדי שאפשר יהיה לזהות את הדגם המדויק.' },
};
const REMAINING = {
  en: { question: 'How much perfume is left in the bottle?', options: ['Full or sealed', 'About 75%', 'About half', 'Under 25%'] },
  he: { question: 'כמה בושם נשאר בבקבוק?', options: ['מלא או סגור', 'בערך 75%', 'בערך חצי', 'פחות מ־25%'] },
};
const REMAINING_ANSWERED = /(%|full|sealed|half|quarter|מלא|סגור|חצי|רבע)/iu;
// THE SERVER'S OWN STORAGE QUESTION (the founder's Huawei P30 Pro, 2026-10-11): a phone, a tablet or a laptop whose
// storage the model called unknown and high without proposing the question. The usual values; the owner's own words
// take any other, and "not sure" is added by the app.
const STORAGE = {
  en: { question: 'How much storage does it have?', options: ['64 GB', '128 GB', '256 GB', '512 GB'] },
  he: { question: 'מה נפח האחסון שלו?', options: ['64 GB', '128 GB', '256 GB', '512 GB'] },
};
const STORAGE_NAME = /^storage( capacity| size)?$/;
const isTechnical = (i) => i?.market_class === 'consumer_electronics' || i?.category === 'Electronics' || APPLIANCE.test(String(i?.item_type ?? ''));

/** Is this item a fragrance? Read from what the photograph established, never from the brand alone. */
export const isFragrance = (i) => FRAGRANCE.test([i?.item_type, i?.product_family, i?.canonical_name, i?.display_name].filter(Boolean).join(' '));

/** Why the identity cannot yet be searched for as ONE product, or null when it can. */
export function identityGap(identity) {
  const i = identity ?? {};
  if (!i.is_sellable_item || i.owner_stated) return null;
  if (isFragrance(i)) return (i.model || i.product_family) && VOLUME.test(String(i.size_or_capacity ?? '')) ? null : INCOMPLETE.FRAGRANCE_NAME_OR_SIZE;
  // A descriptive item (a sofa, a handmade bowl) has no model to be missing: its type and attributes name it.
  if (isDescriptive(i)) return null;
  if (!i.model && !i.product_family && !i.model_number) return i.brand ? INCOMPLETE.BRAND_ONLY : null;
  if (isTechnical(i) && !i.exact_model_established && !i.model_number && (i.alternatives?.length ?? 0) === 0) return INCOMPLETE.MODEL_UNREAD;
  return null;
}

/**
 * A LISTING-DEFINING VARIANT STILL OPEN, or null. A technical item sold by
 * exact model is sold as a variant of it — a phone by its storage, a laptop by
 * its generation and memory — and a listing for the model whose variant is not
 * known may be a listing for a different product at a different price. When the
 * model lists such an attribute as unknown and high, and neither the photograph
 * nor the owner has settled it, its name is returned: the server asks for it
 * where it can (selectQuestion), and a price made without it is approximate,
 * never exact (service.js isApproximate). The model is not the only one who notices.
 */
export function openVariant(identity) {
  const i = identity ?? {};
  if (strategyFor(i) !== STRATEGY.EXACT || !isTechnical(i)) return null;
  const settled = (i.confirmed ?? []).filter((c) => !c.unsure).map((c) => c.attribute);
  for (const a of i.attributes ?? []) {
    if (a.basis !== 'unknown' || a.matters !== 'high' || !isListingVariant(a.name)) continue;
    if (settled.some((n) => sameAttribute(n, a.name))) continue;
    const field = fieldOf(a.name);
    if (field && i[field]) continue;
    return a.name;
  }
  return null;
}

/**
 * The identity with the server's own question on it, when the search needs one.
 *
 * `incomplete` names what is missing; while it is set the market step does not
 * run. The question is asked while the scan's allowance lasts; the owner can
 * always say what the item is instead. A fragrance that IS named asks, before
 * its price, how much is left: a required choice, answered (or "not sure")
 * before the search.
 */
export function completeIdentity(identity, { lang = 'he', followupsLeft = 1, confirmed = null } = {}) {
  const out = { ...identity, attributes: (identity.attributes ?? []).map((a) => ({ ...a })), clarifications: identity.clarifications ?? [], followup: { ...identity.followup } };
  const l = lang === 'en' ? 'en' : 'he';
  out.confirmed = Array.isArray(confirmed) ? confirmed.slice(0, MAX_CONFIRMED) : (Array.isArray(out.confirmed) ? out.confirmed : []);
  applyConfirmed(out);
  const gap = identityGap(out);
  if (gap) out.incomplete = gap; else delete out.incomplete;
  const next = selectQuestion(out, { lang: l, followupsLeft });
  out.followup = next ? questionOf(next, next.required) : { ...NO_QUESTION };
  return out;
}

// ── WHICH QUESTION, IF ANY ──────────────────────────────────────────────────
// The model proposes; the server chooses, one at a time, by a stated policy
// that knows what THIS scan will produce (strategy.js) and asks only what can
// change it. A question whose answer the engine cannot use is not asked, and
// nobody answers a question before a search only to be told there is no price.
//
//   1. a photograph the identity needs (identityGap) comes first and is required
//   2. a fragrance that is named is asked how much is left: required
//   3. of the model's clarifications, none already confirmed, none about a
//      detail that was asked before, and none about ELIGIBILITY (authenticity,
//      papers): the engine has no outcome that an eligibility answer would
//      change — what a photograph cannot establish is said in eligibility_notes
//      instead. For a SPECIALISED market (a car, a luxury watch, a collectible)
//      no number is produced, so no question is required and none about the
//      price is asked; an identity question is offered beside the evidence.
//      Otherwise a question is REQUIRED — asked before the search — only when
//      it is HIGH impact and its answer changes what is searched for: it
//      decides the identity, or it is an attribute that joins the search
//      queries (strategy.js changesSearch). Every other question that is not
//      LOW is offered beside the price: its answer reaches the research as a
//      confirmed fact and re-prices. The one required first; then by impact,
//      identity before price. LOW is never asked.
//   4. when the scan's allowance of questions is spent, nothing is asked: a
//      required detail still missing leaves the identity incomplete, and the
//      owner's own word or their own price are the ways on.
//
// STOPPING: the search runs as soon as no required question is open. There is
// no loop: each answer is kept (confirmed) and never asked again.
const RANK = { high: 0, medium: 1, low: 2 };
const AFFECTS_RANK = { identity: 0, eligibility: 1, price: 2 };
export function selectQuestion(identity, { lang = 'he', followupsLeft = 1 } = {}) {
  if (followupsLeft <= 0) return null;
  const l = lang === 'en' ? 'en' : 'he';
  if (identity.incomplete) return { attribute: 'identity', kind: 'photo', question: ASK[identity.incomplete][l], options: [], unit: null, impact: 'high', affects: 'identity', required: true };
  const confirmedNames = new Set((identity.confirmed ?? []).map((c) => c.attribute));
  const confirmedQuestions = new Set((identity.confirmed ?? []).map((c) => c.question));
  if (isFragrance(identity) && !confirmedNames.has('remaining')) {
    const own = (identity.clarifications ?? []).find((c) => c.kind === 'choice' && REMAINING_ANSWERED.test(c.options.join(' ')));
    const q = own ?? { attribute: 'remaining', kind: 'choice', question: REMAINING[l].question, options: [...REMAINING[l].options], unit: null, impact: 'high', affects: 'price' };
    if (!confirmedQuestions.has(q.question)) return { ...q, attribute: 'remaining', required: true };
  }
  // OUTCOME-AWARE: what this kind of item's scan produces decides what is worth asking, and what must come first.
  const noNumber = strategyFor(identity) === STRATEGY.SPECIALISED;
  const required = (c) => !noNumber && c.impact === 'high' && (c.affects === 'identity' || changesSearch(c.attribute));
  const open = (identity.clarifications ?? [])
    .filter((c) => c.impact !== 'low' && c.affects !== 'eligibility' && !(noNumber && c.affects === 'price'))
    .filter((c) => !confirmedQuestions.has(c.question) && !(confirmedNames.has(c.attribute) && !ASKED_ATTRIBUTE.test(c.attribute)));
  // THE SERVER'S OWN QUESTION, when the model called a phone's storage unknown and high and proposed no question for it:
  // storage decides which listings are the same product, so it is asked, before the search, like the model's own would
  // be. Once asked — answered or "not sure" — it is not asked again.
  const variant = openVariant(identity);
  if (variant && STORAGE_NAME.test(variant) && !open.some((c) => sameAttribute(c.attribute, variant)) && !(identity.confirmed ?? []).some((c) => sameAttribute(c.attribute, variant))) {
    open.push({ attribute: 'storage', kind: 'choice', question: STORAGE[l].question, options: [...STORAGE[l].options], unit: null, impact: 'high', affects: 'price' });
  }
  open.sort((a, b) => Number(required(b)) - Number(required(a)) || RANK[a.impact] - RANK[b.impact] || AFFECTS_RANK[a.affects] - AFFECTS_RANK[b.affects]);
  const best = open[0] ?? null;
  return best ? { ...best, required: required(best) } : null;
}

/**
 * ONE MORE PHOTOGRAPH, AFTER THE SEARCH. The founder's Ninja blender (2026-10-11,
 * real scan): the identity named one product by its marketing name, so the
 * search ran — and came back with other Ninja machines, because the Israeli
 * market lists appliances and electronics by their model CODE, which the
 * photograph did not show. When the search for an exact-model technical item
 * ends with no second-hand reference and no model code was ever read, the model
 * label is the one photograph that can change the NEXT search. It is offered
 * beside the result, never required — the search is done, the owner may sell
 * at their own price — and once per scan: a label that still shows no code is
 * not asked for again.
 */
export function questionAfterResearch(identity, valuation, { lang = 'he', followupsLeft = 1 } = {}) {
  const i = identity ?? {};
  if (followupsLeft <= 0 || !valuation || valuation.status === 'priced') return null;
  if (i.owner_stated || i.incomplete || i.asked_label || (i.followup?.kind && i.followup.kind !== 'none')) return null;
  if (strategyFor(i) !== STRATEGY.EXACT || (valuation.counts?.resale ?? 0) > 0) return null;
  const technical = i.market_class === 'consumer_electronics' || i.category === 'Electronics' || APPLIANCE.test(String(i.item_type ?? ''));
  if (!technical || i.model_number || (i.search?.model_numbers?.length ?? 0) > 0) return null;
  return { kind: 'photo', affects: 'identity', question: ASK[INCOMPLETE.MODEL_UNREAD][lang === 'en' ? 'en' : 'he'], options: [], unit: null, attribute: 'model label' };
}

/**
 * THE OWNER'S OWN WORDS, when the options offered do not fit. A choice question
 * lists what the model thought likely; a 64 GB phone is not less real for the
 * model having offered 128 and 256. The answer is a short plain value — letters,
 * digits, a little punctuation — bounded here at the boundary, and it travels
 * everywhere a confirmed fact does: fenced as data in the prompts, cleaned
 * before it joins a search query. It is never free text to a model: at most
 * MAX_ANSWER_TEXT characters, no markup, no control characters.
 */
export const MAX_ANSWER_TEXT = 40;
const ownWords = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.other !== 'string') return null;
  const s = promptSafe(raw.other, MAX_ANSWER_TEXT).replace(/[^\p{L}\p{N} .,'"׳״’\-/%+&()]/gu, '').replace(/\s+/g, ' ').trim();
  return s && /[\p{L}\p{N}]/u.test(s) ? s : null;
};

/**
 * The owner answered the question on the identity. The answer becomes a
 * confirmed fact — by option index, yes/no index, a number in the question's
 * unit, or, for a choice, their own short words when no option fits; "unsure"
 * is recorded as such — and the identity goes back through completeIdentity so
 * the next question, if any, is chosen.
 * Returns { identity, answer } or { error }.
 */
export function recordAnswer(identity, raw, { lang = 'he', followupsLeft = 1 } = {}) {
  const q = identity?.followup;
  if (!q || q.kind === 'none' || q.kind === 'photo') return { error: 'no question to answer' };
  const own = q.kind === 'choice' ? ownWords(raw) : null;
  // The owner typing "not sure" into the box is the owner not being sure.
  const unsure = raw === 'unsure' || (!!own && NOT_AN_ANSWER.test(own));
  let value = null;
  if (unsure) value = lang === 'en' ? 'The owner is not sure' : 'הבעלים לא בטוחים';
  else if (own) value = own;
  else if (q.kind === 'choice' || q.kind === 'yes_no') { if (!Number.isInteger(raw) || !q.options[raw]) return { error: 'answer is not one of the options offered' }; value = q.options[raw]; }
  else if (q.kind === 'number') {
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw * 100) / 100 : NaN;
    if (!(n >= 0 && n <= 100_000_000)) return { error: 'answer is not a number in range' };
    value = q.unit ? `${n} ${q.unit}` : String(n);
  }
  const stated = !unsure && !!own;
  const confirmed = [...(identity.confirmed ?? []).filter((c) => c.attribute !== q.attribute), { attribute: q.attribute ?? 'detail', value, question: q.question, ...(unsure ? { unsure: true } : {}), ...(stated ? { stated: true } : {}) }].slice(-MAX_CONFIRMED);
  const next = completeIdentity({ ...identity, confirmed }, { lang, followupsLeft, confirmed });
  return { identity: next, answer: { question: q.question, text: value, ...(unsure ? { unsure: true } : {}), ...(stated ? { stated: true } : {}) } };
}

/**
 * The identity call. ONE request, no retry and no second model.
 * Resolves to { identity, meta } or throws an Error `classifyOpenAIFailure` understands.
 */
export async function identifyItem({
  images, lang = 'he', correction = null, prior = null, followupsLeft = 1,
  model, effort = resolveIdentityEffort(), apiKey, timeoutMs = IDENTIFY_TIMEOUT_MS, safetyIdentifier = null, fetchImpl = fetch,
} = {}) {
  const list64 = (Array.isArray(images) ? images : []).map(stripDataUriPrefix).filter(Boolean);
  if (list64.length === 0) throw new Error('[OpenAI] no images supplied');
  const body = {
    model,
    input: [{ role: 'user', content: [
      ...list64.map((b64) => ({ type: 'input_image', image_url: `data:${detectImageMime(b64)};base64,${b64}`, detail: 'high' })),
      { type: 'input_text', text: buildIdentityPrompt({ lang, imageCount: list64.length, correction, prior, followupsLeft }) },
    ] }],
    // `store` defaults to TRUE; a scanned photograph must not become a copy that no GetWorth deletion can reach.
    store: false,
    ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
    reasoning: { effort },
    max_output_tokens: IDENTIFY_MAX_OUTPUT_TOKENS,
    text: { format: { type: 'json_schema', name: 'getworth_identity', schema: IDENTITY_SCHEMA, strict: true } },
  };
  const res = await streamResponse({ stage: 'scan_identify', body, apiKey, timeoutMs, fetchImpl });
  return {
    identity: normalizeIdentity(extractOpenAIJson(res.final), { ownerStated: !!correction, followupsLeft }),
    meta: { model: res.model, timings: res.timings, usage: res.usage, billed: res.billed },
  };
}
