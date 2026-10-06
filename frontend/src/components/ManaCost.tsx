import { Fragment } from 'react';
import { parseManaCost } from '../lib/mana';

interface Props {
  /** Scryfall mana cost, e.g. "{2}{R}{W/U}" or "{1}{R} // {1}{U}" for split cards. */
  cost: string;
}

/** Renders a mana cost as one element per symbol. Shows the symbol text for now. */
export function ManaCost({ cost }: Props) {
  const halves = parseManaCost(cost);
  if (halves.length === 0) return null;

  return (
    <span className="mana-cost" aria-label={cost}>
      {halves.map((symbols, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mana-cost__separator"> // </span>}
          {symbols.map((symbol, j) => (
            <abbr key={j} className={`mana-symbol mana-symbol--${symbol.replace('/', '').toLowerCase()}`} title={`{${symbol}}`}>
              {symbol}
            </abbr>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
