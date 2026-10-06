import { Fragment } from 'react';
import { describeManaCost, parseManaCost } from '../lib/mana';

interface Props {
  /** Scryfall mana cost, e.g. "{2}{R}{W/U}" or "{1}{R} // {1}{U}" for split cards. */
  cost: string;
}

/** A CSS-safe modifier for a symbol: lower-case letters and digits only, e.g. W/U/P → wup. */
const symbolClass = (symbol: string) => symbol.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Renders a mana cost as one element per symbol, announced in words ("2 generic, red"). Shows the symbol text for now. */
export function ManaCost({ cost }: Props) {
  const halves = parseManaCost(cost);
  if (halves.length === 0) return null;

  return (
    <span className="mana-cost" role="img" aria-label={describeManaCost(cost)}>
      {halves.map((symbols, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mana-cost__separator"> // </span>}
          {symbols.map((symbol, j) => (
            <abbr key={j} className={`mana-symbol mana-symbol--${symbolClass(symbol)}`} title={`{${symbol}}`}>
              {symbol}
            </abbr>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
