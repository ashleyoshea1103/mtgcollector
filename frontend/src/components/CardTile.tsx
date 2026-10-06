import type { ReactNode } from 'react';
import type { Card, Finish } from '../types';
import { CardImage } from './CardImage';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface Props {
  card: Card;
  /** Which price to show. */
  finish?: Finish;
  /** Rendered over the image, e.g. a quantity badge. */
  overlay?: ReactNode;
  /** Extra details below the standard ones. */
  children?: ReactNode;
  /** Buttons such as "Add". */
  actions?: ReactNode;
  className?: string;
}

/** A card shown as an image with its name, printing and price. Used in search results and grids. */
export function CardTile({ card, finish = 'nonfoil', overlay, children, actions, className = '' }: Props) {
  return (
    <article className={`card-tile card-tile--${finish} ${className}`}>
      <div className="card-tile__media">
        <CardImage card={card} size="normal" />
        {overlay && <div className="card-tile__overlay">{overlay}</div>}
      </div>
      <div className="card-tile__body">
        <h3 className="card-tile__name">{card.name}</h3>
        <p className="card-tile__printing">
          <SetSymbol card={card} /> <span className="card-tile__number">#{card.collector_number}</span>
        </p>
        <p className="card-tile__price">
          <Price prices={card.prices} finish={finish} />
        </p>
        {children}
      </div>
      {actions && <footer className="card-tile__actions">{actions}</footer>}
    </article>
  );
}
