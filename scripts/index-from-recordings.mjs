// Build the market-index payload a set of live recordings (scripts/il-coverage-eval.mjs record) would have written, using
// the scan's own code path (runPrice → saveIndexed), without a database: the RPC argument is captured and printed as JSON.
//   node scripts/index-from-recordings.mjs <recordings-dir> <payload.json>
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const OUT = process.argv[3];
const captured = [];
const capture = { rpc: async (name, args) => { if (name === 'record_market_observations') captured.push(...args.p_rows); return { data: args.p_rows.length, error: null }; }, from: () => ({ select: () => ({ eq: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) };
const { saveIndexed, loadIndexed } = await import('../api/_lib/market/index-store.js');
const index = { load: (i, a, o) => loadIndexed(i, a, { ...o, supa: capture }), save: (i, a, r, o) => saveIndexed(i, a, r, { ...o, supa: capture }) };
globalThis.__GW_EVAL_INDEX__ = index;
process.argv = [process.argv[0], 'scripts/il-coverage-eval.mjs', 'replay', dir, '.', path.join(dir, '..', 'replay-capture.json')];
await import('./il-coverage-eval.mjs');
fs.writeFileSync(process.argv.at(-1) === undefined ? 'payload.json' : OUT, JSON.stringify(captured));
console.error(`captured ${captured.length} observations`);
