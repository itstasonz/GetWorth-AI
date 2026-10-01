// ══════════════════════════════════════════════════════════════════════════════
// VALUATION CALIBRATION — OFFLINE
//
// THE QUESTION. When a product is identified and has no second-hand listings,
// may GetWorth say what it is worth from what it costs new?
//
//     USED_VALUE  ≈  RETAIL_VALUE × MARKET_DEPRECIATION_FACTOR
//
// Only if that factor is MEASURED. This harness measures it, from products for
// which both halves were really observed: exact local retail prices, and exact
// local second-hand asking prices.
//
// THERE IS NO PERCENTAGE IN THIS FILE. No factor is assumed, defaulted or
// rounded to. Where the data is too thin the answer is INSUFFICIENT_DATA, not
// a guess. The only constants are sample floors, and they are arguments.
//
// NOT PRODUCTION. Nothing under api/ or src/ imports this file, and a test
// holds that. It reads a dataset and prints a report.
//
//   node scripts/valuation-calibration.mjs <dataset.json> [--json]
//
// DATASET
//   { market, currency, products: [{
//       id, identity, category, product_class,
//       retail: [{ price, source, currency? }],
//       used:   [{ price, source, condition?, currency? }] }] }
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const STATUS = Object.freeze({ MEASURED: 'MEASURED', INSUFFICIENT_DATA: 'INSUFFICIENT_DATA' });
export const UNKNOWN_CONDITION = 'Unknown';

/** Sample floors. Counts, not shares: how much must be seen before anything is said. */
export const DEFAULT_FLOORS = Object.freeze({
  minRetailSources: 2,      // independent shops behind a product's retail median
  minUsedListings: 3,       // second-hand asking prices behind a product's used median
  minUsedSources: 2,        // independent sites those listings came from
  minProductsPerGroup: 5,   // products behind a group's factor
});

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const round = (v, d = 4) => (v === null ? null : Number(v.toFixed(d)));

/** Linear-interpolated quantile of a sorted list. */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export const median = (values) => quantile([...values].sort((a, b) => a - b), 0.5);

function spread(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, median: null, p25: null, p75: null, min: null, max: null, mad: null };
  const m = quantile(sorted, 0.5);
  return {
    n: sorted.length,
    median: round(m),
    p25: round(quantile(sorted, 0.25)),
    p75: round(quantile(sorted, 0.75)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    // Median absolute deviation: how far a typical product sits from the group's factor.
    mad: round(median(sorted.map((v) => Math.abs(v - m)))),
  };
}

/** One price per source: a shop with three pages, or a seller with three ads, is one voice. */
function perSource(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.source)) by.set(r.source, []);
    by.get(r.source).push(r.price);
  }
  return [...by.values()].map((prices) => median(prices));
}

/**
 * One product's measurement, per condition.
 *
 * Returns one row for every condition the product's used listings carry. A row
 * is `usable` only when every floor is met; otherwise `reasons` says which were
 * not. A price in another currency is dropped and counted, never converted.
 */
export function measureProduct(product, { currency = 'ILS', floors = DEFAULT_FLOORS } = {}) {
  const keep = (rows, extra = () => ({})) => {
    const kept = [];
    let foreign = 0;
    let invalid = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const price = num(r?.price);
      const source = str(r?.source);
      if (!price || !source) { invalid += 1; continue; }
      if ((str(r?.currency) ?? currency) !== currency) { foreign += 1; continue; }
      kept.push({ price, source: source.toLowerCase(), ...extra(r) });
    }
    return { kept, foreign, invalid };
  };
  const retail = keep(product?.retail);
  const used = keep(product?.used, (r) => ({ condition: str(r?.condition) ?? UNKNOWN_CONDITION }));
  const retailBySource = perSource(retail.kept);
  const retailMedian = retailBySource.length ? median(retailBySource) : null;

  const conditions = [...new Set(used.kept.map((u) => u.condition))];
  const base = {
    id: str(product?.id),
    identity: str(product?.identity),
    category: str(product?.category),
    product_class: str(product?.product_class),
    retail_median: retailMedian === null ? null : Math.round(retailMedian),
    retail_sources: retailBySource.length,
    dropped: { foreign_currency: retail.foreign + used.foreign, invalid: retail.invalid + used.invalid },
  };
  const rowFor = (condition, listings) => {
    const bySource = perSource(listings);
    const usedMedian = listings.length ? median(listings.map((l) => l.price)) : null;
    const reasons = [];
    if (!base.product_class) reasons.push('no_product_class');
    if (retailBySource.length < floors.minRetailSources) reasons.push('retail_sources_below_floor');
    if (listings.length < floors.minUsedListings) reasons.push('used_listings_below_floor');
    if (bySource.length < floors.minUsedSources) reasons.push('used_sources_below_floor');
    return {
      ...base,
      condition,
      used_median: usedMedian === null ? null : Math.round(usedMedian),
      used_listings: listings.length,
      used_sources: bySource.length,
      // THE MEASUREMENT: what second-hand sellers ask, as a share of the new price.
      ratio: usedMedian !== null && retailMedian ? round(usedMedian / retailMedian) : null,
      usable: reasons.length === 0,
      reasons,
    };
  };
  if (conditions.length === 0) return [rowFor(UNKNOWN_CONDITION, [])];
  return conditions.map((c) => rowFor(c, used.kept.filter((u) => u.condition === c)));
}

/**
 * Leave-one-out: predict each product's used median from its own retail median
 * and the factor of the OTHER products in its group, and report how wrong that
 * was. This is the number that says whether a group's factor may be used.
 */
function leaveOneOut(rows) {
  const errors = [];
  for (const row of rows) {
    const others = rows.filter((r) => r !== row).map((r) => r.ratio);
    if (others.length === 0) continue;
    const predicted = row.retail_median * median(others);
    errors.push(Math.abs(predicted - row.used_median) / row.used_median);
  }
  const s = spread(errors);
  return { n: s.n, median_abs_error: s.median, p75_abs_error: s.p75, max_abs_error: s.max };
}

/**
 * Aggregate usable product rows into groups, by `by` (default: product class
 * and condition). A group below the product floor reports its numbers and is
 * INSUFFICIENT_DATA: visible, and not a factor.
 */
export function aggregate(rows, { by = ['product_class', 'condition'], floors = DEFAULT_FLOORS } = {}) {
  const groups = new Map();
  for (const row of rows.filter((r) => r.usable)) {
    const key = by.map((k) => row[k] ?? 'unknown').join(' / ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, members]) => {
    const measured = members.length >= floors.minProductsPerGroup;
    return {
      group: key,
      status: measured ? STATUS.MEASURED : STATUS.INSUFFICIENT_DATA,
      products: members.length,
      used_listings: members.reduce((n, m) => n + m.used_listings, 0),
      // The depreciation factor and its uncertainty, exactly as observed.
      factor: spread(members.map((m) => m.ratio)),
      leave_one_out: leaveOneOut(members),
      members: members.map((m) => m.id),
    };
  }).sort((a, b) => b.products - a.products || a.group.localeCompare(b.group));
}

/** The whole report for a dataset. */
export function calibrate(dataset, { floors = DEFAULT_FLOORS, by } = {}) {
  const currency = str(dataset?.currency) ?? 'ILS';
  const products = Array.isArray(dataset?.products) ? dataset.products : [];
  const rows = products.flatMap((p) => measureProduct(p, { currency, floors }));
  const groups = aggregate(rows, { by, floors });
  return {
    market: str(dataset?.market),
    currency,
    floors,
    products: products.length,
    rows,
    usable_rows: rows.filter((r) => r.usable).length,
    groups,
    measured_groups: groups.filter((g) => g.status === STATUS.MEASURED).length,
    // Stated in the report itself, so a reader of the output cannot miss it.
    production_use: 'NONE — experimental. No group factor is read by the scan engine.',
  };
}

function print(report) {
  const pct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  console.log(`VALUATION CALIBRATION — ${report.market ?? '?'} / ${report.currency}`);
  console.log(`products ${report.products} · usable product×condition rows ${report.usable_rows}/${report.rows.length} · measured groups ${report.measured_groups}/${report.groups.length}`);
  console.log(`floors ${JSON.stringify(report.floors)}\n`);
  console.log('PER PRODUCT');
  for (const r of report.rows) {
    console.log(`  ${(r.id ?? '?').padEnd(28)} ${(r.product_class ?? '?').padEnd(22)} ${r.condition.padEnd(9)} retail ${String(r.retail_median ?? '—').padStart(6)} (${r.retail_sources} src)  used ${String(r.used_median ?? '—').padStart(6)} (${r.used_listings} in ${r.used_sources} src)  ratio ${pct(r.ratio).padStart(6)}  ${r.usable ? 'usable' : r.reasons.join(', ')}`);
  }
  console.log('\nPER GROUP');
  for (const g of report.groups) {
    console.log(`  ${g.group.padEnd(34)} ${g.status.padEnd(18)} products ${g.products}  factor median ${pct(g.factor.median)} [p25 ${pct(g.factor.p25)} – p75 ${pct(g.factor.p75)}; min ${pct(g.factor.min)} – max ${pct(g.factor.max)}]  leave-one-out median error ${pct(g.leave_one_out.median_abs_error)}`);
  }
  console.log(`\nPRODUCTION USE: ${report.production_use}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/valuation-calibration.mjs <dataset.json> [--json]'); process.exit(2); }
  const report = calibrate(JSON.parse(readFileSync(file, 'utf8')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else print(report);
}
