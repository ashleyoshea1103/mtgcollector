import { defaultFinish } from '../lib/price';
import type { CardSummary } from '../types';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface Props {
  card: CardSummary;
  selected?: boolean;
  onSelect?: (card: CardSummary) => void;
}

/** One printing in a "which printing do you have?" list. */
export function PrintingOption({ card, selected = false, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`printing-option${selected ? ' printing-option--selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect?.(card)}
    >
      <SetSymbol card={card} nameShown />
      <span className="printing-option__set">{card.set.name}</span>
      <span className="printing-option__number">#{card.collector_number}</span>
      <time className="printing-option__date" dateTime={card.released_at}>
        {card.released_at.slice(0, 4)}
      </time>
      <Price prices={card.prices} finish={defaultFinish(card)} />
    </button>
  );
}
