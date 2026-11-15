// ══════════════════════════════════════════════════════════════════════════════
// THE SAME PRODUCT IN OTHER WORDS — the server-side twin of the database's gw_product_base / gw_product_capacity
// (migration 20261115140000). One scan names a controller "sony dualsense", the next "sony dualsense wireless
// controller", another in Hebrew; the research for one is the research for all of them. Colours and descriptive words
// ("controller", "edition", the phrase "wireless controller") do not change what a thing is; "Edge", "Pro", "Disc",
// "Digital", generations, capacities and model codes do. Unlike the database's "was a price seen" check, nothing here is
// a wildcard: an unknown capacity is its own key, so research for a 128 GB phone never answers a phone of unknown size.
// ══════════════════════════════════════════════════════════════════════════════
import { marketKey } from './strategy.js';

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const finals = (s) => s.replace(/[ךםןףץ]/g, (c) => FINALS[c]);
const ALIAS = new Map(Object.entries({
  'אפל': 'apple', 'אייפון': 'iphone', 'איפון': 'iphone', 'אייפד': 'ipad', 'איירפודס': 'airpods', 'מקבוק': 'macbook', 'ווטש': 'watch',
  'סמסונג': 'samsung', 'גלקסי': 'galaxy', 'סוני': 'sony', 'פלייסטיישן': 'playstation', 'דואלסנס': 'dualsense', 'אדג': 'edge',
  'נינטנדו': 'nintendo', 'סוויץ': 'switch', 'סוויצ': 'switch', 'אולד': 'oled', 'קנון': 'canon', 'ניקון': 'nikon', 'לוגיטק': 'logitech',
  'לוגיטך': 'logitech', 'שיאומי': 'xiaomi', 'דייסון': 'dyson', 'וואווי': 'huawei', 'הואווי': 'huawei', 'גוגל': 'google', 'פיקסל': 'pixel',
  'פרו': 'pro', 'מקס': 'max', 'מיני': 'mini', 'פלוס': 'plus', 'אולטרה': 'ultra', 'לייט': 'lite', 'דיגיטל': 'digital', 'דיסק': 'disc',
  'אקס': 'x', 'אייר': 'air',
}).map(([he, en]) => [finals(he), en]));
const DROP = new Set([
  'controller', 'edition', 'standard', 'gaming', 'version', 'model', 'the', 'for', 'with', 'and', 'of', 'new', 'used',
  'black', 'white', 'blue', 'red', 'green', 'silver', 'gold', 'gray', 'grey', 'pink', 'purple', 'yellow', 'orange',
  'midnight', 'starlight', 'graphite', 'space', 'rose', 'cosmic', 'phantom', 'titanium', 'natural', 'color', 'colour',
  'שלט', 'אלחוטי', 'שחור', 'לבנ', 'כחול', 'אדומ', 'ירוק', 'כסופ', 'זהב', 'אפור', 'ורוד', 'סגול', 'צבע', 'חדש', 'משומש',
].map(finals));
const CAPACITY = /^\d+(\.\d+)?(gb|tb|mb)$/;

/** Brand, model, canonical name and variant as one normalised string (gw_identity_text). */
export function identityText(identity) {
  const i = identity ?? {};
  return finals([i.brand, i.model, i.canonical_name, i.variant].filter((v) => v != null && v !== '').join(' ').toLowerCase())
    .replace(/[׳״'"`]/g, '')
    .replace(/\bwireless\s+controller\b/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(גב|גיגה|גיגהבייט)(?=\s|$)/g, '$1gb')
    .replace(/(\d+(?:\.\d+)?)\s*(gb|tb|mb)\b/g, '$1$2')
    .replace(/(\d+)\s*(st|nd|rd|th)\s+(generation|gen)\b/g, 'gen$1')
    .replace(/(?<![\p{L}\p{N}])(generation|gen|דור)\s*(\d+)\b/gu, 'gen$2')
    .replace(/\b(\d+)(st|nd|rd|th)\s*gen\b/g, 'gen$1')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ');
}

/** The product's words, sorted and de-duplicated (gw_product_base); null when nothing names it. */
export function productBase(identity) {
  const words = new Set();
  for (const tok of identityText(identity).split(/\s+/)) {
    if (!tok || CAPACITY.test(tok)) continue;
    const w = ALIAS.get(tok) ?? tok;
    if (!DROP.has(w)) words.add(w);
  }
  return words.size ? [...words].sort().join(' ') : null;
}

/** The stated capacity, else one written in the name (gw_product_capacity); null when unknown. */
export function productCapacity(identity) {
  const stated = String(identity?.size_or_capacity ?? '').toLowerCase().replace(/(\d+(?:\.\d+)?)\s*(gb|tb|mb)/g, '$1$2').replace(/[^\p{L}\p{N}.]+/gu, '');
  if (stated) return stated;
  return identityText(identity).match(/\b(\d+(?:\.\d+)?(?:gb|tb|mb))\b/)?.[1] ?? null;
}

/**
 * The research key that survives wording: marketKey with its name replaced by productBase and its capacity by
 * productCapacity. Everything else marketKey carries (configuration, the owner's answer, confirmed attributes, the model
 * code) is kept exactly. Null when the identity names nothing.
 */
export function productDriftKey(identity, answer = null) {
  const base = productBase(identity);
  if (!base) return null;
  const [, , ...rest] = marketKey(identity, answer).split('|');
  return ['drift', base, productCapacity(identity) ?? '', ...rest].join('|');
}
