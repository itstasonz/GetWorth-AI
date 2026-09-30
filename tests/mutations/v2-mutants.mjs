// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — MUTANT CATALOG
//
// Each entry breaks ONE rule V2 depends on. The V2 suites must FAIL against
// every one of them; a mutant that SURVIVES is a rule nothing observes.
//
// `file` is relative to the repository. `find` must occur in it EXACTLY ONCE —
// the runner refuses a mutant that matches zero or several times, so a refactor
// that moves the code fails here instead of reporting a score about nothing.
// ══════════════════════════════════════════════════════════════════════════════
const SUF = 'api/_lib/v2/sufficiency.js';
const IDN = 'api/_lib/v2/identity.js';
const FUP = 'api/_lib/v2/followup.js';
const EXT = 'api/_lib/v2/listing-extraction.js';
const EVD = 'api/_lib/v2/evidence.js';
const PRC = 'api/_lib/v2/pricing.js';
const SRC = 'api/_lib/v2/search.js';
const STA = 'api/_lib/v2/state.js';
const CFG = 'api/_lib/v2/config.js';
const HTP = 'api/_lib/v2/http.js';
const SCN = 'api/_lib/v2/scan.js';
const IDE = 'api/v2/identify.js';

export const V2_CONTROLS = [
  {
    id: 'CTL-SENSITIVITY-MUST-DIE', control: 'kill', file: SUF,
    invariant: 'the harness reaches the module: a gate that always searches must be noticed',
    find: "    return ask(IDENTITY_LEVEL.BRAND_CLASS, ['competing_products_may_be_priced_differently']);",
    replace: "    return answer(DECISION.SEARCH_NOW, IDENTITY_LEVEL.BRAND_CLASS, ['x']);",
  },
  {
    id: 'CTL-SPECIFICITY-MUST-LIVE', control: 'survive', file: EXT,
    invariant: 'a change no suite asserts on must not be killed: the title cap is unobserved prose room',
    find: 'const MAX_TITLE = 220;',
    replace: 'const MAX_TITLE = 221;',
  },
];

export const V2_MUTANTS = [
  // ── THE SUFFICIENCY GATE ──────────────────────────────────────────────────
  { id: 'S01-MODEL-READ-NOT-REQUIRED', file: SUF, invariant: 'a model that was only seen is not a model that was read',
    find: '  const modelRead = !!model && READ.has(id.model?.evidence);', replace: '  const modelRead = !!model;' },
  { id: 'S02-RIVALS-IGNORED', file: SUF, invariant: 'several different candidate products stop the search',
    find: '  if (rivals.length > 0) {', replace: '  if (false) {' },
  { id: 'S03-FOLLOWUP-ASKED-FOREVER', file: SUF, invariant: 'the follow-up is asked once',
    find: 'const mayAsk = followupsUsed < V2_MAX_FOLLOWUPS;', replace: 'const mayAsk = true;' },
  { id: 'S04-RIVAL-MARGIN-ZERO', file: SUF, invariant: 'a seen model must clearly lead a different product',
    find: 'RIVAL_MARGIN: 0.25,', replace: 'RIVAL_MARGIN: 0,' },
  { id: 'S05-VARIANTS-ARE-RIVALS', file: SUF, invariant: 'a more specific edition of the same product is not a rival',
    find: '  return subset(x, y) || subset(y, x);', replace: '  return false;' },
  { id: 'S06-UNKNOWN-PRICES-ARE-ALIKE', file: SUF, invariant: 'candidates are priced alike only when that is known',
    find: '    if (alike === true) {', replace: '    if (alike !== false) {' },
  { id: 'S07-MODEL-NEVER-DEFINES-VALUE', file: SUF, invariant: 'a model-defined category with a label in reach needs the label',
    find: "new Set(['Electronics', 'Watches', 'Vehicles'])", replace: 'new Set([])' },
  { id: 'S09-CATEGORY-ASKS-ALONE', file: SUF, invariant: 'a category never asks on its own',
    find: '  if (MODEL_DEFINES_VALUE.has(id.category) && LABEL_FOLLOWUPS.has(id.missing_evidence)) {\n    return ask(IDENTITY_LEVEL.BRAND_CLASS', replace: '  if (MODEL_DEFINES_VALUE.has(id.category)) {\n    return ask(IDENTITY_LEVEL.BRAND_CLASS' },
  { id: 'S10-LABEL-ASKS-IN-ANY-CATEGORY', file: SUF, invariant: 'a wished-for label does not ask where the model is not the value',
    find: '  if (MODEL_DEFINES_VALUE.has(id.category) && LABEL_FOLLOWUPS.has(id.missing_evidence)) {\n    return ask(IDENTITY_LEVEL.BRAND_CLASS', replace: '  if (LABEL_FOLLOWUPS.has(id.missing_evidence)) {\n    return ask(IDENTITY_LEVEL.BRAND_CLASS' },
  { id: 'S11-WEAK-BRAND-DROPS-THE-MODEL', file: SUF, invariant: 'an established model carries its brand',
    find: ' || READ.has(id.brand?.evidence) || modelBasis !== null);', replace: ' || READ.has(id.brand?.evidence));' },
  { id: 'S12-CATEGORY-ASKS-ABOUT-AN-ESTABLISHED-MODEL', file: SUF, invariant: 'a category cannot ask about an established model',
    find: '    const labelWouldNameIt = modelBasis === null\n      && MODEL_DEFINES_VALUE', replace: '    const labelWouldNameIt = true\n      && MODEL_DEFINES_VALUE' },
  { id: 'S13-GUESSED-MODEL-IS-ESTABLISHED', file: SUF, invariant: 'a low-confidence guess is not an established model',
    find: 'rivals.length === 0 && modelConf >= THRESHOLD.MODEL_PLAUSIBLE ?', replace: 'rivals.length === 0 ?' },
  { id: 'S08-PARTIAL-PRICES-COUNT', file: SUF, invariant: 'a price for one candidate says nothing about the others',
    find: 'if (prices.length < 2 || prices.length < rivals.length) return null;', replace: 'if (prices.length < 1) return null;' },

  // ── THE IDENTITY CONTRACT ─────────────────────────────────────────────────
  { id: 'I01-READ-CLAIM-TRUSTED', file: IDN, invariant: 'a claim to have read a name is checked against the text read',
    find: "&& !occursInText(value, visibleText)) evidence = 'SHAPE';", replace: "&& false) evidence = 'SHAPE';" },
  { id: 'I02-UNKNOWN-IS-A-NAME', file: IDN, invariant: '"unknown" and "unbranded" are absence, not a brand',
    find: '  return s && !UNKNOWN.test(s) ? s.slice(0, max) : null;', replace: '  return s ? s.slice(0, max) : null;' },
  { id: 'I03-CONFIDENCE-UNCLAMPED', file: IDN, invariant: 'a percent-scale confidence cannot read as certainty above 1',
    find: 'Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);', replace: 'Number.isFinite(v) ? v : 0);' },

  // ── THE FOLLOW-UP ─────────────────────────────────────────────────────────
  { id: 'F01-SEEN-BEATS-READ', file: FUP, invariant: 'a value read off the item is not replaced by one that was seen',
    find: '  if (wasRead(prior) && !wasRead(next)) return prior;', replace: '' },
  { id: 'F02-CONDITION-FROM-THE-LABEL', file: FUP, invariant: 'the first photograph keeps its condition',
    find: "condition: prior.condition?.grade && prior.condition.grade !== 'Unknown' ? prior.condition : next.condition,", replace: 'condition: next.condition,' },
  { id: 'F03-CLASS-FROM-THE-LABEL', file: FUP, invariant: 'the first photograph keeps its kind of object',
    find: '    object_class: prior.object_class || next.object_class,', replace: '    object_class: next.object_class || prior.object_class,' },

  // ── DETERMINISTIC EXTRACTION ──────────────────────────────────────────────
  { id: 'X01-FEE-IS-A-PRICE', file: EXT, invariant: 'a delivery fee is never an observation',
    find: '  if (LEXICON.fee.test(before)) return REFUSED.FEE;', replace: '' },
  { id: 'X02-PAID-IS-ASKING', file: EXT, invariant: 'what the seller once paid is not the asking price',
    find: '  if (LEXICON.history.test(before)) return REFUSED.NOT_ASKING;', replace: '' },
  { id: 'X03-BUNDLE-PICKS-ONE', file: EXT, invariant: 'several asking prices in one listing are refused whole',
    find: '      if (distinct.length > 1) { refuse(REFUSED.SEVERAL_PRICES, { prices: distinct }); continue; }', replace: '' },
  { id: 'X04-TABLE-ROW-ADMISSIBLE', file: EXT, invariant: 'a table row cannot be priced from',
    find: "const admissible = kind === 'used_listing' && shape === SHAPE.SENTENCE;", replace: "const admissible = kind === 'used_listing';" },
  { id: 'X05-NAKED-PRICE-KEPT', file: EXT, invariant: 'a price with no listing text is refused',
    find: "length < 2) { refuse(REFUSED.NAKED_PRICE); continue; }", replace: "length < 0) { refuse(REFUSED.NAKED_PRICE); continue; }" },
  { id: 'X06-NO-SALE-INTENT-ADMISSIBLE', file: EXT, invariant: 'only a second-hand listing reaches the evidence gate',
    find: "const admissible = kind === 'used_listing' && shape", replace: "const admissible = kind !== 'new_retail' && shape" },
  { id: 'X07-FLATTENED-TABLE-IS-A-SENTENCE', file: EXT, invariant: 'a run of spaces separates table cells',
    find: 'const CELL = /\\s\\|(?=\\s|$)|[^\\S\\r\\n]{2,}/gu;', replace: 'const CELL = /\\s\\|(?=\\s|$)/gu;' },
  { id: 'X08-SAME-PAGE-PRICE-TWICE', file: EXT, invariant: 'one page and price is one observation',
    find: '      if (seen.has(key)) continue;                 // one observation per page and price', replace: '' },
  { id: 'X09-RETAIL-IS-USED', file: EXT, invariant: 'a shop page is not a second-hand listing',
    find: "const kind = retail ? 'new_retail' : (saleIntent ? 'used_listing' : 'unknown');", replace: "const kind = saleIntent || retail ? 'used_listing' : 'unknown';" },
  { id: 'X10-PAGE-FLOODS', file: EXT, invariant: 'one page cannot flood the observation set',
    find: 'if (taken >= MAX_PER_RESULT || entries.length >= MAX_OBSERVATIONS)', replace: 'if (false)' },

  // ── EVIDENCE ──────────────────────────────────────────────────────────────
  { id: 'E01-BINDING-SKIPPED', file: EVD, invariant: 'only observations bound to the search record are qualified',
    find: 'qualifyMarketEvidence({ observations: bound, subject, providerText });', replace: 'qualifyMarketEvidence({ observations: candidates.map((e) => e.observation), subject, providerText });' },
  { id: 'E02-ANY-RETAIL-IS-CONTEXT', file: EVD, invariant: 'retail context must name this product',
    find: '        return t.includes(brandToken) && vocab.distinctive.every((d) => t.includes(d));', replace: '        return true;' },
  { id: 'E03-BRAND-ALONE-IS-CONTEXT', file: EVD, invariant: 'brand context must name the kind of object too',
    find: '        return t.includes(brandToken) && classPhrases.some((p) => p.every((c) => t.includes(c)));', replace: '        return t.includes(brandToken);' },
  { id: 'E04-INADMISSIBLE-QUALIFIED', file: EVD, invariant: 'only admissible candidates are handed to the gate',
    find: '  const candidates = entries.filter((e) => e.admissible);', replace: '  const candidates = entries;' },

  // ── PRICE STATES ──────────────────────────────────────────────────────────
  { id: 'P01-VERIFIED-WITHOUT-THE-GUARD', file: PRC, invariant: 'a verified value needs the guard to accept it',
    find: "candidate.status === VALUATION_STATUS.PRICED && guard.action === 'accept';", replace: 'candidate.status === VALUATION_STATUS.PRICED;' },
  { id: 'P02-COMPARABLE-CALLED-VERIFIED', file: PRC, invariant: 'a kind-of-object market is never a verified product value',
    find: '        state: q.qualified ? PRICE_STATE.VERIFIED_MARKET_VALUE : PRICE_STATE.MARKET_INFORMED_ESTIMATE,', replace: '        state: PRICE_STATE.VERIFIED_MARKET_VALUE,' },
  { id: 'P03-BELOW-QUORUM-CALLED-VERIFIED', file: PRC, invariant: 'a set below the floors is not verified',
    find: '        state: PRICE_STATE.MARKET_INFORMED_ESTIMATE, ...range, currency', replace: '        state: PRICE_STATE.VERIFIED_MARKET_VALUE, ...range, currency' },
  { id: 'P04-INSUFFICIENT-IDENTITY-PRICED', file: PRC, invariant: 'an identity the gate refused has no price',
    find: '  if (sufficiency?.decision !== DECISION.SEARCH_NOW) {\n    return unpriced(PRICE_STATE.NEED_MORE_INFORMATION', replace: '  if (false) {\n    return unpriced(PRICE_STATE.NEED_MORE_INFORMATION' },
  { id: 'P05-ONE-GENERIC-LISTING-PRICES', file: PRC, invariant: 'a kind of object needs a small sample',
    find: '? MIN_CONTEXT_LISTINGS : 1;', replace: '? 1 : 1;' },
  { id: 'P06-FAILED-SEARCH-PRICED', file: PRC, invariant: 'a search that did not complete prices nothing',
    find: '  if (searchOutcome !== SEARCH_OUTCOME.COMPLETED || !evidence) {', replace: '  if (!evidence) {' },
  { id: 'P07-BELOW-QUORUM-HAS-AUTHORITY', file: PRC, invariant: 'only a verified state carries authority',
    find: "...range, currency: 'ILS', authority: 'none',\n        basis: { kind: BASIS.ADMITTED_BELOW_QUORUM", replace: "...range, currency: 'ILS', authority: 'verified_market',\n        basis: { kind: BASIS.ADMITTED_BELOW_QUORUM" },
  { id: 'P08-TWO-LISTINGS-ARE-A-RANGE', file: PRC, invariant: 'a context tier needs three listings',
    find: '  if (context.length >= MIN_CONTEXT_LISTINGS', replace: '  if (context.length >= 1' },

  // ── SEARCH ────────────────────────────────────────────────────────────────
  { id: 'W01-WAITS-FOR-THE-WRITING', file: SRC, invariant: 'the search call is stopped at the results',
    find: "type === 'response.output_item.added' && item?.type === 'message') stop();", replace: "type === 'response.output_item.added' && item?.type === 'message') { /* keep reading */ }" },
  { id: 'W02-QUERY-TEXT-UNSANITISED', file: SRC, invariant: 'text read off an item is data in the search prompt',
    find: '${promptSafe(q.text, 160)}', replace: '${q.text}' },
  { id: 'W03-SEARCH-OPTIONAL', file: SRC, invariant: 'the search tool is required',
    find: '    tool_choice: SEARCH_TOOL_CHOICE,', replace: '' },

  // ── STATE ─────────────────────────────────────────────────────────────────
  { id: 'T01-ANY-USER', file: STA, invariant: 'a state belongs to the user it was signed for',
    find: '  if (state.uid !== String(userId)) return fail(STATE_ERROR.WRONG_USER);', replace: '' },
  { id: 'T02-ANY-SCAN', file: STA, invariant: 'a state belongs to the scan it was signed for',
    find: '  if (state.scan !== String(scanUuid)) return fail(STATE_ERROR.WRONG_SCAN);', replace: '' },
  { id: 'T03-NEVER-EXPIRES', file: STA, invariant: 'a state expires',
    find: 'if (now - state.iat > V2_STATE_TTL_MS || state.iat - now > 60_000) return fail(STATE_ERROR.EXPIRED);', replace: '' },
  { id: 'T04-SIGNATURE-UNCHECKED', file: STA, invariant: 'a state is accepted only with a valid signature',
    find: '  if (!valid) return fail(STATE_ERROR.BAD_SIGNATURE);', replace: '' },

  // ── ACTIVATION ────────────────────────────────────────────────────────────
  { id: 'C01-PRODUCTION-OPEN-TO-ALL', file: CFG, invariant: 'in production an unset allowlist admits nobody',
    find: '  if (allowed.length === 0) return !isProductionDeployment(env);', replace: '  if (allowed.length === 0) return true;' },
  { id: 'C02-FLAG-TRUTHY', file: CFG, invariant: 'only the exact string "true" turns V2 on',
    find: "toLowerCase() !== 'true') return V2_MODE.DISABLED_FLAG;", replace: "toLowerCase() === '') return V2_MODE.DISABLED_FLAG;" },
  { id: 'C03-NO-SECRET-NEEDED', file: CFG, invariant: 'without a state secret V2 is off',
    find: 'length < MIN_STATE_SECRET_LENGTH) return V2_MODE.DISABLED_NO_SECRET;', replace: 'length < 0) return V2_MODE.DISABLED_NO_SECRET;' },
  { id: 'H01-ALLOWLIST-NOT-ENFORCED', file: HTP, invariant: 'the endpoint enforces the allowlist',
    find: "  if (!isV2Permitted(user.id, process.env)) return disabled('not_in_v2_allowlist');", replace: '' },
  { id: 'H02-AUTH-NOT-ENFORCED', file: HTP, invariant: 'the endpoint requires a session',
    find: "  if (!user || user._expired || !user.id) return { response: json({ error: 'unauthorized' }, 401, headers) };", replace: "  if (!user) user = { id: 'anonymous' };" },
  { id: 'H03-FOLLOWUP-ANY-TIME', file: IDE, invariant: 'a follow-up is accepted only when one was asked for, once',
    find: '    if (s.sufficiency?.decision !== DECISION.NEED_FOLLOWUP || (s.followups_used ?? 0) >= V2_MAX_FOLLOWUPS) {', replace: '    if (false) {' },
  { id: 'R01-PRICE-IGNORES-THE-GATE', file: SCN, invariant: 'no search runs for an identity the gate refused',
    find: '  if (sufficiency?.decision !== DECISION.SEARCH_NOW) {\n    return {\n      ...base', replace: '  if (false) {\n    return {\n      ...base' },
];
