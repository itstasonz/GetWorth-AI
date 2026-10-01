// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE MATRIX, SCANNED
//
// Every fixture of market-fixtures.mjs run through the deterministic half of a
// V2 scan — gate, market identity, extraction, qualification, price — once, so
// the suites can assert on one case and on all of them. No provider call.
// ══════════════════════════════════════════════════════════════════════════════
import { assessV2Evidence } from '../../../api/_lib/v2/evidence.js';
import { resolveV2Price } from '../../../api/_lib/v2/pricing.js';
import { normalizeIdentity } from '../../../api/_lib/v2/identity.js';
import { decideSufficiency } from '../../../api/_lib/v2/sufficiency.js';
import { subjectOf } from '../../../api/_lib/v2/search-plan.js';
import { SEARCH_OUTCOME } from '../../../api/_lib/v2/search.js';
import { resolveMarketRegion } from '../../../api/_lib/phaseb/config.js';
import { extractSearchProvenance } from '../../../api/_lib/phaseb/search-provenance.js';
import { RAW, RESULTS_PS5_VERIFIED } from './fixtures.mjs';
import * as M from './market-fixtures.mjs';

export const IL = resolveMarketRegion();
export const provenanceOf = (results) => extractSearchProvenance([{
  type: 'web_search_call', status: 'completed',
  action: { type: 'search', queries: ['q'], sources: results.map((r) => ({ type: 'url', url: r.url })) },
  results,
}]);
export function scan(raw, results, provenance = provenanceOf(results)) {
  const identity = normalizeIdentity(raw);
  const sufficiency = decideSufficiency(identity);
  const subject = subjectOf(identity, sufficiency.level);
  const evidence = assessV2Evidence({ provenance, subject, level: sufficiency.level, identity });
  const price = resolveV2Price({ identity, subject, sufficiency, evidence, searchOutcome: SEARCH_OUTCOME.COMPLETED });
  return { identity, sufficiency, subject, evidence, price };
}
export const alias = (evidence, value) => evidence.market.aliases.find((a) => a.value === value);
export const prices = (list) => list.map((e) => e.observation.observed_price).sort((a, b) => a - b);

// Every fixture of the matrix, for the invariants that must hold on all of them.
export const MATRIX = [
  ['A witness', M.NINJA, null, extractSearchProvenance(M.NINJA_WITNESS.output)],
  ['B phone', M.IPHONE, M.RESULTS_IPHONE],
  ['C console', RAW.PS5, RESULTS_PS5_VERIFIED],
  ['E perfume', M.PERFUME, M.RESULTS_PERFUME],
  ['F shoes', M.JORDAN, M.RESULTS_JORDAN],
  ['G one listing', M.CONSOLE, M.RESULTS_ONE_LISTING],
  ['H three from two', M.CONSOLE, M.RESULTS_THREE_FROM_TWO],
  ['I retail only', M.NINJA, M.RESULTS_RETAIL_TWO_SHOPS],
  ['J sibling retail', M.NINJA, M.RESULTS_SIBLING_RETAIL],
  ['K category page', M.NINJA, M.RESULTS_CATEGORY],
  ['L price and fees', M.NINJA, M.RESULTS_PRICE_AND_FEES],
  ['M unverified alias', M.NINJA_UNVERIFIED, M.RESULTS_UNVERIFIED_ALIAS],
  ['M verified alias', M.NINJA, M.RESULTS_VERIFIED_ALIAS],
  ['foreign', M.NINJA, M.RESULTS_FOREIGN],
].map(([name, raw, results, provenance]) => ({ name, raw, ...scan(raw, results, provenance ?? provenanceOf(results)) }));
