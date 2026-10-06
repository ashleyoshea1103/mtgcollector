import { useState, type FormEvent } from 'react';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import { defaultFinish } from '../lib/price';
import { MAX_QUANTITY, parseQuantity } from '../lib/quantity';
import type { CardSummary, Condition, CustomGroup, Finish, NewEntry } from '../types';
import { Price } from './Price';

interface Props {
  card: CardSummary;
  groups?: CustomGroup[];
  onSubmit: (entry: NewEntry) => void;
  submitting?: boolean;
}

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
        Adding <strong>{card.name}</strong> ({card.set_code.toUpperCase()} #{card.collector_number}) at{' '}
        <Price prices={card.prices} finish={finish} /> each
      </p>

      <label className="add-form__field">
        Quantity
        <input
          type="number"
          min={1}
          max={MAX_QUANTITY}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>

      <label className="add-form__field">
        Finish
        <select value={finish} onChange={(e) => setFinish(e.target.value as Finish)}>
          {card.finishes.map((f) => (
            <option key={f} value={f}>
              {labelFor(FINISHES, f)}
            </option>
          ))}
        </select>
      </label>

      <label className="add-form__field">
        Condition
        <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
          {Object.entries(CONDITIONS).map(([code, label]) => (
            <option key={code} value={code}>
              {code}: {label}
            </option>
          ))}
        </select>
      </label>

      <label className="add-form__field">
        Language
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {Object.entries(LANGUAGES).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {groups.length > 0 && (
        <label className="add-form__field">
          Add to group
          <select
            value={groupId ?? ''}
            onChange={(e) => setGroupId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="submit" className="add-form__submit" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add to collection'}
      </button>
    </form>
  );
}

