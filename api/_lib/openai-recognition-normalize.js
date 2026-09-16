// ═══════════════════════════════════════════════════════════════════════════
// GW-OPENAI-RECOGNITION-001 — NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════
//
// How the model's answer is INTERPRETED, kept apart from what we ask for
// (openai-recognition-contract.js) and how we call it (openai-recognition.js).
//
// This is where the ticket's governing rule is actually enforced. CONFIDENCE
// IS NOT EVIDENCE: the trust layer downstream (calibrateRecognition's
// silhouette clamp, gradeRowEvidence, rankCandidates, isCompatibleAnchor,
// validateQuote) only works if it is fed HONEST INPUTS, and five review
// findings landed in this file rather than in those layers. Every one of them
// was the same mistake in a different disguise — the adapter writing something
// into an OCR-shaped or identity-shaped field that the model had merely
// asserted. Anything written here is read downstream as a FACT ABOUT THE
// PHOTOGRAPH, so it must be a fact about the photograph.
//
// The result is built from a fixed allowlist, never by spreading the parsed
// object, so no model-authored key can land on the recognition object.
// ═══════════════════════════════════════════════════════════════════════════

import { CATEGORIES, CONDITIONS, CATEGORY_HEBREW } from './openai-recognition-contract.js';
import { tokenize, isNoise, carriesIdentifyingText } from './openai-recognition-tokens.js';

const NULLISH_IDENTITY = new Set([
  '', 'null', 'none', 'n/a', 'na', 'unknown', 'unidentified', 'not visible',
  'not applicable', 'unspecified', 'undetermined', 'no brand', 'generic',
  // Round-3 review: each of these reached retrieval as a real search term and
  // produced a `level: exact` identity out of an explicit non-answer.
  'unbranded', 'nobrand', 'no-name', 'noname', 'oem', 'tbd', 'various',
  'assorted', 'misc', 'miscellaneous', 'not specified', 'not determined',
  'cannot determine', 'indeterminate', 'no model', 'no brand visible',
  'not legible', 'illegible', 'unreadable',
]);

// A value made only of punctuation, or a single character, is not an identity
// however the model phrased it: "???", "-", "--", ".".
const isPlaceholderShape = (t) => t.length < 2 || !/[a-z0-9֐-׿]/i.test(t);


const clamp01 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // Round-3 review: clamping put `95` (a model meaning "95%") at 1.0 —
  // maximum confidence manufactured from a malformed value, in the one
  // direction that is unsafe. The schema asks for 0..1 and strict mode cannot
  // enforce a numeric range, so an out-of-range number is a broken response,
  // and the safe reading of a broken confidence is "we do not know" = 0.
  // Guessing intent (v / 100) would invent precision we were not given.
  if (v < 0 || v > 1) return 0;
  return v;
};

// Returns a trimmed identity string, or null when the model meant "I don't
// know". The nullish check is the guard against fabrication-by-placeholder:
// a brand of "Unknown" would otherwise become a real brand_candidate and be
// sent to retrieval as a search term.
// STR_MAX bounds a single field. Array lengths were already capped, but not
// the strings inside them — a payload with 200 KB per field produced a 14.8 MB
// recognition object that would flow into product_candidates.ocr_text and the
// embedding call (security review). Unreachable while max_output_tokens is
// 1200, but that is a config value, not a guarantee.
const STR_MAX = 200;

const identityOrNull = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, STR_MAX);
  if (!t) return null;
  if (isPlaceholderShape(t)) return null;
  return NULLISH_IDENTITY.has(t.toLowerCase()) ? null : t;
};

const stringList = (v, limit = 24) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, STR_MAX);
    if (t) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
};


// ═══════════════════════════════════════════════════════
// NORMALIZATION — OpenAI shape → GetWorth recognition shape
// ═══════════════════════════════════════════════════════
// The output of this function must be indistinguishable in SHAPE from what
// recognize() returns, because everything downstream (calibrateRecognition,
// retrieveCandidates, verifyAndPrice, normalizeForUI, writeBack, the memory
// key builder) reads that shape and none of them are changed by this ticket.
//
// Three rules do the safety work here:
//
//   (1) ALLOWLIST CONSTRUCTION. The returned object is assembled field by
//       field. The parsed model output is never spread, so a model that emits
//       `_user_correction` or `identity_resolution` cannot forge a
//       pipeline-authored fact.
//
//   (2) DERIVED has_readable_text. This flag is NOT taken from the model. It is
//       computed from whether visible_text/logos actually contain anything,
//       because calibrateRecognition uses it to decide whether a model
//       confidence above 0.70 was earned. Letting the model assert the flag
//       would let it unlock its own confidence ceiling — the exact
//       confidence-as-evidence failure this ticket forbids.
//
//   (3) ABSENCE IS PRESERVED. A null brand produces NO brand candidate, not a
//       low-confidence "Unknown". retrieveCandidates' brand_ok / model_ok gates
//       and assessFallbackIdentity then see honest absence.
export function normalizeOpenAIRecognition(raw, { language = 'he' } = {}) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const brand      = identityOrNull(src.brand);
  const model      = identityOrNull(src.model);
  const modelNum   = identityOrNull(src.model_number);
  const family     = identityOrNull(src.product_family);
  const objectType = identityOrNull(src.object_type);

  const visibleText = stringList(src.visible_text);
  const logos       = stringList(src.logos, 12);

  // (2) derived, never asserted — and derived from text with actual CONTENT.
  //
  // REVIEW FINDING (recognition reviewer, C1). `visibleText.length > 0` made a
  // single character enough. Measured: with `visible_text: ['·']` a 0.97
  // silhouette guess came through calibrateRecognition UNCLAMPED at 0.97 and
  // resolved to `level: 'exact'`. One glyph is below the pipeline's own
  // 3-character `isUsefulOcrToken` floor, so it contributes zero retrieval
  // tokens — it bought nothing except the clamp bypass. And it is not an
  // exotic input: real photographs almost always carry some incidental
  // marking, so the clamp would have been off on most scans precisely when
  // model-level confidence is least earned.
  //
  // `textConfirmed` means "there is text here that could identify something".
  // Two alphanumeric characters is the weakest thing that can honestly claim
  // that. This is stricter than the current engine, which takes the model's
  // word for the same flag — a DELIBERATE and declared asymmetry, noted in
  // docs/OPENAI_RECOGNITION_PROTOTYPE.md, because the adapter has the actual
  // strings to check and the current engine's Stage 1 does not expose them
  // the same way. It is recorded as a benchmark caveat rather than hidden.
  // The junk must also be kept OUT of `raw_texts`, not merely excluded from
  // the flag: calibrateRecognition's textConfirmed is a three-way disjunction
  // (`has_readable_text || raw_texts.length || labels_detected.length`), so a
  // one-glyph entry sitting in raw_texts re-opens the bypass on its own. It
  // has no other use either — retrieval's isUsefulOcrToken discards anything
  // under 3 characters, so these strings were never going to become search
  // tokens. A "reading" of one glyph is noise, not data.
  const readableText = visibleText.filter(carriesIdentifyingText);
  const hasReadableText = readableText.length > 0;

  // Did the model actually read the identity off the item, or infer it from
  // shape? This drives the `evidence` string, which calibrateRecognition
  // pattern-matches to decide whether the 0.70 silhouette ceiling applies.
  // Matching is done on text we can verify (the model_number appears in
  // visible_text, or the brand appears in visible_text/logos) rather than on
  // the model's say-so.
  // REVIEW FINDING (recognition reviewer, HIGH). This was bare substring
  // matching — `haystack.includes(model)` — with no token boundary, no length
  // floor and no specificity test. Measured, every one stamped
  // `model_number_text` / `level: exact` / confidence 0.93:
  //
  //   claim "iPhone 15" against label "iPhone 15 Pro Max"   -> "corroborated"
  //   claim "MX"        against label "MX MASTER 3S"        -> "corroborated"
  //   claim "XM4"       against label "WH-1000XM4"          -> "corroborated"
  //   claim "G5"        against label "G502 HERO"           -> "corroborated"
  //   brand "a"         against text  "abcdefg"             -> "corroborated"
  //
  // The direction is backwards: the LESS specific claim is confirmed by the
  // MORE specific label, so the cheaper base variant gets stamped
  // text-confirmed by a Pro Max sticker. And `model_number_text` matches
  // calibrateRecognition's evidence regex on the literal substring
  // "model_number", so this bypassed the silhouette clamp by a second route,
  // independently of has_readable_text.
  //
  // This is the same defect class commit 7d9aa69 closed at the RETRIEVAL layer
  // (isSpecificTokenMatch), reopened one layer upstream — which is exactly why
  // it must be fixed here rather than left to the layer below.
  //
  // Two different rules, because brand and model are different claims:
  //
  //   BRAND corroborates on whole-token presence. A brand legitimately appears
  //   inside a longer string ("Logitech G502 Hero" does print the brand), so
  //   containment is right — it just has to be a TOKEN, which is what kills
  //   "a" inside "abcdefg".
  //
  //   MODEL must ACCOUNT FOR an entire text entry. A label reading
  //   "iPhone 15 Pro Max" is evidence for "iPhone 15 Pro Max" and for nothing
  //   shorter; if the claim leaves tokens of that entry unexplained, the item
  //   is a variant the claim does not name. That is the rule that makes the
  //   sibling/variant direction come out right.
  // Entry-side noise: tokens that appear ON labels but are never part of a
  // model name. Kept DELIBERATELY SHORT. The obvious additions — pro, max,
  // plus, mini, lite, ultra, air, wireless, se — are exactly the tokens that
  // DISTINGUISH SIBLINGS ("G Pro Wireless" vs "G Pro", "iPhone 15" vs
  // "15 Pro Max"), so dropping them would rebuild the very undersell this
  // check exists to prevent. Category nouns (gaming, mouse) are excluded for
  // the same reason: "Magic Mouse" is a model name.
  //
  // api/analyze.js has an overlapping OCR_GENERIC_TOKENS list. It is NOT
  // shared, because _lib modules deliberately do not import from analyze.js
  // (see the import-cycle note in valuation-guard.js), and this list must stay
  // strictly smaller than that one anyway — analyze.js drops variant suffixes,
  // which would be wrong here. Unifying them behind a shared module is a
  // follow-up, noted so the duplication is a decision rather than an accident.

  const brandToks = new Set(tokenize(brand));
  // H2 (recognition reviewer, HIGH). Two pools, not one. A logo is a brand
  // mark the model NAMED; it is not a string transcribed off the item. Naming
  // a logo "G502 Hero" with visible_text empty was the last zero-effort route
  // to a text-confirmed MODEL claim. Brand corroboration may use logos — a
  // visible logo is legitimate brand evidence. Model corroboration may not.
  const brandTokenSet = new Set([...readableText, ...logos].flatMap(tokenize));
  const readTextTokenSet = new Set(readableText.flatMap(tokenize));

  // BRAND: whole-token presence. A brand legitimately appears inside a longer
  // string, so containment is right — it just may not be a substring of a
  // token, which is what killed "a" inside "abcdefg".
  const brandCorroborated = (name) => {
    const toks = tokenize(name);
    return toks.length > 0 && toks.every((t) => brandTokenSet.has(t));
  };

  // MODEL: corroboration must hold in BOTH directions. Each half blocks a
  // different wrong answer, and each was demonstrated live before being added:
  //
  //   CLAIM SIDE (strict) — every claim token must have been READ. Blocks the
  //   claim being MORE specific than the text:
  //       claim "G502 X Plus" vs label "G502"  -> was stamped text-confirmed
  //   This is the dangerous direction and the likelier real shape: a moulding
  //   reads G502, the model reads it correctly, then names the ₪480 X Plus.
  //   No noise filtering here on purpose — pro/plus/x ARE the claim.
  //
  //   ENTRY SIDE (loose) — some entry must be fully accounted for by the
  //   claim. Blocks the claim being LESS specific than the text:
  //       claim "iPhone 15" vs label "iPhone 15 Pro Max" -> was text-confirmed
  //   Noise filtering applies here so a real label line ("MODEL G502 HERO CE
  //   FCC") still corroborates.
  //
  // Asymmetric on purpose: a false POSITIVE prices the wrong product; a false
  // NEGATIVE only costs 0.96 -> 0.70, which is the conservative direction.
  const claimAccountedForByText = (claim) => {
    const toks = tokenize(claim).filter((t) => !brandToks.has(t));
    return toks.length > 0 && toks.every((t) => readTextTokenSet.has(t));
  };
  // Strip electrical ratings BEFORE tokenizing: "1.5A" splits into "1" and
  // "5a" on the decimal point, and only the second half looks like a rating.
  // A lone "1" left behind is enough to fail an otherwise good label line.
  // Done as a pre-clean rather than by dropping bare digits, because a bare
  // digit on the entry side can be a real variant discriminator ("iPhone 15")
  // and dropping it would reopen the undersell this check just closed.
  const stripRatings = (entry) =>
    String(entry || '').replace(/\b\d+(\.\d+)?\s*(v|a|ma|w|hz|khz|mah|wh)\b/gi, ' ');

  const textAccountedForByClaim = (claim) => {
    const claimToks = new Set(tokenize(claim));
    if (claimToks.size === 0) return false;
    return readableText.some((entry) => {
      const entryToks = tokenize(stripRatings(entry)).filter((t) => !brandToks.has(t) && !isNoise(t));
      if (entryToks.length === 0) return false;
      return entryToks.every((t) => claimToks.has(t));
    });
  };
  const modelCorroborated = (claim) =>
    claimAccountedForByText(claim) && textAccountedForByClaim(claim);

  const brandInText = !!brand && brandCorroborated(brand);
  const modelInText = !!((modelNum && modelCorroborated(modelNum)) || (model && modelCorroborated(model)));

  // Primary brand, then the runners-up. The runners-up exist for one reason:
  // needsAuthenticityForensics scans EVERY brand candidate against the
  // high-risk brand list, so dropping them silently narrows the counterfeit
  // surface relative to the current engine (architecture review).
  //
  // REVIEW FINDING (valuation reviewer, LOW) folded in here too: the haystack
  // includes `logos`, so a brand appearing in a logo string used to be
  // labelled 'readable_text' and the `logo_visual` branch was unreachable.
  // Logo evidence and read-text evidence are different things and are now
  // distinguished — the brand must appear in text the model transcribed,
  // not merely in a logo it named.
  // Same token rule as the corroboration check above — substring matching here
  // would let brand "a" be "read" from "abcdefg". Scoped to transcribed text
  // only, so a brand seen in a LOGO is labelled logo_visual, not readable_text.
  const readTextTokens = new Set(readableText.flatMap(tokenize));
  const brandInReadText = !!brand && tokenize(brand).length > 0
    && tokenize(brand).every((t) => readTextTokens.has(t));
  const brand_candidates = [];
  const seenBrands = new Set();
  const pushBrand = (name, confidence, evidence) => {
    const clean = identityOrNull(name);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seenBrands.has(key)) return;
    seenBrands.add(key);
    brand_candidates.push({ brand: clean, confidence: clamp01(confidence), evidence });
  };
  // M4: 'packaging_design' is the vocabulary calibrateRecognition already
  // looks for. Read text still outranks it — a model string transcribed off
  // the box is stronger evidence than the box being a box.
  const isPackaging = src.is_packaging === true;
  pushBrand(
    brand,
    src.brand_confidence,
    brandInReadText ? 'readable_text'
      : isPackaging ? 'packaging_design'
      : (logos.length ? 'logo_visual' : 'visual_match'),
  );

  // REVIEW FINDING (valuation reviewer, CRITICAL — introduced by the fix for
  // the architecture reviewer's MEDIUM, which is why it is called out loudly).
  //
  // Runner-up brands exist ONLY to keep needsAuthenticityForensics armed. They
  // must never become the identity. Without the sentinel below, a null primary
  // meant the first runner-up landed at brand_candidates[0] — the single slot
  // assessFallbackIdentity and resolveEnvelopeKey read as THE brand. And the
  // prompt actively invites the speculation ("include a luxury brand even at
  // low confidence"), so this was the expected path, not an edge case.
  //
  // Measured: model says brand null / needs_confirmation true / "no legible
  // branding", offers Rolex at 0.25, against a real Submariner row —
  //
  //   without sentinel : brandOk true  -> anchor -> envelope anchor:r1
  //                      -> ACCEPT ₪34,000/38,000/44,000 at HIGH + ledger write
  //   with sentinel    : brandOk false -> no anchor -> envelope watches
  //                      -> DEGRADE ₪0/0/0 MANUAL_REQUIRED
  //
  // 'unidentified' is the codebase's own established sentinel — assessFallbackIdentity,
  // retrieveCandidates and the candidate_payload builder all already test for
  // exactly this string — so nothing new has to learn about it.
  //
  // Added ONLY when runner-ups actually exist. An empty list must stay empty:
  // calibrateRecognition clamps category_confidence to 0.55 on a zero-length
  // brand_candidates but to 0.65 via the topBrand branch when a sentinel is
  // present, and that difference straddles the 0.60 Google Vision trigger.
  // Gating this way keeps the no-candidates case byte-identical to the current
  // engine and confines the delta to scans that genuinely carry a runner-up.
  const runnerUps = Array.isArray(src.candidate_brands)
    ? src.candidate_brands.slice(0, 4).filter((c) => c && typeof c === 'object' && identityOrNull(c.brand))
    : [];
  if (runnerUps.length > 0) {
    if (brand_candidates.length === 0) {
      brand_candidates.push({ brand: 'unidentified', confidence: 0, evidence: 'no_brand_determined' });
      seenBrands.add('unidentified');
    }
    for (const c of runnerUps) pushBrand(c.brand, c.confidence, 'candidate_brand');
  }

  // Primary model candidate, then the siblings the model could not separate.
  // Deduped case-insensitively so a repeated primary does not inflate the list
  // and make an ambiguous scan look like it has breadth of evidence.
  const model_candidates = [];
  const seenModels = new Set();
  const pushModel = (name, confidence, evidence) => {
    const clean = identityOrNull(name);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seenModels.has(key)) return;
    seenModels.add(key);
    model_candidates.push({ model: clean, confidence: clamp01(confidence), evidence });
  };
  pushModel(model, src.model_confidence, modelInText ? 'model_number_text' : 'visual_match');
  if (Array.isArray(src.candidate_models)) {
    for (const c of src.candidate_models.slice(0, 5)) {
      if (!c || typeof c !== 'object') continue;
      pushModel(c.model, c.confidence, 'sibling_candidate');
    }
  }

  const va = (src.visual_attributes && typeof src.visual_attributes === 'object') ? src.visual_attributes : {};
  // REVIEW FINDING (valuation reviewer, MEDIUM). This defaulted to 'Good',
  // which normalizeConditionBasis maps to the `used` rung (0.30). The guard's
  // own contract says an unmappable condition must yield null and callers
  // "MUST treat null as no adjustment, never as a default rung" — and the
  // current engine does exactly that. Manufacturing a rung here is directional:
  // with basis `used`, a user selecting New gets conditionDelta = 0 − 0.30, a
  // 30% price UPLIFT the current engine would never apply.
  //
  // Empty string, not a guess. normalizeConditionBasis('') → null → no
  // adjustment, and normalizeForUI's `|| 'unknown'` fallback then behaves
  // exactly as it does for a current-engine scan with no condition.
  const condition = CONDITIONS.includes(va.condition) ? va.condition : '';

  const category = CATEGORIES.includes(src.category) ? src.category : 'Other';

  // Ambiguity: the model's own flag OR the structural fact that it offered more
  // than one model. Either is enough — an `exact_model_ambiguous: false` next to
  // three candidate_models is a contradiction, and the safe reading wins.
  // M1 (recognition reviewer). `model: null` plus ONE candidate at 0.88
  // resolved to `level: exact` on a `sibling_candidate` evidence string — the
  // model explicitly declined to name a primary, and the pipeline promoted its
  // suggestion to a determination anyway. Prompt rule 4 only ever constrained
  // the two-or-more case, so a lone candidate slipped through.
  //
  // A declined primary IS the ambiguity signal, independent of how many
  // alternatives were offered.
  const primaryDeclined = model === null && model_candidates.length > 0;
  const exact_model_ambiguous = src.needs_confirmation === true
    || identityOrNull(src.ambiguity_reason) !== null
    || model_candidates.length > 1
    || primaryDeclined;

  const embedding_text = [
    brand, model || family, category,
    identityOrNull(src.subcategory), objectType,
    ...stringList(va.materials, 4),
    ...stringList(va.colors, 3),
  ].filter(Boolean).join(' ');

  // category_confidence mirrors identity_confidence only as a STARTING point;
  // calibrateRecognition then re-derives it against text evidence exactly as it
  // does for the current engine. No special casing, no bypass.
  return {
    category,
    category_hebrew: CATEGORY_HEBREW[category] || '',
    category_confidence: clamp01(src.identity_confidence),
    subcategory: identityOrNull(src.subcategory) || '',
    model_family: family,
    exact_model_ambiguous,
    brand_candidates,
    model_candidates,
    ocr_text: {
      raw_texts: readableText,
      logos_detected: logos,
      // REVIEW FINDING (architecture + recognition reviewers, CRITICAL). This
      // was `modelNum ? [modelNum] : []` — a straight copy of a model-ASSERTED
      // string into the OCR evidence channel, eleven lines after the adapter
      // had already computed `modelInText` and established the string does not
      // appear in the text. `labels_detected` is one of the three disjuncts in
      // calibrateRecognition's `textConfirmed`, so the effect was measured as:
      // one unverified field flipped a 0.97 silhouette guess from clamped/
      // `family` to unclamped/`exact`, AND satisfied evaluateFastPath's
      // `corroboration = 'stage1_ocr'` gate — skipping Stage 2 entirely and
      // pricing off the anchor. The adapter was manufacturing the very
      // evidence it exists to verify.
      //
      // A label is only a label if we saw it in the text we read back.
      labels_detected: (modelNum && modelInText) ? [modelNum] : [],
      has_readable_text: hasReadableText,
    },
    visual_features: {
      materials: stringList(va.materials, 8),
      colors: stringList(va.colors, 8),
      finish: identityOrNull(va.finish) || '',
      shape: identityOrNull(va.shape) || '',
      condition,
    },
    embedding_text,
    suggested_followup: identityOrNull(src.ambiguity_reason),
    // Namespaced under a single key so the provenance of this recognition is
    // auditable without any of it being mistaken for evidence. Read by
    // analyze.js for telemetry only — nothing branches on it.
    _openai: {
      object_type: objectType,
      model_number: modelNum,
      identity_confidence: clamp01(src.identity_confidence),
      needs_confirmation: src.needs_confirmation === true,
      is_packaging: isPackaging,
      ambiguity_reason: identityOrNull(src.ambiguity_reason),
      // NAMED FOR WHAT THEY ARE (recognition review). These were
      // `brand_text_corroborated` / `model_text_corroborated`, which a reviewer
      // reading the A/B would take as "verified against text". They are not:
      // the model authors BOTH the identity and the text, so when it echoes its
      // own guess this is a tautology. The honest name says only that the claim
      // appears in the strings the model returned.
      brand_appears_in_returned_text: brandInText,
      model_appears_in_returned_text: modelInText,
      language,
    },
  };
}
