import type { ReactNode } from 'react';
import { defaultFinish } from '../lib/price';
import type { CardSummary, Finish } from '../types';
import { Cluster } from '../ui';
import { CardImage } from './CardImage';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface Props {
  card: CardSummary;
  /** Which price to show. Defaults to the printing's default finish. */
  finish?: Finish;
  /** A known unit price (e.g. the server's price for an owned copy); otherwise it's worked out from the card's prices. */
  unitPrice?: number | null;
  /** Rendered over the image, e.g. a quantity badge. */
  overlay?: ReactNode;
  /** Extra details below the standard ones. */
  children?: ReactNode;
  /** Buttons such as "Add". */
  actions?: ReactNode;
  className?: string;
}

/** A card shown as an image with its name, printing and price. Used in search results and grids. */
export function CardTile({ card, finish = defaultFinish(card), unitPrice, overlay, children, actions, className = '' }: Props) {
  return (
    <article className={`card-tile card-tile--${finish} ${className}`}>
      <div className="card-tile__media">
        <CardImage card={card} size="normal" />
        {overlay && <div className="card-tile__overlay">{overlay}</div>}
      </div>
      <div className="card-tile__body">
        <h3 className="card-tile__name">{card.name}</h3>
        <p className="card-tile__printing">
          <SetSymbol set={card.set} rarity={card.rarity} nameShown /> <span className="card-tile__set">{card.set.name}</span>{' '}
          <span className="card-tile__number">#{card.collector_number}</span>
        </p>
        <p className="card-tile__price">
          {unitPrice !== undefined ? <Price value={unitPrice} /> : <Price prices={card.prices} finish={finish} />}
        </p>
        {children}
      </div>
      {actions && (
        <Cluster as="footer" className="card-tile__actions">
          {actions}
        </Cluster>
      )}
    </article>
  );
}
