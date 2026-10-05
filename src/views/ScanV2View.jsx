// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — THE SCAN SCREEN (test mode)
//
// One screen for the whole V2 scan: what is happening now, what the item is,
// the ONE photograph that is needed when one is, the price with the state it
// was earned under, and a diagnostic panel that can be read off the phone.
//
// THE STATE IS THE CLAIM. The headline above a number is chosen by the server's
// price state and by nothing else on this screen. There is no confidence bar,
// no "strong evidence" caption and no catalog caption to disagree with it, and
// a state with no number shows no number.
//
// NO FAKE PROGRESS. The line under the photograph names the request that is in
// flight. Steps that take milliseconds on the server are not staged as waiting;
// they appear afterwards, in the diagnostics, with the time they really took.
// ══════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { X, Camera, Upload, AlertTriangle, RefreshCw } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Btn } from '../components/ui';
import { formatPrice } from '../lib/utils';
import { scanV2Store, declineFollowupV2, retryPriceV2, V2_STAGE } from '../lib/scanV2';

const BUILD = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'local';

const COPY = {
  en: {
    preparing: 'Preparing photo…',
    identifying: 'Identifying item…',
    found: (name) => `Found ${name}`,
    searching: 'Checking current market…',
    followupTitle: 'One more photo needed',
    followupWhy: 'It could be one of these, and they sell for different amounts:',
    takePhoto: 'Take the photo',
    uploadPhoto: 'Upload a photo',
    noLabel: 'I can’t find it',
    scanAgain: 'Scan another item',
    retry: 'Try again',
    close: 'Close',
    condition: 'Condition',
    // One headline per state the server can produce. The reserved state has
    // none: if it ever arrives, its raw name shows, undressed.
    states: {
      VERIFIED_MARKET_VALUE: 'Verified market value',
      USED_EVIDENCE_ESTIMATE: 'Estimate from verified listings',
      USED_EVIDENCE_BELOW_QUORUM: 'Estimate from a few listings',
      COMPARABLE_MARKET_ESTIMATE: 'Estimate from similar items',
      MARKET_INFORMED_ESTIMATE: 'Market-informed estimate',
      NEED_MORE_INFORMATION: 'More information needed',
      NO_PRICE_EVIDENCE: 'No second-hand price found',
    },
    basis: {
      verified_used_listings: (b) => `Based on ${b.listings} second-hand listings from ${b.sources} independent sources.`,
      verified_comparable_listings: (b) => `Based on ${b.listings} second-hand listings of similar items. This is the market for this kind of item, not for an exact model.`,
      verified_used_listings_range_adjusted: (b) => `Based on ${b.listings} second-hand listings from ${b.sources} source${b.sources === 1 ? '' : 's'}. Our price check adjusted the range, so it is shown as an estimate.`,
      verified_comparable_listings_range_adjusted: (b) => `Based on ${b.listings} second-hand listings of similar items; our price check adjusted the range. This is the market for this kind of item, not for an exact model.`,
      admitted_used_listings_below_quorum: (b) => `Based on ${b.listings} real second-hand listing${b.listings === 1 ? '' : 's'} from ${b.sources} source${b.sources === 1 ? '' : 's'} — too few to verify a market value.`,
      retail_anchor_times_measured_resale_factor: (b) => `Estimated from today's new price at ${b.anchor_shops} shop${b.anchor_shops === 1 ? '' : 's'} and how much second-hand sellers of this kind of item typically ask, measured across ${b.factor?.products ?? 'several'} products${b.listings ? `, blended with ${b.listings} real listing${b.listings === 1 ? '' : 's'}` : ''}. This is an estimate, not a verified market value.`,
    },
    // Why there is no estimate: which of the three things it needs is missing.
    limitations: {
      no_calibrated_resale_factor: 'We found what it costs new, but we have not yet measured how this kind of item resells, so no second-hand estimate is shown.',
      no_retail_anchor: 'No current shop price for this exact product was found, so no estimate could be made.',
      identity_below_product_level: 'The exact product is not established firmly enough for an estimate.',
      estimate_not_below_retail: 'The estimate did not come out below the new price, so it is not shown.', guard_declined_the_market_price: 'Our price check declined the number the listings gave.',
    },
    evidenceState: 'Evidence',
    evidenceStates: { VERIFIED_USED_MARKET: 'verified second-hand market', MARKET_INFORMED_ESTIMATE: 'market-informed estimate', INSUFFICIENT_EVIDENCE: 'insufficient' },
    // The new price is shown BESIDE the value and is never the value.
    retailTitle: 'Price new',
    retailLine: (a) => (a.low === a.high ? formatPrice(a.median) : `${formatPrice(a.low)}–${formatPrice(a.high)}`),
    retailBasis: (a) => `What it costs to buy new in Israel today, from ${a.shops} shop${a.shops === 1 ? '' : 's'}. This is not a second-hand value.`,
    identityConfidence: 'Identification',
    pricingConfidence: 'Second-hand price evidence',
    levels: { VERY_HIGH: 'very high', HIGH: 'high', MODERATE: 'moderate', LOW: 'low', NONE: 'none', BELOW_QUORUM: 'a few listings', COMPARABLE: 'similar items', MARKET_INFORMED: 'estimate from the new price', VERIFIED: 'verified' },
    needMore: 'The exact model could not be established, so no price is shown.',
    noEvidence: 'We identified the item and checked the market, and found no second-hand listings for it that we can rely on.',
    searchFailed: 'The market check did not complete. No price is shown.',
    low: 'Quick sale', recommended: 'Recommended', high: 'Optimistic',
  },
  he: {
    preparing: 'מכין את התמונה…',
    identifying: 'מזהה את הפריט…',
    found: (name) => `נמצא: ${name}`,
    searching: 'בודק את השוק הנוכחי…',
    followupTitle: 'נדרשת תמונה אחת נוספת',
    followupWhy: 'ייתכן שזה אחד מהבאים, והם נמכרים במחירים שונים:',
    takePhoto: 'צלמו את התמונה',
    uploadPhoto: 'העלו תמונה',
    noLabel: 'לא מצאתי',
    scanAgain: 'סריקת פריט נוסף',
    retry: 'נסו שוב',
    close: 'סגירה',
    condition: 'מצב',
    states: {
      VERIFIED_MARKET_VALUE: 'שווי שוק מאומת',
      USED_EVIDENCE_ESTIMATE: 'הערכה ממודעות מאומתות',
      USED_EVIDENCE_BELOW_QUORUM: 'הערכה ממודעות בודדות',
      COMPARABLE_MARKET_ESTIMATE: 'הערכה מפריטים דומים',
      MARKET_INFORMED_ESTIMATE: 'הערכה מבוססת שוק',
      NEED_MORE_INFORMATION: 'נדרש מידע נוסף',
      NO_PRICE_EVIDENCE: 'לא נמצא מחיר יד שנייה',
    },
    basis: {
      verified_used_listings: (b) => `מבוסס על ${b.listings} מודעות יד שנייה מ-${b.sources} מקורות בלתי תלויים.`,
      verified_comparable_listings: (b) => `מבוסס על ${b.listings} מודעות יד שנייה של פריטים דומים. זהו השוק לסוג הפריט, לא לדגם מדויק.`,
      verified_used_listings_range_adjusted: (b) => `מבוסס על ${b.listings} מודעות יד שנייה מ-${b.sources} מקורות. בדיקת המחיר שלנו התאימה את הטווח, ולכן הוא מוצג כהערכה.`,
      verified_comparable_listings_range_adjusted: (b) => `מבוסס על ${b.listings} מודעות יד שנייה של פריטים דומים; בדיקת המחיר שלנו התאימה את הטווח. זהו השוק לסוג הפריט, לא לדגם מדויק.`,
      admitted_used_listings_below_quorum: (b) => `מבוסס על ${b.listings} מודעות יד שנייה אמיתיות מ-${b.sources} מקורות — מעט מדי כדי לאמת שווי שוק.`,
      retail_anchor_times_measured_resale_factor: (b) => `הערכה לפי המחיר כחדש היום ב-${b.anchor_shops === 1 ? 'חנות אחת' : `${b.anchor_shops} חנויות`} ולפי כמה מוכרי יד שנייה של פריטים מסוג זה מבקשים בדרך כלל, כפי שנמדד על ${b.factor?.products ?? 'כמה'} מוצרים${b.listings ? `, בשילוב ${b.listings} מודעות אמיתיות` : ''}. זוהי הערכה, לא שווי שוק מאומת.`,
    },
    limitations: {
      no_calibrated_resale_factor: 'מצאנו כמה זה עולה חדש, אך טרם מדדנו כיצד פריטים מסוג זה נמכרים יד שנייה, ולכן לא מוצגת הערכה.',
      no_retail_anchor: 'לא נמצא מחיר חנות עדכני למוצר המדויק, ולכן לא ניתן היה לבצע הערכה.',
      identity_below_product_level: 'הדגם המדויק לא נקבע בביטחון מספיק לצורך הערכה.',
      estimate_not_below_retail: 'ההערכה לא יצאה נמוכה מהמחיר כחדש, ולכן אינה מוצגת.', guard_declined_the_market_price: 'בדיקת המחיר שלנו דחתה את המספר שהמודעות נתנו.',
    },
    evidenceState: 'ראיות',
    evidenceStates: { VERIFIED_USED_MARKET: 'שוק יד שנייה מאומת', MARKET_INFORMED_ESTIMATE: 'הערכה מבוססת שוק', INSUFFICIENT_EVIDENCE: 'לא מספיקות' },
    retailTitle: 'מחיר כחדש',
    retailLine: (a) => (a.low === a.high ? formatPrice(a.median) : `${formatPrice(a.low)}–${formatPrice(a.high)}`),
    retailBasis: (a) => `כמה עולה לקנות חדש בישראל היום, לפי ${a.shops === 1 ? 'חנות אחת' : `${a.shops} חנויות`}. זה אינו שווי יד שנייה.`,
    identityConfidence: 'זיהוי',
    pricingConfidence: 'ראיות למחיר יד שנייה',
    levels: { VERY_HIGH: 'גבוה מאוד', HIGH: 'גבוה', MODERATE: 'בינוני', LOW: 'נמוך', NONE: 'אין', BELOW_QUORUM: 'מודעות בודדות', COMPARABLE: 'פריטים דומים', MARKET_INFORMED: 'הערכה לפי המחיר כחדש', VERIFIED: 'מאומת' },
    needMore: 'לא ניתן היה לקבוע את הדגם המדויק, ולכן לא מוצג מחיר.',
    noEvidence: 'זיהינו את הפריט ובדקנו את השוק, ולא נמצאו מודעות שאפשר להסתמך עליהן.',
    searchFailed: 'בדיקת השוק לא הושלמה. לא מוצג מחיר.',
    low: 'מכירה מהירה', recommended: 'מומלץ', high: 'אופטימי',
  },
};

const nameOf = (identity) => [identity?.brand?.value, identity?.model?.value].filter(Boolean).join(' ')
  || identity?.local_name || identity?.object_class || '';

const ms = (v) => (typeof v === 'number' ? `${(v / 1000).toFixed(1)}s` : '—');
const kb = (v) => (typeof v === 'number' ? `${(v / 1024).toFixed(1)}KB` : '—');
/** One sentence on where the number came from, or why there is none. For the panel. */
const explain = (v) => {
  if (!v) return null;
  const a = v.retail_anchor;
  const retail = a?.shops ? ` Retail anchor ${a.low}–${a.high} from ${a.shops} shop(s) is reported beside it and is not part of the value.` : ' No retail anchor.';
  const g = v.guard;
  const moved = g?.material_repair ? ` The guard moved ${g.moved.join('/')}: ${g.range_before.low}/${g.range_before.mid}/${g.range_before.high} → ${g.range_after.low}/${g.range_after.mid}/${g.range_after.high}.` : '';
  if (v.state === 'VERIFIED_MARKET_VALUE') return `p25 / median / p85 of ${v.basis.listings} admitted second-hand listings from ${v.basis.sources} sources, condition-adjusted, accepted by the guard with no material repair.${retail}`;
  if (v.state === 'USED_EVIDENCE_ESTIMATE') return `Sufficient exact used evidence (${v.basis.listings} admitted listings, ${v.basis.sources} source(s)); the guard materially adjusted the range, so the numbers are the guard's and the state is not VERIFIED.${moved}${retail}`;
  if (v.state === 'COMPARABLE_MARKET_ESTIMATE') return `${v.basis.listings} verified listings of this KIND of object, not of this product${g?.material_repair ? '; the guard adjusted the range' : ''}.${moved}${retail}`;
  if (v.state === 'USED_EVIDENCE_BELOW_QUORUM') return `min / median / max of ${v.basis.listings} admitted second-hand listing(s) from ${v.basis.sources} source(s), condition-adjusted; below the verification floors.${retail}`;
  if (v.state === 'MARKET_INFORMED_ESTIMATE') return `retail anchor median ${v.basis.anchor_median} × measured resale factor ${v.basis.factor?.median} (p25 ${v.basis.factor?.p25}, p75 ${v.basis.factor?.p75}; group ${v.basis.factor?.group}, ${v.basis.factor?.products} products)${v.basis.listings ? `, blended with ${v.basis.listings} admitted listing(s)` : ''}.${retail}`;
  if (v.state === 'NEED_MORE_INFORMATION') return 'No search was made: the identity cannot carry a product price.';
  return `No second-hand value: ${v.reason ?? 'no admitted listing'}. Nothing is derived from the retail price${v.limitation?.code ? ` (${v.limitation.code}${v.limitation.group ? ` for ${v.limitation.group}` : ''})` : ''}.${retail}`;
};
const yesNo = (v) => (v === true ? 'YES' : (v === false ? 'NO' : '—'));
const tally = (counts) => Object.entries(counts ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} ×${n}`).join(' · ');
const dims = (w, h) => (w === undefined && h === undefined ? 'n/a' : `${w ?? '?'}×${h ?? '?'}`);

/**
 * One pixel verdict, every field it carries, one fact per row.
 *
 * The three thresholds are printed beside the measurements they are compared
 * with, so the screenshot alone says which rule fired and by how much.
 */
function PixelRows({ title, p }) {
  if (!p) return <Row label={title} value="not run" />;
  if (typeof p === 'string') return <Row label={title} value={p} />;
  return (
    <>
      <Row label={`${title} · ok`} value={p.ok ? 'true' : 'FALSE'} />
      <Row label={`${title} · reason`} value={p.reason ?? 'none'} />
      <Row label={`${title} · decoded w×h`} value={dims(p.source_width, p.source_height)} />
      <Row label={`${title} · canvas w×h`} value={dims(p.width, p.height)} />
      <Row label={`${title} · any opaque pixel`} value={p.anyOpaque === undefined ? 'n/a' : (p.anyOpaque ? 'yes' : 'NO (fully transparent)')} />
      <Row label={`${title} · mean luma`} value={p.mean_luma === undefined ? 'n/a' : `${p.mean_luma} (black frame if ≤10 and sd ≤4)`} />
      <Row label={`${title} · std dev`} value={p.std_dev === undefined ? 'n/a' : `${p.std_dev} (uniform frame if ≤1.5)`} />
      <Row label={`${title} · max luma`} value={p.max_luma ?? 'n/a'} />
    </>
  );
}

function Row({ label, value }) {
  return (
    <p className="text-meta text-text-secondary break-words">
      <span className="text-text-muted">{label}: </span>{value === null || value === undefined || value === '' ? '—' : String(value)}
    </p>
  );
}

function Group({ title, children }) {
  return (
    <div className="space-y-0.5">
      <p className="text-meta font-semibold uppercase tracking-widest text-accent">{title}</p>
      {children}
    </div>
  );
}

/** Everything needed to measure a scan, readable on the phone that ran it. */
function Diagnostics({ s }) {
  const id = s.identity;
  const t = s.timings;
  const ev = s.evidence;
  const v = s.valuation;
  const identityMs = t.identity_complete !== undefined && t.identity_request_start !== undefined
    ? t.identity_complete - t.identity_request_start : null;
  const followupMs = t.followup_complete !== undefined && t.followup_request_start !== undefined
    ? t.followup_complete - t.followup_request_start : null;
  const c = s.diag?.client ?? {};
  const sv = s.diag?.server ?? null;
  const mk = ev?.market_identity ?? null;
  const acc = ev?.accounting ?? null;
  const priceMs = t.price_complete !== undefined && t.search_request_start !== undefined
    ? t.price_complete - t.search_request_start : null;
  return (
    <div className="rounded-container border border-subtle bg-surface p-3 space-y-3 font-mono" dir="ltr">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label font-semibold text-text-primary">SCAN ENGINE: V2</p>
        <p className="text-meta text-text-muted">build {BUILD}</p>
      </div>
      {/* The photograph's own journey: capture, conversion, the pixel verdict,
          the request and what the server received. Facts about the image, never
          the image. Shown from the first moment of a scan, so a failure before
          any identity exists can still be read off the phone. */}
      <Group title="Photo">
        <Row label="failure" value={c.failure_code ? `${c.failure_code} @ ${c.failure_stage}${c.failure_detail ? ` — ${c.failure_detail}` : ''}` : 'none'} />
        <Row label="preview" value={c.preview_present === undefined ? null : (c.preview_present ? 'present' : 'MISSING')} />
        <Row label="SOURCE type" value={c.capture_present === undefined ? null : `${c.capture_present ? c.capture_type : 'MISSING'} · ${c.capture_mime ?? 'no mime'}`} />
        <Row label="SOURCE base64 length" value={c.capture_base64_length} />
        <Row label="SOURCE bytes (approx)" value={c.capture_bytes === undefined ? null : `${c.capture_bytes} (${kb(c.capture_bytes)})`} />
        <Row label="COMPRESSED type" value={c.compression_completed ? `${c.compressed_type ?? 'none'} · ${c.compressed_mime ?? 'no mime'}${c.compression_skipped ? ' (conversion skipped: source already small)' : ''}` : null} />
        <Row label="COMPRESSED base64 length" value={c.compressed_base64_length} />
        <Row label="COMPRESSED bytes (approx)" value={c.compressed_bytes === null || c.compressed_bytes === undefined ? null : `${c.compressed_bytes} (${kb(c.compressed_bytes)})`} />
        <PixelRows title="SENT" p={c.pixel_check} />
        <PixelRows title="CAPTURED" p={c.raw_pixel_check} />
        <Row label="assessment threw" value={c.assessment_threw ?? (c.assessment_started ? 'no' : null)} />
        <Row label="captured-image assessment threw" value={c.raw_assessment_threw} />
        <Row label="PIPELINE compression started" value={yesNo(c.compression_started)} />
        <Row label="PIPELINE compression completed" value={c.compression_started === undefined ? '—' : `${yesNo(c.compression_completed)}${c.compression_completed ? (c.compression_succeeded ? ' (usable image)' : ' (NO usable image)') : ''}`} />
        <Row label="PIPELINE assessment started" value={yesNo(c.assessment_started)} />
        <Row label="PIPELINE assessment completed" value={yesNo(c.assessment_completed)} />
        <Row label="PIPELINE request started" value={yesNo(c.request_started)} />
        <Row label="PIPELINE /api/v2/identify called" value={c.request_started === undefined ? '—' : `${yesNo(c.request_started)}${c.request_started ? ` · ${kb(c.request_payload_bytes)} · HTTP ${c.identify_http_status ?? 'no response'} · ${ms(c.identify_roundtrip_ms)}` : ''}`} />
        <Row label="server received" value={sv ? `${sv.content_type ?? 'no content-type'} · image ${sv.image_field_present ? 'present' : `MISSING (${sv.image_field_type})`} · ${sv.image_mime ?? 'unknown mime'} · ${kb(sv.image_bytes)} · parse ${sv.parse_success ? 'ok' : 'FAILED'}` : null} />
        <Row label="server provider call" value={sv ? `${sv.provider_request_started ? 'started' : 'not started'} · ${sv.provider_request_succeeded ? 'succeeded' : 'not succeeded'}${sv.failure_code ? ` · ${sv.failure_code} @ ${sv.failure_stage}` : ''}` : null} />
        <Row label="device" value={typeof navigator !== 'undefined' ? String(navigator.userAgent).replace(/^Mozilla\/5\.0 /, '').slice(0, 90) : null} />
      </Group>
      <Group title="Identity">
        <Row label="server time" value={`${ms(s.server.identify?.identity_complete_ms)} · first event ${ms(s.server.identify?.identity_first_event_ms)}`} />
        <Row label="round-trip time" value={ms(identityMs)} />
        {s.server.followup && <Row label="follow-up server / round trip" value={`${ms(s.server.followup.identity_complete_ms)} / ${ms(followupMs)}`} />}
        <Row label="brand" value={id?.brand?.value && `${id.brand.value} (${id.brand.confidence} raw · ${id.brand.calibrated_confidence ?? '—'} calibrated, ${id.brand.evidence})`} />
        <Row label="model" value={id?.model?.value && `${id.model.value} (${id.model.confidence} raw · ${id.model.calibrated_confidence ?? '—'} calibrated, ${id.model.evidence})`} />
        <Row label="model number (read)" value={id?.model_number?.value && `${id.model_number.value} (${id.model_number.evidence})`} />
        <Row label="configuration (photo)" value={id?.configuration} />
        <Row label="candidates" value={(id?.ranked_candidates ?? []).map((c) => `${c.model} ${c.confidence}`).join(' · ')} />
        <Row label="visible text" value={(id?.visible_text_roles ?? []).map((t) => `${t.text} [${t.role}]`).join(' | ') || (id?.visible_text ?? []).join(' | ')} />
        <Row label="condition" value={id?.condition?.grade} />
        <Row label="decision" value={s.sufficiency && `${s.sufficiency.decision} · ${s.sufficiency.level} · ${(s.sufficiency.reasons ?? []).join(', ')}`} />
        <Row label="follow-ups used" value={s.followupsUsed} />
      </Group>
      <Group title="Search">
        <Row label="server time" value={`${ms(s.server.price?.total_ms)} · results at ${ms(s.search?.timings?.results_available_ms)}`} />
        <Row label="round-trip time" value={ms(priceMs)} />
        <Row label="outcome" value={s.search && `${s.search.outcome}${s.search.failure ? ` (${s.search.failure})` : ''}${s.search.stopped_at_results ? ' · stopped at results' : ''}`} />
        <Row label="planned queries" value={(s.search?.planned_queries ?? []).map((q) => q.text).join(' | ')} />
        <Row label="executed queries" value={(s.search?.executed_queries ?? []).join(' | ')} />
        <Row label="search actions" value={s.search?.search_actions} />
        <Row label="aliases proposed" value={mk ? [...(mk.proposed?.model_numbers ?? []), ...(mk.proposed?.aliases ?? [])].join(' | ') || 'none' : null} />
        <Row label="aliases corroborated" value={mk ? (mk.corroborated ?? []).join(' | ') || 'none' : null} />
        <Row label="results" value={s.search?.results} />
        <Row label="domains" value={(s.search?.domains ?? []).join(', ')} />
      </Group>
      <Group title="Market identity">
        <Row label="read off item" value={mk?.visible_name} />
        <Row label="exact match tokens" value={mk ? (mk.exact_tokens ?? []).join(' | ') || 'none beyond the name' : null} />
        {(mk?.aliases ?? []).map((a) => (
          <Row key={`${a.kind}|${a.value}`} label={`${a.relation}${a.weak ? ' (weak)' : ''}`} value={`${a.value} · ${a.sites_seen} site(s)${a.evidence?.length ? ` · ${a.evidence.join(', ')}` : ''}${a.tied_to?.length ? ` · tied to ${a.tied_to.join(', ')}` : ''}${a.kind === 'name' ? ` · beside the read name on ${a.seen_beside_read_name ?? 0}, as a fragment on ${a.seen_as_fragment ?? 0}` : ''}${a.also_used_for?.length ? ` · also used for ${a.also_used_for.join(', ')}` : ''}${a.short_form_of ? ` · short form of ${a.short_form_of}` : ''}`} />
        ))}
      </Group>
      <Group title="Extraction">
        <Row label="results inspected" value={acc?.total} />
        <Row label="duplicates" value={acc?.buckets?.DUPLICATE} />
        <Row label="no price data" value={acc?.buckets?.NO_PRICE_DATA} />
        <Row label="price candidates" value={acc?.price_candidates} />
        <Row label="refused at extraction (results)" value={acc?.buckets?.REFUSED_AT_EXTRACTION} />
        <Row label="qualifier rejected (results)" value={acc?.buckets?.QUALIFIER_REJECTED} />
        <Row label="admitted (results)" value={acc?.buckets?.ADMITTED} />
        <Row label="counts reconcile" value={acc ? (acc.reconciles ? 'yes' : 'NO') : null} />
        <Row label="observations extracted" value={ev?.counts?.extracted} />
        <Row label="numbers refused" value={ev?.counts?.refused_at_extraction} />
        <Row label="extraction reasons" value={Object.entries(ev?.extraction_reasons ?? {}).map(([reason, n]) => `${reason} ×${n}`).join(' · ')} />
        <Row label="unmarked prices seen" value={ev?.counts?.unmarked_prices} />
      </Group>
      <Group title="Evidence">
        <Row label="local used" value={ev?.counts?.by_class?.LOCAL_USED} />
        <Row label="international used" value={ev?.counts?.by_class?.FOREIGN_USED} />
        <Row label="local retail" value={ev?.counts?.by_class?.LOCAL_RETAIL} />
        <Row label="international retail" value={ev?.counts?.by_class?.FOREIGN_RETAIL} />
        <Row label="other" value={ev?.counts?.by_class?.OTHER} />
        <Row label="exact-model" value={ev?.counts?.by_relation?.EXACT} />
        <Row label="regional variant" value={ev?.counts?.by_relation?.REGIONAL_VARIANT} />
        <Row label="sibling" value={ev?.counts?.by_relation?.SIBLING} />
        <Row label="family-level" value={ev?.counts?.by_relation?.FAMILY} />
        <Row label="other product's number" value={ev?.counts?.by_relation?.OTHER_PRODUCT} />
        <Row label="tiers" value={tally(ev?.counts?.by_tier)} />
        <Row label="configurations" value={`${tally(ev?.counts?.by_configuration)} · excluded ${ev?.counts?.configuration_excluded ?? '—'}`} />
        <Row label="source types" value={tally(ev?.counts?.by_source_type)} />
        <Row label="prices with inferred currency" value={ev?.counts?.locale_inferred_prices} />
        <Row label="duplicates removed" value={ev?.counts?.duplicates_removed} />
        <Row label="distinct sources" value={ev?.distinct_sources} />
        <Row label="qualified under" value={(ev?.qualification_runs ?? []).map((r) => `${r.form}: ${r.admitted}${r.granting ? ' (speaks)' : ''}`).join(' · ')} />
        <Row label="admitted" value={ev?.counts?.admitted} />
        <Row label="rejected" value={ev?.counts?.rejected} />
        <Row label="used listings" value={ev?.counts?.used_listings} />
        <Row label="retail listings" value={ev?.counts?.retail_listings} />
        <Row label="currency failures" value={ev?.counts?.currency_failures} />
        <Row label="identity failures" value={ev?.counts?.identity_failures} />
        <Row label="refused at extraction" value={ev?.counts?.refused_at_extraction} />
        <Row label="rejection reasons" value={Object.entries(ev?.rejection_reasons ?? {}).map(([reason, n]) => `${reason} ×${n}`).join(' · ')} />
        <Row label="set failures" value={(ev?.set_failures ?? []).join(', ')} />
        <Row label="extract / qualify" value={ev?.timings && `${ev.timings.extraction_ms}ms / ${ev.timings.qualification_ms}ms`} />
        {[...(ev?.admitted ?? []), ...(ev?.retail ?? [])].map((a) => (
          <Row key={`${a.url}|${a.price}`} label={`${a.outcome} · ${a.domain}`} value={`${a.price} ${a.currency}${a.delivery_fee ? ` (stated ${a.stated_price}, less ${a.delivery_fee} delivery)` : ''} · ${a.relation} · ${a.title}`} />
        ))}
      </Group>
      <Group title="Valuation">
        <Row label="state" value={v?.state} />
        <Row label="evidence state" value={v?.evidence_state} />
        <Row label="limitation" value={v?.limitation ? `${v.limitation.code}${v.limitation.group ? ` · ${v.limitation.group}` : ''}` : 'none'} />
        <Row label="low" value={v?.low} />
        <Row label="recommended" value={v?.recommended} />
        <Row label="high" value={v?.high} />
        <Row label="evidence basis" value={v?.basis && `${v.basis.kind} · ${v.basis.listings} listing(s) · ${v.basis.sources} source(s)`} />
        <Row label="guard" value={v?.guard && `${v.guard.action}${v.guard.material_repair ? ` · MATERIAL repair of ${v.guard.moved.join('/')}` : ' · no material repair'}${v.guard.violations?.length ? ` · ${v.guard.violations.map((x) => x.rule ?? x).join(', ')}` : ''}`} />
        <Row label="identity confidence" value={v?.confidence?.identity && `${v.confidence.identity.level} · brand ${v.confidence.identity.brand} · model ${v.confidence.identity.model}${v.confidence.identity.model_read_off_item ? ' · read off item' : ''}`} />
        <Row label="used-market evidence" value={v?.confidence?.pricing?.used_market} />
        <Row label="retail anchor" value={v?.retail_anchor && `${v.retail_anchor.strength} · ${v.retail_anchor.shops} shop(s)${v.retail_anchor.shops ? ` · ${v.retail_anchor.low}–${v.retail_anchor.high} ${v.retail_anchor.currency}` : ''}`} />
        <Row label="how it was calculated" value={explain(v)} />
        <Row label="reason" value={v?.reason} />
      </Group>
      <Group title="Total">
        <Row label="photo accepted → result / follow-up" value={ms(t.result_rendered)} />
        <Row label="compression" value={ms(t.compression_complete)} />
        <Row label="identity shown at" value={ms(t.sufficiency_decision)} />
        <Row label="AI calls" value={`${s.calls.identity} identity · ${s.calls.search} search`} />
      </Group>
    </div>
  );
}

export default function ScanV2View() {
  const { lang, rtl, addPhoto, cancelPipeline, handleAdditionalFile, getFreshToken } = useApp();
  const s = useSyncExternalStore(scanV2Store.subscribe, scanV2Store.getSnapshot);
  const c = COPY[lang === 'he' ? 'he' : 'en'];
  const fileRef = useRef(null);

  const working = s.stage === V2_STAGE.PREPARING || s.stage === V2_STAGE.IDENTIFYING || s.stage === V2_STAGE.SEARCHING;
  const name = nameOf(s.identity);
  const v = s.valuation;

  // "Displayed" is when the answer is on screen, not when the response arrived.
  useEffect(() => {
    if (s.stage === V2_STAGE.DONE || s.stage === V2_STAGE.NEED_FOLLOWUP) scanV2Store.mark('result_rendered');
  }, [s.stage]);

  const stageLine = s.stage === V2_STAGE.PREPARING ? c.preparing
    : s.stage === V2_STAGE.IDENTIFYING ? c.identifying
      : s.stage === V2_STAGE.SEARCHING ? c.searching : null;

  const close = () => { scanV2Store.reset(); cancelPipeline(); };
  const priced = v && typeof v.recommended === 'number' && v.recommended > 0;
  const basisText = v?.basis && c.basis[v.basis.kind] ? c.basis[v.basis.kind](v.basis) : null;
  const unpricedText = v?.state === 'NEED_MORE_INFORMATION' ? c.needMore
    : (v?.state === 'NO_PRICE_EVIDENCE' ? (String(v.reason ?? '').startsWith('search_') ? c.searchFailed : c.noEvidence) : null);
  // What the estimate is waiting for, in the user's words. Only when there is no number.
  const limitationText = !priced && v?.limitation?.code && c.limitations[v.limitation.code] ? c.limitations[v.limitation.code] : null;

  return (
    <div className="fixed inset-0 z-sheet overflow-y-auto bg-canvas" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="max-w-md mx-auto px-4 pt-4 pb-24 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-meta text-text-muted">V2</p>
          <button type="button" onClick={close} aria-label={c.close} className="p-2 rounded-full text-text-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {s.image && (
          <div className="rounded-container overflow-hidden bg-surface">
            <img src={s.followupImage || s.image} alt="" className="w-full max-h-64 object-cover" />
          </div>
        )}

        {/* What is happening now — the request that is in flight. */}
        {working && (
          <div className="space-y-1" role="status" aria-live="polite">
            {name && s.stage === V2_STAGE.SEARCHING && <p className="text-title text-text-primary">{c.found(name)}</p>}
            <p className="text-body text-text-secondary flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />{stageLine}
            </p>
          </div>
        )}

        {/* What the item is, as soon as it is known. */}
        {!working && name && (
          <div className="space-y-1">
            <p className="text-title-lg text-text-primary">{name}</p>
            {s.identity?.condition?.grade && s.identity.condition.grade !== 'Unknown' && (
              <p className="text-body-sm text-text-muted">{c.condition}: {s.identity.condition.grade}</p>
            )}
          </div>
        )}

        {/* The one photograph, asked for the moment it is known to be needed. */}
        {s.stage === V2_STAGE.NEED_FOLLOWUP && (
          <div className="rounded-container border border-subtle bg-surface p-4 space-y-3">
            <p className="text-title text-text-primary">{c.followupTitle}</p>
            <p className="text-body text-text-primary">{s.sufficiency?.followup?.instruction}</p>
            {(s.identity?.ranked_candidates ?? []).length > 1 && (
              <div className="space-y-1">
                <p className="text-body-sm text-text-muted">{c.followupWhy}</p>
                <ul className="text-body-sm text-text-secondary list-disc ps-5">
                  {s.identity.ranked_candidates.map((cand) => <li key={cand.model}>{[cand.brand, cand.model].filter(Boolean).join(' ')}</li>)}
                </ul>
              </div>
            )}
            <Btn primary fullWidth onClick={() => addPhoto('camera')}>
              <Camera className="w-4 h-4" aria-hidden="true" /> {c.takePhoto}
            </Btn>
            <Btn fullWidth onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" aria-hidden="true" /> {c.uploadPhoto}
            </Btn>
            <input
              ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleAdditionalFile(f); }}
            />
            <Btn variant="ghost" fullWidth onClick={declineFollowupV2}>{c.noLabel}</Btn>
          </div>
        )}

        {/* The price, under the state it earned. */}
        {s.stage === V2_STAGE.DONE && v && (
          <div className="rounded-container border border-subtle bg-surface p-4 space-y-2">
            <p className="text-label font-semibold uppercase tracking-widest text-accent">{c.states[v.state] ?? v.state}</p>
            {priced ? (
              <>
                <p className="text-display text-text-primary">{formatPrice(v.recommended)}</p>
                <div className="flex justify-between text-body-sm text-text-secondary">
                  <span>{c.low}: {formatPrice(v.low)}</span>
                  <span>{c.high}: {formatPrice(v.high)}</span>
                </div>
                {basisText && <p className="text-body-sm text-text-muted">{basisText}</p>}
              </>
            ) : (
              <>
                <p className="text-body text-text-secondary">{unpricedText}</p>
                {limitationText && <p className="text-body-sm text-text-muted">{limitationText}</p>}
              </>
            )}
          </div>
        )}

        {/* What it costs new — context beside the value, never the value. */}
        {s.stage === V2_STAGE.DONE && v?.retail_anchor?.shops > 0 && (
          <div className="rounded-container border border-subtle bg-surface p-4 space-y-1">
            <p className="text-label font-semibold uppercase tracking-widest text-text-muted">{c.retailTitle}</p>
            <p className="text-price text-text-primary">{c.retailLine(v.retail_anchor)}</p>
            <p className="text-body-sm text-text-muted">{c.retailBasis(v.retail_anchor)}</p>
          </div>
        )}

        {/* Two separate answers: how sure we are what it is, and how well its price is evidenced. */}
        {s.stage === V2_STAGE.DONE && v?.confidence && (
          <div className="text-body-sm text-text-secondary space-y-0.5">
            <p>{c.identityConfidence}: {c.levels[v.confidence.identity.level] ?? v.confidence.identity.level}</p>
            <p>{c.pricingConfidence}: {c.levels[v.confidence.pricing.used_market] ?? v.confidence.pricing.used_market}</p>
            {v.evidence_state && <p>{c.evidenceState}: {c.evidenceStates[v.evidence_state] ?? v.evidence_state}</p>}
          </div>
        )}

        {s.stage === V2_STAGE.ERROR && (
          <div className="rounded-container border border-subtle bg-surface p-4 space-y-3" role="alert">
            <p className="text-body text-text-primary flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" aria-hidden="true" />{s.error?.message}
            </p>
            {s.error?.code && <p className="text-meta text-text-muted font-mono" dir="ltr">{s.error.code} @ {s.error.stage}</p>}
            {s.stateToken && s.sufficiency?.decision === 'SEARCH_NOW' && (
              <Btn primary fullWidth onClick={() => retryPriceV2({ lang, getToken: getFreshToken })}>{c.retry}</Btn>
            )}
          </div>
        )}

        {(s.stage === V2_STAGE.DONE || s.stage === V2_STAGE.ERROR) && (
          <Btn fullWidth onClick={close}>{c.scanAgain}</Btn>
        )}

        {s.active && <Diagnostics s={s} />}
      </div>
    </div>
  );
}
