import { Fragment } from 'react';
import { describeManaCost, describeManaSymbol, parseManaCost } from '../lib/mana';
import { TooltipText } from '../ui';

interface Props {
  /** Scryfall mana cost, e.g. "{2}{R}{W/U}" or "{1}{R} // {1}{U}" for split cards. */
  cost: string;
}

/** A CSS-safe modifier for a symbol: lower-case letters and digits only, e.g. W/U/P → wup. */
const symbolClass = (symbol: string) => symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Renders a mana cost as one element per symbol, announced as a whole in words ("2 generic,
 * red"); hovering a symbol names it. Shows the symbol text for now.
 */
export function ManaCost({ cost }: Props) {
  const halves = parseManaCost(cost);
  if (halves.length === 0) return null;

  return (
    <span className="mana-cost" role="img" aria-label={describeManaCost(cost)}>
      {halves.map((symbols, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mana-cost__separator"> // </span>}
          {symbols.map((symbol, j) => (
            <TooltipText
              key={j}
              as="abbr"
              className={`mana-symbol mana-symbol--${symbolClass(symbol)}`}
              tooltip={describeManaSymbol(symbol)}
              announce={false}
            >
              {symbol}
            </TooltipText>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
