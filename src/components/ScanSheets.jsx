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
 * The whole row is the link. A title may be Hebrew with a model name in it, or
 * long: it wraps to two lines and is never clipped mid-word; the price column
 * keeps its width. When the source was not used, one short line says why.
 */
function Source({ e, copy }) {
  const original = e.currency === 'ILS' ? formatPrice(e.price) : `${e.price.toLocaleString()} ${e.currency}`;
  const converted = e.currency !== 'ILS' && e.price_ils ? copy.approx(formatPrice(e.price_ils)) : null;
  // What the listing charges to send it, when the page said: shown beside the price it is not part of.
  const shipping = e.shipping ? copy.shipping(e.currency === 'ILS' ? formatPrice(e.shipping) : `${e.shipping.toLocaleString()} ${e.currency}`) : null;
  const facts = [
    copy.kinds[e.kind] ?? copy.kinds.other,
    copy.matches[e.match] ?? null,
    copy.places[e.market] ?? null,
    copy.freshness[e.freshness] ?? null,
  ].filter(Boolean).join(' · ');
  const why = !e.used && e.set_aside ? copy.why[e.set_aside] ?? null : null;
  return (
    <li>
      <a
        href={e.url} target="_blank" rel="noopener noreferrer"
        className="flex items-start justify-between gap-3 py-3 state-layer rounded-control"
      >
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-body-sm text-text-primary line-clamp-2 break-words"><Bidi>{e.title || e.domain}</Bidi></span>
          <span className="block text-meta text-text-muted">{facts}</span>
          {why && <span className="block text-meta text-text-secondary">{why}</span>}
          <span className="flex items-center gap-1 text-meta text-text-muted">
            <bdi dir="ltr">{e.domain}</bdi>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </span>
        </span>
        <span className="shrink-0 text-end whitespace-nowrap">
          <bdi dir="ltr" className="block text-label text-text-primary">{original}</bdi>
          {converted && <bdi dir="ltr" className="block text-meta text-text-muted">{converted}</bdi>}
          {shipping && <span className="block text-meta text-text-muted"><Bidi>{shipping}</Bidi></span>}
        </span>
      </a>
    </li>
  );
}

// WHICH GROUP A FOUND PRICE BELONGS TO. Three, and a price is in exactly one:
//   used       it took part in the price
//   context    it was verified and is shown for what it is, but a price is not read from it: the new price, a
//              listing abroad or an old or sealed Israeli one when no current Israeli listing stands, a shop's
//              refurbished unit with no private listing beside it, a price from abroad Israel made unnecessary
//   rejected   not this product (another model, an accessory, a part), above the new price, far out of line, or
//              a price the page did not tie to the product
const CONTEXT = new Set(['abroad_without_israeli_reference', 'israeli_listing_old_or_sealed', 'retail_refurbished_without_private_resale', 'local_evidence_sufficient']);
const isAnchor = (e) => e.kind === 'new_retail' && !e.set_aside && (e.match === 'exact' || e.match === 'close_comparable');
export function groupEvidence(evidence) {
  const groups = { used: [], context: [], rejected: [] };
  for (const e of Array.isArray(evidence) ? evidence : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.used) groups.used.push(e);
    else if (isAnchor(e) || CONTEXT.has(e.set_aside)) groups.context.push(e);
    else if (e.set_aside) groups.rejected.push(e);
  }
  return groups;
}

function Group({ title, items, copy, open = true }) {
  if (items.length === 0) return null;
  const list = <ul className="divide-y divide-subtle">{items.map((e) => <Source key={`${e.url}|${e.price}`} e={e} copy={copy} />)}</ul>;
  if (open) {
    return (
      <div className="space-y-1">
        <p className="text-label text-text-muted">{title} · {items.length}</p>
        {list}
      </div>
    );
  }
  // Rejected results are counted and kept behind one tap: what was NOT this product is detail, not the answer.
  return (
    <details className="space-y-1">
      <summary className="text-label text-text-muted cursor-pointer state-layer rounded-control py-1">{title} · {items.length}</summary>
      {list}
    </details>
  );
}

/**
 * "Why this price?" / "What I found". The answer first, in two or three lines;
 * then the sources in three groups — used, context, rejected — each labelled
 * for what it is; how the price was worked out last, behind one tap.
 */
export function WhyPriceSheet({ open, onClose, valuation, copy, priced }) {
  const v = valuation ?? {};
  const counts = v.counts ?? {};
  const evidence = Array.isArray(v.evidence) ? v.evidence : [];
  const groups = groupEvidence(evidence);
  // A shop's refurbished offers that were used are support, not second-hand listings: counted apart from them.
  const refurbishedUsed = counts.refurbished_used ?? evidence.filter((e) => e.used && e.kind === 'refurbished').length;
  const privateUsed = Math.max(0, (counts.resale ?? 0) - refurbishedUsed);
  const il = (counts.il_used_exact ?? 0) + (counts.il_used_close ?? 0) - evidence.filter((e) => e.used && e.kind === 'refurbished' && e.market === 'IL').length;
  const intl = (counts.intl_used_exact ?? 0) + (counts.intl_used_close ?? 0) - evidence.filter((e) => e.used && e.kind === 'refurbished' && e.market !== 'IL').length;
  // Why each found price was not used, one line per reason. Unbound prices and prices from abroad left unused have their own lines.
  const reasons = {};
  for (const e of evidence) {
    if (e.set_aside && e.set_aside !== 'local_evidence_sufficient' && e.set_aside !== 'price_not_tied_to_product') reasons[e.set_aside] = (reasons[e.set_aside] ?? 0) + 1;
  }
  const explained = Object.entries(reasons).filter(([reason]) => copy.aside?.[reason]);
  const unexplained = Object.entries(reasons).filter(([reason]) => !copy.aside?.[reason]).reduce((sum, [, n]) => sum + n, 0);
  const older = evidence.filter((e) => e.used && (e.freshness === 'older' || e.freshness === 'archived')).length;
  const range = v.reference_range;
  const nothing = groups.used.length + groups.context.length + groups.rejected.length === 0;
  return (
    <Sheet open={open} onClose={onClose} title={priced ? copy.whyTitle : copy.whatFound}>
      <div className="space-y-4 overflow-y-auto" style={{ maxHeight: '62vh' }}>
        {/* THE ANSWER, SHORT. */}
        <div className="space-y-1 text-body text-text-primary">
          <p className="font-semibold">{copy.found(priced ? privateUsed : 0)}</p>
          {priced && privateUsed > 0 && (
            <p className="text-body-sm text-text-secondary">{copy.fromIsrael(Math.max(0, il))} · {copy.fromAbroad(Math.max(0, intl))}</p>
          )}
          {priced && refurbishedUsed > 0 && <p className="text-body-sm text-text-secondary">{copy.refurbishedSupport(refurbishedUsed)}</p>}
          {priced && range && <p>{copy.relevantRange}: {copy.range(range)}</p>}
          {priced && <p>{copy.confidenceLine}: {copy.levels[v.price_confidence] ?? copy.levels.low}</p>}
          {!priced && v.no_price_reason && copy.noPriceWhy?.[v.no_price_reason] && <p className="text-body-sm text-text-secondary">{copy.noPriceWhy[v.no_price_reason]}</p>}
          {v.retail_new_ils && (
            <p>{copy.newInIsrael}: <bdi dir="ltr">{formatPrice(v.retail_new_ils)}</bdi>{v.retail_new_in_stock === false ? ` ${copy.outOfStock}` : ''}</p>
          )}
          {v.retail_new_range?.dispersed && <p className="text-body-sm text-text-secondary">{copy.retailDisagree(formatPrice(v.retail_new_range.low), formatPrice(v.retail_new_range.high))}</p>}
        </div>

        {/* THE SOURCES, IN THREE GROUPS. */}
        {nothing
          ? <p className="text-body-sm text-text-secondary">{copy.noSources}</p>
          : (
            <div className="space-y-4">
              <Group title={copy.groupUsed} items={groups.used} copy={copy} />
              <Group title={copy.groupContext} items={groups.context} copy={copy} />
              <Group title={copy.groupRejected} items={groups.rejected} copy={copy} open={false} />
            </div>
          )}

        {/* HOW, BEHIND ONE TAP. */}
        <details>
          <summary className="text-label text-text-muted cursor-pointer state-layer rounded-control py-1">{copy.details}</summary>
          <div className="space-y-1 pt-2 text-body-sm text-text-secondary">
            {priced && v.approximate && <p>{v.basis === 'similar_items' ? copy.similarItemsWhy : copy.approximateWhy}</p>}
            {priced && v.dispersed && <p>{copy.dispersedWhy}</p>}
            {priced && v.intl_adjusted === true && <p>{copy.intlAdjusted(v.intl_scale)}</p>}
            {priced && v.intl_adjusted === false && <p>{copy.intlUnadjusted}</p>}
            {priced && intl > 0 && <p>{copy.abroadNoShipping}</p>}
            {(counts.unbound ?? 0) > 0 && <p>{copy.unbound(counts.unbound)}</p>}
            {(counts.abroad_unused ?? 0) > 0 && <p>{copy.abroadUnused(counts.abroad_unused)}</p>}
            {explained.map(([reason, n]) => <p key={reason}>{copy.aside[reason](n)}</p>)}
            {unexplained > 0 && <p>{copy.setAside(unexplained)}</p>}
            {older > 0 && <p>{copy.olderUsed(older)}</p>}
            {priced && <p>{copy.how}</p>}
            {priced && <p>{copy.conditionsHow}</p>}
            {v.searched?.date && <p>{copy.searchedOn(v.searched.date)}</p>}
          </div>
        </details>
      </div>
    </Sheet>
  );
}
