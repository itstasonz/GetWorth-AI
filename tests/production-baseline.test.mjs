// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION BASELINE VERIFICATION — the baseline is READ off Production
//
// What Production runs is a fact to be read, not remembered. The build writes
// its commit into the bundle; the script reads it back and asks git about it.
// These suites drive the script's parts on fixtures: no network, no deploy.
//
//   PB-1  the commit literal and the module scripts a page loads
//   PB-2  reading a deployment: page, then scripts, never a guess
//   PB-3  the verdict, and git asked rather than trusted
//
//   node --test tests/production-baseline.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { findBuildSha, moduleScripts, compareBaseline, readDeployedSha, describeCommit, DEFAULT_URL } from '../scripts/verify-production-baseline.mjs';

// The shape the real build has (dist/assets/index-*.js, 2026-10-11): the define kept in a variable, in backticks, far from its use.
const BUNDLE = 'var Lr=`2026-10-11 15:33Z`,Rr=`40d0b2c`,zr=j.lazy(()=>1);function q(){console.log(`%cGetWorth ${Lr} (${Rr})`,`color:#6FEEE1`),window.__GW_VERSION__=Lr,window.__GW_SHA__=Rr}';
const HTML = '<!doctype html><html><head><link rel="modulepreload" href="/assets/vendor-abc.js"><script type="module" crossorigin src="/assets/index-def.js"></script></head><body></body></html>';

describe('PB-1 the commit literal and the scripts', () => {
  test('PB-1a the literal is read from the minified bundle — through the variable the minifier keeps it in, or directly, in any quotes; null when absent or malformed', () => {
    assert.equal(findBuildSha(BUNDLE), '40d0b2c');
    assert.equal(findBuildSha('var $a=`913c8a6`;window.__GW_SHA__=$a'), '913c8a6', 'a name with a dollar sign');
    assert.equal(findBuildSha('var xRr=`1111111`,Rr=`40d0b2c`;window.__GW_SHA__=Rr'), '40d0b2c', 'the declaration of THAT name, not of a name that ends the same way');
    assert.equal(findBuildSha("window.__GW_SHA__='913c8a6'"), '913c8a6');
    assert.equal(findBuildSha('window.__GW_SHA__="local"'), 'local');
    assert.equal(findBuildSha('window.__GW_SHA__="ZZZ"'), null);
    assert.equal(findBuildSha('window.__GW_SHA__=Rr;var Rr=f()'), null, 'a reference without a literal is not a reading');
    assert.equal(findBuildSha('nothing here'), null);
    assert.equal(findBuildSha(null), null);
  });
  test('PB-1b module scripts are resolved against the site, scripts before preloads, without duplicates', () => {
    assert.deepEqual(moduleScripts(HTML, DEFAULT_URL), [`${DEFAULT_URL}/assets/index-def.js`, `${DEFAULT_URL}/assets/vendor-abc.js`]);
    assert.deepEqual(moduleScripts('<script src="/a.js" type="module"></script><script type="module" src="/a.js"></script>', 'https://x.test'), ['https://x.test/a.js']);
    assert.deepEqual(moduleScripts('', DEFAULT_URL), []);
  });
});

describe('PB-2 reading a deployment', () => {
  const site = (pages) => async (url) => { const body = pages[url]; return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body }; };
  test('PB-2a the page, then its scripts, until the literal is found; the source is named', async () => {
    const fetchImpl = site({ [`${DEFAULT_URL}/`]: HTML, [`${DEFAULT_URL}/assets/index-def.js`]: 'var a=2;', [`${DEFAULT_URL}/assets/vendor-abc.js`]: BUNDLE });
    const r = await readDeployedSha({ fetchImpl });
    assert.deepEqual([r.sha, r.source, r.page_status], ['40d0b2c', `${DEFAULT_URL}/assets/vendor-abc.js`, 200]);
  });
  test('PB-2b a page that cannot be read, or scripts without the literal, give null — never a guess', async () => {
    const dark = await readDeployedSha({ fetchImpl: site({}) });
    assert.deepEqual([dark.sha, dark.page_status], [null, 404]);
    const r = await readDeployedSha({ fetchImpl: site({ [`${DEFAULT_URL}/`]: HTML, [`${DEFAULT_URL}/assets/index-def.js`]: 'x', [`${DEFAULT_URL}/assets/vendor-abc.js`]: 'y' }) });
    assert.deepEqual([r.sha, r.scripts.length], [null, 2]);
  });
  test('PB-2c a protection-bypass header travels with every request when given, and is never part of the answer', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push(init.headers['x-vercel-protection-bypass']); return { ok: true, status: 200, text: async () => (url.endsWith('/') ? HTML : BUNDLE) }; };
    const r = await readDeployedSha({ fetchImpl, headers: { 'x-vercel-protection-bypass': 's3cret' } });
    assert.ok(seen.length >= 2 && seen.every((h) => h === 's3cret'));
    assert.ok(!JSON.stringify(r).includes('s3cret'));
  });
});

describe('PB-3 the verdict', () => {
  test('PB-3a matches by prefix either way, mismatches on a different commit, unknown without a reading', () => {
    assert.equal(compareBaseline('40d0b2c', '40d0b2c8954ce919625160fda0d7313e308a1436'), 'match');
    assert.equal(compareBaseline('40d0b2c8954ce919625160fda0d7313e308a1436', '40d0b2c'), 'match');
    assert.equal(compareBaseline('40d0b2c', null), 'match');
    assert.equal(compareBaseline('40d0b2c', '913c8a6'), 'mismatch');
    assert.equal(compareBaseline(null, '40d0b2c'), 'unknown');
  });
  test('PB-3b git is asked, not trusted: a commit this repository has is described; one it does not have is unknown', () => {
    const head = describeCommit('HEAD');
    assert.ok(head.known && head.full.length === 40 && head.on_branch === true && typeof head.subject === 'string');
    assert.equal(describeCommit('0000000').known, false);
  });
});
