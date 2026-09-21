// ══════════════════════════════════════════════════════════════════════════════
// VERIFIED_MARKET — AN EVIDENCE CLASS GETWORTH MINTS, NOT ONE A MODEL CLAIMS
//
// The blocker this closes: Phase B could find four genuine used listings for a
// photographed Ninja, compute ₪660 from them deterministically, and the guard
// still refused to price — because the guard's only class of market evidence
// was ANCHOR, a GetWorth catalog row carrying a price. Research-derived
// comparables are not that, and must never be relabelled as that: an ANCHOR
// satisfies every bucket entry requirement in the envelope table, so granting
// it to a set of marketplace listings would let four listings for a Rolex open
// the ₪250,000 watches:luxury bucket for a photographed watch STRAP.
//
// So this is a THIRD thing, sitting between them:
//
//   ANCHOR           GetWorth holds a priced row for this product.
//   VERIFIED_MARKET  GetWorth independently validated a quorum of diverse,
//                    identity-compatible, priced used listings for it.
//   (neither)        we are guessing.
//
// ── WHERE THE AUTHORITY COMES FROM ─────────────────────────────────────────
//
// Every check below runs on data the server can read for itself: a number, a
// currency string, a domain, and the listing TITLE. None of it consults the
// model's own opinion of its work. That is the whole point — `match.confidence`
// is a number OpenAI wrote about a listing OpenAI chose, and an architecture
// that treats it as qualification has simply moved "trust the model" behind a
// decimal point. It can still REJECT (a low self-reported match is a reason to
// drop a listing) but it can never ADMIT.
//
// The token is minted through a private WeakSet, exactly as `sealServerAuthority`
// mints pricing provenance, and for the same reason: membership cannot be
// forged, copied, or deserialised into existence. A model response containing
// `{"evidence_class":"VERIFIED_MARKET"}` produces an ordinary object that is not
// in the set, so it reads as absent. A caller passing `evidence: ['VERIFIED_MARKET']`
// asserts a string into an array nobody consults. This mirrors the round-3
// CRITICAL where `have.has('ANCHOR')` accepted the CALLER'S ASSERTION of a class
// rather than the evidence for it.
//
// NO IMPORT FROM api/_lib/phaseb/. The dependency runs the other way: Phase B
// imports this. The guard imports this. If this module imported Phase B, then
// `api/analyze.js` -> guard -> here -> phaseb/market-research -> openai-client
// would make the Phase-B provider reachable from the scan path, which §2
// forbids and which tests/refund-crossproduct.test.mjs (XP-PHASEB) fails on.
// ══════════════════════════════════════════════════════════════════════════════
import { ACCESSORY_NOUNS } from './pricing-authority.js';

/** The class name. A string for serialisation; never the thing that grants. */
export const VERIFIED_MARKET = 'VERIFIED_MARKET';

// ── THE QUORUM, AND WHY IT IS 3 ────────────────────────────────────────────
//
// Kept at 3 because that is what Phase B's own valuation already required
// (MIN_OBSERVATIONS_TO_PRICE), and moving it to fit a benchmark is the exact
// failure the order names. The reasoning for 3 is independent of any fixture:
//
//   1 listing  is one seller's asking price, which is a hope, not a market.
//   2 listings cannot disagree usefully — with two points every spread is
//              "the whole range", and there is no majority to be outside of.
//   3 listings is the smallest set with a middle. p50 is an actual observation
//              rather than an interpolation, one wrong listing cannot occupy
//              the median, and MAD outlier rejection has something to measure.
//
// It is a floor, not a target: three listings is thin evidence and the grade
// below says so. It is also why source diversity is required on top — three
// listings from one site is one site's opinion sampled three times.
export const VERIFIED_MARKET_QUORUM = 3;

/**
 * Distinct source domains required among the admitted set.
 *
 * §6: prevent fake confidence from duplicate marketplace evidence. Dedupe alone
 * does not do it — three genuinely different yad2 listings are three listings
 * and one market. Two domains is the smallest number that can disagree.
 *
 * LIMITATION, RECORDED RATHER THAN FAKED: the hosted research mechanism does
 * not reliably expose SELLER identity, so "same seller, two listings" is not
 * detectable here and is not claimed to be. Domain diversity is the weaker
 * property we can actually verify. See docs/PHASE_B_PRODUCTION_BLOCKERS.md.
 */
export const MIN_DISTINCT_SOURCES = 2;

/** The model's own match score can subtract, never add. */
export const SELF_REPORTED_MATCH_FLOOR = 0.6;

export const DISQUALIFIER = Object.freeze({
  NO_PRICE: 'no_usable_price',
  NO_CURRENCY: 'currency_ambiguous',
  UNVERIFIED_FX: 'foreign_currency_without_fx_proof',
  NO_PROVENANCE: 'no_source_provenance',
  NOT_USED: 'not_a_used_listing',
  PARTS_ONLY: 'parts_or_broken',
  BRAND_ABSENT: 'brand_not_named_in_listing',
  MODEL_ABSENT: 'no_distinctive_model_token_in_listing',
  IDENTITY_TOO_WEAK: 'listing_names_too_little_to_be_this_product',
  VARIANT_MISMATCH: 'listing_names_a_different_variant',
  QUALIFIER_MISMATCH: 'listing_names_a_different_model_qualifier',
  ACCESSORY_LISTING: 'listing_is_an_accessory_for_the_subject',
  HOST_PRODUCT_LISTING: 'listing_is_the_host_product_not_the_accessory',
  DUPLICATE: 'duplicate_listing',
  SELF_REPORTED_MISMATCH: 'model_reports_low_match_confidence',
  ASSERTED_AUTHORITY: 'listing_attempted_to_assert_authority',
});

/** Why a SET failed, as opposed to why one listing did. */
export const SET_FAILURE = Object.freeze({
  IDENTITY_INSUFFICIENT: 'subject_identity_below_product_level',
  NO_DISTINCTIVE_IDENTITY: 'subject_name_has_no_distinctive_token',
  QUORUM: 'below_observation_quorum',
  DIVERSITY: 'below_source_diversity_floor',
});

// ── Field names that only GetWorth may write ───────────────────────────────
//
// §16: a byte-perfect forged response must not supply its own authority. These
// are never READ anywhere in this file — qualification consults price,
// currency, domain and title, and nothing else — so their presence cannot grant
// anything even if this list were empty. The list exists to make the attempt
// FATAL rather than merely useless: a marketplace listing that carries a field
// called `price_authority` is not a marketplace listing, it is an injection
// attempt wearing one, and admitting its price while ignoring its claim would
// be trusting the part of it we happened not to look at.
const RESERVED_AUTHORITY_KEYS = new Set([
  'evidence_class', 'authority', 'verified_market', 'verified', 'pricing_meta',
  '_pricing_meta', 'guard_result', 'catalog_anchor', 'anchor', 'price_authority',
  'trusted', 'server_authority', 'evidence', 'validation',
]);

// ── Text normalisation ─────────────────────────────────────────────────────
//
// NFKD + combining-mark stripping, the same treatment `words()` in
// pricing-authority.js applies, so a listing cannot evade a token check with a
// zero-width joiner or a decorative diacritic.
const DECORATION = new RegExp('[\\p{M}\\u0640\\u200B-\\u200F\\u2060\\uFEFF]', 'gu');
const SPLIT = /[^\p{L}\p{N}]+/u;

function tokens(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(DECORATION, '')
    .toLowerCase()
    .split(SPLIT)
    .filter(Boolean);
}

// ── Model-name qualifiers ──────────────────────────────────────────────────
//
// Two jobs, and they are opposite jobs, which is why one list serves both.
//
// They EARN NOTHING. "Pro" appears on a blender, a mouse, a phone and a
// monitor; a listing that matched only "Pro" has told us nothing about which
// product it is. Scoring them would let "Ninja Pro anything" corroborate a
// Ninja Detect Power Blender Pro.
//
// They CONFLICT. Within a product line these words are precisely what separates
// siblings — MacBook Air from MacBook Pro, Watch SE from Watch Ultra. So a
// listing naming a DIFFERENT member of this family than the subject does is
// naming a different product, and that is a disqualification rather than a
// missing point. A word that carries no positive information can still carry
// negative information, and treating the two as the same property is how
// "generic token" quietly became "ignore this token".
const QUALIFIERS = new Set([
  'pro', 'plus', 'max', 'mini', 'ultra', 'lite', 'air', 'se', 'xl', 'xs',
  'power', 'premium', 'standard', 'basic', 'classic', 'sport', 'edition',
  'series', 'gen', 'generation', 'nano', 'super',
]);

/** Dimensions where a stated difference means a different product. */
const DIMENSIONS = [
  { name: 'storage', re: /^(\d+)(gb|tb)$/ },
  { name: 'volume', re: /^(\d+)(ml|l)$/ },
  { name: 'length', re: /^(\d+)(mm|cm|inch|in)$/ },
  { name: 'power', re: /^(\d+)(w|kw)$/ },
];

function dimensionsOf(toks) {
  const found = new Map();
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    for (const d of DIMENSIONS) {
      const m = d.re.exec(t);
      if (m) { if (!found.has(d.name)) found.set(d.name, new Set()); found.get(d.name).add(`${m[1]}${m[2]}`); }
    }
    // "100 ml" arrives as two tokens once punctuation is split away.
    const next = toks[i + 1];
    if (next && /^\d+$/.test(t)) {
      for (const d of DIMENSIONS) {
        const m = d.re.exec(`${t}${next}`);
        if (m) { if (!found.has(d.name)) found.set(d.name, new Set()); found.get(d.name).add(`${m[1]}${m[2]}`); }
      }
    }
  }
  return found;
}

/**
 * The brand names this listing could be using.
 *
 * A multi-word brand's initialism is a real brand name in a marketplace title —
 * "LV Imagination", "YSL Libre", "CK One" — and refusing to read it does not
 * make the system safer, it makes it blind to how people actually write. The
 * rule is mechanical (first letters of the words, two or more) rather than a
 * list of brands, so it neither needs maintaining nor grows a favourite.
 *
 * NOT COVERED, and deliberately not faked: transliteration. A yad2 title
 * reading "בלנדר נינג׳ה" is naming Ninja in Hebrew letters, and no deterministic
 * rule here recognises it. Such listings are held out of the quorum rather than
 * guessed at, which costs evidence and keeps the claim true.
 */
function brandForms(brand) {
  const parts = tokens(brand);
  if (parts.length === 0) return [];
  const forms = [parts];
  if (parts.length >= 2) forms.push([parts.map((p) => p[0]).join('')]);
  return forms;
}

/** Does `toks` contain this exact token sequence? */
function containsSequence(toks, seq) {
  if (seq.length === 0) return false;
  for (let i = 0; i + seq.length <= toks.length; i += 1) {
    let ok = true;
    for (let j = 0; j < seq.length; j += 1) if (toks[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/**
 * The subject's identifying vocabulary, derived once per qualification.
 *
 * `distinctive` is the model's tokens minus the qualifiers and minus the words
 * that merely restate what kind of thing it is. "Detect Power Blender Pro" on a
 * blender reduces to {detect}: power and pro qualify anything, blender is the
 * object class, and what is left is the one word that makes this that blender.
 */
export function subjectVocabulary(subject = {}) {
  const brand = subject.brand ?? null;
  const model = subject.model ?? null;
  const classToks = new Set([
    ...tokens(subject.object_class),
    ...tokens(subject.category_candidate ?? subject.category),
  ]);
  const modelToks = tokens(model);
  const distinctive = modelToks.filter((t) => !QUALIFIERS.has(t) && !classToks.has(t));
  return {
    brand,
    model,
    brand_forms: brandForms(brand),
    model_tokens: modelToks,
    distinctive,
    qualifiers: modelToks.filter((t) => QUALIFIERS.has(t)),
    class_tokens: [...classToks],
    variant_dimensions: dimensionsOf([...tokens(subject.variant), ...modelToks]),
    subject_is_accessory: [...tokens(subject.object_class), ...tokens(subject.product_name)]
      .some((t) => ACCESSORY_NOUNS.has(t)),
    accessory_tokens: [...tokens(subject.object_class), ...tokens(subject.product_name), ...modelToks]
      .filter((t) => ACCESSORY_NOUNS.has(t)),
  };
}

// ── New-retail and parts markers, read off the title ───────────────────────
//
// "כמו חדש" is LIKE NEW — a used listing in good condition, and the single most
// common phrase in Hebrew second-hand listings. "חדש" alone is NEW. A substring
// test for the word would reject exactly the listings we most want, so the
// negation is checked first, the same shape as the packaging-reference rule in
// pricing-authority.js. Getting this backwards would not fail loudly; it would
// quietly shrink every Hebrew quorum below the floor.
const LIKE_NEW = [['כמו', 'חדש'], ['like', 'new'], ['as', 'new'], ['open', 'box']];
const NEW_RETAIL = [['new'], ['brand', 'new'], ['sealed'], ['חדש'], ['באריזה'], ['חדשה']];
const PARTS = [['parts'], ['spare'], ['broken'], ['faulty'], ['repair'], ['לחלקים'], ['תקול'], ['שבור']];

function namesAny(toks, phrases) {
  return phrases.some((p) => containsSequence(toks, p));
}

/** Does any key in this object — at any bounded depth — claim authority? */
function assertsAuthority(value, depth = 0) {
  if (depth > 4 || !value || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value)) {
    if (RESERVED_AUTHORITY_KEYS.has(k.toLowerCase())) return true;
    if (assertsAuthority(v, depth + 1)) return true;
  }
  return false;
}

// ── The mint ───────────────────────────────────────────────────────────────
const MARKET_AUTHORITY = new WeakSet();

/** Was this token minted here, by qualification, on this server, this request? */
export function isMarketEvidence(value) {
  return typeof value === 'object' && value !== null && MARKET_AUTHORITY.has(value);
}

/** The token, or null. A forgery degrades to "absent", never to an error. */
export function readMarketEvidence(value) {
  return isMarketEvidence(value) ? value : null;
}

/** Does this guard context carry verified market evidence? */
export function hasVerifiedMarket(ctx) {
  return readMarketEvidence(ctx?.market_evidence) !== null;
}

/**
 * Qualify a set of observations as VERIFIED_MARKET, or explain why not.
 *
 * Returns a report in every case. `token` is non-null only when the whole set
 * qualified, and it is the ONLY thing that grants anything; the rest of the
 * report is for humans and tests.
 *
 * Total: any shape of input yields a report and never throws. An empty or
 * malformed input is "not qualified", which is the fail-closed direction.
 */
export function qualifyMarketEvidence({ observations = [], subject = {}, fxProofs = null } = {}) {
  // `subject: null` is not the same as an omitted subject, and a default
  // parameter does not catch it. Totality is a property this function claims.
  const vocab = subjectVocabulary(subject && typeof subject === 'object' ? subject : {});
  const admitted = [];
  const disqualified = [];
  const reject = (observation, reason) => { disqualified.push({ observation, reason }); };

  // ── SET-LEVEL GATES, BEFORE ANY LISTING IS LOOKED AT ─────────────────────
  //
  // §7: market authority must never repair weak product identity. The cleanest
  // way to guarantee that is to refuse to qualify at all when the subject is
  // not known at product level — because "compatible with the subject" is not a
  // question that HAS an answer when the subject is "an LG monitor". Three
  // listings for an LG 27GP850 are three listings for a product we have no
  // reason to believe is the one in the photograph.
  //
  // So the direction of information is fixed by construction: identity gates
  // market evidence, and market evidence never feeds back into identity.
  const setFailures = [];
  if (!vocab.brand || !vocab.model) setFailures.push(SET_FAILURE.IDENTITY_INSUFFICIENT);
  else if (vocab.distinctive.length === 0) setFailures.push(SET_FAILURE.NO_DISTINCTIVE_IDENTITY);

  if (setFailures.length > 0) {
    return Object.freeze({
      qualified: false, token: null, admitted: [], disqualified: [],
      set_failures: setFailures, vocabulary: vocab,
      counts: { considered: Array.isArray(observations) ? observations.length : 0, admitted: 0, disqualified: 0 },
      distinct_sources: 0,
    });
  }

  const seen = new Set();

  for (const o of Array.isArray(observations) ? observations : []) {
    if (!o || typeof o !== 'object') continue;

    if (assertsAuthority(o)) { reject(o, DISQUALIFIER.ASSERTED_AUTHORITY); continue; }

    // ── Price and currency ───────────────────────────────────────────────
    const price = typeof o.observed_price === 'number' && Number.isFinite(o.observed_price) && o.observed_price > 0
      ? o.observed_price : null;
    if (price === null) { reject(o, DISQUALIFIER.NO_PRICE); continue; }

    const currency = typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : '';
    if (!currency) { reject(o, DISQUALIFIER.NO_CURRENCY); continue; }

    // §9: ILS enters directly. Anything else needs a V-FX proof whose arithmetic
    // this function re-does. No model-authored implicit conversion, and no
    // "$500 -> ₪500" by way of a missing branch.
    let ils = null;
    if (currency === 'ILS') {
      ils = price;
    } else {
      const proof = fxProof(o, fxProofs);
      if (!proof) { reject(o, DISQUALIFIER.UNVERIFIED_FX); continue; }
      ils = proof.normalized_amount;
    }

    // ── Provenance ───────────────────────────────────────────────────────
    const domain = normalizeDomain(o.source_domain ?? o.source);
    const reference = o.listing_id_or_reference ?? o.source ?? null;
    if (!domain || !reference) { reject(o, DISQUALIFIER.NO_PROVENANCE); continue; }

    // ── The model's own opinion: subtract only ───────────────────────────
    const selfMatch = typeof o.match?.confidence === 'number' ? o.match.confidence : null;
    if (selfMatch !== null && selfMatch < SELF_REPORTED_MATCH_FLOOR) {
      reject(o, DISQUALIFIER.SELF_REPORTED_MISMATCH); continue;
    }
    const kind = String(o.listing_kind ?? 'unknown');
    if (kind === 'new_retail') { reject(o, DISQUALIFIER.NOT_USED); continue; }
    if (kind === 'parts_only' || kind === 'broken') { reject(o, DISQUALIFIER.PARTS_ONLY); continue; }
    if (kind === 'accessory') { reject(o, DISQUALIFIER.ACCESSORY_LISTING); continue; }

    // ── Everything from here reads the TITLE, which the server can check ──
    const toks = tokens(o.title);

    if (!namesAny(toks, LIKE_NEW) && namesAny(toks, NEW_RETAIL)) { reject(o, DISQUALIFIER.NOT_USED); continue; }
    if (namesAny(toks, PARTS)) { reject(o, DISQUALIFIER.PARTS_ONLY); continue; }

    const verdict = identityCompatibility(toks, vocab);
    if (verdict !== null) { reject(o, verdict); continue; }

    // ── Dedupe, AFTER compatibility so the counts describe real candidates ─
    //
    // Three keys, because §15 asks for three different repeats. A stable
    // listing reference collapses the same listing seen twice. Domain+title+price
    // collapses a repost. Domain+price collapses the SAME LISTING RE-TITLED,
    // which the first two miss and which is the cheapest way to manufacture a
    // quorum out of one advert.
    //
    // THE TITLE KEY CARRIES THE PRICE, and the first version did not. Without
    // it, two different sellers on the same site listing the same product — who
    // of course write the same title, because it is the product's name — were
    // collapsed into one, and the rule that exists to stop one advert becoming
    // a quorum was quietly deleting real evidence instead. Identical title AND
    // identical price on one domain is a repost; identical title alone is just
    // a product with a name.
    const keys = [
      `ref:${domain}|${String(reference).toLowerCase()}`,
      `t:${domain}|${toks.join(' ').slice(0, 80)}|${ils}`,
      `p:${domain}|${ils}`,
    ];
    if (keys.some((k) => seen.has(k))) { reject(o, DISQUALIFIER.DUPLICATE); continue; }
    for (const k of keys) seen.add(k);

    admitted.push(Object.freeze({
      source_domain: domain,
      listing_id_or_reference: o.listing_id_or_reference ?? null,
      title: o.title ?? null,
      observed_price: price,
      currency,
      normalized_ils_price: ils,
      condition: o.condition ?? null,
      observed_at: o.observed_at ?? null,
      listing_kind: kind,
    }));
  }

  const sources = new Set(admitted.map((a) => a.source_domain));
  if (admitted.length < VERIFIED_MARKET_QUORUM) setFailures.push(SET_FAILURE.QUORUM);
  if (sources.size < MIN_DISTINCT_SOURCES) setFailures.push(SET_FAILURE.DIVERSITY);

  const counts = {
    considered: Array.isArray(observations) ? observations.length : 0,
    admitted: admitted.length,
    disqualified: disqualified.length,
  };

  if (setFailures.length > 0) {
    return Object.freeze({
      qualified: false, token: null, admitted, disqualified,
      set_failures: setFailures, vocabulary: vocab, counts, distinct_sources: sources.size,
    });
  }

  // The token carries the PRICES, so a consumer cannot hand the guard a token
  // minted from one set of listings beside a distribution computed from
  // another. What granted the authority and what the number was computed from
  // are the same frozen array.
  const token = Object.freeze({
    class: VERIFIED_MARKET,
    observation_count: admitted.length,
    distinct_sources: sources.size,
    sources: Object.freeze([...sources].sort()),
    subject: Object.freeze({ brand: vocab.brand, model: vocab.model }),
    prices_ils: Object.freeze(admitted.map((a) => a.normalized_ils_price).sort((a, b) => a - b)),
    observations: Object.freeze(admitted),
  });
  MARKET_AUTHORITY.add(token);

  return Object.freeze({
    qualified: true, token, admitted, disqualified,
    set_failures: [], vocabulary: vocab, counts, distinct_sources: sources.size,
  });
}

/**
 * Is this listing about the subject? Returns a disqualifier, or null to admit.
 *
 * SCORED, NOT ALL-OR-NOTHING. Requiring every model token would reject
 * "Ninja Detect blender" — a correct, typical marketplace title for the exact
 * product — because real listings drop words. Requiring only one would admit
 * "Logitech G305" against a G Pro X Superlight. So: the brand is worth a point,
 * each distinctive model token is worth a point, two points are needed, and at
 * least one of them must be a model token. A brand alone can never reach the
 * floor, which is §7 restated arithmetically — generic brand comps cannot
 * obtain exact-model authority no matter how many of them there are.
 */
function identityCompatibility(toks, vocab) {
  // ── The accessory/host direction, checked BEFORE scoring ───────────────
  //
  // §8's witness: the photograph is a replacement strap, and the market is full
  // of Rolex Submariners. Those listings name the brand and the model
  // perfectly — scoring alone admits every one of them and prices a ₪200 strap
  // as a ₪40,000 watch. What separates them is the noun: the subject is a
  // strap, and a listing that does not say strap is selling the watch.
  if (vocab.subject_is_accessory) {
    const namesTheAccessory = vocab.accessory_tokens.some((t) => toks.includes(t));
    if (!namesTheAccessory) return DISQUALIFIER.HOST_PRODUCT_LISTING;
  } else {
    // The mirror image: the subject is the product, and the listing is a part
    // for it. "Ninja blender replacement blade" names brand and model and is
    // worth a tenth of the thing photographed.
    const listingAccessory = toks.find((t) => ACCESSORY_NOUNS.has(t));
    if (listingAccessory && !vocab.model_tokens.includes(listingAccessory)
        && !vocab.class_tokens.includes(listingAccessory)) {
      return DISQUALIFIER.ACCESSORY_LISTING;
    }
  }

  // ── Qualifier conflict ─────────────────────────────────────────────────
  const listingQualifiers = toks.filter((t) => QUALIFIERS.has(t));
  const subjectQualifiers = new Set(vocab.qualifiers);
  if (subjectQualifiers.size > 0 && listingQualifiers.length > 0
      && !listingQualifiers.some((q) => subjectQualifiers.has(q))) {
    return DISQUALIFIER.QUALIFIER_MISMATCH;
  }

  // ── Dimension conflict ─────────────────────────────────────────────────
  //
  // Only a STATED difference disqualifies. A title that omits the size is not
  // claiming a different size, and treating silence as conflict would reject
  // most honest listings.
  const listingDims = dimensionsOf(toks);
  for (const [dim, wanted] of vocab.variant_dimensions) {
    const got = listingDims.get(dim);
    if (!got) continue;
    if (![...got].some((v) => wanted.has(v))) return DISQUALIFIER.VARIANT_MISMATCH;
  }

  // ── Score ──────────────────────────────────────────────────────────────
  const brandNamed = vocab.brand_forms.some((form) => containsSequence(toks, form));
  const modelHits = vocab.distinctive.filter((t) => toks.includes(t));
  if (modelHits.length === 0) return DISQUALIFIER.MODEL_ABSENT;
  const score = (brandNamed ? 1 : 0) + modelHits.length;
  if (score < 2) return DISQUALIFIER.IDENTITY_TOO_WEAK;
  return null;
}

/** A host, lowercased, without a leading www. Empty-ish input yields null. */
function normalizeDomain(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/^www\./, '');
  return host.includes('.') ? host : null;
}

/**
 * The V-FX proof for a foreign-currency observation, re-checked here.
 *
 * §9 lists seven fields, and all seven are required — but the one that makes
 * this a proof rather than a form is the arithmetic: `normalized_amount` must
 * actually equal `original_amount * rate`. A proof whose own numbers disagree
 * is a fabricated proof, and the shape of it would otherwise pass every
 * presence check.
 *
 * NO FX SOURCE EXISTS IN THIS PHASE, so in practice this returns null for
 * every observation and foreign listings never enter a quorum. The mechanism is
 * here so that wiring a rate source later is a matter of supplying proofs, not
 * of relaxing a rule under deadline.
 */
function fxProof(observation, fxProofs) {
  const proof = observation?.fx_proof
    ?? (fxProofs && typeof fxProofs === 'object'
      ? fxProofs[observation?.listing_id_or_reference]
      : null);
  if (!proof || typeof proof !== 'object') return null;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const amount = num(proof.original_amount);
  const rate = num(proof.rate);
  const normalized = num(proof.normalized_amount);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  if (!amount || !rate || !normalized) return null;
  if (!str(proof.original_currency) || !str(proof.source) || !str(proof.timestamp)) return null;
  if (str(proof.normalized_currency) !== 'ILS') return null;
  if (str(proof.original_currency).toUpperCase() !== String(observation?.currency ?? '').toUpperCase()) return null;
  if (amount !== num(observation?.observed_price)) return null;
  // A tenth of an agora of slack for floating point, and nothing else.
  if (Math.abs(amount * rate - normalized) > 0.001) return null;

  return { normalized_amount: normalized, rate, source: proof.source, timestamp: proof.timestamp };
}
