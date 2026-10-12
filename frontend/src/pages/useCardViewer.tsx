import { useState } from 'react';
import { Link } from 'react-router';
import { useCard } from '../api/queries';
import { CardViewer } from '../components/CardViewer';
import { cardPath } from '../lib/paths';
import type { CardSummary } from '../types';

/**
 * A page's larger view of its cards: `view(card)` opens it, and `viewer` goes in the page.
 * While it's open the whole card is fetched, which brings a double-faced card's other face
 * (a listing or a search has only the front).
 */
export function useCardViewer() {
  const [card, setCard] = useState<CardSummary | null>(null);
  const full = useCard(card?.id ?? '', card !== null);
  const viewer = card && (
    <CardViewer
      key={card.id}
      card={full.data ?? card}
      isOpen
      onOpenChange={(open) => {
        if (!open) setCard(null);
      }}
      details={<Link to={cardPath(card.id)}>Card details</Link>}
    />
  );
  return { view: setCard, viewer };
}
