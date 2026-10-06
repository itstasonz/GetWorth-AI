// ══════════════════════════════════════════════════════════════════════════════
// THE SCAN SCREEN
//
// One screen for the whole scan, filled in as the answer arrives:
//
//   the photograph
//   → "Analyzing photo…"
//   → the item's name, the moment it is known
//   → "Checking today's market prices…"
//   → the recommended price, the expected range, and how sure each is
//   → one optional question, only when its answer would sharpen the price
//   → the condition, chosen HERE, after the answer — changing it re-prices on
//     the spot from the evidence already gathered, and says when a condition's
//     price is an adjustment rather than something listings showed
//   → Sell
//
// Two confidences, never merged: how sure the scan is of WHAT the item is, and
// how well its PRICE is evidenced. They are judgements, so they are plain text.
//
// State lives in src/lib/coreScan.js. This file only draws it.
// ══════════════════════════════════════════════════════════════════════════════
import React, { useRef, useState, useSyncExternalStore } from 'react';
import { X, Camera, Upload, AlertTriangle, RefreshCw, Check } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Btn, Chip } from '../components/ui';
import { formatPrice } from '../lib/utils';
import {
  scanStore, STAGE, CONDITIONS, bandFor, openQuestion, answerQuestion, dismissQuestion, correctItem, retryScan, setScanCondition,
} from '../lib/coreScan';
import { scanCopy, localColor } from '../lib/scanCopy';
import { WrongItemSheet, WhyPriceSheet, Bidi } from '../components/ScanSheets';

/** A line that says what is happening right now. */
function Working({ children }) {
  return (
    <p className="text-body text-text-secondary flex items-center gap-2" role="status" aria-live="polite">
      <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />{children}
    </p>
  );
}

/** What the item is, as specific as the photograph allowed and no more. */
function Identity({ identity, copy, done, lang }) {
  // A colour is a description and is shown in the screen's language; a brand or model name never is.
  const details = [localColor(identity.color, lang), identity.size_or_capacity].filter(Boolean).join(' · ');
  return (
    <div className="space-y-1">
      {/* The heading follows the screen's direction; a brand or model name inside it keeps its own order. */}
      <h1 className="text-title-lg text-text-primary flex items-start gap-2">
        {done && <Check className="w-5 h-5 mt-1 shrink-0 text-success" aria-hidden="true" />}
        <span><Bidi>{identity.display_name}</Bidi></span>
      </h1>
      {details && <p className="text-body text-text-secondary"><Bidi>{details}</Bidi></p>}
      {identity.uncertainty_note && <p className="text-body-sm text-text-muted"><Bidi>{identity.uncertainty_note}</Bidi></p>}
      <p className="text-body-sm text-text-secondary">
        {copy.identityConfidence}: <span className="font-semibold text-text-primary">{copy.levels[identity.identity_confidence] ?? copy.levels.low}</span>
      </p>
    </div>
  );
}

/** The one question: offered beside a price already given, never in front of it. */
function Question({ question: f, copy, lang, onPhoto, onUpload }) {
  return (
    <div className="rounded-container border border-subtle bg-surface p-4 space-y-3">
      <p className="text-label text-text-muted">{copy.refine}</p>
      <p className="text-title-sm text-text-primary"><Bidi>{f.question}</Bidi></p>
      {f.kind === 'choice' ? (
        <div className="flex flex-wrap gap-2">
          {f.options.map((option, index) => (
            <Chip key={option} onClick={() => answerQuestion(index, lang)}><Bidi>{option}</Bidi></Chip>
          ))}
          <Chip onClick={dismissQuestion}>{copy.notSure}</Chip>
        </div>
      ) : (
        <>
          <Btn fullWidth onClick={onPhoto}><Camera className="w-4 h-4" aria-hidden="true" /> {copy.takePhoto}</Btn>
          <Btn fullWidth onClick={onUpload}><Upload className="w-4 h-4" aria-hidden="true" /> {copy.uploadPhoto}</Btn>
          <Btn variant="ghost" fullWidth onClick={dismissQuestion}>{copy.notSure}</Btn>
        </>
      )}
    </div>
  );
}

/**
 * The condition, chosen by the owner. The scan's own reading is a starting point.
 *
 * Five choices in ONE row of five equal columns, on any phone: a wrapping row
 * left the last choice alone on a second line. Each is a full-height tap target
 * with a short label; the full name is its accessible name.
 */
function ConditionPicker({ condition, identity, copy, adjusted = false }) {
  const seen = CONDITIONS.includes(identity.visible_condition) ? copy.conditions[identity.visible_condition] : null;
  return (
    <div className="space-y-2">
      <p className="text-label text-text-muted" id="scan-condition-label">{copy.conditionLabel}</p>
      <div className="grid grid-cols-5 gap-1" role="group" aria-labelledby="scan-condition-label">
        {CONDITIONS.map((c) => (
          <button
            key={c} type="button" aria-pressed={c === condition} aria-label={copy.conditions[c]} onClick={() => setScanCondition(c)}
            className={[
              'min-h-tap px-1 rounded-control text-label text-center leading-tight state-layer transition-colors duration-quick',
              c === condition ? 'bg-action-primary text-on-action font-semibold' : 'bg-surface-high text-text-secondary border border-subtle font-medium',
            ].join(' ')}
          >
            {copy.conditionShort[c]}
          </button>
        ))}
      </div>
      {seen && <p className="text-body-sm text-text-muted">{copy.appears(seen)}</p>}
      {adjusted && <p className="text-body-sm text-text-muted">{copy.conditionAdjusted}</p>}
    </div>
  );
}

export default function ScanView() {
  const { lang, rtl, addPhoto, cancelPipeline, handleAdditionalFile, sellFromScan, images } = useApp();
  const s = useSyncExternalStore(scanStore.subscribe, scanStore.getSnapshot);
  const copy = scanCopy(lang);
  const fileRef = useRef(null);
  const [sheet, setSheet] = useState(null);   // 'wrong' | 'why' | null

  const close = () => { scanStore.reset(); cancelPipeline(); };
  const identity = s.identity;
  const named = identity && identity.display_name && s.stage !== STAGE.NO_ITEM;
  // IDLE is the instant between the shutter and the scan starting: already "analyzing" to the person.
  const looking = s.stage === STAGE.IDLE || s.stage === STAGE.PREPARING || s.stage === STAGE.IDENTIFYING;
  const band = bandFor(s.valuation, s.condition);
  const settled = s.stage === STAGE.PRICED || s.stage === STAGE.INSUFFICIENT;
  const question = openQuestion(s);
  // A range, not one number, whenever one number would claim too much: the exact model is still an open
  // question that moves the price, or the prices found disagree with each other.
  const approximate = s.valuation?.approximate === true;
  const rough = approximate || s.valuation?.dispersed === true;
  const counts = s.valuation?.counts ?? {};
  const israeli = (counts.il_used_exact ?? 0) + (counts.il_used_close ?? 0);
  const photo = s.images[s.images.length - 1] ?? (s.active ? null : images?.[0]);

  return (
    <div className="fixed inset-0 z-sheet overflow-y-auto bg-canvas" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="max-w-md mx-auto px-gutter pt-4 pb-24 space-y-5">
        <div className="flex justify-end">
          <button type="button" onClick={close} aria-label={copy.close} className="p-2 rounded-full text-text-secondary state-layer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {photo && (
          <div className="rounded-container overflow-hidden bg-surface">
            <img src={photo} alt="" className="w-full max-h-56 object-cover" />
          </div>
        )}

        {looking && <Working>{named ? copy.lookingAgain : copy.analyzing}</Working>}

        {named && !looking && <Identity identity={identity} copy={copy} lang={lang} done={s.stage !== STAGE.ERROR} />}

        {s.stage === STAGE.PRICING && <Working>{copy.pricing}</Working>}

        {s.stage === STAGE.PRICED && band && (
          <div className="space-y-4">
            <div className="space-y-1">
              {rough ? (
                <>
                  <p className="text-label text-text-muted">{copy.approxLabel}</p>
                  <p className="text-display text-text-primary">{copy.range(band)}</p>
                  {approximate && <p className="text-body-sm text-text-secondary">{s.valuation.basis === 'similar_models' ? copy.similarNote : copy.approxNote}</p>}
                </>
              ) : (
                <>
                  <p className="text-label text-text-muted">{copy.recommended}</p>
                  <p className="text-display text-text-primary"><bdi dir="ltr">{formatPrice(band.list)}</bdi></p>
                  <p className="text-body text-text-secondary">
                    {copy.expected}: <span className="text-text-primary">{copy.range(band)}</span>
                  </p>
                </>
              )}
              <p className="text-body-sm text-text-secondary">
                {copy.priceConfidence}: <span className="font-semibold text-text-primary">{copy.levels[s.valuation.price_confidence] ?? copy.levels.low}</span>
              </p>
              {/* Thin evidence is said out loud, beside the price it weakens. */}
              {(counts.resale ?? 0) < 3 && <p className="text-body-sm text-text-muted">{copy.thin(counts.resale ?? 0)}</p>}
              {(counts.resale ?? 0) > 0 && israeli === 0 && <p className="text-body-sm text-text-muted">{copy.abroadOnly}</p>}
              {s.valuation.dispersed && <p className="text-body-sm text-text-muted">{copy.dispersed}</p>}
            </div>
            {/* Every reference is brought to Good condition; any other choice is the ladder applied to that. */}
            <ConditionPicker condition={s.condition} identity={identity} copy={copy} adjusted={s.condition !== 'good'} />
            <Btn primary fullWidth size="lg" onClick={sellFromScan}>{rough ? copy.sellAbout(formatPrice(band.list)) : copy.sellFor(formatPrice(band.list))}</Btn>
          </div>
        )}

        {s.stage === STAGE.INSUFFICIENT && (
          <div className="space-y-4">
            <div className="rounded-container border border-subtle bg-surface p-4 space-y-2">
              <p className="text-body text-text-primary"><Bidi>{copy.insufficient(identity.display_name)}</Bidi></p>
              {s.valuation?.retail_new_ils && (
                <p className="text-body-sm text-text-secondary">{copy.retailContext(formatPrice(s.valuation.retail_new_ils))}</p>
              )}
            </div>
            <ConditionPicker condition={s.condition} identity={identity} copy={copy} />
            <Btn primary fullWidth size="lg" onClick={sellFromScan}>{copy.sellOwnPrice}</Btn>
          </div>
        )}

        {settled && question && (
          <Question
            question={question} copy={copy} lang={lang}
            onPhoto={() => addPhoto('camera')} onUpload={() => fileRef.current?.click()}
          />
        )}

        {settled && (
          <div className="flex items-center justify-between">
            <Btn variant="ghost" onClick={() => setSheet('wrong')}>{copy.wrongItem}</Btn>
            <Btn variant="ghost" onClick={() => setSheet('why')}>{s.stage === STAGE.PRICED ? copy.whyPrice : copy.whatFound}</Btn>
          </div>
        )}

        {s.stage === STAGE.NO_ITEM && (
          <div className="rounded-container border border-subtle bg-surface p-4 space-y-1">
            <p className="text-body text-text-primary">{copy.noItem}</p>
            <p className="text-body-sm text-text-muted">{copy.noItemHint}</p>
          </div>
        )}

        {s.stage === STAGE.ERROR && (
          <div className="rounded-container border border-subtle bg-surface p-4 space-y-3" role="alert">
            <p className="text-body text-text-primary flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 text-danger" aria-hidden="true" />{s.error?.message}
            </p>
            {s.error?.retryable && <Btn primary fullWidth onClick={() => retryScan(lang)}>{copy.retry}</Btn>}
          </div>
        )}

        {(settled || s.stage === STAGE.NO_ITEM || s.stage === STAGE.ERROR) && (
          <Btn fullWidth onClick={close}>{copy.scanAgain}</Btn>
        )}

        <input
          ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleAdditionalFile(f); }}
        />
      </div>

      <WrongItemSheet
        open={sheet === 'wrong'} onClose={() => setSheet(null)} identity={identity} copy={copy} rtl={rtl}
        onSubmit={(text) => { setSheet(null); correctItem(text, lang); }}
      />
      <WhyPriceSheet
        open={sheet === 'why'} onClose={() => setSheet(null)} valuation={s.valuation} copy={copy}
        priced={s.stage === STAGE.PRICED}
      />
    </div>
  );
}
