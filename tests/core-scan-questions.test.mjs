// CQ — which questions identification may ask (Phase 3; Production scan b4254487, Sony DualSense, 2026-11-10).
// That scan asked "working order" — the listing flow's own condition choice — and the answer changed no price while
// costing the owner 9.7 s. The question that mattered was never asked: a standard DualSense or a DualSense Edge.
// Pinned here: condition / working-order questions are never offered (English and Hebrew); questions about WHAT the
// item is survive and come first; an edition answer changes the search; the prompt tells the model not to guess an
// edition it cannot see.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentity, completeIdentity, recordAnswer, isConditionQuestion } from '../api/_lib/scan/identify.js';
import { buildIdentityPrompt } from '../api/_lib/scan/identity-prompt.js';
import { buildSearchQueries } from '../api/_lib/scan/market.js';
import { RAW_IDENTITY } from './helpers/core-scan-fakes.mjs';

const Q = (attribute, kind, question, over = {}) => ({ attribute, kind, question, options: kind === 'yes_no' ? ['Yes', 'No'] : [], unit: null, impact: 'medium', affects: 'price', ...over });
const scan = (over, { lang = 'en', followupsLeft = 2 } = {}) =>
  completeIdentity(normalizeIdentity({ ...RAW_IDENTITY, visible_text: [], ...over }), { lang, followupsLeft });
const DUALSENSE = {
  category: 'Electronics', item_type: 'game controller', brand: 'Sony', product_family: 'DualSense', model: null,
  exact_model_established: false, identity_confidence: 'medium', display_name: 'Sony DualSense', canonical_name: 'sony dualsense',
  search: { hebrew_name: 'שלט Sony DualSense ל-PS5', aliases: [], model_numbers: [] },
  // What the prompt now asks for when the photograph cannot tell the editions apart.
  alternatives: [{ name: 'Sony DualSense (standard)', distinguishing: 'no back paddles' }, { name: 'Sony DualSense Edge', distinguishing: 'back paddles, swappable stick caps' }],
};
// Scan b4254487's identity: a standard DualSense, named.
const NAMED = { ...DUALSENSE, model: 'DualSense', exact_model_established: true, alternatives: [] };
const EDITION = Q('model', 'choice', 'Which DualSense is it? The Edge has two paddles on the back.', { options: ['DualSense (standard)', 'DualSense Edge'], impact: 'high', affects: 'identity' });

describe('CQ-1 condition and working order are never asked', () => {
  test('CQ-1a scan b4254487 as it was: the "working order" question is dropped; nothing is asked in its place', () => {
    const i = scan({ ...NAMED, clarifications: [Q('working order', 'yes_no', 'Does the controller work properly?')] });
    assert.equal(i.followup.kind, 'none');
    assert.equal(i.clarifications.length, 0);
  });

  test('CQ-1b every wording of it, in English and Hebrew, by attribute or by question', () => {
    for (const [attribute, question] of [
      ['working order', 'Is it in working order?'], ['works', 'Does everything work?'], ['condition', 'What condition is it in?'],
      ['damage', 'Is there any damage?'], ['detail', 'Any scratches on the screen?'], ['power', 'Does it power on?'],
      ['faults', 'Any known faults?'], ['wear', 'How worn is it?'], ['x', 'האם השלט תקין?'], ['x', 'מה מצב המכשיר?'],
      ['x', 'האם הוא עובד?'], ['x', 'יש שריטות או פגמים?'], ['x', 'האם הוא נדלק?'],
    ]) {
      assert.equal(isConditionQuestion({ attribute, question }), true, question);
    }
  });

  test('CQ-1c questions about WHAT the item is, or what comes with it, are not touched', () => {
    for (const [attribute, question] of [
      ['model', 'Which DualSense is it?'], ['edition', 'Standard or Edge?'], ['storage', 'How much storage does it have?'],
      ['usb receiver included', 'Is the USB receiver included?'], ['generation', 'Which AirPods Pro are they?'],
      ['box', 'Does it come with the original box?'], ['remaining', 'How much perfume is left in the bottle?'],
      ['network', 'Is it locked to a network?'], ['x', 'כמה נפח אחסון יש לו?'], ['x', 'איזה דגם זה?'],
    ]) {
      assert.equal(isConditionQuestion({ attribute, question }), false, question);
    }
  });

  test('CQ-1d a condition question proposed first does not hide the identity question behind it', () => {
    const i = scan({ ...DUALSENSE, clarifications: [Q('working order', 'yes_no', 'Does it work?', { impact: 'high' }), EDITION] });
    assert.deepEqual([i.followup.attribute, i.followup.kind, i.followup.required], ['model', 'choice', true]);
  });
});

describe('CQ-2 a look-alike edition is asked, not guessed', () => {
  test('CQ-2a DualSense or DualSense Edge: an identity choice, asked before the search, with both options', () => {
    const i = scan({ ...DUALSENSE, clarifications: [EDITION] });
    assert.equal(i.followup.affects, 'identity');
    assert.equal(i.followup.required, true, 'it decides which listings are the same product: before the search');
    assert.deepEqual(i.followup.options, ['DualSense (standard)', 'DualSense Edge']);
  });

  test('CQ-2b the owner says Edge: the identity becomes the Edge and the search looks for the Edge', () => {
    const i = scan({ ...DUALSENSE, clarifications: [EDITION] });
    const { identity } = recordAnswer(i, 1, { lang: 'en', followupsLeft: 1 });
    assert.equal(identity.model, 'DualSense Edge');
    assert.equal(identity.exact_model_established, true);
    assert.ok(buildSearchQueries({ identity }).every((q) => /Edge/.test(q)), 'every query names the Edge');
  });

  test('CQ-2c the owner says standard: no query looks for the Edge', () => {
    const i = scan({ ...DUALSENSE, clarifications: [EDITION] });
    const { identity } = recordAnswer(i, 0, { lang: 'en', followupsLeft: 1 });
    assert.equal(identity.exact_model_established, true);
    for (const stage of ['local', 'expand']) assert.ok(!buildSearchQueries({ identity, stage }).some((q) => /edge/i.test(q)), stage);
  });

  test('CQ-2d similar products: Xbox controller or Elite, Switch or Switch OLED — the same identity choice', () => {
    for (const [family, options] of [['Xbox Wireless Controller', ['Xbox Wireless Controller', 'Xbox Elite Series 2']], ['Nintendo Switch', ['Nintendo Switch', 'Nintendo Switch OLED']]]) {
      const i = scan({ ...DUALSENSE, brand: family.split(' ')[0], product_family: family, display_name: family, canonical_name: family.toLowerCase(),
        clarifications: [Q('model', 'choice', `Which ${family} is it?`, { options, impact: 'high', affects: 'identity' })] });
      assert.deepEqual([i.followup.kind, i.followup.required, i.followup.options], ['choice', true, options], family);
    }
  });
});

describe('CQ-3 what the identification prompt tells the model', () => {
  const prompt = buildIdentityPrompt({ lang: 'en', imageCount: 1, followupsLeft: 2 });

  test('CQ-3a never ask about condition, wear, damage or working order', () => {
    assert.match(prompt, /never ask about the item's condition, wear, damage or whether it works \(working order, powers on, any faults\)/);
    assert.match(prompt, /the owner chooses the condition when listing/);
  });

  test('CQ-3b look-alike editions: do not guess the standard one; list them; ask the choice; name it when the photo shows it', () => {
    assert.match(prompt, /LOOK-ALIKE EDITIONS/);
    assert.match(prompt, /DualSense or DualSense Edge/);
    assert.match(prompt, /do not guess the standard one: set exact_model_established to "no"/);
    assert.match(prompt, /When the photograph does show it, name the one it shows and ask nothing about it/);
  });
});
