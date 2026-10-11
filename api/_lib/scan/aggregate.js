// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — THE ARITHMETIC OF A PRICE
//
// Pure functions over weighted reference points: the weighted median, where
// the weight of the evidence lies, how far apart it is, and a natural rounding.
// No market knowledge here — valuation.js decides what a point is and what it
// weighs; this module only adds them up. Deterministic, and the same in any
// order. Every number is a stated assumption, kept in one place.
// ══════════════════════════════════════════════════════════════════════════════

/** Median-absolute-deviation outlier rule, applied only when there is a distribution to be an outlier from. */
export const MAD_THRESHOLD = 3.5;
export const MAD_MIN_SAMPLE = 4;
/** The expected selling range around the centre: the least it may be by how much evidence there is, and the most. */
const RANGE = Object.freeze({ one: [0.25, 0.12], few: [0.18, 0.09], many: [0.08, 0.04], max: [0.5, 0.4] });

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round2 = (v) => Math.round(v * 100) / 100;

/** A natural price: ₪290, ₪900, ₪1,250. Never ₪847. */
export function roundNice(n) {
  const v = finite(n);
  if (!v) return null;
  const step = v < 100 ? 5 : v < 1000 ? 10 : v < 5000 ? 50 : v < 20000 ? 100 : 500;
  return Math.max(step, Math.round(v / step) * step);
}

// ── AGGREGATE ───────────────────────────────────────────────────────────────
/**
 * The value below which `q` of the total weight lies. When the weight splits
 * exactly at a boundary the answer is the midpoint of the two neighbours, never
 * whichever happened to be lower. Deterministic: ties are ordered by value, then page.
 */
export function weightedQuantile(points, q) {
  const sorted = [...points].sort((a, b) => a.value - b.value || String(a.evidence?.url).localeCompare(String(b.evidence?.url)));
  const total = sorted.reduce((s, p) => s + p.weight, 0);
  if (!sorted.length || !(total > 0)) return null;
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i].weight;
    if (Math.abs(acc - target) < total * 1e-9 && i + 1 < sorted.length) return (sorted[i].value + sorted[i + 1].value) / 2;
    if (acc > target) return sorted[i].value;
  }
  return sorted.at(-1).value;
}

/** How far apart the weight of the evidence lies: P90 over P10. 1 when it agrees or there is one reference. */
export function dispersionOf(kept) {
  if (kept.length < 2) return 1;
  const lo = weightedQuantile(kept, 0.1);
  const hi = weightedQuantile(kept, 0.9);
  return lo > 0 ? hi / lo : 1;
}

/** The centre and the expected selling range in "good" condition, from the references that stand. */
export function aggregate(kept) {
  if (kept.length === 0) return null;
  const centre = weightedQuantile(kept, 0.5);
  if (kept.length === 1) return { centre, low: centre * (1 - RANGE.one[0]), high: centre * (1 + RANGE.one[1]) };
  const least = kept.length >= MAD_MIN_SAMPLE ? RANGE.many : RANGE.few;
  // The range is where the weight of the evidence lies: evidence that disagrees gives a wide range.
  const below = clamp(1 - weightedQuantile(kept, 0.25) / centre, least[0], RANGE.max[0]);
  const above = clamp(weightedQuantile(kept, 0.75) / centre - 1, least[1], RANGE.max[1]);
  return { centre, low: centre * (1 - below), high: centre * (1 + above) };
}
