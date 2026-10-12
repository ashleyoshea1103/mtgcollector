import type { ReactNode } from 'react';
import { defaultFinish } from '../lib/price';
import type { CardSummary, Finish } from '../types';
import { Button, Cluster } from '../ui';
import { CardImage } from './CardImage';
import { NoLongerListed } from './NoLongerListed';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface Props {
  card: CardSummary;
  /** Which price to show. Defaults to the printing's default finish. */
  finish?: Finish;
  /** Replaces the price line, which is otherwise worked out from the card's prices; null leaves it out (a tile showing its price its own way). */
  price?: ReactNode;
  /** Rendered over the image, e.g. a quantity badge. */
  overlay?: ReactNode;
  /** Extra details below the standard ones. */
  children?: ReactNode;
  /** Buttons such as "Add". */
  actions?: ReactNode;
  /** Shows the card larger (see CardViewer): given, the image is a button that calls it (a card with no image has nothing to show larger). */
  onView?: () => void;
  className?: string;
}

/** A card shown as an image with its name, printing and price. Used in search results and grids. */
export function CardTile({ card, finish = defaultFinish(card), price, overlay, children, actions, onView, className = '' }: Props) {
  const image = <CardImage card={card} size="normal" />;
  return (
    <article className={`card-tile card-tile--${finish} ${className}`}>
      <div className="card-tile__media">
        {onView && card.images ? (
          <Button variant="ghost" className="card-tile__view" aria-label={`View ${card.name} larger`} onPress={onView}>
            {image}
          </Button>
        ) : (
          image
        )}
        {overlay && <div className="card-tile__overlay">{overlay}</div>}
      </div>
      <div className="card-tile__body">
        <h3 className="card-tile__name">{card.name}</h3>
        <p className="card-tile__printing">
          <SetSymbol set={card.set} rarity={card.rarity} nameShown /> <span className="card-tile__set">{card.set.name}</span>{' '}
          <span className="card-tile__number">#{card.collector_number}</span> <NoLongerListed card={card} />
        </p>
        {price !== undefined ? (
          price
        ) : (
          <p className="card-tile__price">
            <Price prices={card.prices} finish={finish} />
          </p>
        )}
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
