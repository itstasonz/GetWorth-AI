// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — A NAME IS PROMOTED BY WHAT THE RESULTS SHOW, NEVER BY WHAT THEY OMIT
//
// A family name is true of every member of the line, so seeing it beside this
// product proves membership and not identity. A proposed textual alias becomes
// EXACT only from positive evidence: shown WHOLE, in a title, beside an EXACT
// model number, on two independent sites. That a result set happens to contain
// no sibling is not evidence, and has no effect.
//
//   A. family alias + no sibling returned            -> NOT EXACT
//   B. family alias + exact model corroboration      -> FAMILY stays FAMILY
//   C. unique short name tied to the exact model      -> EXACT allowed
//   D. model number corroborated by 2+ domains        -> EXACT
//   E. a result that contradicts nothing              -> zero effect
//
// No test here makes a provider call.
//
//   node --test tests/scan-v2-alias.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assessMarketIdentity, relationOf, nameShownIn, tokens, RELATION, NAME_SHOWN, MIN_ALIAS_SITES } from '../api/_lib/v2/market-identity.js';
import { normalizeIdentity } from '../api/_lib/v2/identity.js';
import * as M from './fixtures/scan-v2/market-fixtures.mjs';
import { MATRIX } from './fixtures/scan-v2/market-matrix.mjs';

describe('V2-40 a name is promoted by what the results show, never by what they omit', () => {
  let n = 0;
  const pg = (host, title, text = '') => ({ url: `https://www.${host}/p/${(n += 1)}`, domain: `www.${host}`, title, text });
  const hyp = (aliases, model_numbers) => normalizeIdentity({ ...M.NINJA, market_hypotheses: { aliases, model_numbers } });
  const assess = (identity, results) => assessMarketIdentity({ identity, results });
  const rel = (identity, results, value) => assess(identity, results).aliases.find((a) => a.value === value);
  const sites = (title, k) => Array.from({ length: k }, (_, i) => pg(`site${i}.co.il`, title));

  test('V2-40a A · a family name beside the read name, no sibling returned: NOT EXACT, however many sites agree', () => {
    const only = hyp(['Ninja Detect'], []);
    for (const k of [2, 6]) {
      const a = rel(only, sites('Ninja Detect Power Blender Duo Pro', k), 'Ninja Detect');
      assert.notEqual(a.relation, RELATION.EXACT, `${k} sites`);
      assert.equal(a.sites_seen, 0, 'seen beside the read name is membership, and counts for nothing');
      assert.equal(a.seen_beside_read_name, k);
      assert.deepEqual(a.tied_to, []);
      assert.deepEqual(assess(only, sites('Ninja Detect Power Blender Duo Pro', k)).exact_phrases, []);
    }
    // And so a listing that names the product by the family name alone is not EXACT.
    const market = assess(only, sites('Ninja Detect Power Blender Duo Pro', 6));
    assert.notEqual(relationOf('Ninja Detect שייקר 300 ₪', market), RELATION.EXACT);
  });
  test('V2-40b A · the real shape: "Detect" inside "Detect Duo … TB301" on two sites is a fragment, and the number is EXACT', () => {
    const only = hyp(['Ninja Detect'], ['TB301']);
    const two = [pg('makerone.com', 'Ninja Detect Duo Power Blender Pro TB301'), pg('reviewtwo.com', 'Ninja Detect Duo Power Blender Pro TB301 review')];
    const m = assess(only, two);
    assert.equal(m.aliases.find((a) => a.value === 'TB301').relation, RELATION.EXACT);
    const detect = m.aliases.find((a) => a.value === 'Ninja Detect');
    assert.notEqual(detect.relation, RELATION.EXACT);
    assert.deepEqual([detect.sites_seen, detect.seen_as_fragment, detect.also_used_for], [0, 2, []]);
    assert.deepEqual(m.corroborated, ['TB301']);
  });
  test('V2-40c B · a family name stays FAMILY under exact-model corroboration, unless the name itself is the whole name', () => {
    // Shared with another model: FAMILY, with two sites tying it to TB301.
    const only = hyp(['Ninja Detect'], ['TB301']);
    const tied = [pg('makerone.com', 'Ninja Detect TB301 Power Blender Duo Pro'), pg('reviewtwo.com', 'Ninja Detect TB301 Power Blender Duo Pro')];
    const shared = rel(only, [...tied, pg('shopthree.co.il', 'Ninja Detect TB303 שייקר')], 'Ninja Detect');
    assert.deepEqual([shared.relation, shared.sites_seen, shared.also_used_for], [RELATION.FAMILY, 2, ['TB303']]);
    // The short form of a longer proposed name: FAMILY, with the same two sites.
    const both = hyp(['Ninja Detect Duo', 'Ninja Detect'], ['TB301']);
    const short = rel(both, tied, 'Ninja Detect');
    assert.deepEqual([short.relation, short.sites_seen, short.short_form_of], [RELATION.FAMILY, 2, 'Ninja Detect Duo']);
    assert.ok(!assess(both, tied).exact_phrases.some((p) => p.join(' ') === 'detect'));
  });
  test('V2-40d C · a short name shown whole beside the exact number by two independent domains: EXACT allowed', () => {
    const duo = hyp(['Ninja Detect Duo'], ['TB301']);
    const two = [pg('makerone.com', 'Ninja Detect Duo Power Blender Duo Pro TB301 | Official'), pg('reviewtwo.com', 'Ninja TB301 Detect Duo Power Blender Duo Pro specifications')];
    const m = assess(duo, two);
    const a = m.aliases.find((x) => x.value === 'Ninja Detect Duo');
    assert.deepEqual([a.relation, a.sites_seen, a.tied_to, a.evidence.map((e) => e.site).sort()], [RELATION.EXACT, 2, ['TB301'], ['makerone.com', 'reviewtwo.com']]);
    assert.deepEqual(m.exact_phrases, [['detect', 'duo']]);
    assert.equal(relationOf('Ninja Detect Duo שייקר 300 ₪', m), RELATION.EXACT);
    // One site, or two pages of one site, is not two sites.
    assert.equal(rel(duo, two.slice(0, 1), 'Ninja Detect Duo').relation, RELATION.UNVERIFIED);
    assert.equal(rel(duo, [two[0], pg('shop.makerone.com', two[0].title)], 'Ninja Detect Duo').relation, RELATION.UNVERIFIED);
    // And without the number beside it, the same two sites prove membership only.
    const noNumber = rel(duo, sites('Ninja Detect Duo Power Blender Duo Pro', 2), 'Ninja Detect Duo');
    assert.deepEqual([noNumber.relation, noNumber.sites_seen, noNumber.seen_beside_read_name], [RELATION.UNVERIFIED, 0, 2]);
  });
  test('V2-40e D · a model number corroborated by two independent domains is EXACT; by one, or by one domain twice, it is not', () => {
    const num = hyp([], ['TB301']);
    const page = (host) => pg(host, 'Ninja Power Blender Duo Pro TB301');
    assert.equal(rel(num, [page('makerone.com'), page('reviewtwo.com')], 'TB301').relation, RELATION.EXACT);
    assert.equal(rel(num, [page('makerone.com')], 'TB301').relation, RELATION.UNVERIFIED);
    assert.equal(rel(num, [page('makerone.com'), page('shop.makerone.com')], 'TB301').relation, RELATION.UNVERIFIED);
    assert.equal(rel(num, [page('makerone.com'), page('reviewtwo.com')], 'TB301').sites_seen, 2);
  });
  test('V2-40f E · a result that contradicts nothing has zero effect on promotion', () => {
    const duo = hyp(['Ninja Detect Duo', 'Ninja Detect'], ['TB301']);
    const base = [pg('makerone.com', 'Ninja Detect Duo Power Blender Duo Pro TB301'), pg('reviewtwo.com', 'Ninja TB301 Detect Duo Power Blender Duo Pro')];
    const view = (rs) => assess(duo, rs).aliases.map((a) => [a.value, a.relation]).sort();
    const harmless = [
      pg('shopfour.co.il', 'Ninja Foodi Air Fryer | שופ'),                               // another product of the brand
      pg('shopfive.co.il', 'Ninja Power Blender Duo Pro TB301 | שופ'),                    // this product, without the alias
      pg('shopsix.co.il', 'Ninja Detect Duo Power Blender Duo Pro'),                     // the alias beside the read name, no number
      pg('shopseven.co.il', 'Ninja Detect Power Blender Duo Pro TB301'),                 // the family name, whole — one site
    ];
    for (const extra of harmless) assert.deepEqual(view([...base, extra]), view(base), extra.title);
    assert.deepEqual(view([...base, ...harmless]), view(base));
    assert.deepEqual(view(base), [['Ninja Detect Duo', RELATION.EXACT], ['Ninja Detect', RELATION.UNVERIFIED], ['TB301', RELATION.EXACT]]);
    // A proposed number that only one site showed is a hypothesis, not "another model" the name is shared with.
    const oneSite = rel(hyp(['Ninja Detect Duo'], ['TB301']), base.slice(0, 1), 'Ninja Detect Duo');
    assert.deepEqual([oneSite.relation, oneSite.also_used_for], [RELATION.UNVERIFIED, []]);
    // The absence of a sibling is not a promotion either: with and without one, the family name is not EXACT.
    const only = hyp(['Ninja Detect'], ['TB301']);
    const pages = sites('Ninja Detect Duo Power Blender Pro TB301', 3);
    const without = rel(only, pages, 'Ninja Detect');
    const withSibling = rel(only, [...pages, pg('shopthree.co.il', 'Ninja Detect TB303 שייקר')], 'Ninja Detect');
    assert.notEqual(without.relation, RELATION.EXACT);
    assert.notEqual(withSibling.relation, RELATION.EXACT);
    assert.equal(without.sites_seen, withSibling.sites_seen);
  });
  test('V2-40g how a title shows a name: whole, or a fragment of a longer one', () => {
    const identity = normalizeIdentity(M.NINJA);
    const bounds = { brandTokens: tokens('Ninja'), nameTokens: tokens('Power Blender Duo Pro'), kindTokens: [...tokens(identity.object_class), ...tokens(identity.local_name)] };
    const shown = (title, name) => nameShownIn(title, tokens(name), bounds);
    for (const [title, name, expected] of [
      ['Ninja Detect Duo | KSP', 'detect duo', NAME_SHOWN.WHOLE],
      ['Ninja Detect Duo Power Blender Pro TB301', 'detect duo', NAME_SHOWN.WHOLE],
      ['Ninja Detect Duo Power Blender Pro TB301', 'detect', NAME_SHOWN.FRAGMENT],
      ['Ninja Detect Duo Pro TB301', 'detect', NAME_SHOWN.FRAGMENT],
      ['Ninja Foodi Detect Duo TB301', 'detect duo', NAME_SHOWN.FRAGMENT],
      ['Ninja Detect Duo blender TB301', 'detect duo', NAME_SHOWN.WHOLE],
      ['בלנדר Ninja Detect Duo TB301', 'detect duo', NAME_SHOWN.WHOLE],
      ['Ninja Detect Duo Black TB301', 'detect duo', NAME_SHOWN.FRAGMENT],
      ['Ninja Detect Duo Review', 'detect duo', NAME_SHOWN.FRAGMENT],
      ['Ninja Detect Duo (TB-301 model)', 'detect duo', NAME_SHOWN.WHOLE],
      ['Ninja TB301 Detect Duo Power Blender Pro + Single Serve Replacement Cups?', 'detect duo', NAME_SHOWN.WHOLE],
      ['Ninja Detect™ Duo® Power Blender Smoothie Maker with BlendSense™ - Ninja', 'detect duo', NAME_SHOWN.WHOLE],
      ['Ninja Power Blender Duo Pro TB301', 'detect duo', NAME_SHOWN.ABSENT],
    ]) assert.equal(shown(title, name), expected, `${title} / ${name}`);
  });
  test('V2-40h INVARIANT on every fixture: an EXACT name is tied to an exact number on two sites, and a name beside the read name alone is never EXACT', () => {
    for (const m of MATRIX) {
      for (const a of m.evidence.market.aliases.filter((x) => x.kind === 'name')) {
        if (a.relation === RELATION.EXACT) {
          assert.ok(a.sites_seen >= MIN_ALIAS_SITES && a.tied_to.length > 0 && a.evidence.length >= MIN_ALIAS_SITES, `${m.name}: ${a.value}`);
          assert.ok(a.tied_to.every((r) => m.evidence.market.exact_roots.includes(r)), `${m.name}: ${a.value} tied to an exact number`);
          assert.equal(a.also_used_for.length, 0, `${m.name}: ${a.value}`);
          assert.equal(a.short_form_of, null, `${m.name}: ${a.value}`);
        }
        if (a.tied_to.length === 0) assert.notEqual(a.relation, RELATION.EXACT, `${m.name}: ${a.value}`);
      }
    }
  });
});
