import { Fragment } from 'react';

interface Props {
  /** Scryfall mana cost, e.g. "{2}{R}{W/U}" or "{1}{R} // {1}{U}" for split cards. */
  cost: string;
}

const SYMBOL = /\{([^}]+)\}/g;

/** Splits a mana cost into one element per symbol. Shows the symbol text for now. */
export function ManaCost({ cost }: Props) {
  if (!cost) return null;
  const halves = cost.split(' // ');

  return (
    <span className="mana-cost" aria-label={cost}>
      {halves.map((half, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mana-cost__separator"> // </span>}
          {[...half.matchAll(SYMBOL)].map((m, j) => (
            <abbr
              key={j}
              className={`mana-symbol mana-symbol--${m[1].replace('/', '').toLowerCase()}`}
              title={m[0]}
            >
              {m[1]}
            </abbr>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
