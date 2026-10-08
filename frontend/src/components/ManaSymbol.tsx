import { useState } from 'react';
import { symbolImage, symbolWords } from '../lib/mana';
import { TooltipText } from '../ui';

interface Props {
  /** The symbol without braces, e.g. "G", "W/U", "T". */
  symbol: string;
  /**
   * Whether screen readers read it ("one green mana"): yes in rules text; no inside a ManaCost,
   * which reads the whole cost at once.
   */
  announce?: boolean;
}

/** A CSS-safe modifier for a symbol: lower-case letters and digits only, e.g. W/U/P → wup. */
const symbolClass = (symbol: string) => symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * One card symbol as Scryfall's image ({G} as a green mana pip), named in words on hover and
 * to screen readers. A symbol Scryfall has no image for, or whose image fails to load, is
 * shown as text instead, e.g. {G}.
 */
export function ManaSymbol({ symbol, announce = true }: Props) {
  const src = symbolImage(symbol);
  // The image that failed, if any: a different symbol (a new src) gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const image = src !== null && src !== failed ? src : null;
  return (
    <TooltipText
      as="abbr"
      className={`mana-symbol mana-symbol--${symbolClass(symbol)}${image ? '' : ' mana-symbol--text'}`}
      tooltip={symbolWords(symbol)}
      announce={announce}
    >
      {image ? <img className="mana-symbol__icon" src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailed(image)} /> : symbol}
    </TooltipText>
  );
}
