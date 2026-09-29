// ══════════════════════════════════════════════════════════════════════════════
// CONTENT BINDING — THE PROVIDER'S TEXT, NOT THE MODEL'S WORD
//
// A claim is CONTENT_BOUND when the text the provider returned for that page
// shows this identity beside this price in this currency. The hard case is the
// category page: one snippet, many listings, and every identity "co-occurs"
// with every price. These tests hold the rule that refuses to bind across
// listings, and the rule that a refusal costs only strength, never admission.
//
//   node --test tests/content-binding.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import {
  contentSupports, pricedNumbers, identityTokens, titleTokens, CONTENT, MAX_DISTANCE,
} from '../api/_lib/phaseb/content-binding.js';
import { extractSearchProvenance, bindObservations, BINDING } from '../api/_lib/phaseb/search-provenance.js';
import { createMarketResearch, MARKET_MECHANISM, SEARCH_INCLUDE } from '../api/_lib/phaseb/market-research.js';
import { runPhaseB, MARKET_OUTCOME } from '../api/_lib/phaseb/pipeline.js';
import { qualifyMarketEvidence, VERIFIED_MARKET_QUORUM, MIN_DISTINCT_SOURCES } from '../api/_lib/market-evidence.js';
import { NINJA, IMG } from './fixtures/phaseb/benchmarks.mjs';

const REPO = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolvePath(REPO, rel), 'utf8');

// Made-up products, so nothing here can be read as a rule about a real one.
const claim = (model, price, o = {}) => ({
  source: 'https://market.example/list', source_domain: 'market.example', listing_id_or_reference: null,
  title: `Acme ${model}`, observed_price: price, currency: 'ILS', listing_kind: 'used_listing',
  match: { brand: 'Acme', model, variant: null, confidence: 0.9 }, ...o,
});
const supports = (model, price, text, o) => contentSupports(claim(model, price, o), text);

// ════════════════════════════════════════════════════════════════════════════
// CB-1 · THE NEGATIVE THAT MATTERS
// ════════════════════════════════════════════════════════════════════════════
describe('CB-1 a category page cannot bind one product to another’s price', () => {
  const PAGE = 'Acme Falcon X200 good condition ₪500 Acme Heron Z900 like new ₪900';

  test('CB-1a Product A does not bind to Product B’s price', () => {
    const r = supports('Falcon X200', 900, PAGE);
    assert.equal(r.bound, false, 'both strings are in the snippet, and they are different listings');
    assert.equal(r.reason, CONTENT.PRICE_BETWEEN);
  });

  test('CB-1b Product B does not bind to Product A’s price', () => {
    assert.equal(supports('Heron Z900', 500, PAGE).bound, false);
  });

  test('CB-1c the unambiguous pairing still binds', () => {
    assert.deepEqual(supports('Falcon X200', 500, PAGE), { bound: true, reason: CONTENT.BOUND });
  });

  test('CB-1d an identity flanked by two different prices is refused, not guessed', () => {
    // Nothing lies between Heron and 900. But 500 sits on its other side, and
    // the text does not say which price is Heron's.
    const r = supports('Heron Z900', 900, PAGE);
    assert.equal(r.bound, false);
    assert.equal(r.reason, CONTENT.AMBIGUOUS);
    // Price-first layout: the same refusal, in the other direction.
    assert.equal(supports('Falcon X200', 500, '₪500 Acme Falcon X200 ₪900 Acme Heron Z900').bound, false);
  });

  test('CB-1e separated listings each bind to their own price, and only their own', () => {
    for (const sep of [' ... ', '\n', ' … ', '\n## next\n', ' | ', ' • ']) {
      const page = `Acme Falcon X200 good condition ₪500${sep}Acme Heron Z900 like new ₪900`;
      assert.equal(supports('Falcon X200', 500, page).bound, true, JSON.stringify(sep));
      assert.equal(supports('Heron Z900', 900, page).bound, true, JSON.stringify(sep));
      assert.equal(supports('Falcon X200', 900, page).bound, false, JSON.stringify(sep));
      assert.equal(supports('Heron Z900', 500, page).bound, false, JSON.stringify(sep));
    }
  });

  test('CB-1f the same holds for a long category page', () => {
    const products = ['Falcon X200', 'Heron Z900', 'Osprey Q10', 'Kestrel M5', 'Merlin T77'];
    const prices = [500, 900, 350, 1200, 640];
    const page = products.map((p, i) => `Acme ${p} used ₪${prices[i]}`).join(' ');
    for (let i = 0; i < products.length; i += 1) {
      for (let j = 0; j < prices.length; j += 1) {
        if (i !== j) assert.equal(supports(products[i], prices[j], page).bound, false, `${products[i]} / ${prices[j]}`);
      }
    }
  });

  test('CB-1g a "was / now" pair binds the asking price and not the old one', () => {
    const page = 'Acme Falcon X200 sealed in box. Price 790₪ instead of 1390₪, slightly flexible';
    assert.equal(supports('Falcon X200', 790, page).bound, true);
    assert.equal(supports('Falcon X200', 1390, page).bound, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CB-2 · PRICE AND CURRENCY ARE READ, NOT ASSUMED
// ════════════════════════════════════════════════════════════════════════════
describe('CB-2 the price must appear with its currency', () => {
  test('CB-2a every shekel spelling is found, before or after the number', () => {
    for (const t of ['₪500', '500₪', '500 ₪', '500 ש"ח', '500 ש״ח', '500 ILS', 'NIS 500', '1,500 ₪']) {
      const [p] = pricedNumbers(`Acme Falcon X200 ${t}`);
      assert.ok(p, t);
      assert.equal(p.currency, 'ILS', t);
    }
    assert.equal(pricedNumbers('1,500 ₪')[0].value, 1500);
  });

  test('CB-2b a bare number is not a price', () => {
    assert.deepEqual(pricedNumbers('Acme Falcon X200 500 1200W 2.1 litre 45 cm model 790'), []);
    assert.equal(supports('Falcon X200', 500, 'Acme Falcon X200 500').reason, CONTENT.PRICE_ABSENT);
  });

  test('CB-2c a number inside a longer number, or inside a word, is not that number', () => {
    for (const t of ['₪1500', '₪5000', '₪500.50', '₪2,500', 'X500₪']) {
      assert.equal(supports('Falcon X200', 500, `Acme Falcon X200 ${t}`).bound, false, t);
    }
  });

  test('CB-2d the currency in the text must be the currency claimed', () => {
    assert.equal(supports('Falcon X200', 500, 'Acme Falcon X200 $500').bound, false);
    assert.equal(supports('Falcon X200', 500, 'Acme Falcon X200 $500', { currency: 'USD' }).bound, true);
    assert.equal(supports('Falcon X200', 500, 'Acme Falcon X200 ₪500', { currency: '₪' }).bound, true,
      'a claim written with the sign is the same claim');
    assert.equal(supports('Falcon X200', 500, 'Acme Falcon X200 500 usdt').bound, false, 'usdt is not usd');
  });

  test('CB-2e a claim with no price, currency or identity cannot be content bound', () => {
    const text = 'Acme Falcon X200 ₪500';
    assert.equal(supports('Falcon X200', null, text).reason, CONTENT.NO_PRICE);
    assert.equal(supports('Falcon X200', 0, text).reason, CONTENT.NO_PRICE);
    assert.equal(supports('Falcon X200', 500, text, { currency: null }).reason, CONTENT.NO_CURRENCY);
    assert.equal(contentSupports({ observed_price: 500, currency: 'ILS', title: '', match: {} }, text).reason, CONTENT.NO_IDENTITY);
    for (const none of [null, undefined, '', '   ', 7, {}]) {
      assert.equal(supports('Falcon X200', 500, none).reason, CONTENT.NO_RESULT_TEXT);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CB-3 · IDENTITY
// ════════════════════════════════════════════════════════════════════════════
describe('CB-3 the identity must be this listing’s, and near its price', () => {
  test('CB-3a the brand alone identifies nothing', () => {
    assert.deepEqual(identityTokens(claim('Falcon X200', 1)), ['falcon', 'x200']);
    assert.equal(supports('Falcon X200', 500, 'Acme blender in good condition ₪500').bound, false);
  });

  test('CB-3b a two-word model needs both words', () => {
    assert.equal(supports('Falcon X200', 500, 'Acme Falcon series ₪500').bound, false);
    assert.equal(supports('Falcon X200', 500, 'Acme X200 Falcon ₪500').bound, true);
  });

  test('CB-3c a token inside another word is not that token', () => {
    assert.equal(supports('X200', 500, 'Acme MX2000 ₪500').bound, false);
    assert.equal(supports('X200', 500, 'Acme model X200, ₪500').bound, true);
  });

  test('CB-3d an identity far from the price is not beside it', () => {
    const far = `Acme Falcon X200 ${'word '.repeat(Math.ceil(MAX_DISTANCE / 5) + 4)}₪500`;
    assert.equal(supports('Falcon X200', 500, far).reason, CONTENT.TOO_FAR);
  });

  test('CB-3e with no model, the title’s own words are the identity', () => {
    const desk = { ...claim('', 300), title: 'oak writing desk', match: { brand: null, model: null, confidence: 0.8 } };
    assert.deepEqual(identityTokens(desk), [], 'no model, so the model witness is silent');
    assert.deepEqual(titleTokens(desk), ['oak', 'writing', 'desk']);
    assert.equal(contentSupports(desk, 'solid oak writing desk, light wear ₪300').bound, true);
    assert.equal(contentSupports(desk, 'solid oak desk, light wear ₪300').bound, false,
      'a word of the title is missing, and it may be the one that mattered');
    assert.equal(contentSupports(desk, 'metal chair ₪300').bound, false);
  });

  test('CB-3g a title in one script binds when the model is named in another', () => {
    // The real shape: the listing is titled in Hebrew, the model names the
    // product in Latin letters. The claim is bound by its own title.
    const o = {
      ...claim('Falcon X200', 1800), title: '\u05D0\u05E7\u05DE\u05D4 \u05E4\u05DC\u05E7\u05D5\u05DF \u05DC\u05DE\u05DB\u05D9\u05E8\u05D4 \u05D1\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD 1,800 \u05E9"\u05D7',
    };
    const text = '\u05D0\u05E7\u05DE\u05D4 \u05E4\u05DC\u05E7\u05D5\u05DF \u05DC\u05DE\u05DB\u05D9\u05E8\u05D4 \u05D1\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD 1,800 \u05E9"\u05D7 | consoles';
    assert.equal(contentSupports(o, text).bound, true);
    assert.equal(contentSupports({ ...o, observed_price: 2200 }, text).bound, false, 'the price must still be the price');
  });

  test('CB-3h two ordinary words of a title are not the title', () => {
    // Every listing on a category page shares "blender for sale". A claim
    // cannot borrow another listing\u2019s price on the strength of them.
    const a = { ...claim('', 900), title: 'Acme Falcon X200 blender for sale', match: { brand: 'Acme', model: null, confidence: 0.9 } };
    const page = 'Acme Falcon X200 blender for sale \u20AA500 ... Acme Heron Z900 blender for sale \u20AA900';
    assert.equal(contentSupports(a, page).bound, false);
    assert.equal(contentSupports({ ...a, observed_price: 500 }, page).bound, true);
  });

  test('CB-3f Hebrew text binds like any other', () => {
    const o = { ...claim('X200', 650), title: 'בלנדר X200' };
    assert.equal(contentSupports(o, 'בלנדר אקמה דגם X200 במצב מעולה, מחיר 650 ש"ח').bound, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CB-4 · THREE LEVELS, FROM THE PROVIDER'S RECORD
// ════════════════════════════════════════════════════════════════════════════
describe('CB-4 DOMAIN_BOUND, URL_BOUND, CONTENT_BOUND', () => {
  const output = (results) => [{
    type: 'web_search_call', status: 'completed',
    action: { type: 'search', query: 'q', sources: results.map((r) => ({ type: 'url', url: r.url })) },
    results: results.map((r) => ({ type: 'text_result', ...r })),
  }];
  const RESULTS = [
    { url: 'https://market.example/list', title: 'Blenders for sale', snippet: 'Acme Falcon X200 good condition ₪500 ... Acme Heron Z900 like new ₪900' },
    { url: 'https://other.example/item/7', title: 'Acme Osprey', snippet: 'Acme Osprey Q10, barely used. 350 ₪' },
    { url: 'https://third.example/x', title: null },
  ];

  test('CB-4a results are preserved exactly as returned, and nothing is filled in', () => {
    const p = extractSearchProvenance(output(RESULTS));
    assert.equal(p.results.length, 3);
    assert.deepEqual(p.results[0], {
      url: RESULTS[0].url, domain: 'market.example', title: 'Blenders for sale', text: RESULTS[0].snippet,
    });
    assert.deepEqual(p.results[2], { url: 'https://third.example/x', domain: 'third.example', title: null, text: null });
    assert.equal(p.source_details.find((s) => s.domain === 'other.example').title, 'Acme Osprey');
  });

  test('CB-4b results from a call that did not complete are not evidence', () => {
    const failed = output(RESULTS).map((c) => ({ ...c, status: 'failed' }));
    assert.deepEqual(extractSearchProvenance(failed).results, []);
  });

  test('CB-4c each observation reaches the strongest level its evidence supports', () => {
    const p = extractSearchProvenance(output(RESULTS));
    const r = bindObservations([
      claim('Falcon X200', 500),                                                         // content
      claim('Falcon X200', 900),                                                         // url: wrong price
      claim('Osprey Q10', 350, { source: 'https://other.example/item/7', source_domain: 'other.example' }), // content
      claim('Kestrel M5', 640, { source: 'https://third.example/x', source_domain: 'third.example' }),      // url: no text
      claim('Merlin T77', 200, { source: 'https://market.example/other-page', source_domain: 'market.example' }), // domain
      claim('Falcon X200', 500, { source: 'https://nowhere.example/a', source_domain: 'nowhere.example' }), // unbound
    ], p);
    assert.deepEqual(r.levels.map((l) => l.level),
      [BINDING.CONTENT, BINDING.URL, BINDING.CONTENT, BINDING.URL, BINDING.DOMAIN]);
    assert.deepEqual(r.bindings, { content: 2, url: 2, domain: 1 });
    // The two listings are separated, so Falcon is simply not in 900's segment.
    assert.equal(r.levels[1].content_reason, CONTENT.IDENTITY_ABSENT);
    assert.equal(r.levels[3].content_reason, CONTENT.NO_RESULT_TEXT);
    assert.equal(r.unbound.length, 1);
  });

  test('CB-4g the provider\u2019s TITLE is provider text: a price there binds', () => {
    // What a listing page actually returns: the price in the title, a
    // description with no price in the snippet.
    const p = extractSearchProvenance(output([
      { url: 'https://board.example/ad/1', title: 'Acme Falcon X200 for sale in Haifa 1,800 \u20AA | Consoles', snippet: 'Barely used, works perfectly, includes cable.' },
      { url: 'https://board.example/ad/2', title: 'Acme Heron Z900 for sale in Haifa 2,200 \u20AA | Consoles', snippet: 'Barely used.' },
    ]));
    const at = (model, price, n) => bindObservations([
      claim(model, price, { source: `https://board.example/ad/${n}`, source_domain: 'board.example', title: `Acme ${model} for sale in Haifa` }),
    ], p).levels[0].level;
    assert.equal(at('Falcon X200', 1800, 1), BINDING.CONTENT);
    assert.equal(at('Falcon X200', 2200, 1), BINDING.URL, 'that price is on a different page');
    assert.equal(at('Heron Z900', 1800, 1), BINDING.URL, 'that product is on a different page');
    // A title and its snippet are separate segments: a price in one does not
    // bind an identity that appears only in the other.
    const split = extractSearchProvenance(output([
      { url: 'https://board.example/ad/3', title: 'Consoles for sale 900 \u20AA', snippet: 'Acme Falcon X200 in good condition' },
    ]));
    assert.equal(bindObservations([
      claim('Falcon X200', 900, { source: 'https://board.example/ad/3', source_domain: 'board.example', title: 'Acme Falcon X200' }),
    ], split).levels[0].level, BINDING.URL);
  });

  test('CB-4d text for one page never supports a claim about another', () => {
    const p = extractSearchProvenance(output(RESULTS));
    const r = bindObservations([
      claim('Osprey Q10', 350, { source: 'https://market.example/list' }),
    ], p);
    assert.equal(r.levels[0].level, BINDING.URL, 'Osprey’s text belongs to a different URL');
  });

  test('CB-4e with no result text at all, the level is what it was before', () => {
    const p = extractSearchProvenance([{
      type: 'web_search_call', status: 'completed',
      action: { type: 'search', query: 'q', sources: [{ url: 'https://market.example/list' }] },
    }]);
    const r = bindObservations([claim('Falcon X200', 500)], p);
    assert.deepEqual(r.bindings, { content: 0, url: 1, domain: 0 });
  });

  test('CB-4f the request asks the provider for the result text', async () => {
    assert.ok(SEARCH_INCLUDE.includes('web_search_call.results'));
    let body = null;
    const adapter = createMarketResearch({
      mechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, model: 'm', apiKey: 'k',
      fetchImpl: async (_u, init) => {
        body = JSON.parse(init.body);
        const market = { observations: [claim('Falcon X200', 500)], identity_discovery: { claims: [] }, search_performed: true, notes: null };
        return new Response(JSON.stringify({
          output: [...output(RESULTS), { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(market) }] }],
        }), { status: 200 });
      },
    });
    const r = await adapter.search(NINJA.query);
    assert.deepEqual(body.include, ['web_search_call.action.sources', 'web_search_call.results']);
    assert.deepEqual(r.bindings, { content: 1, url: 0, domain: 0 });
    assert.equal(r.binding_levels[0].level, BINDING.CONTENT);
    assert.ok(!('binding' in r.observations[0]) && !('level' in r.observations[0]),
      'what reaches the evidence gates is the observation, unchanged');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CB-5 · STRENGTH, NOT PERMISSION
// ════════════════════════════════════════════════════════════════════════════
describe('CB-5 content binding changes no authority rule', () => {
  const listing = (domain, ref, price, model = 'Detect Power Blender Pro') => ({
    source: `https://${domain}/item/${ref}`, source_domain: domain, listing_id_or_reference: ref,
    title: `Ninja ${model}`, observed_price: price, currency: 'ILS', condition: 'used', location: null,
    observed_at: null, listing_kind: 'used_listing',
    match: { brand: 'Ninja', model, variant: null, confidence: 0.9 },
  });
  const pipeline = (observations, snippetFor) => {
    const market = { observations, identity_discovery: { claims: [] }, search_performed: true, notes: null };
    const fetchImpl = async (_u, init) => {
      const n = JSON.parse(init.body)?.text?.format?.name ?? '';
      const payload = n.includes('identity') ? NINJA.identity
        : n.includes('condition') ? NINJA.condition
          : n.includes('market_query') ? NINJA.query : market;
      const message = { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] };
      return new Response(JSON.stringify({
        output: n.includes('market_evidence') ? [{
          type: 'web_search_call', status: 'completed',
          action: { type: 'search', query: 'q', sources: observations.map((o) => ({ type: 'url', url: o.source })) },
          results: observations.map((o) => ({ type: 'text_result', url: o.source, title: o.title, snippet: snippetFor(o) })),
        }, message] : [message],
      }), { status: 200 });
    };
    return runPhaseB({
      images: [IMG], existingRecognition: NINJA.recognition, ocrText: NINJA.ocr, apiKey: 'k', model: 'm',
      marketMechanism: MARKET_MECHANISM.OPENAI_WEB_SEARCH, fetchImpl,
    });
  };
  const FOUR = [
    listing('yad2.co.il', 'a', 620), listing('facebook.com', 'b', 550),
    listing('agora.co.il', 'c', 700), listing('yad2.co.il', 'd', 800),
  ];
  const truthful = (o) => `${o.title}, used, ${o.observed_price} ₪`;

  test('CB-5a the quorum and the diversity floor are what they were', () => {
    assert.equal(VERIFIED_MARKET_QUORUM, 3);
    assert.equal(MIN_DISTINCT_SOURCES, 2);
  });

  test('CB-5b content-bound evidence qualifies by the same rules as before', async () => {
    const r = await pipeline(FOUR, truthful);
    assert.equal(r.market_evidence.diagnostics.OBSERVATIONS_CONTENT_BOUND, 4);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.VERIFIED_MARKET);
    assert.equal(r.validation.market_evidence.admitted, 4);
  });

  test('CB-5c content binding cannot rescue a listing the gate refuses', async () => {
    // Every claim is perfectly supported by the provider’s text. Every one is
    // for a different model. Strong provenance about the wrong product.
    const wrong = FOUR.map((o) => listing(o.source_domain, o.listing_id_or_reference, o.observed_price, 'Nutri Slim 300'));
    const r = await pipeline(wrong, truthful);
    assert.equal(r.market_evidence.diagnostics.OBSERVATIONS_CONTENT_BOUND, 4);
    assert.equal(r.validation.market_evidence.admitted, 0);
    assert.equal(r.market_evidence.outcome, MARKET_OUTCOME.INSUFFICIENT_MARKET_EVIDENCE);
    // And two content-bound listings are still two listings.
    const two = await pipeline(FOUR.slice(0, 2), truthful);
    assert.equal(two.market_evidence.diagnostics.OBSERVATIONS_CONTENT_BOUND, 2);
    assert.equal(two.valuation_candidate.status, 'PENDING_MARKET');
  });

  test('CB-5d failing content binding costs strength only: the threshold is unchanged', async () => {
    const r = await pipeline(FOUR, () => 'A page about blenders in general.');
    const d = r.market_evidence.diagnostics;
    assert.equal(d.OBSERVATIONS_CONTENT_BOUND, 0);
    assert.equal(d.OBSERVATIONS_URL_BOUND, 4);
    assert.equal(r.validation.market_evidence.admitted, 4, 'the minting rule was not changed in this pass');
    assert.deepEqual(r.market_evidence.binding_levels.map((l) => l.level), ['url', 'url', 'url', 'url']);
  });

  test('CB-5e the three levels always sum to what was bound', async () => {
    const r = await pipeline(FOUR, (o) => (o.observed_price > 600 ? truthful(o) : 'nothing relevant'));
    const d = r.market_evidence.diagnostics;
    assert.equal(d.OBSERVATIONS_DOMAIN_BOUND + d.OBSERVATIONS_URL_BOUND + d.OBSERVATIONS_CONTENT_BOUND,
      d.OBSERVATIONS_PROVENANCE_BOUND);
    assert.equal(d.OBSERVATIONS_CONTENT_BOUND, 3);
  });

  test('CB-5f the evidence engine does not know binding levels exist', () => {
    const gate = read('api/_lib/market-evidence.js');
    assert.ok(!/content_bound|binding_levels|content-binding|CONTENT_BOUND/.test(gate));
    const src = read('api/_lib/phaseb/pipeline.js');
    const at = src.indexOf('qualifyMarketEvidence({');
    assert.ok(!/binding/.test(src.slice(at, src.indexOf('});', at))));
    // Direct: the gate gives the same answer whatever level a listing reached.
    const q = qualifyMarketEvidence({ observations: FOUR, subject: NINJA.identity.subject });
    assert.equal(q.qualified, true);
  });

  test('CB-5g the reader gets the head of each result, not a copy of the web', async () => {
    const r = await pipeline(FOUR, (o) => `${truthful(o)} ${'x'.repeat(3000)}`);
    for (const res of r.market_evidence.provenance.results) {
      assert.ok(res.text.length <= 240);
      assert.ok(res.text_chars > 240);
    }
  });
});
