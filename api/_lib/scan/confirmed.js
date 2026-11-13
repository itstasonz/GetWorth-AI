// ══════════════════════════════════════════════════════════════════════════════
// CORE SCAN — WHAT THE OWNER CONFIRMED, WRITTEN OVER WHAT THE MODEL GUESSED
//
// The owner's answers (identify.js recordAnswer) are the server's own record.
// On every later look at the identity they are applied here: an attribute the
// model named in its own words is settled by the owner's answer to the same
// attribute, the core field it maps to is set, and the model's note about not
// knowing it comes down — only that note, and only when nothing else in it is
// still open. Nothing here reads a photograph or a model: it is the owner's
// word against the model's guesses, and the owner's word is kept as the
// OWNER's (basis "confirmed", never "observed").
// ══════════════════════════════════════════════════════════════════════════════
import { MAX_ATTRIBUTES } from './identity-prompt.js';

const tokens = (v) => String(v ?? '').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The attribute names that name no attribute: the one question of the earlier contract, and a question with no name. */
export const ASKED_ATTRIBUTE = /^(followup|detail)$/;

// Core fields a confirmed attribute may settle, by the names the model is asked to use.
const CORE_FIELDS = { model: 'model', model_number: 'model_number', variant: 'variant', storage: 'size_or_capacity', capacity: 'size_or_capacity', size: 'size_or_capacity', 'bottle size': 'size_or_capacity', volume: 'size_or_capacity', color: 'color', colour: 'color' };
// The model names an attribute in its own words on every look: "remaining" one round, "remaining volume" the next. The
// owner's answer settles both. Only these qualifiers are read as the same attribute: "model" is never "model number".
const QUALIFIERS = /^(volume|capacity|amount|level|left|remaining|size)$/;
export const sameAttribute = (a, b) => {
  const x = tokens(a); const y = tokens(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return long.length === short.length + 1 && short.every((t, k) => t === long[k]) && QUALIFIERS.test(long.at(-1));
};
/** The core field an attribute settles, by its name or by the same name with one qualifier ("storage capacity" is "storage"). */
export const fieldOf = (name) => CORE_FIELDS[name] ?? Object.entries(CORE_FIELDS).find(([k]) => sameAttribute(k, name))?.[1] ?? null;

// ── THE NOTE ABOUT THE UNKNOWN ──────────────────────────────────────────────
// The model writes one short note naming what it could not establish: "storage and colour unknown", "model number
// not legible". The owner's answer takes the note down only when the note is about THAT attribute and about nothing
// else still open. Whole words, never substrings (an "age" confirmed is not "storage"), and what else is open is read
// from the identity's own attribute state — the attributes the model listed and the core fields — never guessed from
// the prose: a note that names a colour that is still unknown stays, whatever else it names. Hebrew notes are kept,
// not parsed: the model names attributes in English, so a Hebrew note names none of them and comes down only for the
// fragrance's "remaining", whose Hebrew stems are matched (prefixes make whole Hebrew words unreliable).
const REMAINING_TOKENS = /^(remaining|remains|fill|quantity|amount|level)$/;
const REMAINING_HE = /(נשאר|נותר|כמות)/u;
const mentions = (words, run) => run.length > 0 && words.some((_, k) => run.every((t, j) => words[k + j] === t));
const namesRemaining = (words) => words.some((t) => REMAINING_TOKENS.test(t) || REMAINING_HE.test(t));
/** Every attribute name the identity knows, beside whether it is still open (neither seen in the photograph nor confirmed). */
function attributeState(identity) {
  const out = (identity.attributes ?? []).map((a) => [a.name, a.basis !== 'confirmed' && a.basis !== 'observed']);
  for (const [name, field] of Object.entries(CORE_FIELDS)) out.push([name, !identity[field]]);
  return out;
}
function settledBy(note, c, identity) {
  const words = tokens(note);
  const named = (attribute) => mentions(words, tokens(attribute)) || (attribute === 'remaining' && namesRemaining(words));
  if (!named(c.attribute)) return false;
  return !attributeState(identity).some(([name, open]) => open && !sameAttribute(name, c.attribute) && named(name));
}

/**
 * The owner's confirmed facts, written over the model's guesses: a confirmed attribute is never silently replaced, is
 * marked as the OWNER's word (basis "confirmed", never "observed"), and a note the model wrote about not knowing it is
 * taken down: what the owner has answered is no longer uncertain. What the owner has NOT answered stays uncertain.
 * Mutates `identity` (a copy the caller made: identify.js completeIdentity).
 */
export function applyConfirmed(identity) {
  for (const c of identity.confirmed ?? []) {
    // "Not sure" is recorded so the question is not asked again; it settles nothing and names nothing.
    if (c.unsure) continue;
    const have = (identity.attributes ?? []).find((a) => sameAttribute(a.name, c.attribute));
    if (have) { have.value = c.value; have.basis = 'confirmed'; have.matters = have.matters === 'low' ? 'medium' : have.matters; }
    else if ((identity.attributes?.length ?? 0) < MAX_ATTRIBUTES && !ASKED_ATTRIBUTE.test(c.attribute)) identity.attributes.push({ name: c.attribute, value: c.value, basis: 'confirmed', matters: 'high' });
    const field = fieldOf(c.attribute);
    if (field && c.value) identity[field] = c.value;
    // THE OWNER NAMED THE MODEL (identify.js asModelChoice, or their own words): the product is established by the owner's
    // word — the search names it, the research is kept under its own name (strategy.js marketKey reads canonical_name),
    // and the candidates it was chosen from are no longer searched beside it.
    if (field === 'model' && c.value) {
      identity.exact_model_established = true;
      const brand = String(identity.brand ?? '').trim();
      const named = brand && !c.value.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${c.value}` : c.value;
      identity.canonical_name = named.toLowerCase().replace(/\s+/g, ' ').trim();
      // A name that still offers a choice ("Apple iPhone 12 או 12 mini", Production E2E 2026-11-13) is replaced too: it
      // contains the chosen model, but it is not the owner's answer, and it became the listing's title.
      const shown = String(identity.display_name ?? '');
      if (!shown.toLowerCase().includes(c.value.toLowerCase()) || /\s(או|or)\s|\s\/\s?|\S\/\S/i.test(shown)) identity.display_name = named;
      // THE LISTING TEXT FOLLOWS THE OWNER'S ANSWER (Production E2E 2026-11-13: the iPhone 12 draft still read "נראה מדגמי
      // iPhone 12 או iPhone 12 mini"). Sentences that name a candidate the owner did not choose, or doubt the exact model,
      // are dropped; what the photograph showed otherwise stays. Nothing is added.
      if (identity.listing_description) identity.listing_description = withoutOtherModels(identity.listing_description, c.value, identity.alternatives);
      identity.alternatives = [];
    }
    // A CONFIRMED GENERATION OR SERIES NAMES THE PRODUCT (Production E2E 2026-11-13: an Apple Watch confirmed as "Series 4"
    // was still called "שעון חכם Apple Watch ללא רצועה"). The product's own name with the owner's answer, once.
    if (/^(generation|series|gen|model year)$/i.test(String(c.attribute ?? '').trim()) && c.value && !String(identity.display_name ?? '').toLowerCase().includes(String(c.value).toLowerCase())) {
      const brand = String(identity.brand ?? '').trim();
      const base = String(identity.model ?? identity.product_family ?? identity.item_type ?? '').trim();
      const product = brand && base && !base.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${base}` : (base || brand);
      if (product && !product.toLowerCase().includes(String(c.value).toLowerCase())) identity.display_name = `${product} ${c.value}`;
    }
    if (identity.uncertainty_note && settledBy(identity.uncertainty_note, c, identity)) identity.uncertainty_note = null;
  }
}

const DOUBTS_MODEL = /(הדגם המדויק|לא ניתן (?:לקבוע|להבחין)|ייתכן ש|נראה מדגמי|exact model|could be|may be either|either the)/i;
/** The description without sentences naming another candidate model, or doubting which model it is. */
export function withoutOtherModels(text, chosen, alternatives = []) {
  const pick = String(chosen ?? '').toLowerCase();
  const others = (alternatives ?? []).map((a) => String(a?.name ?? a ?? '').toLowerCase().trim()).filter((n) => n && n !== pick && !pick.includes(n));
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((t) => {
    const low = t.toLowerCase();
    const namesOther = others.some((n) => low.includes(n)) || (/\s(או|or)\s/i.test(t) && low.includes(pick) && /\d/.test(pick));
    return !namesOther && !DOUBTS_MODEL.test(t);
  });
  return kept.join(' ').trim();
}
