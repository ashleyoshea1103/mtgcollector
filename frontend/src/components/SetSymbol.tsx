import { isOnHost, SET_ICON_HOST } from '../lib/urls';
import type { CardSet, Rarity } from '../types';

interface Props {
  set: CardSet;
  /** The printing's rarity, as a modifier class; left out where there's no single printing (a group header). */
  rarity?: Rarity;
  /**
   * Set when the set's name is shown as text right beside the symbol: screen readers then
   * skip the symbol, rather than read the set twice.
   */
  nameShown?: boolean;
}

/**
 * The set's symbol and code, with the set's name on hover. The symbol is Scryfall's SVG,
 * shown with <img> only (an <img> never runs scripts inside an SVG). The rarity is a
 * modifier class for the code's text; CSS can't recolor an <img>, so coloring the symbol
 * itself by rarity waits for the design (e.g. as a CSS mask).
 */
export function SetSymbol({ set, rarity, nameShown = false }: Props) {
  const icon = set.icon_svg_uri !== null && isOnHost(set.icon_svg_uri, SET_ICON_HOST) ? set.icon_svg_uri : null;
  return (
    <abbr className={`set-symbol${rarity ? ` set-symbol--${rarity}` : ''}`} title={set.name} aria-hidden={nameShown || undefined}>
      {icon && <img className="set-symbol__icon" src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <span className="set-symbol__code">{set.code.toUpperCase()}</span>
    </abbr>
  );
}
