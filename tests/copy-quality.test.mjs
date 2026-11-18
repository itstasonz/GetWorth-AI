// CQ — USER-FACING COPY QUALITY (2026-11-18). Product copy is written like a person on an Israeli product team: no em dashes
// or "--" in prose, no exclamation stacks, no generic AI marketing lines, no chatbot first person, no internal field names,
// and Hebrew instructions in the neutral plural, never masculine-singular commands. Scoped to user-facing strings: code,
// comments, developer logs, CSS, URLs, numeric ranges and a lone "—" placeholder in an empty table cell are not checked.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import T from '../src/lib/translations.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HEBREW = /[֐-׿]/;
// A dash used as prose punctuation: a space on at least one side, and words on both. "₪240–270" and a lone "—" are not prose.
const PROSE_DASH = /\S\s*—\s*\S|\s--\s/;
const STACKED = /!!|\?\?|!\?|\?!/;
const MARKETING = /\b(unlock the power|your journey|endless possibilities|we'?ve got you covered|seamless experience|exciting opportunities|revolutioni[sz]|experience the future|powered by advanced|a smarter way to)\b/i;
const FIRST_PERSON = /(^|[^\p{L}])(זיהיתי|מצאתי|אני מציג|אין לי)([^\p{L}]|$)|\bI (identified|found|show|can see)\b/u;
const INTERNAL = /\b(after_reference|market_state|price_origin|retail_new_ils|binding_reason|set_aside|generation:)\b/;
// Masculine-singular commands; the product speaks in the neutral plural (נסו, בחרו) or uses a noun/infinitive on buttons.
const MASC_COMMAND = /(^|[^\p{L}])(נסה|בדוק|בחר|לחץ|הזן|צלם|סרוק|התחבר|הוסף|שמור|המתן|פרסם|העלה|גרור|הקלד|כתוב|שלח|ערוך|מחק|הירשם|עדכן|נקה|קנה|מכור|שתף|הצג|התקשר|סנן|השתמש)([^\p{L}]|$)/u;

function* values(obj, path = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') yield [[...path, k].join('.'), v];
    else if (v && typeof v === 'object') yield* values(v, [...path, k]);
  }
}
/** Every quoted literal that contains Hebrew, outside comments and developer logging. */
function hebrewLiterals(file) {
  const out = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
    const code = line.trim();
    if (/^(\/\/|\*|\/\*|\{\/\*)/.test(code) || /console\.|camLog\(|mark\(/.test(line)) return;
    for (const m of line.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
      // A template's ${…} parts are code (`??`, `?.`), not words.
      const s = (m[1] ?? m[2] ?? m[3])?.replace(/\$\{[^}]*\}/g, ' ');
      if (s && HEBREW.test(s)) out.push({ where: `${file.replace(ROOT, '')}:${n + 1}`, s });
    }
  });
  return out;
}
const sourceFiles = () => ['src/lib/scanCopy.js', 'src/lib/marketplaceProvenance.js', 'src/App.jsx', 'src/contexts/AppContext.jsx',
  ...readdirSync(join(ROOT, 'src/views')).filter((f) => f.endsWith('.jsx')).map((f) => `src/views/${f}`),
  ...readdirSync(join(ROOT, 'src/components')).filter((f) => f.endsWith('.jsx')).map((f) => `src/components/${f}`),
].map((f) => join(ROOT, f));
// Speech a simulated seller types in demo mode, and old regex lists that only MATCH user text: not product copy.
const ALLOWED = /בוא נדבר|בוא ניצור קשר|אני זמין|אני מציע|NOT_AN_ANSWER|לא בטוח\.\*/;

describe('CQ-1 translations.js', () => {
  test('CQ-1a no prose dashes, stacked punctuation, marketing lines, chatbot voice or internal names', () => {
    const bad = [];
    for (const lang of ['he', 'en']) for (const [k, v] of values(T[lang])) {
      for (const [name, re] of [['dash', PROSE_DASH], ['stacked', STACKED], ['marketing', MARKETING], ['first person', FIRST_PERSON], ['internal', INTERNAL]]) if (re.test(v)) bad.push(`${lang}.${k} [${name}]: ${v}`);
      if (lang === 'he' && MASC_COMMAND.test(v)) bad.push(`he.${k} [masculine command]: ${v}`);
    }
    assert.deepEqual(bad, []);
  });
});

describe('CQ-2 Hebrew strings in the app', () => {
  test('CQ-2a no prose dashes, stacked punctuation, chatbot voice or internal names', () => {
    const bad = [];
    for (const f of sourceFiles()) for (const { where, s } of hebrewLiterals(f)) {
      if (ALLOWED.test(s)) continue;
      for (const [name, re] of [['dash', PROSE_DASH], ['stacked', STACKED], ['first person', FIRST_PERSON], ['internal', INTERNAL]]) if (re.test(s)) bad.push(`${where} [${name}]: ${s}`);
    }
    assert.deepEqual(bad, []);
  });
  test('CQ-2b instructions in the neutral plural: no masculine-singular commands', () => {
    const bad = [];
    for (const f of sourceFiles()) for (const { where, s } of hebrewLiterals(f)) if (!ALLOWED.test(s) && MASC_COMMAND.test(s)) bad.push(`${where}: ${s}`);
    assert.deepEqual(bad, []);
  });
  test('CQ-2c the pricing disclosures keep their meaning', () => {
    const copy = readFileSync(join(ROOT, 'src/lib/scanCopy.js'), 'utf8');
    assert.ok(copy.includes("calculatedTitle: 'אומדן לפי מחיר מוצר חדש'"));
    assert.ok(copy.includes('זו לא הערכת שוק מאומתת'), 'a calculated estimate is never called a market valuation');
    assert.ok(copy.includes("comparativeNote: 'אלה מחירים מבוקשים, לא מחירי מכירה ולא שווי משוער.'"), 'an asking price is never called a sale');
    assert.ok(copy.includes('כרגע לא זמין לקנייה'), 'an unavailable new price is said to be unavailable');
  });
});
