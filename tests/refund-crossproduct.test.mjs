// ══════════════════════════════════════════════════════════════════════════════
// REFUND CROSS-PRODUCT — the test design that four rounds of patching lacked.
//
// WHY THIS EXISTS
// Rounds 3-6 each shipped a refund defect past a fully green suite. Round 6
// finally built a harness that drives the REAL handler and observes refunds as
// actual `decrement_user_daily_scan` RPCs — and STILL missed a defect, because
// the 17-case matrix enumerated billed-then-failing witnesses on one axis and
// engine paths on the other WITHOUT EVER CROSSING THEM. RL-16 walked the exact
// broken path but asserted on a successful scan, where refunds===0 holds
// trivially.
//
// So the unit of coverage here is not a case. It is a CROSS-PRODUCT:
//
//     ENGINE PATH  ×  BILLABLE SITE  ×  POST-BILLING FAILURE  ×  FALLBACK STATE
//
// Every combination that can exist is generated, not hand-listed. A new engine
// path cannot bypass the invariant, because adding one to ENGINE_PATHS
// multiplies it through every failure location automatically.
//
// THE INVARIANT
//   Once ANY provider attempt is known to be billable/consumed, that request's
//   cost state is monotonic. No engine switch, fallback, later provider
//   failure, parse failure, validation failure, internal exception or logging
//   failure may erase it.
//
// ORACLE: the real `decrement_user_daily_scan` RPC. Nothing else.
//
//   node --test tests/refund-crossproduct.test.mjs
// ══════════════════════════════════════════════════════════════════════════════
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { harness, IMG, VALID_RECOGNITION, anthropicText } from './helpers/analyze-harness.mjs';

let h;
const savedEnv = {};
before(async () => {
  for (const k of ['RECOGNITION_ENGINE', 'OPENAI_API_KEY']) savedEnv[k] = process.env[k];
  h = await harness();
});
after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  h?.restore();
});

// ── AXIS 1: POST-BILLING FAILURE LOCATION ───────────────────────────────────
// Each entry is an Anthropic 200 response — the provider HAS billed — shaped so
// the request then fails at a specific point in OUR code.
const FAILURE_POINTS = {
  'body-parse':        () => ({ status: 200, rawBody: '<html>not json</html>' }),
  'content-extract':   () => ({ status: 200, body: { content: 'not-an-array' } }),
  'contract/parse':    () => anthropicText('I am sorry, I cannot help with that.'),
  'truncation':        () => ({ status: 200, body: { content: [{ type: 'text', text: '{"a":' }], stop_reason: 'max_tokens' } }),
  'calibration':       () => anthropicText({ ...VALID_RECOGNITION, model_candidates: [{ model: 910006178, confidence: 0.9, evidence: 'ocr' }] }),
  'logging':           () => anthropicText({ ...VALID_RECOGNITION, ocr_text: { raw_texts: [{ toString: 1, valueOf: 2 }], logos_detected: [], has_readable_text: true } }),
  'normalization':     () => anthropicText({ ...VALID_RECOGNITION, brand_candidates: [{ brand: 3120, confidence: 0.9, evidence: 'ocr' }] }),
  'arbitrary-unknown': () => anthropicText({ ...VALID_RECOGNITION, category_confidence: { toString: 1, valueOf: 2 } }),
};

// ── AXIS 2: ENGINE PATH ─────────────────────────────────────────────────────
// `anthropicRole` says which Anthropic call carries the failing response:
//   'primary'  — the flag is off, Stage 1 calls Anthropic directly
//   'fallback' — the flag is on, OpenAI fails UNCONSUMED, Anthropic takes over
//   'post-openai-consumed' — OpenAI is BILLED then rejected; Anthropic follows
const ENGINE_PATHS = {
  'current-engine': {
    setup: () => { delete process.env.RECOGNITION_ENGINE; h.openai(() => { throw new Error('OpenAI must not be called'); }); },
    anthropicRole: 'primary',
  },
  'openai-unconsumed-fallback': {
    setup: () => {
      process.env.RECOGNITION_ENGINE = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test-key-1234567890';
      // A 500 is NOT a billed completion: the ledger must stay empty, so the
      // ONLY consumption evidence in this request comes from the Anthropic
      // fallback. That is precisely the path round 6 left unmarked.
      h.openai(() => ({ status: 500, body: { error: { message: 'server error' } } }));
    },
    anthropicRole: 'fallback',
  },
  'openai-consumed-then-fallback': {
    setup: () => {
      process.env.RECOGNITION_ENGINE = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test-key-1234567890';
      // 200 WITH usage tokens, rejected by our schema: billed, and monotonic
      // consumption must survive everything the fallback then does.
      h.openai(() => ({ status: 200, body: {
        output: [{ content: [{ type: 'output_text', text: 'NOT JSON' }] }],
        output_text: 'NOT JSON', usage: { input_tokens: 1200, output_tokens: 800 },
      } }));
    },
    anthropicRole: 'post-openai-consumed',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// THE CROSS-PRODUCT — generated, not enumerated
// ─────────────────────────────────────────────────────────────────────────────
for (const [engineName, engine] of Object.entries(ENGINE_PATHS)) {
  for (const [failName, failResponse] of Object.entries(FAILURE_POINTS)) {
    test(`XP [${engineName}] × [${failName}] — billed Anthropic, later failure ⇒ NO REFUND`, async () => {
      engine.setup();
      h.anthropic(failResponse);
      const r = await h.run({ imageData: IMG, lang: 'en' });

      assert.ok(r.providerCalls.anthropic > 0,
        'fixture: the Anthropic call must actually happen on this path');
      assert.equal(r.refunds, 0,
        `a BILLED ${engine.anthropicRole} Anthropic call must not be refunded by a later ` +
        `${failName} failure (status=${r.status}, rpc=${r.rpcLog.join(',')})`);
    });
  }
}

// ── AXIS 3: the serialOCR billable site, crossed with its own failure points ──
// NOT APPLICABLE to the engine axis: `serialOCR` returns before Stage 1 is
// reached (api/analyze.js, the early-exit block), so no engine path can alter
// it. Evidence: the early exit `return json({ ocrText, ... })` precedes
// `resolveRecognitionEngine()`.
for (const [failName, failResponse] of Object.entries({
  'body-parse': FAILURE_POINTS['body-parse'],
  'content-extract': FAILURE_POINTS['content-extract'],
})) {
  test(`XP [serialOCR] × [${failName}] — billed, later failure ⇒ NO REFUND`, async () => {
    delete process.env.RECOGNITION_ENGINE;
    h.anthropic(failResponse);
    const r = await h.run({ imageData: IMG, lang: 'en', serialOCR: true });
    assert.ok(r.providerCalls.anthropic > 0, 'fixture: serialOCR must call the provider');
    assert.equal(r.refunds, 0, `a BILLED serialOCR call must not be refunded by a later ${failName} failure`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER DIRECTION — unconsumed failures must STILL refund on every path
// ─────────────────────────────────────────────────────────────────────────────
const UNCONSUMED = {
  'network-throw': () => ({ throw: new TypeError('fetch failed') }),
  'http-401': () => ({ status: 401, body: { error: { message: 'auth' } } }),
  'http-429': () => ({ status: 429, body: { error: { message: 'rate' } } }),
  'http-503': () => ({ status: 503, body: { error: { message: 'overloaded' } } }),
};
for (const [engineName, engine] of Object.entries(ENGINE_PATHS)) {
  for (const [failName, failResponse] of Object.entries(UNCONSUMED)) {
    test(`XP [${engineName}] × [${failName}] — refund iff nothing was billed`, async () => {
      engine.setup();
      h.anthropic(failResponse);
      const r = await h.run({ imageData: IMG, lang: 'en' });
      if (engine.anthropicRole === 'post-openai-consumed') {
        // OpenAI already billed: monotonic consumption forbids a refund even
        // though the Anthropic failure is itself a named refundable class.
        assert.equal(r.refunds, 0,
          'prior OpenAI consumption must survive an unconsumed fallback failure');
      } else {
        assert.equal(r.refunds, 1,
          `nothing was billed on this path, so ${failName} must still refund`);
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLS — the matrix must be able to distinguish a healthy scan
// ─────────────────────────────────────────────────────────────────────────────
test('XP control — a healthy scan on every engine path refunds nothing and returns 200', async () => {
  for (const [name, engine] of Object.entries(ENGINE_PATHS)) {
    engine.setup();
    if (name === 'openai-consumed-then-fallback') {
      h.openai(() => ({ status: 200, body: {
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(VALID_RECOGNITION) }] }],
        output_text: JSON.stringify(VALID_RECOGNITION), usage: { input_tokens: 1200, output_tokens: 400 },
      } }));
    }
    h.anthropic(() => anthropicText(VALID_RECOGNITION));
    const r = await h.run({ imageData: IMG, lang: 'en' });
    assert.equal(r.refunds, 0, `${name}: a healthy scan refunds nothing`);
    assert.equal(r.status, 200, `${name}: a healthy scan returns 200, got ${r.status}`);
  }
});

test('XP control — a request rejected before any provider call refunds nothing', async () => {
  delete process.env.RECOGNITION_ENGINE;
  h.anthropic(() => anthropicText(VALID_RECOGNITION));
  const r = await h.run({ imageData: 'not-a-valid-image', lang: 'en' });
  assert.equal(r.providerCalls.anthropic, 0, 'no provider may be called');
  assert.equal(r.refunds, 0, 'nothing was billed, and nothing was charged for');
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURAL — every provider call site must have an EXPLICIT ledger relationship
//
// The round-6 defect was not a wrong idea; it was a caller that forgot an
// argument. Threading a callback means any call site can omit it and nothing
// notices. This derives the provider call sites FROM SOURCE and requires each
// to be either directly ledger-marked, or covered by the stated downstream
// invariant — so a newly added provider call cannot ship uncovered.
//
// ROUND 9 — AND THE ORDERING HALF OF IT WAS VACUOUS FOR TWO OF FIVE.
//
// Round 8 added an ordering check because membership in a set is not the
// property being claimed: `fallbackVision` is only "downstream of Stage 1" if it
// genuinely cannot run before Stage 1 marks the ledger. That check looked for
// `fn(` in the source and asserted every match sat after `await runStage1()`.
//
// For two of the five names it found NOTHING, and a `for` loop over an empty
// set passes. Measured at 89ea434:
//
//   fallbackVision          1 call site   ordering genuinely checked
//   generateQueryEmbedding  1 call site   ordering genuinely checked
//   verifyAndPrice          1 call site   ordering genuinely checked
//   generateEmbedding       0 call sites  VACUOUS — the function was dead
//   preQuoteFromAI          0 call sites  VACUOUS — invoked through a table
//
// Two different causes, one symptom. `generateEmbedding` had no caller at all
// (superseded in 83ed273; removed in round 9). `preQuoteFromAI` is reached as
// `PRE_SOURCES[1]` — the text `preQuoteFromAI(` never appears outside its own
// declaration, so a regex for it can only ever match zero times, no matter
// where the call actually sits.
//
// So the guard is rebuilt on two rules:
//   1. ZERO RESOLVED CALL SITES IS A FAILURE, never a pass. A provider helper
//      is either reachable — and then its ordering is checked — or it is
//      declared dead in DEAD_PROVIDERS, which is a claim someone has to write
//      down and a reviewer can read.
//   2. Reachability follows INDIRECTION. A reference to `fn` inside a
//      module-level dispatch table resolves to the invocation sites of whatever
//      reads that table, transitively.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { discoverModules } from './helpers/provider-scan.mjs';

const ANALYZE = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
const OPENAI_LIB = readFileSync(new URL('../api/_lib/openai-recognition.js', import.meta.url), 'utf8');

const PROVIDER_HOSTS = ['api.anthropic.com', 'api.openai.com', 'vision.googleapis.com', 'api.voyageai.com'];

// ── Source resolution helpers ───────────────────────────────────────────────

/**
 * `ANALYZE` with every comment and string literal blanked to spaces, LENGTH AND
 * NEWLINES PRESERVED so every index is still an index into the real file.
 *
 * Reachability is a question about CODE. A third of api/analyze.js is
 * commentary (1,897 of 5,651 non-blank lines), and those comments name the
 * functions they discuss — `verifyAndPrice` is mentioned in two of them, one of
 * which sits ~44,000 characters before Stage 1. Matching identifiers in raw
 * text reports that comment as a call site executing before the ledger is
 * marked: a false failure, only marginally better than the false pass it
 * replaced.
 *
 * Quote state is tracked BEFORE comment state on purpose — `'https://api.…'`
 * contains `//`, and a comment stripper that does not know it is inside a
 * string blanks the rest of that line as if it were prose.
 */
const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const CODE = (() => {
  const src = ANALYZE;
  const out = Array.from(src);
  const blank = (k) => { if (out[k] !== NL) out[k] = ' '; };
  const blankRange = (from, to) => { for (let k = from; k < to; k++) blank(k); };

  // A STACK, not a flag. The first version of this treated a template literal
  // as flat text ending at the next backtick — which is wrong the moment a
  // `${…}` interpolation contains a quote, a nested template, or a `}`.
  // api/analyze.js's prompt builders are full of exactly that, so the scanner
  // desynchronised inside buildRecognitionPrompt and stayed desynchronised:
  // it went on to read the apostrophe in the prose word "doesn't" as a string
  // opener and blanked 1,688 characters of real code after it. Measured
  // consequence: the declarations of `recognize`, `fallbackVision` and
  // `generateQueryEmbedding` were erased from the masked source. The ordering
  // results happened to survive, which is worse, not better — the guard was
  // right by luck.
  //
  // Two independent containments, because the runaway needed two mistakes:
  //   1. this stack, so a nested template or a `}` inside `${…}` cannot end the
  //      outer literal early;
  //   2. a quoted string may not cross a newline, so even if the scanner does
  //      desynchronise, one stray apostrophe costs one line, not 1,688
  //      characters.
  // Either alone happens to contain the damage in THIS file; both are kept
  // because "happens to" is the reasoning that produced the bug. Regex literals
  // get the standard previous-significant-token heuristic for the same reason —
  // this file has regexes containing quotes, and reading one as a string opener
  // is the same runaway by a third route.
  const modes = [{ kind: 'code', depth: 0, interp: false }];
  let prev = '';                       // last significant code char, for regex detection
  let i = 0;

  while (i < src.length) {
    const m = modes[modes.length - 1];
    const c = src[i], d = src[i + 1];

    if (m.kind === 'template') {
      if (c === BACKSLASH) { blank(i); blank(i + 1); i += 2; continue; }
      if (c === '`') { modes.pop(); blank(i); i++; continue; }
      if (c === '$' && d === '{') { blank(i); blank(i + 1); modes.push({ kind: 'code', depth: 0, interp: true }); i += 2; continue; }
      blank(i); i++; continue;
    }

    // code
    if (c === '/' && d === '/') { const j = src.indexOf(NL, i); const end = j === -1 ? src.length : j; blankRange(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const end = j === -1 ? src.length : j + 2; blankRange(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== NL) {   // an unterminated quote cannot cross a line
        if (src[j] === BACKSLASH) { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      blankRange(i, Math.min(j + 1, src.length));
      prev = 'x'; i = j + 1; continue;
    }
    if (c === '`') { modes.push({ kind: 'template' }); blank(i); i++; continue; }
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev)) {
      // Regex literal. Scan to the closing '/', honouring escapes and classes.
      let j = i + 1, inClass = false;
      while (j < src.length && src[j] !== NL) {
        if (src[j] === BACKSLASH) { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      blankRange(i, Math.min(j + 1, src.length));
      prev = 'x'; i = j + 1; continue;
    }
    if (c === '{') { m.depth++; prev = c; i++; continue; }
    if (c === '}') {
      if (m.depth > 0) { m.depth--; prev = c; i++; continue; }
      if (m.interp) { modes.pop(); blank(i); i++; continue; }  // end of ${…}
      prev = c; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
})();

/** The top-level `function NAME` / `const NAME` binding that encloses `index`. */
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/gm;
function enclosingSymbol(index) {
  let name = null;
  for (const m of CODE.matchAll(TOP_LEVEL_DECL)) {
    if (m.index > index) break;
    name = m[1];
  }
  return name;
}

/** Invocation sites of `name`, excluding its own declaration. */
function directCalls(name) {
  const re = new RegExp(String.raw`(?<![\w.])${name}\s*\(`, 'g');
  const out = [];
  for (const m of CODE.matchAll(re)) {
    const before = CODE.slice(Math.max(0, m.index - 40), m.index);
    if (/(?:export\s+)?(?:async\s+)?function\s+$/.test(before)) continue; // the declaration
    out.push(m.index);
  }
  return out;
}

/** Bare (non-calling, non-declaring) mentions of `name` — table entries, iteration. */
function bareReferences(name) {
  const re = new RegExp(String.raw`(?<![\w.])${name}(?![\w(])`, 'g');
  const out = [];
  for (const m of CODE.matchAll(re)) {
    const before = CODE.slice(Math.max(0, m.index - 40), m.index);
    if (/(?:export\s+)?(?:const|let|var)\s+$/.test(before)) continue;    // the declaration
    if (/(?:export\s+)?(?:async\s+)?function\s+$/.test(before)) continue;
    out.push(m.index);
  }
  return out;
}

/**
 * Every source index at which `name` can actually begin executing, following
 * indirection through dispatch tables and wrapper functions.
 *
 * `preQuoteFromAI` is the case this exists for:
 *   preQuoteFromAI  →  referenced by  const PRE_SOURCES = [...]
 *   PRE_SOURCES     →  read inside    pricingRescueEngine()
 *   pricingRescueEngine  →  called at  handleRequest, after Stage 1
 *
 * Returns `{ sites, trail }` so a failure can name the path it followed rather
 * than just a number.
 *
 * LIMITS, stated rather than implied. It resolves through TOP-LEVEL bindings
 * only: a provider helper stashed in a local variable inside a closure, reached
 * through a computed property, or passed as an argument, is invisible to it.
 * That is not a silent hole in the vacuity rule — an unresolvable helper
 * resolves to ZERO sites and therefore FAILS — but it is a hole in the ordering
 * rule, which can only check the sites it can see. If a helper is ever reached
 * both before and after Stage 1 and only the later path is resolvable, this
 * passes. Widening the resolver is the fix; a comment is not.
 */
function reachableCallSites(name, seen = new Set()) {
  if (seen.has(name)) return { sites: [], trail: [] };
  seen.add(name);

  const sites = directCalls(name).map((index) => ({ index, via: [name] }));
  const trail = [];

  for (const ref of bareReferences(name)) {
    const owner = enclosingSymbol(ref);
    if (!owner || owner === name || seen.has(owner)) continue;
    trail.push(`${name} ← ${owner}`);
    const up = reachableCallSites(owner, seen);
    trail.push(...up.trail);
    for (const s of up.sites) sites.push({ index: s.index, via: [name, ...s.via] });
  }
  return { sites, trail };
}

// ── THE PROVIDER INVENTORY ──────────────────────────────────────────────────
// Exact, not a floor. `>= 7` was the old shape, and it accepts an eighth
// provider call appearing with no disposition at all. Every provider host in
// the source must appear here, and every entry here must still be in the source.
//
//   DIRECT     — the helper marks the ledger itself, at the provider's own 2xx.
//   DOWNSTREAM — the helper is reachable ONLY after Stage 1 marked the ledger,
//                and that claim is checked by ordering below.
//
// SEC-2 — THE SCAN NOW COVERS EVERY PRODUCTION MODULE, NOT ONE FILE.
//
// This list used to be derived from `api/analyze.js` alone, so the guarantee
// stated above — "a newly added provider call cannot ship uncovered" — was true
// of exactly one file. `api.openai.com` was already in PROVIDER_HOSTS and
// already live at api/_lib/openai-recognition.js, and appeared in NO inventory
// entry, because the scanner could not reach the only file containing it. It
// was invisible to every ordering and vacuity test here while those tests
// reported green.
//
// That matters more forward than backward: the right place for new provider
// code is a new `_lib` module, so the advice that keeps api/analyze.js from
// growing was exactly the advice that defeated this guard. `file` is part of a
// site's identity now, so a provider cannot hide by moving FILE.
//
// HIGH-2 — WHAT THIS SCAN DOES NOT DO, STATED RATHER THAN IMPLIED.
// It searches for the FOUR KNOWN HOSTS above, so its job is ledger attribution
// for providers already known. It is NOT provider discovery: a fifth vendor
// with a host nobody listed matches nothing here, and a host assembled at
// runtime matches nothing anywhere lexical. Those two are covered by
// tests/provider-discovery.test.mjs (static — finds unknown hosts across every
// executable extension, and REFUSES construction it cannot resolve) and by the
// harness's out-of-band unknown-host record (runtime). The earlier wording here
// claimed a completeness this file has never had.
const INVENTORY = [
  { file: 'api/analyze.js',                 fn: 'recognize',              host: 'api.anthropic.com',     ledger: 'DIRECT' },
  { file: 'api/analyze.js',                 fn: 'ocrSerialLabel',         host: 'api.anthropic.com',     ledger: 'DIRECT' },
  { file: 'api/analyze.js',                 fn: 'fallbackVision',         host: 'vision.googleapis.com', ledger: 'DOWNSTREAM' },
  { file: 'api/analyze.js',                 fn: 'generateQueryEmbedding', host: 'api.voyageai.com',      ledger: 'DOWNSTREAM' },
  { file: 'api/analyze.js',                 fn: 'verifyAndPrice',         host: 'api.anthropic.com',     ledger: 'DOWNSTREAM' },
  { file: 'api/analyze.js',                 fn: 'preQuoteFromAI',         host: 'api.anthropic.com',     ledger: 'DOWNSTREAM' },
  { file: 'api/_lib/openai-recognition.js', fn: 'recognizeWithOpenAI',    host: 'api.openai.com',        ledger: 'DIRECT' },
  // PHASE B — a THIRD ledger class, because §26 of the Phase-B order is
  // explicit: "Phase B must have its own accounting boundary. Do not silently
  // inherit Phase A refund semantics." This call is on /api/enrich, not on the
  // scan path, so neither DIRECT (marks onBilled into the scan's refund ledger)
  // nor DOWNSTREAM (unreachable before Stage 1 OF A SCAN) describes it — and
  // forcing it into either would make the refund matrix assert something false
  // about a request that has no refund semantics at all.
  //
  // Its billed attempts are recorded in the Phase-B call ledger
  // (createCallLedger in api/_lib/phaseb/openai-client.js), and XP-PHASEB below
  // PROVES the isolation rather than trusting this label.
  { file: 'api/_lib/phaseb/openai-client.js', fn: 'callStructured', host: 'api.openai.com', ledger: 'PHASE_B' },
];

// Provider helpers deliberately kept with NO reachable caller. Empty, and that
// is the point: `generateEmbedding` used to belong here in all but name, and
// nothing said so. Adding an entry is a written claim, reviewable on its own.
const DEAD_PROVIDERS = [];

const DIRECT = new Set(INVENTORY.filter((e) => e.ledger === 'DIRECT').map((e) => e.fn));
const DOWNSTREAM = new Set(INVENTORY.filter((e) => e.ledger === 'DOWNSTREAM').map((e) => e.fn));
const PHASE_B = new Set(INVENTORY.filter((e) => e.ledger === 'PHASE_B').map((e) => e.fn));

/**
 * Every production module under api/, DISCOVERED rather than listed.
 *
 * Discovery is the point: a provider added in a brand-new `_lib` module is
 * found the day it is written, with nobody remembering to extend this file.
 * Mutation scratch copies are excluded — a `__mutant__` beside the original
 * must not read as a second provider.
 */
// HIGH-2: discovery is SHARED with tests/provider-discovery.test.mjs so the two
// scanners cannot disagree about which files exist. The private copy this
// replaces read only `.js` and `.mjs`, so a provider in a `.cjs` or `.ts` module
// was absent from the ledger cross-product while every assertion here was green.
function productionModules() {
  return discoverModules(new URL('../api/', import.meta.url))
    .map((m) => ({ path: 'api/' + m.path, source: m.source }));
}

const MODULES = productionModules();

/**
 * Every provider host occurrence across ALL production modules.
 *
 * Two refinements the single-file version never needed, both discovered the
 * moment the scan reached api/_lib/openai-recognition.js:
 *
 *  1. COMMENTS ARE NOT CALL SITES. That file documents its own endpoint in a
 *     header comment, which the naive scan counted as a second provider.
 *  2. A HOST LITERAL IS OFTEN A MODULE-SCOPE CONSTANT. `OPENAI_RESPONSES_URL`
 *     sits at the top of the file with no enclosing function, so the backward
 *     search for `function NAME` ran off the start and reported `?`. The site
 *     that matters is the function that USES the constant, so resolve it.
 */
function providerSitesFromSource() {
  const found = [];
  for (const mod of MODULES) {
    const lines = mod.source.split(/\r?\n/);
    lines.forEach((l, i) => {
      const code = l.replace(/^\s*(\/\/|\*|\/\*).*$/, '');   // drop comment lines
      for (const host of PROVIDER_HOSTS) {
        if (!code.includes(host)) continue;

        let fn = null;
        for (let j = i; j >= 0 && j > i - 150; j--) {
          const m = /^(?:export )?(?:async )?function (\w+)/.exec(lines[j]);
          if (m) { fn = m[1]; break; }
        }

        // Module scope: attribute the constant to whoever calls with it.
        if (!fn) {
          const decl = /^(?:export\s+)?const\s+(\w+)\s*=/.exec(code);
          if (decl) {
            const consumer = new RegExp(String.raw`(?<![\w.])${decl[1]}(?![\w])`, 'g');
            for (const m of mod.source.matchAll(consumer)) {
              if (m.index <= mod.source.indexOf(code)) continue;   // the declaration itself
              const before = mod.source.slice(0, m.index);
              const owner = [...before.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)].pop();
              if (owner) { fn = owner[1]; break; }
            }
          }
        }
        found.push({ file: mod.path, line: i + 1, host, fn: fn || '(module scope)' });
      }
    });
  }
  return found;
}

test('XP-STRUCT the provider inventory matches the source exactly', () => {
  const found = providerSitesFromSource();
  const actual = found.map((s) => `${s.file}::${s.fn}@${s.host}`).sort();
  const declared = INVENTORY.map((e) => `${e.file}::${e.fn}@${e.host}`).sort();

  assert.deepEqual(actual, declared,
    'the set of provider call sites under api/ has changed. Every one needs an ' +
    'explicit ledger disposition — add it to INVENTORY as DIRECT (marks onBilled at ' +
    'res.ok) or DOWNSTREAM (provably unreachable before Stage 1).\n' +
    `  in source, not declared: ${actual.filter((a) => !declared.includes(a)).join(', ') || '(none)'}\n` +
    `  declared, not in source: ${declared.filter((d) => !actual.includes(d)).join(', ') || '(none)'}`);
});

test('XP-STRUCT every provider host in source is inside a ledger-covered helper', () => {
  const found = providerSitesFromSource();
  assert.equal(found.length, INVENTORY.length,
    `expected the known provider sites, found ${found.length}`);

  for (const site of found) {
    assert.ok(DIRECT.has(site.fn) || DOWNSTREAM.has(site.fn) || PHASE_B.has(site.fn),
      `provider call in ${site.fn}() at ${site.file}:${site.line} has NO ledger relationship — ` +
      'add onBilled marking at its res.ok, classify it as downstream-of-Stage-1, or — if it is '
      + 'not on the scan path at all — declare it PHASE_B and let XP-PHASEB prove the isolation');
  }
});

// ── XP-PHASEB · THE PHASE_B LABEL IS PROVED, NOT TRUSTED ───────────────────
test('XP-PHASEB a PHASE_B provider is genuinely unreachable from the scan path', () => {
  // A ledger class that merely says "not our problem" is how a provider ends up
  // with no accounting at all — the SEC-9 shape, where an inventory asserted
  // coverage nothing delivered. So the claim is checked the same way DOWNSTREAM's
  // ordering claim is: by walking api/analyze.js and finding NOTHING.
  //
  // §26 requires Phase B to have its own accounting boundary, and §2 requires
  // /api/analyze to be untouched. Both reduce to this one fact.
  assert.ok(PHASE_B.size > 0, 'the PHASE_B class must not be vacuous');
  for (const fn of PHASE_B) {
    const { sites, trail } = reachableCallSites(fn);
    assert.deepEqual(sites, [],
      `${fn}() is declared PHASE_B — off the scan path — but api/analyze.js can reach it:\n  `
      + `${trail.join('\n  ')}\nEither it is on the scan path and needs a refund disposition, `
      + 'or the scan path has acquired a Phase-B dependency that §2 forbids.');
  }
});

// ── ORDERING, NOT MEMBERSHIP — AND NEVER VACUOUSLY ──────────────────────────
test('XP-STRUCT every DOWNSTREAM provider has at least one REACHABLE call site', () => {
  // Rule 1. This is the assertion whose absence made round 8's ordering check a
  // no-op for two of five names. It runs BEFORE the ordering test so a vacuous
  // classification fails on its own terms rather than passing an empty loop.
  for (const fn of DOWNSTREAM) {
    const { sites, trail } = reachableCallSites(fn);
    assert.ok(sites.length > 0,
      `${fn}() is classified DOWNSTREAM but has ZERO resolved call sites, so its ordering ` +
      'relative to Stage 1 is unobservable and the classification is vacuous. Either it IS ' +
      `reachable and the resolver cannot see how (trail: ${trail.join(' | ') || 'none'}) — ` +
      'teach reachableCallSites that shape — or it is dead, in which case delete it, or ' +
      'declare it in DEAD_PROVIDERS with the evidence.');
  }
});

test('XP-STRUCT a DEAD_PROVIDERS entry must really have no caller', () => {
  // The escape hatch cannot become a way to silence rule 1 for live code.
  for (const fn of DEAD_PROVIDERS) {
    const { sites } = reachableCallSites(fn);
    assert.equal(sites.length, 0,
      `${fn}() is declared dead but resolves to ${sites.length} call site(s). ` +
      'Remove it from DEAD_PROVIDERS and give it a real ledger disposition.');
    assert.ok(!DOWNSTREAM.has(fn) && !DIRECT.has(fn),
      `${fn}() cannot be both dead and ledger-classified`);
  }
});

test('XP-STRUCT no DOWNSTREAM provider can execute before Stage 1 marks the ledger', () => {
  // A DOWNSTREAM classification is only true if the call genuinely cannot run
  // before Stage 1 has marked the ledger — so assert that, through indirection.
  // Round 7 proved the naive version wrong: inserting a `fallbackVision(...)`
  // call ABOVE `await runStage1()` left all 43 cases green.
  const stage1Idx = CODE.indexOf('recognition = await runStage1();');
  assert.ok(stage1Idx > -1, 'the Stage-1 call must be locatable');

  for (const fn of DOWNSTREAM) {
    const { sites } = reachableCallSites(fn);
    assert.ok(sites.length > 0, `${fn} must have a reachable call site (see the vacuity test)`);
    for (const site of sites) {
      assert.ok(site.index > stage1Idx,
        `${fn}() is reachable at source index ${site.index}, BEFORE await runStage1() at ` +
        `${stage1Idx}, via ${site.via.join(' → ')}. A downstream-classified provider call ` +
        'cannot run before the ledger is marked — either move it after Stage 1, or thread ' +
        'onBilled into it and reclassify it DIRECT.');
    }
  }
});

test('XP-STRUCT the indirect resolver actually resolves the indirect case', () => {
  // The resolver is the load-bearing part of the two tests above, and a resolver
  // that silently returned [] would make them fail rather than pass — but one
  // that resolved to the WRONG place would make them pass for the wrong reason.
  // So pin the known chain explicitly.
  const { sites } = reachableCallSites('preQuoteFromAI');
  assert.equal(directCalls('preQuoteFromAI').length, 0,
    'fixture: preQuoteFromAI is invoked ONLY through PRE_SOURCES — if that changed, ' +
    'this test no longer proves the resolver follows indirection');
  assert.ok(sites.length > 0, 'the resolver must reach preQuoteFromAI through the table');
  assert.ok(sites.some((s) => s.via.includes('PRE_SOURCES')),
    `expected the chain to pass through PRE_SOURCES, got: ${sites.map((s) => s.via.join('→')).join(' | ')}`);
  assert.ok(sites.some((s) => s.via.includes('pricingRescueEngine')),
    'expected the chain to pass through pricingRescueEngine');
});

test('XP-STRUCT the comment/string mask preserves indices and blanks only prose', () => {
  // Everything above rests on CODE being ANALYZE-with-prose-removed at the SAME
  // offsets. A mask that shifted indices would compare call sites against a
  // meaningless stage1Idx; a mask that blanked too much would hide real calls
  // and re-create the vacuity this round removed, silently.
  assert.equal(CODE.length, ANALYZE.length, 'the mask must not shift a single index');
  assert.equal(CODE.split(NL).length, ANALYZE.split(NL).length, 'line count must be preserved');

  // Real code survives, at its real offset.
  const needle = 'recognition = await runStage1();';
  assert.equal(CODE.indexOf(needle), ANALYZE.indexOf(needle), 'a real statement must survive in place');
  assert.ok(CODE.includes('const PRE_SOURCES = ['), 'the dispatch table must survive');

  // And prose does not. `verifyAndPrice` is named in two comments, one of them
  // ~44,000 characters before Stage 1 — that mention is what made the first
  // draft of this resolver report a false ordering violation.
  const proseMentions = (ANALYZE.match(/in verifyAndPrice/g) || []).length;
  assert.ok(proseMentions > 0, 'fixture: api/analyze.js must still discuss verifyAndPrice in prose');
  assert.equal((CODE.match(/in verifyAndPrice/g) || []).length, 0,
    'comment mentions must be blanked — they are not call sites');

  // A URL containing `//` must not have taken the rest of its line with it.
  assert.ok(CODE.includes('fetchWithRetry('),
    'string-before-comment ordering must keep code after a URL literal intact');

  // ── THE RUNAWAY CHECK ────────────────────────────────────────────────────
  // The assertions above are all "does this ONE thing survive", and the first
  // version of the mask passed every one of them while having erased the
  // declarations of `recognize`, `fallbackVision` and `generateQueryEmbedding`
  // — it desynchronised inside a template literal's `${…}` and then read the
  // apostrophe in the prose word "doesn't" as a string opener. The ordering
  // results still came out right, by luck, which is the worst possible
  // outcome for a guard whose whole job is to not be vacuous.
  //
  // So check the WHOLE surface: every top-level declaration visible in the raw
  // file must still be visible, at the same offset, in the masked one. A mask
  // that runs away anywhere loses every declaration after that point.
  const DECL_ALL = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\s+(\w+)/gm;
  const rawDecls = [...ANALYZE.matchAll(DECL_ALL)].map((m) => ({ name: m[1], index: m.index }));
  const maskedIdx = new Set([...CODE.matchAll(DECL_ALL)].map((m) => m.index));
  const lost = rawDecls.filter((d) => !maskedIdx.has(d.index));

  assert.ok(rawDecls.length > 100, `fixture: expected the full declaration set, found ${rawDecls.length}`);
  assert.deepEqual(lost.map((d) => `${d.name}@${ANALYZE.slice(0, d.index).split(NL).length}`), [],
    'the mask erased real top-level declarations — it ran away on a template literal, ' +
    'a regex or a quote, and every resolution result above is computed on corrupted source');
});

test('XP-STRUCT the ledger markers and the downstream invariant are present', () => {
  // The direct markers must exist and sit at the provider response.
  // SEC-2: derived from the INVENTORY entry's own file, not hard-coded to
  // api/analyze.js and not hard-coded to the 'anthropic' provider label. The
  // previous form could only check DIRECT helpers that lived in analyze.js and
  // marked Anthropic, which is why the OpenAI adapter needed a separate,
  // hand-written line — and why a third DIRECT helper in a third module would
  // have needed a fourth, that nobody would remember to add.
  for (const entry of INVENTORY.filter((e) => e.ledger === 'DIRECT')) {
    const mod = MODULES.find((m) => m.path === entry.file);
    assert.ok(mod, `INVENTORY names ${entry.file}, which is not a production module`);
    const at = mod.source.indexOf(`function ${entry.fn}(`);
    assert.ok(at > -1, `${entry.fn} not found in ${entry.file}`);
    // The WHOLE function body, bounded by the next top-level declaration — not
    // a fixed character window. recognizeWithOpenAI marks the ledger ~4,200
    // characters in, past the 3,000-char window the single-file version used,
    // so a size guess would have failed this for the wrong reason.
    const NEXT = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/gm;
    NEXT.lastIndex = at + 10;
    const next = NEXT.exec(mod.source);
    const body = mod.source.slice(at, next ? next.index : mod.source.length);
    assert.match(body, /if \(res\.ok\) onBilled\?\.\(/,
      `${entry.fn} in ${entry.file} is classified DIRECT but does not mark the ledger at res.ok`);
  }

  // And the downstream invariant must actually be asserted in the code.
  assert.match(ANALYZE, /if \(!providerLedger\.consumed\) \{/,
    'the downstream-coverage invariant must be checked after Stage 1');
});

test('XP-STRUCT every recognize()/ocrSerialLabel() CALL passes the ledger', () => {
  // The round-6 HIGH in one assertion: a call site that omits onBilled.
  const lines = ANALYZE.split(/\r?\n/);
  const calls = [];
  lines.forEach((l, i) => {
    if (/\b(recognize|ocrSerialLabel)\(imageList/.test(l)) calls.push({ line: i + 1, text: l.trim() });
  });
  assert.ok(calls.length >= 3, `expected the known call sites, found ${calls.length}`);
  for (const c of calls) {
    assert.match(c.text, /onBilled/,
      `api/analyze.js:${c.line} calls a billable helper WITHOUT the ledger: ${c.text.slice(0, 70)}`);
  }
});

test('XP-STRUCT the OpenAI adapter call passes the ledger', () => {
  const m = /recognizeWithOpenAI\(imageList,\s*\{([^}]*)\}/.exec(ANALYZE);
  assert.ok(m, 'the adapter call site must be present');
  assert.match(m[1], /onBilled/, 'the OpenAI adapter call must pass the ledger');
});
