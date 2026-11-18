// Method C on the client: which calculated figure applies (api/_lib/scan/retail-estimate.js makes them).
/**
 * The calculated figure for the condition in force: the one the owner picked, else the one read from the photograph.
 * null when that condition takes no estimate (fair, poor) or none is known yet (the screen then asks for it).
 */
export function calculatedFor(calculated, condition) {
  if (!calculated?.estimates) return null;
  const c = condition ?? (calculated.condition !== 'unknown' ? calculated.condition : null);
  if (!c) return { needsCondition: true };
  const value = calculated.estimates[c];
  if (!value) return { excluded: c };
  return { condition: c, value, deduction: calculated.deductions?.[c] ?? null, chosen: !!condition };
}
