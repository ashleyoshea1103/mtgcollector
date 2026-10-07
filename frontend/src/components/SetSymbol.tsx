import { isOnHost, SET_ICON_HOST } from '../lib/urls';
import type { CardSummary } from '../types';

interface Props {
  card: Pick<CardSummary, 'set' | 'rarity'>;
  /**
   * Set when the set's name is shown as text right beside the symbol: screen readers then
   * skip the symbol, rather than read the set twice.
   */
  nameShown?: boolean;
}

/**
 * The set's symbol and code, with the set's name on hover. The symbol is Scryfall's SVG,
 * shown with <img> only (an <img> never runs scripts inside an SVG); the rarity is a
 * modifier class, as set symbols are colored by rarity.
 */
export function SetSymbol({ card, nameShown = false }: Props) {
  const { set } = card;
  const icon = set.icon_svg_uri !== null && isOnHost(set.icon_svg_uri, SET_ICON_HOST) ? set.icon_svg_uri : null;
  return (
    <abbr className={`set-symbol set-symbol--${card.rarity}`} title={set.name} aria-hidden={nameShown || undefined}>
      {icon && <img className="set-symbol__icon" src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span className="set-symbol__code">{set.code.toUpperCase()}</span>
    </abbr>
  );
}
