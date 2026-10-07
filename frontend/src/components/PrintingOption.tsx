import { defaultFinish } from '../lib/price';
import type { CardSummary } from '../types';
import { ToggleButton } from '../ui';
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
    <ToggleButton className={`printing-option${selected ? ' printing-option--selected' : ''}`} selected={selected} onPress={() => onSelect?.(card)}>
      <SetSymbol set={card.set} rarity={card.rarity} nameShown />
      <span className="printing-option__set">{card.set.name}</span>
      <span className="printing-option__number">#{card.collector_number}</span>
      <time className="printing-option__date" dateTime={card.released_at}>
        {card.released_at.slice(0, 4)}
      </time>
      <Price prices={card.prices} finish={defaultFinish(card)} />
    </ToggleButton>
  );
}
