/**
 * UI-003 Wave 0 — TRUST COPY CONTRACT.
 *
 * The app performs no authenticity verification. Not by a person, not against a
 * manufacturer, not by a third party. Every authenticity signal it can show is
 * either a vision model's reading of a photograph or a string the seller typed.
 *
 * This suite exists because that fact is invisible at every individual edit
 * site. Rewording one badge back to "Verified" looks like a copy tweak in a
 * diff; it is a claim the business cannot stand behind, on the surface where a
 * buyer decides whether to hand over money. The defect this file locks down
 * shipped as exactly that — `tier === 'high'`, the IDENTITY-confidence tier,
 * rendering a <Check> + 'מאומת' pill indistinguishable from the operator-backed
 * identity credential three components away.
 *
 * WHY SOURCE ASSERTIONS RATHER THAN A RENDER TEST.
 * `ResultsView` is a 2,400-line component behind the whole AppContext provider;
 * standing it up in jsdom would test the harness more than the copy. Worse, two
 * of the invariants here are NOT observable in the DOM text at all:
 *   · colour-as-credential — a badge can keep every string honest and re-grant
 *     the credential purely by turning the accent back to brand teal;
 *   · the Hebrew half — the app's DEFAULT language, and where the original
 *     defect was worst, is a translations table a render test typically misses.
 * So these read the source and the translation table directly. Every assertion
 * has a mutant in tests/mutations/ui-mutants.mjs (T01-T08); if one of these
 * stops discriminating, the mutation run says so.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT.
 * That `serial_verified` is trustworthy — it is not, and that is a live finding
 * (see T-08). It is asserted as a DOCUMENTED DEFECT rather than a passing
 * property, because changing what the flag means alters a persisted column and
 * is a data-model decision, not a copy fix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Overridable so tests/mutations/ui-run.mjs can ask the decisive question about
// this suite too: if a credential crept back, would anything notice?
const RESULTS_SRC = process.env.UI003_RESULTS_PATH || `${ROOT}src/views/CameraResultsView.jsx`;
const T_SRC       = process.env.UI003_TRANSLATIONS_PATH || `${ROOT}src/lib/translations.js`;
const DETAIL_SRC  = process.env.UI003_DETAIL_PATH || `${ROOT}src/views/BrowseDetailView.jsx`;

const read = (p) => readFileSync(p, 'utf8');

/**
 * Strip comments from an already-sliced REGION.
 *
 * The rationale blocks necessarily QUOTE the banned words in order to explain
 * why they are banned ("...shipped a <Shield> + 'אומת ✓' pill..."), so they must
 * not be able to satisfy or violate an assertion about shipped code.
 *
 * Applied to the slice, never to the whole file. A file-wide scanner has to
 * track string literals to avoid mistaking an apostrophe in JSX text for a
 * quote — and getting that wrong desynchronises everything after it, which is a
 * silent way for this suite to stop testing anything. Slicing first means the
 * anchors sit AFTER each rationale block, so the regions arrive nearly clean and
 * this only has to remove the short inline notes inside them.
 */
const stripComments = (region) => region.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

/** The authenticity overlay badge + the authenticity card, comments removed. */
function authRegions(src) {
  const s = src;
  const badgeStart = s.indexOf('const auth = result.authenticity;');
  assert.ok(badgeStart > 0, 'authenticity badge block not found — this suite is no longer testing what it names');
  const badgeEnd = s.indexOf('Photo counter dots', badgeStart);
  const cardStart = s.indexOf('const auth = result.authenticity;', badgeEnd);
  assert.ok(cardStart > badgeEnd, 'authenticity card block not found');
  // The card runs to the end of its IIFE; the AI-only disclaimer is its last line.
  const cardEnd = s.indexOf('qualified expert', cardStart);
  assert.ok(cardEnd > cardStart, 'authenticity card disclaimer not found');
  return {
    badge: stripComments(s.slice(badgeStart, badgeEnd)),
    card:  stripComments(s.slice(cardStart, cardEnd)),
  };
}

/** Values of every translation key matching `re`, per language block. */
function keyValues(re) {
  const src = read(T_SRC);
  const heAt = src.indexOf('\n  he: {');
  assert.ok(heAt > 0, 'he block not found in translations.js');
  const grab = (chunk) => Object.fromEntries(
    [...chunk.matchAll(/^\s{4}(\w+):\s*'((?:[^'\\]|\\.)*)',/gm)].filter(([, k]) => re.test(k)).map(([, k, v]) => [k, v])
  );
  return { en: grab(src.slice(0, heAt)), he: grab(src.slice(heAt)) };
}

// The vocabulary this app reserves for a check a PERSON performed, plus the
// credential glyphs. `אומת` is a substring of `מאומת`, so the one pattern covers
// both, and both inflections appear in the wild.
const CREDENTIAL = /Verified|Verification|Authenticated|מאומת|אומת|✓|✔/;
const TRUST_KEYS = /^(auth[A-Z]|serial(Captured|Provided)$|imeiCaptured$)/;

test('T-01 no authenticity or serial label claims a verification, in EITHER language', () => {
  const { en, he } = keyValues(TRUST_KEYS);
  assert.ok(Object.keys(en).length >= 10, `only ${Object.keys(en).length} trust keys found — the selector has drifted`);
  for (const [lang, block] of [['en', en], ['he', he]]) {
    for (const [k, v] of Object.entries(block)) {
      assert.ok(!CREDENTIAL.test(v),
        `${lang}.${k} = "${v}" claims a verification that never happened. ` +
        `Nothing in the scan path is checked by a person or a third party.`);
    }
  }
});

test('T-02 the Hebrew trust vocabulary is complete — a missing key renders an EMPTY badge, silently', () => {
  const { en, he } = keyValues(TRUST_KEYS);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(he).sort(),
    'en/he trust key sets differ. Hebrew is this app\'s DEFAULT language: a key present in en ' +
    'and absent in he renders `undefined`, i.e. a badge with no text, which fails silently.');
  for (const [k, v] of Object.entries(he)) assert.ok(v.trim().length > 0, `he.${k} is empty`);
});

test('T-03 every AI-derived authenticity badge attributes itself to the AI', () => {
  const { en, he } = keyValues(/^auth(SerialSeen|DocsSeen|SignsSeen|Indicators|Uncertain|FakeSigns|ReplicaSigns)$/);
  assert.equal(Object.keys(en).length, 7, 'the AI-attributed key set has changed');
  for (const [lang, block] of [['en', en], ['he', he]]) {
    for (const [k, v] of Object.entries(block)) {
      assert.match(v, /AI/,
        `${lang}.${k} = "${v}" does not name the AI. Unattributed, it reads as a finding by ` +
        `the platform or a third party, which is the defect this wave exists to fix.`);
    }
  }
});

test('T-04 the authenticity surfaces use no credential iconography', () => {
  const { badge, card } = authRegions(read(RESULTS_SRC));
  for (const [name, region] of [['overlay badge', badge], ['authenticity card', card]]) {
    assert.ok(!/<Shield\b/.test(region),
      `<Shield> in the ${name}. Shield is this app's OPERATOR identity-verification marker ` +
      `(App.jsx, ChatViews, OrderViews); on an AI reading it asserts a credential.`);
    assert.ok(!/<Check\b/.test(region),
      `a bare <Check> in the ${name}. The checkmark IS the credential glyph.`);
  }
});

test('T-05 the identity-confidence tier grants no authenticity badge', () => {
  const { badge } = authRegions(read(RESULTS_SRC));
  // `tier` is IDENTITY confidence — how sure the model is WHAT the object is.
  // It carries no authenticity information, so it may not appear in this block
  // in any form. The shipped defect was `tier === 'high'` → 'Authenticated'.
  assert.ok(!/\btier\b/.test(badge),
    'the authenticity badge references `tier`. That is the identity-confidence tier and it ' +
    'says nothing about authenticity — a high-confidence match on an ordinary used chair ' +
    'displayed "מאומת". Do not restore this arm as a "clean" or "passed" badge: the state it ' +
    'fired on (authenticityRisk === "low") is the one where analyze.js decided no authenticity ' +
    'assessment was needed at all, so there is no finding behind it.');
});

test('T-06 an authenticity INDICATOR is never painted as brand-accent approval', () => {
  const { card } = authRegions(read(RESULTS_SRC));
  const accent = card.match(/const accent\s*=\s*[^;]+;/);
  assert.ok(accent, 'the card accent expression was not found');
  // Colour makes a claim of its own. This is the invariant a DOM/text test
  // misses entirely: every string can stay honest while teal re-grants the
  // credential. The card only renders for medium/high-risk items, so an
  // "indicator" cannot clear one.
  assert.ok(/hasIndicator\s*\?\s*STITCH\.onSurfaceVariant/.test(accent[0]),
    `the indicator state must resolve to a NEUTRAL accent, got: ${accent[0]}`);
  assert.ok(!/hasIndicator\s*\?\s*STITCH\.primary/.test(accent[0]),
    'the indicator state resolves to STITCH.primary — brand teal reads as "the platform says yes".');
});

test('T-07 the buyer-facing serial chip attributes the claim to the seller', () => {
  const src = read(DETAIL_SRC);
  const ANCHOR = 'serialVerified && (';
  const at = src.indexOf(ANCHOR);
  assert.ok(at > 0, 'the serial trust chip was not found in BrowseDetailView');
  // Slice PAST the anchor: `serialVerified` is the local read of the
  // `serial_verified` COLUMN, and an identifier naming a database field is not a
  // claim to a user. Only what the chip renders is in scope here.
  const chip = stripComments(src.slice(at + ANCHOR.length, at + 500));
  assert.ok(!CREDENTIAL.test(chip),
    'the buyer-facing serial chip claims a verification. It sits in the same row as the ' +
    'genuine operator-backed "Verified ID" chip, so a buyer cannot tell them apart — and ' +
    'this one is set by a seller typing eight characters.');
  assert.ok(!/<Check\b/.test(chip), 'the serial chip uses a credential checkmark');
  assert.match(chip, /t\.serialProvided/, 'the chip must name the seller as the source of the claim');
});

test('T-08 KNOWN DEFECT: serial_verified is self-asserted — a typed string sets it true', { skip: 'documented Wave 0 finding, not fixed: changing the flag alters a persisted column (data-model decision)' }, () => {
  // Left executable and skipped ON PURPOSE, so the defect lives in the suite
  // rather than only in a report someone has to remember.
  //
  //   AppContext.jsx submitSerialText:  verified: isImei || serial.length >= 8
  //
  // A seller typing 'ABCDEFGH' sets listings.serial_verified = true. The copy
  // fix (T-07) stops the platform ASSERTING the check, but any future surface
  // reading this column inherits the same falsehood. The real fix is to
  // validate serials or drop the flag. Un-skip when that decision is made.
  const src = read(`${ROOT}src/contexts/AppContext.jsx`);
  assert.ok(!/verified:\s*isImei\s*\|\|\s*serial\.length\s*>=\s*8/.test(src),
    'serial_verified can still be set true by typing eight arbitrary characters');
});
