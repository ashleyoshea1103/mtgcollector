import { Fragment } from 'react';
import { describeManaCost, parseManaCost } from '../lib/mana';
import { ManaSymbol } from './ManaSymbol';

interface Props {
  /** Scryfall mana cost, e.g. "{2}{R}{W/U}" or "{1}{R} // {1}{U}" for split cards. */
  cost: string;
}

/**
 * A mana cost as Scryfall's symbol images, announced as a whole in words ("2 generic, red");
 * hovering a symbol names it.
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
            <ManaSymbol key={j} symbol={symbol} announce={false} />
          ))}
        </Fragment>
      ))}
    </span>
  );
}
