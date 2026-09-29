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
import { sourceSite } from './source-site.js';
import { listingIdentity } from './listing-identity.js';
import { transliterates, scriptOf, SCRIPT } from './script-normalization.js';

/** The class name. A string for serialisation; never the thing that grants. */
export const VERIFIED_MARKET = 'VERIFIED_MARKET';

// ── THE THIRD CLASS: A GENERIC OBJECT'S OWN MARKET ─────────────────────────
//
// B-h, closed. The set-level gate below refuses to qualify anything whose
// subject is not known at product level, and the reasoning is sound for a
// BRANDED subject: "compatible with the subject" has no answer when the
// subject is "an LG monitor", because three listings for an LG 27GP850 are
// three listings for a product we have no reason to believe is in the frame.
//
// It is NOT the right question for an object that has no brand at all. A plain
// wooden desk has no model number to establish, its comparables are genuinely
// comparable, and refusing on IDENTITY grounds means a photograph with ample
// market evidence is declined for a reason that has nothing to do with the
// evidence. That is the catalog acting as a prerequisite, which the product
// vision forbids.
//
// So a generic subject gets its own class, and it is DELIBERATELY WEAKER:
//
//   VERIFIED_MARKET      this exact product's used market
//   VERIFIED_COMPARABLE  this KIND of object's used market
//
// It is minted into a SEPARATE registry, so every existing reader of
// VERIFIED_MARKET — `isMarketEvidence`, `hasVerifiedMarket`, the guard's
// envelope and verdict rules — sees a comparable token as ABSENT and nothing
// they permit changes. Widening the old class would have let a category-level
// estimate satisfy requirements written for product-level evidence; adding a
// class means the weaker evidence has to earn its own permissions.
//
// The price of the weaker identity is a HIGHER bar on everything else. A
// product-level set needs 3 listings across 2 domains, because the listings
// are about one product. A class-level set spans a whole category's spread —
// a desk is ₪150 or ₪1,500 depending on things a photograph may not show — so
// it needs more observations and more independent sources before a median
// means anything.
export const VERIFIED_COMPARABLE = 'VERIFIED_COMPARABLE';
export const COMPARABLE_QUORUM = 5;
export const MIN_COMPARABLE_SOURCES = 3;

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

// ── ONE CURRENCY, SEVERAL SPELLINGS ────────────────────────────────────────
//
// THE FIRST LIVE WITNESS OF THIS GATE. Six genuine Israeli listings, priced in
// shekels, were each refused as `foreign_currency_without_fx_proof`. The
// comparison below accepted the three letters "ILS" and nothing else, and a
// listing written for Israelis says "₪". Phase B's own filter had recognised
// the spellings all along, so the two readings disagreed about what a shekel
// is — and the stricter one was wrong, not careful.
//
// This table names the SAME currency several ways. It is not a relaxation:
// nothing is converted, no rate is involved, and a string that is not on it is
// exactly as foreign as it was. It is deliberately a closed list rather than a
// pattern — "anything containing ₪" would admit "₪/$", and a rule that guesses
// at a currency is the rule §9 exists to forbid.
//
// EXPORTED so there is one table. Phase B's filter imports it; a second copy is
// how this defect happened.
export const MARKET_CURRENCY = 'ILS';
const SHEKEL_FORMS = new Set([
  'ils', 'nis', 'shekel', '\u20AA',
  '\u05E9"\u05D7',        // shin, ASCII quotation mark, chet
  '\u05E9\u05F4\u05D7',   // shin, Hebrew gershayim, chet: how it is properly written
  '\u05E9\u05D7',         // shin, chet
]);

/** Is this string one of the ways a shekel is written? Exact match only. */
export function isShekel(raw) {
  return typeof raw === 'string' && SHEKEL_FORMS.has(raw.trim().toLowerCase());
}

/**
 * The currency a listing states, in one canonical spelling.
 *
 * A shekel form becomes 'ILS'. ANYTHING ELSE IS RETURNED AS WRITTEN (trimmed,
 * upper-cased) and is therefore still not 'ILS': an unrecognised string is
 * foreign, and foreign needs a V-FX proof. Empty or non-string input is ''.
 */
export function canonicalCurrency(raw) {
  if (typeof raw !== 'string') return '';
  return isShekel(raw) ? MARKET_CURRENCY : raw.trim().toUpperCase();
}

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
  IDENTIFIER_MISMATCH: 'listing_lacks_the_exact_model_identifier',
  NUMBER_MISMATCH: 'listing_does_not_name_the_model_number_beside_the_model',
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
  // The generic path's own failures, named separately so a reader can tell
  // "this product's market was thin" from "this CATEGORY's market was thin".
  COMPARABLE_QUORUM: 'below_comparable_quorum',
  COMPARABLE_DIVERSITY: 'below_comparable_source_floor',
  NO_OBJECT_CLASS: 'subject_has_no_object_class',
  BRANDED_WITHOUT_MODEL: 'branded_subject_without_model',
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

// ── THE QUALIFIERS THAT NAME A SIBLING ─────────────────────────────────────
//
// A subset of the list above, and a stricter rule. "Edition" and "series" are
// decoration. These are not: a listing that says Pro, Ultra or Max is naming a
// DIFFERENT, usually dearer, member of the family, whether or not the subject
// carries a qualifier of its own. The older rule only fired when the subject
// had a qualifier to disagree with, so a plain model admitted its own Pro.
const SIBLING_QUALIFIERS = new Set([
  'pro', 'plus', 'max', 'mini', 'ultra', 'lite', 'air', 'nano', 'xl', 'xs', 'se', 'fe',
]);

/** Words a localized alias must be corroborated on before it counts. */
export const MIN_ALIAS_SITES = 2;
/** A brand is worth one point and can never qualify alone, so its bar is lower. */
const MIN_BRAND_SKELETON = 2;
const MIN_MODEL_SKELETON = 3;

export const ALIAS_PROVENANCE = Object.freeze({
  TRANSLITERATION: 'DETERMINISTIC_TRANSLITERATION',
  WEB: 'WEB_CORROBORATED',
});

const hasDigit = (t) => /\p{N}/u.test(t);
const isNumber = (t) => /^\p{N}+$/u.test(t);

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
    // IDENTIFIERS AND NUMBERS ARE EXACT. "G502" is not "G503" and the 5 in a
    // console's name is not a 4. Neither is ever transliterated or fuzzily
    // matched; sizes are left to the dimension rule above, which treats
    // silence as silence.
    identifier_tokens: distinctive.filter((t) => hasDigit(t) && !isNumber(t)
      && !DIMENSIONS.some((d) => d.re.test(t))),
    number_tokens: modelToks.map((t, i) => ({ t, i })).filter(({ t }) => isNumber(t))
      .map(({ t, i }) => ({ number: t, before: modelToks[i - 1] ?? null, after: modelToks[i + 1] ?? null })),
    sibling_qualifiers: [...tokens(subject.variant), ...modelToks].filter((t) => SIBLING_QUALIFIERS.has(t)),
    // Filled by qualification, from text the provider returned. Empty here: a
    // subject on its own has no localized names, and none may be asserted.
    aliases: [],
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
// A SECOND registry, never the same one. Membership of this set grants only
// what a consumer explicitly written for class-level evidence chooses to grant.
const COMPARABLE_AUTHORITY = new WeakSet();

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

/** Was this class-level token minted here, by qualification, this request? */
export function isComparableEvidence(value) {
  return typeof value === 'object' && value !== null && COMPARABLE_AUTHORITY.has(value);
}

/**
 * Does this guard context carry class-level comparable evidence?
 *
 * Deliberately a DIFFERENT predicate from `hasVerifiedMarket`. A caller that
 * wants to treat the two the same has to say so in its own code, where the
 * decision is reviewable — rather than inheriting it from a widened class.
 */
export function hasVerifiedComparable(ctx) {
  return isComparableEvidence(ctx?.comparable_evidence);
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
export function qualifyMarketEvidence({
  observations = [], subject = {}, fxProofs = null, providerText = null,
} = {}) {
  // `subject: null` is not the same as an omitted subject, and a default
  // parameter does not catch it. Totality is a property this function claims.
  const vocab = {
    ...subjectVocabulary(subject && typeof subject === 'object' ? subject : {}),
  };
  vocab.aliases = localizedAliases(vocab, observations, providerText);
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
  // ── WHICH QUESTION IS THIS SET BEING ASKED? ──────────────────────────────
  //
  // THE BRANDED-WITHOUT-MODEL CASE STAYS REFUSED, and that is the whole point
  // of splitting the paths rather than relaxing the gate. "LG monitor" names a
  // product line spanning ₪400 to ₪4,000; admitting listings for specific LG
  // models prices an unknown product with a known one's number. A brand is a
  // promise of specificity that has not been kept, and it is more dangerous
  // than no brand at all.
  //
  // An object with NO brand makes no such promise. Its comparable set is other
  // objects of the same kind, which is a question that genuinely has an answer.
  const setFailures = [];
  const productLevel = !!(vocab.brand && vocab.model);
  const genericLevel = !vocab.brand && vocab.class_tokens.length > 0;

  if (productLevel) {
    if (vocab.distinctive.length === 0) setFailures.push(SET_FAILURE.NO_DISTINCTIVE_IDENTITY);
  } else if (!genericLevel) {
    // Branded but model-less, or nothing established at all.
    setFailures.push(vocab.brand
      ? SET_FAILURE.BRANDED_WITHOUT_MODEL
      : SET_FAILURE.NO_OBJECT_CLASS);
    setFailures.push(SET_FAILURE.IDENTITY_INSUFFICIENT);
  }

  if (setFailures.length > 0) {
    return Object.freeze({
      qualified: false, token: null, comparable_qualified: false, comparable_token: null,
      evidence_class: null, admitted: [], disqualified: [],
      set_failures: setFailures, vocabulary: vocab,
      counts: { considered: Array.isArray(observations) ? observations.length : 0, admitted: 0, disqualified: 0 },
      distinct_sources: 0,
    });
  }

  // ── THE GENERIC PATH ─────────────────────────────────────────────────────
  //
  // Same per-listing hygiene as the product path — a price, a proven currency,
  // a source, a used listing, no injected authority — but compatibility is
  // asked of the OBJECT CLASS instead of a model token, because that is the
  // only identity the subject has.
  if (genericLevel) return qualifyComparableSet({ observations, vocab, fxProofs });

  const seen = new Set();

  for (const o of Array.isArray(observations) ? observations : []) {
    // Every subject-independent rule, in one place, shared with the generic
    // path. See screenListing at the bottom of this file.
    const screened = screenListing(o, fxProofs);
    if (screened.reason) { reject(o, screened.reason); continue; }
    const { toks, site, ils } = screened;

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
    const identity = dedupeKeys({ site, o, ils });
    if (!claimDedupeKeys(seen, identity.keys)) {
      reject(o, DISQUALIFIER.DUPLICATE); continue;
    }

    admitted.push(admittedRecord(o, { ...screened, identity }, describeMatch(toks, vocab)));
  }

  const sources = distinctSites(admitted);
  if (admitted.length < VERIFIED_MARKET_QUORUM) setFailures.push(SET_FAILURE.QUORUM);
  if (sources.size < MIN_DISTINCT_SOURCES) setFailures.push(SET_FAILURE.DIVERSITY);

  const counts = {
    considered: Array.isArray(observations) ? observations.length : 0,
    admitted: admitted.length,
    disqualified: disqualified.length,
  };

  if (setFailures.length > 0) {
    // THE SAME KEYS ON EVERY PATH. A report whose shape depends on which
    // branch produced it makes `report.comparable_qualified` undefined on the
    // product path — and `undefined` is falsy, so it reads correctly right up
    // until somebody writes `=== false`.
    return Object.freeze({
      qualified: false, token: null, comparable_qualified: false, comparable_token: null,
      evidence_class: null, admitted, disqualified,
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
    qualified: true, token, comparable_qualified: false, comparable_token: null,
    evidence_class: VERIFIED_MARKET, admitted, disqualified,
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

  // ── A sibling named by the listing, in either alphabet ─────────────────
  //
  // Checked in the REFUSING direction only, so it needs no corroboration: a
  // local word that merely sounds like "pro" costs a listing, and never
  // admits one.
  const subjectSiblings = new Set(vocab.sibling_qualifiers);
  const names = (q) => toks.includes(q)
    || toks.some((t) => scriptOf(t) !== SCRIPT.LATIN && transliterates(q, t, { minLength: 2 }));
  if ([...SIBLING_QUALIFIERS].some((q) => !subjectSiblings.has(q) && names(q))) return DISQUALIFIER.QUALIFIER_MISMATCH;

  // ── Identifiers and numbers: exact, or not this product ────────────────
  if (vocab.identifier_tokens.some((id) => !toks.includes(id))) return DISQUALIFIER.IDENTIFIER_MISMATCH;
  for (const { number, before, after } of vocab.number_tokens) {
    // The number has to sit BESIDE the word it belongs to. "… 4 … with 5
    // games" contains a 5 and is not a 5.
    const beside = toks.some((t, i) => t === number && (
      (before !== null && saysToken(toks[i - 1], before, vocab))
      || (before === null && after !== null && saysToken(toks[i + 1], after, vocab))
      || (before === null && after === null)));
    if (!beside) return DISQUALIFIER.NUMBER_MISMATCH;
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
  const brandNamed = vocab.brand_forms.some((form) => saysSequence(toks, form, vocab));
  const modelHits = vocab.distinctive.filter((t) => toks.some((x) => saysToken(x, t, vocab)));
  if (modelHits.length === 0) return DISQUALIFIER.MODEL_ABSENT;
  const score = (brandNamed ? 1 : 0) + modelHits.length;
  if (score < 2) return DISQUALIFIER.IDENTITY_TOO_WEAK;
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// LOCALIZED NAMES  ·  the same identity, written in the seller's alphabet
//
// THE MEASURED LOSS. Two genuine listings for the scanned product were refused
// because the seller wrote its name in Hebrew and this file compared Latin
// tokens. They named the right brand, the right model and the right number.
//
// A localized word counts as a canonical word only when ALL of these hold:
//
//   1. it is written in a different alphabet and SOUNDS like the canonical
//      word (script-normalization.js: deterministic, no dictionary, no model);
//   2. it occurs, as a whole word, in text THE PROVIDER returned, on at least
//      MIN_ALIAS_SITES independent sites — not in one listing, and not in
//      anything the model wrote; and
//   3. it is a WORD. A token with a digit is never localized.
//
// Neither signal is trusted alone. Sound-alikes collide, and a word can be
// common on the web without being this name; together they say that several
// independent sites use this spelling for something that sounds like this.
//
// WHAT A CALLER CANNOT DO is assert an alias. There is no parameter for one.
// The aliases are derived here, from the listings and the provider's text,
// every time — the round-3 lesson, where the guard accepted the caller's word
// for an evidence class, applies to names as much as to classes.
// ══════════════════════════════════════════════════════════════════════════════
function localizedAliases(vocab, observations, providerText) {
  const texts = (Array.isArray(providerText) ? providerText : [])
    .map((r) => ({ site: sourceSite(r?.url ?? r?.domain), toks: new Set(tokens(r?.text)) }))
    .filter((r) => r.site && r.toks.size > 0);
  if (texts.length === 0) return [];

  const brandWords = new Set(vocab.brand_forms.flat());
  const canon = [
    ...[...brandWords].map((word) => ({ word, min: MIN_BRAND_SKELETON })),
    ...vocab.distinctive.filter((t) => !brandWords.has(t)).map((word) => ({ word, min: MIN_MODEL_SKELETON })),
  ].filter(({ word }) => !hasDigit(word) && scriptOf(word) !== SCRIPT.OTHER);

  const seen = new Set();
  const out = [];
  for (const o of Array.isArray(observations) ? observations : []) {
    for (const t of new Set(tokens(o?.title))) {
      for (const { word, min } of canon) {
        if (seen.has(`${word}|${t}`) || !transliterates(word, t, { minLength: min })) continue;
        seen.add(`${word}|${t}`);
        const sites = [...new Set(texts.filter((r) => r.toks.has(t)).map((r) => r.site))].sort();
        if (sites.length < MIN_ALIAS_SITES) continue;
        out.push(Object.freeze({
          canonical: word,
          alias: t,
          provenance: Object.freeze([ALIAS_PROVENANCE.TRANSLITERATION, ALIAS_PROVENANCE.WEB]),
          sites: Object.freeze(sites),
        }));
      }
    }
  }
  return out;
}

/** Does this title token say this canonical word — itself, or a trusted alias of it? */
function saysToken(token, canonical, vocab) {
  if (!token || !canonical) return false;
  if (token === canonical) return true;
  if (hasDigit(canonical) || hasDigit(token)) return false;
  return vocab.aliases.some((a) => a.canonical === canonical && a.alias === token);
}

/** `containsSequence`, reading each word through its trusted aliases. */
function saysSequence(toks, seq, vocab) {
  if (seq.length === 0) return false;
  for (let i = 0; i + seq.length <= toks.length; i += 1) {
    if (seq.every((word, j) => saysToken(toks[i + j], word, vocab))) return true;
  }
  return false;
}

/** How an admitted listing matched, for a reader. Decides nothing. */
function describeMatch(toks, vocab) {
  const used = [];
  const matched = [];
  for (const word of [...new Set([...vocab.brand_forms.flat(), ...vocab.distinctive])]) {
    const t = toks.find((x) => saysToken(x, word, vocab));
    if (!t) continue;
    matched.push(t === word ? word : `${t} = ${word}`);
    if (t !== word) used.push(vocab.aliases.find((a) => a.canonical === word && a.alias === t));
  }
  return Object.freeze({
    method: used.length > 0 ? 'localized_alias' : 'exact_tokens',
    matched_tokens: Object.freeze(matched),
    aliases: Object.freeze(used.map((a) => Object.freeze({
      canonical: a.canonical, alias: a.alias, provenance: a.provenance, sites: a.sites,
    }))),
  });
}

/** The independent sites behind a set of admitted listings. */
function distinctSites(list) {
  return new Set(list.map((a) => a.source_site));
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

// ══════════════════════════════════════════════════════════════════════════════
// THE GENERIC PATH  ·  a class-level comparable set
//
// Reached only when the subject has NO brand and DOES have an object class.
// Every hygiene rule the product path applies is applied here unchanged — a
// price, a currency proven rather than assumed, real provenance, a used
// listing, no injected authority, the same three dedupe keys. The single
// difference is the question asked of the title:
//
//   product path   does this listing name THIS PRODUCT?
//   generic path   does this listing name THIS KIND OF OBJECT?
//
// and the bar it has to clear afterwards, which is higher in both dimensions.
// ══════════════════════════════════════════════════════════════════════════════
function qualifyComparableSet({ observations = [], vocab, fxProofs = null } = {}) {
  const admitted = [];
  const disqualified = [];
  const reject = (observation, reason) => { disqualified.push({ observation, reason }); };
  const seen = new Set();

  for (const o of Array.isArray(observations) ? observations : []) {
    // THE SAME SCREEN THE PRODUCT PATH USES. Not a copy of it — the copy is
    // what the mutation harness objected to, and a second implementation of
    // the currency and FX rules is the most expensive place this repository
    // could have that defect.
    const screened = screenListing(o, fxProofs);
    if (screened.reason) { reject(o, screened.reason); continue; }
    const { toks, site, ils } = screened;

    // ── CLASS COMPATIBILITY ──────────────────────────────────────────────
    //
    // The listing has to name the kind of object, in the subject's own words.
    // A subject whose class is "wooden desk" admits a listing whose title says
    // desk; it does not admit a chair that happens to be for sale nearby.
    //
    // ANY class token is enough rather than all of them, because an object
    // class is a phrase a model wrote ("solid wood writing desk") while a
    // seller writes their own. Requiring every word would make the rule a test
    // of whether two people described one object identically. What stops that
    // being too loose is the quorum and the source floor below: one accidental
    // match cannot reach five listings across three independent domains.
    if (!vocab.class_tokens.some((t) => toks.includes(t))) {
      reject(o, DISQUALIFIER.IDENTITY_TOO_WEAK); continue;
    }

    // A generic subject must not absorb an ACCESSORY's market, and it is the
    // same subject/accessory rule the product path applies.
    if (!vocab.subject_is_accessory && toks.some((t) => ACCESSORY_NOUNS.has(t))) {
      reject(o, DISQUALIFIER.ACCESSORY_LISTING); continue;
    }

    const identity = dedupeKeys({ site, o, ils });
    if (!claimDedupeKeys(seen, identity.keys)) {
      reject(o, DISQUALIFIER.DUPLICATE); continue;
    }

    admitted.push(admittedRecord(o, { ...screened, identity }));
  }

  const sources = distinctSites(admitted);
  const setFailures = [];
  if (admitted.length < COMPARABLE_QUORUM) setFailures.push(SET_FAILURE.COMPARABLE_QUORUM);
  if (sources.size < MIN_COMPARABLE_SOURCES) setFailures.push(SET_FAILURE.COMPARABLE_DIVERSITY);

  const counts = {
    considered: Array.isArray(observations) ? observations.length : 0,
    admitted: admitted.length,
    disqualified: disqualified.length,
  };

  // `qualified` stays FALSE on this path in every case. It is the
  // product-level answer, and a class-level set is not a product-level answer
  // however good it is — so every existing consumer of `qualified` keeps
  // meaning exactly what it has always meant.
  if (setFailures.length > 0) {
    return Object.freeze({
      qualified: false, token: null, comparable_qualified: false, comparable_token: null,
      evidence_class: null, admitted, disqualified,
      set_failures: setFailures, vocabulary: vocab, counts, distinct_sources: sources.size,
    });
  }

  const comparableToken = Object.freeze({
    class: VERIFIED_COMPARABLE,
    observation_count: admitted.length,
    distinct_sources: sources.size,
    sources: Object.freeze([...sources].sort()),
    subject: Object.freeze({ brand: null, model: null, object_class: vocab.class_tokens.join(' ') }),
    prices_ils: Object.freeze(admitted.map((a) => a.normalized_ils_price).sort((a, b) => a - b)),
    observations: Object.freeze(admitted),
  });
  COMPARABLE_AUTHORITY.add(comparableToken);

  return Object.freeze({
    qualified: false,
    token: null,
    comparable_qualified: true,
    comparable_token: comparableToken,
    evidence_class: VERIFIED_COMPARABLE,
    admitted,
    disqualified,
    set_failures: [],
    vocabulary: vocab,
    counts,
    distinct_sources: sources.size,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// THE SHARED LISTING SCREEN  ·  one implementation, two callers
//
// WHY THIS EXISTS. The class-level path began as a copy of the product path's
// hygiene, and the mutation harness reported it within one run: eight mutants
// that had each matched a single line suddenly matched TWO, because there were
// now two copies of `if (!currency) reject(NO_CURRENCY)`, two of the FX proof
// check, two of the provenance check, two of the new-retail title rule.
//
// The harness refused to score them rather than pick one, which is the correct
// refusal: a mutant pinned to one of two identical lines proves the OTHER copy
// is protected by nothing. This repository has recorded that defect — one
// predicate, two implementations — four times, and a fifth copy carrying the
// currency and FX rules is the most expensive place yet to have it.
//
// So the rules live here once. What each path still decides for itself is the
// only thing that genuinely differs: whether a listing is ABOUT the subject.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Apply every subject-independent admissibility rule to one observation.
 *
 * Returns `{ reason }` when the listing is refused, or the screened values the
 * caller needs when it passes. Never throws, never mutates its input.
 */
function screenListing(o, fxProofs) {
  if (!o || typeof o !== 'object') return { reason: DISQUALIFIER.NO_PRICE };
  if (assertsAuthority(o)) return { reason: DISQUALIFIER.ASSERTED_AUTHORITY };

  // ── Price and currency ───────────────────────────────────────────────────
  const price = typeof o.observed_price === 'number' && Number.isFinite(o.observed_price) && o.observed_price > 0
    ? o.observed_price : null;
  if (price === null) return { reason: DISQUALIFIER.NO_PRICE };

  // Normalised BEFORE the comparison: "₪" and "ILS" are one currency.
  const currency = canonicalCurrency(o.currency);
  if (!currency) return { reason: DISQUALIFIER.NO_CURRENCY };

  // §9: ILS enters directly. Anything else needs a V-FX proof whose arithmetic
  // this function re-does. No model-authored implicit conversion, and no
  // "$500 -> ILS 500" by way of a missing branch. A weaker evidence class is a
  // reason to be stricter about arithmetic, never looser.
  let ils = null;
  if (currency === MARKET_CURRENCY) {
    ils = price;
  } else {
    const proof = fxProof(o, fxProofs);
    if (!proof) return { reason: DISQUALIFIER.UNVERIFIED_FX };
    ils = proof.normalized_amount;
  }

  // ── Provenance ───────────────────────────────────────────────────────────
  const domain = normalizeDomain(o.source_domain ?? o.source);
  // THE SITE, not the hostname, is what independence is counted in and what a
  // repost is detected within. The hostname is kept for provenance.
  const site = sourceSite(domain);
  const reference = o.listing_id_or_reference ?? o.source ?? null;
  if (!domain || !reference) return { reason: DISQUALIFIER.NO_PROVENANCE };
  if (!site) return { reason: DISQUALIFIER.NO_PROVENANCE };

  // ── The model's own opinion: subtract only ───────────────────────────────
  const selfMatch = typeof o.match?.confidence === 'number' ? o.match.confidence : null;
  if (selfMatch !== null && selfMatch < SELF_REPORTED_MATCH_FLOOR) {
    return { reason: DISQUALIFIER.SELF_REPORTED_MISMATCH };
  }

  const kind = String(o.listing_kind ?? 'unknown');
  if (kind === 'new_retail') return { reason: DISQUALIFIER.NOT_USED };
  if (kind === 'parts_only' || kind === 'broken') return { reason: DISQUALIFIER.PARTS_ONLY };
  if (kind === 'accessory') return { reason: DISQUALIFIER.ACCESSORY_LISTING };

  // ── Everything from here reads the TITLE, which the server can check ─────
  const toks = tokens(o.title);
  if (!namesAny(toks, LIKE_NEW) && namesAny(toks, NEW_RETAIL)) return { reason: DISQUALIFIER.NOT_USED };
  if (namesAny(toks, PARTS)) return { reason: DISQUALIFIER.PARTS_ONLY };

  return { reason: null, toks, domain, site, reference, ils, price, currency, kind };
}

/**
 * The identity of a listing, and the keys a repeat of it would be found under.
 *
 * THERE WAS A PRICE KEY HERE — site and price, nothing else — and it is gone.
 * It existed to catch one advert re-titled, and it caught every pair of honest
 * sellers who asked the same round price: the first live benchmark lost a
 * genuine listing to it. Price is an attribute of a listing, not its identity.
 * What identifies one is in listing-identity.js: the id the source gave it,
 * the id in its URL, and only failing both a fingerprint of several fields.
 */
function dedupeKeys({ site, o, ils }) {
  return listingIdentity({
    site,
    explicit: o.listing_id_or_reference ?? null,
    source: o.source ?? null,
    title: o.title ?? null,
    ils,
    location: o.location ?? null,
  });
}

/**
 * Claim these keys for this listing, or report it as already seen.
 *
 * The CHECK lives here, not just the key construction. With only the builder
 * shared, a mutant that defeated one key still found the other two catching
 * duplicates — so "dedupe skipped" was unmutatable and the rule was, in the
 * harness's words, a test gap. One function, one place to break.
 *
 * Returns true when the listing is new.
 */
function claimDedupeKeys(seen, keys) {
  if (keys.some((k) => seen.has(k))) return false;
  for (const k of keys) seen.add(k);
  return true;
}

/** The frozen admitted record both paths emit. */
function admittedRecord(o, screened, match = null) {
  return Object.freeze({
    source_domain: screened.domain,
    source_site: screened.site,
    identity_match: match,
    // How this listing was told apart from the others, for a reader.
    listing_id: screened.identity?.listing_id ?? null,
    canonical_url: screened.identity?.canonical_url ?? null,
    duplicate_key: screened.identity?.duplicate_key ?? null,
    identity_method: screened.identity?.method ?? null,
    listing_id_or_reference: String(screened.reference),
    title: o.title ?? null,
    normalized_ils_price: screened.ils,
    original_price: screened.price,
    original_currency: screened.currency,
    condition: o.condition ?? null,
    location: o.location ?? null,
    observed_at: o.observed_at ?? null,
    listing_kind: screened.kind,
  });
}
