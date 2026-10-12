import { useState, type ReactNode } from 'react';
import { labelFor, RARITIES } from '../lib/labels';
import type { Card, CardSummary } from '../types';
import { Button, Dialog } from '../ui';
import { CardImage } from './CardImage';
import { SetSymbol } from './SetSymbol';

interface Props {
  /** The card. A summary has only its front; given the whole Card, a double-faced one can be turned over. */
  card: CardSummary | Card;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** A link to the card's own page. */
  details?: ReactNode;
}

/** A card shown large over the page, as it's opened from a card tile's image. */
export function CardViewer({ card, isOpen, onOpenChange, details }: Props) {
  const [turned, setTurned] = useState(false);
  const twoFaced = 'faces' in card && (card.faces?.filter((f) => f.images).length ?? 0) >= 2;
  const back = twoFaced && turned;
  return (
    <Dialog title={card.name} isOpen={isOpen} onOpenChange={onOpenChange} className="card-viewer">
      {(close) => (
        <>
          <Button variant="ghost" className="card-viewer__close" aria-label="Close" onPress={close}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4 L14 14 M14 4 L4 14" />
            </svg>
          </Button>
          <p className="card-viewer__printing">
            <SetSymbol set={card.set} rarity={card.rarity} nameShown /> {card.set.name} · #{card.collector_number} · {labelFor(RARITIES, card.rarity)}
          </p>
          {/* Both faces are drawn, back to back; turning the card over turns them round. */}
          <div className="card-viewer__card">
            <div className={['card-viewer__faces', back && 'card-viewer__faces--turned'].filter(Boolean).join(' ')}>
              <div className="card-viewer__face" aria-hidden={back || undefined}>
                <CardImage card={card} size="large" />
              </div>
              {twoFaced && (
                <div className="card-viewer__face card-viewer__face--back" aria-hidden={!back || undefined}>
                  <CardImage card={card} size="large" face={1} />
                </div>
              )}
            </div>
          </div>
          <div className="card-viewer__footer">
            {twoFaced && (
              <>
                <span className="card-viewer__side">{back ? 'Back face' : 'Front face'}</span>
                <Button onPress={() => setTurned((t) => !t)}>Turn over</Button>
              </>
            )}
            {details}
          </div>
        </>
      )}
    </Dialog>
  );
}
