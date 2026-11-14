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

/** One face, large; under it the tile's smaller image, already loaded, shows until the large one has come. */
function Face({ card, face, hidden }: { card: CardSummary | Card; face: number; hidden: boolean }) {
  return (
    <div className={['card-viewer__face', face > 0 && 'card-viewer__face--back'].filter(Boolean).join(' ')} aria-hidden={hidden || undefined}>
      <span className="card-viewer__stand-in" aria-hidden="true">
        <CardImage card={card} size="normal" face={face} />
      </span>
      <CardImage card={card} size="large" face={face} />
    </div>
  );
}

/** A card shown large over the page, as it's opened from a card tile's image. */
export function CardViewer({ card, isOpen, onOpenChange, details }: Props) {
  // Which card is turned over, so another card given in its place starts on its front.
  const [turnedId, setTurnedId] = useState<string | null>(null);
  const twoFaced = 'faces' in card && (card.faces?.filter((f) => f.images).length ?? 0) >= 2;
  const back = twoFaced && turnedId === card.id;
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
              <Face card={card} face={0} hidden={back} />
              {twoFaced && <Face card={card} face={1} hidden={!back} />}
            </div>
          </div>
          <div className="card-viewer__footer">
            {twoFaced && (
              <>
                {/* Read out as it changes: the button keeps focus, and the image's name changes silently. */}
                <span className="card-viewer__side" aria-live="polite">
                  {back ? 'Back face' : 'Front face'}
                </span>
                <Button onPress={() => setTurnedId(back ? null : card.id)}>Turn over</Button>
              </>
            )}
            {details}
          </div>
        </>
      )}
    </Dialog>
  );
}
