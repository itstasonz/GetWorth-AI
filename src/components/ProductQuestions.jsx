import React, { useState } from 'react';
import { questionsFor, conditionFromAnswers, NEUTRAL_NOTE } from '../lib/questionnaire';
import { Bidi } from './ScanSheets';

// PRODUCT QUESTIONS (2026-11-18): one short question at a time, large answers, every one skippable. An answer that bears
// on condition changes the price on screen at once (coreScan.js answerProductQuestion → the valuation's own per-condition
// prices); the others go into the listing. When the questions are done, the answers stay visible and can be changed.
const TOPIC = {
  battery: { he: 'סוללה', en: 'Battery' },
  box: { he: 'קופסה', en: 'Box' },
  warranty: { he: 'אחריות', en: 'Warranty' },
  missing: { he: 'חלקים', en: 'Parts' },
  structure: { he: 'נזק במבנה', en: 'Structural damage' },
  certificate: { he: 'תעודה', en: 'Certificate' },
  box_papers: { he: 'קופסה ותעודות', en: 'Box and papers' },
  service: { he: 'טיפול', en: 'Service' },
  material: { he: 'חומר', en: 'Material' },
  purity: { he: 'טוהר', en: 'Purity' },
};

export default function ProductQuestions({ identity, answers = {}, skipped = [], manual = false, onAnswer, onSkip, copy, lang }) {
  const [figure, setFigure] = useState('');
  const l = lang === 'en' ? 'en' : 'he';
  const list = questionsFor(identity, answers);
  if (list.length === 0) return null;
  const current = list.find((q) => answers[q.id] === undefined && !skipped.includes(q.id)) ?? null;
  const answered = list.filter((q) => answers[q.id] !== undefined);
  // A chip says what it answers (Production E2E 2026-11-18: a bare "כן" for the box question): the fact when the answer has
  // one, else "topic: answer".
  const labelOf = (q) => {
    if (q.kind === 'number') return `${answers[q.id]} ${q.unit === 'cm' ? (l === 'he' ? 'ס״מ' : 'cm') : (l === 'he' ? 'גרם' : 'g')}`;
    const option = q.options.find((x) => x.id === answers[q.id]);
    if (!option) return '';
    if (option.fact?.[l]) return option.fact[l];
    return TOPIC[q.id] ? `${TOPIC[q.id][l]}: ${option[l]}` : option[l];
  };
  const skip = (q) => onSkip(q.id);
  const n = Number(figure);

  if (!current) {
    if (answered.length === 0) return null;
    return (
      <div className="rounded-container border border-subtle bg-surface p-3 space-y-2" data-testid="scan-answers">
        <p className="text-meta text-text-muted">{copy.answersTitle}</p>
        <ul className="flex flex-wrap gap-2">
          {answered.map((q) => (
            <li key={q.id}>
              <button
                type="button" onClick={() => onAnswer(q.id, null)}
                className="min-h-tap px-3 rounded-control bg-surface-high border border-subtle text-label text-text-secondary state-layer"
                aria-label={`${copy.changeAnswer}: ${q[l]}`}
              >
                <Bidi>{labelOf(q)}</Bidi>
              </button>
            </li>
          ))}
        </ul>
        {/* The owner chose the condition by hand: the answers did not set it, and the screen does not say they did. */}
        {!manual && conditionFromAnswers(identity, answers) && (
          <p className="text-body-sm text-text-secondary" data-testid="scan-answers-condition">{copy.conditionFromAnswers(copy.conditions[conditionFromAnswers(identity, answers).condition])}</p>
        )}
        <p className="text-meta text-text-muted">{copy.changeHint}</p>
        {answered.some((q) => q.neutral) && <p className="text-meta text-text-muted" data-testid="scan-answers-neutral">{NEUTRAL_NOTE[l]}</p>}
      </div>
    );
  }

  const index = list.indexOf(current);
  return (
    <div className="rounded-container border border-subtle bg-surface p-4 space-y-3" data-testid="scan-product-question" data-question={current.id}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-text-muted">{copy.questionsTitle}</p>
        {list.length > 1 && <p className="text-meta text-text-muted">{copy.questionOf(index + 1, list.length)}</p>}
      </div>
      <p className="text-title-sm text-text-primary"><Bidi>{current[l]}</Bidi></p>
      {current.note && <p className="text-body-sm text-text-muted">{current.note[l]}</p>}
      {current.kind === 'number' ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (Number.isFinite(n) && n > 0) { onAnswer(current.id, n); setFigure(''); } }}>
          <div className="flex items-center gap-2">
            <input
              type="number" inputMode="decimal" min="0" step="any" value={figure} onChange={(e) => setFigure(e.target.value)} aria-label={current[l]}
              className="flex-1 min-h-tap rounded-control bg-surface-high border border-subtle px-3 text-body text-text-primary"
            />
            <span className="text-body text-text-secondary shrink-0">{current.unit === 'cm' ? (l === 'he' ? 'ס״מ' : 'cm') : (l === 'he' ? 'גרם' : 'g')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="submit" disabled={!(Number.isFinite(n) && n > 0)} className="min-h-tap rounded-control bg-action-primary text-on-action font-semibold disabled:opacity-50">{copy.answer}</button>
            <button type="button" onClick={() => skip(current)} className="min-h-tap rounded-control text-text-secondary state-layer">{copy.skip}</button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <div className={current.options.length > 3 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
            {current.options.map((option) => (
              <button
                key={option.id} type="button" onClick={() => onAnswer(current.id, option.id)}
                className="min-h-tap px-3 py-2 rounded-control bg-surface-high border border-subtle text-body text-text-primary text-center state-layer"
              >
                <Bidi>{option[l]}</Bidi>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => skip(current)} className="w-full min-h-tap rounded-control text-body-sm text-text-muted state-layer">{copy.skip}</button>
        </div>
      )}
    </div>
  );
}
