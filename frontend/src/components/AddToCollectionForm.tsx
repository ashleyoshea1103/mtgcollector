import { useState, type FormEvent } from 'react';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import { defaultFinish } from '../lib/price';
import { MAX_QUANTITY, parseQuantity } from '../lib/quantity';
import type { CardSummary, Condition, CustomGroup, Finish, NewEntry } from '../types';
import { Button, Field, NumberInput, Select } from '../ui';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface Props {
  card: CardSummary;
  groups?: CustomGroup[];
  onSubmit: (entry: NewEntry) => void;
  submitting?: boolean;
}

const CONDITION_OPTIONS = Object.entries(CONDITIONS).map(([code, label]) => ({ value: code as Condition, label: `${code}: ${label}` }));
const LANGUAGE_OPTIONS = Object.entries(LANGUAGES).map(([code, label]) => ({ value: code, label }));

/** Collects quantity, finish, condition, language and an optional group for one printing. */
export function AddToCollectionForm({ card, groups = [], onSubmit, submitting = false }: Props) {
  // Quantity, finish and language belong to the printing being added: they start from
  // its defaults and are forgotten when the form is given another card. Condition and
  // group stay as they are, so sorting a pile into one binder keeps those settings.
  const [choice, setChoice] = useState<{ cardId: string; quantity?: string; finish?: Finish; language?: string }>({
    cardId: card.id,
  });
  const chosen = choice.cardId === card.id ? choice : { cardId: card.id };
  // Kept as typed so the field can be cleared and retyped; parsed and clamped on submit.
  const quantity = chosen.quantity ?? '1';
  const finish = chosen.finish && card.finishes.includes(chosen.finish) ? chosen.finish : defaultFinish(card);
  const language = chosen.language ?? (Object.hasOwn(LANGUAGES, card.lang) ? card.lang : 'en');
  const setQuantity = (q: string) => setChoice({ ...chosen, quantity: q });
  const setFinish = (f: Finish) => setChoice({ ...chosen, finish: f });
  const setLanguage = (l: string) => setChoice({ ...chosen, language: l });
  const [condition, setCondition] = useState<Condition>('NM');
  const [chosenGroupId, setGroupId] = useState<number | null>(null);
  // Likewise the chosen group may have been deleted since it was picked.
  const groupId = groups.some((g) => g.id === chosenGroupId) ? chosenGroupId : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ card_id: card.id, quantity: parseQuantity(quantity), finish, condition, language, group_id: groupId });
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <p className="add-form__card">
        Adding <strong>{card.name}</strong> (<SetSymbol set={card.set} rarity={card.rarity} nameShown /> {card.set.name} #{card.collector_number}) at{' '}
        <Price prices={card.prices} finish={finish} /> each
      </p>

      <Field label="Quantity" className="add-form__field">
        <NumberInput min={1} max={MAX_QUANTITY} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>

      <Field label="Finish" className="add-form__field">
        <Select options={card.finishes.map((f) => ({ value: f, label: labelFor(FINISHES, f) }))} value={finish} onChange={setFinish} />
      </Field>

      <Field label="Condition" className="add-form__field">
        <Select options={CONDITION_OPTIONS} value={condition} onChange={setCondition} />
      </Field>

      <Field label="Language" className="add-form__field">
        <Select options={LANGUAGE_OPTIONS} value={language} onChange={setLanguage} />
      </Field>

      {groups.length > 0 && (
        <Field label="Add to group" className="add-form__field">
          <Select
            options={[{ value: '', label: 'None' }, ...groups.map((g) => ({ value: String(g.id), label: g.name }))]}
            value={groupId === null ? '' : String(groupId)}
            onChange={(v) => setGroupId(v === '' ? null : Number(v))}
          />
        </Field>
      )}

      <Button type="submit" variant="primary" className="add-form__submit" busy={submitting}>
        {submitting ? 'Adding…' : 'Add to collection'}
      </Button>
    </form>
  );
}
