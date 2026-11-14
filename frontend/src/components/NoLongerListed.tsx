import type { CardSummary } from '../types';
import { Badge } from '../ui';

interface Props {
  card: Pick<CardSummary, 'no_longer_listed'>;
}

/**
 * Says a printing Scryfall no longer lists (deleted, merged or made digital-only). It's kept
 * because a collection may hold it, but it has no prices any more. Nothing for listed cards.
 */
export function NoLongerListed({ card }: Props) {
  if (!card.no_longer_listed) return null;
  return (
    <Badge tone="warning" className="no-longer-listed">
      No longer listed
    </Badge>
  );
}
