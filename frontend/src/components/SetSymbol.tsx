import type { CardSummary } from '../types';

interface Props {
  card: Pick<CardSummary, 'set' | 'rarity'>;
}

/**
 * The set's symbol and code, with the set's name on hover. The symbol is Scryfall's SVG,
 * shown with <img> only (an <img> never runs scripts inside an SVG); the rarity is a
 * modifier class, as set symbols are colored by rarity.
 */
export function SetSymbol({ card }: Props) {
  const { set } = card;
  return (
    <abbr className={`set-symbol set-symbol--${card.rarity}`} title={set.name}>
      {set.icon_svg_uri && <img className="set-symbol__icon" src={set.icon_svg_uri} alt="" loading="lazy" />}
      <span className="set-symbol__code">{set.code.toUpperCase()}</span>
    </abbr>
  );
}
