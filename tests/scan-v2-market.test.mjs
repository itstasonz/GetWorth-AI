// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — MARKET IDENTITY, THE SEARCH CAP, PRICE ROLES, ACCOUNTING
//
// What a product is SOLD AS is a hypothesis until the results corroborate it;
// four queries make one search action and there is no second; a number has a
// role before it is a price; and every result ends in exactly one bucket.
//
// A is the real production witness (one paid search, saved). B–M are synthetic.
// No test here makes a provider call.
//
//   node --test tests/scan-v2-market.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { assessMarketIdentity, relationOf, RELATION, MIN_ALIAS_SITES } from '../api/_lib/v2/market-identity.js';
import { extractListings, classifyNumbers, ROLE, REFUSED, PAGE, BINDING } from '../api/_lib/v2/listing-extraction.js';
import { BUCKET, EVIDENCE_CLASS, ANCHOR_STRENGTH } from '../api/_lib/v2/evidence.js';
import { PRICE_STATE, USED_EVIDENCE, IDENTITY_CONFIDENCE } from '../api/_lib/v2/pricing.js';
import { normalizeIdentity } from '../api/_lib/v2/identity.js';
import { subjectOf, planV2Search, MAX_V2_QUERIES, V2_PURPOSE } from '../api/_lib/v2/search-plan.js';
import { runV2Search, SEARCH_OUTCOME } from '../api/_lib/v2/search.js';
import { runV2Identify, runV2Price } from '../api/_lib/v2/scan.js';
import { describeSearch, describeEvidence } from '../api/_lib/v2/report.js';
import { extractSearchProvenance } from '../api/_lib/phaseb/search-provenance.js';
import { IMG, RAW, RESULTS_PS5_VERIFIED, mockV2Provider } from './fixtures/scan-v2/fixtures.mjs';
import * as M from './fixtures/scan-v2/market-fixtures.mjs';
import { IL, scan, alias, prices, MATRIX } from './fixtures/scan-v2/market-matrix.mjs';

describe('V2-30 A · the production witness: read as one thing, sold as another', () => {
  const { evidence, price } = MATRIX[0];
  test('V2-30a the fixture is the raw API output, and carries no contact detail', () => {
    const text = JSON.stringify(M.NINJA_WITNESS);
    assert.ok(!/@[a-z0-9-]+\.[a-z]/i.test(text), 'no e-mail address');
    assert.ok(!/(?<![\d.])0\d{1,2}-?\d{7}(?!\d)/.test(text), 'no phone number');
    assert.equal((text.match(/\[redacted-email\]/g) || []).length, 2);
    assert.ok(!/sk-[A-Za-z0-9]{8}|Bearer |eyJ[A-Za-z0-9]{10}/.test(text), 'no key or token');
    assert.equal(evidence.accounting.total, 31);
  });
  test('V2-30b each proposed name lands in its own relation', () => {
    assert.equal(alias(evidence, 'TB301').relation, RELATION.EXACT);
    assert.ok(alias(evidence, 'TB301').sites_seen >= MIN_ALIAS_SITES);
    assert.ok(alias(evidence, 'TB301').evidence.length >= MIN_ALIAS_SITES, 'and says which sites connected it');
    assert.equal(alias(evidence, 'Ninja Detect Duo').relation, RELATION.EXACT);
    assert.equal(alias(evidence, 'TB301UK').relation, RELATION.REGIONAL_VARIANT);
    assert.equal(alias(evidence, 'TB301EU').relation, RELATION.REGIONAL_VARIANT);
    assert.equal(alias(evidence, 'TB301EU').weak, true);
    assert.equal(alias(evidence, 'TB303').relation, RELATION.SIBLING);
    assert.equal(alias(evidence, 'Ninja Detect').relation, RELATION.FAMILY);
    assert.ok(alias(evidence, 'Ninja Detect').also_used_for.includes('TB303'));
    assert.equal(alias(evidence, 'TB300').relation, RELATION.UNVERIFIED);
    assert.deepEqual(evidence.market.corroborated.sort(), ['Ninja Detect Duo', 'TB301']);
  });
  test('V2-30c only the first search action — what a one-action scan keeps — gives the same relations', () => {
    const first = scan(M.NINJA, null, extractSearchProvenance(M.NINJA_WITNESS.output.slice(0, 1))).evidence;
    assert.equal(first.accounting.total, 16);
    assert.equal(alias(first, 'TB301').relation, RELATION.EXACT);
    assert.equal(alias(first, 'Ninja Detect Duo').relation, RELATION.EXACT);
    assert.equal(alias(first, 'TB303').relation, RELATION.SIBLING);
    // No result in this action uses "Detect" for another model, and that
    // absence promotes nothing: every page shows "Detect" as a fragment of
    // "Detect Duo", and it is the short form of a longer name proposed for this
    // product. It is not EXACT.
    const detect = alias(first, 'Ninja Detect');
    assert.notEqual(detect.relation, RELATION.EXACT);
    assert.equal(detect.sites_seen, 0);
    assert.ok(detect.seen_as_fragment >= 2 && detect.seen_beside_read_name >= 2);
    assert.equal(detect.short_form_of, 'Ninja Detect Duo');
    assert.deepEqual(first.market.corroborated.sort(), ['Ninja Detect Duo', 'TB301']);
    assert.equal(first.retail_anchor.low, 599);
  });
  test('V2-30d the three delivery fees are refused by role, and the price that includes one is kept', () => {
    const fees = evidence.refused.filter((r) => r.role === ROLE.DELIVERY_FEE);
    assert.deepEqual(fees.map((r) => r.value).sort((a, b) => a - b), [9, 29, 55]);
    assert.ok(fees.every((r) => r.reason === REFUSED.FEE));
    assert.ok(!prices(evidence.entries).some((p) => [9, 29, 55].includes(p)), 'no fee is an observation');
    const anchor = evidence.entries.find((e) => e.retail_anchor);
    assert.equal(anchor.role, ROLE.PRODUCT_PRICE_WITH_DELIVERY);
    assert.equal(anchor.stated_price, 608);
    assert.equal(anchor.delivery_fee, 9);
    assert.equal(anchor.observation.observed_price, 599, '608 including the 9 pickup-point delivery it names');
    assert.equal(anchor.binding, BINDING.RESULT_TITLE);
  });
  test('V2-30e the sibling’s shop prices are SIBLING retail and are not the anchor', () => {
    const siblings = evidence.entries.filter((e) => e.relation === RELATION.SIBLING);
    assert.deepEqual(prices(siblings), [389, 418]);
    assert.ok(siblings.every((e) => e.evidence_class === EVIDENCE_CLASS.LOCAL_RETAIL && !e.retail_anchor && !e.admitted));
  });
  test('V2-30f a shop inside the market printing the exact product’s price without a currency sign is a row-bound anchor; everything else bare stays refused', () => {
    // "החל מ- 569 569 NINJA בלנדר ושייקר TB301": the second shop's price for the product.
    const ours = evidence.entries.find((e) => e.observation.observed_price === 569);
    assert.deepEqual([ours.kind, ours.relation, ours.binding, ours.row_bound, ours.currency_basis, ours.retail_anchor, ours.admissible, ours.observation.currency],
      ['new_retail', RELATION.EXACT, BINDING.TABLE_ROW, true, 'site_locale', true, false, 'ILS']);
    // The sibling's bare price on the same page is reported, with whose it was, and not used.
    const unmarked = evidence.refused.filter((r) => r.reason === REFUSED.NO_CURRENCY);
    const sibling = unmarked.find((r) => r.value === 550);
    assert.equal(sibling.relation, RELATION.SIBLING);
    assert.equal(sibling.currency, null);
    assert.ok(!prices(evidence.entries).includes(550));
    assert.equal(evidence.counts.unmarked_prices, unmarked.length);
    assert.equal(evidence.counts.locale_inferred_prices, 1);
  });
  test('V2-30g the result: identified, no used market, two shops’ new price — no number for the used value, and what the estimate waits for', () => {
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    for (const k of ['low', 'recommended', 'high']) assert.equal(price[k], null);
    assert.equal(price.retail_anchor.kind, 'RETAIL_REPLACEMENT_ANCHOR');
    assert.deepEqual([price.retail_anchor.strength, price.retail_anchor.shops, price.retail_anchor.low, price.retail_anchor.high], [ANCHOR_STRENGTH.STRONG, 2, 569, 599]);
    assert.equal(price.confidence.identity.level, IDENTITY_CONFIDENCE.VERY_HIGH);
    assert.deepEqual(price.confidence.pricing, { used_market: USED_EVIDENCE.NONE, retail_anchor: ANCHOR_STRENGTH.STRONG });
    assert.equal(evidence.counts.by_class.LOCAL_USED, 0);
    assert.equal(price.evidence_state, 'INSUFFICIENT_EVIDENCE');
    assert.deepEqual([price.limitation.code, price.limitation.group], ['no_calibrated_resale_factor', 'home:blender:Good']);
  });
  test('V2-30h the whole deterministic half runs inside the latency budget', () => {
    assert.ok(evidence.timings.extraction_ms + evidence.timings.qualification_ms < 100, JSON.stringify(evidence.timings));
  });
});

describe('V2-31 an alias is a hypothesis until two sites connect it', () => {
  const results = (n) => [
    M.result('https://www.makerone.com/p/1', 'Ninja Power Blender Duo Pro TB301', ''),
    M.result('https://www.reviewtwo.com/p/2', 'Ninja TB301 Power Blender Duo Pro review', ''),
    M.result('https://shop.makerone.com/p/3', 'Ninja Power Blender Duo Pro TB301 buy', ''),
  ].slice(0, n).map((r) => ({ url: r.url, domain: new URL(r.url).hostname, title: r.title, text: r.snippet }));
  const identity = normalizeIdentity(M.NINJA);
  const relation = (rs, value = 'TB301') => assessMarketIdentity({ identity, results: rs }).aliases.find((a) => a.value === value)?.relation;

  test('V2-31a with no results every proposal is UNVERIFIED, and nothing may be matched on', () => {
    const market = assessMarketIdentity({ identity, results: [] });
    assert.ok(market.aliases.length === 4 && market.aliases.every((a) => a.relation === RELATION.UNVERIFIED));
    assert.deepEqual([market.exact_roots, market.exact_phrases, market.corroborated], [[], [], []]);
  });
  test('V2-31b one site is not corroboration; two pages of ONE site are still one site; two sites are', () => {
    assert.equal(relation(results(1)), RELATION.UNVERIFIED);
    assert.equal(relation([results(3)[0], results(3)[2]]), RELATION.UNVERIFIED, 'makerone.com and shop.makerone.com');
    assert.equal(relation(results(2)), RELATION.EXACT);
  });
  test('V2-31c the connection needs the brand AND the name read off the item beside the alias', () => {
    const noName = results(2).map((r) => ({ ...r, title: r.title.replace(/Power Blender Duo Pro/, 'blender') }));
    assert.equal(relation(noName), RELATION.UNVERIFIED);
    const noBrand = results(2).map((r) => ({ ...r, title: r.title.replace(/Ninja/, '') }));
    assert.equal(relation(noBrand), RELATION.UNVERIFIED);
  });
  test('V2-31d a page about several models connects nothing', () => {
    const multi = results(2).map((r) => ({ ...r, title: `${r.title} vs TB303` }));
    assert.equal(relation(multi), RELATION.UNVERIFIED);
  });
  test('V2-31e a sibling or a family name yields no matching token, and its text is never EXACT', () => {
    const { evidence } = MATRIX.find((m) => m.name === 'J sibling retail');
    assert.deepEqual(evidence.market.exact_roots, ['TB301']);
    assert.ok(!evidence.market.exact_roots.includes('TB303'));
    assert.equal(relationOf('Ninja Detect TB303 בלנדר', evidence.market), RELATION.SIBLING);
    assert.equal(relationOf('Ninja Power Blender Duo Pro TB303', evidence.market), RELATION.SIBLING, 'a sibling’s number decides it, whatever surrounds it');
    assert.equal(relationOf('Ninja TB301', evidence.market), RELATION.EXACT);
    assert.equal(relationOf('Ninja TB301UK', evidence.market), RELATION.REGIONAL_VARIANT);
    assert.deepEqual(evidence.qualification_runs.map((r) => r.form), ['read_off_item', 'alias:TB301'], 'the gate is asked about exact names only');
  });
  test('V2-31h a name tied to the exact number by two sites is FAMILY the moment one page uses it for another model', () => {
    const only = normalizeIdentity({ ...M.NINJA, market_hypotheses: { aliases: ['Ninja Detect'], model_numbers: ['TB301'] } });
    const page = (host, title) => ({ url: `https://www.${host}/p/1`, domain: `www.${host}`, title, text: '' });
    const two = [page('makerone.com', 'Ninja Detect TB301 Power Blender Duo Pro'), page('reviewtwo.com', 'Ninja Detect TB301 Power Blender Duo Pro')];
    const name = (rs) => assessMarketIdentity({ identity: only, results: rs }).aliases.find((a) => a.value === 'Ninja Detect');
    assert.equal(name(two.slice(0, 1)).relation, RELATION.UNVERIFIED, 'one site');
    assert.equal(name(two).relation, RELATION.EXACT, 'whole, beside the corroborated number, on two sites');
    const withSibling = name([...two, page('shopthree.co.il', 'Ninja Detect XK500 בלנדר')]);
    assert.equal(withSibling.relation, RELATION.FAMILY);
    assert.deepEqual(withSibling.also_used_for, ['XK500']);
    assert.equal(withSibling.sites_seen, 2, 'the positive evidence is still counted, and still does not make it exact');
  });
  test('V2-31f a number READ off the item is identity and needs no corroboration', () => {
    const read = normalizeIdentity({ ...M.NINJA, visible_text: ['NINJA', 'TB301'], model: { value: 'TB301', confidence: 0.97, evidence: 'LABEL_READ' }, market_hypotheses: { aliases: [], model_numbers: [] } });
    assert.deepEqual(assessMarketIdentity({ identity: read, results: [] }).exact_roots, ['TB301']);
  });
  test('V2-31g hypotheses are capped, deduplicated against what was read, and never reach the subject', () => {
    const many = normalizeIdentity({ ...M.NINJA, market_hypotheses: { aliases: ['Power Blender Duo Pro', 'a b', 'c d', 'e f', 'g h'], model_numbers: ['AA111', 'BB222', 'CC333', 'DD444'] } });
    assert.ok(many.market_hypotheses.aliases.length <= 3 && many.market_hypotheses.model_numbers.length <= 3);
    assert.ok(!many.market_hypotheses.aliases.includes('Power Blender Duo Pro'));
    const subject = subjectOf(normalizeIdentity(M.NINJA), 'product');
    assert.ok(!JSON.stringify(subject).includes('TB301'), 'the subject is what was read, not what was guessed');
  });
});

describe('V2-32 four queries, one search action, no second look', () => {
  test('V2-32a the plan is visible+used, visible+price, alias+used, alias+price', () => {
    const plan = planV2Search(normalizeIdentity(M.NINJA), 'product', IL);
    assert.deepEqual(plan.queries.map((q) => q.purpose), [V2_PURPOSE.SECOND_HAND, V2_PURPOSE.PRICE_CONTEXT, V2_PURPOSE.ALIAS_SECOND_HAND, V2_PURPOSE.ALIAS_PRICE]);
    assert.deepEqual(plan.queries.map((q) => q.text), [
      'Ninja Power Blender Duo Pro יד שנייה', 'Ninja Power Blender Duo Pro מחיר', 'Ninja TB301 יד שנייה', 'Ninja TB301 מחיר',
    ]);
    assert.deepEqual(plan.queries.map((q) => q.hypothesis ?? null), [null, null, 'TB301', 'TB301'], 'a guess is marked as a guess');
  });
  test('V2-32b no identity plans more than four queries', () => {
    assert.equal(MAX_V2_QUERIES, 4);
    for (const raw of [M.NINJA, M.NINJA_UNVERIFIED, M.IPHONE, M.PERFUME, M.JORDAN, M.CONSOLE, RAW.PS5, RAW.SOFA, RAW.ZARA, RAW.LOGITECH, RAW.NINJA]) {
      const identity = normalizeIdentity(raw);
      for (const level of ['product', 'candidates', 'brand_class', 'generic']) {
        assert.ok(planV2Search(identity, level, IL).queries.length <= MAX_V2_QUERIES);
      }
    }
  });
  test('V2-32c a provider that starts a SECOND search action is stopped there, and its results are never read', async () => {
    const fetchImpl = mockV2Provider({ results: RESULTS_PS5_VERIFIED, secondSearch: M.RESULTS_ONE_LISTING });
    const plan = planV2Search(normalizeIdentity(RAW.PS5), 'product', IL);
    const r = await runV2Search({ plan, market: IL, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    assert.equal(r.outcome, SEARCH_OUTCOME.COMPLETED);
    assert.equal(r.stopped_early, true);
    assert.equal(fetchImpl.calls[0].aborted, true);
    assert.equal(r.provenance.search_call_count, 1);
    assert.equal(r.provenance.results.length, RESULTS_PS5_VERIFIED.length);
    assert.ok(!r.provenance.results.some((x) => x.url.includes('/ad/41')), 'nothing from the second action');
    assert.equal(describeSearch(plan, r).search_actions, 1);
    assert.equal(fetchImpl.calls.length, 1);
  });
  test('V2-32d a search that finds nothing is answered honestly with ONE request: no fallback search, no page opened', async () => {
    const fetchImpl = mockV2Provider({ identities: [M.NINJA], results: [] });
    const first = await runV2Identify({ image: IMG, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    const priced = await runV2Price({ state: { identity: first.identity, sufficiency: first.sufficiency, followups_used: first.followups_used }, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    assert.deepEqual(fetchImpl.calls.map((c) => c.kind), ['identity', 'search']);
    assert.equal(priced.valuation.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    const body = fetchImpl.calls[1].body;
    assert.deepEqual(body.tools.map((t) => t.type), ['web_search'], 'the only tool is the search');
    assert.equal(body.input[0].content[0].text.split('\n').filter((l) => /^\d+\. /.test(l)).length, 4);
  });
  test('V2-32e the diagnostics carry the plan, what ran, the action count, and the aliases with their evidence', async () => {
    const fetchImpl = mockV2Provider({ identities: [M.NINJA], results: M.RESULTS_VERIFIED_ALIAS });
    const first = await runV2Identify({ image: IMG, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    const priced = await runV2Price({ state: { identity: first.identity, sufficiency: first.sufficiency, followups_used: 0 }, model: 'm', apiKey: 'sk-test-not-a-real-key', fetchImpl });
    const search = describeSearch(priced.plan, priced.search);
    assert.equal(search.planned_queries.length, 4);
    assert.equal(search.executed_queries.length, 4);
    assert.equal(search.search_actions, 1);
    assert.equal(search.results, M.RESULTS_VERIFIED_ALIAS.length);
    assert.equal(typeof search.timings.results_available_ms, 'number');
    const market = describeEvidence(priced.evidence).market_identity;
    assert.deepEqual(market.proposed, { aliases: ['Ninja Detect Duo', 'Ninja Detect'], model_numbers: ['TB301', 'TB300'] });
    assert.deepEqual(market.corroborated, ['TB301']);
    assert.deepEqual(market.aliases.find((a) => a.value === 'TB301').evidence.sort(), ['makerone.com', 'reviewtwo.com']);
  });
});

describe('V2-33 result-level binding is for one product’s own page, and nowhere else', () => {
  const market = MATRIX.find((m) => m.name === 'I retail only').evidence.market;
  const page = (url, title, snippet, kind = 'search') => extractListings(
    [{ url, domain: new URL(url).hostname, title, text: `citeturn0${kind}0 [wordlim: 200] Crawled: today; ${snippet}` }], { market });
  const FAR = `${'מפרט טכני מלא של המוצר. '.repeat(14)} מחיר: 599 ₪`;

  test('V2-33a a shop page whose title names the product binds a price hundreds of characters away', () => {
    const { pages, entries } = page('https://www.shopone.co.il/p/1', 'Ninja Power Blender Duo Pro | שופ וואן', FAR);
    assert.equal(pages[0].page_type, PAGE.SINGLE_PRODUCT);
    assert.equal(pages[0].result_level, true);
    assert.deepEqual(entries.map((e) => [e.observation.observed_price, e.binding, e.kind]), [[599, BINDING.RESULT_TITLE, 'new_retail']]);
  });
  test('V2-33b a category page, a search page, a forum, a review and a multi-product page get strict binding only', () => {
    const title = 'Ninja Power Blender Duo Pro | שופ וואן';
    for (const [why, url, t, kind, type] of [
      ['category address', 'https://www.shopone.co.il/c/blenders', title, 'search', PAGE.CATEGORY],
      ['search address', 'https://www.shopone.co.il/search?q=ninja', title, 'search', PAGE.CATEGORY],
      ['forum index', 'https://www.forumone.com/r/blenders/comments/1', title, 'reddit', PAGE.FORUM],
      ['review index', 'https://www.newsone.com/ninja-review', title, 'news', PAGE.REVIEW],
      ['several models', 'https://www.shopone.co.il/p/1', `${title} TB301 TB303`, 'search', PAGE.CATEGORY],
    ]) {
      const { pages, entries } = page(url, t, FAR, kind);
      assert.equal(pages[0].page_type, type, why);
      assert.equal(pages[0].result_level, false, why);
      assert.ok(!entries.some((e) => e.binding === BINDING.RESULT_TITLE), why);
    }
  });
  test('V2-33c a second-hand board is never result-level, and result-level never yields a used listing', () => {
    const board = page('https://www.boardone.co.il/ad/1', 'Ninja Power Blender Duo Pro למכירה | לוח יד שניה', FAR);
    assert.equal(board.pages[0].result_level, false);
    for (const m of MATRIX) {
      assert.ok(m.evidence.entries.filter((e) => e.binding === BINDING.RESULT_TITLE).every((e) => e.kind === 'new_retail' && !e.admissible && !e.admitted), m.name);
    }
  });
  test('V2-33d two different product prices on one product page are refused, not chosen between', () => {
    const { entries, refused } = page('https://www.shopone.co.il/p/1', 'Ninja Power Blender Duo Pro | שופ וואן', 'מחיר: 599 ₪ ... מחיר מבצע: 549 ₪');
    assert.equal(entries.length, 0);
    assert.deepEqual(refused.map((r) => [r.value, r.reason]), [[599, REFUSED.SEVERAL_ON_PAGE], [549, REFUSED.SEVERAL_ON_PAGE]]);
  });
  test('V2-33e K · a category page: the row that names the product is a row-bound anchor; bare prices beside no name are not', () => {
    const { evidence, price } = MATRIX.find((m) => m.name === 'K category page');
    assert.ok(evidence.pages.every((p) => p.page_type === PAGE.CATEGORY && !p.result_level));
    const ours = evidence.entries.find((e) => e.observation.observed_price === 599);
    assert.deepEqual([ours.kind, ours.relation, ours.binding, ours.row_bound, ours.retail_anchor, ours.admissible],
      ['new_retail', RELATION.EXACT, BINDING.SENTENCE, true, true, false]);
    // The other products' prices on the same page are other products' prices.
    assert.ok(evidence.entries.filter((e) => e !== ours).every((e) => !e.retail_anchor));
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.SINGLE_SOURCE);
    assert.equal(price.retail_anchor.prices[0].binding, 'category_row');
    assert.equal(evidence.counts.admitted, 0);
    assert.ok(evidence.refused.some((r) => r.value === 569 && r.reason === REFUSED.NAKED_PRICE));
  });
});

describe('V2-34 a number has a role before it has a meaning', () => {
  const roles = (text) => classifyNumbers(text).map((n) => [n.value, n.role]);
  test('V2-34a each label gives its number a role, in either language', () => {
    for (const [text, expected] of [
      ['משלוח אקספרס בעלות של ₪55', [[55, ROLE.DELIVERY_FEE]]],
      ['Express delivery $12', [[12, ROLE.DELIVERY_FEE]]],
      ['מחיר כולל משלוח לנקודת איסוף: 608 ₪', [[608, ROLE.PRODUCT_PRICE_WITH_DELIVERY]]],
      ['12 תשלומים של 51 ₪ לחודש', [[51, ROLE.INSTALLMENT]]],
      ['$15 per month', [[15, ROLE.INSTALLMENT]]],
      ['הנחה של 100 ₪', [[100, ROLE.DISCOUNT]]],
      ['מחיר 790₪ במקום 1390₪', [[790, ROLE.PRODUCT_PRICE], [1390, ROLE.OLD_PRICE]]],
      ['was $249 now $199', [[249, ROLE.OLD_PRICE], [199, ROLE.PRODUCT_PRICE]]],
      ['בנוסף כוס נשיאה ב-49 ₪', [[49, ROLE.ACCESSORY_PRICE]]],
      ['מחיר: 599 ₪ משלוח חינם', [[599, ROLE.PRODUCT_PRICE]]],
      ['₪2,299', [[2299, ROLE.UNKNOWN]]],
    ]) assert.deepEqual(roles(text), expected, text);
  });
  test('V2-34b L · one product page: the price is kept, and seven other amounts are each refused by name', () => {
    const { evidence, price } = MATRIX.find((m) => m.name === 'L price and fees');
    assert.deepEqual(evidence.refused.map((r) => [r.value, r.role]).sort((a, b) => a[0] - b[0]), [
      [9, ROLE.DELIVERY_FEE], [29, ROLE.DELIVERY_FEE], [49, ROLE.ACCESSORY_PRICE], [51, ROLE.INSTALLMENT],
      [55, ROLE.DELIVERY_FEE], [100, ROLE.DISCOUNT], [799, ROLE.OLD_PRICE],
    ]);
    assert.deepEqual(prices(evidence.entries), [599]);
    assert.deepEqual(price.retail_anchor.prices.map((p) => [p.price, p.stated_price, p.delivery_fee]), [[599, 608, 9]]);
  });
  test('V2-34c the delivery is subtracted only when the page names that delivery and states its fee once', () => {
    const market = MATRIX.find((m) => m.name === 'I retail only').evidence.market;
    const one = (snippet) => extractListings([{ url: 'https://www.shopone.co.il/p/1', domain: 'www.shopone.co.il', title: 'Ninja Power Blender Duo Pro | שופ וואן', text: snippet }], { market }).entries[0];
    // The named option has no stated fee: the amount stays as stated, flagged as including delivery.
    const unnamed = one('משלוח אקספרס בעלות של ₪55 ... מחיר כולל משלוח לנקודת איסוף: 608 ₪');
    assert.deepEqual([unnamed.observation.observed_price, unnamed.delivery_fee, unnamed.includes_delivery], [608, null, true]);
    // Two different fees for the same option: which one is unknown, so neither.
    const ambiguous = one('משלוח לנקודת איסוף בעלות של ₪9 ... משלוח לנקודת איסוף בעלות של ₪15 ... מחיר כולל משלוח לנקודת איסוף: 608 ₪');
    assert.deepEqual([ambiguous.observation.observed_price, ambiguous.delivery_fee], [608, null]);
    // An unrelated number on the page is never subtracted.
    const unrelated = one('12 תשלומים של 51 ₪ לחודש ... מחיר כולל משלוח: 608 ₪');
    assert.deepEqual([unrelated.observation.observed_price, unrelated.delivery_fee], [608, null]);
  });
  test('V2-34e the ₪608 → ₪599 rule is strict: one product result, the total AND one unambiguous fee for the delivery it names', () => {
    const market = MATRIX.find((m) => m.name === 'I retail only').evidence.market;
    const extract = (results) => extractListings(results.map((r) => ({ domain: new URL(r.url).hostname, ...r })), { market });
    const TITLE = 'Ninja Power Blender Duo Pro | שופ וואן';
    const TOTAL = 'מחיר כולל משלוח לנקודת איסוף: 608 ₪';
    const FEE = 'משלוח לנקודת איסוף בעלות של ₪9';
    const first = (results) => extract(results).entries.find((e) => e.stated_price === 608);
    const unsubtracted = (why, results) => {
      const e = first(results);
      assert.ok(e, why);
      assert.deepEqual([e.observation.observed_price, e.delivery_fee, e.includes_delivery], [608, null, true], why);
      assert.ok(!extract(results).entries.some((x) => x.observation.observed_price === 599), why);
    };
    // The explicit case: subtracted, and the page says which delivery and which fee.
    const ok = first([{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `${FEE} ... ${TOTAL}` }]);
    assert.deepEqual([ok.observation.observed_price, ok.delivery_fee, ok.includes_delivery, ok.delivery_option], [599, 9, false, 'לנקודת איסוף']);
    // The same fee printed twice is one fee.
    assert.equal(first([{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `${FEE} ... ${FEE} ... ${TOTAL}` }]).observation.observed_price, 599);
    // Several products on the page.
    unsubtracted('several models', [{ url: 'https://www.shopone.co.il/p/1', title: `${TITLE} TB301 TB303`, text: `${FEE} ... ${TOTAL}` }]);
    // A category page.
    unsubtracted('category address', [{ url: 'https://www.shopone.co.il/c/blenders', title: TITLE, text: `${FEE} ... ${TOTAL}` }]);
    // The fee is stated in ANOTHER result of the same shop: not the same product result.
    unsubtracted('fee on another page', [
      { url: 'https://www.shopone.co.il/p/1', title: TITLE, text: TOTAL },
      { url: 'https://www.shopone.co.il/delivery', title: 'משלוחים | שופ וואן', text: FEE },
    ]);
    // Two different fees for the named option; a fee for a different option; no option named; a fee not below the total.
    unsubtracted('two fees', [{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `${FEE} ... משלוח לנקודת איסוף בעלות של ₪15 ... ${TOTAL}` }]);
    unsubtracted('another option’s fee', [{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `משלוח אקספרס בעלות של ₪55 ... ${TOTAL}` }]);
    unsubtracted('no option named', [{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `${FEE} ... מחיר כולל משלוח: 608 ₪` }]);
    unsubtracted('fee not below the total', [{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `משלוח לנקודת איסוף בעלות של ₪608 ... ${TOTAL}` }]);
    // A fee in another currency is not this total's fee.
    unsubtracted('foreign fee', [{ url: 'https://www.shopone.co.il/p/1', title: TITLE, text: `משלוח לנקודת איסוף בעלות של $9 ... ${TOTAL}` }]);
  });
  test('V2-34f INVARIANT a subtracted delivery fee is explicit, on one product’s own page, and the arithmetic is shown', () => {
    const subtracted = [];
    for (const m of MATRIX) {
      for (const e of m.evidence.entries) {
        if (e.delivery_fee !== null) {
          subtracted.push(e);
          assert.deepEqual([e.role, e.binding, e.page_type, e.includes_delivery], [ROLE.PRODUCT_PRICE_WITH_DELIVERY, BINDING.RESULT_TITLE, PAGE.SINGLE_PRODUCT, false], m.name);
          assert.equal(e.stated_price - e.delivery_fee, e.observation.observed_price, m.name);
          assert.ok(typeof e.delivery_option === 'string' && e.delivery_option.length > 0, m.name);
          assert.ok(e.delivery_fee > 0 && e.delivery_fee < e.stated_price, m.name);
        } else {
          assert.equal(e.observation.observed_price, e.stated_price, `${m.name}: nothing is subtracted without a fee`);
          if (e.role === ROLE.PRODUCT_PRICE_WITH_DELIVERY) assert.equal(e.includes_delivery, true, m.name);
        }
      }
    }
    assert.ok(subtracted.length >= 2, 'the witness and L both exercise the rule');
  });
  test('V2-34d INVARIANT a fee, an instalment, a discount, an old price or an add-on is never an observation', () => {
    const notPrices = new Set([ROLE.DELIVERY_FEE, ROLE.INSTALLMENT, ROLE.DISCOUNT, ROLE.OLD_PRICE, ROLE.ACCESSORY_PRICE, ROLE.UNKNOWN]);
    for (const m of MATRIX) {
      assert.ok(m.evidence.entries.every((e) => !notPrices.has(e.role)), m.name);
      assert.ok(m.evidence.refused.every((r) => r.reason && r.url), `${m.name}: every refusal says why and where`);
    }
  });
});

describe('V2-35 every result ends in exactly one bucket', () => {
  test('V2-35a INVARIANT total = duplicates + no price data + price candidates, on every fixture', () => {
    for (const m of MATRIX) {
      const a = m.evidence.accounting;
      const b = a.buckets;
      assert.equal(a.reconciles, true, m.name);
      assert.equal(a.total, m.evidence.pages.length, m.name);
      assert.equal(b.DUPLICATE + b.NO_PRICE_DATA + b.REFUSED_AT_EXTRACTION + b.QUALIFIER_REJECTED + b.ADMITTED, a.total, m.name);
      assert.equal(a.price_candidates, b.REFUSED_AT_EXTRACTION + b.QUALIFIER_REJECTED + b.ADMITTED, m.name);
      assert.ok(m.evidence.pages.every((p) => Object.values(BUCKET).includes(p.bucket)), m.name);
      const classes = m.evidence.counts.by_class;
      assert.equal(Object.values(classes).reduce((x, y) => x + y, 0), m.evidence.entries.length, `${m.name}: every observation has one class`);
      assert.equal(Object.values(m.evidence.counts.by_relation).reduce((x, y) => x + y, 0), m.evidence.entries.length, `${m.name}: and one relation`);
      assert.ok(m.evidence.entries.every((e) => e.admitted || e.retail_anchor || e.reason), `${m.name}: nothing is rejected without a reason`);
    }
  });
  test('V2-35b the witness: 31 results = 6 duplicates + 20 without price data + 5 price candidates', () => {
    assert.deepEqual(MATRIX[0].evidence.accounting, {
      total: 31, buckets: { DUPLICATE: 6, NO_PRICE_DATA: 20, REFUSED_AT_EXTRACTION: 0, QUALIFIER_REJECTED: 3, ADMITTED: 2 },
      price_candidates: 5, reconciles: true,
    });
  });
  test('V2-35c INVARIANT the same page returned twice is one source: duplicates cannot add strength', () => {
    const twice = scan(M.NINJA, [...M.RESULTS_RETAIL_TWO_SHOPS.slice(0, 1), ...M.RESULTS_RETAIL_TWO_SHOPS.slice(0, 1)]);
    assert.equal(twice.evidence.accounting.buckets.DUPLICATE, 1);
    assert.equal(twice.price.retail_anchor.shops, 1);
    assert.equal(twice.price.retail_anchor.strength, ANCHOR_STRENGTH.SINGLE_SOURCE);
    // Three listings, each returned by two queries: still three listings, and still verified on their own.
    const doubled = scan(RAW.PS5, [...RESULTS_PS5_VERIFIED, ...RESULTS_PS5_VERIFIED]);
    assert.equal(doubled.evidence.counts.admitted, 3);
    assert.equal(doubled.price.basis.listings, 3);
    // One listing returned three times is one listing: never a quorum.
    const tripled = scan(M.CONSOLE, [...M.RESULTS_ONE_LISTING, ...M.RESULTS_ONE_LISTING, ...M.RESULTS_ONE_LISTING]);
    assert.equal(tripled.price.state, PRICE_STATE.USED_EVIDENCE_BELOW_QUORUM);
    assert.equal(tripled.price.basis.listings, 1);
  });
  test('V2-35d INVARIANT a foreign amount keeps its amount and its currency, and prices nothing', () => {
    const { evidence, price } = MATRIX.find((m) => m.name === 'foreign');
    assert.deepEqual(evidence.entries.map((e) => [e.observation.observed_price, e.observation.currency, e.evidence_class]), [
      [179.99, 'USD', EVIDENCE_CLASS.FOREIGN_RETAIL], [90, 'USD', EVIDENCE_CLASS.FOREIGN_USED],
    ]);
    assert.deepEqual(evidence.entries.map((e) => e.reason), ['foreign_currency_is_not_converted', 'foreign_currency_without_fx_proof']);
    assert.equal(price.state, PRICE_STATE.NO_PRICE_EVIDENCE);
    assert.equal(price.retail_anchor.strength, ANCHOR_STRENGTH.NONE);
    for (const m of MATRIX) {
      assert.ok(m.evidence.entries.filter((e) => e.admitted || e.retail_anchor).every((e) => e.observation.currency === 'ILS'), m.name);
    }
  });
});
