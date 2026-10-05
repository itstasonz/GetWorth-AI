// ══════════════════════════════════════════════════════════════════════════════
// SCAN ENGINE V2 — MARKET IDENTITY
//
// THE PRODUCTION WITNESS. A blender whose panel reads "POWER BLENDER DUO PRO"
// was identified in 2.7s at 0.98, searched by that name, and priced from
// nothing: no Israeli shop or seller uses those words. They list it as
// "Ninja Detect … TB301". The identity was right and the market never heard it.
//
// So a product has a second identity — what it is SOLD AS — and that one cannot
// be read off the item. It can only be proposed and then checked.
//
//   PROPOSED   by the identity model, from memory: `market_hypotheses`.
//              Good enough to phrase a search. Not good enough to match on.
//   CHECKED    here, against what the search returned. A model number becomes
//              EXACT only when TWO INDEPENDENT SITES each show, in one result
//              about one product, the brand, the name that was read off the
//              item, and the number together.
//
// ── A NAME IS NEVER EXACT BY ABSENCE ────────────────────────────────────────
//
// A family name is TRUE of every member of the line. "Ninja Detect" beside
// "Power Blender Duo Pro" on two sites proves that this product is a Detect; it
// does not prove that "Detect" means this product and no other. That a result
// set happens to show no sibling is not evidence either way, and it has no
// effect here: a name is promoted by what the results SHOW and never by what
// they omit. A proposed name becomes EXACT only from positive evidence that
// ties it to the exact model:
//
//   ANCHORED   on two independent single-product pages the name stands beside
//              an EXACT model number — read off the item, or corroborated by
//              two sites of its own. A name borrows its exactness from a
//              number; it has none on its own.
//   WHOLE      on each of those pages the name is the page's whole name for
//              the product: in its title, nothing but the brand, the product's
//              own read name, a model number, the kind of object or the end of
//              a segment stands next to it. "Detect" inside "Detect Duo" is
//              shown as a FRAGMENT of a longer name, and such a page does not
//              support it.
//
// And it is demoted to FAMILY by positive evidence that it is shared: a page
// using it beside another model's number, or being the short form of a longer
// name proposed for the same product. More agreeing pages never promote a name
// that these rules keep; a page that contradicts nothing changes nothing.
//
// ── FIVE RELATIONS, NEVER MERGED ────────────────────────────────────────────
//
//   EXACT             this product
//   REGIONAL_VARIANT  this product as sold elsewhere (an EXACT number + suffix)
//   SIBLING           a different product of the same line (same prefix,
//                     different number), or a name also used for one
//   FAMILY            a name shared by several products of the line
//   UNVERIFIED        proposed, and nothing returned supports it
//
// Only EXACT yields a matching token. A sibling's price is a sibling's price,
// however close its name. Nothing here names a brand, a product or a site.
// ══════════════════════════════════════════════════════════════════════════════
import { sourceSite } from '../source-site.js';

export const RELATION = Object.freeze({
  EXACT: 'EXACT',
  REGIONAL_VARIANT: 'REGIONAL_VARIANT',
  SIBLING: 'SIBLING',
  FAMILY: 'FAMILY',
  UNVERIFIED: 'UNVERIFIED',
  // A text that names ANOTHER model number, once this product's own number is
  // known. "Ninja CB103 Power Nutri Duo" carries the brand and the one word
  // that makes the read name distinctive; it is a different product.
  OTHER_PRODUCT: 'OTHER_PRODUCT',
});
/** How many independent sites must connect an alias to the read identity. */
export const MIN_ALIAS_SITES = 2;
const MAX_LISTED = 16;

// Trademark signs are removed BEFORE normalisation: NFKC turns "Detect™" into
// "DetectTM", which is a different word from the one a seller types.
export const tokens = (v) => String(v ?? '').replace(/[™®©℠]/g, ' ').normalize('NFKC').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// A model number: letters, then digits, then perhaps a regional or colour
// suffix. "TB301", "TB-301", "TB301UK", "G305", "MR0089". A wattage or a volume
// ("1200W", "700ml") starts with a digit and is not one.
const IDENTIFIER = /(?<![\p{L}\p{N}])([A-Za-z]{1,5})-?(\d{2,5})([A-Za-z]{0,6})(?![\p{L}\p{N}])/gu;

/** { id, root, prefix, digits, suffix } for every model number in the text. */
export function identifiersIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(IDENTIFIER)) {
    const prefix = m[1].toUpperCase();
    const suffix = m[3].toUpperCase();
    out.push({ id: `${prefix}${m[2]}${suffix}`, root: `${prefix}${m[2]}`, prefix, digits: m[2], suffix });
  }
  return out;
}
/** The distinct base model numbers a text mentions. One product page has one. */
export const rootsIn = (text) => [...new Set(identifiersIn(text).map((i) => i.root))];

const containsSequence = (hay, needle) => {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((t, j) => hay[i + j] === t)) return true;
  }
  return false;
};
/** Is `part` the sequence `whole` with some tokens left out, in order? */
const inOrderPartOf = (part, whole) => {
  let at = 0;
  for (const t of part) {
    at = whole.indexOf(t, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
};

// A title is read in SEGMENTS: "Ninja Detect Duo | KSP" names the product and
// then the shop, and the shop's name is not part of the product's.
const SEGMENT = /\s[|–—:•·/+&]\s|\s-\s|[|()[\]{},:;!?]|\s[-–—]\s*$|^\s*[-–—]\s/u;

export const NAME_SHOWN = Object.freeze({ WHOLE: 'WHOLE', FRAGMENT: 'FRAGMENT', ABSENT: 'ABSENT' });

/**
 * How a title shows a name: as the whole name of the product, or as a fragment
 * of a longer one. The token next to the name on either side must be
 * EXPLAINED: the brand, a model number, the kind of object, a run of the
 * product's own read name (in its order), or the segment's edge. Any other
 * word joined to the name is a longer name, of which this one is a part.
 */
export function nameShownIn(title, phrase, { brandTokens, nameTokens, kindTokens }) {
  if (phrase.length === 0) return NAME_SHOWN.ABSENT;
  // `run` is the tokens on one side of the name, nearest first. A run of the
  // read name's words explains the side only when it is the read name itself,
  // or the read name with words left out: it begins where the read name
  // begins (after the alias) or ends where it ends (before it). "Duo Pro" on
  // its own is two of its words, not the name.
  const explained = (run, side) => {
    if (run.length === 0) return true;
    const t = run[0];
    if (brandTokens.includes(t) || kindTokens.includes(t)) return true;
    if (identifiersIn(t).length > 0) return true;
    if (!nameTokens.includes(t)) return false;
    let n = 0;
    while (n < run.length && nameTokens.includes(run[n])) n += 1;
    const inReadingOrder = side === 'after' ? run.slice(0, n) : run.slice(0, n).reverse();
    const edge = side === 'after' ? inReadingOrder[0] === nameTokens[0] : inReadingOrder.at(-1) === nameTokens.at(-1);
    return edge && inOrderPartOf(inReadingOrder, nameTokens);
  };
  let shown = NAME_SHOWN.ABSENT;
  for (const segment of String(title ?? '').split(SEGMENT)) {
    const toks = tokens(segment);
    for (let i = 0; i + phrase.length <= toks.length; i += 1) {
      if (!phrase.every((t, j) => toks[i + j] === t)) continue;
      if (explained(toks.slice(0, i).reverse(), 'before') && explained(toks.slice(i + phrase.length), 'after')) return NAME_SHOWN.WHOLE;
      shown = NAME_SHOWN.FRAGMENT;
    }
  }
  return shown;
}

/**
 * Work out what this product is sold as, from the search results.
 *
 * `results` is `provenance.results`: [{ url, domain, title, text }]. Returns
 * the classified aliases and the tokens that may be matched on. Total: any
 * input yields a report, and with no evidence every hypothesis is UNVERIFIED.
 */
export function assessMarketIdentity({ identity = null, results = [] } = {}) {
  const brand = identity?.brand?.value ?? null;
  const name = identity?.model?.value ?? null;
  const brandTokens = tokens(brand);
  const nameTokens = tokens(name);
  // The kind of object, in either language: "blender" beside a name is not a longer name.
  const kindTokens = [...new Set([...tokens(identity?.object_class), ...tokens(identity?.local_name)])];
  const hyp = identity?.market_hypotheses ?? {};
  const proposedNumbers = (hyp.model_numbers ?? []).flatMap((n) => identifiersIn(n));
  const proposedAliases = (hyp.aliases ?? []).map((a) => ({ value: a, phrase: tokens(a).filter((t) => !brandTokens.includes(t)) }))
    .filter((a) => a.phrase.length > 0);

  // One entry per result: its words, its model numbers, and whether it is about
  // ONE product. A page listing several models can put any name beside any
  // number, so it connects nothing.
  const pages = (Array.isArray(results) ? results : []).map((r) => {
    const text = `${r?.title ?? ''}\n${r?.text ?? ''}\n${r?.url ?? ''}`;
    const toks = tokens(`${r?.title ?? ''}\n${r?.text ?? ''}`);
    const ids = identifiersIn(text);
    const roots = [...new Set(ids.map((i) => i.root))];
    return {
      url: r?.url ?? null,
      site: sourceSite(r?.domain ?? r?.url),
      title: typeof r?.title === 'string' ? r.title : '',
      toks,
      ids,
      roots,
      single: roots.length <= 1,
      hasBrand: brandTokens.length > 0 && brandTokens.every((t) => toks.includes(t)),
      hasName: nameTokens.length > 0 && nameTokens.every((t) => toks.includes(t)),
    };
  }).filter((p) => p.site);

  // A number that was READ off the item needs no corroboration: it is identity.
  // Either it is part of the read name, or it is the model number the
  // identity read off a label (identity.js keeps that field only when it was
  // read and occurs in the visible text).
  const readNumber = identity?.model_number?.value ?? null;
  const readRoots = new Set([
    ...identifiersIn([name, ...(identity?.visible_text ?? [])].join(' '))
      .filter((i) => nameTokens.includes(i.id.toLowerCase()) || nameTokens.includes(i.root.toLowerCase()))
      .map((i) => i.root),
    ...identifiersIn(readNumber).map((i) => i.root),
  ]);

  // ── MODEL NUMBERS ────────────────────────────────────────────────────────
  const connecting = new Map();   // root -> Map(site -> url)
  for (const p of pages) {
    if (!p.single || !p.hasBrand || !p.hasName) continue;
    for (const root of p.roots) {
      if (!connecting.has(root)) connecting.set(root, new Map());
      if (!connecting.get(root).has(p.site)) connecting.get(root).set(p.site, p.url);
    }
  }
  const exactRoots = new Set([...readRoots]);
  for (const [root, sites] of connecting) if (sites.size >= MIN_ALIAS_SITES) exactRoots.add(root);
  const exactShapes = [...exactRoots].map((r) => identifiersIn(r)[0]).filter(Boolean);
  const isSiblingOf = (i) => !exactRoots.has(i.root)
    && exactShapes.some((e) => e.prefix === i.prefix && e.digits.length === i.digits.length);

  const seen = new Map();   // id -> { shape, sites }
  const noteId = (shape, site) => {
    if (!seen.has(shape.id)) seen.set(shape.id, { shape, sites: new Set() });
    if (site) seen.get(shape.id).sites.add(site);
  };
  for (const p of pages) if (p.hasBrand) for (const i of p.ids) noteId(i, p.site);
  for (const i of proposedNumbers) noteId(i, null);

  const evidenceFor = (root) => [...(connecting.get(root) ?? new Map())].map(([site, url]) => ({ site, url }));
  const numbers = [];
  for (const { shape, sites } of seen.values()) {
    const proposed = proposedNumbers.some((p) => p.id === shape.id);
    let relation = null;
    if (exactRoots.has(shape.root)) relation = shape.suffix ? RELATION.REGIONAL_VARIANT : RELATION.EXACT;
    // A sibling is a product the results SHOWED. A number nobody returned is
    // only a proposal, whatever it resembles.
    else if (sites.size > 0 && isSiblingOf(shape)) relation = RELATION.SIBLING;
    else if (proposed) relation = RELATION.UNVERIFIED;
    if (!relation) continue;                       // some other product's number: not ours to classify
    numbers.push({
      value: shape.id, kind: 'model_number', relation, proposed,
      read_off_item: readRoots.has(shape.root) && !shape.suffix,
      sites_seen: sites.size,
      weak: relation === RELATION.REGIONAL_VARIANT && sites.size < MIN_ALIAS_SITES,
      evidence: relation === RELATION.EXACT ? evidenceFor(shape.root).slice(0, 6) : [],
    });
  }

  // ── NAMES ────────────────────────────────────────────────────────────────
  //
  // A name is EXACT when two independent sites each show it, WHOLE, in the
  // title of a page about one product that carries an EXACT model number. Its
  // exactness is the number's. Beside the read name alone it is seen with
  // this product — which a family name would be too — and that is recorded
  // and promotes nothing. One use beside another model's number makes it a
  // family name, whatever else agrees. So does being the SHORT FORM of a
  // longer proposed name: "Detect" beside "Detect Duo" is the line, not the
  // product, even when this search happened to return no other member of it.
  const bounds = { brandTokens, nameTokens, kindTokens };
  // A number beside the name that is ANOTHER model's: not exact, and not a
  // still-unverified proposal for this product — unless the results showed
  // that proposal to be a sibling.
  const proposedRoots = new Set(proposedNumbers.map((n) => n.root));
  const anotherModels = (root) => !exactRoots.has(root) && (!proposedRoots.has(root) || isSiblingOf(identifiersIn(root)[0]));
  const names = proposedAliases.map(({ value, phrase }) => {
    const support = new Map();        // site -> url: whole, beside an exact number
    const besideName = new Set();     // sites showing it with the read name: membership, not identity
    const tiedTo = new Set();         // the exact numbers it stood beside
    const otherRoots = new Set();
    let fragments = 0;
    for (const p of pages) {
      if (!p.single || !p.hasBrand || !containsSequence(p.toks, phrase)) continue;
      const foreign = p.roots.filter((r) => !exactRoots.has(r));
      for (const r of foreign.filter(anotherModels)) otherRoots.add(r);
      if (foreign.length > 0) continue;
      if (p.hasName) besideName.add(p.site);
      const exact = p.roots.find((r) => exactRoots.has(r));
      if (!exact) continue;
      const shown = nameShownIn(p.title, phrase, bounds);
      if (shown === NAME_SHOWN.FRAGMENT) fragments += 1;
      if (shown !== NAME_SHOWN.WHOLE) continue;
      tiedTo.add(exact);
      if (!support.has(p.site)) support.set(p.site, p.url);
    }
    const longer = proposedAliases.find((o) => o.phrase.length > phrase.length && containsSequence(o.phrase, phrase));
    const corroborated = support.size >= MIN_ALIAS_SITES;
    const relation = otherRoots.size > 0 || (longer && corroborated) ? RELATION.FAMILY
      : (corroborated ? RELATION.EXACT : RELATION.UNVERIFIED);
    return {
      value, kind: 'name', relation, proposed: true, read_off_item: false,
      sites_seen: support.size, weak: false, phrase,
      tied_to: [...tiedTo].slice(0, 4),
      seen_beside_read_name: besideName.size,
      seen_as_fragment: fragments,
      also_used_for: [...otherRoots].slice(0, 4),
      short_form_of: longer?.value ?? null,
      evidence: relation === RELATION.EXACT ? [...support].map(([site, url]) => ({ site, url })).slice(0, 6) : [],
    };
  });

  const order = [RELATION.EXACT, RELATION.REGIONAL_VARIANT, RELATION.SIBLING, RELATION.FAMILY, RELATION.UNVERIFIED];
  const aliases = [...numbers, ...names]
    .sort((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation) || b.sites_seen - a.sites_seen)
    .slice(0, MAX_LISTED);
  const of = (relation, kind) => aliases.filter((a) => a.relation === relation && a.kind === kind);

  return {
    brand,
    visible_name: name,
    brand_tokens: brandTokens,
    name_tokens: nameTokens,
    proposed: { aliases: hyp.aliases ?? [], model_numbers: hyp.model_numbers ?? [] },
    aliases,
    // What may be MATCHED on. Exact model numbers, and exact names as phrases.
    exact_roots: [...exactRoots],
    exact_phrases: of(RELATION.EXACT, 'name').map((a) => a.phrase),
    sibling_roots: [...new Set(numbers.filter((n) => n.relation === RELATION.SIBLING).map((n) => identifiersIn(n.value)[0].root))],
    family_phrases: of(RELATION.FAMILY, 'name').map((a) => a.phrase),
    corroborated: aliases.filter((a) => a.relation === RELATION.EXACT && !a.read_off_item).map((a) => a.value),
  };
}

/**
 * How does this text relate to the product? The strongest claim it supports.
 *
 * A sibling's number anywhere in the text decides it: "Detect TB303" is a
 * TB303 however many of this product's words surround it.
 */
export function relationOf(text, market) {
  if (!market) return 'UNKNOWN';
  const toks = tokens(text);
  const ids = identifiersIn(text);
  const hasBrand = market.brand_tokens.length > 0 && market.brand_tokens.every((t) => toks.includes(t));
  const exactIds = ids.filter((i) => market.exact_roots.includes(i.root));
  const otherIds = ids.filter((i) => !market.exact_roots.includes(i.root));
  if (otherIds.some((i) => market.sibling_roots.includes(i.root))) return RELATION.SIBLING;
  // Another product's number. Once THIS product's number is known, a text
  // that names a different one is a different product, whatever words of the
  // read name it also carries. Before it is known, the number may yet be this
  // product's own, and the text is merely unresolved.
  if (otherIds.length > 0 && exactIds.length === 0) return market.exact_roots.length > 0 ? RELATION.OTHER_PRODUCT : 'UNKNOWN';
  if (exactIds.length > 0) return exactIds.every((i) => i.suffix) ? RELATION.REGIONAL_VARIANT : RELATION.EXACT;
  const hasName = market.name_tokens.length > 0 && market.name_tokens.every((t) => toks.includes(t));
  if (hasBrand && hasName) return RELATION.EXACT;
  if (hasBrand && market.exact_phrases.some((p) => containsSequence(toks, p))) return RELATION.EXACT;
  if (hasBrand && market.family_phrases.some((p) => containsSequence(toks, p))) return RELATION.FAMILY;
  return 'UNKNOWN';
}
