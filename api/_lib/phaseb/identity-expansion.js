// ══════════════════════════════════════════════════════════════════════════════
// PHASE B — IDENTITY EXPANSION, THE QUERY PLAN, AND WHAT THE WEB TAUGHT US
//
// THE DEFECT. Phase B identified a product and then searched the market with
// five of the fields it had: object class, brand, family, model, variant. The
// identifiers it read, the commercial name, the other text on the item, the
// names Phase A had given it in two languages and everything known about what
// the object looks like were produced, paid for, and dropped one line before
// the search. The words printed largest on an item are not necessarily the
// words a marketplace indexes it under.
//
// Three things live here, and none of them is an authority:
//
//   buildIdentityContext     everything known about the subject, each value
//                            carrying where it came from
//   enforceQueryPlan         at most five queries, one per PURPOSE, and a
//                            purpose only when its evidence exists
//   assessIdentityDiscovery  names and identifiers the search results showed,
//                            bound to the page that showed them
//
// ── NOTHING HERE CAN PRICE ANYTHING ─────────────────────────────────────────
//
// An expanded identity decides what is SEARCHED. It does not decide what is
// ADMITTED: qualification still reads the subject Phase B established and the
// listing's own title, exactly as before, and nothing in this file is passed
// to it. A discovered model number is recorded and is not an identity token.
//
// No product, brand or marketplace is named anywhere in this file.
// ══════════════════════════════════════════════════════════════════════════════
import { hostOf } from './search-provenance.js';

export const QUERY_PURPOSE = Object.freeze({
  EXACT_IDENTITY: 'EXACT_IDENTITY',
  MODEL_NUMBER: 'MODEL_NUMBER',
  LOCAL_SECOND_HAND: 'LOCAL_SECOND_HAND',
  ALIAS_OR_REGIONAL: 'ALIAS_OR_REGIONAL',
  GENERIC_COMPARABLE: 'GENERIC_COMPARABLE',
});
export const MAX_QUERIES = 5;

export const SOURCE = Object.freeze({
  PHASE_B_IMAGE: 'phase_b_identity',        // Phase B's reading of the photograph
  PHASE_B_KNOWLEDGE: 'phase_b_model_knowledge', // the model's memory: unverified
  PHASE_A: 'phase_a_recognition',           // forwarded by the client: a hint
  OCR: 'ocr',
});

export const QUERY_DROPPED = Object.freeze({
  UNKNOWN_PURPOSE: 'unknown_purpose',
  NO_EVIDENCE: 'purpose_has_no_supporting_evidence',
  IDENTIFIER_ABSENT: 'query_does_not_contain_the_observed_identifier',
  DUPLICATE_PURPOSE: 'purpose_already_used',
  DUPLICATE_TEXT: 'same_text_as_an_earlier_query',
  DISPUTED_MODEL: 'identity_disputed_model_may_not_be_searched',
  EMPTY: 'empty_query',
  OVER_BUDGET: 'over_query_budget',
});

const clean = (v, max = 120) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s && s.toLowerCase() !== 'unidentified' ? s.slice(0, max) : null;
};
const list = (v, max, len = 60) => [...new Set((Array.isArray(v) ? v : [])
  .map((x) => clean(x, len)).filter(Boolean))].slice(0, max);
const words = (v) => String(v ?? '').normalize('NFKC').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const sameWords = (a, b) => {
  const x = new Set(words(a));
  const y = new Set(words(b));
  return x.size === y.size && [...x].every((w) => y.has(w));
};

// Regulatory marks, ratings and origin lines: text that is on every item of a
// kind and therefore identifies none of them.
const BOILERPLATE = /^(ce|fcc|rohs|ukca|ul|made in .*|designed in .*|warning.*|caution.*|warranty.*|model|serial|s\/n|www\..*|https?:.*)$/i;
const RATING = /^\d+([.,]\d+)?\s?(w|kw|v|a|ma|mah|hz|ml|l|kg|g|mm|cm|oz|rpm)$/i;

/** Text on the item that says something the name does not already say. */
function distinctiveText(lines, known) {
  const knownWords = new Set(known.flatMap(words));
  const out = [];
  for (const { value, source } of lines) {
    const text = clean(value, 48);
    if (!text || BOILERPLATE.test(text) || RATING.test(text)) continue;
    const w = words(text);
    if (w.length === 0 || w.length > 5) continue;
    if (w.every((t) => knownWords.has(t) || t.length < 3 || /^\d+$/.test(t))) continue;
    if (out.some((o) => sameWords(o.value, text))) continue;
    out.push({ value: text, source });
    if (out.length >= 6) break;
  }
  return out;
}

const tagged = (value, source) => (value ? { value, source } : null);

/**
 * Everything known about the subject, with provenance.
 *
 * Total, and tolerant of absence: a generic shelf yields a context whose brand,
 * model and identifiers are null and whose attributes carry the description.
 * That is a complete context, not a degraded one.
 *
 * OCR text is included only when the block-provenance rule permits it to speak
 * for the SUBJECT (`corroboration.subject_text_permitted`). A reference-bearing
 * block — packaging that names a host product — contributes nothing here, for
 * the same reason it may not corroborate the subject.
 */
export function buildIdentityContext({
  identity = null, existingRecognition = null, ocrText = null, corroboration = null,
} = {}) {
  const s = identity?.subject || {};
  const a = (existingRecognition && typeof existingRecognition === 'object') ? existingRecognition : {};
  const ids = s.identifiers || {};

  const brand = clean(s.brand);
  const commercial = clean(s.product_name);
  const modelName = clean(s.model);

  const identifiers = {
    model_number: tagged(clean(ids.model_number, 48), SOURCE.PHASE_B_IMAGE)
      || tagged(clean(a.model_number, 48), SOURCE.PHASE_A),
    mpn: tagged(clean(ids.mpn, 48), SOURCE.PHASE_B_IMAGE),
    sku: tagged(clean(ids.sku, 48), SOURCE.PHASE_B_IMAGE),
  };

  // ALIASES are other names for THIS product. `alternatives` are other
  // PRODUCTS it might be, and are kept apart: searching an alternative
  // retrieves a different item's market.
  const aliases = [];
  const regional = [];
  const addAlias = (bucket, value, source) => {
    const v = clean(value);
    if (!v) return;
    if ([commercial, modelName, [brand, modelName].filter(Boolean).join(' ')].some((k) => k && sameWords(k, v))) return;
    if ([...aliases, ...regional].some((x) => sameWords(x.value, v))) return;
    if (bucket.length < 6) bucket.push({ value: v, source });
  };
  addAlias(aliases, a.full_name, SOURCE.PHASE_A);
  addAlias(regional, a.full_name_hebrew, SOURCE.PHASE_A);
  for (const k of Array.isArray(identity?.known_aliases) ? identity.known_aliases : []) {
    addAlias(k?.kind === 'regional_name' ? regional : aliases, k?.value, SOURCE.PHASE_B_KNOWLEDGE);
  }

  const textPermitted = corroboration?.subject_text_permitted === true;
  const lines = [
    ...(Array.isArray(identity?.evidence) ? identity.evidence : [])
      .filter((e) => e?.type === 'visible_text' || e?.type === 'label' || e?.type === 'logo')
      .map((e) => ({ value: e.value, source: SOURCE.PHASE_B_IMAGE })),
    ...(textPermitted ? [
      ...(Array.isArray(ocrText) ? ocrText : []).map((value) => ({ value, source: SOURCE.OCR })),
      ...list(a.labels_detected, 12).map((value) => ({ value, source: SOURCE.PHASE_A })),
      ...list(a.logos_detected, 12).map((value) => ({ value, source: SOURCE.PHASE_A })),
    ] : []),
  ];

  // ATTRIBUTES: what the object looks like. Phase B's own reading first, Phase
  // A's as a fallback, and null wherever neither saw anything. Nothing is
  // filled in: an unknown dimension stays unknown.
  const pb = identity?.attributes || {};
  const pa = (a.visual_features && typeof a.visual_features === 'object') ? a.visual_features : {};
  const pickList = (x, y) => (list(x, 6, 32).length
    ? { values: list(x, 6, 32), source: SOURCE.PHASE_B_IMAGE }
    : (list(y, 6, 32).length ? { values: list(y, 6, 32), source: SOURCE.PHASE_A } : { values: [], source: null }));
  const pickOne = (x, y) => tagged(clean(x, 48), SOURCE.PHASE_B_IMAGE) || tagged(clean(y, 48), SOURCE.PHASE_A);
  const attributes = {
    materials: pickList(pb.materials, pa.materials),
    colors: pickList(pb.colors, pa.colors),
    finish: pickOne(pb.finish, pa.finish),
    shape: pickOne(pb.shape, pa.shape),
    dimensions: tagged(clean(pb.dimensions, 48), SOURCE.PHASE_B_IMAGE),
    style: tagged(clean(pb.style, 48), SOURCE.PHASE_B_IMAGE),
    distinctive: { values: list(pb.distinctive, 6, 40), source: list(pb.distinctive, 6, 40).length ? SOURCE.PHASE_B_IMAGE : null },
  };

  return {
    object_class: clean(s.object_class),
    category: clean(s.category_candidate) || clean(a.category),
    brand,
    commercial_name: commercial,
    family: clean(s.family),
    model_name: modelName,
    variant: clean(s.variant),
    identifiers,
    aliases,
    regional_names: regional,
    visible_text: distinctiveText(lines, [brand, commercial, modelName].filter(Boolean)),
    attributes,
    alternatives: (Array.isArray(identity?.alternatives) ? identity.alternatives : []).slice(0, 6)
      .map((x) => ({ brand: clean(x?.brand), model: clean(x?.model), confidence: x?.confidence ?? null }))
      .filter((x) => x.brand || x.model),
    ambiguities: list(identity?.ambiguities, 8, 120),
    confidence: identity?.confidence?.overall ?? null,
    is_generic: !brand,
  };
}

/** The identifiers that were OBSERVED, as plain strings. */
export function observedIdentifiers(ctx) {
  return ['model_number', 'mpn', 'sku'].map((k) => ctx?.identifiers?.[k]?.value).filter(Boolean);
}

/** Does any describable attribute exist? */
function hasAttributes(ctx) {
  const t = ctx?.attributes || {};
  return !!(t.materials?.values?.length || t.colors?.values?.length || t.distinctive?.values?.length
    || t.finish || t.shape || t.dimensions || t.style);
}

/**
 * Which purposes does the evidence support?
 *
 * `disputed` is the identity-reconciliation cap: two readings of one
 * photograph named different models, so no query may assert a model.
 */
export function supportedPurposes(ctx, { disputed = false } = {}) {
  const P = QUERY_PURPOSE;
  const out = new Set();
  if (!ctx) return out;
  const named = !!(ctx.brand && (ctx.model_name || ctx.commercial_name || ctx.family));
  if (named && !disputed) out.add(P.EXACT_IDENTITY);
  if (observedIdentifiers(ctx).length > 0 && !disputed) out.add(P.MODEL_NUMBER);
  if ((ctx.aliases.length > 0 || ctx.regional_names.length > 0) && !disputed) out.add(P.ALIAS_OR_REGIONAL);
  if (ctx.object_class || ctx.brand) out.add(P.LOCAL_SECOND_HAND);
  if (ctx.object_class) out.add(P.GENERIC_COMPARABLE);
  return out;
}

const contains = (text, needle) => {
  const t = words(text).join(' ');
  const n = words(needle).join(' ');
  return !!n && ` ${t} `.includes(` ${n} `);
};

/**
 * Turn the model's proposed queries into the plan that will actually run.
 *
 * The MODEL WRITES THE WORDS; THE SERVER DECIDES WHICH QUERIES EXIST. That is
 * the same split §13 makes for the search intent as a whole: what the model
 * returns is a proposal, and generating a query buys no right to have it run.
 *
 * A pre-plan response — `search_terms` with no purposes — is read as a single
 * LOCAL_SECOND_HAND proposal per term, so it is bounded by the same rules.
 */
export function enforceQueryPlan(rawQuery, ctx, { disputed = false, disputedModel = null } = {}) {
  const proposed = Array.isArray(rawQuery?.queries)
    ? rawQuery.queries
    : (Array.isArray(rawQuery?.search_terms)
      ? rawQuery.search_terms.map((text) => ({ purpose: QUERY_PURPOSE.LOCAL_SECOND_HAND, text }))
      : []);
  const allowed = supportedPurposes(ctx, { disputed });
  const ids = observedIdentifiers(ctx);
  const queries = [];
  const dropped = [];
  const drop = (q, reason) => dropped.push({ purpose: q?.purpose ?? null, text: clean(q?.text, 160), reason });

  for (const q of proposed) {
    const text = clean(q?.text, 160);
    const purpose = String(q?.purpose ?? '');
    if (!text) { drop(q, QUERY_DROPPED.EMPTY); continue; }
    if (!Object.values(QUERY_PURPOSE).includes(purpose)) { drop(q, QUERY_DROPPED.UNKNOWN_PURPOSE); continue; }
    if (!allowed.has(purpose)) { drop(q, QUERY_DROPPED.NO_EVIDENCE); continue; }
    if (disputed && disputedModel && contains(text, disputedModel)) { drop(q, QUERY_DROPPED.DISPUTED_MODEL); continue; }
    if (purpose === QUERY_PURPOSE.MODEL_NUMBER && !ids.some((id) => contains(text, id))) {
      drop(q, QUERY_DROPPED.IDENTIFIER_ABSENT); continue;
    }
    if (queries.some((x) => x.purpose === purpose)) { drop(q, QUERY_DROPPED.DUPLICATE_PURPOSE); continue; }
    if (queries.some((x) => sameWords(x.text, text))) { drop(q, QUERY_DROPPED.DUPLICATE_TEXT); continue; }
    if (queries.length >= MAX_QUERIES) { drop(q, QUERY_DROPPED.OVER_BUDGET); continue; }
    queries.push({ purpose, text });
  }
  return { queries, dropped, supported: [...allowed] };
}

// ══════════════════════════════════════════════════════════════════════════════
// THE LOCAL QUERY BUILDER  ·  a plan assembled from fields, not written by a model
//
// The query stage costs a provider round trip (5.8s, measured) to produce
// something that is mostly a rearrangement of fields the identity already
// holds. This builds the same plan without the call.
//
// WHAT IT CAN AND CANNOT DO. It can place a name, an identifier or an alias
// beside the market's own second-hand vocabulary. It cannot TRANSLATE: it has
// no words of its own, so an object class arrives in whatever language the
// identity stage wrote it in. For a branded product that does not matter, the
// name is the query. For a generic object it means the description is only as
// local as the identity was.
//
// The output is a PROPOSAL, exactly like the model's, and goes through the
// same enforceQueryPlan: one query per purpose, five at most, a purpose only
// where its evidence exists.
// ══════════════════════════════════════════════════════════════════════════════
export function localSpecificity(ctx) {
  if (ctx?.brand && ctx?.model_name) return 'exact_model';
  if (ctx?.brand && ctx?.family) return 'family';
  if (ctx?.brand && ctx?.object_class) return 'brand_category';
  return 'category_only';
}

export function buildLocalQuery(ctx, market) {
  const t = market?.terms || {};
  const join = (...parts) => parts.flat().map((x) => clean(x, 80)).filter(Boolean).join(' ');
  const withBrand = (name) => (ctx.brand && name && !words(name).includes(words(ctx.brand)[0])
    ? join(ctx.brand, name) : name);
  const name = ctx.commercial_name || withBrand(ctx.model_name || ctx.family);
  const id = observedIdentifiers(ctx)[0] ?? null;
  const other = ctx.regional_names[0]?.value ?? ctx.aliases[0]?.value ?? null;
  const a = ctx.attributes || {};
  const looks = [a.materials?.values?.[0], a.colors?.values?.[0], a.style?.value, a.distinctive?.values?.[0]]
    .filter(Boolean).slice(0, 3);

  const queries = [
    name && ctx.brand ? { purpose: QUERY_PURPOSE.EXACT_IDENTITY, text: join(name, t.price) } : null,
    id ? { purpose: QUERY_PURPOSE.MODEL_NUMBER, text: join(ctx.brand, id, t.second_hand) } : null,
    (name || ctx.object_class)
      ? { purpose: QUERY_PURPOSE.LOCAL_SECOND_HAND, text: join(name || ctx.object_class, t.second_hand, t.for_sale) } : null,
    other ? { purpose: QUERY_PURPOSE.ALIAS_OR_REGIONAL, text: join(other, t.second_hand) } : null,
    ctx.object_class
      ? { purpose: QUERY_PURPOSE.GENERIC_COMPARABLE, text: join(ctx.brand, ctx.object_class, looks, t.second_hand, t.price) } : null,
  ].filter(Boolean);

  return {
    product_identity: name || ctx.object_class || '',
    variant: ctx.variant ?? null,
    condition_target: 'used',
    geography: market?.name ?? '',
    currency: market?.currency ?? '',
    market: 'second_hand',
    specificity: localSpecificity(ctx),
    queries,
  };
}

// ── WHICH PLANNER WRITES THE PLAN ───────────────────────────────────────────
//
// Decided from the identity that already exists. No call is made to choose.
//
//   LOCAL   a brand and a model name are both established and undisputed. The
//           name IS the query, and the measured A/B on a real product found
//           the assembled plan retrieved at least what the written one did,
//           without the 5.8s provider round trip.
//   MODEL   everything else. An object with no brand is searched by a
//           description, and this builder cannot translate one; a disputed
//           model may not be named at all. Both keep the provider's planner.
//
// Conservative on purpose: when in doubt the older path runs, which costs
// time and never costs recall.
export const QUERY_PLANNER = Object.freeze({ AUTO: 'auto', MODEL: 'model' });

export function localPlanFor(ctx, market, { disputed = false, identity = null, planner = QUERY_PLANNER.AUTO } = {}) {
  if (planner !== QUERY_PLANNER.AUTO || disputed) return null;
  if (!ctx?.brand || !ctx?.model_name || !market?.terms) return null;
  const plan = planSearch(buildLocalQuery(ctx, market), ctx, { disputed: false, identity });
  return plan.queries.length > 0 ? { ...plan, planner: 'local' } : null;
}

/**
 * The search intent that will actually run.
 *
 * A DISPUTED MODEL MAY NOT BE SEARCHED AS IF IT WERE SETTLED. Applied here,
 * deterministically, after the model has answered — the query stage reasons
 * from Phase B's identity alone and cannot know Phase A proposed a different
 * family. The cap lowers the intent to brand + kind of object, and the plan
 * loses every query that names the disputed model.
 */
export function planSearch(data, ctx, { disputed = false, identity = null } = {}) {
  const plan = enforceQueryPlan(data, ctx, { disputed, disputedModel: identity?.subject?.model ?? null });
  const planned = {
    ...data,
    queries: plan.queries,
    queries_dropped: plan.dropped,
    search_terms: plan.queries.map((q) => q.text),
  };
  if (!disputed) return planned;
  return {
    ...planned,
    product_identity: [identity?.subject?.brand, identity?.subject?.object_class]
      .filter(Boolean).join(' ') || data?.product_identity,
    variant: null,
    specificity: 'brand_category',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// IDENTITY DISCOVERY  ·  what the search results called this product
//
// ZERO PRICE AUTHORITY, by construction rather than by promise:
//
//   - the schema this is parsed from has no price and no currency field;
//   - a claim whose value looks like a price is dropped here;
//   - the result is never handed to normalisation, qualification or valuation
//     (tests/identity-expansion.test.mjs holds the pipeline to that); and
//   - `qualification_authority` is the constant false on every claim.
//
// `corroborated` means two independent domains the search really reached
// showed the same value. It is a statement about the web, recorded so the
// next decision can be made from measurements. Today it unlocks nothing.
// ══════════════════════════════════════════════════════════════════════════════
export const DISCOVERY_KIND = Object.freeze([
  'canonical_name', 'model_number', 'mpn', 'sku', 'alias', 'regional_name',
]);
export const DISCOVERY_DROPPED = Object.freeze({
  NO_SEARCH: 'no_web_search_call',
  UNKNOWN_KIND: 'unknown_kind',
  EMPTY: 'empty_value',
  PRICE_LIKE: 'value_looks_like_a_price',
  UNBOUND: 'source_not_in_search_provenance',
});
export const MIN_DISCOVERY_DOMAINS = 2;

const PRICE_LIKE = /[₪$€£]|\b(ils|nis|usd|eur|gbp)\b|ש["״]?ח/i;
const sameSite = (x, y) => x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);

export function assessIdentityDiscovery(raw, provenance) {
  const claims = Array.isArray(raw?.claims) ? raw.claims : [];
  const dropped = [];
  const grouped = new Map();
  const reached = Array.isArray(provenance?.source_domains) ? provenance.source_domains : [];

  for (const c of claims.slice(0, 40)) {
    const value = clean(c?.value, 80);
    const kind = String(c?.kind ?? '');
    const drop = (reason) => dropped.push({ kind, value, reason });
    if (!provenance?.search_performed) { drop(DISCOVERY_DROPPED.NO_SEARCH); continue; }
    if (!DISCOVERY_KIND.includes(kind)) { drop(DISCOVERY_DROPPED.UNKNOWN_KIND); continue; }
    if (!value) { drop(DISCOVERY_DROPPED.EMPTY); continue; }
    if (PRICE_LIKE.test(value)) { drop(DISCOVERY_DROPPED.PRICE_LIKE); continue; }
    const domain = hostOf(c?.source_domain ?? c?.source_url);
    const site = domain ? reached.find((d) => sameSite(d, domain)) : null;
    if (!site) { drop(DISCOVERY_DROPPED.UNBOUND); continue; }

    const key = `${kind}|${words(value).join(' ')}`;
    const entry = grouped.get(key) || { kind, value, domains: new Set(), urls: [] };
    entry.domains.add(site);
    const url = clean(c?.source_url, 500);
    if (url && /^https?:\/\//i.test(url) && !entry.urls.includes(url) && entry.urls.length < 6) entry.urls.push(url);
    grouped.set(key, entry);
  }

  const out = [...grouped.values()].map((e) => Object.freeze({
    kind: e.kind,
    value: e.value,
    source_domains: Object.freeze([...e.domains].sort()),
    source_urls: Object.freeze(e.urls),
    corroborated: e.domains.size >= MIN_DISCOVERY_DOMAINS,
    trusted: false,
    qualification_authority: false,
    price_authority: false,
  }));
  const of = (kind) => out.filter((c) => c.kind === kind).map((c) => c.value);

  return Object.freeze({
    price_authority: false,
    qualification_authority: false,
    claims: Object.freeze(out),
    dropped: Object.freeze(dropped),
    canonical_names: of('canonical_name'),
    model_numbers: [...of('model_number'), ...of('mpn'), ...of('sku')],
    aliases: [...of('alias'), ...of('regional_name')],
    corroborated_count: out.filter((c) => c.corroborated).length,
  });
}
