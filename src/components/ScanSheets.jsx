// ══════════════════════════════════════════════════════════════════════════════
// THE CORE SCAN — ITS TWO SHEETS
//
//   "Wrong item?"      one line of the owner's own words, or one tap on what
//                      the scan itself thought it might be. Not a form.
//   "Why this price?"  what the price rests on and how it was calculated: how
//                      many second-hand references, from where, how exact, the
//                      new-price anchor, the date, and the pages themselves.
//                      Every sentence is assembled from the valuation's own
//                      numbers; none of it is a model's prose.
//
// Neither shows engineering detail. A person reads these.
// ══════════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Btn, Chip, Sheet, TextArea } from './ui';
import { formatPrice } from '../lib/utils';
import { MAX_CORRECTION_CHARS } from '../lib/coreScan';

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
            {alternatives.map((name) => <Chip key={name} onClick={() => submit(name)}><span dir="auto">{name}</span></Chip>)}
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

/** One source: where, what, how much. The whole row is the link. */
function Source({ e, copy }) {
  const original = e.currency === 'ILS' ? formatPrice(e.price) : `${e.price.toLocaleString()} ${e.currency}`;
  const converted = e.currency !== 'ILS' && e.price_ils ? copy.approx(formatPrice(e.price_ils)) : null;
  return (
    <li>
      <a
        href={e.url} target="_blank" rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 py-3 state-layer rounded-control"
      >
        <span className="min-w-0 space-y-0.5">
          <span className="block text-body-sm text-text-primary truncate" dir="auto">{e.title || e.domain}</span>
          <span className="flex items-center gap-1 text-meta text-text-muted">
            <span dir="ltr">{e.domain}</span>
            <span aria-hidden="true">·</span>
            <span>{copy.kinds[e.kind] ?? copy.kinds.other}{copy.matches[e.match] ? `, ${copy.matches[e.match]}` : ''}</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-label text-text-primary" dir="ltr">{original}</span>
          {converted && <span className="block text-meta text-text-muted" dir="ltr">{converted}</span>}
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
  const exact = (counts.il_used_exact ?? 0) + (counts.intl_used_exact ?? 0);
  const close = (counts.il_used_close ?? 0) + (counts.intl_used_close ?? 0);
  const aside = (counts.not_comparable ?? 0) + (counts.set_aside ?? 0);
  return (
    <Sheet open={open} onClose={onClose} title={priced ? copy.whyTitle : copy.whatFound}>
      <div className="space-y-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
        {priced && <p className="text-body text-text-primary">{copy.how}</p>}

        <div className="space-y-1 text-body-sm text-text-secondary">
          {(counts.resale ?? 0) > 0 && (
            <>
              <p className="text-text-primary">{copy.references(counts.resale)}</p>
              <p>{copy.refSplit(il, intl)}</p>
              <p>{copy.exactSplit(exact, close)}</p>
            </>
          )}
          {v.retail_new_ils && <p>{copy.retailAnchor(formatPrice(v.retail_new_ils))}</p>}
          {priced && v.intl_adjusted === true && <p>{copy.intlAdjusted(v.intl_scale)}</p>}
          {priced && v.intl_adjusted === false && <p>{copy.intlUnadjusted}</p>}
          {priced && v.approximate && <p>{copy.approximateWhy}</p>}
          {priced && <p>{copy.conditionsHow}</p>}
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
