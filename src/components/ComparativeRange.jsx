import React from 'react';
import { ExternalLink } from 'lucide-react';
import { formatPrice } from '../lib/utils';
import { Bidi } from './ScanSheets';

// STATE B — A LIMITED COMPARATIVE RANGE (founder decision, 2026-11-15). Shown only with no valuation, and only from genuine
// Israeli second-hand ads that passed every check (valuation.js comparativeOf). Two or more ads: their lowest and highest
// asking price. One ad: its own price, never a range. Each ad is listed with its price, where it is, how close a match it is
// and its date, so every number on the card can be followed to its source. Never called a worth, never three prices.
export default function ComparativeRange({ comparative: c, copy }) {
  if (!c || !Array.isArray(c.observations) || c.observations.length === 0) return null;
  const range = c.count >= 2 && c.low && c.high;
  const headline = range ? `${formatPrice(c.low)}–${formatPrice(c.high)}` : formatPrice(c.observations[0].price_ils);
  return (
    <div className="rounded-container border border-subtle bg-surface p-4 space-y-3" data-testid="scan-comparative">
      <div className="space-y-1">
        <p className="text-meta text-text-muted">{range ? copy.comparativeRange : copy.comparativeSingle}</p>
        <p className="text-title text-text-primary" data-testid="scan-comparative-price"><bdi dir="ltr">{headline}</bdi></p>
        <p className="text-meta text-text-muted">{copy.comparativeCount(c.count, c.exact_count)}</p>
        <p className="text-body-sm text-text-secondary">{copy.comparativeNote}</p>
      </div>
      <ul className="divide-y divide-subtle">
        {c.observations.map((o) => {
          const facts = [copy.comparativeMatch[o.match] ?? null, o.kind === 'sold' ? copy.comparativeSold : null, o.listed ?? null].filter(Boolean).join(' · ');
          const body = (
            <span className="flex items-start justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-body-sm text-text-primary line-clamp-2 break-words"><Bidi>{o.title || o.domain}</Bidi></span>
                <span className="flex items-center gap-1 text-meta text-text-muted">
                  <bdi dir="ltr">{o.domain}</bdi>{facts ? <span>· <Bidi>{facts}</Bidi></span> : null}
                  {o.url && /^https:\/\//.test(o.url) && <ExternalLink className="w-3 h-3" aria-hidden="true" />}
                </span>
              </span>
              <bdi dir="ltr" className="shrink-0 text-label text-text-primary">{formatPrice(o.price_ils)}</bdi>
            </span>
          );
          return (
            <li key={`${o.url}|${o.price_ils}`}>
              {o.url && /^https:\/\//.test(o.url)
                ? <a href={o.url} target="_blank" rel="noopener noreferrer" className="block state-layer rounded-control">{body}</a>
                : body}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
