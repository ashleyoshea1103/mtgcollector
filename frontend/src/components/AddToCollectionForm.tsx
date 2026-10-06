import { useState, type FormEvent } from 'react';
import { CONDITIONS, FINISHES, LANGUAGES } from '../lib/labels';
import type { Card, Condition, CustomGroup, Finish, NewEntry } from '../types';
import { Price } from './Price';

interface Props {
  card: Card;
  groups?: CustomGroup[];
  onSubmit: (entry: NewEntry) => void;
  submitting?: boolean;
}

/** Collects quantity, finish, condition, language and an optional group for one printing. */
export function AddToCollectionForm({ card, groups = [], onSubmit, submitting = false }: Props) {
  // Kept as typed so the field can be cleared and retyped; parsed and clamped on submit.
  const [quantity, setQuantity] = useState('1');
  const [finish, setFinish] = useState<Finish>(card.finishes[0] ?? 'nonfoil');
  const [condition, setCondition] = useState<Condition>('NM');
  const [language, setLanguage] = useState('en');
  const [groupId, setGroupId] = useState<number | null>(null);

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
          max={999}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </label>

      <label className="add-form__field">
        Finish
        <select value={finish} onChange={(e) => setFinish(e.target.value as Finish)}>
          {card.finishes.map((f) => (
            <option key={f} value={f}>
              {FINISHES[f]}
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

/** A whole number from 1 to 999; anything empty or invalid counts as 1. */
function parseQuantity(input: string): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 999) : 1;
}
