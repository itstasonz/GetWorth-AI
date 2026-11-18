import React from 'react';
import { ExternalLink } from 'lucide-react';
import { formatPrice } from '../lib/utils';
import { Bidi } from './ScanSheets';
import { calculatedFor } from '../lib/calculatedEstimate';

// METHOD C — A CALCULATED ESTIMATE FROM THE NEW PRICE (founder decision, 2026-11-18; api/_lib/scan/retail-estimate.js).
// Shown only with no valuation and no observed Israeli ads. One figure, said to be calculated and not a market valuation,
// with the shop it rests on, the new price and the deduction applied, and the condition it assumes.
export default function CalculatedEstimate({ calculated, condition, copy }) {
  if (!calculated) return null;
  const pick = calculatedFor(calculated, condition);
  if (!pick) return null;
  const source = calculated.sources?.[0] ?? null;
  return (
    <div className="rounded-container border border-subtle bg-surface p-4 space-y-3" data-testid="scan-calculated">
      <div className="text-center space-y-1">
        <p className="text-label text-text-muted">{copy.calculatedTitle}</p>
        {pick.value ? (
          <p className="text-display text-text-primary" data-testid="scan-calculated-price"><bdi dir="ltr">≈ {formatPrice(pick.value)}</bdi></p>
        ) : (
          <p className="text-body text-text-secondary" data-testid="scan-calculated-ask">{pick.needsCondition ? copy.calculatedPickCondition : copy.calculatedExcluded(copy.conditions[pick.excluded] ?? pick.excluded)}</p>
        )}
        <p className="text-body-sm font-semibold text-text-secondary" data-testid="scan-calculated-label">{copy.calculatedLabel}</p>
      </div>
      {pick.value && (
        <p className="text-body-sm text-text-secondary" data-testid="scan-calculated-basis">
          <Bidi>{copy.calculatedBasis(formatPrice(calculated.retail_ils), Math.round((pick.deduction ?? 0) * 100), copy.conditions[pick.condition] ?? pick.condition, pick.chosen)}</Bidi>
        </p>
      )}
      {source && (
        <p className="text-meta text-text-muted flex items-center gap-1">
          <span>{copy.calculatedSource}</span>
          {/^https:\/\//.test(source.url ?? '') ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline" data-testid="scan-calculated-source">
              <bdi dir="ltr">{source.domain}</bdi> · <bdi dir="ltr">{formatPrice(source.price_ils)}</bdi><ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          ) : (<bdi dir="ltr">{source.domain}</bdi>)}
        </p>
      )}
    </div>
  );
}
