import { useState, type FormEvent } from 'react';
import { entryChange } from '../lib/entries';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import { MAX_QUANTITY, parseQuantity } from '../lib/quantity';
import type { CollectionEntry, Condition, EntryChange, Finish, Language } from '../types';
import { Button, Cluster, Field, FormError, NumberInput, Select, Stack } from '../ui';

interface Props {
  entry: CollectionEntry;
  /** Called with what changed (empty if nothing did). */
  onSubmit: (change: EntryChange) => void;
  onCancel?: () => void;
  submitting?: boolean;
  /** Why the last attempt failed, e.g. another entry already being that copy. */
  error?: string;
}

const CONDITION_OPTIONS = Object.entries(CONDITIONS).map(([code, label]) => ({ value: code as Condition, label: `${code}: ${label}` }));
const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([code, label]) => ({ value: code as Language, label }));

/** Changes how many copies of an entry there are, or which copies they are (finish, condition, language). */
export function EntryChangeForm({ entry, onSubmit, onCancel, submitting = false, error }: Props) {
  const [quantity, setQuantity] = useState(String(entry.quantity));
  const [finish, setFinish] = useState<Finish>(entry.finish);
  const [condition, setCondition] = useState<Condition>(entry.condition);
  const [language, setLanguage] = useState<Language>(entry.language);
  // The printing's finishes, plus the entry's own in case the printing no longer lists it.
  const finishes = entry.card.finishes.includes(entry.finish) ? entry.card.finishes : [entry.finish, ...entry.card.finishes];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    onSubmit(entryChange(entry, { quantity: parseQuantity(quantity), finish, condition, language }));
  }

  return (
    <form className="entry-change-form" onSubmit={handleSubmit}>
      <Stack>
        <Field label="Quantity">
          <NumberInput min={1} max={MAX_QUANTITY} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Finish">
          <Select options={finishes.map((f) => ({ value: f, label: labelFor(FINISHES, f) }))} value={finish} onChange={setFinish} />
        </Field>
        <Field label="Condition">
          <Select options={CONDITION_OPTIONS} value={condition} onChange={setCondition} />
        </Field>
        <Field label="Language">
          <Select options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} />
        </Field>
        {error && <FormError className="entry-change-form__error">{error}</FormError>}
        <Cluster as="footer" className="entry-change-form__actions">
          {onCancel && <Button onPress={onCancel}>Cancel</Button>}
          <Button type="submit" variant="primary" busy={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
