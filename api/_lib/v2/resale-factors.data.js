// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE RESALE FACTOR TABLE (DATA)
//
// MEASURED resale factors: what second-hand sellers ask, as a share of the new
// price, per (category, product_class, condition) group. Written ONLY from the
// report of scripts/valuation-calibration.mjs over a dataset of products whose
// retail AND used prices were really observed; never edited by hand to a
// number nobody measured, and never defaulted. A group whose status is not
// MEASURED yields no estimate.
//
// NO GROUP IS MEASURED YET. Until one is, the market-informed estimate cannot
// be produced, and every scan that would have used it says so instead
// (pricing.js: `limitation: no_calibrated_resale_factor`).
//
// Shape of a group:
//   { category: 'Home', product_class: 'blender', condition: 'Good',
//     status: 'MEASURED', products: 7,
//     factor: { median: 0.52, p25: 0.44, p75: 0.60, n: 7 },
//     dataset: '<file or run id>', generated_at: '<ISO date>' }
// ══════════════════════════════════════════════════════════════════════════════
export default Object.freeze({
  version: 1,
  market: 'IL',
  currency: 'ILS',
  generated_by: null,
  generated_at: null,
  dataset: null,
  groups: Object.freeze([]),
});
