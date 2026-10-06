// ══════════════════════════════════════════════════════════════════════════════
// THE CORE SCAN — ITS TWO SHEETS, AND HOW MIXED-SCRIPT TEXT IS SHOWN
//
//   "Wrong item?"      one line of the owner's own words, or one tap on what
//                      the scan itself thought it might be. Not a form.
//   "Why this price?"  what the price rests on: how many second-hand listings,
//                      how many from Israel and from abroad, the spread of
//                      their prices, the new price, how sure the price is, and
//                      then each source — where it is from, what it is, how
//                      exact, how fresh. Every line is assembled from the
//                      valuation's own numbers; none of it is a model's prose.
//
// Neither shows engineering detail. A person reads these.
// ══════════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Btn, Chip, Sheet, TextArea } from './ui';
import { formatPrice } from '../lib/utils';
import { MAX_CORRECTION_CHARS } from '../lib/coreScan';

// A run of Latin text: a brand, a model name, a size. Kept whole, in its own left-to-right order.
const LATIN_RUN = /[A-Za-z0-9][A-Za-z0-9 .,'’"+&/()\-]*[A-Za-z0-9)]|[A-Za-z0-9]/g;

/**
 * Text that mixes Hebrew with a brand or model name.
 *
 * "Logitech G Pro Wireless" must read in that order inside a right-to-left
 * sentence, and must not drag the sentence's own direction with it. Each Latin
 * run is isolated; the surrounding text keeps the direction of the screen.
 */
export function Bidi({ children }) {
  const text = String(children ?? '');
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(LATIN_RUN)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<bdi key={m.index} dir="ltr">{m[0]}</bdi>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function WrongItemSheet({ open, onClose, onSubmit, identity, copy, rtl }) {
  const [text, setText] = useState('');
  const submit = (value) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    setText('');
    onSubmit(v);
  };
  const alternatives = (identity?.alternatives ?? []).map((a) => a.name).filter(Boolean);
  return (
    <Sheet open={open} onClose={onClose} title={copy.correctTitle}>
      {alternatives.length > 0 && (
        <div className="space-y-2">
          <p className="text-body-sm text-text-muted">{copy.correctCouldBe}</p>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((name) => <Chip key={name} onClick={() => submit(name)}><Bidi>{name}</Bidi></Chip>)}
          </div>
        </div>
      )}
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <TextArea
          label={copy.correctHint} rtl={rtl} dir="auto" rows={2} maxLength={MAX_CORRECTION_CHARS}
          placeholder={copy.correctPlaceholder} value={text} onChange={(e) => setText(e.target.value)}
        />
        <Btn primary fullWidth type="submit" disabled={!text.trim()}>{copy.correctSubmit}</Btn>
      </form>
    </Sheet>
  );
}

/**
 * One source: what it is and where it is from on the first side, its price on
 * the other, in one row, so a price can never be read against the wrong source.
 * The whole row is the link.
 */
function Source({ e, copy }) {
  const original = e.currency === 'ILS' ? formatPrice(e.price) : `${e.price.toLocaleString()} ${e.currency}`;
  const converted = e.currency !== 'ILS' && e.price_ils ? copy.approx(formatPrice(e.price_ils)) : null;
  const facts = [
    copy.kinds[e.kind] ?? copy.kinds.other,
    copy.matches[e.match] ?? null,
    copy.places[e.market] ?? null,
    copy.freshness[e.freshness] ?? null,
  ].filter(Boolean).join(' · ');
  return (
    <li>
      <a
        href={e.url} target="_blank" rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 py-3 state-layer rounded-control"
      >
        <span className="min-w-0 space-y-0.5">
          <span className="block text-body-sm text-text-primary truncate"><Bidi>{e.title || e.domain}</Bidi></span>
          <span className="block text-meta text-text-muted">{facts}</span>
          <span className="flex items-center gap-1 text-meta text-text-muted">
            <bdi dir="ltr">{e.domain}</bdi>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </span>
        </span>
        <span className="shrink-0 text-end">
          <bdi dir="ltr" className="block text-label text-text-primary">{original}</bdi>
          {converted && <bdi dir="ltr" className="block text-meta text-text-muted">{converted}</bdi>}
        </span>
      </a>
    </li>
  );
}

export function WhyPriceSheet({ open, onClose, valuation, copy, priced }) {
  const v = valuation ?? {};
  const counts = v.counts ?? {};
  const evidence = Array.isArray(v.evidence) ? v.evidence : [];
  // What the price rests on, then the new prices it was measured against. What was set aside is counted, not listed.
  const shown = evidence.filter((e) => e.used || (e.kind === 'new_retail' && !e.set_aside));
  const il = (counts.il_used_exact ?? 0) + (counts.il_used_close ?? 0);
  const intl = (counts.intl_used_exact ?? 0) + (counts.intl_used_close ?? 0);
  const aside = (counts.not_comparable ?? 0) + (counts.set_aside ?? 0);
  const range = v.reference_range;
  return (
    <Sheet open={open} onClose={onClose} title={priced ? copy.whyTitle : copy.whatFound}>
      <div className="space-y-4 overflow-y-auto" style={{ maxHeight: '62vh' }}>
        <div className="space-y-1 text-body text-text-primary">
          <p className="font-semibold">{copy.found(counts.resale ?? 0)}</p>
          {(counts.resale ?? 0) > 0 && (
            <p className="text-body-sm text-text-secondary">{copy.fromIsrael(il)} · {copy.fromAbroad(intl)}</p>
          )}
          {range && <p>{copy.relevantRange}: {copy.range(range)}</p>}
          {v.retail_new_ils && <p>{copy.newInIsrael}: <bdi dir="ltr">{formatPrice(v.retail_new_ils)}</bdi></p>}
          {priced && <p>{copy.confidenceLine}: {copy.levels[v.price_confidence] ?? copy.levels.low}</p>}
        </div>

        {priced && (
          <div className="space-y-1 text-body-sm text-text-secondary">
            {v.basis === 'similar_models' && <p>{copy.similarWhy}</p>}
            {v.basis !== 'similar_models' && v.approximate && <p>{copy.approximateWhy}</p>}
            {v.dispersed && <p>{copy.dispersedWhy}</p>}
            {v.intl_adjusted === true && <p>{copy.intlAdjusted(v.intl_scale)}</p>}
            {v.intl_adjusted === false && <p>{copy.intlUnadjusted}</p>}
            <p>{copy.how}</p>
            <p>{copy.conditionsHow}</p>
          </div>
        )}

        <div className="space-y-1 text-body-sm text-text-secondary">
          {(counts.abroad_unused ?? 0) > 0 && <p>{copy.abroadUnused(counts.abroad_unused)}</p>}
          {aside > 0 && <p>{copy.setAside(aside)}</p>}
          {v.searched?.date && <p>{copy.searchedOn(v.searched.date)}</p>}
        </div>

        <div className="space-y-1">
          <p className="text-label text-text-muted">{copy.sources}</p>
          {shown.length > 0
            ? <ul className="divide-y divide-subtle">{shown.map((e) => <Source key={`${e.url}|${e.price}`} e={e} copy={copy} />)}</ul>
            : <p className="text-body-sm text-text-secondary">{copy.noSources}</p>}
        </div>
      </div>
    </Sheet>
  );
}
