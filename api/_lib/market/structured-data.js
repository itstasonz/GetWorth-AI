// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURED DATA — schema.org Product / Offer from a page's JSON-LD
//
// For sources GetWorth is PERMITTED to retrieve (sources.js): a page's own
// machine-readable product data is more reliable than reading prices out of
// text. Nothing is inferred: a field the page does not state is null.
//
// No dependency: JSON-LD lives in <script type="application/ld+json"> blocks
// and is parsed as JSON; anything that does not parse is skipped. The extractor
// runs only for a source that may be retrieved — the permission check is part
// of the entry point, not left to the caller.
// ══════════════════════════════════════════════════════════════════════════════
import { assertRetrievable } from './sources.js';

const LD_BLOCK = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const MAX_BLOCKS = 20;
const MAX_BLOCK_CHARS = 200_000;

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null);
const typeIs = (node, t) => [].concat(node?.['@type'] ?? []).some((x) => String(x).toLowerCase() === t.toLowerCase());
const tail = (v) => (v ? String(v).replace(/^https?:\/\/schema\.org\//i, '') : null);

/** Every JSON-LD node on the page, @graph flattened. */
export function jsonLdNodes(html) {
  const out = [];
  let m;
  let n = 0;
  LD_BLOCK.lastIndex = 0;
  while ((m = LD_BLOCK.exec(String(html ?? ''))) && n < MAX_BLOCKS) {
    n += 1;
    const body = m[1].trim().slice(0, MAX_BLOCK_CHARS);
    let data;
    try { data = JSON.parse(body); } catch { try { data = JSON.parse(decode(body)); } catch { continue; } }
    const stack = [].concat(data);
    while (stack.length && out.length < 200) {
      const node = stack.shift();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node['@graph'])) stack.push(...node['@graph']);
      out.push(node);
    }
  }
  return out;
}

const price = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const CONDITION = { NewCondition: 'new_sealed', UsedCondition: 'used', RefurbishedCondition: 'refurbished', DamagedCondition: 'poor' };
const AVAILABILITY = { InStock: 'in_stock', OutOfStock: 'out_of_stock', SoldOut: 'out_of_stock', Discontinued: 'out_of_stock', PreOrder: 'unknown', LimitedAvailability: 'in_stock' };

function offersOf(node) {
  const raw = [].concat(node?.offers ?? []);
  const flat = raw.flatMap((o) => (typeIs(o, 'AggregateOffer') ? [{ ...o, price: o.lowPrice ?? o.price }, ...[].concat(o.offers ?? [])] : [o]));
  return flat.filter((o) => o && typeof o === 'object');
}

/**
 * The products a page states, each with its offers. Fields: name, brand, model, sku, gtin, offers[{ price, currency,
 * condition, availability, seller, valid_from, url }]. Missing means null — never guessed.
 */
export function extractProducts(html) {
  return jsonLdNodes(html).filter((n) => typeIs(n, 'Product') || typeIs(n, 'ProductModel')).slice(0, 50).map((n) => ({
    name: str(n.name),
    brand: str(typeof n.brand === 'object' ? n.brand?.name : n.brand, 80),
    model: str(typeof n.model === 'object' ? n.model?.name : n.model, 80),
    sku: str(n.sku, 60),
    gtin: str(n.gtin13 ?? n.gtin ?? n.gtin12 ?? n.gtin14 ?? n.gtin8, 20),
    description: str(n.description, 300),
    offers: offersOf(n).map((o) => ({
      price: price(o.price),
      currency: str(o.priceCurrency, 3)?.toUpperCase() ?? null,
      condition: CONDITION[tail(o.itemCondition ?? n.itemCondition)] ?? null,
      availability: AVAILABILITY[tail(o.availability)] ?? null,
      seller: str(typeof o.seller === 'object' ? o.seller?.name : o.seller, 80),
      valid_from: str(o.validFrom ?? o.priceValidFrom, 30),
      url: str(o.url, 500),
    })).filter((o) => o.price !== null),
  }));
}

/** The permitted entry point: extracts only from a source a background job may retrieve, and throws otherwise. */
export function extractFromPermittedSource(url, html) {
  const source = assertRetrievable(url);
  return { source_id: source.id, permission: source.permission, products: extractProducts(html) };
}
