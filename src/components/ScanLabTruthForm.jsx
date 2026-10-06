// ══════════════════════════════════════════════════════════════════════════════
// SCAN LAB — THE GROUND-TRUTH FORM
//
// What a person confirms about the physical item in their hand. Three rules,
// and the server enforces all three again:
//
//   - an empty field is UNKNOWN, and UNKNOWN is a complete answer;
//   - a value that IS given says how it was established;
//   - nothing is pre-filled from a recognition result, because none exists here.
//
// The field list and every choice come from the server after it has authorized
// the account. This file carries labels, not the vocabulary.
// ══════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { Btn, Chip, InputField, TextArea, Section } from './ui';

const LABEL = {
  brand: 'Brand', product_family: 'Product family', exact_model: 'Exact model', model_number: 'Model number',
  variant: 'Variant', capacity_size: 'Capacity / size', color: 'Colour', configuration: 'Configuration',
};
const words = (s) => String(s).replace(/_/g, ' ').toLowerCase();

/** A blank form, or the stored confirmation laid out for editing. */
export function formFromTruth(truth, fields) {
  return {
    identity: Object.fromEntries(fields.map((f) => [f, truth?.identity?.[f] ?? ''])),
    provenance: Object.fromEntries(fields.map((f) => [f, truth?.provenance?.[f] ?? []])),
    condition: truth?.condition ?? '',
    condition_notes: truth?.condition_notes ?? '',
    notes: truth?.notes ?? '',
  };
}

/** What stops this form being saved, in the person's words; null when nothing does. */
export function formProblem(form, fields) {
  for (const f of fields) {
    if (String(form.identity[f] ?? '').trim() && !(form.provenance[f] ?? []).length) return `${LABEL[f] ?? f}: choose how you know this.`;
  }
  if (!form.condition) return 'Choose a condition. Unknown is a choice.';
  return null;
}

function ProvenanceRow({ field, chosen, options, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`How ${LABEL[field] ?? field} was established`}>
      {options.map((p) => (
        <Chip key={p} selected={chosen.includes(p)} onClick={() => onToggle(p)}>{words(p)}</Chip>
      ))}
    </div>
  );
}

export default function ScanLabTruthForm({ item, enums, draft, onDraft, onSave, saving, saveLabel }) {
  const fields = enums.TRUTH_FIELDS;
  const [form, setForm] = useState(() => draft ?? formFromTruth(item.truth, fields));
  const [problem, setProblem] = useState(null);

  // A stored confirmation arriving after the first render (or a different slot) resets the form.
  useEffect(() => { setForm(draft ?? formFromTruth(item.truth, fields)); setProblem(null); }, [item.item_id, item.confirmed_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next) => { setForm(next); setProblem(null); onDraft?.(next); };
  // No provenance is ever ticked on the person's behalf, not even "the same as the last field":
  // how a value is known is part of the truth, and a default would be an inferred answer.
  const setValue = (f, value) => {
    const provenance = String(value).trim() === '' ? { ...form.provenance, [f]: [] } : form.provenance;
    change({ ...form, identity: { ...form.identity, [f]: value }, provenance });
  };
  const toggleProvenance = (f, p) => {
    const cur = form.provenance[f] ?? [];
    change({ ...form, provenance: { ...form.provenance, [f]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] } });
  };

  const submit = () => {
    const why = formProblem(form, fields);
    if (why) { setProblem(why); return; }
    onSave({
      identity: Object.fromEntries(fields.map((f) => [f, String(form.identity[f] ?? '').trim() || null])),
      provenance: Object.fromEntries(fields.filter((f) => String(form.identity[f] ?? '').trim()).map((f) => [f, form.provenance[f]])),
      condition: form.condition,
      condition_notes: form.condition_notes.trim() || null,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <Section title="Ground truth" level={3} subtitle="From the physical item in your hand. Leave a field empty for UNKNOWN; nothing is guessed for you.">
      {fields.map((f) => (
        <div key={f} className="space-y-2">
          {f === 'configuration' ? (
            <>
              <p className="text-label text-text-secondary">{LABEL[f]}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={LABEL[f]}>
                {enums.CONFIGURATIONS.map((c) => (
                  <Chip key={c} selected={form.identity[f] === c} onClick={() => setValue(f, form.identity[f] === c ? '' : c)}>{words(c)}</Chip>
                ))}
              </div>
            </>
          ) : (
            <InputField
              label={LABEL[f] ?? f} value={form.identity[f]} placeholder="UNKNOWN" autoComplete="off" autoCapitalize="off" spellCheck={false}
              onChange={(e) => setValue(f, e.target.value)}
            />
          )}
          {String(form.identity[f] ?? '').trim() !== '' && (
            <div className="space-y-1">
              <p className="text-meta text-text-muted">How do you know?</p>
              <ProvenanceRow field={f} chosen={form.provenance[f] ?? []} options={enums.PROVENANCE} onToggle={(p) => toggleProvenance(f, p)} />
            </div>
          )}
        </div>
      ))}

      <div className="space-y-2">
        <p className="text-label text-text-secondary">Condition, after inspecting the item</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Condition">
          {enums.CONDITIONS.map((c) => (
            <Chip key={c} selected={form.condition === c} onClick={() => change({ ...form, condition: c })}>{c}</Chip>
          ))}
        </div>
      </div>
      <TextArea label="Condition notes" rows={2} maxLength={1000} value={form.condition_notes} onChange={(e) => change({ ...form, condition_notes: e.target.value })} />
      <TextArea label="Notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => change({ ...form, notes: e.target.value })} />

      {problem && <p className="text-body-sm text-danger" role="alert">{problem}</p>}
      <Btn primary fullWidth loading={saving} onClick={submit}>{saveLabel}</Btn>
    </Section>
  );
}
