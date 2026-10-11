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
    if (identity.uncertainty_note && settledBy(identity.uncertainty_note, c, identity)) identity.uncertainty_note = null;
  }
}
