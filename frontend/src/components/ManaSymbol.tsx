import { describeManaSymbol, symbolImage } from '../lib/mana';
import { TooltipText } from '../ui';

interface Props {
  /** The symbol without braces, e.g. "G", "W/U", "T". */
  symbol: string;
  /**
   * Whether screen readers read it ("green", "tap"): yes in rules text; no inside a ManaCost,
   * which reads the whole cost at once.
   */
  announce?: boolean;
}

/** A CSS-safe modifier for a symbol: lower-case letters and digits only, e.g. W/U/P → wup. */
const symbolClass = (symbol: string) => symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * One card symbol as Scryfall's image ({G} as a green mana pip), named in words on hover and
 * to screen readers. A symbol Scryfall has no image for is shown as text, e.g. {G}.
 */
export function ManaSymbol({ symbol, announce = true }: Props) {
  const src = symbolImage(symbol);
  return (
    <TooltipText
      as="abbr"
      className={`mana-symbol mana-symbol--${symbolClass(symbol)}${src ? '' : ' mana-symbol--text'}`}
      tooltip={describeManaSymbol(symbol)}
      announce={announce}
    >
      {src ? <img className="mana-symbol__icon" src={src} alt="" referrerPolicy="no-referrer" /> : symbol}
    </TooltipText>
  );
}
