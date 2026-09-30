// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE SEARCH PLAN, BUILT LOCALLY
//
// No model writes a search query in V2. A plan is assembled from the identity's
// own fields and the market's own vocabulary (api/_lib/phaseb/config.js), so
// this file names no language, no marketplace and no product.
//
//     SEARCHED MODEL  !=  CONFIRMED MODEL
//
// A candidate may be searched as a HYPOTHESIS. It is marked as one, the subject
// handed to the evidence gate stays what the identity established, and nothing
// a hypothesis query returns can be admitted as evidence about this item.
// ══════════════════════════════════════════════════════════════════════════════
import { IDENTITY_LEVEL } from './sufficiency.js';

export const MAX_V2_QUERIES = 4;
export const V2_PURPOSE = Object.freeze({
  SECOND_HAND: 'SECOND_HAND',
  FOR_SALE: 'FOR_SALE',
  PRICE_CONTEXT: 'PRICE_CONTEXT',
  LOCAL_NAME: 'LOCAL_NAME',
  HYPOTHESIS: 'CANDIDATE_MODEL',
});

const clean = (v, max = 80) => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, max) : null;
};
const words = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The same words in any order: two phrasings of one query. */
const sameWords = (x, y) => {
  const a = new Set(words(x));
  const b = new Set(words(y));
  return a.size === b.size && [...a].every((w) => b.has(w));
};
/** `brand` + `model`, without repeating a word they share at the join ("Logitech G" + "G Pro"). */
export function overlapJoin(brand, model) {
  const b = String(brand ?? '').trim().split(/\s+/).filter(Boolean);
  const m = String(model ?? '').trim().split(/\s+/).filter(Boolean);
  let k = Math.min(b.length, m.length);
  while (k > 0 && !b.slice(-k).every((w, i) => w.toLowerCase() === m[i].toLowerCase())) k -= 1;
  return [...b, ...m.slice(k)].join(' ');
}
const join = (...parts) => parts.flat().map((x) => clean(x)).filter(Boolean).join(' ');

/**
 * The subject the evidence gate will be asked about, in the shape it reads.
 *
 * This is the IDENTITY, not the plan: a brand with no established model stays
 * model-less here even when candidates are searched.
 */
export function subjectOf(identity, level) {
  const product = level === IDENTITY_LEVEL.PRODUCT;
  const generic = level === IDENTITY_LEVEL.GENERIC;
  // A kind of object is named in the seller's language as well as ours, and
  // the class is the only identity a generic subject has.
  const objectClass = generic
    ? ([identity?.object_class, identity?.local_name].filter(Boolean).join(' ') || null)
    : (identity?.object_class ?? null);
  return {
    object_class: objectClass,
    category_candidate: identity?.category ?? null,
    brand: generic ? null : (identity?.brand?.value ?? null),
    product_name: product ? overlapJoin(identity?.brand?.value, identity?.model?.value) : null,
    family: null,
    model: product ? (identity?.model?.value ?? null) : null,
    variant: product ? (identity?.variant?.value ?? null) : null,
  };
}

/**
 * The queries that will run.
 *
 * Returns { level, product_identity, queries, hypotheses }. An identity with
 * nothing searchable yields an empty plan, which the caller treats as "do not
 * search" rather than searching for nothing.
 */
export function planV2Search(identity, level, market) {
  const t = market?.terms || {};
  const id = identity || {};
  const brand = id.brand?.value ?? null;
  const proposed = [];
  const add = (purpose, text, extra = {}) => { if (text) proposed.push({ purpose, text, ...extra }); };
  let name = null;
  const hypotheses = [];

  if (level === IDENTITY_LEVEL.PRODUCT) {
    name = overlapJoin(brand, id.model?.value);
    add(V2_PURPOSE.SECOND_HAND, join(name, t.second_hand));
    add(V2_PURPOSE.FOR_SALE, join(name, t.for_sale));
    add(V2_PURPOSE.PRICE_CONTEXT, join(name, t.price));
    if (id.local_name) add(V2_PURPOSE.LOCAL_NAME, join(id.local_name, brand, t.second_hand));
  } else if (level === IDENTITY_LEVEL.CANDIDATES) {
    name = join(brand, id.object_class);
    for (const c of (id.ranked_candidates ?? []).slice(0, MAX_V2_QUERIES - 1)) {
      const text = join(overlapJoin(c.brand || brand, c.model), t.second_hand);
      add(V2_PURPOSE.HYPOTHESIS, text, { hypothesis: c.model });
      hypotheses.push({ model: c.model, confidence: c.confidence });
    }
    add(V2_PURPOSE.SECOND_HAND, join(brand, id.local_name || id.object_class, t.second_hand));
  } else if (level === IDENTITY_LEVEL.BRAND_CLASS) {
    name = join(brand, id.object_class);
    add(V2_PURPOSE.SECOND_HAND, join(brand, id.local_name || id.object_class, t.second_hand));
    add(V2_PURPOSE.FOR_SALE, join(brand, id.local_name || id.object_class, t.for_sale));
    if (id.local_name && id.object_class) add(V2_PURPOSE.PRICE_CONTEXT, join(brand, id.object_class, t.price));
  } else if (level === IDENTITY_LEVEL.GENERIC) {
    name = id.local_name || id.object_class;
    add(V2_PURPOSE.SECOND_HAND, join(id.local_name || id.object_class, t.second_hand));
    add(V2_PURPOSE.FOR_SALE, join(id.local_name || id.object_class, t.for_sale));
    if (id.local_name && id.object_class) add(V2_PURPOSE.LOCAL_NAME, join(id.object_class, t.second_hand));
  }

  const queries = [];
  for (const q of proposed) {
    if (queries.length >= MAX_V2_QUERIES) break;
    if (queries.some((x) => sameWords(x.text, q.text))) continue;
    queries.push(q);
  }
  return {
    level,
    product_identity: name || '',
    geography: market?.name ?? '',
    currency: market?.currency ?? '',
    queries,
    hypotheses,
  };
}
