// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE RESALE FACTOR TABLE
//
//     USED_VALUE  ≈  RETAIL_PRICE × factor(category, product class, condition)
//
// holds ONLY where the factor was measured. The table is resale-factors.data.js,
// written from the report of scripts/valuation-calibration.mjs over products
// whose retail and used prices were both observed; this file reads it and
// answers one question: is there a MEASURED factor for this group? There is no
// default, no universal percentage and no neighbouring group: a phone, a
// perfume, a blender and a sofa do not share a curve, and a curve nobody
// measured is not reported.
//
// The group key is the category, then the product class (the object class the
// identity gave, lower-cased), then the condition. A group measured for the
// category and class but not this condition is answered with the Unknown-
// condition row when one was measured, and otherwise not at all.
//
// No file system, no network: the table is a module, so the provider scanner
// sees a dependency it can read.
// ══════════════════════════════════════════════════════════════════════════════
import SHIPPED from './resale-factors.data.js';

export const FACTOR_STATUS = Object.freeze({ MEASURED: 'MEASURED', INSUFFICIENT_DATA: 'INSUFFICIENT_DATA' });
export const UNKNOWN_CONDITION = 'Unknown';

const norm = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The table in the shape `findResaleFactor` reads: normalised keys, frozen rows. */
export function normalizeResaleFactors(raw) {
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  return Object.freeze({
    version: raw?.version ?? null,
    market: raw?.market ?? null,
    generated_at: raw?.generated_at ?? null,
    groups: Object.freeze(groups.map((g) => Object.freeze({
      category: norm(g?.category), product_class: norm(g?.product_class), condition: String(g?.condition ?? UNKNOWN_CONDITION),
      status: g?.status === FACTOR_STATUS.MEASURED ? FACTOR_STATUS.MEASURED : FACTOR_STATUS.INSUFFICIENT_DATA,
      factor: g?.factor && typeof g.factor === 'object' ? Object.freeze({ ...g.factor }) : null,
      products: Number(g?.products ?? g?.factor?.n ?? 0) || 0,
    }))),
  });
}

let TABLE = null;
/** The shipped table, normalised once. */
export function loadResaleFactors() {
  if (!TABLE) TABLE = normalizeResaleFactors(SHIPPED);
  return TABLE;
}

/** For tests: forget the loaded table. */
export function resetResaleFactors() { TABLE = null; }

/** The group's name, as the limitation reports it. */
export const groupKey = ({ category, object_class, condition }) => `${norm(category) || '?'}:${norm(object_class) || '?'}:${condition || UNKNOWN_CONDITION}`;

const valid = (f) => f && [f.median, f.p25, f.p75].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1)
  && f.p25 <= f.median && f.median <= f.p75;

/**
 * A MEASURED factor for this group, or null with the reason.
 *
 * `table` may be a raw table (as the data module or a test supplies it) or an
 * already-normalised one. Returns { factor, group, status, reason }; `factor`
 * is non-null only for a measured group whose numbers are a share strictly
 * between 0 and 1, in order.
 */
export function findResaleFactor({ category, object_class, condition = UNKNOWN_CONDITION } = {}, table = loadResaleFactors()) {
  const t = table === loadResaleFactors() ? table : normalizeResaleFactors(table);
  const group = groupKey({ category, object_class, condition });
  const cat = norm(category);
  const cls = norm(object_class);
  if (!cat || !cls) return { factor: null, group, status: null, reason: 'no_category_or_product_class' };
  const rows = t.groups.filter((g) => g.category === cat && g.product_class === cls);
  if (rows.length === 0) return { factor: null, group, status: null, reason: 'no_calibrated_resale_factor' };
  const exact = rows.find((g) => g.condition === condition) ?? rows.find((g) => g.condition === UNKNOWN_CONDITION) ?? null;
  if (!exact) return { factor: null, group, status: null, reason: 'no_calibrated_resale_factor_for_condition' };
  if (exact.status !== FACTOR_STATUS.MEASURED || !valid(exact.factor)) {
    return { factor: null, group, status: exact.status, reason: 'resale_factor_not_measured' };
  }
  return { factor: exact.factor, group, status: exact.status, reason: null, condition: exact.condition, products: exact.products };
}
