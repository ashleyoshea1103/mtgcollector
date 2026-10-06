import type { CardSummary } from '../types';

interface Props {
  card: Pick<CardSummary, 'set_code' | 'set_name' | 'rarity'>;
}

/** The set code, with the rarity as a modifier class (set symbols are colored by rarity). */
export function SetSymbol({ card }: Props) {
  return (
    <abbr className={`set-symbol set-symbol--${card.rarity}`} title={card.set_name}>
      {card.set_code.toUpperCase()}
    </abbr>
  );
}
