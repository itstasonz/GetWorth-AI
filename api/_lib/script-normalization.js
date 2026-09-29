// ══════════════════════════════════════════════════════════════════════════════
// SCRIPT NORMALISATION — ONE NAME, WRITTEN IN TWO ALPHABETS
//
// A seller writing for local buyers writes the product's name in the local
// alphabet. It is the same name: a brand is pronounced, not translated. So the
// question "is this Hebrew word the Latin word I hold?" has a deterministic
// answer that needs no dictionary and no model — reduce both to the consonants
// they are pronounced with, and compare.
//
// THIS IS NOT TRANSLATION, and it cannot become one. It knows no meanings. It
// cannot connect "console" to the word for console, or any product to any
// category. It can only say that two strings SOUND alike, which is the one
// relationship a transliterated proper name has to its original.
//
// ── IT IS A WEAK SIGNAL, AND IS NEVER USED ALONE ───────────────────────────
//
// Dropping vowels makes short words collide: two consonants describe many
// words. So the caller (api/_lib/market-evidence.js) requires more than this
// before a localized word counts — independent corroboration in text the
// provider returned, and an exact match on every number and identifier.
//
// NUMBERS AND IDENTIFIERS ARE NEVER PASSED THROUGH HERE. A token containing a
// digit has no skeleton: "G502" is compared as "G502" or not at all.
//
// Two scripts are implemented, Latin and Hebrew. Another script is another
// table below; nothing else in the repository changes.
// ══════════════════════════════════════════════════════════════════════════════

export const SCRIPT = Object.freeze({ LATIN: 'latin', HEBREW: 'hebrew', OTHER: 'other' });

const HEBREW_LETTER = /[א-ת]/u;
const LATIN_LETTER = /[a-z]/;
const MARKS = /[֑-ׇ̀-ͯ]/gu;      // niqqud, cantillation, diacritics
const GERESH = /['’׳ʼ`]/u;

/** Which alphabet a word token is written in. A token with a digit is OTHER. */
export function scriptOf(token) {
  const s = String(token ?? '').normalize('NFKD').replace(MARKS, '').toLowerCase();
  if (!s || /\p{N}/u.test(s)) return SCRIPT.OTHER;
  const letters = [...s].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return SCRIPT.OTHER;
  if (letters.every((c) => HEBREW_LETTER.test(c))) return SCRIPT.HEBREW;
  if (letters.every((c) => LATIN_LETTER.test(c))) return SCRIPT.LATIN;
  return SCRIPT.OTHER;
}

// A sound class per position. A position may hold more than one class where a
// letter is genuinely pronounced two ways; two skeletons agree at a position
// when their classes intersect.
const HEBREW = {
  'ב': 'B', 'ג': 'G', 'ד': 'D', 'ז': 'Z', 'ח': 'HK', 'ט': 'T',
  'כ': 'KH', 'ך': 'KH', 'ל': 'L', 'מ': 'M', 'ם': 'M', 'נ': 'N', 'ן': 'N',
  'ס': 'S', 'פ': 'P', 'ף': 'P', 'צ': 'C', 'ץ': 'C', 'ק': 'K', 'ר': 'R',
  'ש': 'S', 'ת': 'T',
  // Carriers of vowels. They are dropped: what they record is what Latin
  // spelling records with a, e, i, o, u and y, which are dropped too.
  'א': '', 'ה': '', 'י': '', 'ע': '',
};

function hebrewSkeleton(word) {
  const out = [];
  const chars = [...word];
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (GERESH.test(c)) continue;
    if (c === 'ו') {                       // vav: a vowel alone, a consonant doubled
      if (chars[i + 1] === 'ו') { out.push('B'); i += 1; }
      continue;
    }
    const softened = GERESH.test(chars[i + 1] ?? '');
    const cls = softened && (c === 'צ' || c === 'ץ') ? 'C' : HEBREW[c];
    if (cls === undefined) return null;
    if (cls) out.push(cls);
  }
  return out;
}

// Longest first: a digraph is one sound.
const LATIN_GROUPS = [
  ['tion', ['S', 'N']], ['tch', ['C']], ['sch', ['S']],
  ['sh', ['S']], ['ch', ['KC']], ['ph', ['P']], ['th', ['T']], ['ck', ['K']], ['qu', ['K']],
  ['ts', ['C']], ['tz', ['C']],
];
const LATIN = {
  b: 'B', v: 'B', w: 'B', d: 'D', f: 'P', p: 'P', g: 'G', j: 'G', k: 'K', q: 'K', l: 'L', m: 'M',
  n: 'N', r: 'R', s: 'SZ', z: 'Z', t: 'T',
  a: '', e: '', i: '', o: '', u: '', y: '', h: '',
};

function latinSkeleton(word) {
  const out = [];
  let i = 0;
  while (i < word.length) {
    const group = LATIN_GROUPS.find(([g]) => word.startsWith(g, i));
    if (group) { out.push(...group[1]); i += group[0].length; continue; }
    const c = word[i];
    if (c === 'x') { out.push('K', 'S'); i += 1; continue; }
    if (c === 'c') { out.push(/[eiy]/.test(word[i + 1] ?? '') ? 'S' : 'K'); i += 1; continue; }
    const cls = LATIN[c];
    if (cls === undefined) return null;
    if (cls) out.push(cls);
    i += 1;
  }
  return out;
}

/** Collapse a doubled sound: "tt" is pronounced once. */
const squeeze = (classes) => classes.filter((c, i) => i === 0 || c !== classes[i - 1]);

/**
 * The consonant skeleton of a word, or null when it has none: a token with a
 * digit, a token in a script this module does not read, or a mixed token.
 */
export function skeletonOf(token) {
  const script = scriptOf(token);
  if (script === SCRIPT.OTHER) return null;
  const word = String(token).normalize('NFKD').replace(MARKS, '').toLowerCase();
  const raw = script === SCRIPT.HEBREW ? hebrewSkeleton(word) : latinSkeleton(word);
  return raw ? squeeze(raw) : null;
}

/**
 * Do these two words, written in DIFFERENT alphabets, sound like one name?
 *
 * Same-script words are never compared here: two Latin words that sound alike
 * are two words, and treating them as one is fuzzy matching.
 */
export function transliterates(a, b, { minLength = 3 } = {}) {
  const sa = scriptOf(a);
  const sb = scriptOf(b);
  if (sa === SCRIPT.OTHER || sb === SCRIPT.OTHER || sa === sb) return false;
  const x = skeletonOf(a);
  const y = skeletonOf(b);
  if (!x || !y || x.length !== y.length || x.length < minLength) return false;
  return x.every((cls, i) => [...cls].some((c) => y[i].includes(c)));
}
